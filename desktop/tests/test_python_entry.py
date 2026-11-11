import runpy
from pathlib import Path
import pytest
from desktop import python_entry


@pytest.mark.parametrize('worker', python_entry.WORKERS)
def test_desktop_entry_dispatches_without_cli(monkeypatch, worker):
    calls = []
    monkeypatch.setattr('sys.argv', ['studio-python', '-u', '-m', worker])
    monkeypatch.setattr(python_entry.runpy, 'run_module', lambda name, **kwargs: calls.append(name))
    monkeypatch.chdir(Path(__file__).resolve().parents[2])
    python_entry.main()
    assert calls == [worker]


@pytest.mark.parametrize('args', [[], ['collect'], ['-u', '-m', 'os'], ['-u', '-m', 'mediacrawler_cli.worker']])
def test_desktop_entry_rejects_non_worker(monkeypatch, args):
    monkeypatch.setattr('sys.argv', ['studio-python', *args])
    with pytest.raises(SystemExit, match='内部 worker'):
        python_entry.main()


def test_one_runtime_for_cli_and_desktop(monkeypatch):
    builder = runpy.run_path(str(Path(__file__).resolve().parents[2] / 'scripts/build_python.py'))
    calls = []
    monkeypatch.setattr('shutil.which', lambda _: '/usr/bin/node')
    monkeypatch.setattr('subprocess.run', lambda args, **kwargs: calls.append(args))
    builder['build']()
    [args] = calls
    assert args[-1] == 'mediacrawler_cli/__main__.py'
    assert args[args.index('--name') + 1] == 'mediacrawler'
    for module in ('desktop', 'media_platform', 'mediacrawler_cli'):
        assert args[args.index(module) - 1] == '--collect-submodules'


def test_cli_entry_hands_desktop_workers_to_the_desktop_entry(monkeypatch):
    from mediacrawler_cli import __main__ as cli
    calls = []
    monkeypatch.setattr('sys.argv', ['mediacrawler', '-u', '-m', 'desktop.health_worker'])
    monkeypatch.setattr(python_entry.runpy, 'run_module', lambda name, **kwargs: calls.append(name))
    monkeypatch.chdir(Path(__file__).resolve().parents[2])
    cli.main()
    assert calls == ['desktop.health_worker']
