from types import SimpleNamespace
from unittest.mock import AsyncMock

from desktop import paging, xhs_paging
from desktop.result_store import ResultStore


def runner(**request):
    events = []
    store = ResultStore('xhs', 20, lambda kind, **data: events.append(data))
    return SimpleNamespace(store=store, request=request, events=events, collect_xhs_note=AsyncMock())


search_row = {
    'id': 'n1', 'xsec_token': 'T=', 'xsec_source': 'pc_search',
    'note_card': {'display_title': '标题', 'type': 'video', 'user': {'nickname': '作者', 'user_id': 'u1', 'xsec_token': 'U='},
                  'cover': {'url_default': 'https://img/a.jpg'}, 'interact_info': {'liked_count': '12'}},
}
creator_row = {
    'note_id': 'n2', 'xsec_token': 'T2', 'display_title': '主页作品', 'type': 'normal',
    'user': {'nickname': '博主'}, 'cover': {'url_pre': 'https://img/b.jpg'}, 'interact_info': {'liked_count': '3'},
}


async def test_search_row_becomes_card_without_detail_request():
    run = runner(listCards=True)
    assert await xhs_paging.save_card(run, search_row, 'pc_search') is True
    item = run.store.items['xhs:n1']
    assert item['title'] == '标题' and item['author'] == '作者' and item['likes'] == '12'
    assert item['images'] == ['https://img/a.jpg'] and item['text'] == '' and item['feed'] is True
    assert item['contentType'] == 'video'
    assert item['url'] == 'https://www.xiaohongshu.com/explore/n1?xsec_token=T=&xsec_source=pc_search'
    assert item['authorUrl'] == 'https://www.xiaohongshu.com/user/profile/u1?xsec_token=U=&xsec_source=pc_search'
    run.collect_xhs_note.assert_not_awaited()


async def test_creator_row_uses_flat_shape():
    run = runner(listCards=True)
    assert await xhs_paging.save_card(run, creator_row, 'pc_user') is True
    item = run.store.items['xhs:n2']
    assert item['title'] == '主页作品' and item['contentType'] == 'note'
    assert item['url'].endswith('xsec_token=T2&xsec_source=pc_user')


async def test_row_without_list_fields_falls_back():
    run = runner(listCards=True)
    assert await xhs_paging.save_card(run, {'id': 'n3', 'xsec_token': 'T', 'note_card': {}}, 'pc_search') is False
    assert await xhs_paging.save_card(run, {'id': 'n4', 'note_card': {'display_title': 'x'}}, 'pc_search') is False
    assert not run.store.items


def test_comments_and_cli_keep_full_details():
    assert paging.wants_cards(runner(listCards=True)) is True
    assert paging.wants_cards(runner(listCards=True, comments=True)) is False
    assert paging.wants_cards(runner()) is False
