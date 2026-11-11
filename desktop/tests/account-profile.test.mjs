import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeProfile } from '../account-profile.mjs'

const known = { nickname: '小明', avatar: 'https://i0.hdslb.com/face.jpg' }

test('续采带来的空资料不抹掉已有头像和昵称', () => {
  assert.deepEqual(mergeProfile(known, {}), known)
  assert.deepEqual(mergeProfile(known, { nickname: '', avatar: '' }), known)
  assert.deepEqual(mergeProfile(known, undefined), known)
})

test('新资料有值时覆盖', () => {
  assert.deepEqual(
    mergeProfile(known, { nickname: '新名字', avatar: 'https://a/b.jpg' }),
    { nickname: '新名字', avatar: 'https://a/b.jpg' },
  )
  assert.deepEqual(mergeProfile(known, { nickname: '新名字' }), {
    nickname: '新名字',
    avatar: known.avatar,
  })
})

test('首次连接和不安全的地址', () => {
  assert.deepEqual(
    mergeProfile(undefined, {
      nickname: 'x'.repeat(120),
      avatar: 'http://a/b.jpg',
    }),
    {
      nickname: 'x'.repeat(100),
      avatar: '',
    },
  )
  assert.deepEqual(mergeProfile(undefined, {}), { nickname: '', avatar: '' })
})
