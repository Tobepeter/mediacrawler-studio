"""图片转文字：在项目环境里直接调用 rapidocr，桌面与 CLI 共用
图文帖的干货常写在图里，正文只有一句“见图”，这时才需要识别；视频用字幕，不识别封面"""
import asyncio
import functools
import importlib.util
import logging
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

from desktop.paging import CreatorError

UNAVAILABLE = '当前环境没有 OCR 依赖，开发环境运行 uv sync 安装；安装版暂不带 OCR'
# 正文短于这个字数、又有多张图时，干货多半在图里
SHORT_TEXT = 100
MIN_SCORE = 0.5
# 同一进程里的识别排队进行，引擎不并发使用
lock = threading.Lock()


class OcrError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def available():
    return all(importlib.util.find_spec(name) for name in ('rapidocr', 'onnxruntime'))


def check():
    return {'state': 'ready' if available() else 'missing'}


@functools.cache
def engine():
    """第一次识别时加载模型，同一进程之后都复用"""
    from rapidocr import RapidOCR
    # 空图会打“没检测到文字”的警告，对调用方没用
    logging.getLogger('RapidOCR').setLevel(logging.ERROR)
    return RapidOCR()


def is_gallery(record):
    """视频只有一张封面；抖音图集会被标成 video，所以按图片数量判断"""
    return len(record.get('images') or []) >= 2 or record.get('contentType') != 'video'


def needs_ocr(record):
    """只有图文帖、图多、正文短时才值得识别"""
    text = (record.get('text') or '').strip()
    return len(record.get('images') or []) >= 2 and len(text) < SHORT_TEXT


def lines_of(result):
    texts = [text.strip() for text, score in zip(result.txts or (), result.scores or ()) if score >= MIN_SCORE and text and text.strip()]
    # 标题图常把同一句排十几行，连续重复的只留一行
    return [text for index, text in enumerate(texts) if index == 0 or text != texts[index - 1]]


def recognize(paths):
    if not available():
        raise OcrError('ocr_unavailable', UNAVAILABLE)
    pages, failed = [], 0
    with lock:
        try:
            ocr = engine()
        except Exception as error:
            raise OcrError('ocr_failed', f'OCR 引擎加载失败：{type(error).__name__}') from None
        for index, path in enumerate(paths, 1):
            # 单张图坏了不拖垮整篇
            try:
                text = '\n'.join(lines_of(ocr(str(path))))
            except Exception:
                failed += 1
                text = ''
            pages.append({'index': index, 'text': text})
    if paths and failed == len(paths):
        raise OcrError('ocr_failed', '图片识别失败')
    return pages


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
    if not available():
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
