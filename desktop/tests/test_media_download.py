import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from desktop import media_download as download
from desktop.media_resolver import MediaResolver
from media_downloader import MediaItem, MediaType


@pytest.fixture
def transport(monkeypatch):
    original = httpx.AsyncClient
    requests = []
    def install(handler):
        async def handle(request):
            requests.append(request)
            result = handler(request)
            return await result if hasattr(result, '__await__') else result
        monkeypatch.setattr(download.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
        monkeypatch.setattr(download, 'public_request', AsyncMock())
        return requests
    return install


def request(tmp_path, count=2, kind='images'):
    return {'kind': kind, 'directory': str(tmp_path), 'record': {'id': 'xhs:1', 'platform': 'xhs', 'url': 'https://www.xiaohongshu.com/explore/1', 'images': [f'https://cdn.example/{i}.jpg' for i in range(count)]}}


@pytest.mark.asyncio
async def test_images_order_complete_and_no_credentials(tmp_path, transport):
    requests = transport(lambda req: httpx.Response(200, headers={'content-type': 'image/jpeg'}, content=req.url.path.encode()))
    progress = []
    result = await download.download_media(request(tmp_path), lambda event, **data: progress.append(data['saved']))
    assert result == {'saved': 2, 'total': 2, 'code': ''}
    assert (tmp_path / '001.jpg').read_bytes() == b'/0.jpg'
    assert (tmp_path / '002.jpg').read_bytes() == b'/1.jpg'
    assert progress == [1, 2]
    assert not list(tmp_path.glob('.working-*'))
    assert all('cookie' not in req.headers for req in requests)
    assert all(req.headers['referer'] == 'https://www.xiaohongshu.com/' for req in requests)


@pytest.mark.asyncio
@pytest.mark.parametrize('status,code', [(404, 'expired'), (410, 'expired'), (403, 'unavailable'), (401, 'login')])
async def test_partial_results_and_error_reason(tmp_path, transport, status, code):
    transport(lambda req: httpx.Response(200 if req.url.path == '/0.jpg' else status, headers={'content-type': 'image/jpeg'}, content=b'image'))
    result = await download.download_media(request(tmp_path), lambda *args, **kwargs: None)
    assert result == {'saved': 1, 'total': 2, 'code': code}
    assert [p.name for p in tmp_path.iterdir()] == ['001.jpg']


@pytest.mark.asyncio
@pytest.mark.parametrize('mime,code', [('application/vnd.apple.mpegurl', 'unsupported'), ('text/html', 'unavailable')])
async def test_error_page_and_playlist_not_saved(tmp_path, transport, monkeypatch, mime, code):
    transport(lambda req: httpx.Response(200, headers={'content-type': mime}, content=b'not media'))
    monkeypatch.setattr(download.DesktopMediaDownloader, '_retry_delay', lambda *args: 0)
    result = await download.download_media(request(tmp_path, count=1), lambda *args, **kwargs: None)
    assert result['saved'] == 0
    assert result['code'] == code
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_cancel_preserves_completed_cleans_working(tmp_path, transport):
    started = asyncio.Event()
    async def handle(req):
        if req.url.path == '/1.jpg':
            started.set()
            await asyncio.Event().wait()
        return httpx.Response(200, headers={'content-type': 'image/jpeg'}, content=b'image')
    transport(handle)
    task = asyncio.create_task(download.download_media(request(tmp_path), lambda *args, **kwargs: None))
    await asyncio.wait_for(started.wait(), 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert [p.name for p in tmp_path.iterdir()] == ['001.jpg']


@pytest.mark.asyncio
async def test_private_and_insecure_urls_rejected(monkeypatch):
    for url in ['http://example.com/image', 'https://user:pass@example.com/image', 'https://example.com:123/image']:
        with pytest.raises(RuntimeError, match='unsupported'):
            await download.public_request(httpx.Request('GET', url))
    monkeypatch.setattr(asyncio.get_running_loop(), 'getaddrinfo', AsyncMock(return_value=[(0, 0, 0, '', ('127.0.0.1', 443))]))
    with pytest.raises(RuntimeError, match='unsupported'):
        await download.public_request(httpx.Request('GET', 'https://localhost/image'))


def resolver(platform):
    result = MediaResolver({'id': f'{platform}:123', 'platform': platform, 'url': 'https://example.com/video/123'}, SimpleNamespace())
    result.runner = SimpleNamespace(setup=AsyncMock(), check_login=AsyncMock(return_value=True), client=SimpleNamespace(), crawler=SimpleNamespace())
    return result


def test_resolver_reuses_platform_page():
    item = MediaResolver({'id': 'dy:123', 'platform': 'dy', 'url': 'https://www.douyin.com/video/123'}, SimpleNamespace())
    assert item.runner.request['reusePage'] is True


@pytest.mark.asyncio
async def test_video_login_checked_before_fetch():
    item = resolver('dy')
    item.runner.check_login.return_value = False
    with pytest.raises(RuntimeError, match='login'):
        await anext(item.videos())


@pytest.mark.asyncio
async def test_douyin_uses_native_media_extractor():
    item = resolver('dy')
    item.runner.client.get_video_by_id = AsyncMock(return_value={'aweme_id': '123', 'video': {'play_addr': {'url_list': ['https://cdn.example/video.mp4', 'https://backup.example/video.mp4']}}})
    videos = [video async for video in item.videos()]
    assert len(videos) == 1
    assert {videos[0].url, *videos[0].backup_urls} == {'https://cdn.example/video.mp4', 'https://backup.example/video.mp4'}


@pytest.mark.asyncio
async def test_bili_complete_mp4_fallback_and_reject_partial(monkeypatch):
    monkeypatch.setattr('desktop.media_resolver.is_available', lambda: False)
    item = resolver('bili')
    item.runner.crawler.get_video_info_task = AsyncMock(return_value={'View': {'cid': 7}})
    item.runner.crawler.get_video_play_url_task = AsyncMock(return_value={'durl': [{'url': 'https://cdn.example/video.mp4'}]})
    assert len([video async for video in item.videos()]) == 1
    item.runner.crawler.get_video_play_url_task.return_value['durl'].append({'url': 'https://cdn.example/part2.mp4'})
    with pytest.raises(RuntimeError, match='unsupported'):
        await anext(item.videos())


@pytest.mark.asyncio
async def test_video_refresh_and_candidate_fallback(tmp_path, transport, monkeypatch):
    requests = transport(lambda req: httpx.Response(403 if 'old' in str(req.url) else 200, headers={'content-type': 'video/mp4'}, content=b'video'))
    async def videos(self):
        for name in ('old', 'fresh'):
            yield MediaItem(url=f'https://cdn.example/{name}.mp4', media_type=MediaType.VIDEO, content_id='1', stem='video')
    monkeypatch.setattr(MediaResolver, 'videos', videos)
    result = await download.download_media(request(tmp_path, kind='video'), lambda *args, **kwargs: None)
    assert result == {'saved': 1, 'total': 1, 'code': ''}
    assert len(requests) == 2
    assert (tmp_path / 'video.mp4').read_bytes() == b'video'


def video_request(tmp_path):
    return {'kind': 'video', 'directory': str(tmp_path), 'record': {
        'id': 'bili:123', 'platform': 'bili', 'url': 'https://www.bilibili.com/video/av123', 'images': [],
        'media': {'variants': [
            {'id': 'v', 'kind': 'video', 'url': 'https://cdn.example/old.mp4', 'height': 1080, 'hasAudio': False},
            {'id': 'a', 'kind': 'audio', 'url': 'https://cdn.example/audio.m4a'},
        ]},
    }}


@pytest.mark.asyncio
@pytest.mark.parametrize('missing_ffmpeg', [True, False])
async def test_shared_download_refreshes_existing_candidates(tmp_path, transport, monkeypatch, missing_ffmpeg):
    requested = transport(lambda req: httpx.Response(404 if 'old' in req.url.path else 200,
        headers={'content-type': 'video/mp4'}, content=b'video'))
    monkeypatch.setattr('media_downloader.ffmpeg.is_available', lambda: not missing_ffmpeg)
    value = video_request(tmp_path)
    if not missing_ffmpeg:
        value['record']['media']['variants'][0]['hasAudio'] = True
    refreshed = []
    async def videos(self):
        refreshed.append(self.record)
        yield MediaItem(url='https://cdn.example/fresh.mp4', media_type=MediaType.VIDEO, content_id='123', stem='video')
    monkeypatch.setattr(MediaResolver, 'videos', videos)
    result = await download.download_record(value, lambda *a, **k: None, SimpleNamespace())
    assert result['saved'] == 1 and result['fallback'] and result['code'] == ''
    assert (tmp_path / 'video.mp4').read_bytes() == b'video'
    assert len(refreshed) == 1 and refreshed[0]['media'] is None
    assert [req.url.path for req in requested] == (['/fresh.mp4'] if missing_ffmpeg else ['/old.mp4', '/fresh.mp4'])


@pytest.mark.asyncio
@pytest.mark.parametrize('options,context', [({}, False), ({'quality': 'worst'}, True), ({'variant_id': 'v'}, True)])
async def test_offline_or_pinned_quality_does_not_fallback(tmp_path, transport, monkeypatch, options, context):
    requested = transport(lambda req: pytest.fail('缺少 FFmpeg 时不应下载分轨'))
    monkeypatch.setattr('media_downloader.ffmpeg.is_available', lambda: False)
    result = await download.download_record({**video_request(tmp_path), **options}, lambda *a, **k: None,
                                            SimpleNamespace() if context else None)
    assert result['code'] == 'ffmpeg_required'
    assert not result['fallback'] and not requested


@pytest.mark.asyncio
@pytest.mark.parametrize('code', ['disk', 'cancelled'])
async def test_download_disk_failure_and_cancel_do_not_refresh(tmp_path, monkeypatch, code):
    transfer = AsyncMock(return_value={'saved': 0, 'total': 1, 'code': code})
    monkeypatch.setattr(download, 'download_media', transfer)
    value = video_request(tmp_path)
    value['record']['media']['variants'][0]['hasAudio'] = True
    result = await download.download_record(value, lambda *a, **k: None, SimpleNamespace())
    assert result['code'] == code and not result['fallback']
    transfer.assert_awaited_once()


@pytest.mark.asyncio
async def test_specific_quality_requeries_when_stored_address_fails(monkeypatch):
    from desktop import media_download
    from desktop.content import detail
    stored = {'id': 'bili:1', 'platform': 'bili', 'url': 'https://www.bilibili.com/video/av1', 'contentType': 'video', 'media': {'variants': [{'id': 'old'}]}}
    fresh = {**stored, 'media': {'variants': [{'id': 'new'}]}}
    attempts = []

    async def download(request, emit, page):
        attempts.append(request['items'])
        return {'saved': 1 if len(attempts) == 2 else 0, 'total': 1, 'code': '' if len(attempts) == 2 else 'expired'}

    async def refreshed(record, page, runner, quality):
        return fresh
    monkeypatch.setattr(media_download, 'download_media', download)
    monkeypatch.setattr(detail, 'refreshed', refreshed)
    monkeypatch.setattr('media_downloader.selection.choose_items', lambda record, quality, variant: [SimpleNamespace(url=record['media']['variants'][0]['id'], is_dash=False)])
    result = await media_download.download_record({'record': stored, 'kind': 'video', 'quality': '720p', 'runner': object()}, lambda *a, **k: None)
    assert [items[0].url for items in attempts] == ['old', 'new']
    assert result['saved'] == 1


@pytest.mark.asyncio
async def test_specific_quality_without_variants_fetches_first(monkeypatch):
    from desktop import media_download
    from desktop.content import detail
    stored = {'id': 'bili:1', 'platform': 'bili', 'url': 'https://www.bilibili.com/video/av1', 'contentType': 'video'}

    async def refreshed(record, page, runner, quality):
        return {**stored, 'media': {'variants': [{'id': 'new'}]}}

    async def download(request, emit, page):
        return {'saved': 1, 'total': 1, 'code': '', 'used': request['items']}
    monkeypatch.setattr(media_download, 'download_media', download)
    monkeypatch.setattr(detail, 'refreshed', refreshed)
    monkeypatch.setattr('media_downloader.selection.choose_items', lambda record, quality, variant: [SimpleNamespace(url=record['media']['variants'][0]['id'], is_dash=False)])
    result = await media_download.download_record({'record': stored, 'kind': 'video', 'quality': '720p', 'runner': object()}, lambda *a, **k: None)
    assert result['used'][0].url == 'new'


@pytest.mark.asyncio
async def test_desktop_saves_flat_with_given_name(tmp_path, transport):
    transport(lambda req: httpx.Response(200, headers={'content-type': 'image/jpeg'}, content=req.url.path.encode()))
    result = await download.download_media({**request(tmp_path), 'fileName': '作者 - 标题'}, lambda *a, **k: None)
    assert result['saved'] == 2
    assert sorted(p.name for p in tmp_path.iterdir()) == ['作者 - 标题 001.jpg', '作者 - 标题 002.jpg']


@pytest.mark.asyncio
async def test_same_name_is_not_overwritten(tmp_path, transport):
    transport(lambda req: httpx.Response(200, headers={'content-type': 'image/jpeg'}, content=b'new'))
    (tmp_path / '作者 - 标题.jpg').write_bytes(b'old')
    result = await download.download_media({**request(tmp_path, count=1), 'fileName': '作者 - 标题'}, lambda *a, **k: None)
    assert result['saved'] == 1
    assert (tmp_path / '作者 - 标题.jpg').read_bytes() == b'old'
    assert (tmp_path / '作者 - 标题 (2).jpg').read_bytes() == b'new'



def test_delivery_falls_back_when_disk_has_no_hard_links(tmp_path, monkeypatch):
    """exFAT 这类盘不支持硬链接，退回独占文件名后移动，不覆盖已有文件"""
    import errno
    import os
    from desktop.media_download import link_unique

    def no_links(*_):
        raise OSError(errno.ENOTSUP, 'not supported')
    monkeypatch.setattr(os, 'link', no_links)
    (tmp_path / 'a.mp4').write_text('old')
    source = tmp_path / 'work.mp4'
    source.write_text('new')
    target = link_unique(source, tmp_path, 'a.mp4')
    assert target.name == 'a (2).mp4' and target.read_text() == 'new'
    assert (tmp_path / 'a.mp4').read_text() == 'old' and not source.exists()
