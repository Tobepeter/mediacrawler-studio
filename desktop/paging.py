"""分页采集的通用部分：错误类型、不透明游标、逐页遍历和博主资料，各平台只负责取数和解析"""
import base64
import binascii
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import count as forever
from pathlib import Path
from typing import Any

# 平台字段不可信，进入列表和历史前限制长度；完整内容仍在正文里
TITLE_LIMIT = 80
AUTHOR_LIMIT = 64
CAPABILITIES = json.loads(Path(__file__).with_name('platform-capabilities.json').read_text())
CREATOR_PLATFORMS = tuple(CAPABILITIES['creator'])
CREATOR_SEARCH_PLATFORMS = tuple(CAPABILITIES['creatorSearch'])
PAGED_SEARCH_PLATFORMS = tuple(CAPABILITIES['pagedSearch'])
FEED_PLATFORMS = tuple(CAPABILITIES['feed'])
EMPTY_PAGE_RETRIES = 2


class CreatorError(RuntimeError):
    """str(error) 给界面展示，code 与 candidates 给 CLI 的结构化错误"""

    def __init__(self, code, message, candidates=None, retry_after=None, cause=None):
        super().__init__(message)
        self.code, self.candidates, self.retry_after, self.cause = code, candidates or [], retry_after, cause


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
    if not is_index(state.get('s', 0)):
        raise invalid_cursor()
    return state


def is_index(value, minimum=0):
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def count(value):
    return value if is_index(value) else None


def creator_summary(platform, identity, name, url, source='user', **fields):
    return {
        'type': 'creator', 'platform': platform, 'id': identity, 'name': name, 'url': url, 'source': source,
        'uniqueId': '', 'avatar': '', 'signature': '', 'followers': None, 'likes': None, 'posts': None,
        'verified': '', 'private': False, **fields,
    }


def https_url(value):
    if not isinstance(value, str):
        return ''
    return f'https:{value}' if value.startswith('//') else f'https://{value[7:]}' if value.startswith('http://') else value


def feed_record(platform, identity, title, author, url, cover, likes, content_type, author_url=''):
    """推荐流卡片只用列表接口自带的字段，正文和媒体在打开详情时补"""
    image = https_url(cover)
    return {
        'id': f'{platform}:{identity}', 'platform': platform, 'title': str(title or '未命名作品')[:TITLE_LIMIT], 'text': '', 'author': str(author or '')[:AUTHOR_LIMIT],
        'images': [image] if image.startswith('https://') else [], 'url': url, 'likes': str(likes or 0),
        'collectedAt': datetime.now(timezone.utc).isoformat(), 'contentType': content_type, 'feed': True,
        **({'authorUrl': author_url} if author_url else {}),
    }


def pick_by_name(value, candidates, identifier):
    """名称解析只接受唯一且完全匹配的结果，否则把候选交给调用方"""
    expected = value.casefold()
    matches = [creator for creator in candidates if expected in (creator['name'].casefold(), creator['uniqueId'].casefold())]
    if len(matches) == 1:
        return matches[0]['id']
    if matches:
        raise CreatorError('CREATOR_AMBIGUOUS', f'有多位博主叫“{value}”，请改用 {identifier} 或主页链接', matches)
    raise CreatorError('CREATOR_NOT_FOUND', f'没有找到名称完全匹配“{value}”的博主', candidates[:10])


async def announce_profile(runner, load):
    """资料只用于展示，接口偶发失败时作品接口通常仍可用，不能因此中断采集"""
    try:
        profile = await load()
    except CreatorError as error:
        if error.code != 'PLATFORM_ERROR':
            raise
        runner.emit('log', level='warn', event='creator-profile-unavailable', detail={'cause': error.cause})
        return None
    if profile:
        runner.emit('creator', creator=profile)
        runner.emit('state', status='running', message=f"正在获取 {profile['name']} 的作品")
    return profile


@dataclass
class Page:
    rows: list
    following: Any = None  # 下一页位置，None 表示已到末尾


async def walk(runner, fetch, save, publish, position, skip=0, max_pages=None, empty_retries=0, label='平台', noun='内容', one_page=False):
    """逐页逐条保存，数量够了或被风控时把位置精确到页内，续采不漏不重"""
    store, empty = runner.store, 0
    for _ in range(max_pages) if max_pages else forever():
        page = await fetch(position)
        if not page.rows:
            if page.following is None:
                publish()
                return
            if empty >= empty_retries:
                # 有更多却连续空页，通常是风控；保留位置，稍后可从这里继续
                runner.emit('warning', message=f'{label}暂时没有返回更多{noun}，可稍后从当前位置继续')
                publish(position, skip)
                return
            empty += 1
            continue
        empty, index = 0, skip
        try:
            for index in range(skip, len(page.rows)):
                if len(store.ids) >= store.limit:
                    publish(position, index)
                    return
                await save(page.rows[index])
        except CreatorError:
            publish(position, index)
            raise
        if page.following is None:
            publish()
            return
        if page.following == position:
            runner.emit('warning', message=f'{label}返回的翻页位置没有变化，已停止继续获取')
            publish()
            return
        publish(page.following)
        if one_page or len(store.ids) >= store.limit:
            return
        position, skip = page.following, 0
