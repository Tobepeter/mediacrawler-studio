"""共用诊断协议：只返回阶段、状态和安全的错误分类"""
import asyncio
import json
from pathlib import Path
from datetime import datetime, timezone
from time import monotonic

POLICY = json.loads(Path(__file__).with_name('health-policy.json').read_text())
ERRORS = ('NETWORK_OFFLINE', 'DNS_FAILED', 'CONNECTION_FAILED', 'TLS_FAILED',
          'HTTP_ERROR', 'ACCESS_RESTRICTED', 'VERIFICATION_REQUIRED',
          'LOGIN_ENTRY_NOT_FOUND', 'QR_NOT_FOUND', 'QR_IMAGE_FAILED', 'TIMEOUT', 'UNKNOWN')
URLS = {
    'bili': 'https://www.bilibili.com', 'dy': 'https://www.douyin.com',
    'xhs': 'https://www.xiaohongshu.com', 'zhihu': 'https://www.zhihu.com',
    'wb': 'https://www.weibo.com', 'tieba': 'https://tieba.baidu.com',
    'ks': 'https://www.kuaishou.com',
}


def failure(code, stage, **details):
    return {'code': code, 'stage': stage, 'retryable': code in (
        'DNS_FAILED', 'CONNECTION_FAILED', 'HTTP_ERROR', 'TIMEOUT', 'QR_IMAGE_FAILED'), **details}


def classify(error, stage):
    text = str(error).upper()
    if 'ERR_INTERNET_DISCONNECTED' in text:
        code = 'NETWORK_OFFLINE'
    elif 'VERIFICATION_REQUIRED' in text:
        code = 'VERIFICATION_REQUIRED'
    elif 'NAME_NOT_RESOLVED' in text or 'GETADDRINFO' in text:
        code = 'DNS_FAILED'
    elif 'CERT_' in text or 'SSL' in text or 'TLS' in text:
        code = 'TLS_FAILED'
    elif isinstance(error, TimeoutError) or 'TIMEOUT' in type(error).__name__.upper() or 'TIMED OUT' in text:
        code = 'TIMEOUT'
    elif any(word in text for word in ('ERR_CONNECTION', 'ERR_PROXY', 'ERR_TUNNEL', 'CONNECTERROR')) or type(error).__name__ == 'ConnectError':
        code = 'CONNECTION_FAILED'
    elif stage == 'qr_image':
        code = 'QR_IMAGE_FAILED'
    else:
        code = 'UNKNOWN'
    return failure(code, stage)


async def verification(page):
    try:
        selectors = '#captcha_container:visible, #captcha-verify-container:visible, .captcha_verify_container:visible, #nc_1_wrapper:visible'
        visible = await page.locator(selectors).count() > 0
        if not visible:
            visible = await page.get_by_text(__import__('re').compile('请完成安全验证|请完成下方验证|拖动滑块完成拼图')).first.is_visible()
        return {'status': 'detected' if visible else 'not_detected', 'type': 'captcha' if visible else None}
    except Exception:
        return {'status': 'unknown', 'type': None}


async def check_page(page, platform, timeout_ms=None, image_reader=None):
    from desktop.login_flow import open_login, read_qr_image, ENTRY
    started = monotonic()
    report = {'type': 'platform', 'platform': platform, 'status': 'failed',
              'checked_at': datetime.now(timezone.utc).isoformat(),
              'policy': {**POLICY, 'qr_timeout_ms': timeout_ms or POLICY['qr_timeout_ms']}, 'stages': {}, 'verification': {'status': 'unknown'}}
    stage = 'navigation'
    evidence = {'entry_seen': False}
    async def perform():
        nonlocal stage
        response = await page.goto(URLS[platform], wait_until='domcontentloaded', timeout=POLICY['navigation_timeout_ms'])
        status = response.status if response else None
        report['stages']['http'] = {'status': 'ok' if status and status < 400 else 'failed', 'status_code': status, 'transport': 'browser', 'duration_ms': round((monotonic() - started) * 1000)}
        report['verification'] = await verification(page)
        if report['verification']['status'] == 'detected':
            report['error'] = failure('VERIFICATION_REQUIRED', 'login')
            return
        if status and status >= 400:
            report['error'] = failure('ACCESS_RESTRICTED' if status in (403, 429) else 'HTTP_ERROR', 'http', status_code=status)
            return
        stage = 'login'
        try:
            locator = await open_login(page, platform, timeout=(timeout_ms or POLICY['qr_timeout_ms']) / 1000, evidence=evidence)
        except TimeoutError:
            report['verification'] = await verification(page)
            entry = await page.locator(ENTRY[platform]).filter(visible=True).count()
            code = 'VERIFICATION_REQUIRED' if report['verification']['status'] == 'detected' else 'QR_NOT_FOUND' if entry or evidence['entry_seen'] else 'LOGIN_ENTRY_NOT_FOUND'
            report['error'] = failure(code, stage, timed_out=True)
            return
        report['stages']['login'] = {'status': 'ok', 'elapsed_ms': round((monotonic() - started) * 1000)}
        stage = 'qr_image'
        data = await (image_reader or read_qr_image)(locator)
        if not data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('Invalid QR image')
        report['stages']['qr_image'] = {'status': 'ok', 'bytes': len(data), 'format': 'png'}
        report['status'] = 'ok'
    try:
        async with asyncio.timeout((timeout_ms or POLICY['qr_timeout_ms']) / 1000):
            await perform()
    except Exception as error:
        report['error'] = classify(error, stage)
        if report['error']['code'] == 'VERIFICATION_REQUIRED':
            report['verification'] = {'status': 'detected', 'type': 'captcha'}
        if report['error']['code'] == 'TIMEOUT' and stage == 'login':
            try:
                async with asyncio.timeout(1):
                    report['verification'] = await verification(page)
                    found = await page.locator(ENTRY[platform]).filter(visible=True).count()
                    code = 'VERIFICATION_REQUIRED' if report['verification']['status'] == 'detected' else 'QR_NOT_FOUND' if found or evidence['entry_seen'] else 'LOGIN_ENTRY_NOT_FOUND'
                    report['error'] = failure(code, stage, timed_out=True)
            except Exception:
                pass
    report['evidence'] = evidence
    report['duration_ms'] = round((monotonic() - started) * 1000)
    return report
