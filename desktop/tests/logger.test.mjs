import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { StudioLogger, attachRendererLogs } from '../logging/logger.mjs'
import { redact } from '../logging/redact.mjs'

function fixture(t, options) {
  const directory = mkdtempSync(path.join(tmpdir(), 'studio-logs-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return new StudioLogger(directory, options)
}
const entries = (logger) =>
  readFileSync(logger.file(), 'utf8').trim().split('\n').map(JSON.parse)

test('redacts nested secrets, error causes, URLs and personal data without changing input', () => {
  const input = {
    headers: { Cookie: 'cookie-value' },
    token: 'nested-token',
    query: 'private-search',
    nested: { password: 'pass-value' },
    error: new Error(
      'Cookie: SID=cookie-secret; other=second-secret\nAuthorization: Bearer auth-secret\naccess_token="token-secret"\nhttps://user:password@example.com/path?q=query-secret#hash-secret\nmail@example.org 13812345678 ' +
        homedir(),
      { cause: new Error('secret=hidden-cause') },
    ),
  }
  input.loop = input
  const output = JSON.stringify(redact(input))
  for (const secret of [
    'cookie-value',
    'nested-token',
    'private-search',
    'pass-value',
    'cookie-secret',
    'second-secret',
    'auth-secret',
    'token-secret',
    'query-secret',
    'hash-secret',
    'user:password',
    'mail@example.org',
    '13812345678',
    homedir(),
    'hidden-cause',
  ])
    assert.ok(!output.includes(secret), secret)
  assert.ok(output.includes('https://example.com/path'))
  assert.ok(output.includes('Error'))
  assert.ok(output.includes('[circular]'))
  assert.equal(input.token, 'nested-token')
  assert.equal(
    redact({
      get value() {
        throw new Error('should not run')
      },
    }).value,
    '[accessor]',
  )
})

test('rotation bounds total disk use, preserves recent entries and survives restart', (t) => {
  const logger = fixture(t, { maxBytes: 1024, maxFiles: 5, maxPerMinute: 1000 })
  for (let i = 0; i < 70; i++)
    logger.write('error', 'test', 'event', { i, message: '界'.repeat(70) })
  const files = readdirSync(logger.directory)
  assert.equal(files.length, 5)
  for (const file of files) {
    const target = path.join(logger.directory, file)
    assert.ok(statSync(target).size <= 1024)
    if (process.platform !== 'win32')
      assert.equal(statSync(target).mode & 0o777, 0o600)
    readFileSync(target, 'utf8')
      .trim()
      .split('\n')
      .forEach((line) => JSON.parse(line))
  }
  assert.equal(entries(logger).at(-1).detail.i, 69)
  const restarted = new StudioLogger(logger.directory, {
    maxBytes: 1024,
    maxFiles: 5,
  })
  restarted.write('info', 'test', 'restart')
  assert.equal(entries(logger).at(-1).event, 'restart')
})

test('oversized entries and repeated errors stay bounded; disk failure does not throw', (t) => {
  const logger = fixture(t, { maxBytes: 1024, maxFiles: 1, maxPerMinute: 2 })
  logger.write('error', 'test', 'huge', { message: 'x'.repeat(100000) })
  assert.equal(entries(logger)[0].detail.truncated, true)
  logger.write('error', 'test', 'second')
  logger.write('error', 'test', 'dropped')
  assert.equal(entries(logger).length, 2)
  logger.window = 0
  logger.write('info', 'test', 'next-minute')
  assert.ok(
    entries(logger).some(
      (entry) => entry.event === 'rate-limited' && entry.detail.count === 1,
    ),
  )
  const blocker = path.join(logger.directory, 'file')
  writeFileSync(blocker, 'block directory')
  const broken = new StudioLogger(blocker)
  assert.doesNotThrow(() => broken.write('error', 'test', 'disk'))
  assert.ok(broken.warned)
})

test('renderer captures application failures and excludes third-party frames', (t) => {
  const logger = fixture(t)
  const contents = new EventEmitter()
  contents.mainFrame = {}
  attachRendererLogs(contents, logger)
  contents.emit('console-message', {
    frame: {},
    level: 'error',
    message: 'third-party',
  })
  contents.emit('console-message', {
    frame: contents.mainFrame,
    level: 'info',
    message: 'ignored',
  })
  contents.emit('console-message', {
    frame: contents.mainFrame,
    level: 'error',
    message: 'token=renderer-secret',
    sourceId: 'http://localhost/main.ts?t=private',
    lineNumber: 42,
  })
  contents.emit('did-fail-load', {}, -3, 'aborted', '', true)
  contents.emit('did-fail-load', {}, -105, 'failed', '', true)
  contents.emit('preload-error', {}, '/unused', new Error('preload failed'))
  contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  assert.equal(entries(logger).length, 4)
  assert.ok(!readFileSync(logger.file(), 'utf8').includes('renderer-secret'))
  assert.equal(entries(logger)[0].detail.line, 42)
})
