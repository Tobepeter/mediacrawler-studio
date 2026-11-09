"""抖音博主搜索、主页作品与关键词搜索的游标分页"""
import re
from urllib.parse import urlparse

from desktop.paging import (EMPTY_PAGE_RETRIES, CreatorError, Page, announce_profile, count, creator_summary, decode_cursor,
                            encode_cursor, feed_record, invalid_cursor, is_index, pick_by_name, walk)

SEARCH_REQUESTS_PER_CALL = 3
SEARCH_PAGE_SIZE = 10
SEARCH_MAX_REQUESTS = 10
RESOLVE_CANDIDATES = 20
SEC_UID = re.compile(r'MS4wLj[A-Za-z0-9_-]{20,}')
HOSTS = ('douyin.com', 'iesdouyin.com')
LABEL = {'label': '抖音', 'noun': '作品'}


async def checked(call):
    from media_platform.douyin.exception import DataFetchError
    try:
        response = await call
    except DataFetchError as error:
        raise CreatorError('PLATFORM_ERROR', '抖音暂时没有返回数据，请稍后重试', cause=str(error)[:300]) from None
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


def summarize(user, source):
    identity = user.get('sec_uid') or ''
    if not isinstance(identity, str) or not identity:
        return None
    unique = str(user.get('unique_id') or user.get('short_id') or '')
    followers = count(user.get('follower_count'))
    # 视频卡片里的作者只有基础字段，0 粉丝代表平台未返回
    return creator_summary(
        'dy', identity, str(user.get('nickname') or ''), f'https://www.douyin.com/user/{identity}', source,
        uniqueId='' if unique == '0' else unique, avatar=avatar_url(user), signature=str(user.get('signature') or ''),
        followers=followers if followers or source == 'user' else None, likes=count(user.get('total_favorited')),
        posts=count(user.get('aweme_count')), verified=str(user.get('custom_verify') or user.get('enterprise_verify_reason') or ''),
        private=user.get('secret') == 1,
    )


def row_creators(row):
    # 用户频道实际是混排结果：博主卡片之外还有视频，视频作者作为补充候选
    found = [summarize(entry.get('user_info') or {}, 'user') for entry in row.get('user_list') or []]
    author = (row.get('aweme_info') or {}).get('author')
    if isinstance(author, dict):
        found.append(summarize(author, 'video'))
    return [creator for creator in found if creator]


async def search_creators(runner, keyword, limit=10, cursor=None, requests=SEARCH_REQUESTS_PER_CALL):
    from media_platform.douyin.field import SearchChannelType
    state = decode_cursor(cursor, 'search')
    if state and state.get('q') != keyword:
        raise invalid_cursor()
    offset, skip, search_id = state.get('o', 0), state.get('s', 0), state.get('i', '')
    if not is_index(offset) or not isinstance(search_id, str):
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
    # App 分享的是整段文案，链接夹在中间
    shared = re.search(r'https?://[^\s，。！？）】"\']+', value, re.I)
    if shared and not re.match(r'[a-z]+://', value, re.I):
        value = shared.group(0)
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
    return pick_by_name(value, candidates, 'sec_uid')


async def creator_profile(runner, identity):
    response = await checked(runner.client.get_user_info(identity))
    user = response.get('user')
    profile = summarize(user, 'user') if isinstance(user, dict) and user.get('nickname') else None
    if not profile:
        raise CreatorError('CREATOR_NOT_FOUND', '没有找到这位博主，账号可能已注销')
    return profile


async def collect_search(runner, query, cursor=None, options=None):
    from store.douyin import update_douyin_aweme
    state = decode_cursor(cursor, 'search')
    bound, offset, search_id = state.get('q'), state.get('o', 0), state.get('i', '')
    if state and (not isinstance(bound, str) or not bound or (query and bound != query) or not is_index(offset) or not isinstance(search_id, str)):
        raise invalid_cursor()
    # 游标自带关键词，CLI 续页可以只传 --cursor
    query = bound or query

    def publish(next_offset=None, next_skip=0):
        more = next_offset is not None
        runner.emit('page', has_more=more, next_cursor=encode_cursor('search', q=query, o=next_offset, i=search_id, s=next_skip) if more else None)

    async def fetch(position):
        nonlocal search_id
        response = await runner.client.search_info_by_keyword(query, offset=position, search_id=search_id, **(options or {}))
        rows = response.get('data') or []
        search_id = (response.get('extra') or {}).get('logid') or search_id
        return Page(rows, None if not rows or response.get('has_more') in (False, 0) else position + SEARCH_PAGE_SIZE)

    async def save(post):
        mix = (post.get('aweme_mix_info') or {}).get('mix_items') or []
        item = post.get('aweme_info') or (mix[0] if mix else None)
        if item:
            await update_douyin_aweme(item)
            key = f"dy:{item.get('aweme_id')}"
            if key in runner.store.items:
                runner.dy_details[key] = item

    await walk(runner, fetch, save, publish, offset, state.get('s', 0), max_pages=SEARCH_MAX_REQUESTS, **LABEL)


async def collect_creator(runner, reference, cursor=None):
    from store.douyin import update_douyin_aweme
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
        profile = await announce_profile(runner, lambda: creator_profile(runner, identity))
    announced, store = bool(state or profile), runner.store

    def publish(next_position=None, next_skip=0):
        more = next_position is not None
        runner.emit('page', has_more=more, next_cursor=encode_cursor('posts', c=identity, m=next_position, s=next_skip) if more else None)

    async def fetch(position):
        nonlocal announced
        response = await checked(runner.client.get_user_aweme_posts(identity, position))
        rows = response.get('aweme_list') or []
        more, following = response.get('has_more') in (1, True), str(response.get('max_cursor') or '')
        if not rows and not more and profile and profile['private'] and not store.ids:
            raise CreatorError('CREATOR_PRIVATE', '这位博主的作品不公开')
        if rows and not announced:
            announced = True
            author = summarize({**(rows[0].get('author') or {}), 'sec_uid': identity}, 'video')
            if author and author['name']:
                runner.emit('creator', creator=author)
        # 空页时保留“还有更多”，由 walk 重试；有内容但没有下一页位置就是到底了
        return Page(rows, (following or position) if more and (following or not rows) else None)

    async def save(aweme):
        await update_douyin_aweme(aweme)
        key = f"dy:{aweme.get('aweme_id')}"
        if key in store.items:
            runner.dy_details[key] = aweme

    await walk(runner, fetch, save, publish, state.get('m', ''), state.get('s', 0), empty_retries=EMPTY_PAGE_RETRIES, **LABEL)


async def load_feed(runner, cursor=None):
    from media_platform.douyin.media import extract_card_cover_url
    state = decode_cursor(cursor, 'dy-feed')
    page = state.get('p', 1)
    if not is_index(page, 1):
        raise invalid_cursor()
    response = await checked(runner.client.get_home_feed(page=page))
    items = []
    for row in response.get('aweme_list') or []:
        identity = row.get('aweme_id')
        # 直播间卡片没有作品 ID
        if identity and not row.get('cell_room'):
            items.append(feed_record(
                'dy', identity, str(row.get('desc') or '')[:80], (row.get('author') or {}).get('nickname'),
                f'https://www.douyin.com/video/{identity}', extract_card_cover_url(row), (row.get('statistics') or {}).get('digg_count'),
                'note' if row.get('images') else 'video',
            ))
    more = response.get('has_more') not in (False, 0)
    return {'items': items, 'next_cursor': encode_cursor('dy-feed', p=page + 1) if more else None, 'has_more': more}
