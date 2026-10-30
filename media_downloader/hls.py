"""点播 HLS：由受校验的 HTTP 客户端取资源，FFmpeg 只读取本地文件"""
import asyncio
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
import m3u8
from media_downloader.ffmpeg import ffmpeg_path


async def download_hls(url, output, validate, headers=None, quality='best', timeout=900):
    executable = ffmpeg_path()
    if not executable:
        raise RuntimeError('ffmpeg_required')
    directory = Path(output).parent / 'hls'
    directory.mkdir(exist_ok=True)
    cache = {}
    counter = 0
    async with asyncio.timeout(timeout):
        async with httpx.AsyncClient(follow_redirects=True, timeout=30, headers=headers,
                                    event_hooks={'request': [validate]}) as client:
            async def resource(address):
                nonlocal counter
                if address in cache:
                    return cache[address]
                counter += 1
                if counter > 10000:
                    raise RuntimeError('hls_unsupported')
                suffix = Path(urlparse(address).path).suffix.lower()
                if suffix not in ('.ts', '.m4s', '.mp4', '.aac', '.mp3', '.vtt'):
                    suffix = '.ts'
                target = directory / f'resource-{counter}{suffix}'
                async with client.stream('GET', address) as response:
                    response.raise_for_status()
                    with target.open('wb') as stream:
                        async for chunk in response.aiter_bytes():
                            stream.write(chunk)
                cache[address] = target.name
                return target.name

            async def playlist(address, depth=0):
                if depth > 4:
                    raise RuntimeError('hls_unsupported')
                async with client.stream('GET', address) as response:
                    response.raise_for_status()
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 2 * 1024 * 1024:
                            raise RuntimeError('hls_unsupported')
                    base = str(response.url)
                text = body.decode('utf-8-sig')
                if not text.lstrip().startswith('#EXTM3U'):
                    raise RuntimeError('hls_unsupported')
                manifest = m3u8.loads(text)
                if any(key and (key.method != 'NONE' or key.uri) for key in manifest.keys) or manifest.session_keys:
                    raise RuntimeError('hls_unsupported')
                if manifest.is_variant:
                    choices = list(manifest.playlists)
                    if not choices:
                        raise RuntimeError('hls_unsupported')
                    if quality not in ('best', 'worst'):
                        choices = [p for p in choices if p.stream_info.resolution and min(p.stream_info.resolution) == int(quality.rstrip('p'))]
                        if not choices:
                            raise RuntimeError('quality_unavailable')
                    choose = min if quality == 'worst' else max
                    chosen = choose(choices, key=lambda p: p.stream_info.bandwidth or 0)
                    chosen.uri = await playlist(urljoin(base, chosen.uri), depth + 1)
                    manifest.playlists[:] = [chosen]
                    tracks = [m for m in manifest.media if m.type == 'AUDIO' and m.group_id == chosen.stream_info.audio]
                    manifest.media[:] = []
                    if tracks:
                        track = next((m for m in tracks if m.default == 'YES'), tracks[0])
                        if track.uri:
                            track.uri = await playlist(urljoin(base, track.uri), depth + 1)
                        manifest.media.append(track)
                    chosen.stream_info.subtitles = None
                    chosen.stream_info.closed_captions = None
                    manifest.iframe_playlists[:] = []
                else:
                    if not manifest.is_endlist or not manifest.segments:
                        raise RuntimeError('hls_unsupported')
                    for segment in manifest.segments:
                        segment.uri = await resource(urljoin(base, segment.uri))
                        if segment.init_section:
                            original = segment.init_section.uri
                            # m3u8 可能让多个片段共享同一个初始化对象
                            if original not in cache.values():
                                segment.init_section.uri = await resource(urljoin(base, original))
                target = directory / f'playlist-{len(list(directory.glob("*.m3u8")))}.m3u8'
                target.write_text(manifest.dumps(), encoding='utf-8')
                return target.name

            local = directory / await playlist(url)
        process = await asyncio.create_subprocess_exec(executable, '-nostdin', '-hide_banner', '-loglevel', 'error',
            '-protocol_whitelist', 'file', '-allowed_extensions', 'ALL', '-i', str(local),
            '-map', '0:v?', '-map', '0:a?', '-c', 'copy', '-y', str(output),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        try:
            await process.wait()
            if process.returncode or not Path(output).exists() or not Path(output).stat().st_size:
                raise RuntimeError('hls_failed')
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
    return Path(output)
