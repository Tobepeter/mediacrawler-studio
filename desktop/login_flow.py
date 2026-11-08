"""桌面和 CLI 共用的登录入口：可见二维码优先，隐藏浏览器不等待鼠标命中测试"""
import asyncio
import base64
from time import monotonic
from playwright.async_api import Error as PlaywrightError

QR = {
    'bili': '.login-scan-box img', 'dy': '#animate_qrcode_container img',
    'xhs': 'img.qrcode-img', 'zhihu': 'canvas.Qrcode-qrcode',
    'wb': '[class*="qrcode"] img, [class*="QRCode"] img, img.w-full.h-full',
    'tieba': 'img.tang-pass-qrcode-img', 'ks': '.qrcode-img img',
}
ENTRY = {
    'bili': '.header-avatar-unlogin-entry, .right-entry__outside.go-login-btn .header-login-entry, .login-btn',
    'dy': "p:text-is('登录')", 'xhs': "button:text-is('登录')",
    'zhihu': "button:text-is('登录'), button:text-is('登录/注册')",
    'wb': "a:has-text('登录'), button:has-text('登录')",
    'tieba': '.user-or-login .login-btn, .u_login',
    'ks': ".sidebar-login-button, p:text-is('登录')",
}
SESSION_COOKIES = {
    # 仅对已确认依赖这些 Cookie 的平台走快速未登录判断
    # 抖音等平台还会检查 localStorage，不能用 Cookie 白名单提前否定
    'bili': {'SESSDATA'},
    'xhs': {'web_session'}, 'zhihu': {'z_c0'}, 'wb': {'SUB'},
    'ks': {'passToken'},
}


async def read_qr_image(locator):
    """已加载图片直接导出，跨域或不可读时再走截图"""
    try:
        data = await locator.evaluate('''element => {
            const canvas = element.tagName === 'CANVAS' ? element : document.createElement('canvas');
            if (element.tagName === 'IMG') {
                if (!element.complete || !element.naturalWidth) return null;
                canvas.width = element.naturalWidth;
                canvas.height = element.naturalHeight;
                canvas.getContext('2d').drawImage(element, 0, 0);
            }
            return canvas.toDataURL('image/png');
        }''', timeout=1000)
        if isinstance(data, str) and data.startswith('data:image/png;base64,') and len(data) <= 2_000_000:
            image = base64.b64decode(data.split(',', 1)[1], validate=True)
            if image.startswith(b'\x89PNG\r\n\x1a\n'):
                return image
    except (PlaywrightError, ValueError):
        pass
    return await locator.screenshot(timeout=5000)


async def open_login(page, platform, timeout=None, evidence=None):
    from desktop.health import POLICY, verification
    if (await verification(page))['status'] == 'detected':
        raise RuntimeError('VERIFICATION_REQUIRED')
    locator = page.locator(QR[platform]).filter(visible=True).first
    next_click = 0
    next_verification = monotonic() + 1
    attempts = 0
    async with asyncio.timeout(timeout if timeout is not None else POLICY['qr_timeout_ms'] / 1000):
        while True:
            try:
                if monotonic() >= next_verification:
                    next_verification = monotonic() + 1
                    if (await verification(page))['status'] == 'detected':
                        raise RuntimeError('VERIFICATION_REQUIRED')
                if await locator.is_visible():
                    return locator
                entry = page.locator(ENTRY[platform]).filter(visible=True).first
                if attempts < 3 and monotonic() >= next_click and await entry.is_visible():
                    if evidence is not None:
                        evidence['entry_seen'] = True
                    # Electron 的后台 WebContentsView 没有前台鼠标 surface
                    await entry.evaluate('(element) => element.click()', timeout=1000)
                    attempts += 1
                    next_click = monotonic() + 2
            except PlaywrightError as error:
                if not any(text in str(error) for text in ('Execution context was destroyed', 'Cannot find context', 'navigation', 'detached', 'Timeout')):
                    raise
            await asyncio.sleep(0.2)
