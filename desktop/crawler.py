"""桌面编排层，采集/签名/内容标准化复用原生实现"""
import asyncio
import re
from playwright.async_api import Error as PlaywrightError
from urllib.parse import urlparse
from time import perf_counter
from desktop.login_flow import open_login, SESSION_COOKIES
from desktop.pacing import configure_cli, pace_client, reporter, throttle_detail
from desktop.paging import PAGED_SEARCH_PLATFORMS, CreatorError
import config
from desktop.links import resolve_link
from desktop.account import AccountProfile
from desktop.bili_paging import author_url as bili_author_url
from desktop.result_store import ResultStore
from desktop.xhs_paging import author_url as xhs_author_url
from desktop.zhihu_paging import track_raw
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
        self.xhs_details = {}  # 本次任务已取得的笔记详情，媒体补全后释放
        self.dy_details = {}  # 主页列表已含完整视频信息，无需再逐条请求详情
        self.bili_details = {}  # 列表阶段已取得的视频详情，媒体补全时复用
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
        # 上游成功后的固定等待由 desktop.pacing 接管
        config.CRAWLER_MAX_SLEEP_SEC = 0
        config.CRAWLER_TYPE = {"link": "detail", "creator": "creator"}.get(request["mode"], "search")
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
        started = perf_counter()
        current = urlparse(self.page.url)
        destination = urlparse(self.crawler.index_url)
        reusable = (self.request.get('reusePage') and current.scheme == 'https'
                    and (current.hostname or '').removeprefix('www.') == (destination.hostname or '').removeprefix('www.'))
        if not reusable:
            await self.page.goto(self.crawler.index_url, wait_until="domcontentloaded", timeout=15000)
        self.emit('timing', stage='page-ready', milliseconds=round((perf_counter() - started) * 1000), reused=bool(reusable))
        self.client = await getattr(self.crawler, create)(None)
        setattr(self.crawler, attr, self.client)
        if "max_wait" in self.request:
            configure_cli(self.request["max_wait"], bool(self.request.get("no_throttle")))
        pace_client(self.client, self.platform, reporter(self.emit), self.request.get("waitLimit"), bool(self.request.get("background")))
        if self.platform == 'zhihu':
            track_raw(self)

    async def logged_in(self):
        if self.platform == 'wb' and urlparse(self.page.url).hostname in ('www.weibo.com', 'weibo.com'):
            cookies = await self.context.cookies(['https://www.weibo.com'])
            if any(cookie['name'] in ('SUB', 'SSOLoginState') and cookie.get('value') for cookie in cookies):
                await self.page.goto(self.crawler.mobile_index_url, wait_until='domcontentloaded', timeout=30000)
        # 无登录 Cookie 时直接进入取码，不等待网络接口判断一个已知结果
        if self.platform in SESSION_COOKIES:
            cookies = await self.context.cookies(getattr(self.crawler, 'cookie_urls', None))
            if not any(cookie.get('name') in SESSION_COOKIES[self.platform] and cookie.get('value') for cookie in cookies):
                return False
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

    async def session_confirmed(self):
        # 单次检查超时只说明网络慢，不能据此判为未登录或结束扫码等待
        try:
            return await self.check_login()
        except TimeoutError:
            return False

    async def authenticate(self):
        if await self.session_confirmed():
            await self.publish_account()
            return
        started = perf_counter()
        if self.request.get('loginMode') == 'qrcode':
            # DOM 就绪即允许前端取码，与入口准备并行，不等待点击/网络超时串行叠加
            self.emit("state", status="auth", message="正在获取二维码")
        try:
            await open_login(self.page, self.platform)
        except TimeoutError:
            # 内联取码会再次定位入口；显式完整页面模式仍允许用户操作
            pass
        except RuntimeError as error:
            if str(error) != 'VERIFICATION_REQUIRED' or self.request.get('loginMode') == 'qrcode':
                raise
        self.emit('timing', stage='login-dialog', milliseconds=round((perf_counter() - started) * 1000))
        if self.request.get('loginMode') != 'qrcode':
            self.emit("state", status="auth", message="请在平台窗口扫码登录，完成后会自动继续")
        # 不自动处理验证码；用户在平台窗口完成，登录通过后继续
        async with asyncio.timeout(300):
            while not await self.session_confirmed():
                await asyncio.sleep(3)
        await self.publish_account()

    async def publish_account(self):
        # 先确认登录并收起弹层，头像查询不阻塞登录完成
        confirmed = dict(self.account.profile)
        self.emit("account", profile=confirmed)
        # 页面已返回资料则直接复用；额外查询最多等待 5 秒，失败仍视为已登录；续采时资料已经有了
        if not self.request.get("cursor") and not all(self.account.profile.get(key) for key in ("nickname", "avatar")):
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
        if self.request["action"] == "feed":
            from desktop.creators import load_feed
            try:
                self.emit("feed", **await load_feed(self, self.request.get("cursor")))
            except CreatorError as error:
                throttled = throttle_detail(error)
                if not throttled:
                    raise
                self.emit("feed", items=[], next_cursor=None, has_more=False, busy=error.code == "FEED_BUSY", throttled=throttled)
            self.emit("done", message="推荐已更新")
            return
        if self.request["action"] == "feature-check":
            from desktop.feature_check import run_checks
            if not await self.session_confirmed():
                raise CreatorError("AUTH_REQUIRED", "登录已失效，请重新扫码")
            self.emit("feature-check", items=await run_checks(self))
            self.emit("done", message="体检完成")
            return
        if self.request["action"] == "creator-search":
            from desktop.creators import search_creators
            if not await self.session_confirmed():
                raise CreatorError("AUTH_REQUIRED", "登录已失效，请重新扫码")
            # 界面每次操作只发一个请求，更多结果由用户主动加载
            self.emit("creators", **await search_creators(self, self.request["query"], self.request["limit"], self.request.get("cursor"), requests=1))
            self.emit("done", message="搜索完成")
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
        elif self.request["mode"] == "creator":
            from desktop.creators import collect_creator
            await collect_creator(self, self.request["query"], self.request.get("cursor"))
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
            if failed:
                self.emit('warning', message='部分评论未取全，正文与已有评论已保留')
        if not self.defer_media():
            from desktop.content.media import enrich
            for item in self.store.items.values():
                # 列表卡片的媒体等打开详情时再取，否则一页又变成逐条请求
                if item['id'] in self.store.cards:
                    continue
                try:
                    await enrich(self, item, self.request.get('quality', 'best'))
                except CreatorError as error:
                    # 正文已经拿到，后面的媒体信息等打开详情时再取，不继续请求
                    self.emit('warning', message=str(error))
                    break
                self.emit('item-update', item=item)
        count = len(self.store.ids)
        empty = "这位博主暂无可见作品" if self.request["mode"] == "creator" else "没有找到相关内容，试试其他关键词"
        self.emit("done", message=f"已获取 {count} 条内容" if count else empty)

    def defer_media(self):
        # B 站每条要多发两次请求，地址还会过期，批量采集时留到打开详情或下载再取
        return self.request.get('_defer_enrichment') or (self.platform == 'bili' and self.request['mode'] != 'link')

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
                self.bili_details[f"bili:{video.get('View', {}).get('aid')}"] = video
        elif self.platform == "dy":
            # 分享短链无法在输入时区分作品和主页，这里给出明确指引
            if urlparse(query).hostname == "v.douyin.com" and "/user/" in await self.client.resolve_short_url(query):
                raise RuntimeError("这是博主主页的分享链接，请粘贴主页完整链接或使用找博主")
            config.DY_SPECIFIED_ID_LIST = [query]
            fetch = self.crawler.get_aweme_detail

            async def remember(aweme_id, semaphore):
                # 上游只入库不返回原始数据，留一份给媒体补全，不重复请求详情
                raw = await fetch(aweme_id, semaphore)
                if raw:
                    self.dy_details[f"dy:{aweme_id}"] = raw
                return raw
            self.crawler.get_aweme_detail = remember
            await self.crawler.get_specified_awemes()
        elif self.platform == "xhs":
            from media_platform.xhs.help import parse_note_info_from_note_url
            note = parse_note_info_from_note_url(query)
            await self.collect_xhs_note(note.note_id, note.xsec_source, note.xsec_token, asyncio.Semaphore(1))
        else:
            await ExtraCollector(self).detail(query)

    async def collect_xhs_note(self, note_id, source, token, semaphore):
        from store.xhs import update_xhs_note
        if f'xhs:{note_id}' in self.store.ids:
            return
        note = await self.crawler.get_note_detail_async_task(
            note_id=note_id, xsec_source=source, xsec_token=token, semaphore=semaphore,
        )
        if note:
            key = f"xhs:{note.get('note_id')}"
            self.store.author_urls[key] = xhs_author_url(note.get('user'), 'pc_note')
            await update_xhs_note(note)
            if key in self.store.items:
                self.xhs_details[key] = note

    async def collect_bili_video(self, aid):
        from media_platform.bilibili.exception import DataFetchError
        # 节奏由 desktop.pacing 统一控制；单条取不到时跳过，风控错误不是这个类型，会继续向上抛
        try:
            video = await self.client.get_video_info(aid=aid)
        except (DataFetchError, KeyError):
            return
        if video:
            await self.save_bilibili(video)
            self.bili_details[f'bili:{aid}'] = video

    async def save_bilibili(self, video):
        from store.bilibili import update_bilibili_video
        view = video.get("View", {})
        # 原生 JSON 存储截断简介到 500 字，桌面保留原始正文
        self.store.full_text[f"bili:{view.get('aid')}"] = view.get("desc", "")
        self.store.author_urls[f"bili:{view.get('aid')}"] = bili_author_url(view.get('owner'))
        await update_bilibili_video(video)

    async def search(self):
        from desktop.search_options import search_options
        options = search_options(self.platform, self.request.get('filters'))
        if self.platform not in PAGED_SEARCH_PLATFORMS:
            await ExtraCollector(self).search()
            return
        from desktop.creators import collect_search
        await collect_search(self, self.request["query"], self.request.get("cursor"), options)
