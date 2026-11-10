import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileCache } from '../file-cache.mjs'

const folder = () =>
  path.join(mkdtempSync(path.join(tmpdir(), 'studio-files-')), 'cache')

test('一条内容一个文件，只给当前用户读', () => {
  const dir = folder()
  const cache = new FileCache(dir)
  cache.set('dy:1', { text: '一' })
  cache.set('dy:2', { text: '二' })
  assert.deepEqual(cache.get('dy:1'), { text: '一' })
  assert.equal(readdirSync(dir).length, 2)
  assert.equal(statSync(cache.file('dy:1')).mode & 0o777, 0o600)
  assert.equal(new FileCache(dir).get('dy:2').text, '二')
})

test('特殊字符不能跑出缓存目录', () => {
  const dir = folder()
  const cache = new FileCache(dir)
  cache.set('../../escape', { a: 1 })
  assert.equal(path.dirname(cache.file('../../escape')), dir)
  assert.deepEqual(cache.get('../../escape'), { a: 1 })
})

test('没有或损坏的内容当作没有缓存', () => {
  const cache = new FileCache(folder())
  assert.equal(cache.get('none'), undefined)
  cache.set('a', { b: 1 })
  writeFileSync(cache.file('a'), '{broken')
  assert.equal(cache.get('a'), undefined)
})

test('超过上限按修改时间淘汰最早的，重新写入算最新', () => {
  const cache = new FileCache(folder(), { maxEntries: 2 })
  const age = (key, seconds) => utimesSync(cache.file(key), seconds, seconds)
  cache.set('a', 1)
  age('a', 100)
  cache.set('b', 2)
  age('b', 200)
  cache.set('a', 3)
  age('a', 300)
  cache.set('c', 4)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 3)
  assert.equal(cache.get('c'), 4)
})

test('统计大小和清空', () => {
  const cache = new FileCache(folder())
  assert.equal(cache.bytes(), 0)
  cache.set('a', 'x'.repeat(100))
  assert.ok(cache.bytes() > 100)
  cache.clear()
  assert.equal(cache.bytes(), 0)
  assert.equal(cache.get('a'), undefined)
  cache.set('b', 1)
  assert.equal(cache.get('b'), 1)
})
