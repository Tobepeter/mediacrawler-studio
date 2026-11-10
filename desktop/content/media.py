"""媒体候选及画质选择；未知属性保持 null，不推测平台未提供的版本"""
import asyncio
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

from desktop.links import media_referer
from desktop.paging import CreatorError
from media_downloader.selection import selection, without_silent_duplicates


from desktop.content.schema import number, initialize, group, CAPABILITIES

def variants(platform, raw):
    result = []

    def add(urls, data=None, kind='video', label=None, codec=None, audio=None, height=None):
        data = data or {}
        if isinstance(urls, str):
            urls = [urls]
        urls = list(dict.fromkeys('https:' + u if u.startswith('//') else 'https://' + u[7:] if u.startswith('http://') else u for u in (urls or [])
                                 if isinstance(u, str) and u.startswith(('https://', 'http://', '//'))))
        if not urls:
            return
        if any(v['url'] == urls[0] and v['kind'] == kind for v in result):
            return
        deadline = parse_qs(urlparse(urls[0]).query).get('deadline', [None])[0]
        result.append({'id': f'{kind}-{len(result) + 1}', 'kind': kind, 'label': label,
                       'width': number(data.get('width')), 'height': number(height or data.get('height')),
                       'bitrate': number(data.get('bandwidth', data.get('bit_rate', data.get('avg_bitrate', data.get('avgBitrate'))))),
                       'sizeBytes': number(data.get('data_size', data.get('size'))),
                       'codec': codec or data.get('codecs'), 'hasAudio': audio,
                       'durationSeconds': number(data.get('duration')) / 1000 if number(data.get('duration')) is not None else None,
                       'audioCodec': data.get('audio_codec', data.get('audioCodec')),
                       'audioChannels': number(data.get('audio_channels', data.get('audioChannels'))),
                       'audioBitrate': number(data.get('audio_bitrate', data.get('audioBitrate'))),
                       'videoBitrate': number(data.get('video_bitrate', data.get('videoBitrate'))),
                       'hdrType': data.get('hdr_type', data.get('hdrType')),
                       'frameRate': data.get('frameRate', data.get('frame_rate', data.get('fps'))), 'language': data.get('lang'),
                       'mimeType': data.get('mimeType', data.get('mime_type')), 'platformQualityId': data.get('id'),
                       'url': urls[0], 'backupUrls': urls[1:], 'expiresAtUnix': number(deadline),
                       'headers': {'Referer': media_referer(platform)}})

    if platform == 'bili':
        labels = dict(zip(raw.get('accept_quality') or [], raw.get('accept_description') or []))
        for kind in ('video', 'audio'):
            for stream in (raw.get('dash') or {}).get(kind) or []:
                add([stream.get('baseUrl') or stream.get('base_url'), *(stream.get('backupUrl') or stream.get('backup_url') or [])],
                    stream, kind, labels.get(stream.get('id')), audio=kind == 'audio')
        dash = raw.get('dash') or {}
        for label, streams in [('dolby', (dash.get('dolby') or {}).get('audio') or []),
                               ('flac', [(dash.get('flac') or {}).get('audio')])]:
            for stream in streams:
                if stream:
                    add([stream.get('baseUrl') or stream.get('base_url'), *(stream.get('backupUrl') or stream.get('backup_url') or [])],
                        stream, 'audio', label=label, audio=True)
    elif platform == 'dy':
        video = raw.get('video') or {}
        for entry in video.get('bit_rate') or []:
            address = entry.get('play_addr') or {}
            add(address.get('url_list'), {**entry, **address}, label=entry.get('gear_name'),
                codec='h265' if entry.get('is_h265') else None, audio=True)
        for key in ('play_addr_h264', 'play_addr_265', 'play_addr_256', 'play_addr'):
            address = video.get(key) or {}
            add(address.get('url_list'), address, label=key, codec='h264' if key == 'play_addr_h264' else None, audio=True)
        result[:] = without_silent_duplicates(result)
    elif platform == 'xhs':
        video = raw.get('video') or {}
        for name, streams in ((video.get('media') or {}).get('stream') or {}).items():
            if isinstance(streams, list):
                for stream in streams:
                    add([stream.get('master_url') or stream.get('masterUrl'), *(stream.get('backup_urls') or stream.get('backupUrls') or [])], stream,
                        label=name, codec=stream.get('video_codec') or stream.get('videoCodec'), audio=True)
        key = (video.get('consumer') or {}).get('origin_video_key') or (video.get('consumer') or {}).get('originVideoKey')
        if key:
            add('https://sns-video-bd.xhscdn.com/' + key, label='source', audio=True)
    elif platform == 'ks':
        photo = raw.get('photo') or raw
        for codec, resource in (photo.get('videoResource') or {}).items():
            if not isinstance(resource, dict):
                continue
            for adaptation in resource.get('adaptationSet') or []:
                for stream in adaptation.get('representation') or []:
                    add(stream.get('url'), stream, codec=codec, audio=True)
        for adaptation in (photo.get('manifest') or {}).get('adaptationSet') or []:
            for stream in adaptation.get('representation') or []:
                add(stream.get('url'), stream, audio=True)
        for key in ('photoH265Url', 'photoUrl'):
            add(photo.get(key), label=key, audio=True)
    elif platform == 'wb':
        from media_platform.weibo.media import media_source_mblog
        info = media_source_mblog(raw).get('page_info') or {}
        for container in ('media_info', 'urls'):
            for key, height in [('mp4_1080p_mp4', 1080), ('mp4_720p_mp4', 720), ('mp4_hd_mp4', None),
                                ('hevc_mp4_hd', None), ('mp4_ld_mp4', None), ('stream_url', None)]:
                add((info.get(container) or {}).get(key), label=key, height=height, audio=True)
    elif platform == 'zhihu':
        for label, stream in ((raw.get('video') or {}).get('playlist') or {}).items():
            add(stream.get('play_url'), stream, label=label, audio=True)
    elif platform == 'tieba':
        video = (raw.get('thread') or {}).get('video') or {}
        for key in ('video_url', 'play_url'):
            add(video.get(key), video, label=key, audio=True)
    return result


async def fetch(runner, record):
    platform, client = runner.platform, runner.client
    identity = record['id'].split(':')[-1]
    if platform == 'bili':
        from media_platform.bilibili.media import DASH_FNVAL
        detail = runner.bili_details.pop(record['id'], None) or await client.get_video_info(aid=int(identity))
        view = (detail or {}).get('View') or {}
        part = parse_qs(urlparse(record['url']).query).get('p', ['1'])[0]
        cid = view.get('cid')
        if part.isdigit() and int(part) > 1:
            pages = view.get('pages') or []
            cid = pages[int(part) - 1]['cid'] if int(part) <= len(pages) else None
        if not cid:
            raise ValueError('missing cid')
        try:
            raw = await client.get_video_play_url(int(identity), cid, fnval=DASH_FNVAL) or {}
        except CreatorError:
            raise
        except Exception:
            raw = {'_media_error': 'media_request_failed'}
        selected_part = next((p for p in view.get('pages') or [] if p.get('cid') == cid), {})
        return {**raw, '_view': view, '_cid': cid}, selected_part.get('duration', view.get('duration'))
    if platform == 'dy':
        raw = runner.dy_details.pop(record['id'], None) or await client.get_video_by_id(identity)
        duration = number((raw.get('video') or {}).get('duration'))
        return raw, duration / 1000 if duration is not None else None
    if platform == 'xhs':
        raw = runner.xhs_details.pop(record['id'], None)
        if raw is None:
            params = parse_qs(urlparse(record['url']).query)
            raw = await runner.crawler.get_note_detail_async_task(identity, params.get('xsec_source', ['pc_search'])[0],
                                                                 params.get('xsec_token', [''])[0], asyncio.Semaphore(1))
        video = (raw or {}).get('video') or {}
        duration = ((video.get('media') or {}).get('video') or {}).get('duration')
        if duration is None:
            duration = (video.get('capa') or {}).get('duration', video.get('duration'))
        return raw or {}, duration
    if platform == 'ks':
        raw = (await client.get_video_info(identity) or {}).get('visionVideoDetail') or {}
        return raw, None
    if platform == 'wb':
        raw = (await client.get_note_info_by_id(identity) or {}).get('mblog') or {}
        return raw, None
    if platform == 'tieba':
        return await client._get_pc_page_data(identity, page=1), None
    if platform == 'zhihu' and '/zvideo/' in record['url']:
        import json
        from parsel import Selector
        html = await client.get(f'/zvideo/{identity}', return_response=True)
        initial = Selector(text=html).xpath('//script[@id="js-initialData"]/text()').get()
        raw = json.loads(initial or '{}').get('initialState', {}).get('entities', {}).get('zvideos', {}).get(identity, {})
        return raw, None
    return {}, None


async def enrich(runner, record, quality='best'):
    initialize(record)
    for key in CAPABILITIES:
        record[key] = group(status='not_requested')
    record['extra'] = {}
    media = {'status': 'pending', 'variants': [], 'selection': None, 'resolvedAt': None,
             'availabilityVerified': False, 'subtitles': [], 'subtitleStatus': 'not_requested'}
    record['media'] = media
    try:
        async with asyncio.timeout(45):
            raw, duration = await fetch(runner, record)
    except CreatorError:
        # 节流和验证要让调用方知道，不能显示成详情失败
        raise
    except Exception as error:
        code = 'timeout' if isinstance(error, TimeoutError) else 'detail_request_failed'
        media.update(status='failed', error=code, subtitleStatus='failed')
        for key in CAPABILITIES:
            record[key] = group(status='failed', error=code)
        return
    if duration is not None:
        record['durationSeconds'] = number(duration)
    try:
        candidates = variants(runner.platform, raw)
        media.update(status='failed' if raw.get('_media_error') else 'available' if candidates else 'not_provided',
                     variants=candidates, selection=selection(candidates, quality),
                     resolvedAt=datetime.now(timezone.utc).isoformat())
        if raw.get('_media_error'):
            media['error'] = raw['_media_error']
        if any(v['kind'] == 'video' for v in candidates):
            record['contentType'] = 'video'
    except Exception:
        media.update(status='failed', error='media_parse_failed')
    from desktop.content.capabilities import enrich as enrich_capabilities
    try:
        await enrich_capabilities(runner, raw, record)
    except CreatorError:
        raise
    except Exception:
        for key in CAPABILITIES:
            if record[key]['status'] == 'not_requested':
                record[key] = group(status='failed', error='capability_parse_failed')
    # 保留 v2 下载和消费者使用的兼容位置
    media['subtitles'] = record['subtitles']['items']
    media['subtitleStatus'] = record['subtitles']['status']
