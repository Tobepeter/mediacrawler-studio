"""平台敏感接口的统一出口：跨进程节流、频次上限和风控冷却

CLI 与桌面每次操作都是新进程，且共用同一网络出口，状态必须落盘共享
只有 RULES 列出的接口受控；数值按正常用户操作节奏估算，未做线上压测
"""
import asyncio
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

from desktop.creators import CreatorError

MAX_WAIT_SECONDS = 30


def first_search_page(args, kwargs):
    return not kwargs.get('offset', args[1] if len(args) > 1 else 0)


def first_xhs_page(args, kwargs):
    return kwargs.get('page', 1) == 1


def unwrapped(error):
    attempt = getattr(error, 'last_attempt', None)
    return (attempt.exception() if attempt else None) or error


def xhs_blocked(error):
    # 上游对这些异常只跳过当前笔记，不拦住的话会继续逐条请求
    from media_platform.xhs.exception import IPBlockError, PlatformAccessError
    error = unwrapped(error)
    return isinstance(error, (IPBlockError, PlatformAccessError)) or 'CAPTCHA appeared' in str(error)


@dataclass(frozen=True)
class Rule:
    key: str
    page_gap: tuple
    fresh_gap: Optional[tuple] = None
    is_fresh: Optional[Callable] = None
    window_limit: int = 0
    window_seconds: int = 0
    cooldown_seconds: int = 0
    name: str = '抖音'
    is_blocked: Optional[Callable] = None


RULES = {
    ('dy', 'search_info_by_keyword'): Rule(
        # 换关键词约等于用户看完一屏结果再搜下一个，翻页约等于看完一屏再向下滚动
        # 3-6 秒翻页时，几分钟内连续采几批就会触发验证（2026-11-09 实际遇到）
        key='dy-search', fresh_gap=(10, 15), page_gap=(6, 10), is_fresh=first_search_page,
        window_limit=20, window_seconds=600, cooldown_seconds=1800,
    ),
    ('dy', 'get_user_aweme_posts'): Rule(key='dy-user-posts', page_gap=(2, 4)),
    # 小红书共用一条时间线：搜索、主页和详情都算同一个用户在连续操作，验证也要一起停
    ('xhs', 'get_note_by_keyword'): Rule(
        key='xhs', fresh_gap=(8, 12), page_gap=(4, 7), is_fresh=first_xhs_page,
        window_limit=20, window_seconds=600, cooldown_seconds=1800, name='小红书', is_blocked=xhs_blocked,
    ),
    ('xhs', 'get_notes_by_creator'): Rule(key='xhs', page_gap=(3, 6), cooldown_seconds=1800, name='小红书', is_blocked=xhs_blocked),
    # 上游每条详情后已固定等 2 秒，这里主要防 CLI 和桌面同时采集时叠加
    ('xhs', 'get_note_by_id'): Rule(key='xhs', page_gap=(2, 3.5), cooldown_seconds=1800, name='小红书', is_blocked=xhs_blocked),
}


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


def reserve(path, rule, fresh, now=None):
    """占用下一个可用时刻并返回需要等待的秒数；状态文件异常时放行，不阻断采集"""
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
            retry_after = recent[0] + rule.window_seconds - now if over else start - now
            if over or retry_after > MAX_WAIT_SECONDS:
                raise CreatorError('RATE_LIMITED', f'操作太频繁，请约 {math.ceil(retry_after)} 秒后再试', retry_after=math.ceil(retry_after))
            write_state(path, {**state, 'last_at': start, 'recent': recent + [start] if fresh and rule.window_limit else recent})
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


def paced(original, rule, report=None):
    def verification(path):
        # 继续请求只会加重风控，冷却期内直接本地拒绝
        start_cooldown(path, rule)
        if report:
            report('pacing-cooldown', key=rule.key, seconds=rule.cooldown_seconds)
        minutes = math.ceil(rule.cooldown_seconds / 60)
        return CreatorError('SEARCH_VERIFICATION_REQUIRED', f'{rule.name}要求验证，访问暂停约 {minutes} 分钟', retry_after=rule.cooldown_seconds)

    async def call(*args, **kwargs):
        path = state_path(rule)
        fresh = bool(rule.is_fresh and rule.is_fresh(args, kwargs))
        wait = reserve(path, rule, fresh)
        if report and wait >= 1:
            report('pacing-wait', key=rule.key, seconds=round(wait, 1), fresh=fresh)
        await asyncio.sleep(wait)
        try:
            response = await original(*args, **kwargs)
        except Exception as error:
            if rule.is_blocked and rule.is_blocked(error):
                raise verification(path) from None
            raise
        if rule.cooldown_seconds and isinstance(response, dict) and (response.get('search_nil_info') or {}).get('search_nil_type') == 'verify_check':
            raise verification(path)
        return response
    return call


def pace_client(client, platform, report=None):
    for (owner, method), rule in RULES.items():
        original = getattr(client, method, None)
        if owner == platform and original is not None:
            setattr(client, method, paced(original, rule, report))
