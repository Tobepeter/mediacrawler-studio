import json
import time

import pytest

from desktop import pacing
from desktop.paging import CreatorError


@pytest.fixture
def rule(tmp_path, monkeypatch):
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    monkeypatch.setattr(pacing.asyncio, 'sleep', _no_sleep)
    groups = {'g': pacing.Group(gap=(0, 0), window=(1, 600)), 'plain': pacing.Group(gap=(10, 10)), pacing.OTHER: pacing.Group(gap=(0, 0))}
    monkeypatch.setitem(pacing.PLATFORMS, 't', pacing.Platform('测试', groups, cooldown=60))
    yield 't'
    pacing.configure_cli()


async def _no_sleep(_):
    return None


async def call():
    return {'ok': True}


def occupy(platform, seconds, group='g'):
    path = pacing.state_path(platform)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'free_at': {group: time.time() + seconds}}))


def wrapped(platform, group='g', report=None):
    return pacing.paced(call, platform, pacing.Route(group), report)


def state(rule):
    return json.loads(pacing.state_path(rule).read_text())


async def test_long_queue_fails_fast_without_taking_a_slot(rule):
    occupy(rule, 20)
    pacing.configure_cli(queue_limit=3)
    with pytest.raises(CreatorError) as error:
        await wrapped(rule)()
    assert error.value.code == 'RATE_WAIT_EXCEEDED' and 15 <= error.value.retry_after <= 21
    assert 'used' not in state(rule)


async def test_larger_max_wait_is_honoured_beyond_default_cap(rule):
    occupy(rule, 40)
    pacing.configure_cli(queue_limit=60)
    assert await wrapped(rule)() == {'ok': True}


async def test_only_first_request_is_limited(rule):
    occupy(rule, 10, 'plain')
    pacing.configure_cli(queue_limit=3)
    plain = wrapped(rule, 'plain')
    with pytest.raises(CreatorError):
        await plain()
    pacing.state_path(rule).write_text('{}')
    await plain()  # 第一次放行后，任务自身的 10 秒间隔不再受限
    await plain()


async def test_desktop_keeps_waiting_without_limit(rule):
    occupy(rule, 20)
    assert await wrapped(rule)() == {'ok': True}


async def test_bypass_ignores_cooldown_and_window_but_records(rule):
    pacing.start_cooldown(rule)
    pacing.configure_cli(bypass=True)
    await wrapped(rule)()
    await wrapped(rule)()
    assert len(state(rule)['used']['g']) == 2 and state(rule)['free_at']['g'] > 0


async def test_normal_call_still_blocked_after_bypass(rule):
    pacing.start_cooldown(rule)
    pacing.configure_cli(bypass=True)
    await wrapped(rule)()
    pacing.configure_cli()
    with pytest.raises(CreatorError) as error:
        await wrapped(rule)()
    assert error.value.code == 'RATE_COOLDOWN'


async def test_bypass_logs_the_request(rule):
    events = []
    pacing.configure_cli(bypass=True)
    await wrapped(rule, report=lambda event, **detail: events.append(detail))()
    assert events[-1]['bypassed'] is True and events[-1]['outcome'] == 'ok'
