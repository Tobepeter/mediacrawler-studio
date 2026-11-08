"""博主搜索与主页作品分页，桌面与 CLI 共用；当前支持抖音"""
import base64
import binascii
import json
import re
from urllib.parse import urlparse

PLATFORMS = ('dy',)
SEARCH_REQUESTS_PER_CALL = 3
EMPTY_PAGE_RETRIES = 2
RESOLVE_CANDIDATES = 20
SEC_UID = re.compile(r'MS4wLj[A-Za-z0-9_-]{20,}')
HOSTS = ('douyin.com', 'iesdouyin.com')


class CreatorError(RuntimeError):
    """str(error) 给界面展示，code 与 candidates 给 CLI 的结构化错误"""

    def __init__(self, code, message, candidates=None, retry_after=None):
        super().__init__(message)
        self.code, self.candidates, self.retry_after = code, candidates or [], retry_after


def invalid_cursor():
    return CreatorError('INVALID_CURSOR', '翻页游标无效，请从第一页重新开始')


def encode_cursor(kind, **state):
    raw = json.dumps({'v': 1, 'k': kind, **state}, separators=(',', ':'), ensure_ascii=False).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def decode_cursor(value, kind):
    if not value:
        return {}
    try:
        state = json.loads(base64.urlsafe_b64decode(value + '=' * (-len(value) % 4)))
    except (ValueError, TypeError, binascii.Error):
        raise invalid_cursor() from None
    if not isinstance(state, dict) or state.get('v') != 1 or state.get('k') != kind:
        raise invalid_cursor()
    skip = state.get('s', 0)
    if not isinstance(skip, int) or isinstance(skip, bool) or skip < 0:
        raise invalid_cursor()
    return state


async def checked(call):
    from media_platform.douyin.exception import DataFetchError
    try:
        response = await call
    except DataFetchError:
        raise CreatorError('PLATFORM_ERROR', '抖音暂时没有返回数据，请稍后重试') from None
    if not isinstance(response, dict):
        raise CreatorError('PLATFORM_ERROR', '抖音返回了无法识别的数据，请稍后重试')
    status = response.get('status_code', 0)
    if status == 8:
        raise CreatorError('AUTH_REQUIRED', '登录已失效，请重新扫码')
    if status:
        raise CreatorError('PLATFORM_ERROR', '抖音暂时无法完成请求，请稍后重试')
    return response


def avatar_url(user):
    for key in ('avatar_thumb', 'avatar_medium', 'avatar_168x168', 'avatar_larger'):
        for url in (user.get(key) or {}).get('url_list') or []:
            if isinstance(url, str) and url.startswith('https://'):
                return url
    return ''


def count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def summarize(user, source):
    identity = user.get('sec_uid') or ''
    if not isinstance(identity, str) or not identity:
        return None
    unique = str(user.get('unique_id') or user.get('short_id') or '')
    followers = count(user.get('follower_count'))
    # 视频卡片里的作者只有基础字段，0 粉丝代表平台未返回
    return {
        'type': 'creator', 'platform': 'dy', 'id': identity,
        'name': str(user.get('nickname') or ''), 'uniqueId': '' if unique == '0' else unique,
        'avatar': avatar_url(user), 'signature': str(user.get('signature') or ''),
        'followers': followers if followers or source == 'user' else None,
        'likes': count(user.get('total_favorited')), 'posts': count(user.get('aweme_count')),
        'verified': str(user.get('custom_verify') or user.get('enterprise_verify_reason') or ''),
        'private': user.get('secret') == 1, 'source': source,
        'url': f'https://www.douyin.com/user/{identity}',
    }


def row_creators(row):
    # 用户频道实际是混排结果：博主卡片之外还有视频，视频作者作为补充候选
    found = [summarize(entry.get('user_info') or {}, 'user') for entry in row.get('user_list') or []]
    author = (row.get('aweme_info') or {}).get('author')
    if isinstance(author, dict):
        found.append(summarize(author, 'video'))
    return [creator for creator in found if creator]


async def search_creators(runner, keyword, limit=10, cursor=None, requests=SEARCH_REQUESTS_PER_CALL):
    from media_platform.douyin.field import SearchChannelType
    if runner.platform not in PLATFORMS:
        raise CreatorError('UNSUPPORTED_PLATFORM', '该平台暂不支持博主搜索')
    keyword = keyword.strip()
    if not keyword:
        raise CreatorError('INVALID_CREATOR', '请输入博主名称或关键词')
    state = decode_cursor(cursor, 'search')
    if state and state.get('q') != keyword:
        raise invalid_cursor()
    offset, skip, search_id = state.get('o', 0), state.get('s', 0), state.get('i', '')
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0 or not isinstance(search_id, str):
        raise invalid_cursor()
    found = {}

    def result(next_offset=None, next_skip=0):
        return {
            'items': list(found.values()),
            'next_cursor': None if next_offset is None else encode_cursor('search', q=keyword, o=next_offset, s=next_skip, i=search_id),
            'has_more': next_offset is not None,
        }

    # 请求间隔由 desktop.pacing 在 client 出口统一控制
    for _ in range(requests):
        response = await checked(runner.client.search_info_by_keyword(
            keyword, offset=offset, search_id=search_id, search_channel=SearchChannelType.USER,
        ))
        rows = response.get('data') or []
        search_id = (response.get('extra') or {}).get('logid') or search_id
        server = response.get('cursor')
        following = server if isinstance(server, int) and server > offset else offset + len(rows)
        more = bool(response.get('has_more')) and following > offset and bool(rows)
        for index in range(skip, len(rows)):
            new = [creator for creator in row_creators(rows[index]) if creator['id'] not in found]
            if found and len(found) + len(new) > limit:
                return result(offset, index)
            for creator in new[:limit - len(found)]:
                found[creator['id']] = creator
            if len(found) >= limit:
                if index + 1 < len(rows):
                    return result(offset, index + 1)
                return result(following if more else None)
        if not more:
            return result()
        offset, skip = following, 0
    return result(offset)


def parse_reference(value):
    value = value.strip()
    if re.match(r'(www\.|v\.)?douyin\.com/', value, re.I):
        value = 'https://' + value
    if not value or len(value) > 2000:
        raise CreatorError('INVALID_CREATOR', '请输入博主主页链接、sec_uid 或名称')
    if SEC_UID.fullmatch(value):
        return 'id', value
    if not re.match(r'[a-z]+://', value, re.I):
        return 'name', value
    parsed = urlparse(value)
    host = (parsed.hostname or '').lower()
    if parsed.scheme != 'https' or not any(host == domain or host.endswith('.' + domain) for domain in HOSTS):
        raise CreatorError('INVALID_CREATOR', '请使用抖音的 HTTPS 博主主页链接')
    if host == 'v.douyin.com':
        return 'short', value
    match = re.fullmatch(r'(?:/share)?/user/([^/?#]+)/?', parsed.path)
    if not match or match.group(1) == 'self':
        raise CreatorError('INVALID_CREATOR', '这不是博主主页链接，请打开博主主页后复制链接')
    return 'id', match.group(1)


async def resolve_creator(runner, reference):
    kind, value = parse_reference(reference)
    if kind == 'short':
        target = await runner.client.resolve_short_url(value)
        if not target:
            raise CreatorError('PLATFORM_ERROR', '无法解析分享链接，请使用博主主页的完整链接')
        kind, value = parse_reference(target)
        if kind != 'id':
            raise CreatorError('INVALID_CREATOR', '这不是博主主页链接，请打开博主主页后复制链接')
    if kind == 'id':
        return value
    # 搜索接口对频率敏感，名称解析只取一页
    candidates = (await search_creators(runner, value, RESOLVE_CANDIDATES, requests=1))['items']
    expected = value.casefold()
    matches = [creator for creator in candidates if expected in (creator['name'].casefold(), creator['uniqueId'].casefold())]
    if len(matches) == 1:
        return matches[0]['id']
    if matches:
        raise CreatorError('CREATOR_AMBIGUOUS', f'有多位博主叫“{value}”，请改用 sec_uid 或主页链接', matches)
    raise CreatorError('CREATOR_NOT_FOUND', f'没有找到名称完全匹配“{value}”的博主', candidates[:10])


async def creator_profile(runner, identity):
    response = await checked(runner.client.get_user_info(identity))
    user = response.get('user')
    profile = summarize(user, 'user') if isinstance(user, dict) and user.get('nickname') else None
    if not profile:
        raise CreatorError('CREATOR_NOT_FOUND', '没有找到这位博主，账号可能已注销')
    return profile


async def collect_creator_posts(runner, reference, cursor=None):
    from store.douyin import update_douyin_aweme
    if runner.platform not in PLATFORMS:
        raise CreatorError('UNSUPPORTED_PLATFORM', '该平台暂不支持博主采集')
    state = decode_cursor(cursor, 'posts')
    profile = None
    if state:
        identity = state.get('c')
        if not isinstance(identity, str) or not identity or not isinstance(state.get('m', ''), str):
            raise invalid_cursor()
        # 游标自带博主身份；只有明确给出不同账号时才拒绝，名称不再重复搜索
        if reference:
            kind, value = parse_reference(reference)
            if kind == 'id' and value != identity:
                raise invalid_cursor()
    else:
        identity = await resolve_creator(runner, reference)
        profile = await creator_profile(runner, identity)
        runner.emit('creator', creator=profile)
        runner.emit('state', status='running', message=f"正在获取 {profile['name']} 的作品")
    position, skip, empty = state.get('m', ''), state.get('s', 0), 0
    store = runner.store

    def publish(next_position=None, next_skip=0):
        more = next_position is not None
        runner.emit('page', has_more=more, next_cursor=encode_cursor('posts', c=identity, m=next_position, s=next_skip) if more else None)

    while True:
        response = await checked(runner.client.get_user_aweme_posts(identity, position))
        rows = response.get('aweme_list') or []
        more = response.get('has_more') in (1, True)
        following = str(response.get('max_cursor') or '')
        if not rows:
            if not more:
                if profile and profile['private'] and not store.ids:
                    raise CreatorError('CREATOR_PRIVATE', '这位博主的作品不公开')
                publish()
                return
            if empty >= EMPTY_PAGE_RETRIES:
                # 有更多却连续空页，通常是风控；保留游标，稍后可从这里继续
                runner.emit('warning', message='抖音暂时没有返回更多作品，可稍后从当前位置继续')
                publish(position, skip)
                return
            empty += 1
            continue
        empty = 0
        for index in range(skip, len(rows)):
            if len(store.ids) >= store.limit:
                publish(position, index)
                return
            aweme = rows[index]
            await update_douyin_aweme(aweme)
            key = f"dy:{aweme.get('aweme_id')}"
            if key in store.items:
                runner.dy_details[key] = aweme
        if more and following == position:
            runner.emit('warning', message='抖音返回的翻页位置没有变化，已停止继续获取')
            publish()
            return
        if not more or not following:
            publish()
            return
        publish(following)
        if len(store.ids) >= store.limit:
            return
        position, skip = following, 0
