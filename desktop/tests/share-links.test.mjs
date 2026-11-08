import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCreatorLink } from '../share-links.mjs'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(
  new URL('../../webui/src/studio/creator-options.ts', import.meta.url),
  'utf8',
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: 'ESNext', target: 'ES2022' },
})
const { extractShareUrl, isDouyinShortLink, platformOfUrl } = await import(
  `data:text/javascript,${encodeURIComponent(outputText)}`
)

const redirect = (location) => async () => ({
  headers: new Headers(location ? { location } : {}),
})
const short = 'https://v.douyin.com/abc/'

test('主页短链解析为完整主页，其他情况不改写', async () => {
  assert.equal(
    await resolveCreatorLink(
      short,
      redirect('https://www.iesdouyin.com/share/user/MS4w_x?from=1'),
    ),
    'https://www.douyin.com/user/MS4w_x',
  )
  for (const location of [
    'https://www.iesdouyin.com/share/video/123',
    'https://evil.com/user/abc',
    '',
  ])
    assert.equal(await resolveCreatorLink(short, redirect(location)), null)
  assert.equal(
    await resolveCreatorLink(short, async () => {
      throw new Error('offline')
    }),
    null,
  )
})

test('短链解析只接受抖音短链域名', async () => {
  let called = false
  const fetcher = async () => {
    called = true
  }
  for (const value of ['https://evil.com/a', 'http://v.douyin.com/a', 'x'])
    assert.equal(await resolveCreatorLink(value, fetcher), null)
  assert.equal(called, false)
})

test('分享文案提取已知平台链接，普通输入不变', () => {
  assert.equal(
    extractShareUrl(
      '7.53 复制打开抖音，看看【某人的作品】 https://v.douyin.com/abc/ a@b.cn',
    ),
    'https://v.douyin.com/abc/',
  )
  assert.equal(
    extractShareUrl('标题 http://xhslink.com/a/xyz，复制本条信息'),
    'https://xhslink.com/a/xyz',
  )
  assert.equal(extractShareUrl('Claude 教程'), 'Claude 教程')
  assert.equal(
    extractShareUrl('看 https://example.com/x 怎么样'),
    '看 https://example.com/x 怎么样',
  )
  assert.equal(
    extractShareUrl('https://www.douyin.com/video/1 '),
    'https://www.douyin.com/video/1 ',
  )
  assert.equal(platformOfUrl('https://b23.tv/x'), 'bili')
  assert.equal(isDouyinShortLink(short), true)
  assert.equal(isDouyinShortLink('https://www.douyin.com/user/a'), false)
})
