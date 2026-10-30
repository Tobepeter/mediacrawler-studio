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
    runner.client = SimpleNamespace(search_video_by_keyword=search)
    runner.crawler = SimpleNamespace(get_video_info_task=detail)
    await runner.search()
    assert fetched == [0, 1]
    assert len(emitted) == 2
