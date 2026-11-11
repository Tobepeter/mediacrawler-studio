"""桌面内部 worker 入口：打包后由 mediacrawler 运行时的 -u -m <worker> 转进来，只认这几个 worker"""
import os
from pathlib import Path
import runpy
import sys

WORKERS = ('desktop.worker', 'desktop.download_worker', 'desktop.health_worker')


def main():
    if sys.argv[1:3] != ['-u', '-m'] or len(sys.argv) != 4 or sys.argv[3] not in WORKERS:
        raise SystemExit('仅支持桌面内部 worker')
    root = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
    if getattr(sys, 'frozen', False):
        os.environ['PATH'] = str(root / 'bin') + os.pathsep + os.environ.get('PATH', '')
    os.chdir(root)
    runpy.run_module(sys.argv[3], run_name='__main__')


if __name__ == '__main__':
    main()
