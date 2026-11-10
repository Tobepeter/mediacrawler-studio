"""桌面下载适配：复用流式下载/重试/合流，完成后再交付文件"""
import asyncio
import ipaddress
import os
import socket
import tempfile
from contextlib import nullcontext
from dataclasses import replace
from itertools import count as forever
from pathlib import Path
from urllib.parse import urlsplit
import httpx
from media_downloader import MediaDownloader, MediaItem, MediaType
from media_downloader.types import MediaFatalError
from desktop.links import HOSTS, media_referer
from desktop.pacing import reporter, visit


async def public_request(request):
    url = request.url
    if url.scheme != 'https' or url.username or url.password or url.port not in (None, 443):
        raise RuntimeError('unsupported')
    # 媒体地址来自平台内容，重定向也逐跳验证，避免访问本机/内网
    addresses = await asyncio.get_running_loop().getaddrinfo(url.host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise RuntimeError('unsupported')


def secure_url(value):
    if value.startswith('//'):
        value = 'https:' + value
    if value.startswith('http://'):
        value = 'https://' + value[7:]
    return value


async def media_response(response):
    content_type = response.headers.get('content-type', '').lower()
    if 'mpegurl' in content_type or 'dash+xml' in content_type:
        raise MediaFatalError('hls' if 'mpegurl' in content_type else 'unsupported')


class DesktopMediaDownloader(MediaDownloader):
    failure = 'failed'

    async def _fetch_once(self, client, item, url, part_path):
        if urlsplit(url).path.lower().endswith('.m3u8'):
            self.failure = 'hls' if item.media_type == MediaType.VIDEO else 'unsupported'
            raise MediaFatalError(self.failure)
        try:
            return await super()._fetch_once(client, item, url, part_path)
        except MediaFatalError as error:
            code = str(error)
            self.failure = ('hls' if item.media_type == MediaType.VIDEO else 'unsupported') if code == 'hls' else 'unsupported' if code == 'unsupported' else 'expired' if code in ('HTTP 404', 'HTTP 410') else 'login' if code == 'HTTP 401' else 'unavailable'
            raise
        except OSError:
            self.failure = 'disk'
            raise
        except RuntimeError as error:
            self.failure = 'unsupported' if str(error) == 'unsupported' else 'failed'
            raise
        except Exception as error:
            self.failure = 'unavailable' if '响应类型' in str(error) else 'network'
            raise


async def download_record(request, emit, page=None):
    """入口共用选择与兜底策略；固定版本/画质和离线输入不改选"""
    from media_downloader.selection import choose_items
    from media_downloader.ffmpeg import is_available

    record = request['record']
    kind = request.get('kind', 'auto')
    if kind == 'auto':
        kind = 'video' if (record.get('media') or {}).get('variants') or record.get('contentType') == 'video' else 'images'
    quality = request.get('quality', 'best')
    variant_id = request.get('variant_id')
    has_context = page is not None or request.get('runner') is not None
    can_refresh = kind == 'video' and has_context and quality == 'best' and not variant_id
    # 指定清晰度时不能换成别的档位，地址失效或还没取到就重新取一份再选
    can_requery = kind == 'video' and has_context and quality != 'best' and not variant_id
    items, fallback = None, False

    async def requery():
        from desktop.content.detail import refreshed
        fresh = await refreshed(record, page, request.get('runner'), quality)
        return fresh, choose_items(fresh, quality, None)

    if kind == 'video' and (record.get('media') or {}).get('variants'):
        try:
            items = choose_items(record, 'best' if record['id'] == 'direct' else quality, variant_id)
        except RuntimeError:
            if not can_refresh and not can_requery:
                raise
            fallback = can_refresh
    if kind == 'video' and not items:
        if not has_context:
            raise RuntimeError('unavailable')
        if can_requery:
            record, items = await requery()
        elif quality != 'best' or variant_id:
            raise RuntimeError('quality_unavailable')
    if can_refresh and items and items[0].is_dash and not is_available():
        fallback = True
    current = {**request, 'kind': kind, 'items': None if fallback else items,
               'record': {**record, 'media': None} if fallback else record}
    result = await download_media(current, emit, page)
    # 最多刷新一次；磁盘故障和取消不应再访问平台或重下
    if (can_refresh and items and not fallback and not result['saved']
            and result.get('code') in ('expired', 'unavailable', 'network', 'failed', 'ffmpeg_required')):
        fallback = True
        result = await download_media({**current, 'record': {**record, 'media': None}, 'items': None}, emit, page)
    elif can_requery and items and not result['saved'] and result.get('code') in ('expired', 'unavailable', 'network', 'failed'):
        record, items = await requery()
        result = await download_media({**current, 'record': record, 'items': items}, emit, page)
    result.update(fallback=fallback, requestedQuality=quality,
                  mediaUrl=items[0].url if items and not fallback else None)
    return result


def delivered_name(request, path):
    """桌面端直接存进下载目录，文件名由主进程定好；多张图片按序号区分"""
    name = Path(str(request.get('fileName') or '')).name
    if not name:
        return path.name
    many = request['kind'] == 'images' and len(request['record'].get('images') or []) > 1
    return f'{name} {path.stem}{path.suffix}' if many else f'{name}{path.suffix}'


def link_unique(source, output, name):
    target = output / name
    for index in forever(2):
        try:
            os.link(source, target)
            return target
        except FileExistsError:
            target = output / f'{Path(name).stem} ({index}){Path(name).suffix}'


async def download_media(request, emit, page=None):
    record, kind = request['record'], request['kind']
    platform = record['platform']
    output = Path(request['directory']).resolve()
    output.mkdir(parents=True, exist_ok=True)
    saved, errors, files = 0, [], []
    # 临时文件在独立目录内，取消时清理，不把半成品交给用户
    with tempfile.TemporaryDirectory(prefix='.working-', dir=output) as temporary:
        downloader = DesktopMediaDownloader(platform, base_dir=Path(temporary), max_retries=1, timeout=30,
            extra_headers={'Referer': media_referer(platform)} if platform in HOSTS else {})
        async with httpx.AsyncClient(follow_redirects=True, timeout=30, event_hooks={'request': [public_request], 'response': [media_response]}) as client:
            async def transfer(item):
                nonlocal saved
                downloader.failure = 'failed'
                safe_headers = {k: v for k, v in (item.headers or {}).items() if k.lower() in ('referer', 'user-agent') and isinstance(v, str) and '\n' not in v and '\r' not in v}
                item = replace(item, url=secure_url(item.url), backup_urls=tuple(secure_url(url) for url in item.backup_urls), audio_url=secure_url(item.audio_url) if item.audio_url else None, audio_backup_urls=tuple(secure_url(url) for url in item.audio_backup_urls), headers=safe_headers)
                if item.is_dash:
                    from media_downloader.ffmpeg import is_available
                    if not is_available():
                        errors.append('ffmpeg_required')
                        return False
                path = await downloader.download(item, client=client)
                if not path and downloader.failure == 'hls':
                    from media_downloader.hls import download_hls
                    try:
                        path = await download_hls(item.url, Path(temporary) / 'video.mp4', public_request,
                                                  {**downloader.extra_headers, **(item.headers or {})}, request.get('quality', 'best'))
                    except RuntimeError as error:
                        downloader.failure = str(error)
                    except TimeoutError:
                        downloader.failure = 'timeout'
                    except httpx.HTTPError:
                        downloader.failure = 'network'
                if path:
                    # 同一文件系统内原子交付，不覆盖已有文件
                    try:
                        delivered = link_unique(path, output, delivered_name(request, path))
                    except OSError:
                        errors.append('disk')
                        return False
                    files.append(str(delivered))
                    saved += 1
                    emit('download-progress', saved=saved)
                    return True
                errors.append(downloader.failure)
                return False
            if kind == 'images':
                for index, url in enumerate(record.get('images') or [], 1):
                    await transfer(MediaItem(url=url, media_type=MediaType.IMAGE, content_id=record['id'], stem=f'{index:03d}'))
            else:
                from desktop.media_resolver import MediaResolver
                async def candidates():
                    if request.get('items'):
                        for item in request['items']:
                            yield item
                    elif (record.get('media') or {}).get('variants'):
                        from media_downloader.selection import choose_items
                        for item in choose_items(record, request.get('quality', 'best')):
                            yield item
                    else:
                        async for item in MediaResolver(record, page, request.get('runner'), emit).videos():
                            yield item
                # 只有要解析地址时才算一次打开详情
                resolving = not request.get('items') and not (record.get('media') or {}).get('variants')
                async with visit(record['platform'], 'detail', reporter(emit)) if resolving else nullcontext():
                    async for item in candidates():
                        if await transfer(item):
                            errors.clear()
                            break
    result = {'saved': saved, 'total': len(record.get('images') or []) if kind == 'images' else 1,
            'code': errors[-1] if errors else '' if saved else 'unsupported'}

    if request.get('report_files'):
        result['files'] = files
    return result
