import json

from typer.testing import CliRunner

from mediacrawler_cli.__main__ import app
from mediacrawler_cli.runtime import CLIError, run
from tests.cli.test_cli import fake_worker, request

import pytest


def worker(*events):
    lines = ';'.join(f'print(json.dumps({event!r}))' for event in events)
    return f'import json;{lines}'


def test_failure_reports_retry_after(tmp_path, monkeypatch):
    fake_worker(monkeypatch, worker({'type': 'failure', 'code': 'RATE_LIMITED', 'retry_after': 42}))
    with pytest.raises(CLIError) as error:
        run(request(tmp_path, mode='search'))
    assert error.value.retry_after == 42


def test_cli_validates_creator_options():
    runner = CliRunner()
    assert runner.invoke(app, ['creator', 'search', '--query', 'a', '--platform', 'wb']).exit_code == 2
    assert runner.invoke(app, ['creator', 'search', '--query', '  ']).exit_code == 2
    assert runner.invoke(app, ['creator', 'search', '--query', 'a', '--limit', '51']).exit_code == 2
    assert runner.invoke(app, ['creator', 'posts']).exit_code == 2
    assert runner.invoke(app, ['creator', 'posts', '--creator', 'a', '--limit', '101']).exit_code == 2
    assert runner.invoke(app, ['creator', 'posts', '--creator', 'a', '--quality', 'high']).exit_code == 2


def test_cli_validates_search_options():
    runner = CliRunner()
    assert runner.invoke(app, ['search']).exit_code == 2
    assert runner.invoke(app, ['search', '--query', '  ']).exit_code == 2
    assert runner.invoke(app, ['search', '--query', 'a', '--platform', 'zhihu']).exit_code == 2
    assert runner.invoke(app, ['search', '--query', 'a', '--limit', '101']).exit_code == 2


def test_paged_search_ends_with_page_and_collect_stays_plain(tmp_path, monkeypatch, capsys):
    item = {'id': 'a', 'title': '作品'}
    fake_worker(monkeypatch, worker({'type': 'page', 'next_cursor': 'next', 'has_more': True}, {'type': 'complete', 'items': [item]}))
    run(request(tmp_path, mode='search', paged=True))
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert lines[-1]['next_cursor'] == 'next'
    run(request(tmp_path, mode='search'))
    assert [json.loads(line) for line in capsys.readouterr().out.splitlines()] == [item]


def test_jsonl_ends_with_page(tmp_path, monkeypatch, capsys):
    item = {'id': 'a', 'name': '博主'}
    fake_worker(monkeypatch, worker({'type': 'page', 'next_cursor': 'next', 'has_more': True}, {'type': 'complete', 'items': [item]}))
    value = request(tmp_path, mode='search')
    value['action'] = 'creator-search'
    run(value)
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert lines == [item, {'type': 'page', 'next_cursor': 'next', 'has_more': True, 'count': 1, 'complete': True}]


def test_json_envelope_keeps_collect_format_unchanged(tmp_path, monkeypatch, capsys):
    item = {'id': 'a'}
    creator = {'id': 'c', 'name': '博主'}
    fake_worker(monkeypatch, worker({'type': 'creator', 'creator': creator}, {'type': 'page', 'next_cursor': None, 'has_more': False}, {'type': 'complete', 'items': [item]}))
    value = request(tmp_path, mode='creator')
    value['format'] = 'json'
    run(value)
    output = json.loads(capsys.readouterr().out)
    assert output['items'] == [item]
    assert output['page'] == {'type': 'page', 'next_cursor': None, 'has_more': False, 'creator': creator, 'count': 1, 'complete': True}
    fake_worker(monkeypatch, worker({'type': 'complete', 'items': [item]}))
    value = request(tmp_path / 'other', mode='search')
    value['format'] = 'json'
    run(value)
    assert json.loads(capsys.readouterr().out) == [item]


def test_failure_keeps_items_cursor_and_candidates(tmp_path, monkeypatch, capsys):
    fake_worker(monkeypatch, worker(
        {'type': 'item', 'item': {'id': 'a'}}, {'type': 'page', 'next_cursor': 'resume', 'has_more': True},
        {'type': 'failure', 'code': 'CREATOR_AMBIGUOUS', 'candidates': [{'id': 'x'}]},
    ))
    with pytest.raises(CLIError) as error:
        run(request(tmp_path, mode='creator'))
    assert error.value.code == 'CREATOR_AMBIGUOUS' and error.value.candidates == [{'id': 'x'}]
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert lines[-1]['next_cursor'] == 'resume' and lines[-1]['complete'] is False and lines[0] == {'id': 'a'}
