import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from desktop import ocr
from desktop.ocr import OcrError


def tool(tmp_path, python=True):
    """造一个 uv tool 风格的命令：第一行指向它自己的 Python"""
    interpreter = tmp_path / 'python'
    if python:
        interpreter.write_text('')
    command = tmp_path / 'rapidocr'
    command.write_text(f'#!{interpreter}\nprint()\n')
    return str(command)


def test_interpreter_comes_from_the_command_shebang(tmp_path, monkeypatch):
    monkeypatch.setattr(ocr, 'command', lambda: tool(tmp_path))
    assert ocr.interpreter() == str(tmp_path / 'python')
    assert ocr.check() == {'state': 'ready'}


@pytest.mark.parametrize('python', [False, None])
def test_missing_tool_or_environment_is_unavailable(tmp_path, monkeypatch, python):
    monkeypatch.setattr(ocr, 'command', lambda: tool(tmp_path, python=False) if python is False else None)
    assert ocr.interpreter() is None
    assert ocr.check() == {'state': 'missing'}
    with pytest.raises(OcrError) as caught:
        ocr.recognize([tmp_path / 'a.jpg'])
    assert caught.value.code == 'ocr_unavailable'


def test_recognize_keeps_order_and_drops_low_scores(tmp_path, monkeypatch):
    monkeypatch.setattr(ocr, 'interpreter', lambda: '/bin/python')
    a, b = tmp_path / 'a.jpg', tmp_path / 'b.jpg'
    rows = [{'path': str(b), 'lines': [{'text': '第二张', 'score': 0.9}]},
            {'path': str(a), 'lines': [{'text': '建议1', 'score': 0.95}, {'text': '建议1', 'score': 0.95}, {'text': '噪点', 'score': 0.2}, {'text': ' ', 'score': 0.9}]}]
    monkeypatch.setattr(ocr.subprocess, 'run', lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout='\n'.join(json.dumps(r) for r in rows), stderr=''))
    assert ocr.recognize([a, b]) == [{'index': 1, 'text': '建议1'}, {'index': 2, 'text': '第二张'}]


def test_recognize_failure_is_reported(monkeypatch):
    monkeypatch.setattr(ocr, 'interpreter', lambda: '/bin/python')
    monkeypatch.setattr(ocr.subprocess, 'run', lambda *args, **kwargs: SimpleNamespace(returncode=1, stdout='', stderr='Traceback\nModuleNotFoundError: rapidocr'))
    with pytest.raises(OcrError) as caught:
        ocr.recognize([Path('a.jpg')])
    assert caught.value.code == 'ocr_failed' and 'rapidocr' in str(caught.value)


@pytest.mark.parametrize('record,expected', [
    ({'contentType': 'note', 'images': ['a', 'b'], 'text': '见图'}, True),
    ({'contentType': 'note', 'images': ['a'], 'text': '见图'}, False),
    ({'contentType': 'note', 'images': ['a', 'b'], 'text': '长' * 100}, False),
    ({'contentType': 'video', 'images': ['cover'], 'text': ''}, False),
    # 抖音图集被标成 video，按图片数量认
    ({'contentType': 'video', 'images': ['a', 'b', 'c'], 'text': '见图'}, True),
])
def test_needs_ocr_only_for_short_image_posts(record, expected):
    assert ocr.needs_ocr(record) is expected


async def test_record_downloads_images_then_recognizes(tmp_path, monkeypatch):
    from desktop import media_download
    files = [str(tmp_path / '1.jpg'), str(tmp_path / '2.jpg')]
    download = AsyncMock(return_value={'saved': 2, 'files': files})
    monkeypatch.setattr(media_download, 'download_record', download)
    monkeypatch.setattr(ocr, 'interpreter', lambda: '/bin/python')
    monkeypatch.setattr(ocr, 'recognize', lambda paths: [{'index': i, 'text': f'第{i}张'} for i, _ in enumerate(paths, 1)])
    result = await ocr.ocr_result({'record': {'id': 'xhs:1', 'contentType': 'note', 'images': ['u1', 'u2']}}, None)
    assert result['code'] == '' and result['ocr']['text'] == '第1张\n\n第2张' and result['ocr']['source'] == 'ocr'
    assert download.await_args.args[0]['kind'] == 'images'


@pytest.mark.parametrize('record,code', [
    ({'id': 'dy:1', 'contentType': 'video', 'images': ['cover']}, 'video'),
    ({'id': 'xhs:1', 'contentType': 'note', 'images': []}, 'no_images'),
])
async def test_record_refuses_videos_and_empty_posts(record, code):
    assert (await ocr.ocr_result({'record': record}, None))['code'] == code


async def test_unavailable_tool_skips_download(monkeypatch):
    from desktop import media_download
    download = AsyncMock()
    monkeypatch.setattr(media_download, 'download_record', download)
    monkeypatch.setattr(ocr, 'interpreter', lambda: None)
    result = await ocr.ocr_result({'record': {'id': 'xhs:1', 'contentType': 'note', 'images': ['u']}}, None)
    assert result['code'] == 'ocr_unavailable'
    download.assert_not_awaited()


def test_no_text_is_its_own_code():
    with pytest.raises(OcrError) as caught:
        ocr.result_of([{'index': 1, 'text': ''}])
    assert caught.value.code == 'no_text'
