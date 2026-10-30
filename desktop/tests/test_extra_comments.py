import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from desktop.comments import CommentCollector
from desktop.result_store import ResultStore
from media_platform.zhihu.help import ZhihuExtractor
from media_platform.tieba.help import TieBaExtractor


def tieba_data(identity):
    return {
        'thread': {'id': identity, 'title': '帖子'},
        'first_floor': {'id': '0', 'content': [{'type': 0, 'text': '正文'}, {'type': 3, 'origin_src': 'https://example.com/photo.jpg'}]},
        'forum': {'id': 9, 'name': '测试'}, 'page': {'total_page': 1},
        'user_list': [{'id': '7', 'name_show': '测试作者', 'portrait': 'test'}],
        'post_list': [{'id': str(i), 'author_id': '7', 'content': [{'text': f'评论{i}'}], 'sub_post_number': 30} for i in range(60)],
    }


@pytest.mark.asyncio
@pytest.mark.parametrize('platform', ['zhihu', 'wb', 'tieba', 'ks'])
async def test_comment_adapters_caps_relations_and_content_isolation(monkeypatch, platform):
    monkeypatch.setattr(asyncio, 'sleep', AsyncMock())
    store = ResultStore(platform, 2, lambda *args, **kwargs: None, comments=True)
    if platform == 'zhihu':
        def rows(start):
            return [{'type': 'comment', 'id': str(i), 'content': f'<p>评论{i}</p>', 'author': {'name': '测试作者'}, 'child_comment_count': 30} for i in range(start, start + 60)]
        roots = AsyncMock(return_value={'data': rows(1), 'paging': {'is_end': True}})
        replies = AsyncMock(return_value={'data': rows(100), 'paging': {'is_end': True}})
        client = SimpleNamespace(_extractor=ZhihuExtractor(), get_root_comments=roots, get_child_comments=replies)
    elif platform == 'wb':
        replies_data = [{'id': str(i), 'text': '<p>回复 &amp; 正文</p>', 'user': {'screen_name': '测试作者'}} for i in range(100, 160)]
        roots = AsyncMock(return_value={'data': [{'id': str(i), 'text': '评论', 'user': {'screen_name': '测试作者'}, 'comments': replies_data} for i in range(1, 60)], 'max_id': 0})
        client = SimpleNamespace(get_note_comments=roots)
        replies = None
    elif platform == 'ks':
        def rows(start):
            return [{'comment_id': str(i), 'content': '评论', 'author_name': '测试作者', 'commentCount': 30} for i in range(start, start + 60)]
        roots = AsyncMock(return_value={'rootCommentsV2': rows(1), 'pcursorV2': 'no_more'})
        replies = AsyncMock(return_value={'subCommentsV2': rows(100), 'pcursorV2': 'no_more'})
        client = SimpleNamespace(get_video_comments=roots, get_video_sub_comments=replies)
    else:
        async def page_data(identity, **kwargs):
            return tieba_data(identity)
        html = ''.join(f"<li class='lzl_single_post j_lzl_s_p' data-field='{json.dumps({'spid': i, 'showname': '测试作者'})}'><span class='lzl_content_main'>回复</span></li>" for i in range(100, 160))
        roots = AsyncMock(side_effect=page_data)
        replies = AsyncMock(return_value=html)
        client = SimpleNamespace(_get_pc_page_data=roots, _page_extractor=TieBaExtractor(), playwright_page=SimpleNamespace(goto=AsyncMock(), content=replies))
    collector = CommentCollector(platform, client, store, replies=True)
    # 同一个 collector 连续取两篇，确保缓存的帖子、评论归属均重置
    for identity in ('1', '2'):
        await store.store_content({'note_id': identity, 'content_type': 'answer'})
        key = f'{platform}:answer:{identity}' if platform == 'zhihu' else f'{platform}:{identity}'
        item = store.items[key]
        await collector.fetch(item)
        assert len([row for row in item['comments'] if not row['parentId']]) == 20
        assert len([row for row in item['comments'] if row['parentId'] == '1']) == 20
        assert all(set(row) == {'id', 'parentId', 'text', 'author', 'likes'} for row in item['comments'])
        assert all(row['author'] != '测试作者' for row in item['comments'])
        assert all('<p>' not in row['text'] for row in item['comments'])
    assert roots.await_count == 2
    if replies:
        assert replies.await_count == 2
    if platform == 'tieba':
        assert '0' not in [row['id'] for row in item['comments']]
        assert 'tid=2' in client.playwright_page.goto.call_args.args[0]


def test_tieba_body_images_are_preserved():
    note = TieBaExtractor().extract_note_detail_from_api(tieba_data('12'))
    assert note.image_list == ['https://example.com/photo.jpg']
    assert note.desc == '正文'


@pytest.mark.parametrize('kind', ['answer', 'article'])
def test_zhihu_original_images_and_question_title(kind):
    raw = {'id': '1', 'type': kind, 'content': '<p>正文</p><img src="placeholder" data-original="https://example.com/a"><img data-actualsrc="https://example.com/b"><img src="https://example.com/c">', 'question': {'id': '2', 'title': '问题标题'}, 'author': {'name': '测试作者'}}
    extractor = ZhihuExtractor()
    item = getattr(extractor, f'_extract_{kind}_content')(raw)
    assert item.image_list == ['https://example.com/a', 'https://example.com/b', 'https://example.com/c']
    if kind == 'answer':
        assert item.title == '问题标题'
