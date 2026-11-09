from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from desktop import feature_check
from desktop.paging import CreatorError


def card(**fields):
    return {'title': 't', 'author': 'a', 'url': 'u', 'images': ['i'], 'authorUrl': 'https://space.bilibili.com/9', **fields}


def runner(platform='bili', **client):
    return SimpleNamespace(platform=platform, client=SimpleNamespace(**client), emit=lambda *a, **k: None)


def bili_client(search=20, posts=5):
    return dict(
        search_video_by_keyword=AsyncMock(return_value={'result': [{}] * search}),
        get_creator_videos=AsyncMock(return_value={'list': {'vlist': [{}] * posts}}),
    )


def by_id(results):
    return {item['id']: item for item in results}


@pytest.fixture
def feed(monkeypatch):
    def install(value):
        mock = AsyncMock(return_value={'items': value}) if isinstance(value, list) else AsyncMock(side_effect=value)
        monkeypatch.setattr(feature_check, 'load_feed', mock)
        return mock
    return install


async def test_all_healthy_requests_each_endpoint_once(feed):
    feed([card()] * 18)
    run = runner(**bili_client())
    results = by_id(await feature_check.run_checks(run))
    assert [results[name]['status'] for name in ('feed', 'creator', 'search')] == ['ok', 'ok', 'ok']
    run.client.get_creator_videos.assert_awaited_once_with('9', 1)
    run.client.search_video_by_keyword.assert_awaited_once()


async def test_low_count_is_degraded(feed):
    feed([card()] * 3)
    results = by_id(await feature_check.run_checks(runner(**bili_client())))
    assert results['feed']['status'] == 'degraded' and results['feed']['count'] == 3


async def test_missing_card_field_is_degraded(feed):
    feed([card(images=[])] * 18)
    assert by_id(await feature_check.run_checks(runner(**bili_client())))['feed']['missing'] == ['images']


async def test_zhihu_answers_may_have_no_images():
    assert feature_check.missing_fields('zhihu', [card(images=[])] * 6) == []


async def test_one_broken_endpoint_does_not_stop_others(feed):
    feed([card()] * 18)
    client = bili_client()
    client['get_creator_videos'] = AsyncMock(side_effect=ValueError('boom'))
    results = by_id(await feature_check.run_checks(runner(**client)))
    assert results['creator']['status'] == 'failed' and results['search']['status'] == 'ok'


async def test_verification_stops_remaining_requests(feed):
    feed(CreatorError('SEARCH_VERIFICATION_REQUIRED', '要求验证'))
    run = runner(**bili_client())
    results = by_id(await feature_check.run_checks(run))
    assert {item['status'] for item in results.values()} == {'skipped'}
    run.client.get_creator_videos.assert_not_awaited()
    run.client.search_video_by_keyword.assert_not_awaited()


async def test_empty_feed_fails_and_skips_creator(feed):
    feed([])
    results = by_id(await feature_check.run_checks(runner(**bili_client())))
    assert results['feed']['status'] == 'failed' and results['creator']['status'] == 'skipped'


def full_runner(platform='bili', **client):
    store = SimpleNamespace(items={'bili:1': {'id': 'bili:1', 'text': '正文', 'images': ['https://i/a.jpg']}})
    run = runner(platform, update_cookies=AsyncMock(), **client)
    run.store, run.context, run.page, run.request = store, object(), object(), {}
    run.detail = AsyncMock()
    return run


async def test_detail_and_download_probe_only_sample(feed, monkeypatch):
    feed([card(id='bili:1', contentType='video')] * 18)
    probe = AsyncMock()
    monkeypatch.setattr(feature_check, 'probe_media', probe)
    monkeypatch.setattr(feature_check, 'media_source', AsyncMock(return_value=(['https://cdn/v.mp4'], {'Referer': 'r'})))
    run = full_runner(**bili_client())
    results = by_id(await feature_check.run_checks(run))
    assert results['detail']['status'] == results['download']['status'] == 'ok'
    assert 'count' not in results['detail']
    run.detail.assert_awaited_once()
    probe.assert_awaited_once_with('https://cdn/v.mp4', {'Referer': 'r'}, 'bili')


async def test_media_error_reports_reason_and_continues(feed, monkeypatch):
    feed([card(id='bili:1', contentType='video')] * 18)
    monkeypatch.setattr(feature_check, 'media_source', AsyncMock(return_value=(['https://cdn/v.mp4'], {})))
    monkeypatch.setattr(feature_check, 'probe_media', AsyncMock(side_effect=CreatorError('MEDIA_UNAVAILABLE', '媒体地址访问失败（HTTP 403）')))
    results = by_id(await feature_check.run_checks(full_runner(**bili_client())))
    assert results['download'] == {'id': 'download', 'status': 'failed', 'message': '媒体地址访问失败（HTTP 403）'}
    assert results['search']['status'] == 'ok'


async def test_missing_detail_skips_download(feed):
    feed([card(id='bili:2', contentType='video')] * 18)
    results = by_id(await feature_check.run_checks(full_runner(**bili_client())))
    assert results['detail']['status'] == 'failed' and results['download']['status'] == 'skipped'


async def test_probe_requests_two_bytes_with_referer(monkeypatch):
    import httpx
    seen = {}

    def handler(request):
        seen.update(request.headers)
        return httpx.Response(206, headers={'content-type': 'video/mp4'}, content=b'ab')

    original = httpx.AsyncClient

    def client(**options):
        options.pop('event_hooks')
        return original(transport=httpx.MockTransport(handler), **options)

    monkeypatch.setattr(feature_check.httpx, 'AsyncClient', client)
    await feature_check.probe_media('https://cdn/v.mp4', {}, 'bili')
    assert seen['range'] == 'bytes=0-1' and 'bilibili' in seen['referer']
    assert 'httpx' not in seen['user-agent']


async def test_probe_rejects_html_response(monkeypatch):
    import httpx
    original = httpx.AsyncClient

    def client(**options):
        options.pop('event_hooks')
        return original(transport=httpx.MockTransport(lambda request: httpx.Response(200, headers={'content-type': 'text/html'})), **options)

    monkeypatch.setattr(feature_check.httpx, 'AsyncClient', client)
    with pytest.raises(CreatorError):
        await feature_check.probe_media('https://cdn/v.mp4', {}, 'bili')


def test_sample_prefers_video_and_zhihu_prefers_images():
    items = [card(contentType='note', id='a'), card(contentType='video', id='b')]
    assert feature_check.pick_sample('dy', items)['id'] == 'b'
    assert feature_check.pick_sample('zhihu', [card(images=[], id='x'), card(id='y')])['id'] == 'y'
    assert feature_check.pick_sample('dy', []) is None


async def test_download_falls_back_to_backup_url(monkeypatch):
    probe = AsyncMock(side_effect=[RuntimeError('unsupported'), None])
    monkeypatch.setattr(feature_check, 'probe_media', probe)
    monkeypatch.setattr(feature_check, 'media_source', AsyncMock(return_value=(['https://a:8082/v', 'https://b/v'], {})))
    assert await feature_check.download_rows(SimpleNamespace(platform='bili'), {}) == ['https://b/v']


async def test_all_download_lines_failing_is_reported(monkeypatch):
    monkeypatch.setattr(feature_check, 'probe_media', AsyncMock(side_effect=RuntimeError('unsupported')))
    monkeypatch.setattr(feature_check, 'media_source', AsyncMock(return_value=(['https://a/v'], {})))
    with pytest.raises(CreatorError):
        await feature_check.download_rows(SimpleNamespace(platform='bili'), {})
