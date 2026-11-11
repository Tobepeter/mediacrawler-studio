"""分享短链解析，只跟随所选平台的 HTTPS 跳转"""
from urllib.parse import urlparse, urljoin
import httpx

from desktop.pacing import wait_turn

HOSTS = {
    "bili": ("bilibili.com", "b23.tv"),
    "dy": ("douyin.com", "iesdouyin.com"),
    "xhs": ("xiaohongshu.com", "xhslink.com"),
    "zhihu": ("zhihu.com",),
    "wb": ("weibo.com", "weibo.cn"),
    "tieba": ("tieba.baidu.com",),
    "ks": ("kuaishou.com", "gifshow.com"),
}


def allowed(url, platform):
    parsed = urlparse(url)
    host = parsed.hostname or ""
    return parsed.scheme == "https" and any(host == domain or host.endswith("." + domain) for domain in HOSTS[platform])


async def resolve_link(url, platform):
    if not allowed(url, platform):
        raise RuntimeError("请使用所选平台的 HTTPS 作品链接")
    parsed = urlparse(url)
    host = parsed.hostname or ""
    short_link = host in ("b23.tv", "www.b23.tv", "xhslink.com", "www.xhslink.com", "v.kuaishou.com", "v.gifshow.com")
    if not short_link and not (platform == 'ks' and parsed.path.startswith('/f/')):
        return url
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        for _ in range(8):
            if not allowed(url, platform):
                raise RuntimeError("分享链接跳转到其他网站，请使用作品完整链接")
            # 每一跳都是一次平台请求，和其他请求共用节奏
            await wait_turn(platform)
            response = await client.get(url)
            if response.is_redirect and response.headers.get("location"):
                url = urljoin(url, response.headers["location"])
            else:
                response.raise_for_status()
                return url
    raise RuntimeError("无法解析分享链接，请使用作品完整链接")


def media_referer(platform):
    # 小红书图片 CDN 校验完整站点来源，裸域名会返回 403
    host = 'www.xiaohongshu.com' if platform == 'xhs' else HOSTS[platform][0]
    return f'https://{host}/'
