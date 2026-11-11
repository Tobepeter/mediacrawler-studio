from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from desktop import ocr
from desktop.ocr import OcrError


def output(*rows):
    return SimpleNamespace(txts=tuple(text for text, _ in rows), scores=tuple(score for _, score in rows))


class FakeEngine:
    """按文件名返回预设结果，记下被调用的顺序"""

    def __init__(self, results):
        self.results, self.calls = results, []

    def __call__(self, path):
        self.calls.append(Path(path).name)
        result = self.results[Path(path).name]
        if isinstance(result, Exception):
            raise result
        return result


@pytest.fixture
def fake(monkeypatch):
    def install(results):
        engine = FakeEngine(results)
        monkeypatch.setattr(ocr, 'available', lambda: True)
        monkeypatch.setattr(ocr, 'engine', lambda: engine)
        return engine
    return install


def test_check_follows_installed_packages(monkeypatch):
    monkeypatch.setattr(ocr, 'available', lambda: True)
    assert ocr.check() == {'state': 'ready'}
    monkeypatch.setattr(ocr, 'available', lambda: False)
    assert ocr.check() == {'state': 'missing'}
    with pytest.raises(OcrError) as caught:
        ocr.recognize([Path('a.jpg')])
    assert caught.value.code == 'ocr_unavailable'


def test_engine_is_created_once_per_process(monkeypatch):
    import sys
    created = []

    class Engine:
        def __init__(self):
            created.append(1)

    monkeypatch.setitem(sys.modules, 'rapidocr', SimpleNamespace(RapidOCR=Engine))
    ocr.engine.cache_clear()
    try:
        assert ocr.engine() is ocr.engine()
        assert created == [1]
    finally:
        ocr.engine.cache_clear()


def test_recognize_keeps_order_drops_low_scores_and_repeats(fake):
    engine = fake({
        'a.jpg': output(('建议1', 0.95), ('建议1', 0.95), ('噪点', 0.2), (' ', 0.9), ('建议2', 0.9)),
        'b.jpg': output(('第二张', 0.9)),
    })
    assert ocr.recognize([Path('a.jpg'), Path('b.jpg')]) == [{'index': 1, 'text': '建议1\n建议2'}, {'index': 2, 'text': '第二张'}]
    assert engine.calls == ['a.jpg', 'b.jpg']


def test_one_bad_image_does_not_fail_the_post(fake):
    fake({'a.jpg': ValueError('坏图'), 'b.jpg': output(('还在', 0.9))})
    assert ocr.recognize([Path('a.jpg'), Path('b.jpg')]) == [{'index': 1, 'text': ''}, {'index': 2, 'text': '还在'}]


def test_all_images_failing_is_reported(fake):
    fake({'a.jpg': ValueError('坏图')})
    with pytest.raises(OcrError) as caught:
        ocr.recognize([Path('a.jpg')])
    assert caught.value.code == 'ocr_failed'


def test_engine_load_failure_is_reported(monkeypatch):
    monkeypatch.setattr(ocr, 'available', lambda: True)

    def broken():
        raise RuntimeError('model missing')
    monkeypatch.setattr(ocr, 'engine', broken)
    with pytest.raises(OcrError) as caught:
        ocr.recognize([Path('a.jpg')])
    assert caught.value.code == 'ocr_failed' and '加载失败' in str(caught.value)


@pytest.mark.parametrize('record,expected', [
    ({'contentType': 'note', 'images': ['a', 'b'], 'text': '见图'}, True),
    ({'contentType': 'note', 'images': ['a'], 'text': '见图'}, False),
    ({'contentType': 'note', 'images': ['a', 'b'], 'text': '长' * 100}, False),
    ({'contentType': 'video', 'images': ['cover'], 'text': ''}, False),
    # 旧记录里抖音图集被标成 video，按图片数量认
    ({'contentType': 'video', 'images': ['a', 'b', 'c'], 'text': '见图'}, True),
])
def test_needs_ocr_only_for_short_image_posts(record, expected):
    assert ocr.needs_ocr(record) is expected


async def test_record_downloads_images_then_recognizes(tmp_path, monkeypatch, fake):
    from desktop import media_download
    files = [str(tmp_path / '1.jpg'), str(tmp_path / '2.jpg')]
    download = AsyncMock(return_value={'saved': 2, 'files': files})
    monkeypatch.setattr(media_download, 'download_record', download)
    fake({'1.jpg': output(('第1张', 0.9)), '2.jpg': output(('第2张', 0.9))})
    result = await ocr.ocr_result({'record': {'id': 'xhs:1', 'contentType': 'note', 'images': ['u1', 'u2']}}, None)
    assert result['code'] == '' and result['ocr']['text'] == '第1张\n\n第2张' and result['ocr']['source'] == 'ocr'
    assert download.await_args.args[0]['kind'] == 'images'


@pytest.mark.parametrize('record,code', [
    ({'id': 'dy:1', 'contentType': 'video', 'images': ['cover']}, 'video'),
    ({'id': 'xhs:1', 'contentType': 'note', 'images': []}, 'no_images'),
])
async def test_record_refuses_videos_and_empty_posts(record, code):
    assert (await ocr.ocr_result({'record': record}, None))['code'] == code


async def test_unavailable_engine_skips_download(monkeypatch):
    from desktop import media_download
    download = AsyncMock()
    monkeypatch.setattr(media_download, 'download_record', download)
    monkeypatch.setattr(ocr, 'available', lambda: False)
    result = await ocr.ocr_result({'record': {'id': 'xhs:1', 'contentType': 'note', 'images': ['u']}}, None)
    assert result['code'] == 'ocr_unavailable'
    download.assert_not_awaited()


def test_no_text_is_its_own_code():
    with pytest.raises(OcrError) as caught:
        ocr.result_of([{'index': 1, 'text': ''}])
    assert caught.value.code == 'no_text'


def test_real_engine_reads_a_text_card():
    """真实模型：只在装了依赖时跑，确认调库这条路是通的"""
    if not ocr.available():
        pytest.skip('没有 OCR 依赖')
    from PIL import Image, ImageDraw, ImageFont
    import tempfile
    font = next((f for f in ('/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/STHeiti Medium.ttc') if Path(f).exists()), None)
    if not font:
        pytest.skip('没有中文字体')
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / 'card.png'
        image = Image.new('RGB', (600, 160), 'white')
        ImageDraw.Draw(image).text((30, 50), '龙龛码头导航阳光便利店', fill='black', font=ImageFont.truetype(font, 40))
        image.save(path)
        pages = ocr.recognize([path])
    assert '阳光便利店' in pages[0]['text']
