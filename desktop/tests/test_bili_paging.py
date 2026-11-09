from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from desktop.bili_paging import collect_creator, collect_search, parse_reference, search_creators
from desktop.paging import CreatorError, decode_cursor, encode_cursor
from desktop.pacing import RULES, bili_blocked, paced
from media_platform.bilibili.exception import DataFetchError


class Task:
    def __init__(self, client, limit=20):
        self.client, self.platform, self.events, self.saved = client, 'bili', [], []
        self.store = SimpleNamespace(ids=set(), items={}, limit=limit)

    def emit(self, kind, **data):
        self.events.append((kind, data))

    async def collect_bili_video(self, aid):
        self.saved.append(aid)
        self.store.ids.add(f'bili:{aid}')

    def last_page(self):
        return [data for kind, data in self.events if kind == 'page'][-1]

    def creators(self):
        return [data['creator'] for kind, data in self.events if kind == 'creator']


def videos(*aids, count=None):
    return {'list': {'vlist': [{'aid': aid, 'author': '作者'} for aid in aids]}, 'page': {'count': count if count is not None else len(aids)}}


def posts_client(*pages, card=None):
    return SimpleNamespace(get_creator_videos=AsyncMock(side_effect=list(pages)), get=AsyncMock(return_value=card or {
        'card': {'name': '博主', 'face': '//i0.hdslb.com/a.jpg', 'sign': '简介', 'Official': {'title': '认证'}},
        'follower': 12, 'archive_count': 3, 'like_num': 7,
    }))


@pytest.mark.parametrize('value,expected', [
    ('https://space.bilibili.com/123', ('id', '123')),
    ('https://space.bilibili.com/123/upload/video?spm=1', ('id', '123')),
    ('https://m.bilibili.com/space/456', ('id', '456')),
    ('space.bilibili.com/789', ('id', '789')),
    ('789', ('id', '789')),
    ('某博主', ('name', '某博主')),
    ('分享给你 https://space.bilibili.com/42 看看', ('id', '42')),
    ('https://b23.tv/abc', ('short', 'https://b23.tv/abc')),
])
def test_parse_reference(value, expected):
    assert parse_reference(value) == expected


@pytest.mark.parametrize('value', ['https://www.bilibili.com/video/BV1', 'https://evil.example/123', 'http://space.bilibili.com/1'])
def test_parse_reference_rejects_other_links(value):
    with pytest.raises(CreatorError) as error:
        parse_reference(value)
    assert error.value.code == 'INVALID_CREATOR'


async def test_creator_walks_pages_and_publishes_profile():
    client = posts_client(videos(*range(30), count=33), videos(30, 31, 32, count=33))
    task = Task(client, limit=100)
    await collect_creator(task, 'https://space.bilibili.com/123')
    assert task.saved == list(range(33))
    assert task.last_page() == {'has_more': False, 'next_cursor': None}
    creator = task.creators()[0]
    assert (creator['name'], creator['avatar'], creator['followers'], creator['posts']) == ('博主', 'https://i0.hdslb.com/a.jpg', 12, 3)
    assert creator['url'] == 'https://space.bilibili.com/123'
    assert [call.args[:2] for call in client.get_creator_videos.call_args_list] == [('123', 1), ('123', 2)]


async def test_creator_cursor_resumes_inside_page_without_gap():
    first = Task(posts_client(videos(1, 2, 3, count=3)), limit=2)
    await collect_creator(first, 'https://space.bilibili.com/123')
    assert first.saved == [1, 2]
    cursor = first.last_page()['next_cursor']
    assert decode_cursor(cursor, 'bili-posts') == {'v': 1, 'k': 'bili-posts', 'c': '123', 'p': 1, 's': 2}
    client = posts_client(videos(1, 2, 3, count=3))
    second = Task(client, limit=5)
    await collect_creator(second, '', cursor)
    assert second.saved == [3]
    client.get.assert_not_called()
    assert second.creators() == []


async def test_creator_profile_failure_does_not_stop_collection():
    client = posts_client(videos(1, count=1))
    client.get = AsyncMock(side_effect=DataFetchError('服务繁忙'))
    task = Task(client)
    await collect_creator(task, '123')
    assert task.saved == [1]
    assert task.creators()[0]['name'] == '作者'
    assert any(kind == 'log' and data['event'] == 'creator-profile-unavailable' for kind, data in task.events)


async def test_creator_cursor_rejects_other_account():
    cursor = encode_cursor('bili-posts', c='123', p=1, s=0)
    with pytest.raises(CreatorError) as error:
        await collect_creator(Task(posts_client()), 'https://space.bilibili.com/999', cursor)
    assert error.value.code == 'INVALID_CURSOR'


async def test_empty_pages_with_more_keep_position():
    client = posts_client(*[{'list': {'vlist': []}, 'page': {}}] * 1)
    task = Task(client)
    await collect_creator(task, '123')
    assert task.last_page()['has_more'] is False


def search_page(*aids, pages=2):
    return {'result': [{'aid': aid} for aid in aids], 'numPages': pages}


async def test_search_follows_num_pages_and_keeps_query_in_cursor():
    client = SimpleNamespace(search_video_by_keyword=AsyncMock(side_effect=[search_page(1, 2), search_page(3, 4)]))
    task = Task(client, limit=100)
    await collect_search(task, '罗翔')
    assert task.saved == [1, 2, 3, 4]
    assert task.last_page()['has_more'] is False
    assert client.search_video_by_keyword.await_count == 2


async def test_search_cursor_alone_resumes():
    client = SimpleNamespace(search_video_by_keyword=AsyncMock(return_value=search_page(1, 2, 3)))
    first = Task(client, limit=2)
    await collect_search(first, '罗翔')
    cursor = first.last_page()['next_cursor']
    second = Task(SimpleNamespace(search_video_by_keyword=AsyncMock(return_value=search_page(1, 2, 3, pages=1))), limit=5)
    await collect_search(second, '', cursor)
    assert second.saved == [3]
    with pytest.raises(CreatorError):
        await collect_search(Task(client), '别的词', cursor)


async def test_block_during_details_saves_position_first():
    client = SimpleNamespace(search_video_by_keyword=AsyncMock(return_value=search_page(1, 2)))
    task = Task(client)
    calls = []

    async def collect(aid):
        calls.append(aid)
        if aid == 2:
            raise CreatorError('SEARCH_VERIFICATION_REQUIRED', '要求验证')
    task.collect_bili_video = collect
    with pytest.raises(CreatorError):
        await collect_search(task, '词')
    assert decode_cursor(task.last_page()['next_cursor'], 'bili-search')['s'] == 1


def user_rows(*mids):
    return [{'mid': mid, 'uname': f'<em class="keyword">名</em>{mid}', 'usign': '签名', 'fans': mid, 'videos': 2, 'upic': '//i0.hdslb.com/f.jpg', 'official_verify': {'desc': '认证'}} for mid in mids]


async def test_search_creators_maps_rows_and_pages_precisely():
    client = SimpleNamespace(search_user_by_keyword=AsyncMock(return_value={'result': user_rows(1, 2, 3), 'numPages': 1}))
    task = Task(client)
    page = await search_creators(task, '名', 2, requests=1)
    assert [item['id'] for item in page['items']] == ['1', '2']
    item = page['items'][0]
    assert (item['name'], item['avatar'], item['followers'], item['posts'], item['verified']) == ('名1', 'https://i0.hdslb.com/f.jpg', 1, 2, '认证')
    following = await search_creators(task, '名', 2, page['next_cursor'], requests=1)
    assert [item['id'] for item in following['items']] == ['3']
    assert following['has_more'] is False


@pytest.mark.parametrize('message,blocked', [('请求被拦截', True), ('风控校验失败', True), ('请求过于频繁', True), ('Failed to decode JSON, content: 412', True), ('服务繁忙', False)])
def test_block_detection(message, blocked):
    assert bili_blocked(DataFetchError(message)) is blocked


async def test_block_starts_shared_cooldown(tmp_path, monkeypatch):
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    rule = RULES[('bili', 'get_creator_videos')]
    call = paced(AsyncMock(side_effect=DataFetchError('请求被拦截')), rule)
    with pytest.raises(CreatorError) as error:
        await call('123', 1)
    assert error.value.code == 'SEARCH_VERIFICATION_REQUIRED'
    with pytest.raises(CreatorError) as error:
        await paced(AsyncMock(), RULES[('bili', 'search_video_by_keyword')])('词')
    assert error.value.code == 'RATE_COOLDOWN'


def test_bili_batches_defer_media_but_single_links_keep_it():
    from desktop.crawler import DesktopCrawler
    make = lambda platform, mode: DesktopCrawler({'platform': platform, 'mode': mode, 'limit': 1, 'query': 'x', 'action': 'collect'}, None, lambda *a, **k: None)
    assert make('bili', 'search').defer_media() is True
    assert make('bili', 'creator').defer_media() is True
    assert not make('bili', 'link').defer_media()
    assert not make('dy', 'search').defer_media()
    assert not make('xhs', 'creator').defer_media()
