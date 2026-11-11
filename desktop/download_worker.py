"""按需下载子进程，标准输出只发送安全状态"""
import asyncio
import json
import signal
import sys
from desktop.diagnostics import exception_detail

protocol = sys.stdout
sys.stdout = sys.stderr


def emit(kind, **data):
    protocol.write(json.dumps({'type': kind, **data}, ensure_ascii=False) + '\n')
    protocol.flush()


async def main(request):
    from desktop.media_download import download_record
    task = asyncio.current_task()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, task.cancel)
        except (NotImplementedError, RuntimeError):
            pass
    if request['kind'] == 'images':
        return await download_record(request, emit)
    if request['kind'] == 'ocr-check':
        # OCR 可拆：这份运行时里有没有 rapidocr，只查模块，不加载模型
        from desktop.ocr import check
        return {'saved': 0, 'code': '', 'ocrState': check()['state']}
    if request['kind'] == 'ocr-image':
        from desktop.ocr import ocr_image_result
        return await ocr_image_result(request)
    from playwright.async_api import async_playwright
    async with async_playwright() as playwright:
        async with asyncio.timeout(20):
            # 下载连接同样不能改写 Electron 主界面的系统主题
            browser = await playwright.chromium.connect_over_cdp(request['endpoint'], timeout=15000, no_defaults=True)
        for context in browser.contexts:
            for page in context.pages:
                session = await context.new_cdp_session(page)
                try:
                    target = await session.send('Target.getTargetInfo')
                finally:
                    await session.detach()
                if target['targetInfo']['targetId'] == request['targetId']:
                    if request['kind'] == 'detail':
                        from desktop.content.detail import load_detail
                        return await load_detail(request['record'], page, request.get('background', False), emit)
                    if request['kind'] == 'comments':
                        from desktop.comments import load_comments
                        return await load_comments(request, emit, page)
                    if request['kind'] == 'ocr':
                        from desktop.ocr import ocr_result
                        return await ocr_result(request, emit, page)
                    if request['kind'] == 'transcribe':
                        from desktop.transcribe import transcribe_result
                        return await transcribe_result(request, emit, page)
                    if request['kind'] == 'playback':
                        from desktop.media_resolver import resolve_playback
                        return await resolve_playback(request['record'], page, emit)
                    return await download_record(request, emit, page)
        raise RuntimeError('unavailable')


if __name__ == '__main__':
    request = json.loads(sys.stdin.readline())
    try:
        result = asyncio.run(main(request))
        emit('download-result', **result)
    except BaseException as error:
        if not isinstance(error, (asyncio.CancelledError, KeyboardInterrupt)):
            emit('diagnostic', detail=exception_detail(error))
        code = 'cancelled' if isinstance(error, (asyncio.CancelledError, KeyboardInterrupt)) else 'disk' if isinstance(error, OSError) else str(error) if isinstance(error, RuntimeError) and str(error) in ('login', 'unsupported', 'expired', 'unavailable', 'quality_unavailable', 'audio_unavailable', 'ffmpeg_required', 'hls_unsupported', 'hls_failed') else 'network'
        from desktop.pacing import throttle_detail
        throttled = throttle_detail(error)
        if throttled:
            emit('download-error', code='throttled', throttle_code=throttled['code'], retry_after=throttled['retry_after'], message=throttled['message'])
        else:
            emit('download-error', code=code)
        sys.exit(1)
