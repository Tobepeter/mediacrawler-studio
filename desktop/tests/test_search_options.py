from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from desktop.search_options import OPTIONS, search_options
from desktop.crawler import DesktopCrawler


@pytest.mark.parametrize('platform', OPTIONS)
def test_every_advertised_option_is_supported(platform):
    search_options(platform)
    for key, field in OPTIONS[platform].items():
        for option in field['options']:
            search_options(platform, {key: option['value']})
    with pytest.raises(ValueError):
        search_options(platform, {'invented': 'value'})
    with pytest.raises(ValueError):
        search_options(platform, [])


def test_time_window_and_invalid_values(monkeypatch):
    monkeypatch.setattr('desktop.search_options.time.time', lambda: 2000000)
    options = search_options('bili', {'sort': 'pubdate', 'time': '7'})
    assert options['order'].value == 'pubdate'
    assert options['pubtime_begin_s'] == 2000000 - 7 * 86400
    assert options['pubtime_end_s'] == 2000000
    with pytest.raises(ValueError):
        search_options('dy', {'time': '30'})
    with pytest.raises(ValueError):
        search_options('tieba', {'type': '1'})  # 上游实际没有消费类型参数，不暴露


@pytest.mark.asyncio
@pytest.mark.parametrize('platform,filters,method,response,expected', [
    ('bili', {'sort': 'click'}, 'search_video_by_keyword', {}, {'order': 'click'}),
    ('dy', {'sort': '1', 'time': '7'}, 'search_info_by_keyword', {}, {'sort_type': 1, 'publish_time': 7}),
    ('xhs', {'sort': 'time_descending', 'type': '2'}, 'get_note_by_keyword', {}, {'sort': 'time_descending', 'note_type': 2}),
    ('zhihu', {'type': 'zvideo', 'time': 'a_week'}, 'get_note_by_keyword', [], {'note_type': 'zvideo', 'search_time': 'a_week'}),
    ('wb', {'type': '64'}, 'get_note_by_keyword', {}, {'search_type': '64'}),
    ('tieba', {'sort': '2'}, 'get_notes_by_keyword', [], {'sort': '2'}),
    ('ks', {}, 'search_info_by_keyword_v2', {'result': 1, 'feeds': []}, {}),
])
async def test_crawler_routes_filters_to_native_search(monkeypatch, platform, filters, method, response, expected):
    monkeypatch.setattr('desktop.extra_platforms.asyncio.sleep', AsyncMock())
    runner = DesktopCrawler({'platform': platform, 'limit': 5, 'mode': 'search', 'query': 'sample', 'action': 'collect', 'filters': filters},
                            SimpleNamespace(goto=AsyncMock()), lambda *a, **k: None)
    call = AsyncMock(return_value=response)
    runner.client = SimpleNamespace(**{method: call}, update_cookies=AsyncMock())
    runner.context = object()
    await runner.search()
    call.assert_awaited_once()
    for key, value in expected.items():
        assert call.call_args.kwargs[key].value == value
