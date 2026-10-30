import hashlib
import json
import os
import re
from pathlib import Path

import psutil
from platformdirs import user_data_path

PLATFORMS = ('xhs', 'bili', 'dy', 'zhihu', 'wb', 'tieba', 'ks')


def paths(data_dir, platform, profile):
    if platform not in (*PLATFORMS, 'direct') or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', profile):
        raise ValueError('平台或 profile 无效')
    root = Path(data_dir or os.environ.get('MEDIACRAWLER_DATA_DIR') or user_data_path('mediacrawler', appauthor=False)).expanduser().resolve()
    directory = (root / 'profiles' / platform / profile).resolve()
    key = hashlib.sha256(str(directory).encode()).hexdigest()
    locks = root / 'locks'
    locks.mkdir(parents=True, exist_ok=True, mode=0o700)
    return root, directory, locks / key


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    temporary.chmod(0o600)
    temporary.replace(path)


def identity(pid):
    process = psutil.Process(pid)
    return {'pid': pid, 'created': process.create_time()}


def alive(record):
    try:
        p = psutil.Process(record['pid'])
        return p.create_time() == record['created'] and p.status() != psutil.STATUS_ZOMBIE
    except (psutil.NoSuchProcess, KeyError):
        return False


def stop(records):
    processes = []
    for record in records:
        if alive(record):
            try:
                p = psutil.Process(record['pid'])
                p.terminate()
                processes.append(p)
            except psutil.NoSuchProcess:
                pass
    _, remaining = psutil.wait_procs(processes, timeout=5)
    for p in remaining:
        try:
            p.kill()
        except psutil.NoSuchProcess:
            pass
    _, remaining = psutil.wait_procs(remaining, timeout=5)
    if remaining:
        raise RuntimeError('RECOVERY_REQUIRED')
