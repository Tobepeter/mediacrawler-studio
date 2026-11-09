import capabilities from '../../../desktop/platform-capabilities.json'
import type { Platform } from './types'

export const creatorPlatforms = capabilities.creator as readonly Platform[]
export const creatorSearchPlatforms =
  capabilities.creatorSearch as readonly Platform[]
export const creatorLimit = capabilities.creatorLimit
export const creatorPresets = [20, 50, 100, 200] as const
export const autoBatchSize = 20

export const isAutoForm = (form: {
  platform: Platform
  mode: string
  auto?: boolean
}) =>
  creatorPlatforms.includes(form.platform) &&
  form.mode !== 'link' &&
  form.auto !== false

// 规则与主进程共用；分享短链无法在输入时区分作品和主页
const creatorUrls = Object.values(capabilities.creatorUrl).map(
  (pattern) => new RegExp(pattern, 'i'),
)

export function isCreatorUrl(value: string) {
  return creatorUrls.some((pattern) => pattern.test(value.trim()))
}

export const platformHosts = capabilities.hosts as Record<Platform, string[]>

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

export function isShareShortLink(value: string) {
  try {
    const url = new URL(value.trim())
    return (
      url.protocol === 'https:' &&
      capabilities.shareHosts.includes(url.hostname)
    )
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
