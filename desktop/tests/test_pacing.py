from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from desktop import pacing
from desktop.paging import CreatorError
from desktop.pacing import (
    OTHER, PLATFORMS, Group, Platform, Route, current_visit, first_search_page, pace_client, read_state, reserve, start_cooldown, state_path, visit, wait_turn,
)

GROUPS = {
    'one': Group(gap=(10, 10)),
    'burst': Group(gap=(10, 10), burst=3),
    'limited': Group(gap=(1, 1), window=(3, 100)),
    'roomy': Group(gap=(1, 1), window=(4, 100)),
    'a': Group(gap=(1, 1), window=(2, 100), pool='shared'),
    'b': Group(gap=(1, 1), window=(2, 100), pool='shared'),
    'open': Group(gap=(1, 1), burst=3),
    'open_page': Group(gap=(5, 5)),
    OTHER: Group(gap=(2, 2)),
}


@pytest.fixture
def waits(tmp_path, monkeypatch):
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    monkeypatch.setitem(PLATFORMS, 't', Platform('测试', GROUPS, cooldown=100))
    seen = []

    async def sleep(seconds):
        seen.append(seconds)
    monkeypatch.setattr('desktop.pacing.asyncio.sleep', sleep)
    return seen


def test_small_bucket_spaces_requests(waits):
    assert reserve('t', 'one', now=1000) == 0
    assert reserve('t', 'one', now=1004) == 6
    assert reserve('t', 'one', now=1100) == 0


def test_burst_is_free_then_steady_and_refills(waits):
    assert [reserve('t', 'burst', now=1000) for _ in range(4)] == [0, 0, 0, 10]
    assert reserve('t', 'burst', now=2000) == 0


def test_groups_do_not_wait_for_each_other(waits):
    reserve('t', 'one', now=1000)
    assert reserve('t', 'burst', now=1000) == 0


def test_big_bucket_limits_total_then_recovers(waits):
    for offset in (0, 10, 20):
        reserve('t', 'limited', now=1000 + offset)
    with pytest.raises(CreatorError) as caught:
        reserve('t', 'limited', now=1030)
    assert caught.value.code == 'RATE_LIMITED' and caught.value.retry_after == 70
    assert reserve('t', 'limited', now=1101) == 0


def test_groups_in_one_pool_share_the_big_bucket(waits):
    reserve('t', 'a', now=1000)
    reserve('t', 'b', now=1000)
    with pytest.raises(CreatorError) as caught:
        reserve('t', 'b', now=1010)
    assert caught.value.code == 'RATE_LIMITED'


def test_limit_gives_up_without_taking_the_slot(waits):
    assert reserve('t', 'one', now=1000) == 0
    with pytest.raises(CreatorError) as caught:
        reserve('t', 'one', now=1000, limit=1)
    assert caught.value.code == 'FEED_BUSY'
    assert reserve('t', 'one', now=1000) == 10


def test_background_leaves_room_in_the_big_bucket(waits):
    for offset in (0, 10, 20):
        reserve('t', 'roomy', now=1000 + offset)
    with pytest.raises(CreatorError) as caught:
        reserve('t', 'roomy', now=1030, limit=0, background=True)
    assert caught.value.code == 'FEED_BUSY'
    assert reserve('t', 'roomy', now=1030) == 0


def test_excessive_queue_is_rejected_not_held(waits):
    for _ in range(4):
        reserve('t', 'one', now=1000)
    with pytest.raises(CreatorError) as caught:
        reserve('t', 'one', now=1000)
    assert caught.value.code == 'RATE_LIMITED'


def test_cooldown_stops_every_group_then_expires(waits):
    assert start_cooldown('t', now=1000) == 100
    for group in ('one', 'burst', OTHER):
        with pytest.raises(CreatorError) as caught:
            reserve('t', group, now=1050)
        assert caught.value.code == 'RATE_COOLDOWN' and caught.value.retry_after == 50
    assert reserve('t', 'one', now=1101) == 0


def test_repeated_cooldowns_double_and_are_capped(waits):
    now, seen = 1000, []
    for _ in range(9):
        seen.append(start_cooldown('t', now=now))
        now += seen[-1] + 1
    assert seen[:3] == [100, 200, 400] and seen[-1] == pacing.MAX_COOLDOWN_SECONDS
    assert start_cooldown('t', now=now + 90000) == 100


def test_processes_hitting_verification_together_count_once(waits):
    assert start_cooldown('t', now=1000) == 100
    assert start_cooldown('t', now=1001) == 99
    assert start_cooldown('t', now=1101) == 200


@pytest.mark.parametrize('content', ['{broken', '[]', '{"free_at":"x","used":["y"],"blocked_until":null}', '{"used":{"limited":5}}', '{"free_at":{"one":"x"}}'])
def test_corrupt_state_resets(waits, content):
    path = state_path('t')
    path.parent.mkdir(parents=True)
    path.write_text(content)
    assert reserve('t', 'limited', now=1000) == 0
    assert read_state(path)['free_at']['limited'] == 1001


def test_clock_jump_does_not_block(waits):
    reserve('t', 'one', now=100000)
    assert reserve('t', 'one', now=1000) == 0


def test_unwritable_state_fails_open(waits, tmp_path, monkeypatch):
    blocker = tmp_path / 'file'
    blocker.write_text('')
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(blocker))
    assert reserve('t', 'one', now=1000) == 0


def test_lock_timeout_waits_the_slowest_gap(waits, monkeypatch):
    def busy(path):
        raise pacing.Timeout('lock')
    monkeypatch.setattr('desktop.pacing.locked', busy)
    assert reserve('t', 'one', now=1000) == 10


async def requester():
    return SimpleNamespace(request=AsyncMock(return_value={}))


async def test_visit_takes_one_slot_and_inner_requests_do_not_wait(waits):
    call = pacing.paced(AsyncMock(return_value={}), 't', Route('open_page'))
    inner = pacing.paced(AsyncMock(return_value={}), 't', Route('open'))
    async with visit('t', 'open', requests=2):
        await inner()
        await call()
    assert waits == [0, 0, 0]
    assert len(read_state(state_path('t'))['free_at']) == 2


async def test_visit_budget_runs_out_then_requests_queue(waits):
    call = pacing.paced(AsyncMock(return_value={}), 't', Route('open_page'))
    async with visit('t', 'open', requests=1):
        await call()
        await call()
    assert waits[-1] > 0


async def test_visit_does_not_cover_other_groups(waits):
    call = pacing.paced(AsyncMock(return_value={}), 't', Route('one'))
    async with visit('t', 'open'):
        await call()
        await call()
    assert current_visit.get() is None and waits[-1] > 9


async def test_first_page_turn_after_opening_keeps_its_gap(waits):
    call = pacing.paced(AsyncMock(return_value={}), 't', Route('open_page'))
    async with visit('t', 'open', requests=0):
        pass
    await call()
    assert waits[-1] > 0


async def test_visit_without_group_keeps_normal_pacing(waits):
    assert 'detail' not in PLATFORMS['ks'].groups
    async with visit('ks', 'detail'):
        assert current_visit.get() is None


async def test_visit_stops_when_another_process_triggers_cooldown(waits):
    call = AsyncMock(return_value={})
    paced_call = pacing.paced(call, 't', Route('open'))
    async with visit('t', 'open', requests=2):
        await paced_call()
        start_cooldown('t')
        with pytest.raises(CreatorError) as caught:
            await paced_call()
    assert caught.value.code == 'RATE_COOLDOWN' and call.await_count == 1


async def test_visit_refused_by_cooldown(waits):
    start_cooldown('t')
    with pytest.raises(CreatorError) as caught:
        async with visit('t', 'open'):
            pass
    assert caught.value.code == 'RATE_COOLDOWN'


async def test_background_visit_only_runs_when_idle(waits):
    reserve('t', 'one')
    with pytest.raises(CreatorError) as caught:
        async with visit('t', 'one', background=True):
            pass
    assert caught.value.code == 'FEED_BUSY'


@pytest.fixture
def douyin():
    return SimpleNamespace(
        search_info_by_keyword=AsyncMock(return_value={'status_code': 0}),
        get_user_aweme_posts=AsyncMock(return_value={}),
        request=AsyncMock(return_value={}),
    )


async def test_client_methods_land_in_their_groups(waits, douyin):
    pace_client(douyin, 'dy')
    await douyin.search_info_by_keyword('k', offset=0)
    await douyin.search_info_by_keyword('k', offset=15)
    await douyin.get_user_aweme_posts('u', '')
    free = read_state(state_path('dy'))['free_at']
    assert {'search', 'search_page', 'creator_page'} <= set(free)


def transport(platform):
    original = AsyncMock(return_value={})
    original.__name__ = 'request'
    client = SimpleNamespace(request=original)
    pace_client(client, platform)
    return client


@pytest.mark.parametrize('platform,path,group', [
    ('dy', '/aweme/v1/web/aweme/detail/', 'detail'),
    ('dy', '/aweme/v1/web/comment/list/', 'comment'),
    ('dy', '/aweme/v1/web/user/profile/other/', 'creator'),
    ('dy', '/aweme/v1/web/unknown/', OTHER),
    ('xhs', '/api/sns/web/v1/feed', 'detail'),
    ('xhs', '/api/sns/web/v2/comment/page', 'comment'),
    ('bili', '/x/web-interface/view/detail', 'detail'),
    ('bili', '/x/player/wbi/playurl', 'detail'),
    ('bili', '/x/web-interface/card', 'creator'),
    ('bili', '/x/v2/reply/wbi/main', 'comment'),
])
async def test_interface_paths_land_in_their_groups(waits, platform, path, group):
    client = transport(platform)
    await client.request('GET', f'https://example.com{path}?sign=x')
    assert group in read_state(state_path(platform))['free_at']


@pytest.mark.parametrize('platform,path', [('dy', '/aweme/v1/web/user/profile/self/'), ('bili', '/x/web-interface/nav')])
async def test_login_check_takes_no_slot_and_ignores_cooldown(waits, platform, path):
    start_cooldown(platform)
    client = transport(platform)
    assert await client.request('GET', f'https://example.com{path}') == {}
    assert 'free_at' not in read_state(state_path(platform))


async def test_pong_ignores_cooldown(waits):
    start_cooldown('xhs')
    client = SimpleNamespace(request=AsyncMock(return_value={}))

    async def pong():
        return await client.request('GET', 'me')
    client.pong = pong
    pace_client(client, 'xhs')
    assert await client.pong() == {}
    with pytest.raises(CreatorError) as caught:
        await client.request('GET', 'note')
    assert caught.value.code == 'RATE_COOLDOWN'


async def test_verify_response_starts_cooldown_on_any_douyin_interface(waits, douyin):
    posts = douyin.get_user_aweme_posts
    posts.return_value = {'search_nil_info': {'search_nil_type': 'verify_check'}}
    pace_client(douyin, 'dy')
    with pytest.raises(CreatorError) as caught:
        await douyin.get_user_aweme_posts('u', '')
    assert caught.value.code == 'SEARCH_VERIFICATION_REQUIRED' and caught.value.retry_after == 1800
    with pytest.raises(CreatorError) as caught:
        await douyin.search_info_by_keyword('k', offset=0)
    assert caught.value.code == 'RATE_COOLDOWN'
    assert posts.await_count == 1


async def test_douyin_empty_response_is_not_a_block(waits):
    # 空响应也可能只是参数或单个账号的问题，只认平台明确的验证信号
    client = SimpleNamespace(request=AsyncMock(side_effect=RuntimeError('account blocked, ')))
    pace_client(client, 'dy')
    with pytest.raises(RuntimeError):
        await client.request('GET', 'https://www.douyin.com/aweme/v1/web/aweme/post/')
    assert 'blocked_until' not in read_state(state_path('dy'))


def test_first_search_page_detection():
    assert first_search_page(('k',), {})
    assert first_search_page(('k',), {'offset': 0})
    assert not first_search_page(('k',), {'offset': 15})
    assert not first_search_page(('k', 15), {})


def test_every_supported_platform_is_configured():
    from mediacrawler_cli.state import PLATFORMS as supported
    assert set(PLATFORMS) == set(supported)
    assert all(OTHER in config.groups for config in PLATFORMS.values())


@pytest.mark.parametrize('platform', ['dy', 'xhs', 'bili', 'zhihu', 'wb', 'tieba', 'ks'])
def test_routes_only_use_declared_groups(platform):
    config = PLATFORMS[platform]
    named = [group for route in config.methods.values() for group in (route.group, route.page) if group]
    named += [group for _, group in config.paths if group]
    assert set(named) <= set(config.groups)


@pytest.mark.parametrize('platform', ['dy', 'xhs', 'bili'])
def test_groups_sharing_a_pool_agree_on_the_window(platform):
    groups = PLATFORMS[platform].groups
    pools = {}
    for name, group in groups.items():
        if group.window:
            pools.setdefault(group.pool or name, set()).add(group.window)
    assert all(len(windows) == 1 for windows in pools.values())


@pytest.mark.parametrize('platform,group', [('dy', 'creator'), ('dy', 'detail'), ('xhs', 'creator'), ('xhs', 'detail'), ('bili', 'creator'), ('bili', 'detail')])
def test_browsing_groups_have_both_buckets(platform, group):
    settings = PLATFORMS[platform].groups[group]
    assert settings.burst > 1 and settings.window


@pytest.mark.parametrize('platform, module, name', [
    ('bili', 'bilibili', 'BilibiliClient'), ('dy', 'douyin', 'DouYinClient'), ('xhs', 'xhs', 'XiaoHongShuClient'),
    ('zhihu', 'zhihu', 'ZhiHuClient'), ('wb', 'weibo', 'WeiboClient'), ('tieba', 'tieba', 'BaiduTieBaClient'), ('ks', 'kuaishou', 'KuaiShouClient'),
])
def test_transport_methods_exist_on_real_clients(platform, module, name):
    # 上游改名时这里会失败，否则节流会悄悄失效
    from importlib import import_module
    client = getattr(import_module(f'media_platform.{module}.client'), name)
    for method in (*PLATFORMS[platform].transports, *PLATFORMS[platform].methods):
        assert callable(getattr(client, method))


@pytest.mark.parametrize('platform', ['bili', 'dy', 'xhs', 'zhihu', 'wb', 'tieba', 'ks'])
async def test_consecutive_requests_are_spaced_and_platforms_are_independent(waits, platform):
    client = await requester()
    pace_client(client, platform)
    await client.request('GET', 'a')
    await client.request('GET', 'b')
    assert waits[0] == 0 and waits[1] > 0
    other = await requester()
    pace_client(other, 'ks' if platform != 'ks' else 'bili')
    await other.request('GET', 'a')
    assert waits[2] == 0


async def test_method_rule_and_transport_count_once(waits):
    client = SimpleNamespace()

    async def request(*args):
        return {}

    async def search(keyword, page=1):
        return await client.request('POST', 'search')
    client.request, client.get_note_by_keyword = request, search
    pace_client(client, 'xhs')
    await client.get_note_by_keyword('x')
    assert waits == [0]


async def test_wait_turn_shares_the_other_group(waits):
    client = await requester()
    pace_client(client, 'zhihu')
    await client.request('GET', 'a')
    await wait_turn('zhihu')
    assert waits[1] > 0
