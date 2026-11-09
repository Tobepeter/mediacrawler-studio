import pytest
from desktop.result_store import ResultStore, normalize


def test_source_and_images():
    item = normalize({"note_id": "1", "title": "标题", "desc": "完整正文\n第二段", "note_url": "https://www.xiaohongshu.com/explore/1", "image_list": "http://example.com/a,//example.com/b,javascript:bad"}, "xhs")
    assert item["text"] == "完整正文\n第二段"
    assert item["url"].startswith("https://www.xiaohongshu.com")
    assert item["images"] == ["https://example.com/a", "https://example.com/b"]


@pytest.mark.asyncio
async def test_limit_and_duplicate_results():
    events = []
    store = ResultStore("bili", 2, lambda event, **value: events.append(value))
    for video_id in [1, 1, 2, 3]:
        await store.store_content({"video_id": video_id, "title": str(video_id)})
    assert [event["item"]["id"] for event in events] == ["bili:1", "bili:2"]


@pytest.mark.asyncio
async def test_search_only_fetches_requested_details(monkeypatch):
    from desktop.crawler import DesktopCrawler
    from store import bilibili
    from types import SimpleNamespace
    fetched = []
    emitted = []
    runner = DesktopCrawler({"platform": "bili", "limit": 2, "mode": "search", "query": "test", "action": "collect"}, None, lambda event, **value: emitted.append(value))

    async def search(*args, **kwargs):
        return {"result": [{"aid": i} for i in range(20)]}

    async def detail(aid, **kwargs):
        fetched.append(aid)
        return {"video_id": aid}

    monkeypatch.setattr(bilibili, "update_bilibili_video", runner.store.store_content)
    runner.client = SimpleNamespace(search_video_by_keyword=search, get_video_info=detail)
    await runner.search()
    assert fetched == [0, 1]
    assert len([value for value in emitted if 'item' in value]) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['search', 'link'])
async def test_xhs_finishes_media_without_refetching_notes(mode, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from desktop.crawler import DesktopCrawler
    from store.xhs import XhsStoreFactory

    ids = ['a' * 24, 'b' * 24] if mode == 'search' else ['b' * 24]
    events = []
    runner = DesktopCrawler({
        'platform': 'xhs', 'limit': len(ids), 'action': 'collect', 'mode': mode,
        'query': 'test' if mode == 'search' else f'https://www.xiaohongshu.com/explore/{ids[0]}',
    }, None, lambda event, **_: events.append(event))
    runner.setup = AsyncMock()
    runner.authenticate = AsyncMock()
    runner.client = SimpleNamespace(get_note_by_keyword=AsyncMock(return_value={'items': [{'id': i} for i in ids]}))
    monkeypatch.setitem(XhsStoreFactory.STORES, 'studio', lambda: runner.store)

    def detail(note_id, **kwargs):
        raw = {'note_id': note_id, 'type': 'normal', 'image_list': [{'url_default': 'https://cdn.example/image.jpg'}]}
        if note_id.startswith('b'):
            raw.update(type='video', video={'consumer': {'origin_video_key': 'video.mp4'}, 'duration': 15})
        return raw

    load = AsyncMock(side_effect=detail)
    runner.crawler = SimpleNamespace(get_note_detail_async_task=load)
    await runner.run()
    assert [call.kwargs['note_id'] for call in load.await_args_list] == ids
    for item in runner.store.items.values():
        assert item['images'] == ['https://cdn.example/image.jpg']
    video = runner.store.items[f'xhs:{ids[-1]}']
    assert video['durationSeconds'] == 15
    assert video['media']['status'] == 'available'
    assert events[-1] == 'done'
    assert not runner.xhs_details
