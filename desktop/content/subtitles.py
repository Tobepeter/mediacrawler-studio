"""只读取平台现成字幕，不执行语音识别或机器翻译"""
import asyncio
import json
import re
import httpx
from desktop.media_download import public_request
from desktop.paging import https_url
from desktop.content.schema import group, number


def seconds(value):
    parts = value.replace(',', '.').split(':')
    return sum(float(v) * 60 ** i for i, v in enumerate(reversed(parts)))


def parse(text):
    text = text.lstrip('\ufeff')
    if text.lstrip().startswith(('{', '[')):
        data = json.loads(text)
        rows = data if isinstance(data, list) else data.get('body', data.get('utterances', []))
        segments = []
        for r in rows:
            milliseconds = 'start_time' in r
            start = number(r.get('from', r.get('start_time', r.get('start'))))
            end = number(r.get('to', r.get('end_time', r.get('end'))))
            if start is None or end is None or start < 0 or end < start:
                continue
            segments.append({'start': start / 1000 if milliseconds else start,
                             'end': end / 1000 if milliseconds else end,
                             'text': r.get('content', r.get('text', ''))})
        return segments
    segments = []
    for block in re.split(r'\n\s*\n', text.replace('\r\n', '\n')):
        lines = block.splitlines()
        for i, line in enumerate(lines):
            match = re.match(r'((?:\d+:)?\d+:\d+[.,]\d+)\s+-->\s+((?:\d+:)?\d+:\d+[.,]\d+)', line)
            if match:
                start, end = map(seconds, match.groups())
                if end >= start:
                    segments.append({'start': start, 'end': end, 'text': '\n'.join(lines[i+1:])})
                break
    if not segments and text.strip() not in ('', 'WEBVTT'):
        raise ValueError('unsupported_subtitle_format')
    return segments


async def load(tracks, referer):
    semaphore = asyncio.Semaphore(3)
    async with httpx.AsyncClient(timeout=10, follow_redirects=True, headers={'Referer': referer},
                                 event_hooks={'request': [public_request]}) as client:
        async def read(track):
            result = {**track, 'status': 'pending', 'segments': []}
            try:
                async with semaphore:
                    async with asyncio.timeout(12):
                        async with client.stream('GET', https_url(track['url'])) as response:
                            response.raise_for_status()
                            data = bytearray()
                            async for chunk in response.aiter_bytes():
                                data.extend(chunk)
                                if len(data) > 4 * 1024 * 1024:
                                    raise ValueError('subtitle_too_large')
                        result.update(status='available', segments=parse(data.decode('utf-8-sig')))
            except Exception as error:
                result.update(status='failed', error='timeout' if isinstance(error, (TimeoutError, httpx.TimeoutException)) else 'subtitle_request_failed')
            return result
        tasks = [asyncio.create_task(read(track)) for track in tracks]
        try:
            done, pending = await asyncio.wait(tasks, timeout=30) if tasks else (set(), set())
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            items = [task.result() if task in done else {**track, 'status': 'failed', 'segments': [], 'error': 'timeout'}
                     for task, track in zip(tasks, tracks)]
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
    failed = sum(t['status'] == 'failed' for t in items)
    return group(items, 'partial' if failed and failed < len(items) else 'failed' if failed else None)
