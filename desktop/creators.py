"""按平台分发博主搜索、主页作品和关键词分页，桌面与 CLI 共用；各平台实现在 *_paging.py"""
from importlib import import_module

from desktop.paging import CREATOR_PLATFORMS, CREATOR_SEARCH_PLATFORMS, FEED_PLATFORMS, PAGED_SEARCH_PLATFORMS, CreatorError


def provider(platform, supported, message):
    if platform not in supported:
        raise CreatorError('UNSUPPORTED_PLATFORM', message)
    return import_module(f'desktop.{platform}_paging')


async def search_creators(runner, keyword, limit=10, cursor=None, **options):
    module = provider(runner.platform, CREATOR_SEARCH_PLATFORMS, '该平台暂不支持博主搜索')
    keyword = keyword.strip()
    if not keyword:
        raise CreatorError('INVALID_CREATOR', '请输入博主名称或关键词')
    return await module.search_creators(runner, keyword, limit, cursor, **options)


async def collect_creator(runner, reference, cursor=None):
    await provider(runner.platform, CREATOR_PLATFORMS, '该平台暂不支持博主采集').collect_creator(runner, reference, cursor)


async def collect_search(runner, query, cursor=None, options=None):
    await provider(runner.platform, PAGED_SEARCH_PLATFORMS, '该平台暂不支持分页搜索').collect_search(runner, query, cursor, options)


async def load_feed(runner, cursor=None):
    return await provider(runner.platform, FEED_PLATFORMS, '该平台暂不支持推荐流').load_feed(runner, cursor)
