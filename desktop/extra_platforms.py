"""知乎、微博、贴吧、快手的有界采集编排"""
import asyncio
import re
from urllib.parse import urlparse, parse_qs, urlencode


class ExtraCollector:
    def __init__(self, runner):
        self.runner = runner
        self.platform = runner.platform
        self.client = runner.client
        self.store = runner.store

    async def save(self, item):
        if not item:
            return
        if self.platform == 'zhihu':
            from store.zhihu import update_zhihu_content
            if item.content_type == 'zvideo':
                item.content_url = f'https://www.zhihu.com/zvideo/{item.content_id}'
            await update_zhihu_content(item)
        elif self.platform == 'wb':
            from store.weibo import update_weibo_note
            item = await self.runner.crawler.get_note_full_text(item)
            post = item.get('mblog') or {}
            if not post.get('id'):
                return
            # 原生转换不保留配图，桌面单独补齐作品图片
            images = [(pic.get('large') or {}).get('url') or pic.get('url') for pic in post.get('pics') or []]
            self.store.media[f"wb:{post['id']}"] = [image for image in images if image]
            await update_weibo_note(item)
        elif self.platform == 'tieba':
            from store.tieba import update_tieba_note
            await update_tieba_note(item)
        elif self.platform == 'ks':
            from store.kuaishou import update_kuaishou_video
            photo = item.get('photo') or {}
            if not photo.get('id'):
                return
            self.store.full_text[f"ks:{photo['id']}"] = photo.get('caption') or ''
            await update_kuaishou_video(item)

    async def detail(self, url):
        parsed = urlparse(url)
        path = parsed.path.rstrip('/')
        if self.platform == 'zhihu':
            match = re.fullmatch(r'/question/(\d+)/answer/(\d+)', path)
            if match:
                item = await self.client.get_answer_info(*match.groups())
            elif parsed.hostname == 'zhuanlan.zhihu.com' and re.fullmatch(r'/p/\d+', path):
                item = await self.client.get_article_info(path.rsplit('/', 1)[-1])
            elif re.fullmatch(r'/zvideo/\d+', path):
                item = await self.client.get_video_info(path.rsplit('/', 1)[-1])
            else:
                raise RuntimeError('请粘贴具体回答、文章或视频链接，暂不支持整个问题页')
        elif self.platform == 'wb':
            match = re.fullmatch(r'/(?:detail|status)/(\w+)', path) or re.fullmatch(r'/\d+/(\w+)', path)
            identity = match.group(1) if match else parse_qs(parsed.query).get('id', [''])[0] if path == '/detail' else ''
            if not identity:
                raise RuntimeError('请粘贴微博正文链接')
            item = await self.client.get_note_info_by_id(identity)
        elif self.platform == 'tieba':
            match = re.fullmatch(r'/p/(\d+)', path)
            if not match:
                raise RuntimeError('请粘贴贴吧帖子链接')
            item = await self.client.get_note_by_id(match.group(1))
        else:
            match = re.fullmatch(r'/(?:short-video|photo)/(\w+)', path)
            identity = match.group(1) if match else parse_qs(parsed.query).get('photoId', [''])[0]
            if not identity or not re.fullmatch(r'\w+', identity):
                raise RuntimeError('请粘贴快手作品链接')
            response = await self.client.get_video_info(identity)
            item = response.get('visionVideoDetail')
        await self.save(item)

    async def search(self):
        query = self.runner.request['query']
        if self.platform == 'zhihu':
            # 原生搜索依赖搜索页生成的 Cookie，首页会话不足以发起查询
            params = urlencode({'q': query, 'type': 'content'})
            await self.runner.page.goto(f'https://www.zhihu.com/search?{params}', wait_until='domcontentloaded')
            await asyncio.sleep(5)
            await self.client.update_cookies(self.runner.context)
        session = ''
        for page in range(1, 11):
            more = True
            if self.platform == 'zhihu':
                rows = await self.client.get_note_by_keyword(query, page=page)
            elif self.platform == 'wb':
                from media_platform.weibo.help import filter_search_result_card
                response = await self.client.get_note_by_keyword(query, page=page)
                rows = filter_search_result_card(response.get('cards') or [])
            elif self.platform == 'tieba':
                rows = await self.client.get_notes_by_keyword(query, page=page, page_size=20)
            else:
                response = await self.client.search_info_by_keyword_v2(query, pcursor=str(page), search_session_id=session)
                if response.get('result') != 1:
                    raise RuntimeError('快手暂未返回搜索结果，请检查平台窗口')
                session = response.get('searchSessionId', '')
                rows = response.get('feeds') or []
                more = response.get('pcursor') != 'no_more'
            for item in rows:
                if self.platform == 'tieba':
                    item = await self.client.get_note_by_id(item.note_id)
                elif self.platform == 'zhihu':
                    # 搜索返回摘要，继续取作品正文；只取用户所选数量
                    url = f'https://www.zhihu.com/zvideo/{item.content_id}' if item.content_type == 'zvideo' else item.content_url
                    await self.detail(url)
                    if len(self.store.ids) >= self.runner.request['limit']:
                        return
                    continue
                await self.save(item)
                if len(self.store.ids) >= self.runner.request['limit']:
                    return
            if not rows or not more:
                return
            await asyncio.sleep(2)
