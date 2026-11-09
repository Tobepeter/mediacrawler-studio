import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { acquireInstance } from '../single-instance.mjs'

const fakeApp = (answers) => {
  const calls = []
  return {
    calls,
    requestSingleInstanceLock: (data) => {
      calls.push(data)
      return answers.shift()
    },
  }
}

async function lockFile(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-lock-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return path.join(dir, 'SingletonLock')
}

test('空闲时直接拿到锁，不提示等待', async (t) => {
  const app = fakeApp([true])
  let waited = false
  const result = acquireInstance(app, {
    build: 'dev',
    lockFile: await lockFile(t),
    onWaiting: () => (waited = true),
  })
  assert.equal(result, 'owner')
  assert.equal(waited, false)
  assert.deepEqual(app.calls, [{ build: 'dev' }])
})

test('对方退出后返回 released，等待期间只通知一次', async (t) => {
  const file = await lockFile(t)
  await writeFile(file, '')
  const app = fakeApp([false])
  let turns = 0
  const result = acquireInstance(app, {
    build: 'dev',
    lockFile: file,
    sleep: () => {
      turns += 1
      if (turns === 3) rmSync(file)
    },
  })
  assert.equal(result, 'released')
  assert.equal(turns, 3)
  assert.equal(app.calls.length, 1)
})

test('一直没等到就放弃', async (t) => {
  const file = await lockFile(t)
  await writeFile(file, '')
  const app = fakeApp([false])
  let clock = 0
  const result = acquireInstance(app, {
    build: 'packaged',
    lockFile: file,
    timeoutMs: 1000,
    intervalMs: 250,
    now: () => clock,
    sleep: (ms) => (clock += ms),
  })
  assert.equal(result, 'busy')
  assert.equal(app.calls.length, 1)
})

test('不等待时通知完立即返回 busy', async (t) => {
  const file = await lockFile(t)
  await writeFile(file, '')
  const app = fakeApp([false])
  let slept = false
  const result = acquireInstance(app, {
    build: 'packaged',
    lockFile: file,
    wait: false,
    sleep: () => (slept = true),
  })
  assert.equal(result, 'busy')
  assert.equal(slept, false)
  assert.deepEqual(app.calls, [{ build: 'packaged' }])
})
