"""共用 Python 打包配置，分别生成 CLI 和桌面内部运行时"""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    'cli': ('mediacrawler', 'mediacrawler_cli/__main__.py'),
    'desktop': ('studio-python', 'desktop/python_entry.py'),
}


def build(target, clean=False):
    name, entry = TARGETS[target]
    node = shutil.which('node')
    if not node:
        raise SystemExit('签名运行时需要 Node，请先安装 Node')
    output = 'cli' if target == 'cli' else 'runtime'
    args = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--onedir',
            '--name', name, '--distpath', f'dist/{output}', '--workpath', f'build/{output}',
            '--specpath', 'build', '--paths', str(ROOT), '--add-binary', f'{Path(node).resolve()}:bin',
            '--add-data', f'{ROOT / "libs"}:libs',
            '--add-data', f'{ROOT / "media_platform/kuaishou/graphql"}:media_platform/kuaishou/graphql',
            '--add-data', f'{ROOT / "LICENSE"}:.',
            '--add-data', f'{ROOT / "desktop/health-policy.json"}:desktop',
            '--add-data', f'{ROOT / "desktop/search-options.json"}:desktop',
            '--add-data', f'{ROOT / "desktop/platform-capabilities.json"}:desktop']
    modules = ['desktop', 'media_platform', 'store', 'config', 'model', 'tools',
               'database', 'proxy', 'cache', 'base', 'constant']
    if target == 'cli':
        modules.append('mediacrawler_cli')
    else:
        args.extend(['--exclude-module', 'mediacrawler_cli'])
    for module in modules:
        args.extend(['--collect-submodules', module])
    args.extend(['--exclude-module', 'pytest', '--exclude-module', 'desktop.tests'])
    # OCR 在进程内调库：模型、配置和按配置动态加载的推理后端都要收进包，首次使用不用联网下载
    args.extend(['--collect-data', 'rapidocr', '--collect-submodules', 'rapidocr'])
    if clean:
        args.append('--clean')
    args.append(entry)
    subprocess.run(args, cwd=ROOT, check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=TARGETS)
    parser.add_argument('--clean', action='store_true')
    options = parser.parse_args()
    build(options.target, options.clean)
