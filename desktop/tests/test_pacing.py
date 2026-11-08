from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from desktop.creators import CreatorError
from desktop.pacing import RULES, Rule, first_search_page, pace_client, read_state, reserve, start_cooldown, state_path

SEARCH = Rule(key='t', fresh_gap=(10, 10), page_gap=(3, 3), is_fresh=first_search_page, window_limit=3, window_seconds=600, cooldown_seconds=1800)
PAGES = Rule(key='p', page_gap=(2, 2))


@pytest.fixture
def path(tmp_path):
    return tmp_path / 'pacing' / 'state.json'


def test_gaps_follow_user_rhythm(path):
    assert reserve(path, SEARCH, True, now=1000) == 0
    assert reserve(path, SEARCH, True, now=1004) == 6
    assert reserve(path, SEARCH, False, now=1010) == 3
    assert reserve(path, SEARCH, False, now=1100) == 0


def test_only_search_has_new_query_gap(path):
    assert reserve(path, PAGES, False, now=1000) == 0
    assert reserve(path, PAGES, False, now=1000) == 2


def test_concurrent_callers_queue_instead_of_firing_together(path):
    assert [reserve(path, SEARCH, False, now=1000) for _ in range(3)] == [0, 3, 6]


def test_window_limit_counts_new_searches_only(path):
    for offset in (0, 20, 40):
        reserve(path, SEARCH, True, now=1000 + offset)
    assert reserve(path, SEARCH, False, now=1060) == 0
    with pytest.raises(CreatorError) as error:
        reserve(path, SEARCH, True, now=1070)
    assert error.value.code == 'RATE_LIMITED' and error.value.retry_after == 530
    assert reserve(path, SEARCH, True, now=1601) == 0


def test_excessive_queue_is_rejected_not_held(path):
    for _ in range(11):
        reserve(path, SEARCH, False, now=1000)
    with pytest.raises(CreatorError) as error:
        reserve(path, SEARCH, False, now=1000)
    assert error.value.code == 'RATE_LIMITED'


def test_cooldown_rejects_locally_then_expires(path):
    start_cooldown(path, SEARCH, now=1000)
    with pytest.raises(CreatorError) as error:
        reserve(path, SEARCH, True, now=1100)
    assert error.value.code == 'RATE_COOLDOWN' and error.value.retry_after == 1700
    assert reserve(path, SEARCH, True, now=2801) == 0


@pytest.mark.parametrize('content', ['{broken', '[]', '{"last_at":"x","recent":["y"],"blocked_until":null}', '{"recent":null}', '{"recent":5}'])
def test_corrupt_state_resets(path, content):
    path.parent.mkdir(parents=True)
    path.write_text(content)
    assert reserve(path, SEARCH, True, now=1000) == 0
    assert read_state(path)['last_at'] == 1000


def test_clock_jump_does_not_block(path):
    reserve(path, SEARCH, True, now=100000)
    assert reserve(path, SEARCH, True, now=1000) == 0


def test_unwritable_state_fails_open(tmp_path):
    blocker = tmp_path / 'file'
    blocker.write_text('')
    assert reserve(blocker / 'x' / 'state.json', SEARCH, True, now=1000) == 0


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    monkeypatch.setattr('desktop.pacing.asyncio.sleep', AsyncMock())
    return SimpleNamespace(search_info_by_keyword=AsyncMock(return_value={'status_code': 0}), get_user_aweme_posts=AsyncMock(return_value={}), get_video_by_id=AsyncMock(return_value={}))


@pytest.mark.asyncio
async def test_exit_point_paces_listed_methods_only(client):
    detail = client.get_video_by_id
    search = client.search_info_by_keyword
    pace_client(client, 'dy')
    assert client.get_video_by_id is detail
    assert await client.search_info_by_keyword('k', offset=0, search_id='i') == {'status_code': 0}
    search.assert_awaited_once_with('k', offset=0, search_id='i')
    assert state_path(RULES['dy', 'search_info_by_keyword']).exists()


@pytest.mark.asyncio
async def test_other_platforms_untouched(client):
    original = client.search_info_by_keyword
    pace_client(client, 'xhs')
    assert client.search_info_by_keyword is original


@pytest.mark.asyncio
async def test_verify_response_starts_cooldown_and_stops_next_call(client):
    search = client.search_info_by_keyword
    search.return_value = {'status_code': 0, 'search_nil_info': {'search_nil_type': 'verify_check'}}
    pace_client(client, 'dy')
    with pytest.raises(CreatorError) as error:
        await client.search_info_by_keyword('k', offset=0)
    assert error.value.code == 'SEARCH_VERIFICATION_REQUIRED' and error.value.retry_after == 1800
    with pytest.raises(CreatorError) as error:
        await client.search_info_by_keyword('k', offset=0)
    assert error.value.code == 'RATE_COOLDOWN'
    assert search.await_count == 1


def test_first_search_page_detection():
    assert first_search_page(('k',), {})
    assert first_search_page(('k',), {'offset': 0})
    assert not first_search_page(('k',), {'offset': 15})
    assert not first_search_page(('k', 15), {})
