"""登录入口在真实 DOM 上的离线回归，无账号、不访问平台、不弹窗口"""
import pytest
from playwright.async_api import async_playwright, Error
from mediacrawler_cli.browser import options
from desktop.login_flow import open_login


@pytest.mark.asyncio
async def test_platform_entries_and_qr_readiness(tmp_path):
    fixtures = {
        'bili': ('<div class="header-avatar-unlogin-entry">登录</div>', '<div class="login-scan-box"><img></div>'),
        'dy': ('<p>登录</p>', '<div id="animate_qrcode_container"><img></div>'),
        'xhs': ('<button>登录</button>', '<img class="qrcode-img">'),
        'zhihu': ('<button>登录/注册</button>', '<canvas class="Qrcode-qrcode"></canvas>'),
        'wb': ('<button><span>登录/注册</span></button>', '<div class="qrcode"><img></div>'),
        'tieba': ('<div class="user-or-login"><div class="login-btn">登录</div></div>', '<img class="tang-pass-qrcode-img">'),
        'ks': ('<span class="sidebar-login-button"><span>立即\n登录</span></span>', '<div class="qrcode-img"><img></div>'),
    }
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch_persistent_context(
            tmp_path / 'browser', headless=True, args=['--mute-audio'], **options(playwright),
        )
        try:
            page = browser.pages[0]
            for platform, (entry, qr) in fixtures.items():
                await page.set_content('<style>img,canvas{width:160px;height:160px}</style>' + entry)
                await page.evaluate('''qr => {
                    window.clicks = 0;
                    document.body.addEventListener('click', () => {
                        clicks++;
                        document.body.insertAdjacentHTML('beforeend', qr);
                    });
                }''', qr)
                assert await (await open_login(page, platform)).is_visible()
                assert await page.evaluate('clicks') == 1
                await open_login(page, platform)
                assert await page.evaluate('clicks') == 1

            # 页面已显示入口，但第一次点击发生在事件绑定之前，稍后再试可恢复
            await page.set_content('<div class="header-avatar-unlogin-entry">登录</div>')
            await page.evaluate('''() => setTimeout(() => {
                document.querySelector('div').onclick = () => {
                    document.body.insertAdjacentHTML('beforeend', '<div class="login-scan-box"><img width="160" height="160"></div>');
                };
            }, 300)''')
            assert await (await open_login(page, 'bili', timeout=4)).is_visible()
            await page.set_content('<div>没有登录入口</div>')
            with pytest.raises(TimeoutError):
                await open_login(page, 'bili', timeout=0.3)
            await page.close()
            with pytest.raises(Error, match='closed'):
                await open_login(page, 'bili')
        finally:
            await browser.close()
