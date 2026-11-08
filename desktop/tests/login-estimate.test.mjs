import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(
  new URL('../../webui/src/studio/login-estimate.ts', import.meta.url),
  'utf8',
)
const code = ts.transpileModule(
  source.replace(
    "import policy from '../../../desktop/health-policy.json'",
    `const policy = ${JSON.stringify(JSON.parse(await readFile(new URL('../health-policy.json', import.meta.url), 'utf8')))}`,
  ),
  {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  },
).outputText
const { loginEstimate, recordLoginDuration, loginTimeout } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
)

test('预估独立于真实超时，各平台只累计成功耗时，存储有界', (t) => {
  let stored = '{}'
  globalThis.localStorage = {
    getItem: () => stored,
    setItem: (_, value) => {
      stored = value
    },
  }
  t.after(() => delete globalThis.localStorage)
  assert.equal(loginTimeout, 30_000)
  assert.equal(loginEstimate('bili'), 8000)
  recordLoginDuration('bili', 6000)
  recordLoginDuration('bili', 10_000)
  assert.equal(loginEstimate('bili'), 8000)
  assert.equal(JSON.parse(stored).bili.count, 2)
  assert.equal(loginEstimate('dy'), 8000)
  for (const invalid of [NaN, Infinity, -1, 0, 30_001])
    recordLoginDuration('bili', invalid)
  assert.equal(JSON.parse(stored).bili.count, 2)
  for (let i = 0; i < 1000; i++) recordLoginDuration('dy', 1000)
  assert.equal(JSON.parse(stored).dy.count, 100)
  assert.equal(loginEstimate('dy'), 3000)
  recordLoginDuration('xhs', 29_000)
  assert.equal(loginEstimate('xhs'), 20_000)
  assert.deepEqual(Object.keys(JSON.parse(stored)).sort(), [
    'bili',
    'dy',
    'xhs',
  ])
  stored = '{broken'
  assert.equal(loginEstimate('bili'), 8000)
  globalThis.localStorage.getItem = () => {
    throw new Error('disabled')
  }
  globalThis.localStorage.setItem = () => {
    throw new Error('disabled')
  }
  assert.doesNotThrow(() => recordLoginDuration('bili', 5000))
})
