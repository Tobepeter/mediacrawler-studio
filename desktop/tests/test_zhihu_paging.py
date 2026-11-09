from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from desktop import zhihu_paging
from desktop.paging import CreatorError, decode_cursor, encode_cursor
from desktop.result_store import ResultStore
from media_platform.zhihu.help import ZhihuExtractor


def answer(identity):
    return {'id': identity, 'type': 'answer', 'content': '<p>正文</p>', 'title': '标题', 'question': {'id': 7, 'title': '问题'},
            'author': {'id': 'x', 'name': '答主', 'url_token': 'tok'}, 'voteup_count': 1, 'comment_count': 0, 'created_time': 1}


def runner(**client):
    events = []
    store = ResultStore('zhihu', 20, lambda kind, **data: events.append((kind, data)))
    run = SimpleNamespace(
        platform='zhihu', store=store, request={'auto': True}, events=events,
        emit=lambda kind, **data: events.append((kind, data)),
        client=SimpleNamespace(_extractor=ZhihuExtractor(), get_creator_info=AsyncMock(return_value=None), **client),
    )
    zhihu_paging.track_raw(run)
    return run


@pytest.fixture(autouse=True)
def memory_store(monkeypatch):
    async def store_content(item):
        current['store'] and await current['store'].store_content(item.model_dump())
    current = {'store': None}
    monkeypatch.setattr('store.zhihu.update_zhihu_content', store_content)
    return current


def pages(events):
    return [data for kind, data in events if kind == 'page']


def test_author_url_handles_api_page_and_anonymous_shapes():
    assert zhihu_paging.author_url({'url_token': 'a'}) == 'https://www.zhihu.com/people/a'
    assert zhihu_paging.author_url({'urlToken': 'b'}) == 'https://www.zhihu.com/people/b'
    assert zhihu_paging.author_url({'member': {'url_token': 'c'}}) == 'https://www.zhihu.com/people/c'
    assert zhihu_paging.author_url({'id': '0', 'url_token': ''}) == ''
    assert zhihu_paging.author_url(None) == ''


@pytest.mark.parametrize('value', ['https://www.zhihu.com/people/ab-c/answers', 'ab-c'])
def test_reference_accepts_homepage_and_token(value):
    assert zhihu_paging.parse_reference(value) == 'ab-c'


def test_reference_rejects_other_links():
    with pytest.raises(CreatorError):
        zhihu_paging.parse_reference('https://www.zhihu.com/question/1')


async def test_empty_answers_fall_through_to_articles(memory_store):
    empty = {'data': [], 'paging': {'is_end': True}}
    article = {'id': 5, 'type': 'article', 'content': '<p>文</p>', 'title': '文章', 'author': {'id': 'x', 'name': '答主', 'url_token': 'tok'}, 'created': 1}
    run = runner(get_creator_answers=AsyncMock(return_value=empty), get_creator_articles=AsyncMock(return_value={'data': [article], 'paging': {'is_end': False}}))
    memory_store['store'] = run.store
    await zhihu_paging.collect_creator(run, 'tok')
    assert list(run.store.ids) == ['zhihu:article:5']
    assert run.store.items['zhihu:article:5']['authorUrl'] == 'https://www.zhihu.com/people/tok'
    assert decode_cursor(pages(run.events)[-1]['next_cursor'], 'zhihu-posts')['m'] == [1, 20]


async def test_last_tab_end_reports_no_more(memory_store):
    empty = {'data': [], 'paging': {'is_end': True}}
    run = runner(get_creator_answers=AsyncMock(return_value=empty), get_creator_articles=AsyncMock(return_value=empty), get_creator_videos=AsyncMock(return_value=empty))
    memory_store['store'] = run.store
    await zhihu_paging.collect_creator(run, 'tok')
    assert pages(run.events)[-1]['has_more'] is False
    assert run.client.get_creator_videos.await_count == 1


async def test_cursor_resumes_inside_page_without_profile(memory_store):
    rows = {'data': [answer(1), answer(2)], 'paging': {'is_end': False}}
    run = runner(get_creator_answers=AsyncMock(return_value=rows))
    memory_store['store'] = run.store
    await zhihu_paging.collect_creator(run, '', encode_cursor('zhihu-posts', c='tok', m=[0, 40], s=1))
    run.client.get_creator_answers.assert_awaited_once_with('tok', 40, 20)
    assert list(run.store.ids) == ['zhihu:answer:2']
    run.client.get_creator_info.assert_not_awaited()


async def test_forged_cursor_is_rejected():
    run = runner()
    with pytest.raises(CreatorError):
        await zhihu_paging.collect_creator(run, '', encode_cursor('zhihu-posts', c='tok', m=[9, 0]))


async def test_feed_keeps_answers_with_text_and_cursor():
    response = {
        'data': [{'target': answer(1)}, {'target': {'id': 9, 'type': 'feed_advert'}}, {'type': 'feed'}],
        'paging': {'is_end': False, 'next': 'https://www.zhihu.com/api/v3/feed/topstory/recommend?after_id=5&page_number=2&session_token=s1'},
    }
    run = runner(get_home_feed=AsyncMock(return_value=response))
    page = await zhihu_paging.load_feed(run)
    assert [item['id'] for item in page['items']] == ['zhihu:answer:1']
    item = page['items'][0]
    assert item['text'] == '正文' and item['author'] == '答主' and item['feed'] is True
    assert item['authorUrl'] == 'https://www.zhihu.com/people/tok'
    assert item['url'] == 'https://www.zhihu.com/question/7/answer/1'
    state = decode_cursor(page['next_cursor'], 'zhihu-feed')
    assert (state['p'], state['a'], state['t']) == (2, 5, 's1')
    await zhihu_paging.load_feed(run, page['next_cursor'])
    run.client.get_home_feed.assert_awaited_with(page=2, after_id=5, session_token='s1')


async def test_empty_feed_stops_paging():
    run = runner(get_home_feed=AsyncMock(return_value={'data': [], 'paging': {'is_end': False}}))
    page = await zhihu_paging.load_feed(run)
    assert page['has_more'] is False and page['next_cursor'] is None


async def test_retry_exhausted_becomes_platform_error():
    from tenacity import RetryError
    run = runner(get_home_feed=AsyncMock(side_effect=RetryError(None)))
    with pytest.raises(CreatorError) as error:
        await zhihu_paging.load_feed(run)
    assert error.value.code == 'PLATFORM_ERROR'


async def test_feed_card_keeps_structure_and_decodes_entities():
    target = {**answer(3), 'title': 'A &#34;B&#34;', 'content': '<p>第一段 &#34;引用&#34;</p><h2>小标题</h2><p>第二段</p>'}
    run = runner(get_home_feed=AsyncMock(return_value={'data': [{'target': target}], 'paging': {}}))
    item = (await zhihu_paging.load_feed(run))['items'][0]
    assert item['title'] == 'A "B"'
    assert item['text'] == '第一段 "引用"\n小标题\n第二段'
    assert '## 小标题' in item['markdown'] and '&#34;' not in item['markdown']
