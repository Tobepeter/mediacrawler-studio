"""稳定能力字段：未查询、未返回与失败分别表达"""
import math
from datetime import datetime, timezone

CAPABILITIES = ('subtitles', 'chapters', 'audioResources', 'storyboards', 'imageVariants', 'parts', 'collections')


def group(items=None, status=None, **extra):
    items = items or []
    return {'status': status or ('available' if items else 'not_provided'), 'items': items, **extra}


def initialize(record):
    record['schemaVersion'] = 3
    for key in CAPABILITIES:
        record.setdefault(key, group(status='not_requested'))
    record.setdefault('extra', {})


def number(value):
    try:
        n = float(value)
        if not math.isfinite(n):
            return None
        return int(n) if n.is_integer() else n
    except (ValueError, TypeError):
        return None


def first(data, *keys):
    return next((data[k] for k in keys if data.get(k) not in (None, '', 'None')), None)


def metadata(raw):
    timestamp = number(first(raw, 'create_time', 'publish_time', 'time', 'created_time'))
    published = None
    if timestamp is not None:
        try:
            published = datetime.fromtimestamp(timestamp / 1000 if timestamp > 100000000000 else timestamp, timezone.utc).isoformat()
        except (OverflowError, ValueError, OSError):
            pass
    return dict(contentType=first(raw, 'content_type', 'video_type', 'type') or 'unknown',
        publishedAt=published, durationSeconds=None, creatorHash=raw.get('creator_hash'),
        statistics={
            'likes': number(first(raw, 'liked_count', 'voteup_count')),
            'views': number(first(raw, 'video_play_count', 'view_count', 'play_count')),
            'comments': number(first(raw, 'comment_count', 'video_comment', 'comments_count')),
            'shares': number(first(raw, 'share_count', 'video_share_count')),
            'favorites': number(first(raw, 'collected_count', 'video_favorite_count')),
            'coins': number(raw.get('video_coin_count')), 'danmaku': number(raw.get('video_danmaku'))})
