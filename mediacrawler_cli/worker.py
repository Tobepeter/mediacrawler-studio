import asyncio
import json
import os
import sys
import time
from pathlib import Path

from mediacrawler_cli.state import atomic_json


async def execute(request, emit):
    import signal
    loop, task = asyncio.get_running_loop(), asyncio.current_task()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, task.cancel)
        except (NotImplementedError, RuntimeError):
            pass

    run_dir = Path(request['run_dir'])

    async def heartbeat():
        while True:
            atomic_json(run_dir / 'heartbeat.json', {'time': time.time()})
            await asyncio.sleep(10)

    beat = asyncio.create_task(heartbeat())
    try:
        if request['action'] == 'network-check':
            from desktop.health_network import diagnose_network
            emit('initialized')
            return [await diagnose_network(request.get('probe_urls', []), request.get('speed', True))]
        if request['action'] == 'download' and request.get('records'):
            from mediacrawler_cli.download import download_records
            emit('initialized')
            return await download_records(request, request['records'], emit)

        from playwright.async_api import async_playwright
        from mediacrawler_cli.browser import options
        from desktop.crawler import DesktopCrawler
        from mediacrawler_cli.auth import login
        async with async_playwright() as playwright:
            async def launch(headless=True):
                return await playwright.chromium.launch_persistent_context(
                    request['profile_dir'], headless=headless,
                    args=['--mute-audio'], timeout=30000, **options(playwright),
                )

            def create_crawler(context):
                page = context.pages[0]
                crawler = DesktopCrawler({**request, '_defer_enrichment': True}, page, emit)
                from mediacrawler_cli.results import CLIResultStore
                crawler.store = CLIResultStore(request['platform'], request['limit'], emit,
                                               request.get('comments', False), request.get('include_source', False))
                return crawler

            context = await launch()
            try:
                if not context.pages:
                    await context.new_page()
                crawler = create_crawler(context)
                if request['action'] == 'logout':
                    from desktop.logout import logout
                    outcome = await logout(crawler)
                    await context.clear_cookies()
                    return [outcome]
                if request['action'] == 'check':
                    from desktop.health import check_page
                    emit('initialized')
                    return [await check_page(crawler.page, request['platform'], request.get('qr_timeout_ms'))]
                await crawler.setup()
                emit('initialized')
                # 可见窗口只用于显式选择的登录，不把整个采集任务变成有头模式
                browser_login = (request.get('qr') == 'browser' and not request.get('non_interactive')
                                 and request['action'] != 'status' and not await crawler.check_login())
                if browser_login:
                    await context.close()
                    context = await launch(headless=False)
                    if not context.pages:
                        await context.new_page()
                    crawler = create_crawler(context)
                    await crawler.setup()
                await login(crawler, request, run_dir)
                if browser_login and request['action'] not in ('login', 'status'):
                    # 先关闭可见实例，落盘登录态，再以同一 profile 在后台继续
                    await context.close()
                    context = await launch()
                    if not context.pages:
                        await context.new_page()
                    crawler = create_crawler(context)
                    await crawler.setup()
                    if not await crawler.check_login():
                        raise RuntimeError('AUTH_REQUIRED')
                if request['action'] in ('login', 'status'):
                    return [{'platform': request['platform'], 'authenticated': True}]
                # setup 和登录已完成，直接复用采集实现及评论逻辑
                async def ready():
                    return None
                crawler.setup = ready
                crawler.authenticate = ready
                if request['action'] == 'creator-search':
                    from desktop.creators import search_creators
                    page = await search_creators(crawler, request['query'], request['limit'], request.get('cursor'))
                    emit('page', next_cursor=page['next_cursor'], has_more=page['has_more'])
                    return page['items']
                if request['action'] == 'download':
                    crawler.request['action'] = 'collect'
                await crawler.run()
                if request.get('media', True):
                    from mediacrawler_cli.media import enrich
                    for index, item in enumerate(crawler.store.items.values(), 1):
                        if request.get('verbose'):
                            emit('diagnostic', stage='media', index=index, total=len(crawler.store.items))
                        await enrich(crawler, item, request.get('quality', 'best'))
                        emit('item-update', item=item)
                else:
                    for item in crawler.store.items.values():
                        item['media'] = {'status': 'not_requested', 'variants': [], 'selection': None}
                if request['action'] == 'download':
                    from mediacrawler_cli.download import download_records
                    return await download_records(request, list(crawler.store.items.values()), emit, crawler)
                return list(crawler.store.items.values())
            finally:
                await context.close()
    finally:
        beat.cancel()
        await asyncio.gather(beat, return_exceptions=True)


def main(path):
    import logging
    logging.disable(logging.CRITICAL)
    output = sys.stdout
    sys.stdout = sys.stderr
    request = json.loads(Path(path).read_text())
    # 上游签名 JS 使用相对路径；冻结包和源码均固定资源根目录
    os.chdir(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
    def emit(kind, **payload):
        output.write(json.dumps({'type': kind, **payload}, ensure_ascii=False) + '\n')
        output.flush()
    from filelock import FileLock
    from mediacrawler_cli.state import alive, identity, stop
    import psutil
    import threading
    def watch_parent():
        while alive(request['supervisor']):
            time.sleep(2)
        # supervisor 意外退出后，本 worker 自行清理其浏览器子进程
        try:
            stop([identity(p.pid) for p in psutil.Process().children(recursive=True)])
        finally:
            os._exit(1)
    threading.Thread(target=watch_parent, daemon=True).start()
    try:
        with FileLock(request['worker_lock'], timeout=0):
            items = asyncio.run(execute(request, emit))
        emit('complete', items=items)
    except Exception as error:
        from desktop.creators import CreatorError
        code = error.code if isinstance(error, CreatorError) else str(error)
        if not code.isupper() or len(code) > 60:
            code = 'PLATFORM_ERROR'
        emit('failure', code=code, candidates=getattr(error, 'candidates', []), retry_after=getattr(error, 'retry_after', None))
        raise SystemExit(1)
