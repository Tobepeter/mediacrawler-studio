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


def test_build_targets_share_core_but_desktop_excludes_cli(monkeypatch):
    builder = runpy.run_path(str(Path(__file__).resolve().parents[2] / 'scripts/build_python.py'))
    calls = []
    monkeypatch.setattr('shutil.which', lambda _: '/usr/bin/node')
    monkeypatch.setattr('subprocess.run', lambda args, **kwargs: calls.append(args))
    builder['build']('desktop')
    builder['build']('cli')
    desktop, cli = calls
    assert desktop[-1] == 'desktop/python_entry.py'
    assert cli[-1] == 'mediacrawler_cli/__main__.py'
    assert desktop[desktop.index('--name') + 1] == 'studio-python'
    assert cli[cli.index('--name') + 1] == 'mediacrawler'
    assert '--collect-submodules' == desktop[desktop.index('media_platform') - 1]
    assert '--exclude-module' == desktop[desktop.index('mediacrawler_cli') - 1]
    assert '--collect-submodules' == cli[cli.index('mediacrawler_cli') - 1]
