from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from desktop.crawler import DesktopCrawler


@pytest.fixture(autouse=True)
def login_entry(monkeypatch):
    async def open_entry(page, platform):
        await page.locator('entry').first.click()
    monkeypatch.setattr('desktop.crawler.open_login', open_entry)


def runner(events, click):
    page = SimpleNamespace(locator=lambda _: SimpleNamespace(first=SimpleNamespace(click=click)))
    task = DesktopCrawler({'platform': 'bili', 'action': 'connect', 'mode': 'search', 'query': '', 'limit': 5, 'loginMode': 'qrcode'}, page, lambda kind, **data: events.append(kind) if kind != 'timing' else None)
    task.publish_account = AsyncMock(side_effect=lambda: events.append('account'))
    return task


@pytest.mark.asyncio
async def test_saved_login_does_not_present_page():
    events = []
    click = AsyncMock()
    task = runner(events, click)
    task.logged_in = AsyncMock(return_value=True)
    await task.authenticate()
    assert events == ['account']
    click.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('platform', ['bili', 'ks'])
async def test_empty_session_skips_network_but_douyin_keeps_storage_check(platform):
    task = runner([], AsyncMock())
    task.platform = platform
    task.crawler = SimpleNamespace(cookie_urls=['https://www.bilibili.com'])
    task.context = SimpleNamespace(cookies=AsyncMock(return_value=[]))
    task.client = SimpleNamespace(update_cookies=AsyncMock(), pong=AsyncMock(return_value=True))
    assert not await task.logged_in()
    task.client.pong.assert_not_awaited()
    task.client.update_cookies.assert_not_awaited()
    task.platform = 'dy'
    assert await task.logged_in()
    task.client.pong.assert_awaited_once_with(task.context)


@pytest.mark.asyncio
@pytest.mark.parametrize('current,reuse,expected_navigation', [
    ('https://www.bilibili.com/', True, False),
    ('https://bilibili.com/', True, False),
    ('data:text/html,studio-bili', True, True),
    ('https://another.example/', True, True),
    ('https://www.bilibili.com/', False, True),
])
async def test_setup_only_reuses_matching_desktop_page(monkeypatch, current, reuse, expected_navigation):
    task = runner([], AsyncMock())
    task.request['reusePage'] = reuse
    task.page = SimpleNamespace(
        context=SimpleNamespace(new_cdp_session=AsyncMock()),
        url=current, evaluate=AsyncMock(return_value='test'),
        on=lambda *_: None, goto=AsyncMock(),
    )
    crawler = SimpleNamespace(index_url='https://www.bilibili.com', create_client=AsyncMock())
    monkeypatch.setattr('desktop.crawler.create_native', lambda *_: (crawler, 'create_client', 'client'))
    await task.setup()
    assert bool(task.page.goto.await_count) == expected_navigation


@pytest.mark.asyncio
@pytest.mark.parametrize('failed', [False, True])
async def test_login_entry_prepared_before_presentation(failed):
    events = []
    async def click(**_):
        events.append('click')
        if failed:
            raise TimeoutError()
    task = runner(events, click)
    task.logged_in = AsyncMock(side_effect=[False, True])
    await task.authenticate()
    assert events == ['state', 'click', 'account']


@pytest.mark.asyncio
async def test_redirect_after_scan_keeps_waiting_until_login_confirmed(monkeypatch):
    from playwright.async_api import Error
    monkeypatch.setattr('desktop.crawler.asyncio.sleep', AsyncMock())
    events = []
    task = runner(events, AsyncMock())
    task.platform = 'dy'
    task.logged_in = AsyncMock(side_effect=[
        False,
        Error('Execution context was destroyed, most likely because of a navigation'),
        Error('Cannot find context with specified id'),
        True,
    ])
    await task.authenticate()
    assert events == ['state', 'account']
    assert task.logged_in.await_count == 4


@pytest.mark.asyncio
async def test_login_check_does_not_swallow_closed_page_or_retry_forever(monkeypatch):
    from playwright.async_api import Error
    sleep = AsyncMock()
    monkeypatch.setattr('desktop.crawler.asyncio.sleep', sleep)
    task = runner([], AsyncMock())
    task.logged_in = AsyncMock(side_effect=Error('Target page, context or browser has been closed'))
    with pytest.raises(Error, match='has been closed'):
        await task.check_login()
    assert task.logged_in.await_count == 1
    sleep.assert_not_awaited()
    task.logged_in = AsyncMock(side_effect=Error('Execution context was destroyed'))
    with pytest.raises(Error, match='Execution context'):
        await task.check_login()
    assert task.logged_in.await_count == 5


@pytest.mark.asyncio
async def test_cancel_during_navigation_retry_is_not_swallowed(monkeypatch):
    import asyncio
    from playwright.async_api import Error
    monkeypatch.setattr('desktop.crawler.asyncio.sleep', AsyncMock(side_effect=asyncio.CancelledError()))
    task = runner([], AsyncMock())
    task.logged_in = AsyncMock(side_effect=Error('Execution context was destroyed'))
    with pytest.raises(asyncio.CancelledError):
        await task.check_login()


@pytest.mark.asyncio
@pytest.mark.parametrize('already_open', [False, True])
async def test_tieba_reuses_visible_qr_without_clicking_again(already_open):
    from desktop.login_flow import open_login
    events = []
    entry = SimpleNamespace(is_visible=AsyncMock(return_value=True), evaluate=AsyncMock(side_effect=lambda *a, **kw: events.append('click')))
    qr = SimpleNamespace(is_visible=AsyncMock(side_effect=[already_open, True]))
    page = SimpleNamespace(locator=lambda selector: SimpleNamespace(filter=lambda **_: SimpleNamespace(first=qr if 'qrcode' in selector else entry)))
    assert await open_login(page, 'tieba') is qr
    assert events == ([] if already_open else ['click'])


@pytest.mark.asyncio
@pytest.mark.parametrize('platform', ['bili', 'dy', 'xhs', 'zhihu', 'wb', 'tieba', 'ks'])
@pytest.mark.parametrize('connected', [False, True])
async def test_silent_connect_only_checks_existing_session(platform, connected):
    events = []
    task = runner(events, AsyncMock())
    task.platform = platform
    task.request.update(platform=platform, silent=True)
    task.setup = AsyncMock()
    task.check_login = AsyncMock(return_value=connected)
    task.authenticate = AsyncMock()
    await task.run()
    task.authenticate.assert_not_awaited()
    assert events == (['account', 'done'] if connected else ['login-required', 'done'])
