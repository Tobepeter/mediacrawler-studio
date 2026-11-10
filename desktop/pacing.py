"""平台请求的统一节流出口：按接口分组，每组两个桶，跨进程共享，并处理风控冷却

规则：采集相关的平台请求都必须经过这里，业务代码不要自己 sleep，也不要绕开 client 发请求
- 走 client 的请求由 pace_client 在底层自动接管，上游代码不用改
- 一次用户动作（打开博主页、打开详情）用 visit 包住，只算一次，内部请求不互相等
- 不走 client 的页面导航，在导航前调用 wait_turn

频率只改 PLATFORMS 一张表：
- 小桶 burst + gap：空闲时可以连发 burst 次，用完后按 gap 间隔恢复
- 大桶 window：一段时间内的总量，pool 相同的组共用一个大桶
- 冷却是平台级的，任何接口命中验证信号，整个平台一起停
数值按正常用户操作节奏估算，未做线上压测。CLI 与桌面都是短进程且共用出口 IP，状态必须落盘共享
"""
import asyncio
import contextvars
import json
import math
import os
import random
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from statistics import fmean
from typing import Callable, Optional
from urllib.parse import urlsplit

from filelock import FileLock, Timeout
from platformdirs import user_data_path

from desktop.paging import CreatorError

MAX_WAIT_SECONDS = 30
# 时钟调整才会出现这么远的未来时间
CLOCK_JUMP_SECONDS = 3600
# 后台任务不能把大桶用光，要给用户接下来的操作留余量
BACKGROUND_SHARE = 0.7
# 一次动作内免排队的请求数上限，超出的按所在组正常排队
VISIT_REQUESTS = 6
# 24 小时内反复命中验证时冷却翻倍
STRIKE_SECONDS = 86400
MAX_COOLDOWN_SECONDS = 21600
OTHER = 'other'
MINUTES_10 = 600
# 一次业务调用只算一次访问：外层已占用名额时，内层底层请求不再重复等待
holding = contextvars.ContextVar('pacing_holding', default=False)
current_visit = contextvars.ContextVar('pacing_visit', default=None)


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
    return isinstance(error, (IPBlockError, PlatformAccessError))


def bili_blocked(error):
    # 412 是整段 HTML，到不了 JSON 解析，只能从错误文本里认
    message = str(unwrapped(error))
    return any(text in message for text in ('请求被拦截', '风控校验失败', '请求过于频繁', '412'))


def dy_verify_response(response):
    return (response.get('search_nil_info') or {}).get('search_nil_type') == 'verify_check'


@dataclass(frozen=True)
class Group:
    gap: tuple
    burst: int = 1
    window: tuple = ()  # (次数, 秒)
    pool: str = ''  # 大桶归属，默认用组名


@dataclass(frozen=True)
class Route:
    group: str
    page: str = ''  # 翻页走的组，不填则都算 group
    is_first: Optional[Callable] = None

    def pick(self, args, kwargs):
        return self.page if self.page and not self.is_first(args, kwargs) else self.group


@dataclass(frozen=True)
class Platform:
    name: str
    groups: dict
    methods: dict = field(default_factory=dict)  # client 方法 -> Route
    paths: tuple = ()  # (接口路径前缀, 组名)，组名 None 表示不限流
    cooldown: int = 0
    is_blocked: Optional[Callable] = None
    is_blocked_response: Optional[Callable] = None
    transports: tuple = ('request',)


SEARCH_ROUTE = Route('search', 'search_page', first_page)
FEED_ROUTE = Route('feed', 'feed_page', first_page)
PLATFORMS = {
    'dy': Platform(
        '抖音',
        groups={
            # 3-6 秒翻页时，几分钟内连续采几批就会触发验证；6-10 秒时首页后第二页仍触发过（2026-11-09 实际遇到）
            'search': Group(gap=(10, 15), window=(30, MINUTES_10), pool='content'),
            'search_page': Group(gap=(12, 20), window=(30, MINUTES_10), pool='content'),
            'feed': Group(gap=(4, 8), window=(30, MINUTES_10), pool='content'),
            'feed_page': Group(gap=(6, 10), window=(30, MINUTES_10), pool='content'),
            'creator': Group(gap=(8, 12), burst=3, window=(12, MINUTES_10)),
            'creator_page': Group(gap=(2, 4), window=(40, MINUTES_10)),
            'detail': Group(gap=(1.5, 3), burst=4, window=(60, MINUTES_10)),
            'comment': Group(gap=(1.5, 3), window=(60, MINUTES_10), pool='detail'),
            OTHER: Group(gap=(1.5, 3)),
        },
        methods={
            'search_info_by_keyword': Route('search', 'search_page', first_search_page),
            'get_home_feed': FEED_ROUTE,
            'get_user_aweme_posts': Route('creator_page'),
        },
        paths=(
            ('/aweme/v1/web/user/profile/self/', None),  # 登录检查不算采集
            ('/aweme/v1/web/user/profile/other/', 'creator'),
            ('/aweme/v1/web/aweme/detail/', 'detail'),
            ('/aweme/v1/web/comment/', 'comment'),
        ),
        cooldown=1800, is_blocked_response=dy_verify_response,
    ),
    'xhs': Platform(
        '小红书',
        groups={
            'search': Group(gap=(8, 12), window=(20, MINUTES_10), pool='fresh'),
            'search_page': Group(gap=(4, 7), window=(60, MINUTES_10), pool='pages'),
            'feed': Group(gap=(4, 8), window=(20, MINUTES_10), pool='fresh'),
            'feed_page': Group(gap=(4, 7), window=(60, MINUTES_10), pool='pages'),
            'creator': Group(gap=(8, 12), burst=2, window=(10, MINUTES_10)),
            'creator_page': Group(gap=(3, 6), window=(40, MINUTES_10)),
            'detail': Group(gap=(2, 3.5), burst=3, window=(40, MINUTES_10)),
            'comment': Group(gap=(2, 3.5), window=(40, MINUTES_10), pool='detail'),
            OTHER: Group(gap=(2, 3.5)),
        },
        methods={
            'get_note_by_keyword': SEARCH_ROUTE,
            'search_users': SEARCH_ROUTE,
            'get_home_feed': Route('feed', 'feed_page', first_feed_page),
            'get_notes_by_creator': Route('creator_page'),
        },
        paths=(
            ('/api/sns/web/v1/feed', 'detail'),
            ('/api/sns/web/v2/comment/', 'comment'),
        ),
        cooldown=1800, is_blocked=xhs_blocked,
    ),
    'bili': Platform(
        'B站',
        groups={
            'search': Group(gap=(4, 7), burst=2, window=(30, MINUTES_10), pool='fresh'),
            'search_page': Group(gap=(3, 6), window=(80, MINUTES_10), pool='pages'),
            'feed': Group(gap=(4, 7), burst=2, window=(30, MINUTES_10), pool='fresh'),
            'feed_page': Group(gap=(3, 6), window=(80, MINUTES_10), pool='pages'),
            'creator': Group(gap=(5, 8), burst=3, window=(20, MINUTES_10)),
            'creator_page': Group(gap=(3, 6), window=(60, MINUTES_10)),
            'detail': Group(gap=(1, 2.5), burst=4, window=(80, MINUTES_10)),
            'comment': Group(gap=(1, 2.5), window=(80, MINUTES_10), pool='detail'),
            OTHER: Group(gap=(1, 2.5)),
        },
        methods={
            'search_video_by_keyword': SEARCH_ROUTE,
            'search_user_by_keyword': SEARCH_ROUTE,
            'get_home_feed': FEED_ROUTE,
            'get_creator_videos': Route('creator_page'),
        },
        paths=(
            ('/x/web-interface/nav', None),  # 登录检查不算采集
            ('/x/web-interface/card', 'creator'),
            ('/x/web-interface/view', 'detail'),
            ('/x/player', 'detail'),
            ('/x/v2/reply', 'comment'),
        ),
        # B 站 412 通常几分钟到半小时解除，冷却比小红书短
        cooldown=900, is_blocked=bili_blocked,
    ),
    'zhihu': Platform(
        '知乎',
        groups={
            'feed': Group(gap=(4, 8), window=(20, MINUTES_10)),
            'feed_page': Group(gap=(4, 7), window=(60, MINUTES_10)),
            OTHER: Group(gap=(2, 4)),
        },
        methods={'get_home_feed': FEED_ROUTE},
    ),
    # 这几个方法自己发请求，不经过 request，漏掉就完全没有节流
    'wb': Platform('微博', groups={OTHER: Group(gap=(2, 4))}, transports=('request', 'get_note_info_by_id')),
    # 贴吧有一部分通过页面完成，不经过 request
    'tieba': Platform('贴吧', groups={OTHER: Group(gap=(2, 4))}, transports=('request', '_fetch_json_by_browser', 'get_notes_by_keyword', 'get_note_by_id')),
    'ks': Platform('快手', groups={OTHER: Group(gap=(2, 4))}, transports=('request', 'request_rest_v2', 'request_rest_v2_signed')),
}
# 登录状态检查不算采集，冷却期也要能判断账号是否有效
EXEMPT = ('pong', 'query_self')


def state_path(platform):
    root = os.environ.get('MEDIACRAWLER_DATA_DIR') or user_data_path('mediacrawler', appauthor=False)
    return Path(root).expanduser() / 'pacing' / f'{platform}.json'


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


def mapping(state, key):
    value = state.get(key)
    return dict(value) if isinstance(value, dict) else {}


def fresh_stamps(value, since):
    return [stamp for stamp in value if number(stamp) > since] if isinstance(value, list) else []


def reporter(emit):
    """节流事件转成任务日志"""
    return (lambda event, **detail: emit('log', level='info', event=event, detail=detail)) if emit else None


def log_only(emit):
    """按需任务只转发日志，其他事件是采集流程用的"""
    return lambda kind, **data: emit(kind, **data) if emit and kind == 'log' else None


def locked(path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    return FileLock(str(path) + '.lock', timeout=5)


def bucket_full_at(free, group_name, now):
    """小桶攒满的时刻；离现在太远只可能来自时钟调整"""
    value = number(free.get(group_name))
    return 0 if value > now + CLOCK_JUMP_SECONDS else value


def check_cooldown(state, now):
    blocked = number(state.get('blocked_until'))
    if blocked > now:
        minutes = math.ceil((blocked - now) / 60)
        raise CreatorError('RATE_COOLDOWN', f'平台要求过验证，已暂停访问，请约 {minutes} 分钟后再试', retry_after=math.ceil(blocked - now))


def reserve(platform, group_name, now=None, limit=None, limit_code='FEED_BUSY', background=False, opening=False):
    """从组里取一个名额并返回需要等待的秒数；状态文件异常时放行，不阻断采集
    limit 是调用方能接受的等待上限，超过时不占名额，抛 limit_code"""
    now = time.time() if now is None else now
    group = PLATFORMS[platform].groups[group_name]
    path = state_path(platform)
    try:
        with locked(path):
            state = read_state(path)
            check_cooldown(state, now)
            free, used = mapping(state, 'free_at'), mapping(state, 'used')
            full_at = bucket_full_at(free, group_name, now)
            wait = max(0, full_at - (group.burst - 1) * fmean(group.gap) - now)
            pool = group.pool or group_name
            stamps = fresh_stamps(used.get(pool), now - group.window[1]) if group.window else []
            full = group.window and len(stamps) >= group.window[0]
            retry_after = max(wait, stamps[0] + group.window[1] - now if full else 0)
            if background and group.window and len(stamps) >= group.window[0] * BACKGROUND_SHARE:
                raise CreatorError(limit_code, '额度留给前台操作，稍后再试', retry_after=math.ceil(stamps[0] + group.window[1] - now))
            if limit is not None and retry_after > limit:
                raise CreatorError(limit_code, f'需要排队约 {math.ceil(retry_after)} 秒，稍后再试', retry_after=math.ceil(retry_after))
            if full or retry_after > max(MAX_WAIT_SECONDS, limit or 0):
                raise CreatorError('RATE_LIMITED', f'操作太频繁，请约 {math.ceil(retry_after)} 秒后再试', retry_after=math.ceil(retry_after))
            start = now + wait
            free[group_name] = max(full_at, start) + random.uniform(*group.gap)
            # 打开页面时已经取了第一页，紧接着的翻页要按翻页间隔来
            page_group = PLATFORMS[platform].groups.get(f'{group_name}_page')
            if opening and page_group:
                free[f'{group_name}_page'] = max(bucket_full_at(free, f'{group_name}_page', now), start + random.uniform(*page_group.gap))
            if group.window:
                used[pool] = stamps + [start]
            write_state(path, {**state, 'free_at': free, 'used': used})
    except Timeout:
        # 锁被占太久说明其他进程正在密集请求，按最慢的间隔等，不直接放行
        return group.gap[1]
    except OSError:
        return 0
    return wait


def record_bypass(platform, group_name, now=None):
    """跳过节流的请求也要记账，后面正常排队的调用才知道平台刚被访问过"""
    now = time.time() if now is None else now
    group = PLATFORMS[platform].groups[group_name]
    path = state_path(platform)
    try:
        with locked(path):
            state = read_state(path)
            free, used = mapping(state, 'free_at'), mapping(state, 'used')
            free[group_name] = max(now, bucket_full_at(free, group_name, now)) + fmean(group.gap)
            if group.window:
                pool = group.pool or group_name
                used[pool] = [*fresh_stamps(used.get(pool), now - group.window[1]), now]
            write_state(path, {**state, 'free_at': free, 'used': used})
    except (OSError, Timeout):
        pass


# 命令行按次设置，桌面端不用：只限制开始前的排队，开始后的翻页间隔是任务自身节奏
cli_policy = {'queue_limit': None, 'queued': False, 'bypass': False}


def configure_cli(queue_limit=None, bypass=False):
    cli_policy.update(queue_limit=queue_limit, queued=False, bypass=bypass)


def take_turn(platform, group_name, limit=None, background=False, opening=False):
    """所有请求拿号的唯一入口，返回需要等待的秒数"""
    if cli_policy['bypass']:
        record_bypass(platform, group_name)
        return 0
    if limit is not None or cli_policy['queue_limit'] is None or cli_policy['queued']:
        return reserve(platform, group_name, limit=limit, background=background, opening=opening)
    wait = reserve(platform, group_name, limit=cli_policy['queue_limit'], limit_code='RATE_WAIT_EXCEEDED', opening=opening)
    cli_policy['queued'] = True
    return wait


def start_cooldown(platform, now=None):
    """进入平台冷却并返回时长，24 小时内反复命中时翻倍"""
    now = time.time() if now is None else now
    config = PLATFORMS[platform]
    path = state_path(platform)
    seconds = config.cooldown
    try:
        with locked(path):
            state = read_state(path)
            # 多个进程同时命中验证只算一次
            blocked = number(state.get('blocked_until'))
            if blocked > now:
                return math.ceil(blocked - now)
            strikes = fresh_stamps(state.get('strikes'), now - STRIKE_SECONDS)
            seconds = min(config.cooldown * 2 ** len(strikes), MAX_COOLDOWN_SECONDS)
            write_state(path, {**state, 'blocked_until': now + seconds, 'strikes': strikes + [now]})
    except (OSError, Timeout):
        pass
    return seconds


THROTTLE_CODES = ('FEED_BUSY', 'RATE_LIMITED', 'RATE_WAIT_EXCEEDED', 'RATE_COOLDOWN', 'SEARCH_VERIFICATION_REQUIRED')


def throttle_detail(error):
    """节流拒绝不算故障，转成结构化结果，由调用方决定继续、重试还是提示"""
    if isinstance(error, CreatorError) and error.code in THROTTLE_CODES:
        return {'code': error.code, 'retry_after': error.retry_after or 0, 'message': str(error)}
    return None


def request_label(original, args, kwargs):
    """日志要能看出打的是哪个接口；底层 request 只留路径，查询串里可能有签名和令牌"""
    name = getattr(original, '__name__', 'request')
    url = kwargs.get('url') or (args[1] if len(args) > 1 else '')
    return urlsplit(url).path if name == 'request' and isinstance(url, str) and url else name


def group_of(config, route, label, args, kwargs):
    if route:
        return route.pick(args, kwargs)
    for prefix, group in config.paths:
        if label.startswith(prefix):
            return group
    return OTHER


@dataclass
class Visit:
    platform: str
    group: str
    left: int

    def covers(self, platform, group):
        return platform == self.platform and group in (self.group, f'{self.group}_page') and self.left > 0


@asynccontextmanager
async def visit(platform, group, report=None, limit=None, background=False, requests=VISIT_REQUESTS):
    """一次用户动作只取一个名额，内部请求和网页一样不互相等；平台没有这个组时按普通请求排队"""
    if group not in PLATFORMS[platform].groups:
        yield
        return
    label = f'visit:{group}'
    try:
        wait = take_turn(platform, group, 0 if background else limit, background, opening=True)
    except CreatorError as error:
        if report:
            report('platform-request', key=platform, group=group, method=label, waited=0, outcome=error.code)
        raise
    if report:
        report('platform-request', key=platform, group=group, method=label, waited=round(wait, 1), outcome='ok')
        if wait >= 1:
            report('pacing-wait', key=platform, group=group, seconds=round(wait, 1))
    await asyncio.sleep(wait)
    token = current_visit.set(Visit(platform, group, requests))
    try:
        yield
    finally:
        current_visit.reset(token)


def paced(original, platform, route=None, report=None, limit=None, background=False):
    config = PLATFORMS[platform]
    if background:
        limit = 0

    def verification(method):
        # 继续请求只会加重风控，冷却期内直接本地拒绝
        seconds = start_cooldown(platform)
        if report:
            report('pacing-cooldown', key=platform, seconds=seconds, method=method)
        minutes = math.ceil(seconds / 60)
        return CreatorError('SEARCH_VERIFICATION_REQUIRED', f'{config.name}要求验证，访问暂停约 {minutes} 分钟', retry_after=seconds)

    async def call(*args, **kwargs):
        if holding.get():
            return await original(*args, **kwargs)
        method = request_label(original, args, kwargs)
        group = group_of(config, route, method, args, kwargs)
        if group is None:
            token = holding.set(True)
            try:
                return await original(*args, **kwargs)
            finally:
                holding.reset(token)

        def record(outcome, waited=0, **extra):
            # 每次真正发出或被本地拦下的请求都留一行，出问题时能还原完整时间线
            if report:
                report('platform-request', key=platform, group=group, method=method, waited=round(waited, 1), outcome=outcome, **({'bypassed': True} if cli_policy['bypass'] else {}), **extra)

        scope = current_visit.get()
        try:
            if scope and scope.covers(platform, group):
                # 同一次动作里其他请求可能刚触发验证
                if not cli_policy['bypass']:
                    check_cooldown(read_state(state_path(platform)), time.time())
                scope.left -= 1
                wait = 0
            else:
                wait = take_turn(platform, group, limit, background)
        except CreatorError as error:
            record(error.code)
            raise
        if report and wait >= 1:
            report('pacing-wait', key=platform, group=group, seconds=round(wait, 1))
        await asyncio.sleep(wait)
        token = holding.set(True)
        started = time.monotonic()
        spent = lambda: round((time.monotonic() - started) * 1000)
        try:
            response = await original(*args, **kwargs)
        except Exception as error:
            if config.cooldown and config.is_blocked and config.is_blocked(error):
                record('verification', wait, milliseconds=spent())
                raise verification(method) from None
            record('error', wait, milliseconds=spent(), error=type(error).__name__)
            raise
        finally:
            holding.reset(token)
        if config.cooldown and config.is_blocked_response and isinstance(response, dict) and config.is_blocked_response(response):
            record('verification', wait, milliseconds=spent())
            raise verification(method)
        record('ok', wait, milliseconds=spent())
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


def pace_client(client, platform, report=None, limit=None, background=False):
    config = PLATFORMS[platform]
    for method, route in config.methods.items():
        original = getattr(client, method, None)
        if original is not None:
            setattr(client, method, paced(original, platform, route, report, limit, background))
    for method in config.transports:
        original = getattr(client, method, None)
        if original is not None:
            setattr(client, method, paced(original, platform, None, report, limit, background))
    for method in EXEMPT:
        original = getattr(client, method, None)
        if original is not None:
            setattr(client, method, exempted(original))


async def wait_turn(platform, report=None):
    """不走 client 的页面导航用这个排队，节奏和该平台的其他请求共用"""
    wait = take_turn(platform, OTHER)
    if report and wait >= 1:
        report('pacing-wait', key=platform, group=OTHER, seconds=round(wait, 1))
    await asyncio.sleep(wait)
