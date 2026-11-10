"""图片转文字：调用本机 rapidocr，本工具不安装 OCR 引擎，桌面与 CLI 共用
图文帖的干货常写在图里，正文只有一句“见图”，这时才需要识别；视频用字幕，不识别封面"""
import asyncio
import json
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from desktop.paging import CreatorError

UNAVAILABLE = '需要本机安装 rapidocr（uv tool install rapidocr），当前未检测到'
# 正文短于这个字数、又有多张图时，干货多半在图里
SHORT_TEXT = 100
MIN_SCORE = 0.5
TIMEOUT_SECONDS = 600
# 在 rapidocr 自己的环境里运行，引擎只加载一次，逐张输出一行 JSON
SCRIPT = '''
import json, sys
from rapidocr import RapidOCR
engine = RapidOCR()
for path in sys.argv[1:]:
    result = engine(path)
    lines = [{"text": text, "score": round(float(score), 3)} for text, score in zip(result.txts or (), result.scores or ())]
    print(json.dumps({"path": path, "lines": lines}, ensure_ascii=False), flush=True)
'''


class OcrError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def command():
    fallback = Path.home() / '.local' / 'bin' / 'rapidocr'
    return shutil.which('rapidocr') or (str(fallback) if fallback.exists() else None)


def interpreter():
    """uv tool 装的命令第一行就是它自己环境的 Python"""
    path = command()
    if not path:
        return None
    try:
        first = Path(path).read_text(errors='ignore').split('\n', 1)[0]
    except OSError:
        return None
    python = first[2:].strip() if first.startswith('#!') else ''
    return python if python and Path(python).exists() else None


def check():
    return {'state': 'ready' if interpreter() else 'missing'}


def is_gallery(record):
    """视频只有一张封面；抖音图集会被标成 video，所以按图片数量判断"""
    return len(record.get('images') or []) >= 2 or record.get('contentType') != 'video'


def needs_ocr(record):
    """只有图文帖、图多、正文短时才值得识别"""
    text = (record.get('text') or '').strip()
    return len(record.get('images') or []) >= 2 and len(text) < SHORT_TEXT


def recognize(paths):
    python = interpreter()
    if not python:
        raise OcrError('ocr_unavailable', UNAVAILABLE)
    try:
        done = subprocess.run([python, '-c', SCRIPT, *map(str, paths)], capture_output=True, text=True, timeout=TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        raise OcrError('ocr_failed', '图片识别超时') from None
    if done.returncode:
        raise OcrError('ocr_failed', (done.stderr.strip().splitlines() or ['图片识别失败'])[-1][:200])
    pages = {}
    for line in done.stdout.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        texts = [item['text'].strip() for item in row.get('lines') or [] if item.get('score', 0) >= MIN_SCORE and item.get('text', '').strip()]
        # 标题图常把同一句排十几行，连续重复的只留一行
        pages[row['path']] = [text for index, text in enumerate(texts) if index == 0 or text != texts[index - 1]]
    return [{'index': index, 'text': '\n'.join(pages.get(str(path), []))} for index, path in enumerate(paths, 1)]


def result_of(pages):
    text = '\n\n'.join(page['text'] for page in pages if page['text'])
    if not text:
        raise OcrError('no_text', '图片里没有识别到文字')
    return {'source': 'ocr', 'text': text, 'images': pages, 'createdAt': datetime.now(timezone.utc).isoformat()}


async def ocr_file(path):
    return result_of(await asyncio.to_thread(recognize, [Path(path).resolve()]))


async def ocr_record(request, emit, page=None):
    from desktop.media_download import download_record
    record = request['record']
    if not is_gallery(record):
        raise OcrError('video', '视频请用 transcribe 转文字')
    if not record.get('images'):
        raise OcrError('no_images', '这条作品没有图片')
    # 先确认能识别，不白下载
    if not interpreter():
        raise OcrError('ocr_unavailable', UNAVAILABLE)
    with tempfile.TemporaryDirectory(prefix='mediacrawler-ocr-') as folder:
        result = await download_record({
            'record': record, 'kind': 'images', 'directory': folder,
            'report_files': True, 'runner': request.get('runner'),
        }, emit, page)
        files = result.get('files') or []
        if not files:
            raise OcrError(result.get('code') or 'download_failed', '图片下载失败')
        return result_of(await asyncio.to_thread(recognize, [Path(file) for file in files]))


async def ocr_result(request, emit, page=None):
    """失败转成结构化结果；节流错误继续向上，由调用方按节流处理"""
    try:
        return {'saved': 1, 'files': [], 'code': '', 'ocr': await ocr_record(request, emit, page)}
    except OcrError as error:
        return {'saved': 0, 'files': [], 'code': error.code, 'message': str(error)}
    except CreatorError:
        raise
    except RuntimeError as error:
        return {'saved': 0, 'files': [], 'code': str(error) or 'download_failed'}
