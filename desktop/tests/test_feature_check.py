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
