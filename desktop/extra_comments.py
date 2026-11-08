"""新增平台评论分页，统一为桌面白名单字段"""
from desktop.pacing import wait_turn
import re
from html import unescape
from urllib.parse import urlencode
from tools.user_hash import mask_nickname


class ExtraCommentSource:
    def __init__(self, platform, client):
        self.platform, self.client = platform, client
        self.reset()

    def reset(self):
        self.roots = {}
        self.note = None

    async def page(self, identity, cursor, parent=None):
        content_id = identity.rsplit(':', 1)[-1]
        if self.platform == 'zhihu':
            from model.m_zhihu import ZhihuContent
            kind = identity.split(':', 1)[0]
            if parent:
                data = await self.client.get_child_comments(parent, offset=cursor or '', limit=20)
            else:
                data = await self.client.get_root_comments(content_id, kind, offset=cursor or '', limit=20)
            if 'data' not in data or 'paging' not in data:
                raise RuntimeError('评论暂时不可用')
            content = ZhihuContent(content_id=content_id, content_type=kind)
            rows = [row.model_dump() for row in self.client._extractor.extract_comments(content, data['data'])]
            paging = data['paging']
            more, next_cursor = not paging.get('is_end', True), self.client._extractor.extract_offset(paging)
        elif self.platform == 'ks':
            data = await self.client.get_video_sub_comments(content_id, int(parent), cursor or '') if parent else await self.client.get_video_comments(content_id, cursor or '')
            key = 'subCommentsV2' if parent else 'rootCommentsV2'
            if key not in data:
                raise RuntimeError('评论暂时不可用')
            rows = [{
                'comment_id': str(raw.get('comment_id') or raw.get('commentId') or ''),
                'video_id': content_id, 'content': raw.get('content') or '',
                'nickname': mask_nickname(raw.get('author_name') or raw.get('authorName') or ''),
                'like_count': raw.get('like_count') or raw.get('likeCount') or 0,
                'sub_comment_count': raw.get('commentCount') or raw.get('subCommentCount') or 0,
            } for raw in data[key] or []]
            next_cursor = data.get('pcursorV2')
            more = bool(next_cursor and next_cursor != 'no_more')
        elif self.platform == 'wb':
            if parent:
                data = self.roots.get(parent, {}).get('_replies') or []
                more, next_cursor = False, None
            else:
                max_id, max_type = cursor or (0, 0)
                response = await self.client.get_note_comments(content_id, max_id, max_type)
                if 'data' not in response:
                    raise RuntimeError('评论暂时不可用')
                data = response['data'] or []
                next_cursor = (response.get('max_id', 0), response.get('max_id_type', 0))
                more = bool(next_cursor[0])
            rows = [{
                'comment_id': str(raw.get('id') or ''), 'note_id': content_id,
                'content': unescape(re.sub(r'<[^>]+>', '', raw.get('text') or '')),
                'nickname': mask_nickname((raw.get('user') or {}).get('screen_name') or ''),
                'like_count': raw.get('like_count') or 0,
                'sub_comment_count': len(raw.get('comments') or []),
                '_replies': raw.get('comments') or [],
            } for raw in data]
        elif self.platform == 'tieba':
            page = cursor or 1
            if parent:
                from model.m_baidu_tieba import TiebaComment
                root = TiebaComment(**self.roots[parent])
                params = urlencode({'tid': content_id, 'pid': parent, 'fid': root.tieba_id, 'pn': page})
                await wait_turn('tieba')
                await self.client.playwright_page.goto(f'https://tieba.baidu.com/p/comment?{params}', wait_until='domcontentloaded')
                html = await self.client.playwright_page.content()
                rows = [row.model_dump() for row in self.client._page_extractor.extract_tieba_note_sub_comments(html, parent_comment=root)]
                more = bool(rows) and page * 10 < root.sub_comment_count
            else:
                data = await self.client._get_pc_page_data(content_id, page=page)
                if 'post_list' not in data:
                    raise RuntimeError('评论暂时不可用')
                self.note = self.note or self.client._page_extractor.extract_note_detail_from_api(data)
                rows = [row.model_dump() for row in self.client._page_extractor.extract_tieba_note_parent_comments_from_api(data, self.note)]
                # 首楼是正文，不重复作为评论
                first = str((data.get('first_floor') or {}).get('id') or '')
                rows = [row for row in rows if row['comment_id'] != first]
                more = page < int((data.get('page') or {}).get('total_page') or 1)
            next_cursor = page + 1
        else:
            raise RuntimeError('不支持的平台')
        for row in rows:
            row['parent_comment_id'] = parent or ''
            if not parent:
                self.roots[row['comment_id']] = row
        return rows, more, next_cursor
