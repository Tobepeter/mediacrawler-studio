"""桌面采集进程：stdin 单次请求，stdout NDJSON 事件"""
import asyncio
import json
import sys
from desktop.diagnostics import exception_detail

protocol = sys.stdout
sys.stdout = sys.stderr


def emit(event_type, **values):
    protocol.write(json.dumps({"type": event_type, **values}, ensure_ascii=False) + "\n")
    protocol.flush()


async def main(request):
    from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
    from desktop.crawler import DesktopCrawler

    async with async_playwright() as playwright:
        try:
            async with asyncio.timeout(20):
                # 复用 Electron 时保留原生媒体偏好，不能把主界面系统主题模拟为浅色
                browser = await playwright.chromium.connect_over_cdp(request["endpoint"], timeout=15000, no_defaults=True)
        except (TimeoutError, PlaywrightTimeoutError):
            raise RuntimeError("连接平台页面超时，请重试") from None
        page = None
        request["reusePage"] = True
        for context in browser.contexts:
            for candidate in context.pages:
                session = await context.new_cdp_session(candidate)
                try:
                    info = await session.send("Target.getTargetInfo")
                    if info["targetInfo"]["targetId"] == request["targetId"]:
                        page = candidate
                finally:
                    await session.detach()
                if page is not None:
                    break
            if page is not None:
                break
        if page is None:
            raise RuntimeError("找不到平台窗口，请重试")
        # 不创建新页面，也不关闭 Electron 所属的浏览器或 context
        crawler = DesktopCrawler(request, page, emit)
        if request.get('action') == 'logout':
            from desktop.logout import logout
            emit('logout-result', result=await logout(crawler))
        else:
            await crawler.run()


if __name__ == "__main__":
    request = {}
    try:
        value = json.loads(sys.stdin.readline())
        if not isinstance(value, dict):
            raise ValueError("请求必须为对象")
        request = value
        asyncio.run(main(request))
    except KeyboardInterrupt:
        pass
    except BaseException as error:
        if not isinstance(error, (asyncio.CancelledError, KeyboardInterrupt)):
            emit('diagnostic', detail=exception_detail(error))
        message = "采集未完成，请重试；如平台要求验证，可打开平台窗口完成验证"
        if isinstance(error, ModuleNotFoundError):
            message = "采集环境缺少依赖，请在项目目录运行 uv sync"
        elif isinstance(error, TimeoutError):
            message = "等待超时，请重试或打开平台窗口检查登录与网络"
        elif isinstance(error, RuntimeError):
            message = str(error)
        from desktop.health import classify
        emit('error', message=message, failure=classify(error, 'login' if request.get('action') == 'connect' else 'collection'))
        sys.exit(1)
