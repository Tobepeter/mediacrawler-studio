"""桌面与 CLI 共用媒体候选选择"""
def without_silent_duplicates(variants):
    """抖音长视频同一档位有两份，码率低的只有画面没有声音，接口字段区分不出来（2026-11-10 逐个探测 25 个地址全部吻合）"""
    videos = [v for v in variants if v.get('kind') == 'video' and v.get('label')]
    count, top = {}, {}
    for v in videos:
        count[v['label']] = count.get(v['label'], 0) + 1
        top[v['label']] = max(top.get(v['label'], 0), v.get('bitrate') or 0)
    return [v for v in variants if not (v in videos and count[v['label']] > 1 and (v.get('bitrate') or 0) < top[v['label']])]


def selection(candidates, quality):
    videos = [v for v in candidates if v['kind'] == 'video']
    ranked = [v for v in videos if v.get('height')]
    selected = None
    status = 'unavailable'
    if ranked:
        if quality in ('best', 'worst'):
            pick = max if quality == 'best' else min
            selected = pick(ranked, key=lambda v: (min(v['height'], v.get('width') or v['height']), v.get('bitrate') or 0))
        else:
            target = int(quality.rstrip('p'))
            exact = [v for v in ranked if min(v['height'], v.get('width') or v['height']) == target]
            if exact:
                selected = max(exact, key=lambda v: v.get('bitrate') or 0)
        status = 'selected' if selected else 'unavailable'
    elif videos:
        status = 'quality_unknown'
    audio = None
    if selected and selected.get('hasAudio') is False:
        tracks = [v for v in candidates if v['kind'] == 'audio']
        if tracks:
            audio = max(tracks, key=lambda v: v.get('bitrate') or 0)
        else:
            status = 'audio_unavailable'
    return {'requested': quality, 'status': status, 'scope': 'known_dimensions',
            'unrankedVideoCount': len(videos) - len(ranked), 'videoId': selected['id'] if selected else None,
            'audioId': audio['id'] if audio else None, 'requiresMux': bool(audio)}



def choose_items(record, quality='best', variant_id=None):
    from media_downloader import MediaItem, MediaType
    candidates = (record.get('media') or {}).get('variants') or []
    choice = selection(candidates, quality)
    video = next((v for v in candidates if v.get('id') == (variant_id or choice['videoId']) and v.get('kind') == 'video'), None)
    if not video and quality in ('best', 'worst') and not variant_id:
        videos = [v for v in candidates if v.get('kind') == 'video']
        if len(videos) == 1:
            video = videos[0]
    if not video:
        raise RuntimeError('quality_unavailable')
    audio = None
    if video.get('hasAudio') is False:
        tracks = [v for v in candidates if v.get('kind') == 'audio']
        if not tracks:
            raise RuntimeError('audio_unavailable')
        audio = max(tracks, key=lambda v: v.get('bitrate') or 0)
    return [MediaItem(url=video['url'], backup_urls=tuple(video.get('backupUrls') or []),
        media_type=MediaType.VIDEO, content_id=record['id'], stem='video', headers=video.get('headers'),
        audio_url=audio['url'] if audio else None, audio_backup_urls=tuple(audio.get('backupUrls') or []) if audio else ())]


def validate_record(record):
    from urllib.parse import urlparse
    media = record.get('media') or {}
    if not isinstance(media, dict):
        raise ValueError('media 必须是对象')
    images = record.get('images') or []
    if not isinstance(images, list) or any(not isinstance(u, str) for u in images):
        raise ValueError('images 必须是地址数组')
    candidates = media.get('variants') or []
    if not isinstance(candidates, list) or len(candidates) > 1000:
        raise ValueError('媒体列表格式错误或过大')
    ids = set()
    for v in candidates:
        if not isinstance(v, dict) or v.get('kind') not in ('video', 'audio') or not isinstance(v.get('id'), str) or v['id'] in ids:
            raise ValueError('媒体版本需要唯一 id 和 video/audio 类型')
        ids.add(v['id'])
        urls = [v.get('url'), *(v.get('backupUrls') or [])]
        if any(not isinstance(u, str) or urlparse(u).scheme not in ('http', 'https') for u in urls):
            raise ValueError('媒体地址必须为 HTTP(S)，下载时统一使用 HTTPS')
        for key in ('width', 'height', 'bitrate'):
            if v.get(key) is not None and (not isinstance(v[key], (float, int)) or v[key] < 0):
                raise ValueError('媒体尺寸及码率需为非负数或 null')
        if not isinstance(v.get('headers') or {}, dict):
            raise ValueError('媒体请求头格式错误')
