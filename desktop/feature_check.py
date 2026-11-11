"""功能体检：用当前账号把推荐、博主页、详情、下载、搜索各走一次，看条数和字段有没有变；不翻页、不写历史、不落盘"""
import asyncio

import httpx

from desktop.creators import load_feed
from desktop.links import HOSTS, media_referer
from desktop.media_download import public_request
from desktop.paging import https_url
from media_downloader.downloader import DEFAULT_USER_AGENT
from desktop.pacing import wait_turn
from desktop.paging import CreatorError

KEYWORD = '咖啡'
# 低于这些条数说明接口行为变了，比如抖音参数不对时只回 3–8 条；数值取平时的一半左右
FEED_FLOOR = {'bili': 8, 'dy': 10, 'xhs': 8, 'zhihu': 3}
SEARCH_FLOOR = 5
COVERAGE = 0.8
CARD_FIELDS = ('title', 'author', 'url', 'images', 'authorUrl')
FIELD_EXEMPT = {'zhihu': ('images',)}  # 知乎回答可以没有配图
# 风控和冷却时继续请求只会加重，这个平台剩下的项目直接跳过
STOPPING = ('RATE_COOLDOWN', 'RATE_LIMITED', 'SEARCH_VERIFICATION_REQUIRED')


async def search_rows(runner):
    client, platform = runner.client, runner.platform
    if platform == 'bili':
        return (await client.search_video_by_keyword(KEYWORD, page=1)).get('result') or []
    if platform == 'dy':
        return (await client.search_info_by_keyword(KEYWORD, offset=0)).get('data') or []
    if platform == 'xhs':
        from media_platform.xhs.help import get_search_id
        response = await client.get_note_by_keyword(KEYWORD, search_id=get_search_id(), page=1)
        return [row for row in response.get('items') or [] if row.get('model_type') not in ('rec_query', 'hot_query')]
    # 知乎搜索依赖搜索页生成的 Cookie，和正常搜索走同样的准备
    await wait_turn('zhihu')
    await runner.page.goto(f'https://www.zhihu.com/search?q={KEYWORD}&type=content', wait_until='domcontentloaded')
    await asyncio.sleep(3)
    await client.update_cookies(runner.context)
    return await client.get_note_by_keyword(KEYWORD, page=1)


async def creator_rows(runner, url):
    client, platform = runner.client, runner.platform
    identity = url.split('?')[0].rstrip('/').rsplit('/', 1)[-1]
    if platform == 'bili':
        return ((await client.get_creator_videos(identity, 1)).get('list') or {}).get('vlist') or []
    if platform == 'dy':
        return (await client.get_user_aweme_posts(identity)).get('aweme_list') or []
    if platform == 'xhs':
        from media_platform.xhs.help import parse_creator_info_from_url
        info = parse_creator_info_from_url(url)
        return (await client.get_notes_by_creator(info.user_id, '', xsec_token=info.xsec_token, xsec_source=info.xsec_source or 'pc_feed')).get('notes') or []
    return (await client.get_creator_answers(identity, 0, 20) or {}).get('data') or []


def pick_sample(platform, items):
    # 知乎正文就在卡片里，挑带图的探测下载；其他平台优先视频，下载最容易坏的就是它
    if platform == 'zhihu':
        return next((item for item in items if item.get('images')), None)
    return next((item for item in items if item.get('contentType') == 'video'), items[0] if items else None)


async def detail_rows(runner, record):
    if runner.platform == 'zhihu':
        return [record] if record.get('text') else []
    await runner.client.update_cookies(runner.context)
    runner.request = {**runner.request, 'mode': 'link', 'query': record['url']}
    await runner.detail()
    full = runner.store.items.get(record['id'])
    return [{**full, 'contentType': record.get('contentType')}] if full and (full.get('text') or full.get('images')) else []


async def media_source(runner, record):
    if record.get('contentType') == 'video' and runner.platform != 'zhihu':
        from desktop.media_resolver import MediaResolver
        async for item in MediaResolver(record, runner.page, runner=runner).videos():
            return [item.url, *item.backup_urls], item.headers or {}
        return [], {}
    return (record.get('images') or [])[:1], {}


async def probe_media(url, headers, platform):
    """只要响应头：Range 限定前 2 字节，读到状态就断开，不下载也不写文件"""
    # 请求头要和真实下载一致，B站 CDN 不认默认的 python-httpx
    request_headers = {'User-Agent': DEFAULT_USER_AGENT, 'Range': 'bytes=0-1', **({'Referer': media_referer(platform)} if platform in HOSTS else {}), **headers}
    async with httpx.AsyncClient(follow_redirects=True, timeout=15, event_hooks={'request': [public_request]}) as client:
        async with client.stream('GET', https_url(url), headers=request_headers) as response:
            kind = response.headers.get('content-type', '').split('/')[0].lower()
            if response.status_code not in (200, 206):
                raise CreatorError('MEDIA_UNAVAILABLE', f'媒体地址访问失败（HTTP {response.status_code}）')
            if kind not in ('video', 'image', 'audio', 'application'):
                raise CreatorError('MEDIA_UNAVAILABLE', '媒体地址返回的不是媒体文件')


async def download_rows(runner, record):
    urls, headers = await media_source(runner, record)
    failure = None
    # 真实下载会换备用线路，有一条能用就算正常
    for url in urls:
        try:
            await probe_media(url, headers, runner.platform)
            return [url]
        except (CreatorError, RuntimeError, httpx.HTTPError) as error:
            failure = error
    if isinstance(failure, CreatorError):
        raise failure
    if failure:
        raise CreatorError('MEDIA_UNAVAILABLE', '媒体地址无法访问')
    return []


def missing_fields(platform, items):
    exempt = FIELD_EXEMPT.get(platform, ())
    return [name for name in CARD_FIELDS if name not in exempt and sum(bool(item.get(name)) for item in items) < len(items) * COVERAGE]


class Checks:
    def __init__(self, runner):
        self.runner, self.results, self.stopped = runner, [], ''

    def skip(self, name, message):
        self.results.append({'id': name, 'status': 'skipped', 'message': message})

    async def attempt(self, name, call, floor, inspect=None, counted=True):
        """返回取到的内容；失败只记结果，一项坏了不影响查其他项"""
        if self.stopped:
            self.skip(name, self.stopped)
            return None
        self.runner.emit('feature-progress', step=name, results=self.results)
        try:
            rows = await call()
        except CreatorError as error:
            if error.code in STOPPING:
                self.stopped = str(error)
                self.skip(name, self.stopped)
            else:
                self.results.append({'id': name, 'status': 'failed', 'message': str(error)})
            return None
        except Exception as error:
            self.runner.emit('log', level='warn', event='feature-check-failed', detail={'check': name, 'name': type(error).__name__, 'cause': str(error)[:300]})
            self.results.append({'id': name, 'status': 'failed', 'message': '接口请求失败'})
            return None
        count, missing = len(rows), (inspect(rows) if inspect and rows else [])
        status = 'failed' if not count else 'degraded' if count < floor or missing else 'ok'
        self.results.append({'id': name, 'status': status, 'missing': missing, **({'count': count, 'expected': floor} if counted else {})})
        return rows


async def run_checks(runner):
    platform, checks = runner.platform, Checks(runner)

    async def feed():
        return (await load_feed(runner))['items']

    items = await checks.attempt('feed', feed, FEED_FLOOR[platform], lambda rows: missing_fields(platform, rows)) or []
    author = next((item['authorUrl'] for item in items if item.get('authorUrl')), '')
    if author or checks.stopped:
        await checks.attempt('creator', lambda: creator_rows(runner, author), 1)
    else:
        checks.skip('creator', '推荐里没有拿到博主主页')
    sample = pick_sample(platform, items)
    full = sample and await checks.attempt('detail', lambda: detail_rows(runner, sample), 1, counted=False)
    if not sample:
        checks.skip('detail', '推荐里没有可检查的作品')
    if full or (sample and checks.stopped):
        await checks.attempt('download', lambda: download_rows(runner, full[0] if full else sample), 1, counted=False)
    else:
        checks.skip('download', '详情没有拿到，跳过')
    # 搜索最容易触发验证，放在最后
    await checks.attempt('search', lambda: search_rows(runner), SEARCH_FLOOR)
    # 体检本身也发请求，日志里要能和用户操作区分开
    runner.emit('log', level='info', event='feature-check', detail={'platform': platform, 'results': {item['id']: item['status'] for item in checks.results}})
    return checks.results
