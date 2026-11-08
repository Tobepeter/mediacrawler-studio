import type { Platform } from './types'

export const creatorPlatforms: readonly Platform[] = ['dy']
export const creatorLimit = 200
export const creatorPresets = [20, 50, 100, 200] as const

// 与主进程校验保持一致；分享短链无法在输入时区分作品和主页
export function isCreatorUrl(value: string) {
  try {
    const url = new URL(value.trim())
    return (
      url.protocol === 'https:' &&
      /(^|\.)douyin\.com$/.test(url.hostname) &&
      url.hostname !== 'v.douyin.com' &&
      /^\/user\/(?!self\/?$)[^/]+\/?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

export const platformHosts: Record<Platform, string[]> = {
  bili: ['bilibili.com', 'b23.tv'],
  dy: ['douyin.com', 'iesdouyin.com'],
  xhs: ['xiaohongshu.com', 'xhslink.com'],
  zhihu: ['zhihu.com'],
  wb: ['weibo.com', 'weibo.cn'],
  tieba: ['tieba.baidu.com'],
  ks: ['kuaishou.com', 'gifshow.com'],
}

export function platformOfUrl(value: string): Platform | undefined {
  try {
    const host = new URL(value.trim()).hostname
    return (Object.keys(platformHosts) as Platform[]).find((id) =>
      platformHosts[id].some(
        (domain) => host === domain || host.endsWith(`.${domain}`),
      ),
    )
  } catch {
    return undefined
  }
}

export function isDouyinShortLink(value: string) {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && url.hostname === 'v.douyin.com'
  } catch {
    return false
  }
}

// App 分享的是整段文案；只提取已知平台的链接，普通关键词原样保留
export function extractShareUrl(input: string) {
  if (/^https?:\/\//i.test(input.trim())) return input
  const found = input.match(/https?:\/\/[^\s，。！？）】"']+/i)?.[0]
  if (!found || !platformOfUrl(found)) return input
  return found.replace(/^http:/i, 'https:')
}
