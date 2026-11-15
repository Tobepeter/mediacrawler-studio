"""通过平台页面执行退出；未完成平台操作时不伪报服务端已退出

网页的“退出登录”本质是点击后发一个注销请求，服务器作废这次登录并让浏览器删掉 Cookie。
这里模拟的是点击：悬停头像展开账号菜单、点退出、处理确认框。

桌面端的平台页面藏在后台、没挂到任何窗口上，不出画面：动画帧不触发，悬停和弹出菜单都做不了，
所以桌面端这一步基本都会落到 not_confirmed（2026-11-16 在知乎页面实测）。试过让隐藏页按录制
状态渲染（Electron 45 已删掉 incrementCapturerCount）和挂到窗口外侧（macOS 不画看不见的区域），
都不行。桌面端不管这一步结果如何都会清掉本机登录数据，界面只提示已退出，结果写进日志。
CLI 用无头浏览器，页面照常渲染，这一步有机会成功。

以后要让平台那边真正注销，方向是在页面里直接发网页同款的注销请求（不依赖渲染），
各平台接口要先抓一次真实退出请求确认。"""
import asyncio
import re

LOGOUT = re.compile(r'^(退出登录|退出登陆|退出账号|退出帐号|安全退出|Log out|Sign out)$', re.I)
# 仅展开账号/导航菜单，不点击内容区文字或猜测未验证的退出 API
MENUS = {
    'bili': ['.header-avatar-wrap', '.header-avatar', '.header-entry-mini'],
    'dy': ['[data-e2e="user-info"]', '[data-e2e="user-avatar"]'],
    'xhs': ['.user.side-bar-component', '.bottom-menu', '.more-button'],
    'zhihu': ['.AppHeader-profileAvatar', '.AppHeader-userInfo'],
    'wb': ['[aria-label="设置"]', '[title="设置"]', '[class*="avatar"]'],
    'tieba': ['.user-name', '.u_username', '.user-or-login'],
    'ks': ['.user-avatar', '.avatar-container', '.user-info'],
}


def result(platform, remote, reason=None):
    return {'platform': platform, 'remote': remote, 'reason': reason}


async def logout_control(page):
    controls = page.get_by_role('button', name=LOGOUT).or_(
        page.get_by_role('link', name=LOGOUT)
    ).or_(page.get_by_role('menuitem', name=LOGOUT))
    # 某些网站菜单未标注 role；限制在菜单容器，不匹配正文里的同名文本
    menus = page.locator('[role="menu"], [class*="dropdown"], [class*="popover"], nav, .bottom-menu')
    controls = controls.or_(menus.get_by_text(LOGOUT))
    return controls.filter(visible=True).first


async def login_visible(page):
    label = re.compile(r'^(登录|登录\/注册|立即登录|Log in|Sign in)$', re.I)
    controls = page.get_by_role('button', name=label).or_(page.get_by_role('link', name=label))
    controls = controls.or_(page.locator('.header-avatar-unlogin-entry, .header-login-entry, .user-or-login .login-btn, .u_login'))
    return await controls.filter(visible=True).first.is_visible()


async def perform_logout(crawler):
    page = crawler.page
    control = await logout_control(page)
    if not await control.is_visible():
        for selector in MENUS[crawler.platform]:
            menu = page.locator(selector).filter(visible=True).first
            if not await menu.is_visible():
                continue
            await menu.hover(timeout=1500)
            await page.wait_for_timeout(250)
            control = await logout_control(page)
            if await control.is_visible():
                break
            await menu.click(timeout=1500)
            await page.wait_for_timeout(250)
            control = await logout_control(page)
            if await control.is_visible():
                break
    if not await control.is_visible():
        return result(crawler.platform, 'not_confirmed', 'entry_unavailable')

    async def confirm_native(dialog):
        if dialog.type == 'confirm' and re.search(r'退出|登出|log\s*out|sign\s*out', dialog.message, re.I):
            await dialog.accept()
        else:
            await dialog.dismiss()

    page.on('dialog', confirm_native)
    try:
        await control.click(timeout=3000)
        # 仅确认退出用途的弹窗，绝不点击任意页面的“确定”
        for _ in range(8):
            for dialog in await page.get_by_role('dialog').all():
                if await dialog.is_visible() and re.search(r'退出|登出|log\s*out|sign\s*out', await dialog.inner_text(), re.I):
                    button = dialog.get_by_role('button', name=re.compile(r'^(确定|确认|确认退出|退出登录|退出|Log out|Sign out)$', re.I)).filter(visible=True).first
                    if await button.is_visible():
                        await button.click(timeout=2000)
            await asyncio.sleep(0.5)
        # 重新打开首页，再用原有平台登录检查确认；网络异常不算退出成功
        response = await page.goto(crawler.crawler.index_url, wait_until='domcontentloaded', timeout=10000)
        if response is not None and not response.ok:
            return result(crawler.platform, 'not_confirmed', 'verification_unavailable')
        if not await crawler.check_login() and await login_visible(page):
            return result(crawler.platform, 'confirmed')
        return result(crawler.platform, 'not_confirmed', 'still_authenticated')
    finally:
        page.remove_listener('dialog', confirm_native)


async def logout(crawler):
    try:
        async with asyncio.timeout(35):
            await crawler.setup()
            if not await crawler.check_login() and await login_visible(crawler.page):
                return result(crawler.platform, 'already_signed_out')
            return await perform_logout(crawler)
    except TimeoutError:
        return result(crawler.platform, 'not_confirmed', 'timeout')
    except Exception:
        return result(crawler.platform, 'not_confirmed', 'platform_error')
