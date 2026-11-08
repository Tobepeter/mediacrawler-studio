import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StudioService } from '../service.mjs'

const request = {
  platform: 'dy',
  action: 'connect',
  mode: 'search',
  query: '',
  limit: 5,
  loginMode: 'qrcode',
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('二维码超时释放准备任务，旧准备结果不能覆盖新任务', async (t) => {
  const { service, windows, children } = await fixture(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let complete
  windows.prepare = () =>
    new Promise((resolve) => {
      complete = resolve
    })
  const old = service.start(request)
  await tick()
  t.mock.timers.tick(30_000)
  await tick()
  assert.equal(service.busy, false)
  assert.equal(service.state.tasks.dy.message, '获取二维码超时，请重试')
  windows.prepare = async () => 'new-page'
  await service.start(request)
  const current = service.state.tasks.dy
  complete('old-page')
  await old
  assert.equal(service.state.tasks.dy, current)
  assert.equal(children.length, 1)
  await service.cancel('dy')
})

test('二维码出现即停止取码计时，不把扫码等待当作获取超时', async (t) => {
  const { service } = await fixture(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await service.start(request)
  service.qrReady('dy')
  t.mock.timers.tick(30_000)
  await tick()
  assert.equal(service.busy, true)
  assert.equal(service.operations.get('dy').stopRequested, false)
  await service.cancel('dy')
})

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'studio-login-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const children = []
  const windows = {
    presentation: null,
    accounts: async () => ({}),
    prepare: async () => 'same-page',
    beginLogin(platform, mode) {
      this.presentation = { platform, mode, preparing: true }
    },
    show(platform, mode) {
      this.presentation = { platform, mode }
    },
    hide() {
      this.presentation = null
    },
    flush: async () => {},
  }
  const service = new StudioService({
    root: process.cwd(),
    dataDir,
    windows,
    onState() {},
    spawnProcess() {
      const child = new EventEmitter()
      child.stdin = new PassThrough()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.send = (event) => child.stdout.write(JSON.stringify(event) + '\n')
      child.kill = () => {
        setImmediate(() => child.emit('close', null, 'SIGTERM'))
        return true
      }
      children.push(child)
      return child
    },
  })
  await service.init()
  return { service, windows, children }
}

test('准备阶段立即展示，关闭后不启动 worker，迟到的成功或失败不会重开', async (t) => {
  for (const fail of [false, true]) {
    const { service, windows, children } = await fixture(t)
    let resolve, reject
    windows.prepare = () =>
      new Promise((ok, no) => {
        resolve = ok
        reject = no
      })
    const start = service.start(request)
    assert.equal(service.state.loginView.preparing, true)
    assert.equal(service.state.tasks.dy.status, 'checking')
    await tick()
    await service.dismissLogin()
    assert.equal(service.state.loginView, null)
    assert.equal(service.operations.get('dy').stopRequested, true)
    await assert.rejects(service.start(request), /请先结束/)
    if (fail) reject(new Error('late preparation error'))
    else resolve('same-page')
    await start
    assert.equal(children.length, 0)
    assert.equal(service.state.tasks.dy.status, 'cancelled')
    assert.equal(service.busy, false)
    assert.equal(windows.presentation, null)
  }
})

test('checking/auth 均可放弃，晚到的扫码和账号消息无效，下次可正常登录', async (t) => {
  for (const status of ['checking', 'auth']) {
    const { service, windows, children } = await fixture(t)
    await service.start(request)
    const first = children[0]
    if (status === 'auth') {
      first.send({ type: 'state', status: 'auth' })
      await tick()
      assert.equal(windows.presentation.preparing, undefined)
    }
    const cancel = service.dismissLogin()
    assert.equal(windows.presentation, null)
    first.send({ type: 'state', status: 'auth' })
    first.send({ type: 'account', profile: { nickname: 'late' } })
    first.send({ type: 'done' })
    await cancel
    assert.equal(service.state.tasks.dy.status, 'cancelled')
    assert.notEqual(service.state.accounts.dy, 'connected')
    assert.equal(service.state.profiles.dy, undefined)
    assert.equal(windows.presentation, null)

    await service.start(request)
    const next = children[1]
    first.send({ type: 'state', status: 'auth' })
    next.send({ type: 'account', profile: { nickname: 'current' } })
    next.send({ type: 'done' })
    await tick()
    next.emit('close', 0, null)
    assert.equal(service.state.tasks.dy.status, 'completed')
    assert.equal(service.state.profiles.dy.nickname, 'current')
    assert.equal(service.state.loginView, null)
  }
})

test('三种模式都提前展示准备状态，普通采集检查不强制弹窗', async (t) => {
  const { service, children } = await fixture(t)
  for (const loginMode of ['qrcode', 'embedded', 'window']) {
    await service.start({ ...request, loginMode })
    assert.deepEqual(service.state.loginView, {
      platform: 'dy',
      mode: loginMode,
      preparing: true,
    })
    await service.cancel('dy')
  }
  await service.start({ ...request, action: 'collect', query: 'test' })
  assert.equal(service.state.loginView, null)
  children.at(-1).send({ type: 'state', status: 'auth' })
  await tick()
  assert.equal(service.state.loginView.platform, 'dy')
  await service.cancel('dy')
  await service.persistence
})

test('明确离线时不启动平台浏览器，返回可通知的诊断失败', async (t) => {
  const { service, windows, children } = await fixture(t)
  service.online = () => false
  windows.prepare = () => {
    throw new Error('must not navigate')
  }
  await service.start(request)
  assert.equal(service.busy, false)
  assert.equal(children.length, 0)
  assert.equal(service.state.tasks.dy.failure.code, 'NETWORK_OFFLINE')
  assert.equal(service.state.tasks.dy.status, 'error')
})
