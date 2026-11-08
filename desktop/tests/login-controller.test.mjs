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
    'const { useStudio } = globalThis.loginFixture',
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext } },
).outputText

test('切换只提升目标平台优先级，不取消后台登录；历史弹窗不影响任务，卸载停止订阅', async () => {
  const calls = []
  const foreground = []
  let listener
  const state = { ready: true, platform: 'bili' }
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.window = {
    studio: {
      setLoginForeground: async (p) => foreground.push(p),
      ensureLogin: async (p) => calls.push(p),
      cancel: () => assert.fail('must not cancel'),
    },
    location: { hash: '#/' },
    addEventListener() {},
    removeEventListener() {},
  }
  globalThis.loginFixture = {
    useStudio: {
      getState: () => state,
      subscribe: (fn) => {
        listener = fn
        return () => {}
      },
    },
  }
  try {
    const { LoginController } = await import(
      'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
    )
    const dispose = new LoginController().start()
    listener()
    listener()
    assert.deepEqual(calls, ['bili'])
    state.platform = 'dy'
    listener()
    state.platform = 'xhs'
    listener()
    state.platform = 'bili'
    listener()
    assert.deepEqual(calls, ['bili', 'dy', 'xhs', 'bili'])
    globalThis.window.location.hash = '#/history'
    state.platform = 'ks'
    listener()
    assert.equal(calls.length, 4)
    assert.equal(foreground.at(-1), null)
    globalThis.window.location.hash = '#/'
    listener()
    assert.equal(calls.at(-1), 'ks')
    assert.equal(foreground.at(-1), 'ks')
    globalThis.document.visibilityState = 'hidden'
    listener()
    assert.equal(foreground.at(-1), null)
    dispose()
    state.platform = 'wb'
    listener()
    assert.equal(calls.length, 5)
  } finally {
    delete globalThis.document
    delete globalThis.window
    delete globalThis.loginFixture
  }
})
