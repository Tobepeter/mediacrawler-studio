"""功能体检：用当前账号把推荐、博主页、搜索各请求一次，看条数和字段有没有变；不翻页、不取详情、不写历史"""
import asyncio

from desktop.creators import load_feed
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


def missing_fields(platform, items):
    exempt = FIELD_EXEMPT.get(platform, ())
    return [name for name in CARD_FIELDS if name not in exempt and sum(bool(item.get(name)) for item in items) < len(items) * COVERAGE]


class Checks:
    def __init__(self, runner):
        self.runner, self.results, self.stopped = runner, [], ''

    def skip(self, name, message):
        self.results.append({'id': name, 'status': 'skipped', 'message': message})

    async def attempt(self, name, call, floor, inspect=None):
        """返回取到的内容；失败只记结果，一项坏了不影响查其他项"""
        if self.stopped:
            self.skip(name, self.stopped)
            return None
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
        self.results.append({'id': name, 'status': status, 'count': count, 'expected': floor, 'missing': missing})
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
    # 搜索最容易触发验证，放在最后
    await checks.attempt('search', lambda: search_rows(runner), SEARCH_FLOOR)
    return checks.results
