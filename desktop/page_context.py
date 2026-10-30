"""Electron partition 的页面级会话适配"""


class PageContext:
    def __init__(self, page, cdp):
        self.page = page
        self.cdp = cdp
        self.pages = [page]

    async def cookies(self, urls=None):
        # Playwright 经 CDP 会把 Electron 分区页面聚合进默认 context
        # Network.getCookies 在目标页面所属的分区取值，包含 HttpOnly Cookie
        result = await self.cdp.send("Network.getCookies", {"urls": urls or [self.page.url]})
        return result["cookies"]
