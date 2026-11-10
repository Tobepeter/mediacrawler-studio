import asyncio
from types import SimpleNamespace
import pytest
from desktop.comments import CommentCollector
from desktop.crawler import DesktopCrawler


@pytest.mark.asyncio
@pytest.mark.parametrize('platform', ['bili', 'dy', 'xhs'])
async def test_comment_and_reply_caps_use_existing_normalizers(monkeypatch, platform):
    from store.bilibili import BiliStoreFactory
    from store.douyin import DouyinStoreFactory
    from store.xhs import XhsStoreFactory
    runner = DesktopCrawler({'platform': platform, 'limit': 1, 'mode': 'search', 'query': 'test', 'action': 'collect', 'comments': True}, None, lambda *args, **kwargs: None)
    factory = {'bili': BiliStoreFactory, 'dy': DouyinStoreFactory, 'xhs': XhsStoreFactory}[platform]
    monkeypatch.setattr(factory, 'create_store', lambda: runner.store)
    async def no_sleep(*args): pass
    monkeypatch.setattr(asyncio, 'sleep', no_sleep)
    await runner.store.store_content({'video_id': '1', 'note_url': 'https://www.xiaohongshu.com/explore/1?xsec_token=test'})
    def row(i):
        return {'rpid': str(i), 'cid': str(i), 'id': str(i), 'content': {'message': f'comment {i}'} if platform == 'bili' else f'comment {i}', 'text': f'comment {i}', 'member': {'uname': '作者', 'mid': '1'}, 'user': {'nickname': '作者', 'uid': '1'}, 'user_info': {'nickname': '作者', 'user_id': '1'}, 'rcount': 30, 'reply_comment_total': 30, 'sub_comment_count': 30}
    calls = []
    async def roots(*args, **kwargs):
        calls.append('root')
        rows = [row(i) for i in range(1, 60)]
        return {'replies': rows, 'comments': rows, 'cursor': {'is_end': False, 'next': 1} if platform == 'bili' else 1, 'has_more': True}
    async def replies(*args, **kwargs):
        calls.append('reply')
        rows = [row(i) for i in range(100, 160)]
        return {'replies': rows, 'comments': rows, 'page': {'count': 60}, 'has_more': True, 'cursor': 20}
    client = SimpleNamespace(get_video_comments=roots, get_aweme_comments=roots, get_note_comments=roots, get_video_level_two_comments=replies, get_sub_comments=replies, get_note_sub_comments=replies)
    item = runner.store.items[f'{platform}:1']
    await CommentCollector(platform, client, runner.store, replies=True).fetch(item)
    assert len([c for c in item['comments'] if not c['parentId']]) == 20
    assert len([c for c in item['comments'] if c['parentId']]) == 20
    assert calls == ['root', 'reply']
    assert set(item['comments'][0]) == {'id', 'parentId', 'text', 'author', 'likes'}
    assert all(c['parentId'] == '1' for c in item['comments'] if c['parentId'])


@pytest.mark.asyncio
async def test_comment_failure_keeps_content_and_marks_warning(monkeypatch):
    events = []
    runner = DesktopCrawler({'platform': 'dy', 'limit': 1, 'mode': 'search', 'query': 'test', 'action': 'collect', 'comments': True}, None, lambda kind, **value: events.append((kind, value)))
    async def no_op(): pass
    async def no_sleep(*args): pass
    async def content(): await runner.store.store_content({'aweme_id': '1', 'title': '正文保留'})
    async def failure(*args): raise RuntimeError('private upstream response')
    runner.setup = no_op
    runner.authenticate = no_op
    runner.search = content
    runner.client = SimpleNamespace(get_aweme_comments=failure)
    monkeypatch.setattr(asyncio, 'sleep', no_sleep)
    await runner.run()
    item = runner.store.items['dy:1']
    assert item['title'] == '正文保留'
    assert item['commentStatus'] == 'error'
    assert any(kind == 'warning' for kind, _ in events)
    assert events[-1][0] == 'done'
    assert 'private upstream' not in str(events)


@pytest.mark.asyncio
async def test_disabled_comments_never_fetch(monkeypatch):
    runner = DesktopCrawler({'platform': 'dy', 'limit': 1, 'mode': 'search', 'query': 'test', 'action': 'collect'}, None, lambda *args, **kwargs: None)
    async def no_op(): pass
    async def content(): await runner.store.store_content({'aweme_id': '1'})
    runner.setup = no_op
    runner.authenticate = no_op
    runner.search = content
    # 无 client 仍可完成，证明关闭选项不访问评论接口
    await runner.run()
    assert 'comments' not in runner.store.items['dy:1']


def page_collector(platform, responses):
    from desktop.comments import CommentCollector
    from desktop.result_store import ResultStore
    from unittest.mock import AsyncMock
    from types import SimpleNamespace
    client = SimpleNamespace(**{name: AsyncMock(return_value=value) for name, value in responses.items()})
    collector = CommentCollector(platform, client, ResultStore(platform, 1, lambda *a, **k: None))

    async def save(content_id, raw, parent=''):
        await collector.store.store_comment({'comment_id': collector.identity(raw), 'content': raw.get('t'), 'parent_comment_id': parent, 'nickname': 'n', 'like_count': 3})
    collector.save = save
    return collector, client


RECORD = {'id': 'dy:9', 'url': 'https://www.douyin.com/video/9'}


async def test_comment_page_returns_one_page_with_cursor():
    from desktop.comments import comment_page
    collector, client = page_collector('dy', {'get_aweme_comments': {'comments': [{'cid': 'a', 't': '一', 'reply_comment_total': 2}, {'cid': '', 't': '无 ID'}], 'has_more': 1, 'cursor': 20}})
    page = await comment_page(collector, RECORD)
    assert client.get_aweme_comments.await_count == 1
    assert page['hasMore'] is True and page['nextCursor'] == 20
    assert [row['id'] for row in page['comments']] == ['a'] and page['comments'][0]['replyCount'] == 2


async def test_comment_page_stops_when_cursor_repeats_or_empty():
    from desktop.comments import comment_page
    collector, _ = page_collector('dy', {'get_aweme_comments': {'comments': [{'cid': 'a', 't': '一'}], 'has_more': 1, 'cursor': 20}})
    assert (await comment_page(collector, RECORD, cursor=20))['hasMore'] is False
    collector, _ = page_collector('dy', {'get_aweme_comments': {'comments': [], 'has_more': 1, 'cursor': 40}})
    assert (await comment_page(collector, RECORD))['nextCursor'] is None


async def test_comment_page_loads_replies_of_one_comment():
    from desktop.comments import comment_page
    collector, client = page_collector('dy', {'get_sub_comments': {'comments': [{'cid': 'r', 't': '回复'}], 'has_more': 0, 'cursor': 0}})
    page = await comment_page(collector, RECORD, parent='a')
    client.get_sub_comments.assert_awaited_once_with('9', 'a', 0)
    assert page['comments'][0]['parentId'] == 'a' and page['hasMore'] is False

