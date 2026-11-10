"""复用上游内容标准化，输出桌面需要的字段"""
from datetime import datetime, timezone
from html import unescape
from urllib.parse import urlparse

from desktop.paging import AUTHOR_LIMIT, TITLE_LIMIT


def normalize(item, platform):
    content_id = str(item.get("video_id") or item.get("aweme_id") or item.get("note_id") or item.get("content_id") or "")
    if platform == 'zhihu':
        content_id = f"{item.get('content_type') or 'answer'}:{content_id}"
    text = item.get('content_text') or item.get('desc') or item.get('content') or ''
    images = item.get("image_list") or item.get("note_download_url") or item.get("video_cover_url") or item.get("cover_url") or ""
    if isinstance(images, str):
        images = images.split(",")
    safe_images = []
    for value in images:
        if not isinstance(value, str):
            continue
        if value.startswith("//"):
            value = "https:" + value
        if value.startswith("http://"):
            value = "https://" + value[7:]
        if urlparse(value).scheme == "https":
            if value not in safe_images:
                safe_images.append(value)
    return {
        "id": f"{platform}:{content_id}", "platform": platform,
        "title": unescape(item.get("title") or text)[:TITLE_LIMIT] or "未命名作品", "text": unescape(text),
        "author": str(item.get("nickname") or item.get("user_nickname") or "")[:AUTHOR_LIMIT], "images": safe_images,
        "url": item.get("note_url") or item.get("aweme_url") or item.get("video_url") or item.get("content_url") or "",
        "likes": str(item.get("liked_count") or item.get("voteup_count") or "0"),
        "collectedAt": datetime.now(timezone.utc).isoformat(),
    }


def comment_fields(raw):
    identity = str(raw.get('comment_id') or '')
    if not identity:
        return None
    parent = str(raw.get('parent_comment_id') or '')
    return {
        'id': identity, 'parentId': '' if parent == '0' else parent, 'text': raw.get('content') or '',
        'author': str(raw.get('nickname') or raw.get('user_nickname') or '')[:AUTHOR_LIMIT], 'likes': str(raw.get('like_count') or raw.get('comment_like_count') or '0'),
    }


class ResultStore:
    def __init__(self, platform, limit, emit, comments=False):
        self.page_rows = None  # 按页取评论时用，不写进作品
        self.platform = platform
        self.limit = limit
        self.emit = emit
        self.ids = set()
        self.full_text = {}
        self.author_urls = {}
        self.markdown = {}
        self.cards = set()  # 只有列表字段的条目，打开详情时再补全
        self.media = {}
        self.items = {}
        self.comments = comments

    async def store_content(self, content_item):
        if self.platform == 'wb':
            key = f"wb:{content_item.get('note_id')}"
            content_item = {**content_item, 'image_list': self.media.get(key, [])}
        item = normalize(content_item, self.platform)
        item["text"] = self.full_text.get(item["id"], item["text"])
        if self.author_urls.get(item["id"]):
            item["authorUrl"] = self.author_urls[item["id"]]
        if self.markdown.get(item["id"]):
            item["markdown"] = self.markdown[item["id"]]
        if item["id"] in self.ids or len(self.ids) >= self.limit:
            return
        from desktop.content.schema import initialize, metadata
        item.update(metadata(content_item))
        initialize(item)
        if item["id"] in self.cards:
            # 列表和详情是同一条记录，详情回来后合并进来并去掉这个标记
            item.update(feed=True, detailPending=True)
            # 列表没给点赞数时留空，不显示成 0
            if content_item.get("liked_count") is None:
                item["likes"] = ""
        self.ids.add(item["id"])
        if self.comments:
            item.update(comments=[], commentStatus="pending")
        self.items[item["id"]] = item
        self.emit("item", item=item)

    def comment_state(self, item, status):
        item['commentStatus'] = status
        self.emit('item-update', item=item)

    async def store_comment(self, comment_item):
        raw = comment_item
        if self.page_rows is not None:
            fields = comment_fields(raw)
            if fields:
                self.page_rows.append(fields)
            return
        content_id = raw.get('video_id') or raw.get('aweme_id') or raw.get('note_id') or raw.get('content_id')
        if self.platform == 'zhihu':
            content_id = f"{raw.get('content_type') or 'answer'}:{content_id}"
        item = self.items.get(f'{self.platform}:{content_id}')
        if not item or not self.comments:
            return
        fields = comment_fields(raw)
        if not fields or any(comment['id'] == fields['id'] for comment in item['comments']):
            return
        # 主评论与回复各最多20条，独立于上游页大小
        if sum(bool(comment['parentId']) == bool(fields['parentId']) for comment in item['comments']) >= 20:
            return
        item['comments'].append(fields)
        self.emit('item-update', item=item)
