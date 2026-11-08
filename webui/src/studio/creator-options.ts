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
