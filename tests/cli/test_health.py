import json
from unittest.mock import AsyncMock

import httpx
import pytest
from typer.testing import CliRunner
from mediacrawler_cli.__main__ import app
from desktop.health import POLICY, classify, check_page
from desktop import health_network as network


def test_defaults_and_help_do_not_start_workers(monkeypatch):
    import mediacrawler_cli.__main__ as cli
    monkeypatch.setattr(cli, 'invoke', lambda *a, **kw: pytest.fail('unexpected worker'))
    runner = CliRunner()
    report = runner.invoke(app, ['check', '--defaults'])
    assert report.exit_code == 0
    assert json.loads(report.stdout)['policy']['qr_timeout_ms'] == POLICY['qr_timeout_ms']
    for args in (['--help'], ['check', '--help'], ['doctor', '--help'], ['auth', '--help']):
        assert runner.invoke(app, args).exit_code == 0


def test_check_all_network_once_and_failures_do_not_stop_other_platforms(monkeypatch):
    import mediacrawler_cli.__main__ as cli
    calls = []
    def invoke(action, platform, **options):
        calls.append((action, platform, options))
        if platform == 'dy':
            raise cli.typer.Exit(5)
    monkeypatch.setattr(cli, 'invoke', invoke)
    result = CliRunner().invoke(app, ['check', '--all', '--no-speed', '--qr-timeout', '2'])
    assert result.exit_code == 5
    assert len(calls) == 8
    assert calls[0][0] == 'network-check' and calls[0][2]['speed'] is False
    assert all(c[2]['qr_timeout_ms'] == 2000 for c in calls[1:])


@pytest.mark.asyncio
async def test_probe_separates_dns_and_http_status(monkeypatch):
    monkeypatch.setattr(network, 'dns_probe', AsyncMock(return_value={'status': 'failed', 'code': 'DNS_FAILED'}))
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(403))) as client:
        report = await network.probe(client, 'https://example.com')
    assert report['dns']['code'] == 'DNS_FAILED'
    assert report['http']['reachable'] is True
    assert report['http']['status_code'] == 403
    assert report['http']['status'] == 'failed'


@pytest.mark.asyncio
async def test_network_preserves_node_failure_without_claiming_offline(monkeypatch):
    monkeypatch.setattr(network, 'probe', AsyncMock(return_value={'http': {'status': 'ok', 'reachable': True}}))
    monkeypatch.setattr(network, 'speed_probe', AsyncMock(return_value={'status': 'unavailable', 'successful_samples': 0}))
    report = await network.diagnose_network()
    assert report['status'] == 'partial'
    assert report['local']['internet'] == 'reachable'
    assert report['speed']['status'] == 'unavailable'


@pytest.mark.asyncio
async def test_speed_failure_returns_no_invented_zero():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503))) as client:
        result = await network.speed_probe(client)
    assert result['mean_mbps'] is None
    assert result['median_mbps'] is None
    assert result['successful_samples'] == 0


def test_error_codes_exclude_sensitive_raw_messages():
    assert classify(RuntimeError('net::ERR_NAME_NOT_RESOLVED secret-cookie'), 'navigation')['code'] == 'DNS_FAILED'
    assert classify(httpx.ConnectError('private proxy password'), 'http')['code'] == 'CONNECTION_FAILED'
    assert 'password' not in json.dumps(classify(httpx.ConnectError('private proxy password'), 'http'))
    assert classify(TimeoutError(), 'qr_image')['stage'] == 'qr_image'


@pytest.mark.asyncio
async def test_real_dom_checks_image_and_challenge(tmp_path):
    from playwright.async_api import async_playwright
    from mediacrawler_cli.browser import options
    import base64
    import io
    import qrcode
    output = io.BytesIO()
    qrcode.make('offline-test').save(output, format='PNG')
    data = base64.b64encode(output.getvalue()).decode()
    html = f'<div class="login-scan-box"><img src="data:image/png;base64,{data}"></div>'
    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(tmp_path, headless=True, args=['--mute-audio'], **options(playwright))
        try:
            page = context.pages[0]
            await page.route('**/*', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
            result = await check_page(page, 'bili', 8000)
            assert result['status'] == 'ok'
            assert result['stages']['qr_image']['bytes'] > 0
            assert 'image' not in result
            html = '<div id="captcha_container">验证</div>'
            result = await check_page(page, 'bili', 8000)
            assert result['error']['code'] == 'VERIFICATION_REQUIRED'
            html = '<div>页面没有登录入口</div>'
            result = await check_page(page, 'bili', 1000)
            assert result['error']['code'] == 'LOGIN_ENTRY_NOT_FOUND'
            assert result['error']['timed_out'] is True
        finally:
            await context.close()


def test_runtime_failed_check_preserves_report_and_fails_exit(tmp_path, monkeypatch, capsys):
    from tests.cli.test_cli import fake_worker, request
    from mediacrawler_cli.runtime import run, CLIError
    fake_worker(monkeypatch, 'import json; print(json.dumps({"type":"complete","items":[{"type":"platform","status":"failed","error":{"code":"QR_IMAGE_FAILED"}}]}))')
    value = request(tmp_path)
    value['action'] = 'check'
    with pytest.raises(CLIError, match='CHECK_FAILED'):
        run(value)
    report = json.loads(capsys.readouterr().out)
    assert report['error']['code'] == 'QR_IMAGE_FAILED'
    metadata = json.loads(next((tmp_path / 'runs').rglob('run.json')).read_text())
    assert metadata['complete'] is False
