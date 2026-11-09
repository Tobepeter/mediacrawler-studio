import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { SessionManager } from '../session-manager.mjs'

const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture() {
  const visited = [],
    children = [],
    captures = []
  const state = {
    accounts: { bili: 'saved' },
    profiles: {},
    task: null,
    busy: false,
  }
  const service = {
    state,
    root: process.cwd(),
    endpoint: 'unused',
    publish() {},
    windows: {
      prepare: async (id) => {
        visited.push(id)
        return id
      },
      flush: async () => {},
      captureBackgroundQr: async (id, refresh) => {
        captures.push([id, refresh])
        return { image: `data:image/png;base64,${id}` }
      },
    },
  }
  const manager = new SessionManager(service, () => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {
      queueMicrotask(() => child.emit('close', 0))
    }
    child.emitEvent = (event) =>
      child.stdout.write(JSON.stringify(event) + '\n')
    children.push(child)
    return child
  })
  return { service, manager, state, visited, children, captures }
}

test('三级启动独立计时，提前选中跳过排队，重复点击不重启，不占用采集状态', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  f.manager.start()
  f.manager.start()
  await tick()
  assert.deepEqual(f.visited, ['bili'])
  f.manager.ensure('ks')
  f.manager.ensure('ks')
  await tick()
  assert.deepEqual(f.visited, ['bili', 'ks'])
  t.mock.timers.tick(1500)
  await tick()
  assert.deepEqual(f.visited, ['bili', 'ks', 'dy', 'xhs'])
  t.mock.timers.tick(2500)
  await tick()
  assert.equal(new Set(f.visited).size, 7)
  assert.equal(f.visited.length, 7)
  assert.equal(f.state.task, null)
  assert.equal(f.state.busy, false)
  await f.manager.stopAll(true)
})

test('不同平台并行取码，切页复用；扫码恢复账号，停止只影响该平台，迟到结果丢弃', async () => {
  const f = fixture()
  f.manager.ensure('bili')
  f.manager.ensure('dy')
  await tick()
  let resolveBili
  f.service.windows.captureBackgroundQr = async (id) =>
    id === 'bili'
      ? new Promise((resolve) => {
          resolveBili = resolve
        })
      : { image: 'dy-image' }
  f.children[0].emitEvent({ type: 'state', status: 'auth' })
  f.children[1].emitEvent({ type: 'state', status: 'auth' })
  await tick()
  assert.equal(f.state.logins.dy.status, 'ready')
  assert.equal(f.state.logins.bili.status, 'preparing')
  const oldId = f.state.logins.dy.id
  f.manager.ensure('dy')
  await tick()
  assert.equal(f.children.length, 2)
  assert.equal(f.state.logins.dy.id, oldId)
  await f.manager.stop('bili')
  resolveBili({ image: 'stale' })
  await tick()
  assert.equal(f.state.logins.bili.status, 'paused')
  assert.equal(f.state.logins.bili.image, undefined)
  f.children[0].emitEvent({ type: 'account', profile: { nickname: 'late' } })
  f.children[1].emitEvent({ type: 'account', profile: { nickname: 'valid' } })
  await tick()
  assert.equal(f.state.accounts.bili, 'saved')
  assert.equal(f.state.accounts.dy, 'connected')
  assert.equal(f.state.logins.dy.image, undefined)
  await f.manager.stopAll(true)
})

async function waitForQr(f, index) {
  await tick()
  f.children[index].emitEvent({ type: 'state', status: 'auth' })
  await tick()
}

function scanTimeout(f, index) {
  f.children[index].emitEvent({
    type: 'error',
    failure: { code: 'TIMEOUT', stage: 'login' },
  })
}

test('用户看着二维码时等待到期自动换码，无人操作换两次后停下', async () => {
  const f = fixture()
  f.manager.setForeground('bili')
  f.manager.ensure('bili')
  await waitForQr(f, 0)
  for (let index = 0; index < 2; index++) {
    scanTimeout(f, index)
    await tick()
    await tick()
    assert.equal(f.children.length, index + 2)
    await waitForQr(f, index + 1)
    assert.equal(f.state.logins.bili.status, 'ready')
  }
  scanTimeout(f, 2)
  await tick()
  await tick()
  assert.equal(f.children.length, 3)
  assert.equal(f.state.logins.bili.status, 'expired')
  // 手动刷新要重载后台页取新码，并重新计数
  f.captures.length = 0
  await f.manager.retry('bili')
  await waitForQr(f, 3)
  assert.deepEqual(f.captures[0], ['bili', true])
  scanTimeout(f, 3)
  await tick()
  await tick()
  assert.equal(f.children.length, 5)
  await f.manager.stopAll(true)
})

test('常规刷新不重启进程，旧码留到新码就绪；失败自动走完整流程', async () => {
  const f = fixture()
  f.manager.ensure('bili')
  await waitForQr(f, 0)
  const calls = []
  let release
  f.service.windows.captureBackgroundQr = async (
    _id,
    refresh,
    _active,
    options,
  ) => {
    calls.push({ refresh, passive: options.passive })
    await new Promise((resolve) => (release = resolve))
    return { image: 'data:image/png;base64,new' }
  }
  f.manager.refresh('bili')
  f.manager.refresh('bili')
  await tick()
  assert.deepEqual(calls, [{ refresh: true, passive: false }])
  assert.equal(f.state.logins.bili.refreshing, true)
  assert.equal(f.state.logins.bili.image, 'data:image/png;base64,bili')
  release()
  await tick()
  assert.equal(f.state.logins.bili.refreshing, undefined)
  assert.equal(f.state.logins.bili.image, 'data:image/png;base64,new')
  assert.equal(f.children.length, 1)

  f.service.windows.captureBackgroundQr = async () => ({ code: 'unavailable' })
  f.manager.refresh('bili')
  await tick()
  await tick()
  assert.equal(f.children.length, 2)
  assert.equal(f.state.logins.bili.status, 'preparing')
  assert.equal(f.state.logins.bili.failure, undefined)
  await f.manager.stopAll(true)
})

test('没有可用二维码时常规刷新直接走完整流程', async () => {
  const f = fixture()
  f.manager.ensure('bili')
  await waitForQr(f, 0)
  scanTimeout(f, 0)
  await tick()
  await tick()
  assert.equal(f.state.logins.bili.status, 'expired')
  await f.manager.refresh('bili')
  await tick()
  assert.equal(f.children.length, 2)
  await f.manager.stopAll(true)
})

test('自动换码停下后窗口重新获得焦点会再换码，其他状态不动', async () => {
  const f = fixture()
  f.manager.setForeground('bili')
  f.manager.ensure('bili')
  await waitForQr(f, 0)
  f.manager.wake()
  await tick()
  assert.equal(f.children.length, 1)
  for (let index = 0; index < 3; index++) {
    scanTimeout(f, index)
    await tick()
    await tick()
    if (index < 2) await waitForQr(f, index + 1)
  }
  assert.equal(f.state.logins.bili.status, 'expired')
  assert.equal(f.children.length, 3)
  f.manager.wake()
  await tick()
  await tick()
  assert.equal(f.children.length, 4)
  await f.manager.stopAll(true)
})

test('后台到期不换码，切回平台时才换；手机确认中到期不打断', async () => {
  const f = fixture()
  f.manager.ensure('bili')
  await waitForQr(f, 0)
  scanTimeout(f, 0)
  await tick()
  await tick()
  assert.equal(f.children.length, 1)
  assert.equal(f.state.logins.bili.status, 'expired')
  f.manager.setForeground('bili')
  await tick()
  await tick()
  assert.equal(f.children.length, 2)
  f.service.windows.captureBackgroundQr = async () => ({ code: 'confirming' })
  await waitForQr(f, 1)
  assert.equal(f.state.logins.bili.status, 'confirming')
  scanTimeout(f, 1)
  await tick()
  await tick()
  assert.equal(f.children.length, 2)
  assert.equal(f.state.logins.bili.status, 'expired')
  await f.manager.stopAll(true)
})

test('准备超时也能释放，失败不自动循环；取码后扫码超时只标记过期', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  f.service.windows.prepare = () => new Promise(() => {})
  f.manager.ensure('bili')
  await tick()
  t.mock.timers.tick(30000)
  await tick()
  assert.equal(f.state.logins.bili.failure.code, 'TIMEOUT')
  assert.equal(f.manager.jobs.size, 0)
  f.manager.ensure('bili')
  assert.equal(f.manager.jobs.size, 0)
  f.service.windows.prepare = async () => 'target'
  await f.manager.retry('bili')
  await tick()
  f.children[0].emitEvent({ type: 'state', status: 'auth' })
  await tick()
  assert.equal(f.state.logins.bili.status, 'ready')
  t.mock.timers.tick(30000)
  await tick()
  assert.equal(f.state.logins.bili.status, 'ready')
  f.children[0].emitEvent({
    type: 'error',
    failure: { code: 'TIMEOUT', stage: 'scan' },
  })
  await tick()
  assert.equal(f.state.logins.bili.status, 'expired')
  assert.equal(f.state.logins.bili.failure, undefined)
  await f.manager.stopAll(true)
})

test('忙碌平台拒绝重试并保留状态；媒体任务按自己的平台隔离', async () => {
  const f = fixture()
  const login = { status: 'error', failure: { code: 'TIMEOUT' } }
  f.state.logins.dy = login
  f.state.working = { bili: 'collect', dy: 'video' }
  await assert.rejects(f.manager.retry('dy'), /任务进行中/)
  assert.equal(f.state.logins.dy, login)
  f.manager.ensure('dy')
  assert.equal(f.visited.length, 0)
  f.manager.ensure('xhs')
  await tick()
  assert.deepEqual(f.visited, ['xhs'])
  await f.manager.stopAll(true)
})

test('前台2秒后台60秒，切换仅调整读取频率，同图不重复推送', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const f = fixture()
  f.manager.setForeground('bili')
  f.manager.ensure('bili')
  f.manager.ensure('dy')
  await tick()
  for (const child of f.children)
    child.emitEvent({ type: 'state', status: 'auth' })
  await tick()
  let updates = 0
  f.service.publish = () => updates++
  const count = (p) => f.captures.filter(([platform]) => platform === p).length
  t.mock.timers.tick(2000)
  await tick()
  assert.equal(count('bili'), 2)
  assert.equal(count('dy'), 1)
  assert.equal(updates, 0)
  const id = f.state.logins.dy.id
  f.manager.setForeground('dy')
  await tick()
  assert.equal(count('dy'), 2)
  assert.equal(f.state.logins.dy.id, id)
  t.mock.timers.tick(2000)
  await tick()
  assert.equal(count('dy'), 3)
  assert.equal(count('bili'), 2)
  f.manager.setForeground(null)
  t.mock.timers.tick(2000)
  await tick()
  assert.equal(count('dy'), 3)
  t.mock.timers.tick(60000)
  await tick()
  assert.equal(count('dy'), 4)
  assert.equal(count('bili'), 3)
  assert.ok(f.captures.every(([, refresh]) => refresh === false))
  await f.manager.stopAll(true)
})

test('短暂读图失败保留扫码，过期刷新需复核；确认后停止换码等待账号', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const f = fixture()
  f.manager.setForeground('bili')
  f.manager.ensure('bili')
  await tick()
  f.children[0].emitEvent({ type: 'state', status: 'auth' })
  await tick()
  const oldImage = f.state.logins.bili.image
  f.service.windows.captureBackgroundQr = async (
    _platform,
    _refresh,
    _active,
    options,
  ) => {
    assert.equal(options.passive, true)
    return { code: 'unavailable' }
  }
  t.mock.timers.tick(2000)
  await tick()
  assert.equal(f.state.logins.bili.image, oldImage)
  assert.equal(f.state.logins.bili.status, 'ready')
  const modes = []
  f.service.windows.captureBackgroundQr = async (
    _platform,
    refresh,
    _active,
    options,
  ) => {
    modes.push({ refresh, options })
    return { code: refresh ? 'confirming' : 'expired' }
  }
  t.mock.timers.tick(2000)
  await tick()
  assert.equal(f.state.logins.bili.status, 'confirming')
  assert.deepEqual(modes, [
    { refresh: false, options: { passive: true } },
    { refresh: true, options: { expiredOnly: true } },
  ])
  t.mock.timers.tick(60000)
  await tick()
  assert.equal(modes.length, 2)
  f.children[0].emitEvent({ type: 'account', profile: { nickname: 'done' } })
  await tick()
  assert.equal(f.state.logins.bili.status, 'connected')
  assert.equal(f.state.logins.bili.image, undefined)
  await f.manager.stopAll(true)
})

test('确认过期后刷新失败停止自动循环，等待用户重试', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const f = fixture()
  f.manager.setForeground('bili')
  f.manager.ensure('bili')
  await tick()
  f.children[0].emitEvent({ type: 'state', status: 'auth' })
  await tick()
  let attempts = 0
  f.service.windows.captureBackgroundQr = async (_platform, refresh) => {
    attempts++
    return { code: refresh ? 'unavailable' : 'expired' }
  }
  t.mock.timers.tick(2000)
  await tick()
  assert.equal(f.state.logins.bili.status, 'error')
  assert.equal(f.state.logins.bili.failure.code, 'QR_IMAGE_FAILED')
  t.mock.timers.tick(60000)
  await tick()
  assert.equal(attempts, 2)
  await f.manager.stopAll(true)
})
