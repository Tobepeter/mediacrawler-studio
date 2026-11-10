import asyncio
from types import SimpleNamespace

from typer.testing import CliRunner
from mediacrawler_cli.__main__ import app
from mediacrawler_cli.media import variants, selection, enrich
from mediacrawler_cli.results import CLIResultStore


def test_bili_tracks_selection_and_expiry():
    candidates = variants('bili', {'dash': {'video': [
        {'baseUrl': 'https://cdn.example/1080?deadline=123', 'height': 1080, 'width': 1920},
        {'base_url': 'https://cdn.example/360', 'height': 360, 'width': 640},
    ], 'audio': [{'baseUrl': 'https://cdn.example/audio', 'bandwidth': 64000}]}})
    assert len(candidates) == 3
    assert selection(candidates, 'worst')['videoId'] == 'video-2'
    assert selection(candidates, 'best')['requiresMux']
    assert selection(candidates, '720p')['status'] == 'unavailable'
    assert candidates[0]['expiresAtUnix'] == 123
    assert candidates[2]['kind'] == 'audio'


def test_all_platform_candidates_and_unknown_quality():
    samples = {
        'dy': {'video': {'bit_rate': [{'bit_rate': 50, 'play_addr': {'url_list': ['https://cdn.example/a'], 'width': 720, 'height': 1280}}]}},
        'xhs': {'video': {'media': {'stream': {'EF7': [{'master_url': 'https://cdn.example/a', 'height': 720}]}}}},
        'ks': {'photo': {'videoResource': {'h264': {'adaptationSet': [{'representation': [{'url': 'https://cdn.example/a', 'height': 720}]}]}}}},
        'wb': {'page_info': {'type': 'video', 'media_info': {'mp4_720p_mp4': 'https://cdn.example/a'}}},
        'zhihu': {'video': {'playlist': {'hd': {'play_url': 'https://cdn.example/a'}}}},
        'tieba': {'thread': {'video': {'video_url': 'https://cdn.example/a'}}},
    }
    for platform, raw in samples.items():
        candidates = variants(platform, raw)
        assert len(candidates) == 1
        assert candidates[0]['hasAudio'] is True
        assert candidates[0]['expiresAtUnix'] is None
        assert selection(candidates, '720p')['status'] == ('quality_unknown' if platform in ('zhihu', 'tieba') else 'selected')


def test_unknown_dimensions_do_not_claim_lowest_and_missing_audio():
    candidates = variants('bili', {'dash': {'video': [{'baseUrl': 'https://cdn.example/a'}]}})
    assert selection(candidates, 'worst')['videoId'] is None
    candidates[0]['height'] = 720
    assert selection(candidates, 'best')['status'] == 'audio_unavailable'


def test_enrichment_failure_keeps_content_and_hides_exception(monkeypatch):
    import desktop.content.media as media
    async def fail(*args):
        raise RuntimeError('Cookie=secret')
    monkeypatch.setattr(media, 'fetch', fail)
    record = {'text': 'retained'}
    asyncio.run(enrich(SimpleNamespace(platform='bili', request={}, emit=None), record, 'best'))
    assert record['text'] == 'retained'
    assert record['media']['status'] == 'failed'
    assert 'secret' not in str(record)


def test_store_preserves_metadata_zero_and_source_opt_in():
    raw = {'video_id': '1', 'title': 'title', 'create_time': 1700000000,
           'video_play_count': '12', 'video_comment': '0', 'cookie': 'secret', 'nickname': 'a***b'}
    store = CLIResultStore('bili', 1, lambda *args, **kwargs: None, include_source=True)
    asyncio.run(store.store_content(raw))
    record = store.items['bili:1']
    assert record['statistics']['comments'] == 0
    assert record['statistics']['views'] == 12
    assert record['publishedAt'].startswith('2023-')
    assert 'cookie' not in record['source']
    assert record['author'] == 'a***b'
    normal = CLIResultStore('bili', 1, lambda *args, **kwargs: None)
    asyncio.run(normal.store_content(raw))
    assert 'source' not in normal.items['bili:1']


def test_cli_options_help_and_invalid_quality(monkeypatch):
    import mediacrawler_cli.__main__ as cli
    captured = []
    monkeypatch.setattr(cli, 'run', captured.append)
    runner = CliRunner()
    result = runner.invoke(app, ['collect', '--platform', 'bili', '--query', 'x', '--quality', 'worst', '--include-source', '-v'])
    assert result.exit_code == 0, result.output
    assert captured[0]['quality'] == 'worst' and captured[0]['verbose'] and captured[0]['include_source']
    assert captured[0]['media'] is True
    import json
    json.dumps(captured[0])
    assert runner.invoke(app, ['collect', '--platform', 'bili', '--query', 'x', '--quality', 'garbage']).exit_code == 2
    for command in ([], ['collect'], ['auth'], ['auth', 'login'], ['clean']):
        assert runner.invoke(app, [*command, '--help']).exit_code == 0


def test_xhs_http_candidates_can_roundtrip_into_download():
    from media_downloader.selection import validate_record, choose_items
    candidates = variants('xhs', {'video': {'media': {'stream': {'h264': [{
        'master_url': 'http://cdn.example/video', 'backup_urls': ['http://backup.example/video'],
        'width': 720, 'height': 1280,
    }]}}}})
    assert candidates[0]['url'] == 'https://cdn.example/video'
    assert candidates[0]['backupUrls'] == ['https://backup.example/video']
    record = {'id': 'xhs:1', 'media': {'variants': candidates}}
    validate_record(record)
    assert choose_items(record)[0].url.startswith('https://')
    # 历史导出中的 HTTP 地址同样由共享下载层升级为 HTTPS
    candidates[0]['url'] = 'http://cdn.example/video'
    validate_record(record)
    candidates[0]['url'] = 'file:///tmp/video'
    import pytest
    with pytest.raises(ValueError):
        validate_record(record)
