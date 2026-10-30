"""桌面编排层，采集/签名/内容标准化复用原生实现"""
import asyncio
import re
from playwright.async_api import Error as PlaywrightError
from urllib.parse import urlparse
import config
from desktop.links import resolve_link
from desktop.account import AccountProfile
from desktop.result_store import ResultStore
from desktop.comments import CommentCollector
from desktop.page_context import PageContext
from desktop.native_platforms import create_native
from desktop.extra_platforms import ExtraCollector
from var import crawler_type_var, source_keyword_var, request_keyword_var


class DesktopCrawler:
    def __init__(self, request, page, emit):
        self.request, self.page, self.emit = request, page, emit
        self.platform = request["platform"]
        self.account = AccountProfile(self.platform)
        self.store = ResultStore(self.platform, request["limit"], emit, request.get("comments", False))
        config.PLATFORM = self.platform
        # 评论统一在正文完成后采集，避免原生 detail 路径重复请求
        config.ENABLE_GET_COMMENTS = False
        config.ENABLE_GET_SUB_COMMENTS = False
        config.ENABLE_GET_MEDIA = False
        config.ENABLE_GET_WORDCLOUD = False
        config.ENABLE_IP_PROXY = False
        config.ENABLE_WEIBO_FULL_TEXT = True
        config.MAX_CONCURRENCY_NUM = 1
        config.CRAWLER_TYPE = "detail" if request["mode"] == "link" else "search"
        config.SAVE_DATA_OPTION = "studio"
        config.START_PAGE = 1
        config.CRAWLER_MAX_NOTES_COUNT = request["limit"]
        crawler_type_var.set(config.CRAWLER_TYPE)
        source_keyword_var.set(request["query"])
        request_keyword_var.set(request["query"])

    async def setup(self):
        self.crawler, create, attr = create_native(self.platform, self.store)
        cdp = await self.page.context.new_cdp_session(self.page)
        self.context = PageContext(self.page, cdp)
        self.crawler.browser_context = self.context
        self.crawler.context_page = self.page
        self.crawler.user_agent = await self.page.evaluate("() => navigator.userAgent")
        self.page.on("response", self.account.observe)
        await self.page.goto(self.crawler.index_url, wait_until="domcontentloaded", timeout=60000)
        self.client = await getattr(self.crawler, create)(None)
        setattr(self.crawler, attr, self.client)

    async def logged_in(self):
        if self.platform == 'wb' and urlparse(self.page.url).hostname in ('www.weibo.com', 'weibo.com'):
            cookies = await self.context.cookies(['https://www.weibo.com'])
            if any(cookie['name'] in ('SUB', 'SSOLoginState') and cookie.get('value') for cookie in cookies):
                await self.page.goto(self.crawler.mobile_index_url, wait_until='domcontentloaded', timeout=30000)
        await self.client.update_cookies(self.context)
        if self.platform in ("dy", "tieba"):
            return await self.client.pong(self.context)
        return await self.client.pong()

    async def check_login(self):
        # 扫码成功常伴随重载；旧 JS 上下文销毁不代表登录失败
        async with asyncio.timeout(15):
            for attempt in range(5):
                try:
                    return await self.logged_in()
                except PlaywrightError as error:
                    transient = any(message in str(error) for message in (
                        'Execution context was destroyed',
                        'Cannot find context with specified id',
                        'Cannot find context with specified unique id',
                    ))
                    if not transient or attempt == 4:
                        raise
                    await asyncio.sleep(1)

    async def authenticate(self):
        if await self.check_login():
            await self.publish_account()
            return
        selectors = {
            "bili": ".header-avatar-unlogin-entry, .right-entry__outside.go-login-btn .header-login-entry",
            "dy": "p:text-is('登录')",
            "xhs": "button:text-is('登录')",
            "zhihu": "button:text-is('登录'), button:text-is('登录/注册')",
            "wb": "a:text-is('登录'), button:text-is('登录')",
            "tieba": ".user-or-login .login-btn:visible, .u_login:visible",
            "ks": "p:text-is('登录')",
        }
        try:
            if self.platform == "tieba":
                # 新首页登录入口已改版；登录框已出现时不重复点击
                qr = self.page.locator("img.tang-pass-qrcode-img:visible").first
                if not await qr.is_visible():
                    await self.page.locator(selectors[self.platform]).first.click(timeout=6000)
                await qr.wait_for(state="visible", timeout=4000)
            else:
                await self.page.locator(selectors[self.platform]).first.click(timeout=6000)
        except Exception:
            pass  # 平台已弹出登录框，或由用户在真实页面操作
        # 先尝试打开站点登录框，再展示平台页面，减少首页过渡
        self.emit("state", status="auth", message="请在平台窗口扫码登录，完成后会自动继续")
        # 不自动处理验证码；用户在平台窗口完成，登录通过后继续
        async with asyncio.timeout(300):
            while not await self.check_login():
                await asyncio.sleep(3)
        await self.publish_account()

    async def publish_account(self):
        # 先确认登录并收起弹层，头像查询不阻塞登录完成
        confirmed = dict(self.account.profile)
        self.emit("account", profile=confirmed)
        # 页面已返回资料则直接复用；额外查询最多等待 5 秒，失败仍视为已登录
        if not all(self.account.profile.get(key) for key in ("nickname", "avatar")):
            try:
                async with asyncio.timeout(5):
                    if self.platform == "bili":
                        data = await self.client.get("/x/web-interface/nav", enable_params_sign=False)
                    elif self.platform == "xhs":
                        data = await self.client.query_self()
                    elif self.platform == "dy":
                        # 复用原生 client 补齐应用参数、签名和当前页面会话
                        data = await self.client.get(
                            "/aweme/v1/web/user/profile/self/",
                            {"device_platform": "webapp"},
                        )
                    else:
                        data = await self.account.fetch(self.client, self.page)
                    self.account.update(data)
            except Exception:
                pass
        if self.account.profile != confirmed:
            self.emit("account", profile=dict(self.account.profile))

    async def run(self):
        await self.setup()
        # 自动连接只检查已有会话；没有会话时不点击登录、不等待扫码
        if self.request["action"] == "connect" and self.request.get("silent"):
            if await self.check_login():
                await self.publish_account()
            else:
                self.emit("login-required")
            self.emit("done", message="登录状态检查完成")
            return
        await self.authenticate()
        if self.request["action"] == "connect":
            self.emit("done", message="已连接，登录状态会自动保存")
            return
        self.emit("state", status="running", message="正在获取内容")
        if self.request["mode"] == "link":
            await self.detail()
            if not self.store.ids:
                raise RuntimeError("未能获取这条作品，请检查链接是否完整、作品是否可访问")
        else:
            await self.search()
        if self.request.get('comments') and self.store.items:
            self.emit('state', status='running', message='正在获取评论')
            collector = CommentCollector(self.platform, self.client, self.store, self.request.get('replies', False))
            failed = False
            for item in self.store.items.values():
                self.store.comment_state(item, 'running')
                try:
                    async with asyncio.timeout(60):
                        await collector.fetch(item)
                    self.store.comment_state(item, 'completed')
                except Exception:
                    failed = True
                    self.store.comment_state(item, 'error')
                await asyncio.sleep(1)
            if failed:
                self.emit('warning', message='部分评论未取全，正文与已有评论已保留')
        if not self.request.get('_defer_enrichment'):
            from desktop.content.media import enrich
            for item in self.store.items.values():
                await enrich(self, item, self.request.get('quality', 'best'))
                self.emit('item-update', item=item)
        count = len(self.store.ids)
        self.emit("done", message=f"已获取 {count} 条内容" if count else "没有找到相关内容，试试其他关键词")

    async def detail(self):
        query = await resolve_link(self.request["query"], self.platform)
        if self.platform == "bili":
            match = re.search(r"/video/(BV[a-zA-Z0-9]+|av\d+)", query)
            if not match:
                raise RuntimeError("请使用 B站视频作品链接")
            video_id = match.group(1)
            video = await self.crawler.get_video_info_task(
                aid=int(video_id[2:]) if video_id.startswith("av") else 0,
                bvid=video_id if video_id.startswith("BV") else "",
                semaphore=asyncio.Semaphore(1),
            )
            if video:
                await self.save_bilibili(video)
        elif self.platform == "dy":
            config.DY_SPECIFIED_ID_LIST = [query]
            await self.crawler.get_specified_awemes()
        elif self.platform == "xhs":
            config.XHS_SPECIFIED_NOTE_URL_LIST = [query]
            await self.crawler.get_specified_notes()
        else:
            await ExtraCollector(self).detail(query)

    async def save_bilibili(self, video):
        from store.bilibili import update_bilibili_video
        view = video.get("View", {})
        # 原生 JSON 存储截断简介到 500 字，桌面保留原始正文
        self.store.full_text[f"bili:{view.get('aid')}"] = view.get("desc", "")
        await update_bilibili_video(video)

    async def search(self):
        if self.platform not in ('bili', 'dy', 'xhs'):
            await ExtraCollector(self).search()
            return
        # 按需取详情，避免原生批次最少 10/20 条超过用户所选数量
        query = self.request["query"]
        semaphore = asyncio.Semaphore(1)
        search_id = ""
        for page in range(1, 11):
            if self.platform == "bili":
                response = await self.client.search_video_by_keyword(query, page=page)
                posts = response.get("result") or []
                for post in posts:
                    item = await self.crawler.get_video_info_task(aid=post.get("aid"), bvid="", semaphore=semaphore)
                    if item:
                        await self.save_bilibili(item)
                    if len(self.store.ids) >= self.request["limit"]:
                        return
            elif self.platform == "dy":
                from store.douyin import update_douyin_aweme
                response = await self.client.search_info_by_keyword(query, offset=(page - 1) * 10, search_id=search_id)
                posts = response.get("data") or []
                search_id = response.get("extra", {}).get("logid", "")
                for post in posts:
                    item = post.get("aweme_info")
                    if not item:
                        mix = post.get("aweme_mix_info", {}).get("mix_items") or []
                        item = mix[0] if mix else None
                    if item:
                        await update_douyin_aweme(item)
                    if len(self.store.ids) >= self.request["limit"]:
                        return
            else:
                from store.xhs import update_xhs_note
                from media_platform.xhs.help import get_search_id
                search_id = search_id or get_search_id()
                response = await self.client.get_note_by_keyword(query, search_id=search_id, page=page)
                posts = response.get("items") or []
                for post in posts:
                    if post.get("model_type") in ("rec_query", "hot_query"):
                        continue
                    item = await self.crawler.get_note_detail_async_task(
                        note_id=post.get("id"), xsec_source=post.get("xsec_source"),
                        xsec_token=post.get("xsec_token"), semaphore=semaphore,
                    )
                    if item:
                        await update_xhs_note(item)
                    if len(self.store.ids) >= self.request["limit"]:
                        return
            if not posts or response.get("has_more") is False or response.get("has_more") == 0:
                break
            await asyncio.sleep(2)
