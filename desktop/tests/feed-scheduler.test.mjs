import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { FeedScheduler } from '../feed-scheduler.mjs'
import { JsonCache } from '../json-cache.mjs'

const page = (name) => ({ items: [{ id: name }], hasMore: true })
const cancelled = { items: [], hasMore: false, cancelled: true }
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

function memoryCache() {
  const entries = new Map()
  const ages = new Map()
  return {
    entries,
    get: (key) => entries.get(key),
    has: (key) => entries.has(key),
    set: (key, value) => entries.set(key, value),
    delete: (key) => entries.delete(key),
    age: (key) => (entries.has(key) ? ages.get(key) || 0 : undefined),
    ages,
  }
}

function setup(accounts = { bili: 'connected', dy: 'connected' }, options) {
  const calls = []
  const operations = new Set()
  const cache = memoryCache()
  const owner = { name: 'a' }
  const scheduler = new FeedScheduler({
    platforms: ['bili', 'dy'],
    cache,
    gapMs: [0, 0],
    idleMs: 1,
    retryMs: 1,
    quietMs: 0,
    status: (platform) => accounts[platform],
    account: () => owner.name,
    busy: (platform) => operations.has(platform),
    fetch: (platform, cursor, run) =>
      new Promise((resolve, reject) => {
        const call = { platform, cursor, run, resolve, reject }
        run.child = {
          kill: () => {
            call.killed = true
            resolve(cancelled)
          },
        }
        calls.push(call)
      }),
    ...options,
  })
  return { scheduler, calls, operations, cache, accounts, owner }
}

test('后台一次只预取一个，取完存缓存，当前 Tab 优先', async (t) => {
  const { scheduler, calls, cache } = setup()
  t.after(() => scheduler.close())
  scheduler.focus('dy')
  scheduler.sync()
  await tick()
  assert.deepEqual(
    calls.map((call) => call.platform),
    ['dy'],
  )
  assert.equal(calls[0].run.background, true)
  calls[0].resolve(page('d'))
  await tick()
  assert.deepEqual(cache.get('dy')?.page, page('d'))
  assert.deepEqual(
    calls.map((call) => call.platform),
    ['dy', 'bili'],
  )
})

test('有缓存时不预取，打开用掉后补一份，同一次连接不重复拉', async (t) => {
  const { scheduler, calls, cache } = setup({ bili: 'connected' })
  t.after(() => scheduler.close())
  cache.set('bili', { account: 'a', page: page('old') })
  scheduler.sync()
  scheduler.sync()
  await tick()
  assert.equal(calls.length, 0)
  assert.deepEqual(await scheduler.load('bili'), page('old'))
  assert.equal(cache.has('bili'), false)
  await tick()
  assert.equal(calls.length, 1)
  calls[0].resolve(page('new'))
  await tick()
  assert.deepEqual(cache.get('bili')?.page, page('new'))
  scheduler.sync()
  await tick()
  assert.equal(calls.length, 1)
})

test('预取中打开同一平台接上同一个请求，不发第二次', async (t) => {
  const { scheduler, calls, cache } = setup({ bili: 'connected' })
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  const opened = scheduler.load('bili')
  calls[0].resolve(page('a'))
  assert.deepEqual(await opened, page('a'))
  assert.equal(cache.has('bili'), false)
  assert.equal(calls[0].killed, undefined)
})

test('用户离开时后台请求继续跑完并缓存', async (t) => {
  const { scheduler, calls, cache } = setup({ bili: 'connected' })
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  const opened = scheduler.load('bili')
  scheduler.cancel('bili')
  assert.deepEqual(await opened, cancelled)
  assert.equal(calls[0].killed, undefined)
  calls[0].resolve(page('a'))
  await tick()
  assert.deepEqual(cache.get('bili')?.page, page('a'))
})

test('用户自己发起的请求取消时结束进程', async (t) => {
  const { scheduler, calls } = setup({})
  t.after(() => scheduler.close())
  const opened = scheduler.load('bili')
  scheduler.cancel('bili')
  assert.deepEqual(await opened, cancelled)
  assert.equal(calls[0].killed, true)
})

test('搜索开始时预取让路，操作结束后再补', async (t) => {
  const { scheduler, calls, operations, cache } = setup({ bili: 'connected' })
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  operations.add('bili')
  scheduler.sync()
  await tick()
  assert.equal(calls[0].killed, true)
  assert.equal(calls.length, 1)
  operations.delete('bili')
  await tick()
  assert.equal(calls.length, 2)
  calls[1].resolve(page('b'))
  await tick()
  assert.deepEqual(cache.get('bili')?.page, page('b'))
})

test('翻页时取消后台预取，翻页结束后再补', async (t) => {
  const { scheduler, calls } = setup({ bili: 'connected' })
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  const turning = scheduler.load('bili', 'next')
  assert.equal(calls[0].killed, true)
  assert.equal(calls[1].cursor, 'next')
  calls[1].resolve(page('p2'))
  await turning
  await tick()
  assert.equal(calls[2].run.background, true)
})

test('节流排不上时有限重试，用户等着时转成普通请求', async (t) => {
  const { scheduler, calls, cache } = setup({ bili: 'connected' })
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  const opened = scheduler.load('bili')
  calls[0].resolve({ ...cancelled, cancelled: false, busy: true })
  await tick()
  assert.equal(calls[1].run.background, false)
  calls[1].resolve(page('a'))
  assert.deepEqual(await opened, page('a'))
  await tick()
  for (let index = 2; index < calls.length; index += 1) {
    calls[index].resolve({ items: [], hasMore: false, busy: true })
    await tick()
  }
  for (let round = 0; round < 8 && calls.at(-1).run.background; round += 1) {
    calls.at(-1).resolve({ items: [], hasMore: false, busy: true })
    await tick()
  }
  assert.ok(calls.length <= 6)
  assert.equal(cache.has('bili'), false)
})

test('退出账号时清缓存，迟到的结果丢弃', async (t) => {
  const { scheduler, calls, cache, accounts } = setup({ bili: 'connected' })
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  delete accounts.bili
  scheduler.sync()
  await tick()
  assert.equal(calls[0].killed, true)
  assert.equal(cache.has('bili'), false)
  assert.equal(scheduler.wanted.has('bili'), false)
})

test('saved 状态保留缓存，确认登录后不重新拉', async (t) => {
  const accounts = { bili: 'saved' }
  const { scheduler, calls, cache } = setup(accounts)
  t.after(() => scheduler.close())
  cache.set('bili', { account: 'a', page: page('old') })
  scheduler.sync()
  accounts.bili = 'connected'
  scheduler.sync()
  await tick()
  assert.equal(calls.length, 0)
  assert.equal(cache.has('bili'), true)
})

test('换账号后旧缓存不能用，并重新预取', async (t) => {
  const { scheduler, calls, cache, owner } = setup({ bili: 'connected' })
  t.after(() => scheduler.close())
  cache.set('bili', { account: 'a', page: page('old') })
  owner.name = 'b'
  scheduler.sync()
  await tick()
  assert.equal(calls.length, 1)
  calls[0].resolve(page('new'))
  await tick()
  assert.deepEqual(await scheduler.load('bili'), page('new'))
})

test('预取已被取消时打开走普通请求，不接将结束的进程', async (t) => {
  const { scheduler, calls, operations } = setup({ bili: 'connected' })
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  operations.add('bili')
  scheduler.sync()
  const opened = scheduler.load('bili')
  await tick()
  const foreground = calls.find((call) => !call.run.background)
  foreground.resolve(page('a'))
  assert.deepEqual(await opened, page('a'))
})

test('后台失败不重试也不影响其他平台', async (t) => {
  const { scheduler, calls } = setup()
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  calls[0].reject(new Error('blocked'))
  await tick()
  assert.equal(calls[1].platform, 'dy')
  calls[1].resolve(page('d'))
  await tick()
  assert.equal(calls.length, 2)
})

test('静默期内不预取', async (t) => {
  let now = 1000
  const { scheduler, calls } = setup(
    { bili: 'connected' },
    { quietMs: 500, now: () => now },
  )
  t.after(() => scheduler.close())
  scheduler.touch('bili')
  scheduler.sync()
  await tick()
  assert.equal(calls.length, 0)
  now = 1600
  await tick()
  assert.equal(calls.length, 1)
})

test('JsonCache 按大类存一个文件，过期和损坏都当作没有缓存', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-cache-'))
  let now = 1000
  const open = (version = 1) =>
    new JsonCache(dir, 'feed', { version, ttlMs: 100, now: () => now })
  const cache = open()
  cache.set('bili', { a: 1 })
  cache.set('dy', { b: 2 })
  const file = path.join(dir, 'feed.json')
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file)).entries), [
    'bili',
    'dy',
  ])
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(open().get('bili'), { a: 1 })
  assert.equal(open(2).get('bili'), undefined)
  now = 1200
  assert.equal(open().get('bili'), undefined)
  writeFileSync(file, '{broken')
  assert.equal(open().get('bili'), undefined)
  open().set('bili', { c: 3 })
  assert.deepEqual(open().get('bili'), { c: 3 })
})

const throttled = (retryAfter, busy = false) => ({
  items: [],
  hasMore: false,
  busy,
  throttled: {
    code: busy ? 'FEED_BUSY' : 'RATE_COOLDOWN',
    retryAfter,
    message: 'x',
  },
})

test('平台冷却时后台不重试，用户请求拿到限流结果', async (t) => {
  const { scheduler, calls } = setup({ bili: 'connected' })
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  calls[0].resolve(throttled(600))
  await tick()
  await tick()
  assert.equal(calls.length, 1)
  const opened = scheduler.load('bili')
  await tick()
  calls[1].resolve(throttled(600))
  assert.equal((await opened).throttled.retryAfter, 600)
  await tick()
  assert.equal(scheduler.wanted.has('bili'), false)
})

test('排队太久的静默预取直接放弃', async (t) => {
  const { scheduler, calls } = setup(
    { bili: 'connected' },
    { maxRetryDelayMs: 50 },
  )
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  calls[0].resolve(throttled(30, true))
  await tick()
  assert.equal(scheduler.wanted.has('bili'), false)
})

test('静默预取按平台给的时间再试', async (t) => {
  let now = 1000
  const { scheduler, calls } = setup({ bili: 'connected' }, { now: () => now })
  t.after(() => scheduler.close())
  scheduler.sync()
  await tick()
  calls[0].resolve(throttled(30, true))
  await tick()
  assert.ok(scheduler.wanted.has('bili'))
  assert.equal(scheduler.ready('bili'), false)
  now += 31000
  assert.equal(scheduler.ready('bili'), true)
})

test('使用中临近过期才补缓存，间隔内不重复', async (t) => {
  let now = 10 * 60 * 1000
  const { scheduler, calls, cache } = setup(
    { bili: 'connected' },
    { now: () => now, renewAfterMs: 100, renewGapMs: 1000 },
  )
  t.after(() => scheduler.close())
  cache.set('bili', { account: 'a', page: page('old') })
  cache.ages.set('bili', 50)
  scheduler.seen.add('bili')
  scheduler.keepFresh('bili')
  await tick()
  assert.equal(calls.length, 0)
  cache.ages.set('bili', 200)
  scheduler.keepFresh('bili')
  await tick()
  assert.equal(calls.length, 1)
  assert.ok(cache.has('bili'), '新内容回来前旧缓存继续可用')
  calls[0].resolve(page('new'))
  await tick()
  assert.deepEqual(cache.get('bili').page, page('new'))
  cache.ages.set('bili', 200)
  scheduler.keepFresh('bili')
  await tick()
  assert.equal(calls.length, 1, '间隔内不重复')
  now += 2000
  scheduler.keepFresh('bili')
  await tick()
  assert.equal(calls.length, 2)
})

test('未登录时不补缓存', (t) => {
  const { scheduler, calls } = setup({ bili: 'expired' })
  t.after(() => scheduler.close())
  scheduler.keepFresh('bili')
  assert.equal(calls.length, 0)
  assert.equal(scheduler.wanted.has('bili'), false)
})
