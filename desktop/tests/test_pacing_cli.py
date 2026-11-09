import json
import time

import pytest

from desktop import pacing
from desktop.paging import CreatorError


@pytest.fixture
def rule(tmp_path, monkeypatch):
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    monkeypatch.setattr(pacing.asyncio, 'sleep', _no_sleep)
    yield pacing.Rule(key='t', page_gap=(0, 0), window_limit=1, window_seconds=600, cooldown_seconds=60, name='测试', is_fresh=lambda args, kwargs: True)
    pacing.configure_cli()


async def _no_sleep(_):
    return None


async def call():
    return {'ok': True}


def occupy(rule, seconds):
    path = pacing.state_path(rule)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'last_at': time.time() + seconds}))


def state(rule):
    return json.loads(pacing.state_path(rule).read_text())


async def test_long_queue_fails_fast_without_taking_a_slot(rule):
    occupy(rule, 20)
    pacing.configure_cli(queue_limit=3)
    with pytest.raises(CreatorError) as error:
        await pacing.paced(call, rule)()
    assert error.value.code == 'RATE_WAIT_EXCEEDED' and 15 <= error.value.retry_after <= 21
    assert 'recent' not in state(rule)


async def test_larger_max_wait_is_honoured_beyond_default_cap(rule):
    occupy(rule, 40)
    pacing.configure_cli(queue_limit=60)
    assert await pacing.paced(call, rule)() == {'ok': True}


async def test_only_first_request_is_limited(rule):
    plain = pacing.Rule(key='t', page_gap=(10, 10))
    occupy(plain, 0)
    pacing.configure_cli(queue_limit=3)
    wrapped = pacing.paced(call, plain)
    with pytest.raises(CreatorError):
        await wrapped()
    state_path = pacing.state_path(plain)
    state_path.write_text('{}')
    await wrapped()  # 第一次放行后，任务自身的 10 秒间隔不再受限
    await wrapped()


async def test_desktop_keeps_waiting_without_limit(rule):
    occupy(rule, 20)
    assert await pacing.paced(call, rule)() == {'ok': True}


async def test_bypass_ignores_cooldown_and_window_but_records(rule):
    pacing.start_cooldown(pacing.state_path(rule), rule)
    pacing.configure_cli(bypass=True)
    await pacing.paced(call, rule)()
    await pacing.paced(call, rule)()
    assert len(state(rule)['recent']) == 2 and state(rule)['last_at'] > 0


async def test_normal_call_still_blocked_after_bypass(rule):
    pacing.start_cooldown(pacing.state_path(rule), rule)
    pacing.configure_cli(bypass=True)
    await pacing.paced(call, rule)()
    pacing.configure_cli()
    with pytest.raises(CreatorError) as error:
        await pacing.paced(call, rule)()
    assert error.value.code == 'RATE_COOLDOWN'


async def test_bypass_logs_the_request(rule):
    events = []
    pacing.configure_cli(bypass=True)
    await pacing.paced(call, rule, lambda event, **detail: events.append(detail))()
    assert events[-1]['bypassed'] is True and events[-1]['outcome'] == 'ok'
