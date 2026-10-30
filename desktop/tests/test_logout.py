from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from desktop.logout import logout
from mediacrawler_cli.browser import options


@pytest.mark.asyncio
async def test_remote_logout_click_confirm_then_verify():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--mute-audio'], **options(p))
        try:
            page = await browser.new_page()
            state = {'logged_in': True, 'called': 0}
            async def route(request):
                if request.request.url.endswith('/logout'):
                    state.update(logged_in=False, called=state['called'] + 1)
                    await request.fulfill(body='ok')
                else:
                    html = '''<button onclick="document.querySelector('[role=dialog]').hidden=false">退出登录</button>
                    <div role="dialog" hidden>确认退出登录？<button onclick="fetch('/logout').then(()=>this.parentElement.hidden=true)">确定</button></div>''' if state['logged_in'] else '<button>登录</button>'
                    await request.fulfill(content_type='text/html; charset=utf-8', body=html)
            await page.route('https://fixture.test/**', route)
            crawler = SimpleNamespace(platform='bili', page=page, crawler=SimpleNamespace(index_url='https://fixture.test/'),
                check_login=AsyncMock(side_effect=lambda: state['logged_in']))
            async def setup():
                await page.goto('https://fixture.test/')
            crawler.setup = setup
            outcome = await logout(crawler)
            assert outcome['remote'] == 'confirmed', (outcome, state)
            assert state['called'] == 1
        finally:
            await browser.close()


@pytest.mark.asyncio
async def test_missing_entry_is_not_remote_success():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--mute-audio'], **options(p))
        try:
            page = await browser.new_page()
            await page.set_content('<article>退出登录</article>')
            crawler = SimpleNamespace(platform='bili', page=page, setup=AsyncMock(), check_login=AsyncMock(return_value=True))
            outcome = await logout(crawler)
            assert outcome['remote'] == 'not_confirmed'
            assert outcome['reason'] == 'entry_unavailable'
        finally:
            await browser.close()


@pytest.mark.asyncio
async def test_platform_error_does_not_count_as_logout():
    crawler = SimpleNamespace(platform='dy', setup=AsyncMock(side_effect=RuntimeError('network')))
    assert (await logout(crawler))['remote'] == 'not_confirmed'
