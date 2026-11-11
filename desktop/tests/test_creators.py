from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from desktop.dy_paging import CreatorError, collect_creator, collect_search, decode_cursor, encode_cursor, parse_reference, search_creators

SEC = 'MS4wLjABAAAA' + 'a' * 30


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    async def update(aweme):
        store = current['store']
        key = f"dy:{aweme['aweme_id']}"
        if key not in store.ids and len(store.ids) < store.limit:
            store.ids.add(key)
            store.items[key] = aweme
    monkeypatch.setattr('store.douyin.update_douyin_aweme', update)


current = {}


def runner(client, limit=20):
    store = SimpleNamespace(ids=set(), items={}, author_urls={}, limit=limit)
    current['store'] = store
    events = []
    return SimpleNamespace(platform='dy', client=client, store=store, dy_details={}, request={}, emit=lambda kind, **data: events.append((kind, data)), events=events)


def pages(task):
    return [data for kind, data in task.events if kind == 'page']


def post_client(batches, user=None):
    client = SimpleNamespace()
    client.get_user_info = AsyncMock(return_value={'status_code': 0, 'user': user or {'sec_uid': SEC, 'nickname': '博主', 'secret': 0}})
    client.get_user_aweme_posts = AsyncMock(side_effect=batches)
    return client


def batch(start, size, more=1, cursor='next'):
    return {'status_code': 0, 'has_more': more, 'max_cursor': cursor, 'aweme_list': [{'aweme_id': str(start + i)} for i in range(size)]}


@pytest.mark.parametrize('value', ['***', encode_cursor('search', o=1), encode_cursor('posts', s=-1), 'e30'])
def test_invalid_cursor_rejected(value):
    with pytest.raises(CreatorError) as error:
        decode_cursor(value, 'posts')
    assert error.value.code == 'INVALID_CURSOR'


@pytest.mark.parametrize('value,expected', [
    (SEC, ('id', SEC)),
    (f'https://www.douyin.com/user/{SEC}?from_tab_name=main', ('id', SEC)),
    (f'www.douyin.com/user/{SEC}', ('id', SEC)),
    (f'https://www.iesdouyin.com/share/user/{SEC}', ('id', SEC)),
    ('https://v.douyin.com/abc/', ('short', 'https://v.douyin.com/abc/')),
    ('7.5 复制打开抖音，看看【博主的主页】 https://v.douyin.com/abc/ 复制', ('short', 'https://v.douyin.com/abc/')),
    ('厚大.罗翔说刑法', ('name', '厚大.罗翔说刑法')),
])
def test_parse_reference(value, expected):
    assert parse_reference(value) == expected


@pytest.mark.parametrize('value', ['https://www.douyin.com/video/123', 'https://www.douyin.com/user/self', 'https://evil.com/user/abc', f'http://www.douyin.com/user/{SEC}', '  '])
def test_parse_reference_rejects_non_profile(value):
    with pytest.raises(CreatorError) as error:
        parse_reference(value)
    assert error.value.code == 'INVALID_CREATOR'


def search_page(rows, cursor=15, more=1):
    return {'status_code': 0, 'data': rows, 'cursor': cursor, 'has_more': more, 'extra': {'logid': 'log'}}


def card(identity, name=None):
    return {'user_list': [{'user_info': {'sec_uid': identity, 'nickname': name or identity, 'unique_id': identity, 'follower_count': 9}}]}


def video(identity, name=None):
    return {'aweme_info': {'author': {'sec_uid': identity, 'nickname': name or identity, 'follower_count': 0}}}


@pytest.mark.asyncio
async def test_search_merges_cards_and_video_authors():
    client = SimpleNamespace(search_info_by_keyword=AsyncMock(return_value=search_page([card('a'), video('b'), video('a'), {'type': 6}], more=0)))
    page = await search_creators(runner(client), '罗翔', 10)
    assert [(item['id'], item['source'], item['followers']) for item in page['items']] == [('a', 'user', 9), ('b', 'video', None)]
    assert page == {**page, 'next_cursor': None, 'has_more': False}


@pytest.mark.asyncio
async def test_search_cursor_resumes_inside_page_without_losing_rows():
    rows = [video(name) for name in 'abcd']
    client = SimpleNamespace(search_info_by_keyword=AsyncMock(side_effect=[search_page(rows), search_page(rows), search_page([video('e')], 19, 0)]))
    task = runner(client)
    first = await search_creators(task, 'x', 2)
    assert [item['id'] for item in first['items']] == ['a', 'b']
    second = await search_creators(task, 'x', 3, first['next_cursor'])
    assert [item['id'] for item in second['items']] == ['c', 'd', 'e']
    assert not second['has_more']
    assert client.search_info_by_keyword.await_args_list[1].kwargs['search_id'] == 'log'


@pytest.mark.asyncio
async def test_single_request_search_returns_next_page_cursor():
    client = SimpleNamespace(search_info_by_keyword=AsyncMock(return_value=search_page([video('a')])))
    page = await search_creators(runner(client), 'x', 20, requests=1)
    assert client.search_info_by_keyword.await_count == 1
    assert decode_cursor(page['next_cursor'], 'search')['o'] == 15


@pytest.mark.asyncio
async def test_search_cursor_bound_to_keyword():
    with pytest.raises(CreatorError) as error:
        await search_creators(runner(SimpleNamespace()), 'b', 5, encode_cursor('search', q='a', o=15))
    assert error.value.code == 'INVALID_CURSOR'


@pytest.mark.asyncio
@pytest.mark.parametrize('response,code', [
    ({'status_code': 8}, 'AUTH_REQUIRED'), ({'status_code': 5}, 'PLATFORM_ERROR'),
])
async def test_search_maps_platform_errors(response, code):
    with pytest.raises(CreatorError) as error:
        await search_creators(runner(SimpleNamespace(search_info_by_keyword=AsyncMock(return_value=response))), 'x')
    assert error.value.code == code


@pytest.mark.asyncio
async def test_empty_response_body_is_structured_error():
    from media_platform.douyin.exception import DataFetchError
    with pytest.raises(CreatorError) as error:
        await search_creators(runner(SimpleNamespace(search_info_by_keyword=AsyncMock(side_effect=DataFetchError('blocked')))), 'x')
    assert error.value.code == 'PLATFORM_ERROR'


@pytest.mark.asyncio
async def test_posts_limit_inside_page_then_resume_exactly():
    client = post_client([batch(0, 18, cursor='p2'), batch(18, 18, cursor='p3'), batch(18, 18, cursor='p3')])
    task = runner(client, 20)
    await collect_creator(task, SEC)
    assert len(task.store.ids) == 20
    assert task.dy_details['dy:0']['aweme_id'] == '0'
    last = pages(task)[-1]
    assert last['has_more'] is True
    resumed = runner(client, 3)
    await collect_creator(resumed, '', last['next_cursor'])
    assert sorted(resumed.store.ids) == ['dy:20', 'dy:21', 'dy:22']
    assert client.get_user_aweme_posts.await_args.args == (SEC, 'p2')
    assert client.get_user_info.await_count == 1


@pytest.mark.asyncio
async def test_posts_limit_on_page_boundary_points_to_next_page():
    client = post_client([batch(0, 18, cursor='p2')])
    task = runner(client, 18)
    await collect_creator(task, SEC)
    assert client.get_user_aweme_posts.await_count == 1
    assert decode_cursor(pages(task)[-1]['next_cursor'], 'posts')['m'] == 'p2'


@pytest.mark.asyncio
async def test_posts_end_of_list():
    task = runner(post_client([batch(0, 5, 0, '0')]))
    await collect_creator(task, SEC)
    assert pages(task)[-1] == {'has_more': False, 'next_cursor': None}


@pytest.mark.asyncio
async def test_empty_pages_keep_resume_position_and_warn():
    client = post_client([batch(0, 18, cursor='p2'), *[batch(0, 0, cursor='p2') for _ in range(3)]])
    task = runner(client, 30)
    await collect_creator(task, SEC)
    assert 'warning' in [kind for kind, _ in task.events]
    last = pages(task)[-1]
    assert last['has_more'] and decode_cursor(last['next_cursor'], 'posts')['m'] == 'p2'
    assert client.get_user_aweme_posts.await_count == 4


@pytest.mark.asyncio
async def test_repeating_platform_cursor_stops():
    client = post_client([batch(0, 18, cursor='p2'), batch(18, 18, cursor='p2')])
    task = runner(client, 100)
    await collect_creator(task, SEC)
    assert client.get_user_aweme_posts.await_count == 2
    assert 'warning' in [kind for kind, _ in task.events]
    assert pages(task)[-1]['has_more'] is False


@pytest.mark.asyncio
async def test_private_creator_and_empty_public_creator():
    private = {'sec_uid': SEC, 'nickname': '私密', 'secret': 1}
    with pytest.raises(CreatorError) as error:
        await collect_creator(runner(post_client([batch(0, 0, 0)], private)), SEC)
    assert error.value.code == 'CREATOR_PRIVATE'
    task = runner(post_client([batch(0, 0, 0)]))
    await collect_creator(task, SEC)
    assert not task.store.ids and pages(task)[-1]['has_more'] is False


@pytest.mark.asyncio
async def test_missing_creator():
    client = post_client([])
    client.get_user_info = AsyncMock(return_value={'status_code': 0, 'user': None})
    with pytest.raises(CreatorError) as error:
        await collect_creator(runner(client), SEC)
    assert error.value.code == 'CREATOR_NOT_FOUND'


@pytest.mark.asyncio
async def test_cursor_for_other_creator_rejected():
    cursor = encode_cursor('posts', c=SEC, m='p', s=0)
    with pytest.raises(CreatorError) as error:
        await collect_creator(runner(post_client([])), 'MS4wLjABAAAA' + 'b' * 30, cursor)
    assert error.value.code == 'INVALID_CURSOR'


@pytest.mark.asyncio
@pytest.mark.parametrize('rows,code', [
    ([video('a', '同名'), video('b', '同名')], 'CREATOR_AMBIGUOUS'),
    ([video('a', '相似的名字')], 'CREATOR_NOT_FOUND'),
])
async def test_name_requires_single_exact_match(rows, code):
    client = post_client([])
    client.search_info_by_keyword = AsyncMock(return_value=search_page(rows, more=0))
    with pytest.raises(CreatorError) as error:
        await collect_creator(runner(client), '同名')
    assert error.value.code == code and error.value.candidates


@pytest.mark.asyncio
async def test_exact_name_and_unique_id_resolve():
    client = post_client([batch(0, 1, 0)], {'sec_uid': 'a', 'nickname': '博主'})
    client.search_info_by_keyword = AsyncMock(return_value=search_page([card('a', '博主'), video('b', '博主二号')], more=0))
    task = runner(client)
    await collect_creator(task, '博主')
    assert client.get_user_aweme_posts.await_args.args[0] == 'a'
    assert [data['creator']['id'] for kind, data in task.events if kind == 'creator'] == ['a']


@pytest.mark.asyncio
@pytest.mark.parametrize('target,ok', [(f'https://www.iesdouyin.com/share/user/{SEC}?x=1', True), ('https://www.iesdouyin.com/share/video/123', False), ('', False)])
async def test_short_link_resolution(target, ok):
    client = post_client([batch(0, 1, 0)])
    client.resolve_short_url = AsyncMock(return_value=target)
    if ok:
        await collect_creator(runner(client), 'https://v.douyin.com/abc/')
        assert client.get_user_aweme_posts.await_args.args[0] == SEC
    else:
        with pytest.raises(CreatorError):
            await collect_creator(runner(client), 'https://v.douyin.com/abc/')


def keyword_client(batches):
    client = SimpleNamespace()
    client.search_info_by_keyword = AsyncMock(side_effect=batches)
    return client


def keyword_page(start, size, more=1, logid='log'):
    return {'has_more': more, 'extra': {'logid': logid}, 'data': [{'aweme_info': {'aweme_id': str(start + i)}} for i in range(size)]}


@pytest.mark.asyncio
async def test_search_cursor_resumes_without_gap_or_repeat():
    client = keyword_client([keyword_page(0, 10), keyword_page(10, 10), keyword_page(10, 10), keyword_page(20, 3, more=0)])
    task = runner(client, limit=15)
    await collect_search(task, '罗翔')
    assert len(task.store.ids) == 15
    assert client.search_info_by_keyword.await_args_list[1].kwargs == {'offset': 10, 'search_id': 'log'}
    cursor = pages(task)[-1]['next_cursor']
    next_task = runner(client, limit=20)
    await collect_search(next_task, '罗翔', cursor)
    assert sorted(map(int, (key.split(':')[1] for key in next_task.store.ids))) == list(range(15, 23))
    assert pages(next_task)[-1] == {'has_more': False, 'next_cursor': None}


@pytest.mark.asyncio
async def test_search_batch_ending_on_page_boundary_continues_from_next_page():
    client = keyword_client([keyword_page(0, 10), keyword_page(10, 10)])
    task = runner(client, limit=20)
    await collect_search(task, '罗翔')
    state = decode_cursor(pages(task)[-1]['next_cursor'], 'search')
    assert (state['o'], state['s']) == (20, 0)


@pytest.mark.asyncio
async def test_post_search_cursor_bound_to_keyword():
    with pytest.raises(CreatorError) as error:
        await collect_search(runner(keyword_client([])), '别的词', encode_cursor('search', q='罗翔', o=10, i='', s=0))
    assert error.value.code == 'INVALID_CURSOR'


@pytest.mark.asyncio
async def test_search_cursor_alone_supplies_keyword():
    client = keyword_client([keyword_page(0, 3, more=0)])
    await collect_search(runner(client), '', encode_cursor('search', q='罗翔', o=10, i='log', s=0))
    assert client.search_info_by_keyword.await_args.args == ('罗翔',)


@pytest.mark.asyncio
async def test_profile_failure_keeps_collecting_and_names_creator_from_posts():
    from media_platform.douyin.exception import DataFetchError
    client = post_client([{'status_code': 0, 'has_more': 0, 'max_cursor': '', 'aweme_list': [{'aweme_id': '1', 'author': {'nickname': '作者'}}]}])
    client.get_user_info = AsyncMock(side_effect=DataFetchError('blocked'))
    task = runner(client)
    await collect_creator(task, f'https://www.douyin.com/user/{SEC}')
    assert task.store.ids == {'dy:1'}
    assert [data['creator']['name'] for kind, data in task.events if kind == 'creator'] == ['作者']
    assert [data['detail']['cause'] for kind, data in task.events if kind == 'log'] == ['blocked']


@pytest.mark.asyncio
async def test_profile_auth_failure_still_stops():
    client = post_client([])
    client.get_user_info = AsyncMock(return_value={'status_code': 8})
    with pytest.raises(CreatorError) as error:
        await collect_creator(runner(client), f'https://www.douyin.com/user/{SEC}')
    assert error.value.code == 'AUTH_REQUIRED'
