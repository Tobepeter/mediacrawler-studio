import test from 'node:test'
import assert from 'node:assert/strict'
import { downloadName } from '../download-name.mjs'

test('作者 - 标题，去掉话题和结尾标点', () => {
  assert.equal(
    downloadName({
      author: '肌本功',
      title: '增肌的科学策略，安德鲁胡伯曼#增肌 #抖音精选计划',
    }),
    '肌本功 - 增肌的科学策略，安德鲁胡伯曼',
  )
})

test('去掉路径和系统不允许的字符', () => {
  const name = downloadName({ author: 'a/b', title: '../../etc:pass?\nwd' })
  assert.ok(!/[\\/:*?"<>|\n]/.test(name))
})

test('没有标题用正文，全没有用作品 ID', () => {
  assert.equal(
    downloadName({ author: '甲', text: '正文内容' }),
    '甲 - 正文内容',
  )
  assert.equal(downloadName({ author: '甲', title: '#话题' }), '甲')
  assert.equal(downloadName({ id: 'dy:123' }), 'dy_123')
})

test('作者和标题都限制长度', () => {
  const name = downloadName({
    author: '作'.repeat(50),
    title: '题'.repeat(200),
  })
  assert.equal(name.length, 24 + 3 + 60)
})

test('截断不切开 emoji', () => {
  const name = downloadName({ title: '题'.repeat(59) + '😀😀' })
  assert.equal(Array.from(name).length, 60)
  assert.ok(name.isWellFormed())
})
