import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(
  new URL('../../webui/src/studio/login-controller.ts', import.meta.url),
  'utf8',
)
const code = ts.transpileModule(
  source.replace(
    /import .* from '.\/store'/,
    'const { activeStatuses, useStudio } = globalThis.loginFixture',
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext } },
).outputText

test('只给当前未登录平台自动取码，已有会话/历史/主动退出不触发，卸载后停止协调', async () => {
  let listener
  let starts = 0
  const state = {
    ready: true,
    platform: 'bili',
    accounts: { bili: 'saved' },
    pages: {},
    attempted: {},
    start: () => {
      starts++
      state.attempted.bili = true
    },
    busy: false,
    pending: false,
  }
  globalThis.window = {
    studio: {},
    location: { hash: '#/' },
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.loginFixture = {
    activeStatuses: ['checking', 'auth', 'running'],
    useStudio: {
      getState: () => state,
      subscribe: (fn) => {
        listener = fn
        return () => {}
      },
    },
  }
  const { LoginController } = await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  )
  const dispose = new LoginController().start()
  assert.equal(starts, 0)
  state.accounts.bili = 'unknown'
  listener()
  listener()
  assert.equal(starts, 1)
  state.attempted.bili = false
  state.pages.bili = { id: 'history' }
  listener()
  assert.equal(starts, 1)
  state.pages = {}
  globalThis.window.location.hash = '#/history'
  listener()
  assert.equal(starts, 1)
  dispose()
  globalThis.window.location.hash = '#/'
  listener()
  assert.equal(starts, 1)
  delete globalThis.window
  delete globalThis.loginFixture
})

for (const existingResults of [false, true]) {
  test(`历史弹窗关闭后恢复被它取消的登录，已有结果=${existingResults}`, async () => {
    let listener
    let starts = 0
    let cancels = 0
    const state = {
      ready: true,
      platform: 'bili',
      accounts: { bili: 'expired' },
      pages: existingResults ? { bili: { id: 'old' } } : {},
      attempted: { bili: true },
      busy: true,
      pending: false,
      task: {
        action: 'connect',
        platform: 'bili',
        loginMode: 'qrcode',
        status: 'auth',
      },
      start: () => {
        starts++
        state.task.status = 'checking'
        state.busy = true
      },
    }
    globalThis.window = {
      studio: {
        cancel: async () => {
          cancels++
          state.task.status = 'cancelled'
          state.busy = false
        },
      },
      location: { hash: '#/' },
      addEventListener() {},
      removeEventListener() {},
    }
    globalThis.loginFixture = {
      activeStatuses: ['checking', 'auth', 'running', 'stopping'],
      useStudio: {
        getState: () => state,
        subscribe: (fn) => {
          listener = fn
          return () => {}
        },
      },
    }
    const { LoginController } = await import(
      'data:text/javascript;base64,' +
        Buffer.from(code).toString('base64') +
        `#history-${existingResults}`
    )
    const dispose = new LoginController().start()
    try {
      globalThis.window.location.hash = '#/history'
      listener()
      await new Promise((resolve) => setTimeout(resolve, 0))
      assert.equal(cancels, 1)
      assert.equal(starts, 0)
      globalThis.window.location.hash = '#/'
      listener()
      assert.equal(starts, 1)
      // 恢复后失败不循环重试
      state.task.status = 'error'
      state.busy = false
      listener()
      assert.equal(starts, 1)
      // 真正恢复历史内容（task 清空）不能被自动登录覆盖
      state.task = {
        action: 'connect',
        platform: 'bili',
        loginMode: 'qrcode',
        status: 'auth',
      }
      state.busy = true
      globalThis.window.location.hash = '#/history'
      listener()
      await new Promise((resolve) => setTimeout(resolve, 0))
      state.task = null
      state.pages = { bili: { id: 'restored' } }
      globalThis.window.location.hash = '#/'
      listener()
      assert.equal(starts, 1)
    } finally {
      dispose()
      delete globalThis.window
      delete globalThis.loginFixture
    }
  })
}
