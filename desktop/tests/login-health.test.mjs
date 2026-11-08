import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const policy = JSON.parse(
  await readFile(new URL('../health-policy.json', import.meta.url), 'utf8'),
)
const source = (
  await readFile(
    new URL('../../webui/src/studio/login-health.ts', import.meta.url),
    'utf8',
  )
).replace(
  "import policy from '../../../desktop/health-policy.json'",
  `const policy = ${JSON.stringify(policy)}`,
)
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText
const { recordLoginOutcome, loginMayBeBroken } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)

test('三次独立超时才提示，按平台隔离，成功和过期清零，缓存有界', (t) => {
  let value = '{}'
  globalThis.localStorage = {
    getItem: () => value,
    setItem: (_, next) => {
      value = next
    },
  }
  t.after(() => delete globalThis.localStorage)
  for (let i = 0; i < 8; i++) recordLoginOutcome('bili', 'one', 'timeout', 100)
  assert.equal(loginMayBeBroken('bili', 101), false)
  recordLoginOutcome('bili', 'two', 'timeout', 102)
  recordLoginOutcome('dy', 'three', 'timeout', 103)
  assert.equal(loginMayBeBroken('bili', 104), false)
  recordLoginOutcome('bili', 'three', 'timeout', 105)
  assert.equal(loginMayBeBroken('bili', 106), true)
  recordLoginOutcome('bili', 'three', 'success', 107)
  assert.equal(loginMayBeBroken('bili', 108), false)
  for (let i = 0; i < 100; i++)
    recordLoginOutcome('bili', `attempt-${i}`, 'timeout', 200 + i)
  assert.equal(JSON.parse(value).bili.length, 3)
  assert.equal(loginMayBeBroken('bili', 301), true)
  assert.equal(loginMayBeBroken('bili', 1000000), false)
  recordLoginOutcome('bili', 'network-failed', 'failed', 302)
  assert.equal(loginMayBeBroken('bili', 303), false)
})
