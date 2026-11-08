import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { HealthCheck } from '../health-check.mjs'

const tick = () => new Promise((resolve) => setImmediate(resolve))
function fixture() {
  const views = [],
    children = [],
    cleared = []
  const session = Object.fromEntries(
    ['clearStorageData', 'clearCache', 'closeAllConnections'].map((key) => [
      key,
      async () => {
        cleared.push(key)
      },
    ]),
  )
  session.setPermissionRequestHandler = () => {}
  session.setPermissionCheckHandler = () => {}
  const progress = []
  const service = {
    root: '.',
    endpoint: 'unused',
    state: {},
    publish() {
      progress.push({ ...this.state.healthCheck })
    },
  }
  const runner = new HealthCheck(
    service,
    () => {
      const view = {
        setBounds() {},
        setVisible() {},
        webContents: {
          session,
          setAudioMuted(value) {
            assert.equal(value, true)
          },
          getUserAgent: () => 'Browser Electron/45',
          setUserAgent() {},
          setWindowOpenHandler() {},
          loadURL: async () => {},
          isDestroyed: () => !!view.closed,
          close() {
            view.closed = true
          },
        },
      }
      views.push(view)
      return view
    },
    () => {
      const child = new EventEmitter()
      for (const stream of ['stdin', 'stdout', 'stderr'])
        child[stream] = new PassThrough()
      child.kill = () => queueMicrotask(() => child.emit('close', 0))
      children.push(child)
      return child
    },
  )
  return { runner, views, children, cleared, progress }
}

test('全量检查合并重复请求，保留部分结果，清理临时页面和分区', async () => {
  const f = fixture()
  const result = f.runner.run()
  assert.equal(f.runner.run(), result)
  await tick()
  assert.equal(f.children.length, 1)
  assert.equal(f.views.length, 7)
  f.children[0].stdout.write(
    JSON.stringify({ type: 'platform', platform: 'bili', status: 'ok' }) + '\n',
  )
  f.children[0].emit('close', 1)
  const report = await result
  assert.equal(report.platforms.length, 7)
  assert.equal(
    report.platforms.filter((item) => item.status === 'ok').length,
    1,
  )
  assert.ok(f.views.every((view) => view.closed))
  assert.equal(f.cleared.length, 3)
  assert.equal(f.runner.pending, null)
  assert.equal(f.progress[0].stage, 'network')
  assert.ok(f.progress.some((p) => p.completed === 1))
  assert.equal(f.progress.at(-1).stage, 'done')
})

test('挂起检查超时终止并回收；退出后不能重启', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const f = fixture()
  const result = f.runner.run()
  await tick()
  t.mock.timers.tick(140000)
  const report = await result
  assert.ok(report.platforms.every((item) => item.error.code === 'TIMEOUT'))
  assert.ok(f.views.every((view) => view.closed))
  await f.runner.stop()
  await assert.rejects(f.runner.run())
})

const source = await readFile(
  new URL('../../webui/src/studio/health-summary.ts', import.meta.url),
  'utf8',
)
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const { healthSummary } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)
test('通知合并同原因平台，空结果不报成功，断网不重复列七个平台', () => {
  assert.equal(healthSummary({ platforms: [] }).kind, 'warning')
  assert.equal(
    healthSummary({ platforms: [{ platform: 'bili', status: 'ok' }] }).message,
    '全部平台正常',
  )
  const platforms = ['dy', 'xhs'].map((platform) => ({
    platform,
    status: 'failed',
    error: { code: 'TIMEOUT' },
  }))
  assert.deepEqual(healthSummary({ platforms }).groups, [
    { reason: '连接超时', platforms: ['dy', 'xhs'] },
  ])
  assert.equal(
    healthSummary({
      platforms,
      network: { error: { code: 'NETWORK_OFFLINE' } },
    }).message,
    '网络未连接',
  )
})

test('退出可立即取消尚未启动 worker 的挂起准备，不等待140秒', async () => {
  const f = fixture()
  const create = f.runner.createView
  let finishLoad
  f.runner.createView = () => {
    const view = create()
    view.webContents.loadURL = () =>
      new Promise((resolve) => {
        finishLoad = resolve
      })
    return view
  }
  const pending = f.runner.run()
  await tick()
  await f.runner.stop()
  await pending
  assert.equal(f.children.length, 0)
  assert.ok(f.views.every((view) => view.closed))
  finishLoad()
  await tick()
  assert.equal(f.children.length, 0)
})

test('取码阶段超时文案不误称网络连接超时', () => {
  const result = healthSummary({
    platforms: [
      {
        platform: 'bili',
        status: 'failed',
        error: { code: 'TIMEOUT', stage: 'qr_image' },
      },
    ],
  })
  assert.equal(result.groups[0].reason, '获取二维码超时')
})

test('检查进程连接失败只报告检查失败，不指控七个平台故障', () => {
  const summary = healthSummary({
    failure: { code: 'TIMEOUT', stage: 'worker' },
    platforms: ['bili', 'dy', 'xhs', 'wb', 'ks', 'zhihu', 'tieba'].map(
      (platform) => ({
        platform,
        status: 'failed',
        error: { code: 'TIMEOUT' },
      }),
    ),
  })
  assert.equal(summary.message, '检查连接超时，请重试')
  assert.deepEqual(summary.groups, [])
})
