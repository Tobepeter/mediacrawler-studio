from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from desktop.content import capabilities, media
from desktop.content.schema import metadata
from desktop.media_download import auto_kind


@pytest.mark.parametrize('raw,expected', [
    ({'aweme_type': '68', 'note_download_url': 'https://p/a.webp,https://p/b.webp'}, 'note'),
    ({'aweme_type': '0', 'note_download_url': ''}, 'video'),
    ({'type': 'normal'}, 'normal'),
    ({}, 'unknown'),
])
def test_douyin_gallery_is_a_note_before_enrichment(raw, expected):
    assert metadata(raw)['contentType'] == expected


async def test_douyin_gallery_slideshow_does_not_make_it_a_video(monkeypatch):
    # 图集也带配乐幻灯片的视频地址
    raw = {'images': [{'url_list': ['https://p/a']}, {'url_list': ['https://p/b']}],
           'video': {'play_addr': {'url_list': ['https://v/slideshow.mp4'], 'width': 720, 'height': 1280}}}
    monkeypatch.setattr(media, 'fetch', AsyncMock(return_value=(raw, 0)))
    monkeypatch.setattr(capabilities, 'enrich', AsyncMock())
    runner = SimpleNamespace(platform='dy', request={}, emit=None, dy_details={'dy:1': raw})
    record = {'id': 'dy:1', 'platform': 'dy', 'url': 'https://www.douyin.com/video/1', 'contentType': 'video'}
    await media.enrich(runner, record)
    assert record['contentType'] == 'note'
    assert any(v['kind'] == 'video' for v in record['media']['variants'])


async def test_douyin_video_stays_a_video(monkeypatch):
    raw = {'video': {'play_addr': {'url_list': ['https://v/a.mp4'], 'width': 720, 'height': 1280}}}
    monkeypatch.setattr(media, 'fetch', AsyncMock(return_value=(raw, 12)))
    monkeypatch.setattr(capabilities, 'enrich', AsyncMock())
    record = {'id': 'dy:2', 'platform': 'dy', 'url': 'https://www.douyin.com/video/2', 'contentType': 'unknown'}
    await media.enrich(SimpleNamespace(platform='dy', request={}, emit=None, dy_details={'dy:2': raw}), record)
    assert record['contentType'] == 'video'


@pytest.mark.parametrize('record,expected', [
    ({'contentType': 'note', 'images': ['a', 'b'], 'media': {'variants': [{'kind': 'video'}]}}, 'images'),
    ({'contentType': 'video', 'images': ['cover'], 'media': {'variants': [{'kind': 'video'}]}}, 'video'),
    ({'contentType': 'normal', 'images': ['a'], 'media': {'variants': []}}, 'images'),
])
def test_auto_download_prefers_gallery_images(record, expected):
    assert auto_kind(record) == expected
