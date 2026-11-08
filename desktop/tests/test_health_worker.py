import base64
from unittest.mock import AsyncMock

import pytest

from desktop.health_worker import read_hidden_qr

PNG = b'\x89PNG\r\n\x1a\nsample'


@pytest.mark.asyncio
async def test_hidden_qr_prefers_loaded_resource():
    locator = AsyncMock()
    locator.evaluate.return_value = 'https://example.com/qr.png'
    cdp = AsyncMock()
    cdp.send.side_effect = [
        {'frameTree': {'frame': {'id': 'frame'}}},
        {'content': base64.b64encode(PNG).decode(), 'base64Encoded': True},
    ]
    assert await read_hidden_qr(locator, cdp) == PNG
    locator.bounding_box.assert_not_called()


@pytest.mark.asyncio
async def test_canvas_uses_cdp_screenshot_without_foreground():
    locator = AsyncMock()
    locator.evaluate.return_value = ''
    locator.bounding_box.return_value = {'x': 2, 'y': 3, 'width': 160, 'height': 160}
    cdp = AsyncMock()
    cdp.send.return_value = {'data': base64.b64encode(PNG).decode()}
    assert await read_hidden_qr(locator, cdp) == PNG
    cdp.send.assert_awaited_once_with('Page.captureScreenshot', {
        'format': 'png', 'captureBeyondViewport': True,
        'clip': {'x': 2, 'y': 3, 'width': 160, 'height': 160, 'scale': 1},
    })


@pytest.mark.asyncio
async def test_missing_qr_is_not_success():
    locator = AsyncMock()
    locator.evaluate.return_value = ''
    locator.bounding_box.return_value = None
    with pytest.raises(ValueError):
        await read_hidden_qr(locator, AsyncMock())


@pytest.mark.asyncio
async def test_browser_connect_retries_once_without_theme_override(monkeypatch):
    from types import SimpleNamespace
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    from desktop import health_worker
    import playwright.async_api

    browser = SimpleNamespace(contexts=[])
    chromium = SimpleNamespace(connect_over_cdp=AsyncMock(side_effect=[PlaywrightTimeoutError('busy'), browser]))
    runtime = AsyncMock()
    runtime.__aenter__.return_value = SimpleNamespace(chromium=chromium)
    monkeypatch.setattr(playwright.async_api, 'async_playwright', lambda: runtime)
    monkeypatch.setattr(health_worker, 'diagnose_network', AsyncMock(return_value={'type': 'network'}))
    emitted = []
    await health_worker.run({'endpoint': 'unused', 'targets': {}}, emitted.append)
    assert chromium.connect_over_cdp.await_count == 2
    assert all(call.kwargs['no_defaults'] is True for call in chromium.connect_over_cdp.await_args_list)
    chromium.connect_over_cdp.reset_mock(side_effect=True)
    chromium.connect_over_cdp.side_effect = PlaywrightTimeoutError('busy')
    with pytest.raises(PlaywrightTimeoutError):
        await health_worker.run({'endpoint': 'unused', 'targets': {}}, emitted.append)
    assert chromium.connect_over_cdp.await_count == 2
