"""平台请求的统一节流出口：按平台控制间隔，跨进程共享，并处理风控冷却

规则：采集相关的平台请求都必须经过这里，业务代码不要自己 sleep，也不要绕开 client 发请求
- 走 client 的请求由 pace_client 在底层自动接管，上游代码不用改
- 不走 client 的页面导航，在导航前调用 wait_turn

频率只改两张表：PLATFORM_RULES 是每个平台的基础节奏，RULES 给个别敏感接口定更慢的节奏
数值按正常用户操作节奏估算，未做线上压测。CLI 与桌面都是短进程且共用出口 IP，状态必须落盘共享
"""
import asyncio
import contextvars
import json
import math
import os
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from filelock import FileLock
from platformdirs import user_data_path

from desktop.paging import CreatorError

MAX_WAIT_SECONDS = 30
# 后台预取只在平台空闲时发：排队要等更久就放弃，不占用户接下来搜索、翻页的名额
BACKGROUND_WAIT_SECONDS = 3
# 一次业务调用只算一次访问：外层已占用名额时，内层底层请求不再重复等待
holding = contextvars.ContextVar('pacing_holding', default=False)


def first_search_page(args, kwargs):
    return not kwargs.get('offset', args[1] if len(args) > 1 else 0)


def first_page(args, kwargs):
    return kwargs.get('page', 1) == 1


def first_feed_page(args, kwargs):
    return not kwargs.get('cursor')


def unwrapped(error):
    attempt = getattr(error, 'last_attempt', None)
    return (attempt.exception() if attempt else None) or error


def xhs_blocked(error):
    # 上游对这些异常只跳过当前笔记，不拦住的话会继续逐条请求
    from media_platform.xhs.exception import IPBlockError, PlatformAccessError
    error = unwrapped(error)
    return isinstance(error, (IPBlockError, PlatformAccessError)) or 'CAPTCHA appeared' in str(error)


def bili_blocked(error):
    # 412 是整段 HTML，到不了 JSON 解析，只能从错误文本里认
    message = str(unwrapped(error))
    return any(text in message for text in ('请求被拦截', '风控校验失败', '请求过于频繁', '412'))


@dataclass(frozen=True)
class Rule:
    key: str
    page_gap: tuple
    fresh_gap: Optional[tuple] = None
    is_fresh: Optional[Callable] = None
    window_limit: int = 0
    window_seconds: int = 0
    # window_limit 只算换关键词和首屏；total_limit 连翻页一起算，共用时间线的规则要填同一个值
    total_limit: int = 0
    cooldown_seconds: int = 0
    name: str = '抖音'
    is_blocked: Optional[Callable] = None


# B 站 412 通常几分钟到半小时解除，冷却比小红书短
BILI_COOLDOWN = dict(cooldown_seconds=900, name='B站', is_blocked=bili_blocked)
RULES = {
    # B 站共用一条时间线，搜索、主页和详情都算同一个用户在连续操作
    ('bili', 'search_video_by_keyword'): Rule(key='bili', fresh_gap=(4, 7), page_gap=(3, 6), is_fresh=first_page, window_limit=30, window_seconds=600, **BILI_COOLDOWN),
    ('bili', 'search_user_by_keyword'): Rule(key='bili', fresh_gap=(4, 7), page_gap=(3, 6), is_fresh=first_page, window_limit=30, window_seconds=600, **BILI_COOLDOWN),
    ('bili', 'get_creator_videos'): Rule(key='bili', page_gap=(3, 6), **BILI_COOLDOWN),
    ('dy', 'search_info_by_keyword'): Rule(
        # 换关键词约等于用户看完一屏结果再搜下一个，翻页约等于看完一屏再向下滚动
        # 3-6 秒翻页时，几分钟内连续采几批就会触发验证；6-10 秒时首页后第二页仍触发过（2026-11-09 实际遇到）
        key='dy-search', fresh_gap=(10, 15), page_gap=(12, 20), is_fresh=first_search_page,
        window_limit=20, window_seconds=600, total_limit=30, cooldown_seconds=1800,
    ),
    # 推荐流和搜索算同一个用户在刷：共用时间线和上限，只有用户滚动才翻页
    ('bili', 'get_home_feed'): Rule(key='bili', fresh_gap=(4, 7), page_gap=(3, 6), is_fresh=first_page, window_limit=30, window_seconds=600, **BILI_COOLDOWN),
    ('dy', 'get_home_feed'): Rule(key='dy-search', fresh_gap=(4, 8), page_gap=(6, 10), is_fresh=first_page, window_limit=20, window_seconds=600, total_limit=30, cooldown_seconds=1800),
    ('xhs', 'get_home_feed'): Rule(key='xhs', fresh_gap=(4, 8), page_gap=(4, 7), is_fresh=first_feed_page, window_limit=20, window_seconds=600, cooldown_seconds=1800, name='小红书', is_blocked=xhs_blocked),
    ('dy', 'get_user_aweme_posts'): Rule(key='dy-user-posts', page_gap=(2, 4)),
    # 小红书共用一条时间线：搜索、主页和详情都算同一个用户在连续操作，验证也要一起停
    ('xhs', 'get_note_by_keyword'): Rule(
        key='xhs', fresh_gap=(8, 12), page_gap=(4, 7), is_fresh=first_page,
        window_limit=20, window_seconds=600, cooldown_seconds=1800, name='小红书', is_blocked=xhs_blocked,
    ),
    ('xhs', 'get_notes_by_creator'): Rule(key='xhs', page_gap=(3, 6), cooldown_seconds=1800, name='小红书', is_blocked=xhs_blocked),
}


# 每个平台的基础节奏，互不影响；一个平台被风控不牵连其他平台
XHS_COOLDOWN = dict(cooldown_seconds=1800, name='小红书', is_blocked=xhs_blocked)
PLATFORM_RULES = {
    'bili': Rule(key='bili', page_gap=(1, 2.5), **BILI_COOLDOWN),
    'dy': Rule(key='dy', page_gap=(1.5, 3), name='抖音'),
    'xhs': Rule(key='xhs', page_gap=(2, 3.5), **XHS_COOLDOWN),
    'zhihu': Rule(key='zhihu', page_gap=(2, 4), name='知乎'),
    'wb': Rule(key='wb', page_gap=(2, 4), name='微博'),
    'tieba': Rule(key='tieba', page_gap=(2, 4), name='贴吧'),
    'ks': Rule(key='ks', page_gap=(2, 4), name='快手'),
}
# 各平台实际发请求的底层方法；贴吧有一部分通过页面完成，不经过 request
TRANSPORTS = {'tieba': ('request', '_fetch_json_by_browser', 'get_notes_by_keyword', 'get_note_by_id')}
# 登录状态检查不算采集，冷却期也要能判断账号是否有效
EXEMPT = ('pong', 'query_self')


def state_path(rule):
    root = os.environ.get('MEDIACRAWLER_DATA_DIR') or user_data_path('mediacrawler', appauthor=False)
    return Path(root).expanduser() / 'pacing' / f'{rule.key}.json'


def read_state(path):
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def write_state(path, state):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state))
    temporary.replace(path)


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def locked(path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    return FileLock(str(path) + '.lock', timeout=5)


def reserve(path, rule, fresh, now=None, limit=None):
    """占用下一个可用时刻并返回需要等待的秒数；状态文件异常时放行，不阻断采集
    limit 是后台请求能接受的等待上限，超过时不占名额，抛 FEED_BUSY"""
    now = time.time() if now is None else now
    try:
        with locked(path):
            state = read_state(path)
            blocked = number(state.get('blocked_until'))
            if blocked > now:
                minutes = math.ceil((blocked - now) / 60)
                raise CreatorError('RATE_COOLDOWN', f'平台要求过验证，已暂停访问，请约 {minutes} 分钟后再试', retry_after=math.ceil(blocked - now))
            last = number(state.get('last_at'))
            # 超出排队范围的未来时间只可能来自时钟调整
            if last > now + MAX_WAIT_SECONDS * 2:
                last = 0
            start = max(now, last + random.uniform(*(rule.fresh_gap if fresh and rule.fresh_gap else rule.page_gap)))
            stamps = state.get('recent')
            recent = [stamp for stamp in stamps if number(stamp) > now - rule.window_seconds] if isinstance(stamps, list) else []
            over = fresh and rule.window_limit and len(recent) >= rule.window_limit
            stored = state.get('total')
            total = [stamp for stamp in stored if number(stamp) > now - rule.window_seconds] if isinstance(stored, list) else []
            full = rule.total_limit and len(total) >= rule.total_limit
            retry_after = max(start - now, recent[0] + rule.window_seconds - now if over else 0, total[0] + rule.window_seconds - now if full else 0)
            if limit is not None and retry_after > limit:
                raise CreatorError('FEED_BUSY', '平台正忙，稍后再试', retry_after=math.ceil(retry_after))
            if over or full or retry_after > MAX_WAIT_SECONDS:
                raise CreatorError('RATE_LIMITED', f'操作太频繁，请约 {math.ceil(retry_after)} 秒后再试', retry_after=math.ceil(retry_after))
            write_state(path, {**state, 'last_at': start, 'recent': recent + [start] if fresh and rule.window_limit else recent, 'total': total + [start] if rule.total_limit else total})
    except OSError:
        return 0
    return start - now


def start_cooldown(path, rule, now=None):
    now = time.time() if now is None else now
    try:
        with locked(path):
            write_state(path, {**read_state(path), 'blocked_until': now + rule.cooldown_seconds})
    except OSError:
        pass


def paced(original, rule, report=None, limit=None):
    def verification(path):
        # 继续请求只会加重风控，冷却期内直接本地拒绝
        start_cooldown(path, rule)
        if report:
            report('pacing-cooldown', key=rule.key, seconds=rule.cooldown_seconds)
        minutes = math.ceil(rule.cooldown_seconds / 60)
        return CreatorError('SEARCH_VERIFICATION_REQUIRED', f'{rule.name}要求验证，访问暂停约 {minutes} 分钟', retry_after=rule.cooldown_seconds)

    async def call(*args, **kwargs):
        if holding.get():
            return await original(*args, **kwargs)
        path = state_path(rule)
        fresh = bool(rule.is_fresh and rule.is_fresh(args, kwargs))
        wait = reserve(path, rule, fresh, limit=limit)
        if report and wait >= 1:
            report('pacing-wait', key=rule.key, seconds=round(wait, 1), fresh=fresh)
        await asyncio.sleep(wait)
        token = holding.set(True)
        try:
            response = await original(*args, **kwargs)
        except Exception as error:
            if rule.is_blocked and rule.is_blocked(error):
                raise verification(path) from None
            raise
        finally:
            holding.reset(token)
        if rule.cooldown_seconds and isinstance(response, dict) and (response.get('search_nil_info') or {}).get('search_nil_type') == 'verify_check':
            raise verification(path)
        return response
    return call


def exempted(original):
    async def call(*args, **kwargs):
        token = holding.set(True)
        try:
            return await original(*args, **kwargs)
        finally:
            holding.reset(token)
    return call


def pace_client(client, platform, report=None, limit=None):
    base = PLATFORM_RULES.get(platform)
    wrap = {method: rule for (owner, method), rule in RULES.items() if owner == platform}
    if base:
        for method in TRANSPORTS.get(platform, ('request',)):
            wrap.setdefault(method, base)
    for method, rule in wrap.items():
        original = getattr(client, method, None)
        if original is not None:
            setattr(client, method, paced(original, rule, report, limit))
    for method in EXEMPT:
        original = getattr(client, method, None)
        if original is not None:
            setattr(client, method, exempted(original))


async def wait_turn(platform, report=None):
    """不走 client 的页面导航用这个排队，节奏和该平台的其他请求共用"""
    rule = PLATFORM_RULES[platform]
    wait = reserve(state_path(rule), rule, False)
    if report and wait >= 1:
        report('pacing-wait', key=rule.key, seconds=round(wait, 1), fresh=False)
    await asyncio.sleep(wait)
