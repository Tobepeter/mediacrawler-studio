import searchOptions from './search-options.json' with { type: 'json' }
import capabilities from './platform-capabilities.json' with { type: 'json' }

export function validateFilters(platform, filters = {}) {
  const fields = searchOptions[platform]
  if (
    !fields ||
    !filters ||
    typeof filters !== 'object' ||
    Array.isArray(filters)
  )
    throw new Error('筛选条件无效')
  for (const [key, value] of Object.entries(filters)) {
    if (
      !Object.hasOwn(fields, key) ||
      !fields[key].options.some((item) => item.value === value)
    )
      throw new Error('筛选条件无效')
  }
  return { ...filters }
}

export const platforms = {
  bili: {
    name: 'B站',
    url: 'https://www.bilibili.com',
    cookie: 'SESSDATA',
    hosts: capabilities.hosts.bili,
  },
  dy: {
    name: '抖音',
    url: 'https://www.douyin.com',
    cookie: 'sessionid',
    hosts: capabilities.hosts.dy,
  },
  xhs: {
    name: '小红书',
    url: 'https://www.xiaohongshu.com',
    cookie: 'web_session',
    hosts: capabilities.hosts.xhs,
  },
  zhihu: {
    name: '知乎',
    url: 'https://www.zhihu.com',
    cookie: 'z_c0',
    hosts: capabilities.hosts.zhihu,
  },
  wb: {
    name: '微博',
    url: 'https://www.weibo.com',
    cookie: 'SUB',
    cookieUrls: ['https://www.weibo.com', 'https://m.weibo.cn'],
    hosts: capabilities.hosts.wb,
  },
  tieba: {
    name: '贴吧',
    url: 'https://tieba.baidu.com',
    cookie: 'BDUSS',
    hosts: capabilities.hosts.tieba,
  },
  ks: {
    name: '快手',
    url: 'https://www.kuaishou.com',
    cookie: 'passToken',
    hosts: capabilities.hosts.ks,
  },
}

export const creatorPlatforms = capabilities.creator
export const creatorSearchPlatforms = capabilities.creatorSearch
export const feedPlatforms = capabilities.feed
export const creatorLimit = capabilities.creatorLimit

// 仅完整主页链接；分享短链要解析后才知道是作品还是主页
export function isCreatorUrl(value, platform = 'dy') {
  const pattern = capabilities.creatorUrl[platform]
  return (
    typeof value === 'string' &&
    !!pattern &&
    new RegExp(pattern, 'i').test(value.trim())
  )
}

export function isPlatformUrl(value, platform) {
  try {
    const url = new URL(value)
    const hosts = platform
      ? platforms[platform]?.hosts
      : Object.values(platforms).flatMap((item) => item.hosts)
    return (
      url.protocol === 'https:' &&
      hosts?.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
  } catch {
    return false
  }
}

export function validateRequest(value) {
  if (!value || !Object.hasOwn(platforms, value.platform))
    throw new Error('请选择平台')
  if (!['collect', 'connect'].includes(value.action))
    throw new Error('不支持的操作')
  if (
    value.loginMode !== undefined &&
    !['embedded', 'window', 'qrcode'].includes(value.loginMode)
  )
    throw new Error('不支持的登录方式')
  const query = typeof value.query === 'string' ? value.query.trim() : ''
  const mode = ['link', 'creator'].includes(value.mode) ? value.mode : 'search'
  const limit = Number(value.limit)
  const maximum = mode === 'creator' ? creatorLimit : 100
  const paged = mode !== 'link' && creatorPlatforms.includes(value.platform)
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum)
    throw new Error(`采集数量需为 1–${maximum} 条`)
  if (value.action === 'collect') {
    if (!query || query.length > 2000) throw new Error('请输入关键词或作品链接')
    if (mode === 'link' && !isPlatformUrl(query, value.platform))
      throw new Error('请粘贴所选平台的 HTTPS 作品链接')
    if (mode === 'creator' && !isCreatorUrl(query, value.platform))
      throw new Error('请粘贴博主主页的完整链接')
  }
  if (
    value.cursor !== undefined &&
    (!paged ||
      typeof value.cursor !== 'string' ||
      !value.cursor ||
      value.cursor.length > 4096)
  )
    throw new Error('翻页位置无效，请重新采集')
  for (const key of ['comments', 'replies']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new Error('采集选项无效')
  }
  return {
    loginMode: value.loginMode || 'embedded',
    silent: value.action === 'connect' && value.silent === true,
    comments: value.comments === true,
    replies: value.comments === true && value.replies === true,
    filters:
      mode === 'search' ? validateFilters(value.platform, value.filters) : {},
    platform: value.platform,
    action: value.action,
    mode,
    query,
    limit: mode === 'link' ? 1 : limit,
    ...(value.cursor ? { cursor: value.cursor } : {}),
    ...(typeof value.auto === 'boolean' && paged ? { auto: value.auto } : {}),
  }
}

export function serializeResults(items, format) {
  if (format === 'json') return JSON.stringify(items, null, 2)
  const columns = [
    '标题',
    '正文',
    '作者',
    '平台',
    '来源',
    '图片',
    '评论',
    '评论状态',
  ]
  const cell = (value) => {
    const str = String(value ?? '')
    const safe = /^[\s]*[=+@-]/.test(str) ? `'${str}` : str
    return `"${safe.replaceAll('"', '""')}"`
  }
  const rows = items.map((item) => [
    item.title,
    item.text,
    item.author,
    platforms[item.platform].name,
    item.url,
    item.images.join('\n'),
    (item.comments || [])
      .map(
        (comment) =>
          `${comment.parentId ? '↳ ' : ''}${comment.author}: ${comment.text}`,
      )
      .join('\n'),
    {
      pending: '等待采集',
      running: '采集中',
      completed: '已完成',
      error: '未取全',
      cancelled: '已取消',
    }[item.commentStatus] || '未采集',
  ])
  return (
    '\ufeff' +
    [columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
  )
}
