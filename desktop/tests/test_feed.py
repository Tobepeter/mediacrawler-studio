import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from desktop import bili_paging, dy_paging, xhs_paging
from desktop.creators import load_feed
from desktop.paging import CreatorError, decode_cursor
from desktop.pacing import RULES
from desktop.result_store import ResultStore


def task(platform, **client):
    return SimpleNamespace(platform=platform, client=SimpleNamespace(**client))


async def test_bili_feed_keeps_only_videos_and_pages_by_number():
    get = AsyncMock(return_value={'item': [
        {'id': 1, 'bvid': 'BV1', 'goto': 'av', 'title': '<em>标题</em>', 'pic': '//i0.hdslb.com/a.jpg', 'owner': {'name': '作者'}, 'stat': {'like': 5}},
        {'id': 2, 'goto': 'live', 'title': '直播'},
        {'id': 0, 'bvid': '', 'goto': 'ad'},
    ]})
    page = await bili_paging.load_feed(task('bili', get_home_feed=get))
    assert [item['id'] for item in page['items']] == ['bili:1']
    item = page['items'][0]
    assert (item['title'], item['author'], item['likes'], item['feed']) == ('标题', '作者', '5', True)
    assert item['images'] == ['https://i0.hdslb.com/a.jpg']
    assert item['url'] == 'https://www.bilibili.com/video/BV1'
    following = decode_cursor(page['next_cursor'], 'bili-feed')
    await bili_paging.load_feed(task('bili', get_home_feed=get), page['next_cursor'])
    assert following['p'] == 2 and get.await_args.kwargs == {'page': 2}


async def test_dy_feed_skips_live_rooms_and_reports_end():
    rows = [
        {'aweme_id': '1', 'desc': '作品', 'author': {'nickname': '作者'}, 'statistics': {'digg_count': 7}, 'video': {'cover': {'url_list': ['https://p/a.jpg']}}},
        {'aweme_id': '2', 'cell_room': {'rawdata': '{}'}},
        {'aweme_id': '3', 'desc': '图集', 'images': [{}], 'video': {}},
    ]
    page = await dy_paging.load_feed(task('dy', get_home_feed=AsyncMock(return_value={'status_code': 0, 'aweme_list': rows, 'has_more': 0})))
    assert [item['id'] for item in page['items']] == ['dy:1', 'dy:3']
    assert [item['contentType'] for item in page['items']] == ['video', 'note']
    assert page['has_more'] is False and page['next_cursor'] is None


async def test_dy_feed_platform_error_is_structured():
    with pytest.raises(CreatorError) as error:
        await dy_paging.load_feed(task('dy', get_home_feed=AsyncMock(return_value={'status_code': 5})))
    assert error.value.code == 'PLATFORM_ERROR'


async def test_xhs_feed_keeps_token_for_later_detail():
    get = AsyncMock(return_value={'cursor_score': 'next', 'items': [
        {'id': 'n1', 'model_type': 'note', 'xsec_token': 'TOKEN', 'note_card': {'display_title': '笔记', 'type': 'video', 'user': {'nickname': '作者'}, 'interact_info': {'liked_count': '9'}, 'cover': {'url_default': 'http://sns/a.jpg'}}},
        {'id': 'q', 'model_type': 'rec_query'},
    ]})
    page = await xhs_paging.load_feed(task('xhs', get_home_feed=get))
    item = page['items'][0]
    assert len(page['items']) == 1
    assert item['url'] == 'https://www.xiaohongshu.com/explore/n1?xsec_token=TOKEN&xsec_source=pc_feed'
    assert item['images'] == ['https://sns/a.jpg']
    state = decode_cursor(page['next_cursor'], 'xhs-feed')
    assert (state['c'], state['i']) == ('next', 1)


async def test_xhs_feed_ends_without_cursor():
    page = await xhs_paging.load_feed(task('xhs', get_home_feed=AsyncMock(return_value={'items': []})))
    assert page == {'items': [], 'next_cursor': None, 'has_more': False}


async def test_unsupported_platform_rejected():
    with pytest.raises(CreatorError) as error:
        await load_feed(task('wb'))
    assert error.value.code == 'UNSUPPORTED_PLATFORM'


@pytest.mark.parametrize('platform', ['bili', 'dy', 'xhs', 'zhihu'])
def test_feed_has_its_own_slow_rule(platform):
    rule = RULES[(platform, 'get_home_feed')]
    assert rule.window_limit and rule.page_gap[0] >= 3


async def test_feed_detail_keeps_card_author(monkeypatch):
    from desktop import crawler as crawler_module
    from desktop.content import detail

    class Fake:
        def __init__(self, request, page, emit):
            self.store = SimpleNamespace(items={'bili:1': {'id': 'bili:1', 'author': '闲***阵', 'text': '正文'}})
            self.client, self.context = SimpleNamespace(update_cookies=AsyncMock()), object()
            self.setup, self.detail = AsyncMock(), AsyncMock()

    async def enrich(runner, record, quality='best'):
        record['media'] = {'status': 'available', 'variants': []}
    monkeypatch.setattr(crawler_module, 'DesktopCrawler', Fake)
    monkeypatch.setattr(detail, 'enrich', enrich)
    result = await detail.load_detail({'id': 'bili:1', 'platform': 'bili', 'url': 'u', 'author': '闲摆龙门阵', 'feed': True}, None)
    assert result['item']['author'] == '闲摆龙门阵'
    assert result['item']['text'] == '正文' and result['item']['feed'] is True


async def test_feed_detail_failure_keeps_card(monkeypatch):
    from desktop import crawler as crawler_module
    from desktop.content import detail

    class Fake:
        def __init__(self, request, page, emit):
            self.store = SimpleNamespace(items={})
            self.client, self.context = SimpleNamespace(update_cookies=AsyncMock()), object()
            self.setup, self.detail = AsyncMock(), AsyncMock()
    monkeypatch.setattr(crawler_module, 'DesktopCrawler', Fake)
    result = await detail.load_detail({'id': 'dy:1', 'platform': 'dy', 'url': 'u', 'title': '卡片', 'feed': True}, None)
    assert result['code'] == 'failed' and result['item']['title'] == '卡片'


def test_background_busy_is_reported_as_a_page(monkeypatch):
    from desktop.crawler import DesktopCrawler
    events = []
    crawler = DesktopCrawler.__new__(DesktopCrawler)
    crawler.request = {'action': 'feed'}
    crawler.emit = lambda kind, **data: events.append((kind, data))
    crawler.setup = AsyncMock()
    monkeypatch.setattr('desktop.creators.load_feed', AsyncMock(side_effect=CreatorError('FEED_BUSY', 'x')))
    asyncio.run(crawler.run())
    data = next(data for kind, data in events if kind == 'feed')
    assert data['items'] == [] and data['has_more'] is False and data['busy'] is True


def test_feed_errors_keep_their_message(monkeypatch):
    from desktop.crawler import DesktopCrawler
    crawler = DesktopCrawler.__new__(DesktopCrawler)
    crawler.request = {'action': 'feed'}
    crawler.emit = lambda kind, **data: None
    crawler.setup = AsyncMock()
    monkeypatch.setattr('desktop.creators.load_feed', AsyncMock(side_effect=CreatorError('PLATFORM_ERROR', '接口异常')))
    with pytest.raises(CreatorError, match='接口异常'):
        asyncio.run(crawler.run())


def test_names_are_kept_and_length_is_limited():
    from desktop.paging import AUTHOR_LIMIT, TITLE_LIMIT
    from desktop.result_store import normalize
    from tools import user_hash
    assert user_hash.mask_nickname('测试作者') == '测试作者'
    item = normalize({'aweme_id': '1', 'desc': '长' * 300, 'title': '长' * 300, 'nickname': '名' * 200}, 'dy')
    assert len(item['title']) == TITLE_LIMIT and len(item['text']) == 300
    assert item['text'].startswith(item['title'])
    assert len(item['author']) == AUTHOR_LIMIT
    record = bili_paging.feed_record('bili', '1', '长' * 300, '名' * 200, 'https://x', '', 0, 'video')
    assert len(record['title']) == TITLE_LIMIT and len(record['author']) == AUTHOR_LIMIT


def test_author_homepage_needs_identity_and_xhs_token():
    assert bili_paging.author_url({'mid': 42}) == 'https://space.bilibili.com/42'
    assert bili_paging.author_url({}) == ''
    assert dy_paging.author_url({'sec_uid': 'MS4'}) == 'https://www.douyin.com/user/MS4'
    assert dy_paging.author_url({'sec_uid': ''}) == ''
    # 小红书主页没有 token 拿不到笔记，宁可没有地址，由界面退回搜索
    assert xhs_paging.author_url({'user_id': 'u1', 'xsec_token': 'T='}, 'pc_note') == 'https://www.xiaohongshu.com/user/profile/u1?xsec_token=T=&xsec_source=pc_note'
    assert xhs_paging.author_url({'user_id': 'u1'}, 'pc_note') == ''


def test_feed_record_only_carries_author_url_when_known():
    assert 'authorUrl' not in bili_paging.feed_record('bili', '1', 't', 'a', 'https://x', '', 0, 'video')
    assert bili_paging.feed_record('bili', '1', 't', 'a', 'https://x', '', 0, 'video', 'https://space.bilibili.com/1')['authorUrl'] == 'https://space.bilibili.com/1'


@pytest.mark.asyncio
async def test_result_store_attaches_author_url():
    events = []
    store = ResultStore('bili', 5, lambda kind, **data: events.append(data))
    store.author_urls['bili:1'] = 'https://space.bilibili.com/9'
    await store.store_content({'video_id': '1', 'title': 'a', 'nickname': 'n'})
    await store.store_content({'video_id': '2', 'title': 'b', 'nickname': 'm'})
    assert events[0]['item']['authorUrl'] == 'https://space.bilibili.com/9'
    assert 'authorUrl' not in events[1]['item']


@pytest.mark.parametrize('code,busy', [('RATE_COOLDOWN', False), ('RATE_LIMITED', False), ('FEED_BUSY', True), ('SEARCH_VERIFICATION_REQUIRED', False)])
async def test_throttled_feed_is_a_result_not_a_failure(monkeypatch, code, busy):
    from desktop import crawler as crawler_module
    events = []
    monkeypatch.setattr('desktop.creators.load_feed', AsyncMock(side_effect=CreatorError(code, '等一下', retry_after=42)))
    runner = crawler_module.DesktopCrawler({'platform': 'bili', 'action': 'feed', 'mode': 'search', 'query': '', 'limit': 20}, None, lambda kind, **data: events.append((kind, data)))
    runner.setup = AsyncMock()
    await runner.run()
    data = next(data for kind, data in events if kind == 'feed')
    assert data['busy'] is busy and data['items'] == []
    assert data['throttled'] == {'code': code, 'retry_after': 42, 'message': '等一下'}
    assert 'error' not in [kind for kind, _ in events]
