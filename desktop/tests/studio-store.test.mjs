import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(
  new URL('../../webui/package.json', import.meta.url),
)
const { create } = require('zustand')
const source = await readFile(
  new URL('../../webui/src/studio/store.ts', import.meta.url),
  'utf8',
)
const code = ts.transpileModule(
  source.replace(/import[\s\S]*?from '[^']+'\n/g, ''),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText

test('历史可离线查看，扫码入口复用现有码，取消路由到真正的活动任务', async () => {
  const calls = []
  const record = {
    id: 'history',
    task: {
      platform: 'dy',
      query: 'sample',
      mode: 'search',
      limit: 5,
      filters: { sort: '1', time: '7' },
    },
    results: [],
  }
  globalThis.window = {
    localStorage: { getItem: () => null },
    studio: {
      openHistory: async () => record,
      saveDraft: async () => {},
      ensureLogin: async (p) => calls.push(['ensure', p]),
      retryLogin: async (p) => calls.push(['retry', p]),
      stopLogin: async (p) => calls.push(['stop', p]),
      cancel: async (platform) => calls.push(['cancel', platform]),
    },
  }
  globalThis.storeFixture = { create, t: (s) => s, toast: {} }
  try {
    const { useStudio } = await import(
      'data:text/javascript;base64,' +
        Buffer.from(
          'const {create,t,toast}=globalThis.storeFixture;\n' + code,
        ).toString('base64')
    )
    await useStudio.getState().restore('history')
    assert.equal(useStudio.getState().views.dy.historyId, 'history')
    assert.equal(useStudio.getState().platform, 'dy')
    assert.deepEqual(useStudio.getState().forms.dy.filters, {
      sort: '1',
      time: '7',
    })
    useStudio.getState().switchPlatform('bili')
    assert.deepEqual(useStudio.getState().forms.bili.filters, {})
    useStudio.getState().switchPlatform('dy')
    assert.deepEqual(useStudio.getState().forms.dy.filters, {
      sort: '1',
      time: '7',
    })
    assert.equal(useStudio.getState().accounts.dy, undefined)
    useStudio.setState({ logins: { dy: { status: 'ready', id: 'existing' } } })
    await useStudio.getState().start('connect')
    assert.equal(useStudio.getState().views.dy.historyId, '')
    assert.deepEqual(calls, [['ensure', 'dy']])
    useStudio.setState({ logins: { dy: { status: 'error' } } })
    await useStudio.getState().start('connect')
    assert.deepEqual(calls.at(-1), ['retry', 'dy'])
    useStudio.setState({
      tasks: { dy: { platform: 'dy', action: 'collect', status: 'auth' } },
    })
    await useStudio.getState().cancelLogin()
    assert.deepEqual(calls.at(-1), ['cancel', 'dy'])
    useStudio.setState({
      tasks: {
        bili: { platform: 'bili', action: 'collect', status: 'running' },
      },
    })
    await useStudio.getState().cancelLogin()
    assert.deepEqual(calls.at(-1), ['stop', 'dy'])

    const started = new Map()
    globalThis.window.studio.start = ({ platform }) =>
      new Promise((resolve) => started.set(platform, resolve))
    useStudio.setState({
      accounts: { bili: 'connected', dy: 'connected' },
      tasks: {},
    })
    const dy = useStudio.getState().start()
    useStudio.getState().switchPlatform('bili')
    const bili = useStudio.getState().start()
    assert.deepEqual([...started.keys()], ['dy', 'bili'])
    started.get('dy')()
    await dy
    assert.deepEqual(useStudio.getState().requests, { bili: 'start' })
    started.get('bili')()
    await bili
    assert.deepEqual(useStudio.getState().requests, {})
  } finally {
    delete globalThis.window
    delete globalThis.storeFixture
  }
})
