import os

from filelock import FileLock
from typer.testing import CliRunner

from mediacrawler_cli.__main__ import app
from mediacrawler_cli.cleanup import clean, KEEP_RUNS
from mediacrawler_cli.state import paths, atomic_json, identity


def make_run(root, platform='xhs', profile='default', name='001'):
    run = root / 'runs' / platform / profile / name
    run.mkdir(parents=True)
    atomic_json(run / 'run.json', {'complete': True})
    (run / 'login.png').write_bytes(b'qr')
    (run / 'heartbeat.json').write_text('{}')
    return run


def test_retention_and_transient_cleanup(tmp_path):
    for index in range(70):
        make_run(tmp_path, name=f'{index:03}')
    clean(tmp_path, keep=KEEP_RUNS)
    remaining = list((tmp_path / 'runs/xhs/default').iterdir())
    assert len(remaining) == 50
    assert all([p.name for p in run.iterdir()] == ['run.json'] for run in remaining)


def test_scoped_cleanup_preserves_profiles_outputs_and_other_runs(tmp_path):
    target = make_run(tmp_path, profile='work')
    other = make_run(tmp_path)
    _, profile, _ = paths(tmp_path, 'xhs', 'work')
    profile.mkdir(parents=True)
    (profile / 'Cookies').write_text('saved')
    exported = tmp_path / 'exports/result.json'
    exported.parent.mkdir()
    exported.write_text('{}')
    assert clean(tmp_path, 'xhs', 'work')['deleted'] == 1
    assert not target.exists() and other.exists()
    assert (profile / 'Cookies').exists() and exported.exists()


def test_active_supervisor_worker_and_orphan_browser_are_skipped(tmp_path):
    run = make_run(tmp_path)
    _, _, base = paths(tmp_path, 'xhs', 'default')
    for suffix in ('.lock', '.worker', '.recovery'):
        with FileLock(str(base) + suffix):
            assert clean(tmp_path)['skipped'] == 1
            assert (run / 'login.png').exists()
    atomic_json(base.with_suffix('.json'), {'supervisor': {'pid': -1}, 'processes': [identity(os.getpid())]})
    assert clean(tmp_path)['skipped'] == 1
    base.with_suffix('.json').unlink()
    assert clean(tmp_path)['deleted'] == 1


def test_abandoned_run_and_symlink(tmp_path):
    run = make_run(tmp_path)
    (run / 'run.json').unlink()
    external = tmp_path / 'outside'
    external.mkdir()
    (external / 'keep').write_text('keep')
    (run.parent / 'link').symlink_to(external, target_is_directory=True)
    assert clean(tmp_path, keep=50)['deleted'] == 1
    assert (external / 'keep').exists()


def test_legacy_and_command_validation(tmp_path):
    legacy = tmp_path / 'runs/20261029-old'
    legacy.mkdir(parents=True)
    (legacy / 'login.png').write_bytes(b'qr')
    assert clean(tmp_path, 'xhs')['deleted'] == 0
    assert clean(tmp_path)['deleted'] == 1
    runner = CliRunner()
    assert runner.invoke(app, ['clean', '--profile', 'work', '--data-dir', str(tmp_path)]).exit_code == 2
    assert runner.invoke(app, ['clean', '--data-dir', str(tmp_path)]).exit_code == 0


def test_busy_run_creates_no_directory(tmp_path):
    import pytest
    from mediacrawler_cli.runtime import run, CLIError
    _, _, base = paths(tmp_path, 'xhs', 'default')
    with FileLock(str(base) + '.lock'):
        with pytest.raises(CLIError, match='PROFILE_BUSY'):
            run({'data_dir': str(tmp_path), 'platform': 'xhs', 'profile': 'default', 'lock_timeout': 0})
    assert not (tmp_path / 'runs').exists()


def test_legacy_cleanup_respects_live_owner(tmp_path):
    directory = tmp_path / 'runs/old'
    directory.mkdir(parents=True)
    atomic_json(directory / 'request.json', {'supervisor': identity(os.getpid())})
    assert clean(tmp_path)['skipped'] == 1
    assert directory.exists()
