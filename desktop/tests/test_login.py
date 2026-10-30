from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from desktop.crawler import DesktopCrawler


def runner(events, click):
    page = SimpleNamespace(locator=lambda _: SimpleNamespace(first=SimpleNamespace(click=click)))
    task = DesktopCrawler({'platform': 'bili', 'action': 'connect', 'mode': 'search', 'query': '', 'limit': 5}, page, lambda kind, **data: events.append(kind))
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
    assert events == ['click', 'state', 'account']


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
async def test_tieba_waits_for_login_panel_before_presentation(already_open):
    events = []
    entry = SimpleNamespace(click=AsyncMock(side_effect=lambda **_: events.append('click')))
    qr = SimpleNamespace(
        is_visible=AsyncMock(return_value=already_open),
        wait_for=AsyncMock(side_effect=lambda **_: events.append('ready')),
    )
    page = SimpleNamespace(locator=lambda selector: SimpleNamespace(
        first=qr if 'qrcode' in selector else entry,
    ))
    task = DesktopCrawler({'platform': 'tieba', 'action': 'connect', 'mode': 'search', 'query': '', 'limit': 5}, page, lambda kind, **_: events.append(kind))
    task.logged_in = AsyncMock(side_effect=[False, True])
    task.publish_account = AsyncMock(side_effect=lambda: events.append('account'))
    await task.authenticate()
    assert events == ([] if already_open else ['click']) + ['ready', 'state', 'account']
    if already_open:
        entry.click.assert_not_awaited()


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
