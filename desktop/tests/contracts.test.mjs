import test from 'node:test'
import assert from 'node:assert/strict'
import {
  creatorSearchPlatforms,
  isCreatorUrl,
  isPlatformUrl,
  validateRequest,
  serializeResults,
} from '../contracts.mjs'

const request = {
  platform: 'bili',
  action: 'collect',
  mode: 'search',
  query: '独立开发',
  limit: 5,
}
test('默认应用内登录，允许独立窗口并拒绝无效模式', () => {
  assert.equal(validateRequest(request).loginMode, 'embedded')
  assert.equal(
    validateRequest({ ...request, loginMode: 'window' }).loginMode,
    'window',
  )
  assert.equal(
    validateRequest({ ...request, loginMode: 'qrcode' }).loginMode,
    'qrcode',
  )
  assert.throws(() => validateRequest({ ...request, loginMode: 'iframe' }))
})
test('拒绝跨平台、伪造域名和非 HTTPS 作品地址', () => {
  assert.equal(
    isPlatformUrl('https://www.bilibili.com/video/BV123', 'bili'),
    true,
  )
  for (const url of [
    'https://bilibili.com.evil.test/a',
    'javascript:alert(1)',
    'https://www.douyin.com/video/1',
    'http://bilibili.com/',
  ]) {
    assert.throws(() =>
      validateRequest({ ...request, mode: 'link', query: url }),
    )
  }
  assert.throws(() => validateRequest({ ...request, platform: '__proto__' }))
})
test('验证数量、空输入和链接模式', () => {
  for (const limit of [1, 5, 37, 51, 100])
    assert.equal(validateRequest({ ...request, limit }).limit, limit)
  for (const limit of [0, -1, 101, Infinity, NaN, 2.5])
    assert.throws(() => validateRequest({ ...request, limit }))
  assert.throws(() => validateRequest({ ...request, query: ' ' }))
  assert.equal(
    validateRequest({ ...request, mode: 'link', query: 'https://b23.tv/abc' })
      .limit,
    1,
  )
  assert.equal(
    validateRequest({ ...request, action: 'connect', query: '' }).action,
    'connect',
  )
})
test('CSV 保留正文换行、转义引号、阻止表格公式执行', () => {
  const item = {
    title: '=HYPERLINK("bad")',
    text: '第一行\n第二行',
    author: '作者',
    platform: 'bili',
    url: 'https://bilibili.com/',
    images: [],
  }
  const csv = serializeResults([item], 'csv')
  assert.ok(csv.startsWith('\ufeff'))
  assert.ok(csv.includes("'=HYPERLINK"))
  assert.ok(csv.includes('"第一行\n第二行"'))
  assert.deepEqual(JSON.parse(serializeResults([item], 'json')), [item])
})

test('桌面采集不带评论，导出保留已有评论', () => {
  assert.equal(
    validateRequest({ ...request, comments: true }).comments,
    undefined,
  )
  const item = {
    title: '标题',
    text: '正文',
    author: '',
    platform: 'bili',
    url: '',
    images: [],
    comments: [
      { id: '1', parentId: '', author: '作者', text: '评论内容', likes: '1' },
    ],
    commentStatus: 'completed',
  }
  assert.ok(serializeResults([item], 'csv').includes('作者: 评论内容'))
  assert.deepEqual(
    JSON.parse(serializeResults([item], 'json'))[0].comments,
    item.comments,
  )
})

test('新增平台支持搜索、作品地址与导出，拒绝跨站伪造链接', () => {
  const urls = {
    zhihu: 'https://zhuanlan.zhihu.com/p/123',
    wb: 'https://m.weibo.cn/detail/123',
    tieba: 'https://tieba.baidu.com/p/123',
    ks: 'https://v.kuaishou.com/abc',
  }
  for (const [platform, url] of Object.entries(urls)) {
    assert.equal(validateRequest({ ...request, platform }).platform, platform)
    assert.equal(
      validateRequest({ ...request, platform, mode: 'link', query: url }).limit,
      1,
    )
    assert.throws(() =>
      validateRequest({
        ...request,
        platform,
        mode: 'link',
        query: url
          .replace('.com', '.com.evil.test')
          .replace('.cn', '.cn.evil.test'),
      }),
    )
    assert.ok(
      serializeResults(
        [{ title: '作品', text: '正文', platform, images: [] }],
        'csv',
      ).includes('作品'),
    )
  }
})

test('平台筛选白名单，链接模式忽略筛选，拒绝跨平台与无效值', () => {
  assert.deepEqual(
    validateRequest({ ...request, filters: { sort: 'click', time: '7' } })
      .filters,
    { sort: 'click', time: '7' },
  )
  assert.throws(() => validateRequest({ ...request, filters: { type: '2' } }))
  assert.throws(() => validateRequest({ ...request, filters: { time: '999' } }))
  assert.throws(() => validateRequest({ ...request, filters: [] }))
  assert.deepEqual(
    validateRequest({
      ...request,
      mode: 'link',
      query: 'https://b23.tv/abc',
      filters: { sort: 'click' },
    }).filters,
    {},
  )
})

test('博主主页模式只接受完整主页链接并放宽数量', () => {
  const base = {
    platform: 'dy',
    action: 'collect',
    mode: 'creator',
    limit: 200,
  }
  const query = 'https://www.douyin.com/user/MS4wLjABAAAAabc?from_tab_name=main'
  assert.equal(validateRequest({ ...base, query }).limit, 200)
  assert.deepEqual(validateRequest({ ...base, query }).filters, {})
  for (const bad of [
    'https://www.douyin.com/video/1',
    'https://www.douyin.com/user/self',
    'https://v.douyin.com/abc/',
    'http://www.douyin.com/user/abc',
    'https://evil.com/user/abc',
  ])
    assert.throws(() => validateRequest({ ...base, query: bad }), /主页/)
  assert.throws(() => validateRequest({ ...base, query, limit: 201 }), /1–200/)
  assert.throws(
    () => validateRequest({ ...base, platform: 'bili', query }),
    /主页/,
  )
  assert.throws(
    () => validateRequest({ ...base, mode: 'search', query: 'x', limit: 101 }),
    /1–100/,
  )
})

test('小红书博主主页走博主模式，搜索博主仍只支持抖音', () => {
  const url =
    'https://www.xiaohongshu.com/user/profile/abc?xsec_token=T&xsec_source=pc_note'
  assert.equal(isCreatorUrl(url, 'xhs'), true)
  assert.equal(
    isCreatorUrl('https://www.xiaohongshu.com/explore/abc', 'xhs'),
    false,
  )
  assert.equal(isCreatorUrl(url, 'dy'), false)
  assert.equal(creatorSearchPlatforms.includes('xhs'), true)
  assert.equal(creatorSearchPlatforms.includes('wb'), false)
  const request = validateRequest({
    platform: 'xhs',
    action: 'collect',
    mode: 'creator',
    query: url,
    limit: 20,
    auto: true,
    cursor: 'c',
  })
  assert.equal(request.auto, true)
  assert.equal(request.cursor, 'c')
})

test('翻页位置和自动模式只用于支持分页的平台', () => {
  const query = 'https://www.douyin.com/user/MS4wLjABAAAAabc'
  const base = {
    platform: 'dy',
    action: 'collect',
    mode: 'creator',
    query,
    limit: 5,
  }
  assert.equal(validateRequest({ ...base, cursor: 'c' }).cursor, 'c')
  assert.equal('cursor' in validateRequest(base), false)
  assert.throws(() => validateRequest({ ...base, cursor: 1 }), /翻页/)
  const search = { ...base, mode: 'search', query: 'x' }
  assert.equal(validateRequest({ ...search, cursor: 'c' }).cursor, 'c')
  assert.equal(validateRequest({ ...search, auto: true }).auto, true)
  assert.equal(validateRequest({ ...search, auto: false }).auto, false)
  assert.throws(
    () => validateRequest({ ...search, platform: 'zhihu', cursor: 'c' }),
    /翻页/,
  )
  assert.equal(
    'auto' in validateRequest({ ...search, platform: 'zhihu', auto: true }),
    false,
  )
  assert.equal(
    'auto' in
      validateRequest({
        ...base,
        mode: 'link',
        query: 'https://www.douyin.com/video/123',
        auto: true,
      }),
    false,
  )
})

test('B站博主主页按 UID 识别，分页和自动模式可用', () => {
  for (const url of [
    'https://space.bilibili.com/123',
    'https://space.bilibili.com/123/upload/video',
    'https://space.bilibili.com/123?spm_id_from=333',
  ])
    assert.equal(isCreatorUrl(url, 'bili'), true, url)
  for (const url of [
    'http://space.bilibili.com/123',
    'https://space.bilibili.com/abc',
    'https://www.bilibili.com/video/BV1xx',
  ])
    assert.equal(isCreatorUrl(url, 'bili'), false, url)
  const request = validateRequest({
    platform: 'bili',
    action: 'collect',
    mode: 'creator',
    query: 'https://space.bilibili.com/123',
    limit: 20,
    cursor: 'c',
    auto: true,
  })
  assert.equal(request.cursor, 'c')
  assert.equal(request.auto, true)
})
