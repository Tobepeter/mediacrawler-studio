import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from desktop.content import media, capabilities, subtitles
from desktop.content.schema import initialize, CAPABILITIES
from desktop.result_store import ResultStore


def record(platform='bili'):
    r = {'id': platform + ':1', 'platform': platform, 'url': 'https://example.com/', 'text': 'keep', 'images': []}
    initialize(r)
    r['media'] = {'variants': []}
    return r


@pytest.mark.asyncio
async def test_player_failure_keeps_media_and_body(monkeypatch):
    monkeypatch.setattr(media, 'fetch', AsyncMock(return_value=({'_cid': 2, '_view': {'aid': 1},
        'dash': {'video': [{'baseUrl': 'https://cdn.example/v', 'height': 720}]}}, 10)))
    runner = SimpleNamespace(platform='bili', client=SimpleNamespace(get=AsyncMock(side_effect=RuntimeError('Cookie=secret'))))
    r = record()
    await media.enrich(runner, r)
    assert r['media']['status'] == 'available'
    assert r['subtitles']['status'] == r['chapters']['status'] == 'failed'
    assert r['text'] == 'keep' and 'secret' not in str(r)


@pytest.mark.asyncio
async def test_subtitle_login_required_keeps_chapters():
    runner = SimpleNamespace(client=SimpleNamespace(get=AsyncMock(return_value={
        'need_login_subtitle': True, 'view_points': [{'content': 'Intro', 'from': 0, 'to': 10}]})))
    r = record()
    await capabilities.bilibili(runner, {'_cid': 2, '_view': {'aid': 1}}, r)
    assert r['subtitles']['status'] == 'login_required'
    assert r['chapters']['items'][0]['end'] == 10


@pytest.mark.asyncio
async def test_douyin_units_roles_and_missing_preview():
    r = record('dy')
    raw = {'chapter_list': [{'desc': 'Start', 'timestamp': 16000}],
           'music': {'is_original_sound': True, 'play_url': {'url_list': ['http://cdn.example/audio']}},
           'video': {'big_thumbs': [{'img_urls': ['https://cdn.example/grid'], 'interval': 1, 'img_num': 58,
                                   'img_x_len': 5, 'img_y_len': 5, 'img_x_size': 240, 'img_y_size': 136}]}}
    await capabilities.enrich(SimpleNamespace(platform='dy'), raw, r)
    assert r['chapters']['items'][0]['start'] == 16
    assert r['storyboards']['items'][0]['frameCount'] == 58
    assert r['audioResources']['items'][0]['matchesFullVideoAudio'] is None
    assert r['audioResources']['items'][0]['role'] == 'original_sound'
    assert r['subtitles']['status'] == 'not_provided'
    empty = record('dy')
    await capabilities.enrich(SimpleNamespace(platform='dy'), {}, empty)
    assert empty['storyboards']['status'] == 'not_provided'


def test_special_audio_and_xhs_camel_case():
    streams = media.variants('bili', {'dash': {'dolby': {'audio': [{'baseUrl': 'https://cdn.example/d', 'codecs': 'ec-3'}]},
                                              'flac': {'audio': {'baseUrl': 'https://cdn.example/f', 'codecs': 'flac'}}}})
    assert [(v['kind'], v['label']) for v in streams] == [('audio', 'dolby'), ('audio', 'flac')]
    streams = media.variants('xhs', {'video': {'media': {'stream': {'h264': [{
        'masterUrl': 'http://cdn.example/v', 'duration': 51267, 'avgBitrate': 1000,
        'videoCodec': 'h264', 'audioCodec': 'aac', 'audioChannels': 2, 'audioBitrate': 64}]}}}})
    assert streams[0]['durationSeconds'] == 51.267
    assert streams[0]['audioChannels'] == 2 and streams[0]['bitrate'] == 1000


@pytest.mark.parametrize('text,expected', [
    ('{"body":[{"from":1,"to":2,"content":"hello"}]}', {'start': 1, 'end': 2, 'text': 'hello'}),
    ('{"utterances":[{"start_time":1500,"end_time":2500,"text":"hello"}]}', {'start': 1.5, 'end': 2.5, 'text': 'hello'}),
    ('WEBVTT\n\n00:01.500 --> 00:02.500 align:start\nhello', {'start': 1.5, 'end': 2.5, 'text': 'hello'}),
    ('1\n00:00:01,500 --> 00:00:02,500\nhello', {'start': 1.5, 'end': 2.5, 'text': 'hello'}),
])
def test_subtitle_formats(text, expected):
    assert subtitles.parse(text) == [expected]


@pytest.mark.asyncio
async def test_partial_subtitle_failure_preserves_language(monkeypatch):
    original = httpx.AsyncClient
    async def respond(request):
        if request.url.path == '/bad':
            return httpx.Response(403)
        return httpx.Response(200, json={'body': [{'from': 0, 'to': 2, 'content': 'hello'}]})
    monkeypatch.setattr(subtitles.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))
    monkeypatch.setattr(subtitles, 'public_request', AsyncMock())
    result = await subtitles.load([{'url': 'https://cdn.example/good', 'language': 'zh'},
                                   {'url': 'https://cdn.example/bad', 'language': 'en'}], 'https://www.bilibili.com/')
    assert result['status'] == 'partial'
    assert result['items'][0]['segments'][0]['text'] == 'hello'
    assert result['items'][1]['status'] == 'failed' and result['items'][1]['language'] == 'en'


@pytest.mark.asyncio
async def test_desktop_store_emits_stable_schema():
    events = []
    store = ResultStore('xhs', 1, lambda *args, **kwargs: events.append(kwargs))
    await store.store_content({'note_id': '1', 'title': 'a', 'type': 'normal'})
    r = events[0]['item']
    assert r['schemaVersion'] == 3
    assert all(r[k] == {'status': 'not_requested', 'items': []} for k in CAPABILITIES)


@pytest.mark.asyncio
async def test_cancellation_propagates(monkeypatch):
    monkeypatch.setattr(media, 'fetch', AsyncMock(side_effect=asyncio.CancelledError))
    with pytest.raises(asyncio.CancelledError):
        await media.enrich(SimpleNamespace(platform='dy'), record('dy'))


@pytest.mark.asyncio
async def test_media_failure_still_queries_subtitles(monkeypatch):
    monkeypatch.setattr(media, 'fetch', AsyncMock(return_value=({'_cid': 2, '_view': {'aid': 1},
                                                               '_media_error': 'media_request_failed'}, 10)))
    runner = SimpleNamespace(platform='bili', client=SimpleNamespace(get=AsyncMock(return_value={
        'subtitle': {'subtitles': [{'id': 1, 'lan': 'ai-zh', 'subtitle_url': 'https://cdn.example/sub'}]}})))
    monkeypatch.setattr(capabilities, 'load', AsyncMock(return_value={'status': 'available', 'items': [
        {'language': 'ai-zh', 'segments': [{'start': 0, 'end': 2, 'text': 'hello'}]}]}))
    r = record()
    await media.enrich(runner, r)
    assert r['media']['status'] == 'failed'
    assert r['subtitles']['status'] == r['media']['subtitleStatus'] == 'available'
    assert r['text'] == 'keep'
