import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(
  new URL('../../webui/src/studio/login-feedback.ts', import.meta.url),
  'utf8',
)
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText
const { loginFeedback } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)

test('并行状态通知按平台和任务身份隔离，后台完成不补弹', () => {
  const before = {
    logins: {
      bili: { id: 'one', status: 'preparing' },
      dy: { id: 'two', status: 'ready' },
    },
  }
  const after = {
    logins: {
      bili: {
        id: 'one',
        status: 'error',
        failure: { code: 'NETWORK_OFFLINE' },
      },
      dy: { id: 'two', status: 'connected' },
    },
  }
  assert.equal(
    loginFeedback(before, after, { platform: 'dy', visible: true }).message,
    '登录成功',
  )
  assert.equal(
    loginFeedback(before, after, { platform: 'bili', visible: false }),
    undefined,
  )
  assert.equal(
    loginFeedback(before, after, { platform: 'bili', visible: true }).kind,
    'warning',
  )
  assert.equal(
    loginFeedback(after, after, { platform: 'bili', visible: true }),
    undefined,
  )
  assert.equal(
    loginFeedback(undefined, after, { platform: 'bili', visible: true }),
    undefined,
  )
})
