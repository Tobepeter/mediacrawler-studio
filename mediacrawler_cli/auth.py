import asyncio
import hashlib
import subprocess
import sys
import time

QR = {
    'bili': '.login-scan-box img', 'dy': '#animate_qrcode_container img',
    'xhs': 'img.qrcode-img', 'zhihu': 'canvas.Qrcode-qrcode',
    'wb': '[class*="qrcode"] img, [class*="QRCode"] img, img.w-full.h-full',
    'tieba': 'img.tang-pass-qrcode-img', 'ks': '.qrcode-img img',
}
ENTRY = {
    'bili': '.header-avatar-unlogin-entry, .right-entry__outside.go-login-btn .header-login-entry',
    'dy': "p:text-is('登录')", 'xhs': "button:text-is('登录')",
    'zhihu': "button:text-is('登录'), button:text-is('登录/注册')",
    'wb': "a:text-is('登录'), button:text-is('登录')",
    'tieba': '.user-or-login .login-btn:visible, .u_login:visible', 'ks': "p:text-is('登录')",
}


def terminal_qr(image):
    import cv2
    import numpy as np
    import qrcode
    pixels = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_COLOR)
    payload, _, _ = cv2.QRCodeDetector().detectAndDecode(pixels)
    if not payload:
        raise ValueError('QR_DECODE_FAILED：请改用 --login-mode image 或 --login-mode browser')
    qr = qrcode.QRCode(border=2)
    qr.add_data(payload)
    qr.make(fit=True)
    qr.print_ascii(out=sys.stderr, invert=True)


async def open_login(page, platform):
    locator = page.locator(QR[platform]).filter(visible=True).first
    if not await locator.is_visible():
        await page.locator(ENTRY[platform]).filter(visible=True).first.click(timeout=10000)
    await locator.wait_for(state='visible', timeout=15000)
    return locator


async def challenge(page):
    return await page.locator('#captcha_container:visible, #captcha-verify-container:visible, .captcha_verify_container:visible').count() > 0


async def login(crawler, request, run_dir):
    if await crawler.check_login():
        return
    browser_mode = request.get('qr') == 'browser'
    if await challenge(crawler.page) and not browser_mode:
        raise RuntimeError('VERIFICATION_REQUIRED')
    if request.get('non_interactive') or request['action'] == 'status':
        raise RuntimeError('AUTH_REQUIRED')
    try:
        locator = await open_login(crawler.page, crawler.platform)
    except Exception:
        if not browser_mode:
            raise RuntimeError('VERIFICATION_REQUIRED' if await challenge(crawler.page) else 'QR_UNAVAILABLE') from None
        locator = None
        print('请在打开的浏览器中完成登录或验证', file=sys.stderr)
    deadline, previous = time.monotonic() + request['login_timeout'], None
    qr_path = run_dir / 'login.png'
    try:
        while time.monotonic() < deadline:
            if await crawler.check_login():
                return
            if not browser_mode and locator is not None and await locator.is_visible():
                data = await locator.screenshot(timeout=5000)
                digest = hashlib.sha256(data).hexdigest()
                if digest != previous:
                    if request['qr'] == 'terminal':
                        try:
                            terminal_qr(data)
                        except ValueError:
                            raise RuntimeError('QR_DECODE_FAILED') from None
                    else:
                        qr_path.write_bytes(data)
                        qr_path.chmod(0o600)
                        opener = 'open' if sys.platform == 'darwin' else 'xdg-open'
                        if sys.platform == 'win32':
                            import os
                            os.startfile(qr_path)
                        else:
                            subprocess.run([opener, str(qr_path)], timeout=10, check=True, stdout=sys.stderr)
                    previous = digest
            await asyncio.sleep(3)
        raise RuntimeError('AUTH_TIMEOUT')
    finally:
        qr_path.unlink(missing_ok=True)
