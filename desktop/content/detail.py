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


async def load_feed_detail(record, page):
    """推荐流卡片只有摘要，走单条链接的完整流程拿正文、图片和媒体，保持卡片已有的 ID"""
    from desktop.crawler import DesktopCrawler
    runner = DesktopCrawler({
        'platform': record['platform'], 'mode': 'link', 'query': record['url'],
        'limit': 1, 'action': 'collect', 'reusePage': True,
    }, page, lambda *args, **kwargs: None)
    await runner.setup()
    await runner.client.update_cookies(runner.context)
    await runner.detail()
    full = runner.store.items.get(record['id'])
    if not full:
        return {'item': {**record, 'media': {'status': 'failed', 'variants': []}}, 'code': 'failed'}
    await enrich(runner, full)
    # 上游入库时会给昵称脱敏，界面继续用卡片上的原名
    item = {**full, 'feed': True, 'author': record.get('author') or full.get('author')}
    return {'item': item, 'code': 'failed' if full['media']['status'] == 'failed' else ''}


async def load_detail(record, page):
    if record.get('feed'):
        return await load_feed_detail(record, page)
    fresh = await refreshed(record, page)
    return {'item': fresh, 'code': 'failed' if fresh['media']['status'] == 'failed' else ''}
