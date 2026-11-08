import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import psutil
from filelock import FileLock, Timeout
from mediacrawler_cli.state import paths, atomic_json, identity, alive, stop
from mediacrawler_cli.cleanup import clean, prune, KEEP_RUNS


class CLIError(Exception):
    def __init__(self, code, run_id=None, candidates=None, retry_after=None):
        self.code, self.run_id, self.candidates, self.retry_after = code, run_id, candidates or [], retry_after
        super().__init__(code)


def recover_locked(base):
    owner_path = base.with_suffix('.json')
    if not owner_path.exists():
        return
    try:
        owner = json.loads(owner_path.read_text())
        if alive(owner['supervisor']):
            raise CLIError('PROFILE_BUSY')
        stop(owner.get('processes', []))
        owner_path.unlink(missing_ok=True)
    except CLIError:
        raise
    except Exception:
        raise CLIError('RECOVERY_REQUIRED') from None


def recover(data_dir, platform, profile, lock_timeout=0):
    _, _, base = paths(data_dir, platform, profile)
    try:
        with FileLock(str(base) + '.recovery', timeout=lock_timeout):
            with FileLock(str(base) + '.lock', timeout=lock_timeout):
                recover_locked(base)
                with FileLock(str(base) + '.worker', timeout=0):
                    pass
    except Timeout:
        raise CLIError('PROFILE_BUSY') from None


def run(request):
    root, profile, base = paths(request.pop('data_dir'), request['platform'], request.pop('profile'))
    run_id = time.strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:8]
    clean(root, keep=KEEP_RUNS)
    run_dir = root / 'runs' / request['platform'] / profile.name / run_id
    request.update(run_dir=str(run_dir), profile_dir=str(profile), supervisor=identity(os.getpid()), worker_lock=str(base) + '.worker')
    lock = FileLock(str(base) + '.lock', timeout=request['lock_timeout'])
    try:
        with FileLock(str(base) + '.recovery', timeout=request['lock_timeout']):
            lock.acquire()
            recover_locked(base)
            with FileLock(str(base) + '.worker', timeout=0):
                pass
    except Timeout:
        if lock.is_locked:
            lock.release()
        raise CLIError('PROFILE_BUSY', run_id) from None
    except BaseException:
        if lock.is_locked:
            lock.release()
        raise
    run_created = False
    process = None
    records = []
    page = {'next_cursor': None, 'has_more': False}
    items = {}
    complete = False
    partial = False
    error = None
    destination = request.get('output_dir')
    destination_created = False
    if request.get('save') and not destination:
        destination = str(Path.home() / 'Downloads' / 'MediaCrawler' / run_id)
    try:
        if (root / 'runs').is_symlink() or run_dir.parent.parent.is_symlink() or run_dir.parent.is_symlink():
            raise ValueError('工作目录不能是符号链接')
        run_dir.mkdir(parents=True, mode=0o700)
        run_created = True
        if destination:
            destination = Path(destination).expanduser().resolve() / run_id if request.get('output_dir') else Path(destination)
            destination.mkdir(parents=True, exist_ok=False)
            destination_created = True
        if request['action'] == 'download':
            request['download_dir'] = str(destination)
        profile.mkdir(parents=True, exist_ok=True, mode=0o700)
        request_path = run_dir / 'request.json'
        atomic_json(request_path, request)
        command = [sys.executable] if getattr(sys, 'frozen', False) else [sys.executable, '-m', 'mediacrawler_cli']
        process = subprocess.Popen(command + ['_worker', str(request_path)], stdout=subprocess.PIPE, text=True, start_new_session=True)
        parent = psutil.Process(process.pid)
        events = queue.Queue()
        def read():
            for line in process.stdout:
                try:
                    events.put(json.loads(line))
                except ValueError:
                    pass
        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        deadline = time.monotonic() + request['timeout']
        last_tick = time.monotonic()
        grace = last_tick + 180
        while True:
            now = time.monotonic()
            if now - last_tick > 20:  # 系统休眠恢复，给事件循环一次重新写心跳的机会
                grace = now + 60
            last_tick = now
            if now > deadline:
                raise CLIError('TASK_TIMEOUT', run_id)
            try:
                descendants = parent.children(recursive=True)
                changed = False
                known = {(r['pid'], r['created']) for r in records}
                for p in [parent, *descendants]:
                    record = identity(p.pid)
                    if (record['pid'], record['created']) not in known:
                        records.append(record)
                        changed = True
                if changed:
                    atomic_json(base.with_suffix('.json'), {'supervisor': identity(os.getpid()), 'processes': records, 'run_id': run_id})
            except psutil.NoSuchProcess:
                pass
            heartbeat = run_dir / 'heartbeat.json'
            if now > grace and (not heartbeat.exists() or time.time() - json.loads(heartbeat.read_text())['time'] > 60):
                raise CLIError('WORKER_UNRESPONSIVE', run_id)
            try:
                event = events.get(timeout=0.2)
                if event['type'] == 'initialized':
                    grace = now + 60
                elif event['type'] in ('item', 'item-update'):
                    items[event['item']['id']] = event['item']
                elif event['type'] == 'complete':
                    items = {str(i): value for i, value in enumerate(event['items'])}
                    complete = True
                elif event['type'] == 'warning':
                    partial = True
                elif event['type'] == 'page':
                    page.update(next_cursor=event.get('next_cursor'), has_more=event.get('has_more') is True)
                elif event['type'] == 'creator':
                    page['creator'] = event.get('creator')
                elif event['type'] == 'download-progress':
                    if request.get('verbose'):
                        print(json.dumps(event), file=sys.stderr)
                elif event['type'] == 'diagnostic' and request.get('verbose'):
                    print(json.dumps(event, ensure_ascii=False), file=sys.stderr)
                elif event['type'] == 'state':
                    print(event.get('message', ''), file=sys.stderr)
                elif event['type'] == 'failure':
                    raise CLIError(event['code'], run_id, event.get('candidates'), event.get('retry_after'))
            except queue.Empty:
                if process.poll() is not None and not reader.is_alive():
                    break
        if partial:
            raise CLIError('PARTIAL_RESULT', run_id)
        if not complete or process.returncode:
            raise CLIError('WORKER_FAILED', run_id)
        if request['action'] == 'check' and any(item.get('status') != 'ok' for item in items.values()):
            raise CLIError('CHECK_FAILED', run_id)
    except KeyboardInterrupt:
        error = CLIError('CANCELLED', run_id)
    except CLIError as exc:
        error = exc
    except OSError:
        error = CLIError('OUTPUT_ERROR' if destination and not destination_created else 'STORAGE_ERROR', run_id)
    except Exception:
        error = CLIError('RUNTIME_ERROR', run_id)
    finally:
        try:
            stop(list(reversed(records)))
            if process:
                process.wait(timeout=5)
            base.with_suffix('.json').unlink(missing_ok=True)
            if complete and request['action'] == 'logout':
                shutil.rmtree(profile)
                for item in items.values():
                    item['localCleared'] = True
                if any(item.get('remote') == 'not_confirmed' for item in items.values()):
                    error = CLIError('REMOTE_LOGOUT_UNCONFIRMED', run_id)
        except Exception:
            error = CLIError('RECOVERY_REQUIRED', run_id)
        try:
            # 文件失败不能覆盖原任务错误，也不能阻止 stdout 交付已有结果
            if destination_created:
                try:
                    (destination / 'results.jsonl').write_text(''.join(json.dumps(item, ensure_ascii=False) + '\n' for item in items.values()), encoding='utf-8')
                except OSError:
                    error = error or CLIError('OUTPUT_ERROR', run_id)
            metadata = {'run_id': run_id, 'complete': complete and error is None, 'count': len(items), 'error': error.code if error else None}
            if run_created:
                try:
                    atomic_json(run_dir / 'run.json', metadata)
                    if not error or error.code != 'RECOVERY_REQUIRED':
                        prune(run_dir.parent, KEEP_RUNS)
                except OSError:
                    error = error or CLIError('STORAGE_ERROR', run_id)
            if destination_created:
                try:
                    metadata.update(complete=complete and error is None, error=error.code if error else None)
                    atomic_json(destination / 'run.json', metadata)
                except OSError:
                    error = error or CLIError('OUTPUT_ERROR', run_id)
        finally:
            lock.release()
    values = list(items.values())
    # 博主和分页搜索需要分页位置；失败时也输出，已取结果可从该位置继续
    paged = request['action'] == 'creator-search' or request.get('mode') == 'creator' or request.get('paged') is True
    summary = {'type': 'page', **page, 'count': len(values), 'complete': error is None}
    if request['format'] == 'json':
        print(json.dumps({'items': values, 'page': summary} if paged else values, ensure_ascii=False))
    else:
        for item in values:
            print(json.dumps(item, ensure_ascii=False))
        if paged:
            print(json.dumps(summary, ensure_ascii=False))
    if error:
        raise error
    return values
