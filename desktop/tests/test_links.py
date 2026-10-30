import httpx
import pytest
from desktop.links import resolve_link


@pytest.mark.asyncio
async def test_short_link_preserves_query(monkeypatch):
    client = httpx.AsyncClient
    destination = 'https://www.xiaohongshu.com/explore/abc?xsec_token=test-token'
    def respond(request):
        if request.url.host == 'xhslink.com':
            return httpx.Response(302, headers={'location': destination})
        return httpx.Response(200)
    monkeypatch.setattr('desktop.links.httpx.AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs))
    assert await resolve_link('https://xhslink.com/abc', 'xhs') == destination


@pytest.mark.asyncio
async def test_short_link_rejects_offsite_redirect(monkeypatch):
    client = httpx.AsyncClient
    calls = []
    def respond(request):
        calls.append(request.url.host)
        return httpx.Response(302, headers={'location': 'https://unrelated.example/path'})
    monkeypatch.setattr('desktop.links.httpx.AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs))
    with pytest.raises(RuntimeError, match='其他网站'):
        await resolve_link('https://b23.tv/abc', 'bili')
    assert calls == ['b23.tv']


@pytest.mark.asyncio
async def test_kuaishou_short_link_and_direct_link(monkeypatch):
    client = httpx.AsyncClient
    calls = []
    destination = 'https://www.kuaishou.com/short-video/abc123'
    def respond(request):
        calls.append(request.url.host)
        if request.url.host == 'v.kuaishou.com':
            return httpx.Response(302, headers={'location': destination})
        return httpx.Response(200)
    monkeypatch.setattr('desktop.links.httpx.AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(respond), **kwargs))
    assert await resolve_link(destination, 'ks') == destination
    assert calls == []
    assert await resolve_link('https://v.kuaishou.com/test', 'ks') == destination
    assert calls == ['v.kuaishou.com', 'www.kuaishou.com']
