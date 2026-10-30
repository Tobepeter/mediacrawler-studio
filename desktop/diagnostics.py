"""异常诊断白名单：不采集异常原文、代码行、局部变量或请求响应"""
import traceback
from pathlib import Path


def exception_detail(error):
    return {
        'name': type(error).__name__,
        'frames': [
            {'file': Path(frame.filename).name, 'line': frame.lineno, 'function': frame.name}
            for frame in traceback.extract_tb(error.__traceback__)[-20:]
        ],
    }
