from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from desktop.paging import CreatorError, decode_cursor, encode_cursor
from desktop.pacing import PLATFORM_RULES, RULES, paced
from desktop.xhs_paging import collect_creator, collect_search

PROFILE = 'https://www.xiaohongshu.com/user/profile/abc?xsec_token=T1&xsec_source=pc_note'


def runner(client, limit=20):
    store = SimpleNamespace(ids=set(), limit=limit)
    events = []

    async def collect(note_id, source, token, semaphore):
        store.ids.add(f'xhs:{note_id}')
        task.seen.append((note_id, source, token))

    task = SimpleNamespace(platform='xhs', client=client, store=store, request={}, emit=lambda kind, **data: events.append((kind, data)), events=events, seen=[], collect_xhs_note=collect)
    return task


def pages(task):
    return [data for kind, data in task.events if kind == 'page']


def search_page(start, size, more=True):
    return {'has_more': more, 'items': [{'id': str(start + i), 'xsec_source': 'pc_search', 'xsec_token': 't'} for i in range(size)]}


def post_page(start, size, more=True, cursor='next'):
    return {'has_more': more, 'cursor': cursor, 'notes': [{'note_id': str(start + i), 'xsec_token': 'n', 'user': {'nickname': '博主', 'avatar': 'https://a/b.jpg'}} for i in range(size)]}


@pytest.mark.asyncio
async def test_search_resumes_inside_page_with_same_search_id():
    client = SimpleNamespace(get_note_by_keyword=AsyncMock(side_effect=[search_page(0, 20), search_page(0, 20), search_page(20, 3, more=False)]))
    first = runner(client, limit=15)
    await collect_search(first, '咖啡')
    assert len(first.seen) == 15
    cursor = pages(first)[-1]['next_cursor']
    state = decode_cursor(cursor, 'xhs-search')
    assert (state['p'], state['s']) == (1, 15)
    second = runner(client, limit=20)
    await collect_search(second, '', cursor)
    assert [note for note, _, _ in second.seen] == [str(i) for i in range(15, 23)]
    assert client.get_note_by_keyword.await_args_list[1].kwargs['search_id'] == state['i']
    assert pages(second)[-1] == {'has_more': False, 'next_cursor': None}


@pytest.mark.asyncio
async def test_search_ignores_recommendation_cards():
    rows = search_page(0, 2, more=False)
    rows['items'].insert(1, {'id': 'hint', 'model_type': 'rec_query'})
    task = runner(SimpleNamespace(get_note_by_keyword=AsyncMock(return_value=rows)))
    await collect_search(task, '咖啡')
    assert [note for note, _, _ in task.seen] == ['0', '1']


@pytest.mark.asyncio
async def test_block_saves_position_before_stopping():
    client = SimpleNamespace(get_note_by_keyword=AsyncMock(return_value=search_page(0, 20)))
    task = runner(client)
    original = task.collect_xhs_note

    async def blocked(note_id, source, token, semaphore):
        if note_id == '3':
            raise CreatorError('SEARCH_VERIFICATION_REQUIRED', '小红书要求验证')
        await original(note_id, source, token, semaphore)
    task.collect_xhs_note = blocked
    with pytest.raises(CreatorError):
        await collect_search(task, '咖啡')
    state = decode_cursor(pages(task)[-1]['next_cursor'], 'xhs-search')
    assert (state['p'], state['s']) == (1, 3)


@pytest.mark.asyncio
async def test_search_cursor_bound_to_keyword():
    with pytest.raises(CreatorError) as error:
        await collect_search(runner(SimpleNamespace()), '别的', encode_cursor('xhs-search', q='咖啡', p=2, i='s', s=0))
    assert error.value.code == 'INVALID_CURSOR'


@pytest.mark.asyncio
async def test_creator_requires_access_token():
    with pytest.raises(CreatorError) as error:
        await collect_creator(runner(SimpleNamespace()), 'https://www.xiaohongshu.com/user/profile/abc')
    assert error.value.code == 'XSEC_TOKEN_REQUIRED'


@pytest.mark.asyncio
async def test_creator_pages_and_announces_once():
    client = SimpleNamespace(get_notes_by_creator=AsyncMock(side_effect=[post_page(0, 2), post_page(2, 1, more=False, cursor='')]))
    task = runner(client)
    await collect_creator(task, PROFILE)
    assert task.seen[0] == ('0', 'pc_user', 'n')
    assert len(task.seen) == 3
    creators = [data['creator'] for kind, data in task.events if kind == 'creator']
    assert len(creators) == 1 and creators[0]['name'] == '博主' and 'xsec_token=T1' in creators[0]['url']
    assert client.get_notes_by_creator.await_args_list[1].args == ('abc', 'next')
    assert client.get_notes_by_creator.await_args_list[0].kwargs == {'xsec_token': 'T1', 'xsec_source': 'pc_note'}
    assert pages(task)[-1]['has_more'] is False


@pytest.mark.asyncio
async def test_creator_cursor_is_self_contained():
    client = SimpleNamespace(get_notes_by_creator=AsyncMock(return_value=post_page(0, 5, more=False, cursor='')))
    first = runner(SimpleNamespace(get_notes_by_creator=AsyncMock(return_value=post_page(0, 5))), limit=3)
    await collect_creator(first, PROFILE)
    cursor = pages(first)[-1]['next_cursor']
    task = runner(client)
    await collect_creator(task, '', cursor)
    assert client.get_notes_by_creator.await_args.kwargs['xsec_token'] == 'T1'
    assert [data for kind, data in task.events if kind == 'creator'] == []
    assert [note for note, _, _ in task.seen] == ['3', '4']


@pytest.mark.asyncio
async def test_creator_stops_when_platform_cursor_repeats():
    client = SimpleNamespace(get_notes_by_creator=AsyncMock(side_effect=[post_page(0, 1, cursor='same'), post_page(1, 1, cursor='same')]))
    task = runner(client)
    await collect_creator(task, PROFILE)
    assert client.get_notes_by_creator.await_count == 2
    assert pages(task)[-1]['has_more'] is False
    assert [data['message'] for kind, data in task.events if kind == 'warning'] != []


@pytest.mark.asyncio
@pytest.mark.parametrize('rule', [RULES[('xhs', 'get_note_by_keyword')], RULES[('xhs', 'get_notes_by_creator')], PLATFORM_RULES['xhs']])
async def test_xhs_block_starts_shared_cooldown(tmp_path, monkeypatch, rule):
    from media_platform.xhs.exception import IPBlockError
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    call = paced(AsyncMock(side_effect=IPBlockError('blocked')), rule)
    with pytest.raises(CreatorError) as error:
        await call('x')
    assert error.value.code == 'SEARCH_VERIFICATION_REQUIRED' and '小红书' in str(error.value)
    follow = paced(AsyncMock(return_value={}), RULES[('xhs', 'get_note_by_keyword')])
    with pytest.raises(CreatorError) as error:
        await follow('x')
    assert error.value.code == 'RATE_COOLDOWN'


@pytest.mark.asyncio
async def test_captcha_inside_retry_error_counts_as_block(tmp_path, monkeypatch):
    from tenacity import RetryError
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    attempt = SimpleNamespace(exception=lambda: Exception('CAPTCHA appeared, request failed'))
    call = paced(AsyncMock(side_effect=RetryError(attempt)), PLATFORM_RULES['xhs'])
    with pytest.raises(CreatorError):
        await call('x')


@pytest.mark.asyncio
async def test_other_errors_pass_through(tmp_path, monkeypatch):
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    call = paced(AsyncMock(side_effect=ValueError('bad')), PLATFORM_RULES['xhs'])
    with pytest.raises(ValueError):
        await call('x')
