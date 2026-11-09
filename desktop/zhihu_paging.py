"""知乎博主主页：回答、文章、视频依次翻页，列表自带正文，不用逐条请求详情"""
import re

from urllib.parse import parse_qs, urlparse

from tenacity import RetryError

from desktop.paging import (CreatorError, Page, announce_profile, count, creator_summary, decode_cursor, encode_cursor, feed_record, https_url, invalid_cursor,
                            is_index, walk)

PEOPLE = 'https://www.zhihu.com/people/'
TABS = ('answers', 'articles', 'videos')
PAGE_SIZE = 20
LABEL = {'label': '知乎', 'noun': '内容'}


def author_url(author):
    author = author or {}
    # 上游模型不保留 url_token，主页地址只在桌面结果里用；匿名用户没有 token
    author = author.get('member') or author
    token = author.get('url_token') or author.get('urlToken')
    return f'{PEOPLE}{token}' if token else ''


def track_authors(runner):
    """搜索和详情都经过这三个解析函数，在这里记下原始作者，不改上游入库字段"""
    extractor = runner.client._extractor

    def tracked(original):
        def extract(raw):
            item = original(raw)
            runner.store.author_urls[f'zhihu:{item.content_type}:{item.content_id}'] = author_url(raw.get('author'))
            return item
        return extract

    for name in ('_extract_answer_content', '_extract_article_content', '_extract_zvideo_content'):
        setattr(extractor, name, tracked(getattr(extractor, name)))


def parse_reference(reference):
    value = str(reference or '').strip()
    match = re.search(r'zhihu\.com/people/([^/?#]+)', value)
    token = match.group(1) if match else value
    if not re.fullmatch(r'[\w.-]+', token):
        raise CreatorError('INVALID_CREATOR', '请输入知乎主页链接')
    return token


async def checked(call):
    from media_platform.zhihu.exception import DataFetchError, ForbiddenError
    try:
        return await call
    # 上游 get 带重试，失败时外层拿到的是 RetryError
    except (DataFetchError, ForbiddenError, RetryError) as error:
        raise CreatorError('PLATFORM_ERROR', '知乎暂时没有返回数据，请稍后重试', cause=str(error)[:300]) from None


async def creator_profile(runner, token):
    info = await checked(runner.client.get_creator_info(token))
    if not info or not info.user_nickname:
        return None
    return creator_summary(
        'zhihu', token, info.user_nickname, PEOPLE + token, followers=count(info.fans),
        posts=info.anwser_count + info.article_count + info.video_count,
    )


def valid_position(position):
    return isinstance(position, list) and len(position) == 2 and is_index(position[1]) and is_index(position[0]) and position[0] < len(TABS)


async def collect_creator(runner, reference, cursor=None):
    from desktop.extra_platforms import ExtraCollector
    state = decode_cursor(cursor, 'zhihu-posts')
    profile = None
    if state:
        token, start = state.get('c'), state.get('m')
        if not isinstance(token, str) or not token or not valid_position(start):
            raise invalid_cursor()
        if reference and parse_reference(reference) != token:
            raise invalid_cursor()
    else:
        token, start = parse_reference(reference), [0, 0]
        profile = await announce_profile(runner, lambda: creator_profile(runner, token))
    announced, collector = bool(state or profile), ExtraCollector(runner)

    def publish(position=None, skip=0):
        more = position is not None
        runner.emit('page', has_more=more, next_cursor=encode_cursor('zhihu-posts', c=token, m=position, s=skip) if more else None)

    async def fetch(position):
        nonlocal announced
        tab, offset = position
        # 没有回答的博主直接看文章；空标签按到底处理，最多多问两次
        while True:
            load = getattr(runner.client, f'get_creator_{TABS[tab]}')
            response = await checked(load(token, offset, PAGE_SIZE))
            data = (response or {}).get('data') or []
            rows = runner.client._extractor.extract_content_list_from_creator(data)
            ended = not data or (response.get('paging') or {}).get('is_end') is not False
            following = [tab, offset + PAGE_SIZE] if not ended else [tab + 1, 0] if tab + 1 < len(TABS) else None
            if rows:
                if not announced and rows[0].user_nickname:
                    announced = True
                    runner.emit('creator', creator=creator_summary('zhihu', token, rows[0].user_nickname, PEOPLE + token, source='video'))
                return Page(rows, following)
            if following is None:
                return Page([], None)
            tab, offset = following

    await walk(runner, fetch, collector.save, publish, start, state.get('s', 0), one_page=bool(runner.request.get('auto')), **LABEL)


def card(target, item):
    url = f'https://www.zhihu.com/zvideo/{item.content_id}' if item.content_type == 'zvideo' else item.content_url
    record = feed_record(
        'zhihu', f'{item.content_type}:{item.content_id}', item.title, item.user_nickname, url,
        (item.image_list or [target.get('thumbnail')])[0], item.voteup_count, item.content_type, author_url(target.get('author')),
    )
    # 接口自带正文和配图，卡片一次给全，打开详情不用再请求
    images = [https_url(image) for image in item.image_list]
    return {**record, 'text': item.content_text or item.desc, 'images': [image for image in images if image.startswith('https://')] or record['images']}


async def load_feed(runner, cursor=None):
    state = decode_cursor(cursor, 'zhihu-feed')
    page, after, session = state.get('p', 1), state.get('a', 0), state.get('t', '')
    if not is_index(page, 1) or not is_index(after) or not isinstance(session, str):
        raise invalid_cursor()
    response = await checked(runner.client.get_home_feed(page=page, after_id=after, session_token=session))
    items = []
    for row in (response or {}).get('data') or []:
        target = row.get('target') or {}
        # 推荐里还混有广告和圈子卡片，只留能打开的回答、文章和视频
        for item in runner.client._extractor.extract_content_list_from_creator([target]):
            if item.content_id and item.title:
                items.append(card(target, item))
    paging = (response or {}).get('paging') or {}
    query = parse_qs(urlparse(paging.get('next') or '').query)
    following = encode_cursor('zhihu-feed', p=page + 1, a=int((query.get('after_id') or [after + len(items)])[0]), t=(query.get('session_token') or [session])[0])
    more = bool(items) and paging.get('is_end') is not True
    return {'items': items, 'next_cursor': following if more else None, 'has_more': more}
