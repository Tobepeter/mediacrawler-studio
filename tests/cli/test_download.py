import asyncio
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest
from typer.testing import CliRunner

from mediacrawler_cli.__main__ import app
from mediacrawler_cli.download import download_records
from media_downloader.selection import choose_items
from media_downloader import hls


def test_command_modes(monkeypatch, tmp_path):
    import mediacrawler_cli.__main__ as cli
    calls = []
    monkeypatch.setattr(cli, 'run', calls.append)
    runner = CliRunner()
    assert runner.invoke(app, ['download', '--source', 'https://www.bilibili.com/video/BV123', '--quality', 'worst']).exit_code == 0
    assert calls[-1]['platform'] == 'bili' and calls[-1]['quality'] == 'worst'
    assert runner.invoke(app, ['download', '--media-url', 'https://cdn.example/a.mp4']).exit_code == 0
    assert calls[-1]['platform'] == 'direct'
    assert runner.invoke(app, ['download', '--source', 'bad']).exit_code == 2
    assert runner.invoke(app, ['download', '--source', 'https://bilibili.com/a', '--media-url', 'https://cdn.example/a']).exit_code == 2
    assert runner.invoke(app, ['download', '--input', '-'], input='not json').exit_code == 2
    assert runner.invoke(app, ['download', '--help']).exit_code == 0


def test_supplied_variant():
    record = {'id': 'bili:1', 'media': {'variants': [
        {'id': 'v', 'kind': 'video', 'url': 'https://cdn.example/v', 'height': 720, 'width': 1280, 'hasAudio': False},
        {'id': 'a', 'kind': 'audio', 'url': 'https://cdn.example/a', 'bitrate': 100}]}}
    item = choose_items(record, variant_id='v')[0]
    assert item.audio_url.endswith('/a')
    with pytest.raises(RuntimeError, match='quality_unavailable'):
        choose_items(record, '1080p')


@pytest.mark.asyncio
async def test_direct_download_reuses_service_without_browser(tmp_path, monkeypatch):
    from desktop import media_download
    original = httpx.AsyncClient
    monkeypatch.setattr(media_download, 'public_request', AsyncMock())
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(
        lambda req: httpx.Response(200, headers={'content-type': 'video/mp4'}, content=b'video')), **kw))
    record = {'id': 'direct', 'platform': 'direct', 'contentType': 'video', 'media': {'variants': [
        {'id': 'v', 'kind': 'video', 'url': 'https://cdn.example/a.mp4', 'height': None, 'hasAudio': True}]}}
    result = await download_records({'download_dir': str(tmp_path)}, [record], lambda *a, **k: None)
    assert result[0]['saved'] == 1 and Path(result[0]['files'][0]).read_bytes() == b'video'
    assert not list(tmp_path.rglob('.working-*'))


@pytest.mark.asyncio
async def test_hls_missing_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(hls, 'ffmpeg_path', lambda: None)
    with pytest.raises(RuntimeError, match='ffmpeg_required'):
        await hls.download_hls('https://cdn.example/a', tmp_path / 'v.mp4', AsyncMock())


@pytest.mark.asyncio
@pytest.mark.parametrize('body', ['#EXTM3U\n#EXTINF:1,\na.ts\n', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST'])
async def test_hls_reject_live_and_encrypted(tmp_path, monkeypatch, body):
    original = httpx.AsyncClient
    monkeypatch.setattr(hls, 'ffmpeg_path', lambda: '/fake/ffmpeg')
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(lambda req: httpx.Response(200, text=body)), **kw))
    with pytest.raises(RuntimeError, match='hls_unsupported'):
        await hls.download_hls('https://cdn.example/a.m3u8', tmp_path / 'v.mp4', AsyncMock())


@pytest.mark.asyncio
async def test_real_hls_merge(tmp_path, monkeypatch):
    import subprocess
    if not hls.ffmpeg_path():
        pytest.skip('FFmpeg not installed')
    fixture = tmp_path / 'fixture'
    fixture.mkdir()
    subprocess.run([hls.ffmpeg_path(), '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
                    'color=c=blue:s=160x90:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
                    '-c:v', 'libx264', '-c:a', 'aac', '-f', 'hls', '-hls_time', '1', str(fixture / 'index.m3u8')], check=True)
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(
        lambda req: httpx.Response(200, content=(fixture / req.url.path.lstrip('/')).read_bytes())), **kw))
    validate = AsyncMock()
    output = await hls.download_hls('https://cdn.example/index.m3u8', tmp_path / 'v.mp4', validate)
    assert output.stat().st_size > 1000
    assert validate.await_count >= 2


@pytest.mark.asyncio
async def test_hls_master_selects_quality_and_rewrites_audio(tmp_path, monkeypatch):
    bodies = {
        '/master.m3u8': '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="main",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=640x360,AUDIO="a"\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=500,RESOLUTION=1920x1080,AUDIO="a"\nhigh.m3u8\n',
        '/low.m3u8': '#EXTM3U\n#EXTINF:1,\nlow.ts\n#EXT-X-ENDLIST\n',
        '/audio.m3u8': '#EXTM3U\n#EXTINF:1,\naudio.aac\n#EXT-X-ENDLIST\n',
        '/low.ts': 'video', '/audio.aac': 'audio',
    }
    requested = []
    def handle(req):
        requested.append(req.url.path)
        return httpx.Response(200, text=bodies[req.url.path])
    original = httpx.AsyncClient
    monkeypatch.setattr(hls, 'ffmpeg_path', lambda: '/fake/ffmpeg')
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(handle), **kw))
    async def spawn(*args, **kwargs):
        from types import SimpleNamespace
        Path(args[-1]).write_bytes(b'output')
        return SimpleNamespace(wait=AsyncMock(), returncode=0)
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', spawn)
    await hls.download_hls('https://cdn.example/master.m3u8', tmp_path / 'v.mp4', AsyncMock(), quality='worst')
    assert '/low.ts' in requested and '/audio.aac' in requested and '/high.m3u8' not in requested
    assert all('https://' not in p.read_text() for p in (tmp_path / 'hls').glob('*.m3u8'))


@pytest.mark.asyncio
async def test_hls_timeout_kills_ffmpeg(tmp_path, monkeypatch):
    original = httpx.AsyncClient
    monkeypatch.setattr(hls, 'ffmpeg_path', lambda: '/fake/ffmpeg')
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: original(transport=httpx.MockTransport(
        lambda req: httpx.Response(200, text='#EXTM3U\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST' if req.url.path.endswith('m3u8') else 'data')), **kw))
    class Process:
        returncode = None
        killed = False
        async def wait(self):
            if not self.killed:
                await asyncio.Event().wait()
        def kill(self):
            self.killed = True
            self.returncode = -9
    process = Process()
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', AsyncMock(return_value=process))
    with pytest.raises(TimeoutError):
        await hls.download_hls('https://cdn.example/a.m3u8', tmp_path / 'v.mp4', AsyncMock(), timeout=0.05)
    assert process.killed
