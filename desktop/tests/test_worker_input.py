"""协议损坏仍返回结构化失败，不在错误处理分支二次崩溃"""
import json
import subprocess
import sys

import pytest


@pytest.mark.parametrize('payload', ['', '{broken', 'null', '[]'])
def test_malformed_request_has_terminal_error(payload):
    result = subprocess.run([sys.executable, '-m', 'desktop.worker'], input=payload,
                            text=True, capture_output=True, timeout=10)
    assert result.returncode == 1
    events = [json.loads(line) for line in result.stdout.splitlines()]
    assert events[-1]['type'] == 'error'
    assert events[-1]['failure']['code'] == 'UNKNOWN'
    assert 'UnboundLocalError' not in result.stderr
