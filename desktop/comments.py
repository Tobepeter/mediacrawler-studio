"""有界评论样本，复用平台 client 与已有脱敏存储转换"""
from urllib.parse import urlparse, parse_qs


class CommentCollector:
    def __init__(self, platform, client, store, replies=False):
        self.platform, self.client, self.store = platform, client, store
        self.replies = replies
        self.extra = None
        if platform not in ('bili', 'dy', 'xhs'):
            from desktop.extra_comments import ExtraCommentSource
            self.extra = ExtraCommentSource(platform, client)

    async def page(self, content_id, token, cursor, parent=None):
        if self.extra:
            return await self.extra.page(content_id, cursor, parent)
        if self.platform == 'bili':
            from media_platform.bilibili.field import CommentOrderType
            if parent:
                data = await self.client.get_video_level_two_comments(content_id, int(parent), cursor or 1, 20, CommentOrderType.DEFAULT)
                more = int((data.get('page') or {}).get('count', 0)) > (cursor or 1) * 20
                next_cursor = (cursor or 1) + 1
            else:
                data = await self.client.get_video_comments(content_id, next=cursor or 0)
                info = data.get('cursor') or {}
                more, next_cursor = not info.get('is_end', True), info.get('next')
            key = 'replies'
        elif self.platform == 'dy':
            if parent:
                data = await self.client.get_sub_comments(content_id, parent, cursor or 0)
            else:
                data = await self.client.get_aweme_comments(content_id, cursor or 0)
            more, next_cursor, key = data.get('has_more', False), data.get('cursor'), 'comments'
        else:
            if parent:
                data = await self.client.get_note_sub_comments(content_id, parent, token, cursor=cursor or '')
            else:
                data = await self.client.get_note_comments(content_id, token, cursor=cursor or '')
            more, next_cursor, key = data.get('has_more', False), data.get('cursor'), 'comments'
        if key not in data:
            raise RuntimeError('评论暂时不可用')
        return data.get(key) or [], more, next_cursor

    def identity(self, raw):
        key = {'bili': 'rpid', 'dy': 'cid', 'xhs': 'id'}.get(self.platform, 'comment_id')
        return str(raw.get(key) or '')

    def reply_count(self, raw):
        key = {'bili': 'rcount', 'dy': 'reply_comment_total', 'xhs': 'sub_comment_count'}.get(self.platform, 'sub_comment_count')
        return int(raw.get(key) or 0)

    async def save(self, content_id, raw, parent=''):
        raw = dict(raw)
        if self.extra:
            raw['parent_comment_id'] = parent
            await self.store.store_comment(raw)
            return
        if self.platform == 'bili':
            from store.bilibili import update_bilibili_video_comment
            raw['parent'] = parent or 0
            await update_bilibili_video_comment(content_id, raw)
        elif self.platform == 'dy':
            from store.douyin import update_dy_aweme_comment
            raw.update(aweme_id=content_id, reply_id=parent or '0')
            await update_dy_aweme_comment(content_id, raw)
        else:
            from store.xhs import update_xhs_note_comment
            raw['target_comment'] = {'id': parent} if parent else {}
            await update_xhs_note_comment(content_id, raw)

    async def fetch(self, item):
        if self.extra:
            self.extra.reset()
        content_id = item['id'].split(':', 1)[1]
        token = parse_qs(urlparse(item['url']).query).get('xsec_token', [''])[0]
        roots, seen, cursor = [], set(), None
        # 分页异常或重复游标时停止，避免长时间空转
        for _ in range(5):
            rows, more, next_cursor = await self.page(content_id, token, cursor)
            for raw in rows:
                identity = self.identity(raw)
                if not identity or identity in seen:
                    continue
                seen.add(identity)
                roots.append(raw)
                await self.save(content_id, raw)
                if len(roots) >= 20:
                    break
            if len(roots) >= 20 or not more:
                break
            if not rows or next_cursor in (None, cursor):
                raise RuntimeError('评论未取全')
            cursor = next_cursor
        else:
            raise RuntimeError('评论未取全')
        if not self.replies:
            return
        count = 0
        for root in roots:
            if not self.reply_count(root):
                continue
            cursor = None
            parent = self.identity(root)
            for _ in range(5):
                rows, more, next_cursor = await self.page(content_id, token, cursor, parent)
                for raw in rows:
                    identity = self.identity(raw)
                    if not identity or identity in seen:
                        continue
                    seen.add(identity)
                    await self.save(content_id, raw, parent)
                    count += 1
                    if count >= 20:
                        return
                if not more:
                    break
                if not rows or next_cursor in (None, cursor):
                    raise RuntimeError('回复未取全')
                cursor = next_cursor
            else:
                raise RuntimeError('回复未取全')
