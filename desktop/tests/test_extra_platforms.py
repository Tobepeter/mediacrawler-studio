from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
import config
from desktop.crawler import DesktopCrawler
from desktop.extra_platforms import ExtraCollector
from desktop.native_platforms import create_native, PLATFORMS
from desktop.result_store import normalize
from desktop.account import profile_info
from model.m_zhihu import ZhihuContent
from model.m_baidu_tieba import TiebaNote


def runner(platform, limit=2):
    return DesktopCrawler({'platform': platform, 'action': 'collect', 'mode': 'search', 'query': '测试', 'limit': limit}, None, lambda *args, **kwargs: None)


@pytest.mark.parametrize('platform', PLATFORMS)
def test_native_registry(platform):
    task = runner(platform)
    crawler, method, attr = create_native(platform, task.store)
    assert callable(getattr(crawler, method))
    assert attr.endswith('_client')


@pytest.mark.asyncio
@pytest.mark.parametrize('platform', ['zhihu', 'wb', 'tieba', 'ks'])
async def test_search_details_respect_limit_and_normalize(platform, monkeypatch):
    monkeypatch.setattr('desktop.extra_platforms.asyncio.sleep', AsyncMock())
    task = runner(platform)
    task.crawler, _, _ = create_native(platform, task.store)
    if platform == 'zhihu':
        rows = [ZhihuContent(content_id=str(i), content_type='answer', content_url=f'https://www.zhihu.com/question/10/answer/{i}') for i in range(1, 6)]
        async def answer(question, identity):
            return ZhihuContent(content_id=identity, content_type='answer', title='回答', content_text='完整正文', user_nickname='昵***称', content_url=f'https://www.zhihu.com/question/{question}/answer/{identity}', image_list=['https://example.com/a.jpg'])
        task.page = SimpleNamespace(goto=AsyncMock())
        task.context = object()
        task.client = SimpleNamespace(get_note_by_keyword=AsyncMock(return_value=rows), get_answer_info=AsyncMock(side_effect=answer), update_cookies=AsyncMock())
        detail = task.client.get_answer_info
    elif platform == 'tieba':
        rows = [TiebaNote(note_id=str(i), title='帖子', note_url=f'https://tieba.baidu.com/p/{i}', tieba_name='测试吧', tieba_link='https://tieba.baidu.com/f?kw=test') for i in range(1, 6)]
        async def post(identity):
            return rows[int(identity)-1].model_copy(update={'desc': '完整正文', 'image_list': ['https://example.com/a.jpg']})
        task.client = SimpleNamespace(get_notes_by_keyword=AsyncMock(return_value=rows), get_note_by_id=AsyncMock(side_effect=post))
        detail = task.client.get_note_by_id
    elif platform == 'wb':
        rows = [{'card_type': 9, 'mblog': {'id': str(i), 'text': '<p>完整正文</p>', 'created_at': 'Wed Oct 28 10:00:00 +0800 2026', 'user': {'id': '1', 'screen_name': '测试昵称'}, 'pics': [{'large': {'url': 'https://example.com/a.jpg'}}]}} for i in range(1, 6)]
        task.client = SimpleNamespace(get_note_by_keyword=AsyncMock(return_value={'cards': rows}))
        task.crawler.get_note_full_text = AsyncMock(side_effect=lambda item: item)
        detail = task.crawler.get_note_full_text
    else:
        rows = [{'photo': {'id': str(i), 'caption': '完整正文' * 200, 'coverUrl': 'https://example.com/a.jpg'}, 'author': {'id': '1', 'name': '测试昵称'}} for i in range(1, 6)]
        task.client = SimpleNamespace(search_info_by_keyword_v2=AsyncMock(return_value={'result': 1, 'feeds': rows, 'pcursor': 'no_more'}))
        detail = None
    await ExtraCollector(task).search()
    assert len(task.store.items) == 2
    if detail:
        assert detail.await_count == 2
    for item in task.store.items.values():
        assert '完整正文' in item['text']
        assert item['images'] == ['https://example.com/a.jpg']
        assert item['url'].startswith('https://')
        assert '测试昵称' != item['author']
    if platform == 'ks':
        assert len(next(iter(task.store.items.values()))['text']) > 500
    if platform == 'zhihu':
        assert '/search?' in task.page.goto.call_args.args[0]
        task.client.update_cookies.assert_awaited_once_with(task.context)


@pytest.mark.asyncio
@pytest.mark.parametrize(('platform', 'url', 'method', 'args'), [
    ('zhihu', 'https://www.zhihu.com/question/1/answer/2?utm_source=test', 'get_answer_info', ('1', '2')),
    ('zhihu', 'https://zhuanlan.zhihu.com/p/3', 'get_article_info', ('3',)),
    ('zhihu', 'https://www.zhihu.com/zvideo/4', 'get_video_info', ('4',)),
    ('wb', 'https://weibo.com/123/ABCdef?from=test', 'get_note_info_by_id', ('ABCdef',)),
    ('wb', 'https://m.weibo.cn/detail/123', 'get_note_info_by_id', ('123',)),
    ('tieba', 'https://tieba.baidu.com/p/123?pn=2', 'get_note_by_id', ('123',)),
    ('ks', 'https://www.kuaishou.com/short-video/abc123', 'get_video_info', ('abc123',)),
])
async def test_detail_link_routing(platform, url, method, args):
    task = runner(platform)
    call = AsyncMock(return_value={})
    task.client = SimpleNamespace(**{method: call})
    collector = ExtraCollector(task)
    collector.save = AsyncMock()
    await collector.detail(url)
    call.assert_awaited_once_with(*args)


@pytest.mark.asyncio
async def test_zhihu_question_does_not_silently_return_empty():
    task = runner('zhihu')
    task.client = SimpleNamespace()
    with pytest.raises(RuntimeError, match='具体回答'):
        await ExtraCollector(task).detail('https://www.zhihu.com/question/1')


def test_zhihu_answer_and_article_ids_do_not_collide():
    answer = normalize({'content_id': '1', 'content_type': 'answer', 'content_text': '正文'}, 'zhihu')
    article = normalize({'content_id': '1', 'content_type': 'article', 'content_text': '正文'}, 'zhihu')
    assert answer['id'] != article['id']
    assert answer['text'] == article['text'] == '正文'


def test_new_account_profile_shapes():
    assert profile_info('zhihu', {'name': '知乎账号', 'avatar_url': 'https://example.com/a'})['nickname'] == '知乎账号'
    assert profile_info('wb', {'userInfo': {'screen_name': '微博账号', 'avatar_hd': 'https://example.com/a'}})['nickname'] == '微博账号'
    assert profile_info('ks', {'visionProfile': {'userProfile': {'profile': {'user_name': '快手账号', 'headurl': 'https://example.com/a'}}}})['nickname'] == '快手账号'
    assert profile_info('tieba', {'name': '贴吧账号', 'avatar': 'https://example.com/a'})['nickname'] == '贴吧账号'


@pytest.mark.asyncio
@pytest.mark.parametrize('platform', ['zhihu', 'wb', 'tieba', 'ks'])
async def test_native_clients_use_target_page_session(platform):
    from unittest.mock import Mock
    task = runner(platform)
    cdp = SimpleNamespace(send=AsyncMock(return_value={'cookies': []}))
    page = SimpleNamespace(context=SimpleNamespace(new_cdp_session=AsyncMock(return_value=cdp)), evaluate=AsyncMock(return_value='Studio Test UA'), goto=AsyncMock(), on=Mock(), url='https://example.com')
    task.page = page
    await task.setup()
    if platform == 'zhihu':
        assert task.client.default_headers['user-agent'] == 'Studio Test UA'
    else:
        assert task.client.playwright_page is page
    assert task.crawler.browser_context.pages == [page]
    assert cdp.send.await_count > 0
    assert page.goto.call_args.kwargs['wait_until'] == 'domcontentloaded'


@pytest.mark.asyncio
async def test_weibo_auth_syncs_mobile_session_before_pong():
    task = runner('wb')
    task.crawler = SimpleNamespace(mobile_index_url='https://m.weibo.cn')
    task.page = SimpleNamespace(url='https://www.weibo.com', goto=AsyncMock())
    task.context = SimpleNamespace(cookies=AsyncMock(return_value=[{'name': 'SUB', 'value': 'test'}]))
    task.client = SimpleNamespace(update_cookies=AsyncMock(), pong=AsyncMock(return_value=True))
    assert await task.logged_in()
    task.page.goto.assert_awaited_once_with('https://m.weibo.cn', wait_until='domcontentloaded', timeout=30000)
    task.client.update_cookies.assert_awaited_once_with(task.context)
