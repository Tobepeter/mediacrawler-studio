"""打开详情或媒体地址失效时按需补全；复用已登录的平台页面，不跳转页面"""
import copy

from desktop.content.media import enrich


async def refreshed(record, page, runner=None, quality='best'):
    if runner is None:
        from desktop.crawler import DesktopCrawler
        runner = DesktopCrawler({
            'platform': record['platform'], 'mode': 'link', 'query': record['url'],
            'limit': 1, 'action': 'connect', 'reusePage': True,
        }, page, lambda *args, **kwargs: None)
        await runner.setup()
        await runner.client.update_cookies(runner.context)
    fresh = copy.deepcopy(record)
    await enrich(runner, fresh, quality)
    return fresh


async def load_detail(record, page):
    fresh = await refreshed(record, page)
    return {'item': fresh, 'code': 'failed' if fresh['media']['status'] == 'failed' else ''}
