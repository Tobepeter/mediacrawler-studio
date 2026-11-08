"""设置面板全量诊断，复用 CLI 检查逻辑，不触碰用户登录分区"""
import asyncio
import base64
import json
import sys

from desktop.health import URLS, check_page, classify
from desktop.health_network import diagnose_network


async def read_hidden_qr(locator, cdp):
    """隐藏 Electron 页面优先读取已加载资源，截图不依赖前台合成器"""
    try:
        source = await locator.evaluate("element => element.currentSrc || element.src || ''")
        if source:
            tree = await cdp.send('Page.getResourceTree')
            resource = await cdp.send('Page.getResourceContent', {
                'frameId': tree['frameTree']['frame']['id'], 'url': source})
            data = base64.b64decode(resource['content']) if resource['base64Encoded'] else resource['content'].encode()
            if data.startswith(b'\x89PNG\r\n\x1a\n'):
                return data
    except Exception:
        pass
    rect = await locator.bounding_box()
    if not rect:
        raise ValueError('Missing QR bounds')
    result = await cdp.send('Page.captureScreenshot', {
        'format': 'png', 'captureBeyondViewport': True,
        'clip': {**rect, 'scale': 1},
    })
    return base64.b64decode(result['data'])


async def run(request, emit):
    from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

    emit(await diagnose_network(URLS.values()))
    async with async_playwright() as playwright:
        # 冷启动时多个平台同时附着 CDP，连接层允许一次有界重试
        for attempt in range(2):
            try:
                browser = await playwright.chromium.connect_over_cdp(
                    request['endpoint'], timeout=15000, no_defaults=True)
                break
            except PlaywrightTimeoutError:
                if attempt:
                    raise
        pages = {page.url: page for context in browser.contexts for page in context.pages}
        semaphore = asyncio.Semaphore(3)

        async def check(platform, url):
            async with semaphore:
                try:
                    page = pages[url]
                    cdp = await page.context.new_cdp_session(page)
                    try:
                        await cdp.send('Emulation.setDeviceMetricsOverride', {
                            'width': 1060, 'height': 780, 'deviceScaleFactor': 1, 'mobile': False})
                        report = await check_page(page, platform,
                                                  image_reader=lambda locator: read_hidden_qr(locator, cdp))
                    finally:
                        await cdp.detach()
                except Exception as error:
                    report = {'type': 'platform', 'platform': platform, 'status': 'failed',
                              'error': classify(error, 'browser')}
                emit(report)

        await asyncio.gather(*(check(platform, url) for platform, url in request['targets'].items()))
        # 不关闭 Electron browser/context，所有临时页面由主进程统一释放


if __name__ == '__main__':
    protocol = sys.stdout
    sys.stdout = sys.stderr

    def emit(report):
        protocol.write(json.dumps(report, ensure_ascii=False) + '\n')
        protocol.flush()

    try:
        asyncio.run(run(json.loads(sys.stdin.readline()), emit))
    except Exception as error:
        emit({'type': 'error', 'error': classify(error, 'worker')})
        raise SystemExit(1)
