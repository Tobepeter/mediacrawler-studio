"""当前登录账号的展示信息，不转发完整响应或凭据"""
from urllib.parse import urlparse

from desktop.paging import https_url


def profile_info(platform, payload):
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data", payload)
    if not isinstance(data, dict):
        return {}
    if platform == "bili":
        user = data
        name, avatar = user.get("uname"), user.get("face")
    elif platform == "xhs":
        user = data.get("basic_info") or data.get("user_info") or data
        if not isinstance(user, dict):
            return {}
        name = user.get("nickname") or user.get("nick_name")
        avatar = user.get("imageb") or user.get("images") or user.get("avatar")
    elif platform == 'zhihu':
        name, avatar = data.get('name'), data.get('avatar_url')
    elif platform == 'wb':
        user = data.get('userInfo') or data.get('user') or data
        if not isinstance(user, dict):
            return {}
        name, avatar = user.get('screen_name'), user.get('avatar_hd') or user.get('profile_image_url')
    elif platform == 'ks':
        user = ((data.get('visionProfile') or {}).get('userProfile') or {}).get('profile') or {}
        name, avatar = user.get('user_name'), user.get('headurl')
    elif platform == 'tieba':
        name, avatar = data.get('name'), data.get('avatar')
    elif platform == 'dy':
        user = data.get("user", {})
        if not isinstance(user, dict):
            return {}
        name = user.get("nickname")
        image = user.get("avatar_thumb") or user.get("avatar_medium") or {}
        urls = image.get("url_list", []) if isinstance(image, dict) else []
        avatar = urls[0] if isinstance(urls, list) and urls else ""
    else:
        return {}
    # http 头像升级成 https，其他协议不要
    avatar = https_url(avatar)
    if urlparse(avatar).scheme != "https":
        avatar = ""
    return {"nickname": name[:100] if isinstance(name, str) else "", "avatar": avatar}


class AccountProfile:
    def __init__(self, platform):
        self.platform = platform
        self.profile = {}

    def update(self, payload):
        # 较晚返回的空资料不能抹掉本次连接已取得的头像或昵称
        self.profile.update({
            key: value for key, value in profile_info(self.platform, payload).items() if value
        })

    async def observe(self, response):
        # 只接受账号自身接口，避免把推荐流作者当成登录用户
        target = urlparse(response.url)
        endpoints = {
            "bili": ("api.bilibili.com", "/x/web-interface/nav"),
            "xhs": ("edith.xiaohongshu.com", "/api/sns/web/v1/user/selfinfo"),
            "dy": ("www.douyin.com", "/aweme/v1/web/user/profile/self/"),
            "zhihu": ("www.zhihu.com", "/api/v4/me"),
        }
        if self.platform not in endpoints:
            return
        host, route = endpoints[self.platform]
        if target.hostname != host or target.path != route or response.status != 200:
            return
        try:
            self.update(await response.json())
        except Exception:
            pass  # 资料缺失不影响登录或采集


    async def fetch(self, client, page):
        if self.platform == 'zhihu':
            # 只查询账号展示信息，不额外请求邮箱等字段
            return await client.get('/api/v4/me')
        if self.platform == 'wb':
            info = await client.get('/api/config')
            identity = info.get('uid')
            if info.get('login') and identity:
                return await client.get_creator_info_by_id(str(identity))
        if self.platform == 'ks':
            identity = client.cookie_dict.get('userId')
            if identity:
                return await client.get_creator_profile(identity)
        if self.platform == 'tieba':
            # 仅取当前页面登录栏资料，不扫描帖子作者
            return await page.evaluate(r"""() => {
                const user = window.PageData?.user || {};
                const portrait = user.portrait || '';
                return {
                    name: user.name_show || user.user_name || user.name || document.querySelector('.u_username')?.textContent?.trim() || '',
                    avatar: /^https:\/\//.test(portrait) ? portrait : /^[\w-]+$/.test(portrait) ? `https://tb.himg.baidu.com/sys/portrait/item/${portrait}` : ''
                };
            }""")
        return {}
