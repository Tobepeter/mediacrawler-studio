"""视频转文字：调用 stt 的本机 HTTP 服务，桌面与 CLI 共用

stt 由 ai-voice 构建成独立包，安装版放在资源目录里；模型不打包，从 Hugging Face 或魔搭的缓存读
"""
import asyncio
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import httpx

from desktop.paging import CreatorError
from media_downloader.selection import without_silent_duplicates

BASE_URL = 'http://127.0.0.1:29556'
START_SECONDS = 60
TRANSCRIBE_SECONDS = 1800
UNAVAILABLE = '需要本机运行 stt 语音转写服务，当前未检测到'


class SttError(RuntimeError):
    def __init__(self, code, message, retry_after=None):
        super().__init__(message)
        self.code, self.retry_after = code, retry_after


def bundled():
    """安装版里和运行时同在资源目录（resources/stt/stt），源码运行时在 vendor/stt/stt，没有就算没有"""
    base = Path(sys.executable).resolve().parent.parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[1] / 'vendor'
    path = base / 'stt' / 'stt'
    return str(path) if path.is_file() and os.access(path, os.X_OK) else None


def locate():
    """包里的优先，没有再找本机装的；Electron 启动的进程 PATH 里通常没有 ~/.local/bin"""
    if path := bundled():
        return path, 'bundled'
    fallback = Path.home() / '.local' / 'bin' / 'stt'
    path = shutil.which('stt') or (str(fallback) if fallback.exists() else None)
    return (path, 'system') if path else (None, None)


def command():
    return locate()[0]


def missing_of(report):
    """把 stt check 的结果收成界面要的样子：缺什么、多大、放到哪"""
    checks = {item.get('id'): item for item in report.get('checks') or [] if isinstance(item, dict)}
    rows = []
    for item in report.get('missing') or []:
        if not isinstance(item, dict) or item.get('required_for_default') is False:
            continue
        detail = checks.get(item.get('id')) or {}
        model = detail.get('model') if isinstance(detail.get('model'), dict) else {}
        rows.append({
            'id': item.get('id'), 'kind': item.get('kind'), 'name': model.get('name') or item.get('model') or item.get('id'),
            'message': detail.get('message') or '', 'sizeBytes': model.get('missing_bytes') or item.get('size_bytes'),
            'path': item.get('expected_path') or detail.get('path'), 'files': model.get('missing_files') or item.get('files') or [],
            'hint': item.get('hint') or detail.get('hint') or '',
            'pages': [page for page in (model_page(source) for source in model.get('sources') or []) if page],
        })
    return rows


def model_page(source):
    repo = source.get('repo_id') if isinstance(source, dict) else None
    if not repo:
        return None
    url = {'modelscope': f'https://modelscope.cn/models/{repo}/files', 'huggingface': f'https://huggingface.co/{repo}/tree/main'}.get(source.get('hub'))
    return {'hub': source['hub'], 'url': url} if url else None


async def diagnose(path):
    """跑 stt check（静态检查，不加载模型、不下载）；跑不起来返回 None，交给提取时再报错"""
    try:
        process = await asyncio.create_subprocess_exec(path, 'check', '--json', stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        output, _ = await asyncio.wait_for(process.communicate(), 20)
        report = json.loads(output)
    except (OSError, TimeoutError, ValueError):
        return None
    if not isinstance(report, dict) or 'ok' not in report:
        return None
    rows = missing_of(report)
    return {'ok': bool(report['ok']) or not rows, 'missing': rows, 'downloadBytes': sum(row['sizeBytes'] or 0 for row in rows)}


def client(timeout):
    # 本机地址不能走系统代理
    return httpx.AsyncClient(base_url=BASE_URL, timeout=httpx.Timeout(timeout, connect=1), trust_env=False)


async def status():
    try:
        async with client(3) as http:
            data = (await http.get('/v1/status')).json()
    except (httpx.HTTPError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get('service') == 'stt' else None


async def check():
    """ready 已连上；installed 后台没起但条件齐了，提取时叫醒；incomplete 缺模型或依赖；missing 没有 stt"""
    path, source = locate()
    data = await status()
    if data:
        return {'state': 'ready', 'busy': bool(data.get('busy')), 'source': source, 'path': path}
    if not path:
        return {'state': 'missing', 'busy': False, 'source': None, 'path': None}
    report = await diagnose(path)
    if report and not report['ok']:
        return {'state': 'incomplete', 'busy': False, 'source': source, 'path': path, 'missing': report['missing'], 'downloadBytes': report['downloadBytes']}
    return {'state': 'installed', 'busy': False, 'source': source, 'path': path}


async def ensure_service():
    if await status():
        return
    path = command()
    if not path:
        raise SttError('stt_unavailable', UNAVAILABLE)
    process = await asyncio.create_subprocess_exec(path, 'warmup', stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        await asyncio.wait_for(process.wait(), START_SECONDS)
    except TimeoutError:
        process.kill()
        await process.wait()
    if not await status():
        report = await diagnose(path)
        if report and not report['ok']:
            raise SttError('stt_incomplete', '语音转写缺少模型：' + '、'.join(row['name'] for row in report['missing']))
        raise SttError('stt_unavailable', 'stt 语音转写服务启动失败')


def now():
    return datetime.now(timezone.utc).isoformat()


def segments_of(rows):
    return [{'start': row.get('start'), 'end': row.get('end'), 'text': row.get('text', '')} for row in rows or [] if isinstance(row, dict)]


async def transcribe_file(path):
    await ensure_service()
    try:
        async with client(TRANSCRIBE_SECONDS) as http:
            response = await http.post('/v1/transcribe', json={'audio': str(Path(path).resolve())})
        data = response.json()
    except httpx.TimeoutException:
        raise SttError('stt_failed', '语音转写超时') from None
    except httpx.TransportError:
        raise SttError('stt_unavailable', UNAVAILABLE) from None
    except ValueError:
        raise SttError('stt_failed', 'stt 返回格式错误') from None
    if response.status_code == 503:
        wait = data.get('retry_after_seconds') if isinstance(data, dict) else None
        raise SttError('stt_busy', '语音转写正忙，请稍后再试', math.ceil(wait) if isinstance(wait, (int, float)) else None)
    if response.status_code >= 400 or not isinstance(data, dict):
        reason = (data.get('error') if isinstance(data, dict) else None) or '语音转写失败'
        if 'does not contain any stream' in reason:
            raise SttError('no_audio', '这条视频没有音轨')
        raise SttError('stt_failed', reason)
    text = str(data.get('text') or '').strip()
    if not text:
        raise SttError('no_speech', '没有识别到语音')
    return {'source': 'stt', 'model': data.get('model'), 'text': text, 'segments': segments_of(data.get('segments')), 'createdAt': now()}


def platform_subtitle(record):
    """平台字幕更准也不用转写，有就直接用，中文优先"""
    tracks = [track for track in (record.get('subtitles') or {}).get('items') or [] if track.get('segments')]
    if not tracks:
        return None
    track = next((item for item in tracks if str(item.get('language') or '').lower().startswith(('zh', 'ai-zh'))), tracks[0])
    segments = segments_of(track['segments'])
    return {'source': 'subtitle', 'language': track.get('language'), 'text': '\n'.join(row['text'] for row in segments), 'segments': segments, 'createdAt': now()}


async def transcribe_record(request, emit, page=None):
    from desktop.media_download import download_record
    record = request['record']
    subtitle = platform_subtitle(record)
    if subtitle:
        return subtitle
    # 先确认服务可用，不白下载
    await ensure_service()
    # 旧记录里可能还有无声版本，最低画质正好会选中它们
    media = record.get('media') or {}
    if record.get('platform') == 'dy' and media.get('variants'):
        record = {**record, 'media': {**media, 'variants': without_silent_duplicates(media['variants'])}}
    # 只用音轨，下最低画质省流量，转完目录一起删掉
    with tempfile.TemporaryDirectory(prefix='mediacrawler-stt-') as folder:
        result = await download_record({
            'record': record, 'kind': 'video', 'quality': 'worst', 'directory': folder,
            'report_files': True, 'runner': request.get('runner'),
        }, emit, page)
        files = result.get('files') or []
        if not files:
            raise SttError(result.get('code') or 'download_failed', '视频下载失败')
        return await transcribe_file(files[0])


async def transcribe_result(request, emit, page=None):
    """失败转成结构化结果；节流错误继续向上，由调用方按节流处理"""
    try:
        return {'saved': 1, 'files': [], 'code': '', 'transcript': await transcribe_record(request, emit, page)}
    except SttError as error:
        return {'saved': 0, 'files': [], 'code': error.code, 'message': str(error), 'retryAfter': error.retry_after}
    except CreatorError:
        raise
    except RuntimeError as error:
        return {'saved': 0, 'files': [], 'code': str(error) or 'download_failed'}
