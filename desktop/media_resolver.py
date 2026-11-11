"""按需刷新视频地址，复用原生平台提取器，不保存媒体凭据"""
from desktop.pacing import reporter, visit, wait_turn
import asyncio
from urllib.parse import parse_qs, urlparse
from media_downloader import MediaItem, MediaType
from media_downloader.ffmpeg import is_available
from desktop.crawler import link_runner
from desktop.content.media import bili_cid, zvideo_data


class MediaResolver:
    def __init__(self, record, page, runner=None, emit=None):
        self.record, self.page = record, page
        self.platform = record['platform']
        self.identity = record['id'].rsplit(':', 1)[-1]
        self.reuse = runner is not None
        self.runner = runner or link_runner(record, page, emit)

    async def videos(self):
        if not self.reuse:
            await self.runner.setup()
        if not await self.runner.check_login():
            raise RuntimeError('login')
        client, crawler = self.runner.client, self.runner.crawler
        identity = self.identity
        if self.platform == 'bili':
            from media_platform.bilibili import media
            semaphore = asyncio.Semaphore(1)
            response = await crawler.get_video_info_task(aid=int(identity), bvid='', semaphore=semaphore)
            view = (response or {}).get('View') or {}
            cid = bili_cid(view, self.record['url'])
            if not cid:
                raise RuntimeError('unavailable')
            if is_available():
                info = await crawler.get_video_play_url_task(int(identity), cid, semaphore, fnval=media.DASH_FNVAL) or {}
                qualities = media.available_qualities(info)[:3]
                for quality in qualities:
                    item = media.build_dash_item(info, identity, preferred_quality=quality)
                    if item:
                        yield item
            info = await crawler.get_video_play_url_task(int(identity), cid, semaphore, fnval=media.MP4_FNVAL) or {}
            # 多段只下载其中一段会伪装成完整视频，桌面明确拒绝
            if media.count_durl_segments(info) > 1:
                raise RuntimeError('unsupported')
            item = media.build_durl_item(info, identity)
            if item:
                yield item
            return
        if self.platform == 'dy':
            from media_platform.douyin.media import build_media_items
            raw = await client.get_video_by_id(identity)
        elif self.platform == 'xhs':
            from media_platform.xhs.media import build_media_items
            params = parse_qs(urlparse(self.record['url']).query)
            raw = await crawler.get_note_detail_async_task(identity, params.get('xsec_source', ['pc_search'])[0], params.get('xsec_token', [''])[0], asyncio.Semaphore(1))
        elif self.platform == 'wb':
            from media_platform.weibo.media import build_media_items
            raw = (await client.get_note_info_by_id(identity) or {}).get('mblog')
        elif self.platform == 'ks':
            from media_platform.kuaishou.media import build_media_items
            raw = (await client.get_video_info(identity) or {}).get('visionVideoDetail')
        else:
            urls = []
            if self.platform == 'zhihu' and '/zvideo/' in self.record['url']:
                playlist = ((await zvideo_data(client, identity)).get('video') or {}).get('playlist') or {}
                for quality in ('hd', 'sd', 'ld'):
                    stream = playlist.get(quality) or {}
                    if stream.get('play_url'):
                        urls.append(stream['play_url'])
            elif self.platform == 'tieba':
                data = await client._get_pc_page_data(identity, page=1)
                video = (data.get('thread') or {}).get('video') or {}
                urls = [video[key] for key in ('video_url', 'play_url') if isinstance(video.get(key), str)]
            if not urls:
                await wait_turn(self.runner.platform)
                await self.page.goto(self.record['url'], wait_until='domcontentloaded', timeout=30000)
                # 只读取页面已提供的直链，不操作播放器或录制媒体
                urls = await self.page.evaluate("""() => Array.from(document.querySelectorAll('video, video source')).map(node => node.currentSrc || node.src).filter(url => /^https?:/.test(url))""")
            if urls:
                yield MediaItem(url=urls[0], backup_urls=tuple(urls[1:]), media_type=MediaType.VIDEO, content_id=identity, stem='video')
            return
        if raw:
            for item in build_media_items(raw):
                if item.media_type == MediaType.VIDEO:
                    yield item


async def resolve_playback(record, page, emit=None):
    """只交付当前作品的临时 HTTPS 地址，不落盘或转发 Cookie/请求头"""
    import httpx
    from desktop.media_download import public_request
    from desktop.paging import https_url
    if record['platform'] not in ('dy', 'xhs'):
        raise RuntimeError('unsupported')
    async with visit(record['platform'], 'detail', reporter(emit)):
        async for item in MediaResolver(record, page, emit=emit).videos():
            if item.audio_url:
                continue
            urls = []
            for value in (item.url, *item.backup_urls):
                url = https_url(value)
                if url in urls:
                    continue
                await public_request(httpx.Request('GET', url))
                urls.append(url)
                if len(urls) == 4:
                    break
            if urls:
                return {'urls': urls, 'code': ''}
    return {'urls': [], 'code': 'unsupported'}
