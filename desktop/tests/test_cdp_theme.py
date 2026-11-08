"""后台 worker 连接不能改写主界面的系统主题"""
import asyncio
import json
from pathlib import Path
import sys

import pytest
from playwright.async_api import async_playwright
from mediacrawler_cli.browser import options


@pytest.mark.asyncio
async def test_workers_preserve_system_theme_during_repeated_connections(tmp_path):
    async with async_playwright() as playwright:
        executable = options(playwright).get('executable_path', playwright.chromium.executable_path)
        browser_process = await asyncio.create_subprocess_exec(
            executable, '--headless=new', '--no-sandbox', '--mute-audio',
            '--force-dark-mode', '--no-first-run', '--no-default-browser-check',
            '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
            f'--user-data-dir={tmp_path / "browser"}', 'about:blank',
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            port_file = tmp_path / 'browser/DevToolsActivePort'
            async with asyncio.timeout(15):
                while not port_file.exists():
                    if browser_process.returncode is not None:
                        raise RuntimeError('测试浏览器启动失败')
                    await asyncio.sleep(0.05)
            endpoint = f'http://127.0.0.1:{port_file.read_text().splitlines()[0]}'
            observer = await playwright.chromium.connect_over_cdp(endpoint, no_defaults=True)
            page = observer.contexts[0].pages[0]
            await page.evaluate('''() => {
                const media = matchMedia('(prefers-color-scheme: dark)');
                window.themeChanges = [];
                media.addEventListener('change', event => themeChanges.push(event.matches));
                if (!media.matches) throw new Error('测试环境应为深色');
            }''')
            for worker in ['desktop.worker', 'desktop.download_worker'] * 2:
                process = await asyncio.create_subprocess_exec(
                    sys.executable, '-m', worker,
                    cwd=Path(__file__).resolve().parents[2],
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                try:
                    # 只连接，不匹配真实平台，不发起登录、采集或下载
                    stdout, stderr = await asyncio.wait_for(process.communicate(json.dumps({
                        'endpoint': endpoint, 'targetId': 'missing-test-target', 'kind': 'video',
                    }).encode()), timeout=30)
                finally:
                    if process.returncode is None:
                        process.kill()
                        await process.wait()
                assert process.returncode == 1, (stdout, stderr)
                events = [json.loads(line) for line in stdout.splitlines()]
                expected = ({'type': 'error', 'message': '找不到平台窗口，请重试'}
                            if worker == 'desktop.worker' else
                            {'type': 'download-error', 'code': 'unavailable'})
                # 必须已经连接并完成目标查找，不能把连接失败误判为主题稳定
                assert any(all(event.get(key) == value for key, value in expected.items()) for event in events), (stdout, stderr)
                await asyncio.sleep(0.15)
                assert await page.evaluate('themeChanges') == [], worker
                assert await page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches"), worker
        finally:
            if browser_process.returncode is None:
                browser_process.terminate()
                try:
                    await asyncio.wait_for(browser_process.wait(), timeout=5)
                except TimeoutError:
                    browser_process.kill()
                    await browser_process.wait()
