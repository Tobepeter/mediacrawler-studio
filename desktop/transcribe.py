"""视频转文字：只依赖本机 stt 的 HTTP 服务，stt 和模型都不随项目分发，桌面与 CLI 共用"""
import asyncio
import math
import shutil
import subprocess
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


def command():
    """stt 的后台空闲会自动退出，有命令时可以叫醒；Electron 启动的进程 PATH 里通常没有 ~/.local/bin"""
    fallback = Path.home() / '.local' / 'bin' / 'stt'
    return shutil.which('stt') or (str(fallback) if fallback.exists() else None)


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
    """ready 已连上，installed 有命令但后台没起，missing 不可用"""
    data = await status()
    if data:
        return {'state': 'ready', 'busy': bool(data.get('busy'))}
    return {'state': 'installed' if command() else 'missing', 'busy': False}


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
