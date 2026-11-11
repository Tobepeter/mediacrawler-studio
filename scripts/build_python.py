"""构建 Python 运行时：独立 CLI 和桌面端共用这一份，桌面通过隐藏参数启动内部 worker"""
import argparse
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
NAME = 'mediacrawler'


def build(clean=False):
    node = shutil.which('node')
    if not node:
        raise SystemExit('签名运行时需要 Node，请先安装 Node')
    args = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--onedir',
            '--name', NAME, '--distpath', 'dist/cli', '--workpath', 'build/cli',
            '--specpath', 'build', '--paths', str(ROOT), '--add-binary', f'{Path(node).resolve()}:bin',
            '--add-data', f'{ROOT / "libs"}:libs',
            '--add-data', f'{ROOT / "media_platform/kuaishou/graphql"}:media_platform/kuaishou/graphql',
            '--add-data', f'{ROOT / "LICENSE"}:.',
            '--add-data', f'{ROOT / "docs/skill.md"}:docs',
            '--add-data', f'{ROOT / "desktop/health-policy.json"}:desktop',
            '--add-data', f'{ROOT / "desktop/search-options.json"}:desktop',
            '--add-data', f'{ROOT / "desktop/platform-capabilities.json"}:desktop']
    for module in ['desktop', 'media_platform', 'store', 'config', 'model', 'tools',
                   'database', 'proxy', 'cache', 'base', 'constant', 'mediacrawler_cli']:
        args.extend(['--collect-submodules', module])
    args.extend(['--exclude-module', 'pytest', '--exclude-module', 'desktop.tests'])
    # OCR 可拆：环境里装了才收进包（模型、配置、按配置加载的推理后端），没装就打一个不带 OCR 的包
    if ocr_available():
        args.extend(['--collect-data', 'rapidocr', '--collect-submodules', 'rapidocr'])
    else:
        print('没有 rapidocr，这次打包不带 OCR')
    if clean:
        args.append('--clean')
    args.append('mediacrawler_cli/__main__.py')
    subprocess.run(args, cwd=ROOT, check=True)


def ocr_available():
    return all(importlib.util.find_spec(name) for name in ('rapidocr', 'onnxruntime'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clean', action='store_true')
    build(parser.parse_args().clean)
