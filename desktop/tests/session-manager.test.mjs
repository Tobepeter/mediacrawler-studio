import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { SessionManager } from '../session-manager.mjs'

function fixture(script) {
  const visited = []
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
    },
  }
  let spawned = 0
  const manager = new SessionManager(service, () => {
    spawned++
    return spawn(process.execPath, ['-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  })
  return { manager, state, visited, spawned: () => spawned }
}

test('启动统一初始化，已有会话恢复资料，不改采集状态，重复启动不重跑', async () => {
  const f = fixture(
    `process.stdin.once('data', () => console.log(JSON.stringify({type:'account',profile:{nickname:'test'}})))`,
  )
  await Promise.all([f.manager.start(), f.manager.start()])
  assert.equal(f.visited.length, 7)
  assert.equal(f.spawned(), 1)
  assert.equal(f.state.accounts.bili, 'connected')
  assert.equal(f.state.profiles.bili.nickname, 'test')
  assert.equal(f.state.task, null)
  assert.equal(f.state.busy, false)
  await f.manager.stopAll()
})

test('主动操作接管会话，取消后台检查后迟到事件不覆盖账号', async () => {
  const f = fixture(
    `process.stdin.once('data', () => { setTimeout(() => console.log(JSON.stringify({type:'account',profile:{nickname:'late'}})), 500); setInterval(()=>{},1000) })`,
  )
  const checking = f.manager.check('bili')
  await new Promise((resolve) => setTimeout(resolve, 20))
  await f.manager.stop('bili')
  await checking
  assert.equal(f.state.accounts.bili, 'saved')
  assert.deepEqual(f.state.profiles, {})
  assert.equal(f.manager.jobs.size, 0)
})
