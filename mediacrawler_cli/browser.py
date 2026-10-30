"""优先独立 Chromium，缺失时可复用已安装 Chrome 的程序，始终使用 CLI profile"""
import os
from pathlib import Path
import sys


def options(playwright):
    override = os.environ.get('MEDIACRAWLER_BROWSER_EXECUTABLE')
    if override:
        return {'executable_path': str(Path(override).expanduser())}
    if Path(playwright.chromium.executable_path).exists():
        return {'channel': 'chromium'}
    candidates = {
        'darwin': ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
        'linux': ['/usr/bin/google-chrome', '/usr/bin/chromium'],
        'win32': [str(Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe')],
    }
    for path in candidates.get(sys.platform, []):
        if Path(path).exists():
            return {'executable_path': path}
    return {'channel': 'chromium'}
