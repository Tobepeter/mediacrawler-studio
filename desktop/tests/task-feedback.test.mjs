import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(
  new URL('../../webui/src/studio/task-feedback.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
})
const { taskFeedback } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
const state = (status, overrides = {}) => ({
  task: {
    status,
    startedAt: 1,
    platform: 'bili',
    action: 'collect',
    ...overrides,
  },
  accounts: {},
  results: [],
})

test('采集终态通知一次，重复推送、快照、历史与新任务不重放', () => {
  const running = state('running')
  const done = { ...state('completed'), results: [{ id: 'one' }] }
  assert.equal(taskFeedback(running, done).kind, 'success')
  assert.equal(taskFeedback(running, done).count, 1)
  assert.equal(taskFeedback(done, done), undefined)
  assert.equal(taskFeedback(undefined, done), undefined)
  assert.equal(taskFeedback(running, state('restored')), undefined)
  assert.equal(
    taskFeedback(running, state('completed', { startedAt: 2 })),
    undefined,
  )
  assert.equal(
    taskFeedback(running, state('completed', { platform: 'dy' })),
    undefined,
  )
})

test('继续采集成功不弹通知，失败和警告仍然提示', () => {
  const running = state('running', { continued: true })
  assert.equal(
    taskFeedback(running, state('completed', { continued: true })),
    undefined,
  )
  assert.equal(
    taskFeedback(
      running,
      state('completed', { continued: true, warning: '部分失败' }),
    ).kind,
    'warning',
  )
  assert.equal(
    taskFeedback(running, state('error', { continued: true, message: '失败' }))
      .kind,
    'error',
  )
})

test('自动模式首批有结果不弹通知，没有结果仍提示', () => {
  const running = state('running', { auto: true })
  assert.equal(
    taskFeedback(running, {
      ...state('completed', { auto: true }),
      results: [{ id: '1' }],
    }),
    undefined,
  )
  assert.equal(
    taskFeedback(running, state('completed', { auto: true })).kind,
    'info',
  )
})

test('无结果、部分失败、错误、取消各有准确语义', () => {
  const running = state('running')
  assert.equal(taskFeedback(running, state('completed')).kind, 'info')
  const warning = taskFeedback(
    running,
    state('completed', { warning: '评论未完成' }),
  )
  assert.equal(warning.kind, 'warning')
  assert.equal(warning.detail, '评论未完成')
  const completed = state('completed')
  const saveFailed = state('completed', {
    warning: '记录暂未保存到磁盘，请先导出',
  })
  assert.equal(taskFeedback(completed, saveFailed).kind, 'warning')
  assert.equal(taskFeedback(saveFailed, saveFailed), undefined)
  const error = taskFeedback(running, state('error', { message: '网络断开' }))
  assert.equal(error.kind, 'error')
  assert.equal(error.detail, '网络断开')
  const stopped = { ...state('cancelled'), results: [{ id: 'one' }] }
  assert.equal(taskFeedback(state('stopping'), stopped).count, 1)
  assert.equal(taskFeedback(stopped, stopped), undefined)
})

test('扫码成功提示一次，自动恢复登录和关闭弹层不提示', () => {
  const auth = state('auth', { action: 'connect' })
  const account = { ...auth, accounts: { bili: 'connected' } }
  assert.equal(taskFeedback(auth, account).message, '登录成功')
  assert.equal(taskFeedback(account, account), undefined)
  const done = {
    ...state('completed', { action: 'connect' }),
    accounts: { bili: 'connected' },
  }
  assert.equal(taskFeedback(account, done), undefined)
  assert.equal(
    taskFeedback(state('checking', { action: 'connect' }), done),
    undefined,
  )
  assert.equal(
    taskFeedback(auth, state('cancelled', { action: 'connect' })),
    undefined,
  )
  assert.equal(
    taskFeedback(auth, state('error', { action: 'connect' })).message,
    '登录失败',
  )
})

test('自动登录检查失败保持静默，手动登录仍提示错误', () => {
  const inline = { action: 'connect', loginMode: 'qrcode' }
  assert.equal(
    taskFeedback(state('auth', inline), state('error', inline)),
    undefined,
  )
  const automatic = { action: 'connect', silent: true }
  assert.equal(
    taskFeedback(state('checking', automatic), state('error', automatic)),
    undefined,
  )
  assert.equal(
    taskFeedback(state('auth', automatic), state('error', automatic)),
    undefined,
  )
  assert.equal(
    taskFeedback(
      state('checking', { action: 'connect' }),
      state('error', { action: 'connect' }),
    ).kind,
    'error',
  )
})

test('仅当前平台前台通知；后台和静默诊断保留数据但不通知', () => {
  const request = { action: 'connect', loginMode: 'qrcode' }
  const before = state('auth', request)
  const after = state('error', {
    ...request,
    failure: { code: 'NETWORK_OFFLINE', stage: 'qr' },
  })
  assert.equal(
    taskFeedback(before, after, { platform: 'dy', visible: true }),
    undefined,
  )
  assert.equal(
    taskFeedback(before, after, { platform: 'bili', visible: false }),
    undefined,
  )
  assert.equal(
    taskFeedback(before, after, { platform: 'bili', visible: true }).kind,
    'warning',
  )
  assert.equal(
    taskFeedback(
      before,
      { ...after, task: { ...after.task, silent: true } },
      { platform: 'bili', visible: true },
    ),
    undefined,
  )
  assert.equal(
    taskFeedback(after, after, { platform: 'bili', visible: true }),
    undefined,
  )
})
