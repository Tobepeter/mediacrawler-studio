import asyncio
import hashlib
import sys
import time

from desktop.login_flow import open_login, read_qr_image

# 二维码文件名要能看出是哪个平台
QR_NAMES = {'bili': 'bilibili', 'dy': 'douyin', 'xhs': 'xiaohongshu', 'ks': 'kuaishou', 'wb': 'weibo'}


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


async def challenge(page):
    from desktop.health import verification
    return (await verification(page))['status'] == 'detected'


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
    qr_path = run_dir / f'{QR_NAMES.get(crawler.platform, crawler.platform)}-login.png'
    try:
        while time.monotonic() < deadline:
            if not browser_mode and locator is not None and await locator.is_visible():
                data = await read_qr_image(locator)
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
                        # 只给路径，不弹系统预览，二维码刷新时路径会再输出一次
                        print(f'登录二维码：{qr_path}', file=sys.stderr, flush=True)
                    previous = digest
            if await crawler.check_login():
                return
            await asyncio.sleep(3)
        raise RuntimeError('AUTH_TIMEOUT')
    finally:
        qr_path.unlink(missing_ok=True)
