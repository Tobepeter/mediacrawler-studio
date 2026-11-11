"""开发版运行时探针：连上正在运行的开发版桌面端，只通过 window.__STUDIO_DEBUG__ 读状态、驱动动作，结果输出 JSON

需要先 npm run dev。常用：
  npm run probe -- snapshot
  npm run probe -- open https://www.douyin.com/video/...
  npm run probe -- image-text <图文链接>
  npm run probe -- frame <视频链接> --at 3 --out <目录>
  npm run probe -- comments <链接>
  npm run probe -- shot --out <目录>
  npm run probe -- eval "d.detail()"

截图类命令会先把应用窗口显示到前台：窗口在后台或收起时浏览器不刷新画面，截到的是空白
"""
import argparse
import asyncio
import base64
import json
import os
import sys
import time
import urllib.request

from playwright.async_api import async_playwright

DATA = os.path.expanduser('~/Library/Application Support/mediacrawler-studio')
UI = '127.0.0.1:5173'
# 和 webui/src/studio/debug.ts 的 VERSION 对应；入口在页面启动时装上，版本旧了就刷新页面
VERSION = 3


def devtools_port(timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            port = open(os.path.join(DATA, 'DevToolsActivePort')).readline().strip()
            pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list', timeout=2))
            if any(UI in page['url'] for page in pages if page['type'] == 'page'):
                return port
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise SystemExit('开发版没有运行，先 npm run dev')


async def connect(playwright):
    browser = await playwright.chromium.connect_over_cdp(f'http://127.0.0.1:{devtools_port()}', timeout=15000, no_defaults=True)
    ui = next(page for context in browser.contexts for page in context.pages if UI in page.url)
    if await ui.evaluate('() => window.__STUDIO_DEBUG__?.version || 0') < VERSION:
        await ui.reload()
    await ui.wait_for_function(f'() => (window.__STUDIO_DEBUG__?.version || 0) >= {VERSION} && window.__STUDIO_DEBUG__.ready()', timeout=60000)
    return ui


def debug(ui, body, arg=None):
    """body 里用 d 指代调试入口，arg 传参"""
    return ui.evaluate(f'async (arg) => {{ const d = window.__STUDIO_DEBUG__; return ({body}) }}', arg)


async def open_link(ui, url):
    item = await debug(ui, 'await d.actions.openLink(arg)', url)
    if not item:
        raise SystemExit(f'没有打开作品：{url}')
    await asyncio.sleep(1)
    return item


def save(out, name, data):
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, name)
    with open(path, 'wb') as file:
        file.write(data)
    return path


async def run(options):
    async with async_playwright() as playwright:
        ui = await connect(playwright)
        if options.command == 'snapshot':
            return await debug(ui, 'd.snapshot()')
        if options.command == 'profiles':
            return await debug(ui, 'd.profiles()')
        if options.command == 'eval':
            return await debug(ui, options.expression)
        if options.command == 'open':
            await open_link(ui, options.url)
            return await debug(ui, 'd.detail()')
        if options.command == 'image-text':
            item = await open_link(ui, options.url)
            started = time.time()
            result = await debug(ui, f'await d.imageText.{"cached" if options.cached else "recognize"}(arg)', item) or {}
            text = result.get('imageText', result) if not options.cached else result
            pages = (text or {}).get('images', [])
            return {'id': item, 'code': result.get('code', ''), 'images': len(pages), 'empty': sum(1 for page in pages if not page['text']),
                    'chars': len((text or {}).get('text', '')), 'seconds': round(time.time() - started, 1), 'preview': (text or {}).get('text', '')[:200]}
        if options.command == 'frame':
            item = await open_link(ui, options.url)
            await debug(ui, 'await d.window.show()')
            report = {'id': item, 'pause': await debug(ui, 'await d.frame.pauseAt(arg)', options.at)}
            shot = await debug(ui, 'await d.frame.capture()')
            if shot:
                report['capture'] = {'bytes': shot['bytes'], 'path': save(options.out, f'frame-{int(time.time())}.png', base64.b64decode(shot['base64']))}
            started = time.time()
            report['recognize'] = await debug(ui, 'await d.frame.recognize()')
            report['recognize_seconds'] = round(time.time() - started, 1)
            return report
        if options.command == 'transcript':
            item = await open_link(ui, options.url)
            result = await debug(ui, f'await d.transcript.{"extract" if options.extract else "cached"}(arg)', item)
            transcript = (result or {}).get('transcript', result) if options.extract else result
            return {'id': item, 'code': (result or {}).get('code', '') if options.extract else '', 'source': (transcript or {}).get('source'),
                    'segments': len((transcript or {}).get('segments', [])), 'preview': (transcript or {}).get('text', '')[:200]}
        if options.command == 'comments':
            item = await open_link(ui, options.url)
            page = await debug(ui, 'await d.comments.load(arg)', item) or {}
            rows = page.get('items', [])
            return {'id': item, 'code': page.get('code', ''), 'count': len(rows), 'hasMore': page.get('hasMore'), 'first': [row.get('text', '')[:60] for row in rows[:3]]}
        if options.command == 'shot':
            await debug(ui, 'await d.window.show()')
            return {'path': save(options.out, f'app-{int(time.time())}.png', await ui.screenshot()), 'detail': await debug(ui, 'd.detail()')}
    raise SystemExit(f'未知命令：{options.command}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('snapshot', help='平台、账号、任务和结果数量')
    commands.add_parser('profiles', help='各平台账号的昵称和头像')
    evaluate = commands.add_parser('eval', help='执行一段表达式，用 d 指代调试入口')
    evaluate.add_argument('expression')
    for name, help_text in (('open', '按链接打开作品详情'), ('image-text', '识别图文帖的图中文字'), ('frame', '视频暂停后截图并识别画面文字'),
                            ('transcript', '读字幕，加 --extract 现场提取'), ('comments', '取第一页评论')):
        command = commands.add_parser(name, help=help_text)
        command.add_argument('url')
        if name == 'image-text':
            command.add_argument('--cached', action='store_true', help='只读缓存，不重新识别')
        if name == 'frame':
            command.add_argument('--at', type=float, default=3, help='播到第几秒暂停')
            command.add_argument('--out', default='.', help='截图存放目录')
        if name == 'transcript':
            command.add_argument('--extract', action='store_true')
    shot = commands.add_parser('shot', help='截整个应用窗口')
    shot.add_argument('--out', default='.')
    print(json.dumps(asyncio.run(run(parser.parse_args())), ensure_ascii=False, indent=1))


if __name__ == '__main__':
    sys.exit(main())
