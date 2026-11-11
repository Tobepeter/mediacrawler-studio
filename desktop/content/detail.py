"""打开详情或媒体地址失效时按需补全；复用已登录的平台页面，不跳转页面"""
import copy

from desktop.content.media import enrich
from desktop.pacing import reporter, visit


async def refreshed(record, page, runner=None, quality='best', background=False, emit=None):
    if runner is None:
        from desktop.crawler import on_demand
        runner = await on_demand(record, page, emit, background=background)
    fresh = copy.deepcopy(record)
    await enrich(runner, fresh, quality)
    return fresh


async def load_feed_detail(record, page, background=False, emit=None):
    """推荐流卡片只有摘要，走单条链接的完整流程拿正文、图片和媒体，保持卡片已有的 ID"""
    from desktop.crawler import on_demand
    runner = await on_demand(record, page, emit, 'collect', background)
    await runner.detail()
    full = runner.store.items.get(record['id'])
    if not full:
        return {'item': {**record, 'media': {'status': 'failed', 'variants': []}}, 'code': 'failed'}
    await enrich(runner, full)
    # 上游入库时会给昵称脱敏，界面继续用卡片上的原名
    # 地址沿用卡片的：详情里的 av 地址换掉 BV 地址会让正在播放的播放器重新加载
    item = {**full, 'feed': True, 'detailPending': False, 'url': record.get('url') or full.get('url'), 'author': record.get('author') or full.get('author')}
    return {'item': item, 'code': 'failed' if full['media']['status'] == 'failed' else ''}


async def load_detail(record, page, background=False, emit=None):
    # 打开详情是一次动作，内部的详情、播放地址等请求不互相等
    async with visit(record['platform'], 'detail', reporter(emit), background=background):
        if record.get('feed'):
            return await load_feed_detail(record, page, background, emit)
        fresh = await refreshed(record, page, background=background, emit=emit)
        return {'item': fresh, 'code': 'failed' if fresh['media']['status'] == 'failed' else ''}
