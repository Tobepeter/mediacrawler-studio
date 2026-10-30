from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from desktop.crawler import DesktopCrawler
from desktop.media_resolver import resolve_playback

RECORD = {'platform': 'dy', 'id': 'dy:123', 'url': 'https://www.douyin.com/video/123'}


@pytest.mark.asyncio
async def test_playback_uses_native_extractor_and_refreshes(monkeypatch):
    fetch = AsyncMock(return_value={'aweme_id': '123', 'video': {'play_addr_h264': {'url_list': ['http://example.com/backup.mp4', 'https://example.com/current.mp4']}}})
    async def setup(runner):
        runner.client = SimpleNamespace(get_video_by_id=fetch)
        runner.crawler = object()
    monkeypatch.setattr(DesktopCrawler, 'setup', setup)
    monkeypatch.setattr(DesktopCrawler, 'check_login', AsyncMock(return_value=True))
    validate = AsyncMock()
    monkeypatch.setattr('desktop.media_download.public_request', validate)
    result = await resolve_playback(RECORD, None)
    assert result == {'urls': ['https://example.com/current.mp4', 'https://example.com/backup.mp4'], 'code': ''}
    await resolve_playback(RECORD, None)
    assert fetch.await_count == 2
    assert validate.await_count == 4
    assert all('cookie' not in call.args[0].headers for call in validate.call_args_list)


@pytest.mark.asyncio
async def test_playback_requires_login_and_a_video(monkeypatch):
    async def setup(runner):
        runner.client = SimpleNamespace(get_video_by_id=AsyncMock(return_value={'aweme_id':'123','images':[]}))
        runner.crawler = object()
    monkeypatch.setattr(DesktopCrawler,'setup',setup)
    monkeypatch.setattr(DesktopCrawler,'check_login',AsyncMock(return_value=False))
    with pytest.raises(RuntimeError, match='login'):
        await resolve_playback(RECORD,None)
    monkeypatch.setattr(DesktopCrawler,'check_login',AsyncMock(return_value=True))
    assert await resolve_playback(RECORD,None) == {'urls':[], 'code':'unsupported'}
    with pytest.raises(RuntimeError, match='unsupported'):
        await resolve_playback({**RECORD,'platform':'bili'},None)


@pytest.mark.asyncio
async def test_playback_rejects_untrusted_media_target(monkeypatch):
    async def setup(runner):
        runner.client = SimpleNamespace(get_video_by_id=AsyncMock(return_value={'aweme_id':'123','video':{'play_addr':{'url_list':['https://127.0.0.1/video.mp4']}}}))
        runner.crawler = object()
    monkeypatch.setattr(DesktopCrawler,'setup',setup)
    monkeypatch.setattr(DesktopCrawler,'check_login',AsyncMock(return_value=True))
    with pytest.raises(RuntimeError, match='unsupported'):
        await resolve_playback(RECORD,None)
