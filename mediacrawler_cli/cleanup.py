"""只回收 CLI 工作目录；不接触登录缓存、锁文件和导出结果"""
import json
import shutil
from contextlib import ExitStack

from filelock import FileLock, Timeout
from mediacrawler_cli.state import PLATFORMS, paths, alive

KEEP_RUNS = 50


def prune(directory, keep=0):
    if directory.is_symlink():
        return 0
    runs = sorted((p for p in directory.iterdir() if p.is_dir() and not p.is_symlink()),
                  key=lambda p: p.name, reverse=True) if directory.exists() else []
    deleted = 0
    for index, run in enumerate(runs):
        if index >= keep or not (run / 'run.json').is_file():
            shutil.rmtree(run)
            deleted += 1
        else:
            for file in run.iterdir():
                if file.name != 'run.json':
                    if file.is_dir() and not file.is_symlink():
                        shutil.rmtree(file)
                    else:
                        file.unlink()
    return deleted


def check_owner(base):
    owner = base.with_suffix('.json')
    if owner.exists():
        data = json.loads(owner.read_text())
        if any(alive(record) for record in [data['supervisor'], *data.get('processes', [])]):
            raise Timeout(str(base))


def clean(data_dir=None, platform=None, profile=None, keep=0):
    if profile and not platform:
        raise ValueError('--profile 需要同时指定 --platform')
    root, _, _ = paths(data_dir, platform or 'bili', profile or 'default')
    result = {'deleted': 0, 'skipped': 0}
    runs = root / 'runs'
    if not runs.exists() or runs.is_symlink():
        return result
    for selected in (platform,) if platform else (*PLATFORMS, 'direct'):
        group = runs / selected
        if not group.is_dir() or group.is_symlink():
            continue
        for directory in list(group.iterdir()):
            if profile and directory.name != profile:
                continue
            if not directory.is_dir() or directory.is_symlink():
                continue
            try:
                _, _, base = paths(root, selected, directory.name)
                with ExitStack() as stack:
                    for suffix in ('.recovery', '.lock', '.worker'):
                        stack.enter_context(FileLock(str(base) + suffix, timeout=0))
                    check_owner(base)
                    result['deleted'] += prune(directory, keep)
            except (Timeout, OSError, ValueError, KeyError):
                result['skipped'] += 1
    # 旧版本的扁平目录无法可靠归属平台：仅全量清理时处理，并持有所有旧锁
    legacy = [p for p in runs.iterdir() if p.is_dir() and not p.is_symlink() and p.name not in (*PLATFORMS, 'direct')]
    if legacy and not platform:
        try:
            with ExitStack() as stack:
                for lock in sorted((root / 'locks').glob('*.lock')):
                    base = lock.with_suffix('')
                    for suffix in ('.recovery', '.lock', '.worker'):
                        stack.enter_context(FileLock(str(base) + suffix, timeout=0))
                    check_owner(base)
                for directory in legacy:
                    request = directory / 'request.json'
                    if request.exists() and alive(json.loads(request.read_text())['supervisor']):
                        result['skipped'] += 1
                        continue
                    shutil.rmtree(directory)
                    result['deleted'] += 1
        except (Timeout, OSError, ValueError, KeyError):
            result['skipped'] += len(legacy)
    return result
