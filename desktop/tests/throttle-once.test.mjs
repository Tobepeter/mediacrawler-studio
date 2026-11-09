import assert from 'node:assert/strict'
import test from 'node:test'
import { throttleOnce } from '../throttle-once.mjs'

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 })
  const calls = []
  const throttled = throttleOnce((value) => calls.push(value), {
    cooldown: 1000,
    burstGap: 200,
  })
  return { calls, throttled, tick: (ms) => t.mock.timers.tick(ms) }
}

test('空闲时立刻执行，同一串后续调用没有尾巴', (t) => {
  const { calls, throttled, tick } = setup(t)
  throttled('a')
  assert.deepEqual(calls, ['a'])
  for (const value of ['b', 'c', 'd']) {
    tick(100)
    throttled(value)
  }
  tick(5000)
  assert.deepEqual(calls, ['a'])
})

test('一串持续超过冷却也只执行一次', (t) => {
  const { calls, throttled, tick } = setup(t)
  throttled(0)
  for (let index = 1; index <= 30; index += 1) {
    tick(100)
    throttled(index)
  }
  tick(5000)
  assert.deepEqual(calls, [0])
})

test('冷却中开始的一串只在冷却结束时执行一次，用最新参数', (t) => {
  const { calls, throttled, tick } = setup(t)
  throttled('head')
  tick(300)
  throttled('b')
  assert.deepEqual(calls, ['head'])
  tick(100)
  throttled('c')
  tick(599)
  assert.deepEqual(calls, ['head'])
  tick(1)
  assert.deepEqual(calls, ['head', 'c'])
  tick(5000)
  assert.deepEqual(calls, ['head', 'c'])
})

test('尾巴执行后重新开始冷却', (t) => {
  const { calls, throttled, tick } = setup(t)
  throttled('head')
  tick(300)
  throttled('tail')
  tick(700)
  tick(500)
  throttled('next')
  assert.deepEqual(calls, ['head', 'tail'])
  tick(500)
  assert.deepEqual(calls, ['head', 'tail', 'next'])
})

test('冷却结束后的新一串立刻执行', (t) => {
  const { calls, throttled, tick } = setup(t)
  throttled('a')
  tick(1000)
  throttled('b')
  assert.deepEqual(calls, ['a', 'b'])
})

test('cancel 取消等待中的尾巴，不影响之后的调用', (t) => {
  const { calls, throttled, tick } = setup(t)
  throttled('head')
  tick(300)
  throttled('tail')
  throttled.cancel()
  tick(5000)
  assert.deepEqual(calls, ['head'])
  throttled('next')
  assert.deepEqual(calls, ['head', 'next'])
})

test('burstGap 不小于 cooldown 时报错，默认取冷却的四分之一', (t) => {
  assert.throws(
    () => throttleOnce(() => {}, { cooldown: 100, burstGap: 100 }),
    RangeError,
  )
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 })
  const calls = []
  const throttled = throttleOnce((value) => calls.push(value), {
    cooldown: 1000,
  })
  throttled('head')
  t.mock.timers.tick(250)
  throttled('tail')
  t.mock.timers.tick(750)
  assert.deepEqual(calls, ['head', 'tail'])
})
