"""B 站关键词搜索、博主搜索与主页视频的游标分页；列表只有摘要，每条视频再取一次详情"""
import html
import re
from urllib.parse import urlparse

from desktop.paging import (EMPTY_PAGE_RETRIES, CreatorError, Page, announce_profile, count, creator_summary, decode_cursor,
                            encode_cursor, feed_record, https_url, invalid_cursor, is_index, pick_by_name, walk)

SEARCH_MAX_PAGES = 10
SEARCH_REQUESTS_PER_CALL = 3
POSTS_PAGE_SIZE = 30
RESOLVE_CANDIDATES = 20
SPACE = 'https://space.bilibili.com/'
LABEL = {'label': 'B站', 'noun': '视频'}


async def checked(call):
    from media_platform.bilibili.exception import DataFetchError
    try:
        response = await call
    except DataFetchError as error:
        message = str(error)
        if '啥都木有' in message or '不存在' in message:
            raise CreatorError('CREATOR_NOT_FOUND', '没有找到这位博主，账号可能已注销') from None
        raise CreatorError('PLATFORM_ERROR', 'B站暂时没有返回数据，请稍后重试', cause=message[:300]) from None
    if not isinstance(response, dict):
        raise CreatorError('PLATFORM_ERROR', 'B站返回了无法识别的数据，请稍后重试')
    return response


def plain(value):
    return html.unescape(re.sub(r'<[^>]+>', '', str(value or '')))


def more_pages(page, response):
    # 接口用 numPages 表示总页数；缺失时翻到空页为止
    total = response.get('numPages')
    return page + 1 if not is_index(total) or page < total else None


def author_url(owner):
    mid = (owner or {}).get('mid')
    return f'{SPACE}{mid}' if mid else ''


def summarize_row(row):
    identity = str(row.get('mid') or '')
    if not identity:
        return None
    official = row.get('official_verify') or {}
    return creator_summary(
        'bili', identity, plain(row.get('uname')), SPACE + identity,
        avatar=https_url(row.get('upic')), signature=plain(row.get('usign')), followers=count(row.get('fans')),
        posts=count(row.get('videos')), verified=str(official.get('desc') or ''),
    )


async def search_creators(runner, keyword, limit=10, cursor=None, requests=SEARCH_REQUESTS_PER_CALL):
    state = decode_cursor(cursor, 'bili-user')
    if state and state.get('q') != keyword:
        raise invalid_cursor()
    page, skip = state.get('p', 1), state.get('s', 0)
    if not is_index(page, 1):
        raise invalid_cursor()
    found = {}

    def result(next_page=None, next_skip=0):
        return {
            'items': list(found.values()),
            'next_cursor': None if next_page is None else encode_cursor('bili-user', q=keyword, p=next_page, s=next_skip),
            'has_more': next_page is not None,
        }

    for _ in range(requests):
        response = await checked(runner.client.search_user_by_keyword(keyword, page=page))
        rows = response.get('result') or []
        for index in range(skip, len(rows)):
            if len(found) >= limit:
                return result(page, index)
            creator = summarize_row(rows[index])
            if creator:
                found[creator['id']] = creator
        following = more_pages(page, response) if rows else None
        if following is None:
            return result()
        page, skip = following, 0
        if len(found) >= limit:
            break
    return result(page)


def parse_reference(value):
    value = value.strip()
    shared = re.search(r'https?://[^\s，。！？）】"\']+', value, re.I)
    if shared and not re.match(r'[a-z]+://', value, re.I):
        value = shared.group(0)
    if re.match(r'(space|m)\.bilibili\.com/|b23\.tv/', value, re.I):
        value = 'https://' + value
    if not value or len(value) > 2000:
        raise CreatorError('INVALID_CREATOR', '请输入博主主页链接、UID 或名称')
    if value.isdecimal():
        return 'id', value
    if not re.match(r'[a-z]+://', value, re.I):
        return 'name', value
    parsed = urlparse(value)
    host = (parsed.hostname or '').lower()
    if parsed.scheme != 'https' or not (host == 'b23.tv' or host == 'bilibili.com' or host.endswith('.bilibili.com')):
        raise CreatorError('INVALID_CREATOR', '请使用 B站的 HTTPS 博主主页链接')
    if host == 'b23.tv':
        return 'short', value
    match = re.match(r'/(\d+)', parsed.path) if host == 'space.bilibili.com' else re.match(r'/space/(\d+)', parsed.path)
    if not match:
        raise CreatorError('INVALID_CREATOR', '这不是博主主页链接，请打开博主主页后复制链接')
    return 'id', match.group(1)


async def resolve_creator(runner, reference):
    kind, value = parse_reference(reference)
    if kind == 'short':
        from desktop.links import resolve_link
        kind, value = parse_reference(await resolve_link(value, 'bili'))
    if kind == 'id':
        return value
    if kind != 'name':
        raise CreatorError('INVALID_CREATOR', '这不是博主主页链接，请打开博主主页后复制链接')
    candidates = (await search_creators(runner, value, RESOLVE_CANDIDATES, requests=1))['items']
    return pick_by_name(value, candidates, 'UID')


async def creator_profile(runner, identity):
    # 名片接口不需要签名，比 acc/info 更不容易触发风控
    response = await checked(runner.client.get('/x/web-interface/card', {'mid': identity}, enable_params_sign=False))
    card = response.get('card') or {}
    if not card.get('name'):
        raise CreatorError('CREATOR_NOT_FOUND', '没有找到这位博主，账号可能已注销')
    official = card.get('Official') or {}
    return creator_summary(
        'bili', identity, plain(card.get('name')), SPACE + identity,
        avatar=https_url(card.get('face')), signature=plain(card.get('sign')), followers=count(response.get('follower')),
        likes=count(response.get('like_num')), posts=count(response.get('archive_count')), verified=str(official.get('title') or ''),
    )


async def collect_search(runner, query, cursor=None, options=None):
    state = decode_cursor(cursor, 'bili-search')
    bound, start = state.get('q'), state.get('p', 1)
    if state and (not isinstance(bound, str) or not bound or (query and bound != query) or not is_index(start, 1)):
        raise invalid_cursor()
    query = bound or query

    def publish(next_page=None, next_skip=0):
        more = next_page is not None
        runner.emit('page', has_more=more, next_cursor=encode_cursor('bili-search', q=query, p=next_page, s=next_skip) if more else None)

    async def fetch(page):
        response = await checked(runner.client.search_video_by_keyword(query, page=page, **(options or {})))
        rows = response.get('result') or []
        return Page(rows, more_pages(page, response) if rows else None)

    async def save(row):
        await runner.collect_bili_video(row.get('aid'))

    await walk(runner, fetch, save, publish, start, state.get('s', 0), max_pages=SEARCH_MAX_PAGES, **LABEL)


async def collect_creator(runner, reference, cursor=None):
    state = decode_cursor(cursor, 'bili-posts')
    profile = None
    if state:
        identity, start = state.get('c'), state.get('p', 1)
        if not isinstance(identity, str) or not identity.isdecimal() or not is_index(start, 1):
            raise invalid_cursor()
        if reference:
            kind, value = parse_reference(reference)
            if kind == 'id' and value != identity:
                raise invalid_cursor()
    else:
        identity, start = await resolve_creator(runner, reference), 1
        profile = await announce_profile(runner, lambda: creator_profile(runner, identity))

    def publish(next_page=None, next_skip=0):
        more = next_page is not None
        runner.emit('page', has_more=more, next_cursor=encode_cursor('bili-posts', c=identity, p=next_page, s=next_skip) if more else None)

    announced = bool(state or profile)

    async def fetch(page):
        nonlocal announced
        response = await checked(runner.client.get_creator_videos(identity, page, POSTS_PAGE_SIZE))
        rows = (response.get('list') or {}).get('vlist') or []
        total = (response.get('page') or {}).get('count')
        if rows and not announced:
            announced = True
            runner.emit('creator', creator=creator_summary('bili', identity, plain(rows[0].get('author')), SPACE + identity, source='video'))
        return Page(rows, page + 1 if rows and (not is_index(total) or page * POSTS_PAGE_SIZE < total) else None)

    async def save(row):
        await runner.collect_bili_video(row.get('aid'))

    await walk(runner, fetch, save, publish, start, state.get('s', 0), empty_retries=EMPTY_PAGE_RETRIES, **LABEL)


async def load_feed(runner, cursor=None):
    state = decode_cursor(cursor, 'bili-feed')
    page = state.get('p', 1)
    if not is_index(page, 1):
        raise invalid_cursor()
    response = await checked(runner.client.get_home_feed(page=page))
    items = []
    for row in response.get('item') or []:
        # 推荐里还有直播和广告位，只保留能打开详情的视频
        if row.get('goto') == 'av' and row.get('id') and row.get('bvid'):
            items.append(feed_record(
                'bili', row['id'], plain(row.get('title')), (row.get('owner') or {}).get('name'),
                f"https://www.bilibili.com/video/{row['bvid']}", row.get('pic'), (row.get('stat') or {}).get('like'), 'video', author_url(row.get('owner')),
            ))
    return {'items': items, 'next_cursor': encode_cursor('bili-feed', p=page + 1), 'has_more': True}
