import io
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
from filelock import FileLock
from typer.testing import CliRunner

from mediacrawler_cli.__main__ import app
from mediacrawler_cli.auth import terminal_qr
from mediacrawler_cli.runtime import CLIError, recover, run
from mediacrawler_cli.state import paths, identity, alive, atomic_json


def request(tmp_path, **values):
    return dict(data_dir=str(tmp_path), platform='bili', profile='default', action='collect',
                lock_timeout=0, format='jsonl', timeout=10, **values)


def fake_worker(monkeypatch, source):
    import mediacrawler_cli.runtime as runtime
    original = subprocess.Popen
    monkeypatch.setattr(runtime.subprocess, 'Popen', lambda command, **kwargs: original([sys.executable, '-c', source], **kwargs))


def test_help_and_invalid_input():
    runner = CliRunner()
    assert runner.invoke(app, ['--help']).exit_code == 0
    assert runner.invoke(app, ['collect', '--platform', 'bili', '--query', 'a', '--limit', '101']).exit_code == 2
    assert runner.invoke(app, ['collect', '--platform', 'bili', '--query', 'a', '--url', 'b']).exit_code == 2


def test_profile_validation_and_alias(tmp_path):
    with pytest.raises(ValueError):
        paths(tmp_path, 'bili', '../bad')
    assert paths(tmp_path, 'bili', 'default')[2] != paths(tmp_path, 'xhs', 'default')[2]
    alias = tmp_path / 'alias'
    alias.symlink_to(tmp_path, target_is_directory=True)
    assert paths(alias, 'bili', 'default')[2] == paths(tmp_path, 'bili', 'default')[2]


def test_pid_reuse():
    record = identity(os.getpid())
    assert alive(record)
    record['created'] -= 1
    assert not alive(record)


def test_busy_cannot_steal(tmp_path):
    _, _, base = paths(tmp_path, 'bili', 'default')
    with FileLock(str(base) + '.lock'):
        with pytest.raises(CLIError, match='PROFILE_BUSY'):
            run(request(tmp_path))
        with pytest.raises(CLIError, match='PROFILE_BUSY'):
            recover(tmp_path, 'bili', 'default')


def test_native_lock_releases_on_crash(tmp_path):
    path = str(tmp_path / 'lock')
    child = subprocess.Popen([sys.executable, '-c', "from filelock import FileLock; import time; lock=FileLock(__import__('sys').argv[1]); lock.acquire(); print('ready',flush=True); time.sleep(30)", path], stdout=subprocess.PIPE, text=True)
    assert child.stdout.readline().strip() == 'ready'
    child.kill()
    child.wait(timeout=5)
    with FileLock(path, timeout=0):
        assert Path(path).exists()


def test_max_wait_must_fit_inside_timeout():
    from typer.testing import CliRunner
    from mediacrawler_cli.__main__ import app
    result = CliRunner().invoke(app, ['search', '--platform', 'dy', '--query', 'x', '--max-wait', '200', '--timeout', '100'])
    assert result.exit_code == 2 and 'max-wait' in result.output


def test_rate_status_reads_local_state_only(tmp_path, monkeypatch):
    from typer.testing import CliRunner
    from mediacrawler_cli.__main__ import app
    monkeypatch.setenv('MEDIACRAWLER_DATA_DIR', str(tmp_path))
    result = CliRunner().invoke(app, ['rate', 'status', '--platform', 'bili'])
    report = json.loads(result.output)
    assert result.exit_code == 0 and report['platform'] == 'bili' and report['cooldown_seconds'] == 0
    assert {'name': 'detail', 'used': 0, 'limit': 80, 'remaining': 80, 'window_seconds': 600, 'retry_after': 0} in report['quotas']


def test_success_and_output(tmp_path, monkeypatch, capsys):
    fake_worker(monkeypatch, 'import json; print(json.dumps({"type":"complete","items":[{"id":"a"}]}))')
    run(request(tmp_path, output_dir=str(tmp_path / 'output')))
    assert json.loads(capsys.readouterr().out) == {'id': 'a'}
    output = next((tmp_path / 'output').iterdir())
    assert json.loads((output / 'run.json').read_text())['complete']
    assert not list((tmp_path / 'runs').rglob('request.json'))
    assert not list((tmp_path / 'runs').rglob('heartbeat.json'))
    assert not list((tmp_path / 'runs').rglob('*-login.png'))


def test_deadline_kills_worker_and_preserves_partial(tmp_path, monkeypatch, capsys):
    fake_worker(monkeypatch, 'import json,time; print(json.dumps({"type":"item","item":{"id":"a"}}),flush=True); time.sleep(60)')
    value = request(tmp_path, save=True)
    value.update(timeout=0.4, output_dir=str(tmp_path / 'output'))
    with pytest.raises(CLIError, match='TASK_TIMEOUT'):
        run(value)
    assert json.loads(capsys.readouterr().out)['id'] == 'a'
    output = next((tmp_path / 'output').iterdir())
    assert not json.loads((output / 'run.json').read_text())['complete']
    recover(tmp_path, 'bili', 'default')


def test_recover_never_stops_live_owner(tmp_path):
    _, _, base = paths(tmp_path, 'bili', 'default')
    atomic_json(base.with_suffix('.json'), {'supervisor': identity(os.getpid()), 'processes': []})
    with pytest.raises(CLIError, match='PROFILE_BUSY'):
        recover(tmp_path, 'bili', 'default')


def test_qr_roundtrip(capsys):
    import qrcode
    buffer = io.BytesIO()
    qrcode.make('https://example.invalid/cli-test').save(buffer, format='PNG')
    terminal_qr(buffer.getvalue())
    output = capsys.readouterr()
    assert not output.out
    assert output.err.strip()
    assert 'https://' not in output.err


@pytest.mark.asyncio
async def test_persistent_browser_fixture(tmp_path):
    from playwright.async_api import async_playwright
    from mediacrawler_cli.browser import options
    from mediacrawler_cli.auth import open_login
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(str(tmp_path / 'browser'), headless=True, args=['--mute-audio'], **options(p))
        await context.add_cookies([{'name': 'test', 'value': 'persisted', 'domain': 'example.test', 'path': '/', 'expires': 2000000000}])
        page = context.pages[0]
        await page.set_content('<button class="login-btn" onclick="document.querySelector(\'img\').style.display=\'block\'">登录</button><img class="tang-pass-qrcode-img" style="display:none;width:100px;height:100px">')
        await page.locator('button').evaluate("e => {const wrapper=document.createElement('div');wrapper.className='user-or-login';e.replaceWith(wrapper);wrapper.append(e)}")
        assert await (await open_login(page, 'tieba')).is_visible()
        await context.close()
        context = await p.chromium.launch_persistent_context(str(tmp_path / 'browser'), headless=True, args=['--mute-audio'], **options(p))
        assert (await context.cookies('https://example.test'))[0]['value'] == 'persisted'
        await context.close()


def test_timeout_cleans_browser_child(tmp_path, monkeypatch, capsys):
    pidfile = tmp_path / 'child.json'
    source = f'''import subprocess,sys,time,json,psutil
p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])
open({str(pidfile)!r},'w').write(json.dumps({{'pid':p.pid,'created':psutil.Process(p.pid).create_time()}}))
time.sleep(60)
'''
    fake_worker(monkeypatch, source)
    value = request(tmp_path)
    value['timeout'] = 0.8
    with pytest.raises(CLIError, match='TASK_TIMEOUT'):
        run(value)
    assert not alive(json.loads(pidfile.read_text()))


def test_worker_lock_prevents_second_browser(tmp_path):
    _, _, base = paths(tmp_path, 'bili', 'default')
    with FileLock(str(base) + '.worker'):
        with pytest.raises(CLIError, match='PROFILE_BUSY'):
            run(request(tmp_path))
    # 失败路径必须释放 supervisor 的锁
    recover(tmp_path, 'bili', 'default')


def test_stale_owner_recovery(tmp_path):
    _, _, base = paths(tmp_path, 'bili', 'default')
    process = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
    record = identity(process.pid)
    wrong = identity(os.getpid())
    wrong['created'] -= 1
    atomic_json(base.with_suffix('.json'), {'supervisor': wrong, 'processes': [record]})
    try:
        recover(tmp_path, 'bili', 'default')
        assert not alive(record)
    finally:
        process.wait(timeout=5)


@pytest.mark.asyncio
async def test_noninteractive_never_opens_login(tmp_path):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock
    from mediacrawler_cli.auth import login
    page = MagicMock()
    page.locator.return_value.count = AsyncMock(return_value=0)
    crawler = SimpleNamespace(check_login=AsyncMock(return_value=False), page=page)
    with pytest.raises(RuntimeError, match='AUTH_REQUIRED'):
        await login(crawler, {'non_interactive': True}, tmp_path)
    assert not list(tmp_path.iterdir())


@pytest.mark.asyncio
async def test_saved_login_does_not_show_qr(tmp_path):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from mediacrawler_cli.auth import login
    await login(SimpleNamespace(check_login=AsyncMock(return_value=True)), {}, tmp_path)


def test_partial_comments_are_not_success(tmp_path, monkeypatch, capsys):
    fake_worker(monkeypatch, 'import json; print(json.dumps({"type":"warning"})); print(json.dumps({"type":"complete","items":[{"id":"a"}]}))')
    with pytest.raises(CLIError, match='PARTIAL_RESULT'):
        run(request(tmp_path))
    assert json.loads(capsys.readouterr().out)['id'] == 'a'


def test_platform_imports_do_not_initialize_wordcloud():
    result = subprocess.run([sys.executable, '-c', '''import sys
from desktop.native_platforms import create_native
from desktop.result_store import ResultStore
from mediacrawler_cli.state import PLATFORMS
for platform in PLATFORMS:
    create_native(platform, ResultStore(platform, 1, lambda *a, **kw: None))
assert 'tools.words' not in sys.modules
assert 'matplotlib.pyplot' not in sys.modules
'''], text=True, capture_output=True, timeout=30)
    assert result.returncode == 0, result.stderr


def test_logout_reports_unconfirmed_and_clears_only_profile(tmp_path, monkeypatch, capsys):
    fake_worker(monkeypatch, 'import json; print(json.dumps({"type":"complete","items":[{"platform":"bili","remote":"not_confirmed"}]}))')
    _, profile, _ = paths(tmp_path, 'bili', 'default')
    _, other, _ = paths(tmp_path, 'xhs', 'default')
    profile.mkdir(parents=True)
    other.mkdir(parents=True)
    value = request(tmp_path)
    value['action'] = 'logout'
    with pytest.raises(CLIError, match='REMOTE_LOGOUT_UNCONFIRMED'):
        run(value)
    output = json.loads(capsys.readouterr().out)
    assert output['localCleared']
    assert not profile.exists()
    assert other.exists()


def test_output_directory_failure_is_structured_and_releases_lock(tmp_path):
    blocked = tmp_path / 'not-a-directory'
    blocked.write_text('keep')
    result = CliRunner().invoke(app, ['collect', '--platform', 'bili', '--query', 'test',
        '--data-dir', str(tmp_path / 'data'), '--output-dir', str(blocked), '--non-interactive'])
    assert result.exit_code == 5
    assert json.loads(result.stderr)['code'] == 'OUTPUT_ERROR'
    assert 'Traceback' not in result.stderr and blocked.read_text() == 'keep'
    recover(tmp_path / 'data', 'bili', 'default')


@pytest.mark.parametrize('worker_error', [None, 'PLATFORM_ERROR'])
def test_output_write_failure_keeps_stdout_and_original_error(tmp_path, monkeypatch, capsys, worker_error):
    ending = {'type': 'failure', 'code': worker_error} if worker_error else {'type': 'complete', 'items': [{'id': 'a'}]}
    fake_worker(monkeypatch, f'import json; print(json.dumps({{"type":"item","item":{{"id":"a"}}}})); print(json.dumps({ending!r}))')
    original = Path.write_text
    def write(path, *args, **kwargs):
        if path.name == 'results.jsonl':
            raise PermissionError('simulated output failure')
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, 'write_text', write)
    with pytest.raises(CLIError, match=worker_error or 'OUTPUT_ERROR'):
        run(request(tmp_path, output_dir=str(tmp_path / 'output')))
    assert json.loads(capsys.readouterr().out) == {'id': 'a'}
    metadata = json.loads(next((tmp_path / 'output').glob('*/run.json')).read_text())
    assert not metadata['complete'] and metadata['error'] == (worker_error or 'OUTPUT_ERROR')
    recover(tmp_path, 'bili', 'default')


def test_metadata_write_failure_keeps_stdout_and_releases_lock(tmp_path, monkeypatch, capsys):
    import mediacrawler_cli.runtime as runtime
    fake_worker(monkeypatch, 'import json; print(json.dumps({"type":"complete","items":[{"id":"a"}]}))')
    original = runtime.atomic_json
    def write(path, data):
        if path.name == 'run.json':
            raise OSError('simulated full disk')
        return original(path, data)
    monkeypatch.setattr(runtime, 'atomic_json', write)
    with pytest.raises(CLIError, match='STORAGE_ERROR'):
        run(request(tmp_path))
    assert json.loads(capsys.readouterr().out) == {'id': 'a'}
    recover(tmp_path, 'bili', 'default')
