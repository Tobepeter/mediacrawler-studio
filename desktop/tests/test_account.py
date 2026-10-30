import pytest
from desktop.account import AccountProfile, profile_info


def test_profile_fields_only():
    assert profile_info('bili', {'uname': '昵称', 'face': '//example.com/a.png', 'cookie': 'secret'}) == {
        'nickname': '昵称', 'avatar': 'https://example.com/a.png'}
    assert profile_info('xhs', {'data': {'basic_info': {'nickname': '小红书用户', 'images': 'https://example.com/x.png'}}})['nickname'] == '小红书用户'
    assert profile_info('dy', {'user': {'nickname': '抖音用户', 'avatar_thumb': {'url_list': ['https://example.com/d.png']}}})['avatar'] == 'https://example.com/d.png'


def test_missing_or_unsafe_profile_falls_back():
    assert profile_info('xhs', None) == {}
    assert profile_info('xhs', {'data': {'basic_info': []}})['nickname'] == ''
    assert profile_info('bili', {'uname': 'a' * 200, 'face': 'file:///tmp/private'}) == {'nickname': 'a' * 100, 'avatar': ''}


@pytest.mark.asyncio
async def test_only_current_account_response_is_accepted():
    class Response:
        status = 200
        url = 'https://www.douyin.com/aweme/v1/web/user/profile/other/'
        async def json(self):
            return {'user': {'nickname': '账号', 'avatar_thumb': {'url_list': []}}}
    reader = AccountProfile('dy')
    response = Response()
    await reader.observe(response)
    assert reader.profile == {}
    response.url = 'https://www.douyin.com/aweme/v1/web/user/profile/self/'
    await reader.observe(response)
    assert reader.profile['nickname'] == '账号'


def test_empty_response_does_not_erase_received_profile():
    reader = AccountProfile('dy')
    reader.update({'user': {'nickname': '账号', 'avatar_thumb': {'url_list': ['https://example.com/a.png']}}})
    reader.update({'status_code': 8, 'user': None})
    reader.update({'user': {'nickname': '账号'}})
    assert reader.profile == {'nickname': '账号', 'avatar': 'https://example.com/a.png'}


@pytest.mark.asyncio
async def test_douyin_profile_uses_native_client_and_fills_missing_avatar():
    from types import SimpleNamespace
    from desktop.crawler import DesktopCrawler
    events, calls = [], []
    runner = DesktopCrawler(
        {'platform': 'dy', 'limit': 5, 'mode': 'search', 'query': '', 'action': 'connect'},
        None, lambda kind, **value: events.append((kind, value)),
    )
    runner.account.profile = {'nickname': '账号'}

    async def get(path, params):
        assert events == [('account', {'profile': {'nickname': '账号'}})]
        calls.append((path, params))
        return {'user': {'nickname': '账号', 'avatar_thumb': {'url_list': ['https://example.com/a.png']}}}

    runner.client = SimpleNamespace(get=get)
    await runner.publish_account()
    assert calls == [('/aweme/v1/web/user/profile/self/', {'device_platform': 'webapp'})]
    assert events == [
        ('account', {'profile': {'nickname': '账号'}}),
        ('account', {'profile': {'nickname': '账号', 'avatar': 'https://example.com/a.png'}}),
    ]
    await runner.publish_account()
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_profile_lookup_failure_keeps_partial_account():
    from types import SimpleNamespace
    from desktop.crawler import DesktopCrawler
    events = []
    runner = DesktopCrawler(
        {'platform': 'dy', 'limit': 5, 'mode': 'search', 'query': '', 'action': 'connect'},
        None, lambda kind, **value: events.append((kind, value)),
    )
    runner.account.profile = {'nickname': '账号'}

    async def get(*args):
        raise RuntimeError('private upstream response')

    runner.client = SimpleNamespace(get=get)
    await runner.publish_account()
    assert events == [('account', {'profile': {'nickname': '账号'}})]
