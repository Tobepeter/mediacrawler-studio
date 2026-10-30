"""CLI 扩展输出，保留现有桌面字段和上游作者脱敏规则"""
from desktop.result_store import ResultStore, normalize


def source_record(value):
    if isinstance(value, dict):
        return {k: source_record(v) for k, v in value.items()
                if not any(secret in k.lower() for secret in ('cookie', 'token', 'authorization', 'password', 'secret'))}
    if isinstance(value, list):
        return [source_record(v) for v in value]
    return value


class CLIResultStore(ResultStore):
    def __init__(self, platform, limit, emit, comments=False, include_source=False):
        super().__init__(platform, limit, emit, comments)
        self.include_source = include_source

    async def store_content(self, content_item):
        identity = normalize(content_item, self.platform)['id']
        if identity in self.ids or len(self.ids) >= self.limit:
            return
        await super().store_content(content_item)
        item = self.items.get(identity)
        if item is None:
            return
        if self.include_source:
            item['source'] = source_record(content_item)
        self.emit('item-update', item=item)
