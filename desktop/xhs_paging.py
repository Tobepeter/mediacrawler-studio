"""小红书关键词搜索与博主主页的游标分页；列表只有摘要，每条笔记再取一次详情"""
import asyncio

from desktop.paging import (EMPTY_PAGE_RETRIES, CreatorError, Page, creator_summary, decode_cursor, encode_cursor, feed_record, invalid_cursor,
                            is_index, walk)

MAX_PAGES = 10
LABEL = {'label': '小红书', 'noun': '笔记'}
PROFILE = 'https://www.xiaohongshu.com/user/profile/'


def valid_text(*values):
    return all(isinstance(value, str) for value in values)


async def collect_search(runner, query, cursor=None, options=None):
    from media_platform.xhs.help import get_search_id
    state = decode_cursor(cursor, 'xhs-search')
    bound, page, search_id = state.get('q'), state.get('p', 1), state.get('i', '')
    if state and (not isinstance(bound, str) or not bound or (query and bound != query)
                  or not is_index(page, 1) or not valid_text(search_id)):
        raise invalid_cursor()
    query = bound or query
    search_id = search_id or get_search_id()

    def publish(next_page=None, next_skip=0):
        more = next_page is not None
        runner.emit('page', has_more=more, next_cursor=encode_cursor('xhs-search', q=query, p=next_page, i=search_id, s=next_skip) if more else None)

    async def fetch(position):
        response = await runner.client.get_note_by_keyword(query, search_id=search_id, page=position, **(options or {}))
        # 搜索词推荐卡片不是笔记，过滤后下标才能作为续采位置
        rows = [row for row in response.get('items') or [] if row.get('model_type') not in ('rec_query', 'hot_query')]
        return Page(rows, None if not rows or response.get('has_more') in (False, 0) else position + 1)

    semaphore = asyncio.Semaphore(1)

    async def save(row):
        if wants_cards(runner) and await save_card(runner, row, 'pc_search'):
            return
        await runner.collect_xhs_note(row.get('id'), row.get('xsec_source'), row.get('xsec_token'), semaphore)

    await walk(runner, fetch, save, publish, page, state.get('s', 0), max_pages=MAX_PAGES, **LABEL)


async def save_card(runner, row, source):
    """列表接口已带标题、封面、作者和点赞，一页一次请求；字段不全时返回 False，改取详情"""
    card = row.get('note_card') or row
    identity, token = row.get('id') or row.get('note_id'), row.get('xsec_token')
    title, user = card.get('display_title'), card.get('user') or {}
    if not identity or not token or not (title or card.get('cover')):
        return False
    key, cover = f'xhs:{identity}', card.get('cover') or {}
    runner.store.cards.add(key)
    runner.store.author_urls[key] = author_url(user, source)
    await runner.store.store_content({
        'note_id': identity, 'title': title or '', 'desc': '',
        'nickname': user.get('nickname') or user.get('nick_name') or '',
        'liked_count': (card.get('interact_info') or {}).get('liked_count'),
        'image_list': [cover.get('url_default') or cover.get('url_pre') or cover.get('url') or ''],
        'type': 'video' if card.get('type') == 'video' else 'note',
        'note_url': f'https://www.xiaohongshu.com/explore/{identity}?xsec_token={token}&xsec_source={row.get("xsec_source") or source}',
    })
    return True


def wants_cards(runner):
    # 采集评论要先有完整作品，这种情况仍然逐条取
    return bool(runner.request.get('listCards')) and not runner.request.get('comments')


def creator_url(user_id, token, source):
    return f'{PROFILE}{user_id}?xsec_token={token}&xsec_source={source}'


def author_url(user, source):
    identity, token = (user or {}).get('user_id'), (user or {}).get('xsec_token')
    return creator_url(identity, token, source) if identity and token else ''


def announce(runner, row, identity, token, source):
    user = row.get('user') or {}
    name = user.get('nickname') or user.get('nick_name')
    if name:
        runner.emit('creator', creator=creator_summary(
            'xhs', identity, str(name), creator_url(identity, token, source), source='video', avatar=str(user.get('avatar') or ''),
        ))


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

    def publish(next_position=None, next_skip=0):
        more = next_position is not None
        runner.emit('page', has_more=more, next_cursor=encode_cursor('xhs-posts', c=identity, t=token, a=source, m=next_position, s=next_skip) if more else None)

    async def fetch(current):
        response = await runner.client.get_notes_by_creator(identity, current, xsec_token=token, xsec_source=source)
        rows = response.get('notes') or []
        more, following = response.get('has_more') in (1, True), str(response.get('cursor') or '')
        if rows and not state and not current:
            announce(runner, rows[0], identity, token, source)
        return Page(rows, (following or current) if more and (following or not rows) else None)

    semaphore = asyncio.Semaphore(1)

    async def save(row):
        if wants_cards(runner) and await save_card(runner, row, 'pc_user'):
            return
        await runner.collect_xhs_note(row.get('note_id'), row.get('xsec_source') or 'pc_user', row.get('xsec_token'), semaphore)

    await walk(runner, fetch, save, publish, position, skip, empty_retries=EMPTY_PAGE_RETRIES, **LABEL)


async def load_feed(runner, cursor=None):
    from media_platform.xhs.exception import DataFetchError
    state = decode_cursor(cursor, 'xhs-feed')
    position, index = state.get('c', ''), state.get('i', 0)
    if not valid_text(position) or not is_index(index):
        raise invalid_cursor()
    try:
        response = await runner.client.get_home_feed(cursor=position, index=index)
    except DataFetchError as error:
        raise CreatorError('PLATFORM_ERROR', '小红书暂时没有返回数据，请稍后重试', cause=str(error)[:300]) from None
    rows = [row for row in response.get('items') or [] if row.get('model_type') == 'note' and row.get('id')]
    items = []
    for row in rows:
        card = row.get('note_card') or {}
        user, cover = card.get('user') or {}, card.get('cover') or {}
        token = row.get('xsec_token') or ''
        items.append(feed_record(
            'xhs', row['id'], card.get('display_title'), user.get('nickname') or user.get('nick_name'),
            f"https://www.xiaohongshu.com/explore/{row['id']}?xsec_token={token}&xsec_source=pc_feed",
            cover.get('url_default') or cover.get('url_pre') or cover.get('url'), (card.get('interact_info') or {}).get('liked_count'),
            'video' if card.get('type') == 'video' else 'note', author_url(user, 'pc_feed'),
        ))
    following = str(response.get('cursor_score') or '')
    more = bool(rows and following)
    return {'items': items, 'next_cursor': encode_cursor('xhs-feed', c=following, i=index + len(rows)) if more else None, 'has_more': more}
