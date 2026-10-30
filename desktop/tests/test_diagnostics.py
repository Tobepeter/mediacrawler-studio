from desktop.diagnostics import exception_detail


def test_exception_diagnostic_omits_message_source_and_locals():
    secret = 'private-cookie-value'
    try:
        raise RuntimeError(f'Cookie: {secret}; response=private-body')
    except RuntimeError as error:
        detail = exception_detail(error)
    assert detail['name'] == 'RuntimeError'
    assert detail['frames'][-1]['file'] == 'test_diagnostics.py'
    assert detail['frames'][-1]['line'] > 0
    assert secret not in str(detail)
    assert 'private-body' not in str(detail)
    assert set(detail['frames'][-1]) == {'file', 'line', 'function'}
