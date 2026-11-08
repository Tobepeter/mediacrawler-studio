import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from desktop.login_flow import read_qr_image
from mediacrawler_cli.auth import login


@pytest.mark.asyncio
async def test_readable_qr_skips_screenshot_and_cross_origin_falls_back():
    image = b'\x89PNG\r\n\x1a\nfixture'
    locator = SimpleNamespace(
        evaluate=AsyncMock(return_value='data:image/png;base64,' + base64.b64encode(image).decode()),
        screenshot=AsyncMock(return_value=image),
    )
    assert await read_qr_image(locator) == image
    locator.screenshot.assert_not_awaited()
    locator.evaluate.return_value = None
    assert await read_qr_image(locator) == image
    locator.screenshot.assert_awaited_once_with(timeout=5000)


@pytest.mark.asyncio
async def test_qr_delivered_before_second_account_check(monkeypatch, tmp_path):
    events = []
    async def check():
        events.append('check')
        return events.count('check') == 2
    locator = SimpleNamespace(is_visible=AsyncMock(return_value=True))
    crawler = SimpleNamespace(page=object(), platform='dy', check_login=check)
    monkeypatch.setattr('mediacrawler_cli.auth.challenge', AsyncMock(return_value=False))
    monkeypatch.setattr('mediacrawler_cli.auth.open_login', AsyncMock(return_value=locator))
    monkeypatch.setattr('mediacrawler_cli.auth.read_qr_image', AsyncMock(return_value=b'qr'))
    monkeypatch.setattr('mediacrawler_cli.auth.terminal_qr', lambda _: events.append('qr'))
    await login(crawler, {'qr': 'terminal', 'action': 'login', 'login_timeout': 5}, tmp_path)
    assert events == ['check', 'qr', 'check']
    assert not (tmp_path / 'login.png').exists()
