"""平台筛选白名单与原生客户端参数，桌面配置与前端共用"""
import json
import time
from pathlib import Path

OPTIONS = json.loads(Path(__file__).with_name('search-options.json').read_text())


def search_options(platform, values=None):
    fields = OPTIONS[platform]
    values = {} if values is None else values
    if not isinstance(values, dict) or any(key not in fields for key in values):
        raise ValueError('无效的筛选条件')
    for key, value in values.items():
        if value not in [item['value'] for item in fields[key]['options']]:
            raise ValueError('无效的筛选条件')
    values = {key: values.get(key, field['default']) for key, field in fields.items()}
    if platform == 'bili':
        from media_platform.bilibili.field import SearchOrderType
        days = int(values['time'])
        now = int(time.time())
        return dict(order=SearchOrderType('' if values['sort'] == 'default' else values['sort']),
                    pubtime_begin_s=now-days*86400 if days else 0, pubtime_end_s=now if days else 0)
    if platform == 'dy':
        from media_platform.douyin.field import SearchSortType, PublishTimeType
        return dict(sort_type=SearchSortType(int(values['sort'])), publish_time=PublishTimeType(int(values['time'])))
    if platform == 'xhs':
        from media_platform.xhs.field import SearchSortType, SearchNoteType
        return dict(sort=SearchSortType(values['sort']), note_type=SearchNoteType(int(values['type'])))
    if platform == 'zhihu':
        from media_platform.zhihu.field import SearchSort, SearchType, SearchTime
        return {key: enum('' if values[name] == 'default' else values[name]) for key, name, enum in
                [('sort', 'sort', SearchSort), ('note_type', 'type', SearchType), ('search_time', 'time', SearchTime)]}
    if platform == 'wb':
        from media_platform.weibo.field import SearchType
        return dict(search_type=SearchType(values['type']))
    if platform == 'tieba':
        from media_platform.tieba.field import SearchSortType
        return dict(sort=SearchSortType(values['sort']))
    return {}
