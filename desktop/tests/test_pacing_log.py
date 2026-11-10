import pytest

from desktop import pacing
from desktop.paging import CreatorError


@pytest.fixture
def rule(tmp_path, monkeypatch):
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    monkeypatch.setattr(pacing.asyncio, 'sleep', _no_sleep)
    monkeypatch.setitem(pacing.PLATFORMS, 't', pacing.Platform('测试', {pacing.OTHER: pacing.Group(gap=(0, 0))}, cooldown=60, is_blocked=lambda error: isinstance(error, PermissionError)))
    return 't'


async def _no_sleep(_):
    return None


def recorder():
    events = []
    return events, lambda event, **detail: events.append((event, detail))


async def search(keyword):
    return {'data': []}


async def test_success_records_method_and_outcome(rule):
    events, report = recorder()
    await pacing.paced(search, rule, None, report)('a')
    record = next(detail for event, detail in events if event == 'platform-request')
    assert record['method'] == 'search' and record['outcome'] == 'ok' and 'milliseconds' in record


async def test_verification_names_the_triggering_method(rule):
    events, report = recorder()

    async def blocked():
        raise PermissionError()

    with pytest.raises(CreatorError):
        await pacing.paced(blocked, rule, None, report)()
    assert ('platform-request', 'verification') in [(event, detail.get('outcome')) for event, detail in events]
    assert next(detail for event, detail in events if event == 'pacing-cooldown')['method'] == 'blocked'


async def test_error_records_type_only(rule):
    events, report = recorder()

    async def broken():
        raise ValueError('token=secret')

    with pytest.raises(ValueError):
        await pacing.paced(broken, rule, None, report)()
    record = next(detail for event, detail in events if event == 'platform-request')
    assert record['outcome'] == 'error' and record['error'] == 'ValueError' and 'secret' not in str(record)


async def test_locally_refused_request_is_recorded(rule):
    events, report = recorder()
    pacing.start_cooldown(rule)
    with pytest.raises(CreatorError) as error:
        await pacing.paced(search, rule, None, report)('a')
    assert error.value.code == 'RATE_COOLDOWN'
    assert [detail['outcome'] for event, detail in events if event == 'platform-request'] == ['RATE_COOLDOWN']


async def test_nested_calls_log_once(rule):
    events, report = recorder()
    inner = pacing.paced(search, rule, None, report)

    async def outer():
        return await inner('a')

    await pacing.paced(outer, rule, None, report)()
    assert [detail['method'] for event, detail in events if event == 'platform-request'] == ['outer']


def test_transport_label_drops_query():
    async def request(method, url):
        return None

    assert pacing.request_label(request, ('GET', 'https://a.com/api/x?sign=secret'), {}) == '/api/x'
