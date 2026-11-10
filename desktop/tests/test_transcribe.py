import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from typer.testing import CliRunner

from desktop import transcribe
from desktop.paging import CreatorError
from desktop.transcribe import SttError

READY = {'service': 'stt', 'state': 'idle', 'busy': False}
DONE = {'text': ' 你好 ', 'model': 'qwen', 'segments': [{'start': 0, 'end': 1.5, 'text': '你好', 'extra': 1}]}


@pytest.fixture
def stt(monkeypatch):
    server = SimpleNamespace(status=(200, READY), reply=(200, DONE), posted=[], offline=False)

    def handle(request):
        if server.offline:
            raise httpx.ConnectError('refused')
        if request.url.path == '/v1/status':
            code, body = server.status
        else:
            server.posted.append(json.loads(request.content))
            code, body = server.reply
        return httpx.Response(code, json=body)
    monkeypatch.setattr(transcribe, 'client', lambda timeout: httpx.AsyncClient(base_url=transcribe.BASE_URL, transport=httpx.MockTransport(handle)))
    monkeypatch.setattr(transcribe, 'command', lambda: None)
    return server


async def test_check_reports_ready(stt):
    assert await transcribe.check() == {'state': 'ready', 'busy': False}


async def test_check_without_service_or_command_is_missing(stt):
    stt.offline = True
    assert (await transcribe.check())['state'] == 'missing'


async def test_check_with_command_is_installed(stt, monkeypatch):
    stt.offline = True
    monkeypatch.setattr(transcribe, 'command', lambda: '/bin/stt')
    assert (await transcribe.check())['state'] == 'installed'


async def test_another_service_on_the_port_does_not_count(stt):
    stt.status = (200, {'service': 'other'})
    assert await transcribe.status() is None


async def test_missing_service_is_reported(stt):
    stt.offline = True
    with pytest.raises(SttError) as caught:
        await transcribe.ensure_service()
    assert caught.value.code == 'stt_unavailable'


async def test_sleeping_service_is_woken(stt, monkeypatch):
    stt.offline = True
    monkeypatch.setattr(transcribe, 'command', lambda: '/bin/stt')

    async def spawn(*args, **kwargs):
        assert args == ('/bin/stt', 'warmup')
        stt.offline = False
        return SimpleNamespace(wait=AsyncMock(return_value=0))
    monkeypatch.setattr(transcribe.asyncio, 'create_subprocess_exec', spawn)
    await transcribe.ensure_service()


async def test_transcribe_file_posts_absolute_path_and_normalizes(stt, tmp_path):
    source = tmp_path / 'a.mp4'
    source.write_bytes(b'x')
    result = await transcribe.transcribe_file(source)
    assert stt.posted == [{'audio': str(source.resolve())}]
    assert result['source'] == 'stt' and result['text'] == '你好' and result['model'] == 'qwen'
    assert result['segments'] == [{'start': 0, 'end': 1.5, 'text': '你好'}]


async def test_busy_returns_wait_time_without_queueing(stt):
    stt.reply = (503, {'error': 'busy', 'retry_after_seconds': 12.2})
    with pytest.raises(SttError) as caught:
        await transcribe.transcribe_file('a.mp4')
    assert caught.value.code == 'stt_busy' and caught.value.retry_after == 13 and len(stt.posted) == 1


@pytest.mark.parametrize('reply,code', [((200, {'text': '  '}), 'no_speech'), ((400, {'error': '格式不支持'}), 'stt_failed'), ((500, ['x']), 'stt_failed')])
async def test_failures_are_structured(stt, reply, code):
    stt.reply = reply
    with pytest.raises(SttError) as caught:
        await transcribe.transcribe_file('a.mp4')
    assert caught.value.code == code


SEGMENTS = [{'start': 0, 'end': 1, 'text': '第一句'}, {'start': 1, 'end': 2, 'text': '第二句'}]


def test_platform_subtitle_prefers_chinese():
    record = {'subtitles': {'items': [{'language': 'en', 'segments': [{'start': 0, 'end': 1, 'text': 'hi'}]}, {'language': 'ai-zh', 'segments': SEGMENTS}]}}
    result = transcribe.platform_subtitle(record)
    assert result['source'] == 'subtitle' and result['language'] == 'ai-zh' and result['text'] == '第一句\n第二句'


@pytest.mark.parametrize('record', [{}, {'subtitles': {'status': 'not_requested', 'items': []}}, {'subtitles': {'items': [{'language': 'zh', 'segments': []}]}}])
def test_no_platform_subtitle(record):
    assert transcribe.platform_subtitle(record) is None


async def test_platform_subtitle_skips_download_and_stt(stt, monkeypatch):
    download = AsyncMock()
    monkeypatch.setattr('desktop.media_download.download_record', download)
    result = await transcribe.transcribe_record({'record': {'id': 'dy:1', 'subtitles': {'items': [{'language': 'zh', 'segments': SEGMENTS}]}}}, None)
    assert result['source'] == 'subtitle'
    download.assert_not_awaited()
    assert stt.posted == []


async def test_record_downloads_lowest_quality_then_cleans_up(stt, monkeypatch):
    seen = {}

    async def download(request, emit, page):
        seen.update(request)
        path = Path(request['directory']) / 'video.mp4'
        path.write_bytes(b'x')
        return {'saved': 1, 'files': [str(path)]}
    monkeypatch.setattr('desktop.media_download.download_record', download)
    result = await transcribe.transcribe_record({'record': {'id': 'dy:1'}}, None)
    assert result['source'] == 'stt' and seen['quality'] == 'worst' and seen['kind'] == 'video'
    assert stt.posted[0]['audio'].endswith('video.mp4') and not Path(seen['directory']).exists()


async def test_service_is_checked_before_downloading(stt, monkeypatch):
    stt.offline = True
    download = AsyncMock()
    monkeypatch.setattr('desktop.media_download.download_record', download)
    result = await transcribe.transcribe_result({'record': {'id': 'dy:1'}}, None)
    assert result['code'] == 'stt_unavailable' and result['saved'] == 0
    download.assert_not_awaited()


async def test_failed_download_is_reported(stt, monkeypatch):
    monkeypatch.setattr('desktop.media_download.download_record', AsyncMock(return_value={'saved': 0, 'files': [], 'code': 'expired'}))
    result = await transcribe.transcribe_result({'record': {'id': 'dy:1'}}, None)
    assert result['code'] == 'expired' and 'transcript' not in result


async def test_throttle_errors_pass_through(stt, monkeypatch):
    monkeypatch.setattr('desktop.media_download.download_record', AsyncMock(side_effect=CreatorError('RATE_LIMITED', '太频繁')))
    with pytest.raises(CreatorError):
        await transcribe.transcribe_result({'record': {'id': 'dy:1'}}, None)


def cli(*args):
    from mediacrawler_cli.__main__ import app
    return CliRunner().invoke(app, ['transcribe', *args])


def test_cli_needs_exactly_one_input():
    assert cli().exit_code == 2
    assert cli('--file', 'a', '--source', 'b').exit_code == 2


def test_cli_rejects_missing_file(tmp_path):
    assert cli('--file', str(tmp_path / 'none.mp4')).exit_code == 2


def test_cli_check_reports_state(monkeypatch):
    monkeypatch.setattr(transcribe, 'check', AsyncMock(return_value={'state': 'missing', 'busy': False}))
    result = cli('--check')
    assert result.exit_code == 1 and json.loads(result.stdout)['state'] == 'missing'


def test_cli_transcribes_local_file(tmp_path, monkeypatch):
    source = tmp_path / 'a.mp4'
    source.write_bytes(b'x')
    monkeypatch.setattr(transcribe, 'transcribe_file', AsyncMock(return_value={'source': 'stt', 'text': '你好', 'segments': []}))
    result = cli('--file', str(source))
    assert result.exit_code == 0 and json.loads(result.stdout)['text'] == '你好'


def test_cli_reports_busy_with_retry(tmp_path, monkeypatch):
    source = tmp_path / 'a.mp4'
    source.write_bytes(b'x')
    monkeypatch.setattr(transcribe, 'transcribe_file', AsyncMock(side_effect=SttError('stt_busy', '正忙', 9)))
    assert cli('--file', str(source)).exit_code == 1


async def test_download_pipeline_switches_to_transcribe(monkeypatch):
    from mediacrawler_cli import download
    monkeypatch.setattr(transcribe, 'transcribe_result', AsyncMock(return_value={'saved': 1, 'files': [], 'code': '', 'transcript': {'text': 'x'}}))
    events = []
    results = await download.download_records({'transcribe': True}, [{'id': 'dy:1'}], lambda kind, **data: events.append(kind))
    assert results[0]['id'] == 'dy:1' and results[0]['transcript'] == {'text': 'x'} and events == ['item']


def variant(id, label, bitrate):
    return {'id': id, 'kind': 'video', 'label': label, 'bitrate': bitrate, 'height': 540, 'url': f'https://cdn/{id}', 'hasAudio': True}


def test_lower_bitrate_duplicate_is_dropped():
    from media_downloader.selection import without_silent_duplicates
    kept = without_silent_duplicates([variant('a', '540_3_1', 100), variant('b', '540_3_1', 150), variant('c', 'lower_540', 90), {'id': 'd', 'kind': 'audio', 'bitrate': 1}])
    assert [v['id'] for v in kept] == ['b', 'c', 'd']


def test_short_video_variants_are_untouched():
    from media_downloader.selection import without_silent_duplicates
    variants = [variant('a', 'low', 100), variant('b', 'high', 200)]
    assert without_silent_duplicates(variants) == variants


async def test_old_douyin_records_skip_silent_versions(stt, monkeypatch):
    seen = {}

    async def download(request, emit, page):
        seen.update(request)
        path = Path(request['directory']) / 'video.mp4'
        path.write_bytes(b'x')
        return {'saved': 1, 'files': [str(path)]}
    monkeypatch.setattr('desktop.media_download.download_record', download)
    record = {'id': 'dy:1', 'platform': 'dy', 'media': {'variants': [variant('a', 'x', 100), variant('b', 'x', 150)]}}
    await transcribe.transcribe_record({'record': record}, None)
    assert [v['id'] for v in seen['record']['media']['variants']] == ['b']


async def test_video_without_audio_has_its_own_code(stt):
    stt.reply = (500, {'error': '音频解码失败：Output file does not contain any stream'})
    with pytest.raises(SttError) as caught:
        await transcribe.transcribe_file('a.mp4')
    assert caught.value.code == 'no_audio'


async def test_enrich_reports_throttling_instead_of_failed(monkeypatch, tmp_path):
    from desktop.content import media
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    monkeypatch.setattr(media, 'fetch', AsyncMock(side_effect=CreatorError('RATE_COOLDOWN', '冷却中', retry_after=60)))
    with pytest.raises(CreatorError):
        await media.enrich(SimpleNamespace(platform='dy', request={}, emit=None), {'id': 'dy:1', 'platform': 'dy', 'url': 'https://www.douyin.com/video/1'})


async def test_cli_download_keeps_throttle_errors(monkeypatch):
    from mediacrawler_cli import download
    monkeypatch.setattr(download, 'download_record', AsyncMock(side_effect=CreatorError('RATE_COOLDOWN', '冷却中', retry_after=60)))
    with pytest.raises(CreatorError):
        await download.download_records({'download_dir': '/tmp/x'}, [{'id': 'dy:1'}], lambda *a, **k: None)

