"""小红书关键词搜索与博主主页的游标分页，桌面与 CLI 共用

列表接口只有摘要，每条笔记还要取一次详情，详情的节奏由 desktop.pacing 统一控制
"""
import asyncio

from desktop.creators import CreatorError, decode_cursor, encode_cursor, invalid_cursor

MAX_PAGES = 10
EMPTY_PAGE_RETRIES = 2
PROFILE = 'https://www.xiaohongshu.com/user/profile/'


def valid_text(*values):
    return all(isinstance(value, str) for value in values)


async def collect_rows(runner, rows, skip, get_row, on_limit):
    """逐条取详情；数量够了就记录位置返回 True，被风控时先保存位置再向上抛"""
    semaphore, store, index = asyncio.Semaphore(1), runner.store, skip
    try:
        for index in range(skip, len(rows)):
            if len(store.ids) >= store.limit:
                on_limit(index)
                return True
            await runner.collect_xhs_note(*get_row(rows[index]), semaphore)
    except CreatorError:
        on_limit(index)
        raise
    return False


async def collect_search(runner, query, cursor=None, options=None):
    from media_platform.xhs.help import get_search_id
    state = decode_cursor(cursor, 'xhs-search')
    bound, page, search_id = state.get('q'), state.get('p', 1), state.get('i', '')
    if state and (not isinstance(bound, str) or not bound or (query and bound != query)
                  or not isinstance(page, int) or isinstance(page, bool) or page < 1 or not valid_text(search_id)):
        raise invalid_cursor()
    query, skip, store = bound or query, state.get('s', 0), runner.store
    search_id = search_id or get_search_id()

    def publish(next_page=None, next_skip=0):
        more = next_page is not None
        runner.emit('page', has_more=more, next_cursor=encode_cursor('xhs-search', q=query, p=next_page, i=search_id, s=next_skip) if more else None)

    def row_args(row):
        return row.get('id'), row.get('xsec_source'), row.get('xsec_token')

    for _ in range(MAX_PAGES):
        response = await runner.client.get_note_by_keyword(query, search_id=search_id, page=page, **(options or {}))
        # 搜索词推荐卡片不是笔记，过滤后下标才能作为续采位置
        rows = [row for row in response.get('items') or [] if row.get('model_type') not in ('rec_query', 'hot_query')]
        current = page
        if await collect_rows(runner, rows, skip, row_args, lambda index: publish(current, index)):
            return
        if not rows or response.get('has_more') in (False, 0):
            publish()
            return
        page, skip = page + 1, 0
        if len(store.ids) >= store.limit:
            break
    publish(page)


def creator_url(user_id, token, source):
    return f'{PROFILE}{user_id}?xsec_token={token}&xsec_source={source}'


def announce(runner, row, identity, token, source):
    user = row.get('user') or {}
    name = user.get('nickname') or user.get('nick_name')
    if name:
        runner.emit('creator', creator={
            'type': 'creator', 'platform': 'xhs', 'id': identity, 'name': str(name),
            'avatar': str(user.get('avatar') or ''), 'followers': None, 'posts': None,
            'url': creator_url(identity, token, source),
        })


async def collect_creator(runner, reference, cursor=None):
    from media_platform.xhs.help import parse_creator_info_from_url
    state = decode_cursor(cursor, 'xhs-posts')
    if state:
        identity, token, source = state.get('c'), state.get('t'), state.get('a', 'pc_feed')
        if not identity or not token or not valid_text(identity, token, source, state.get('m', '')):
            raise invalid_cursor()
        position, skip = state.get('m', ''), state.get('s', 0)
    else:
        try:
            info = parse_creator_info_from_url(reference)
        except ValueError:
            raise CreatorError('INVALID_CREATOR', '请使用小红书博主主页的完整链接') from None
        identity, token, source = info.user_id, info.xsec_token, info.xsec_source or 'pc_feed'
        if not token:
            raise CreatorError('XSEC_TOKEN_REQUIRED', '这个主页链接缺少访问参数，请从 App 分享或网页地址栏复制完整链接')
        position, skip = '', 0
    store, empty = runner.store, 0

    def publish(next_position=None, next_skip=0):
        more = next_position is not None
        runner.emit('page', has_more=more, next_cursor=encode_cursor('xhs-posts', c=identity, t=token, a=source, m=next_position, s=next_skip) if more else None)

    def row_args(row):
        return row.get('note_id'), row.get('xsec_source') or 'pc_user', row.get('xsec_token')

    while True:
        response = await runner.client.get_notes_by_creator(identity, position, xsec_token=token, xsec_source=source)
        rows = response.get('notes') or []
        more = response.get('has_more') in (1, True)
        following = str(response.get('cursor') or '')
        if not rows:
            if not more:
                publish()
                return
            if empty >= EMPTY_PAGE_RETRIES:
                runner.emit('warning', message='小红书暂时没有返回更多笔记，可稍后从当前位置继续')
                publish(position, skip)
                return
            empty += 1
            continue
        if not state and not position:
            announce(runner, rows[0], identity, token, source)
        empty, current = 0, position
        if await collect_rows(runner, rows, skip, row_args, lambda index: publish(current, index)):
            return
        if not more or not following or following == position:
            if more and following == position:
                runner.emit('warning', message='小红书返回的翻页位置没有变化，已停止继续获取')
            publish()
            return
        position, skip = following, 0
        if len(store.ids) >= store.limit:
            publish(position)
            return
