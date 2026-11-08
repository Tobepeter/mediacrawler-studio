import policy from '../../../desktop/health-policy.json'
import type { Platform } from './types'

const key = 'studio-login-health-v1'
const platforms = ['bili', 'dy', 'xhs', 'zhihu', 'wb', 'tieba', 'ks']
type Outcome = 'timeout' | 'success' | 'failed'
type RecordEntry = { id: string; outcome: Outcome; at: number }
type Records = Partial<Record<Platform, RecordEntry[]>>

function read(now: number): Records {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}')
    return Object.fromEntries(
      platforms.map((platform) => [
        platform,
        Array.isArray(value?.[platform])
          ? value[platform]
              .filter(
                (item: RecordEntry) =>
                  typeof item?.id === 'string' &&
                  item.id.length < 100 &&
                  ['timeout', 'success', 'failed'].includes(item.outcome) &&
                  Number.isFinite(item.at) &&
                  now >= item.at &&
                  now - item.at < policy.failure_window_ms,
              )
              .slice(-policy.timeout_threshold)
          : [],
      ]),
    )
  } catch {
    return {}
  }
}

// 同平台、同次尝试去重；成功或非超时失败会打断连续超时
export function recordLoginOutcome(
  platform: Platform,
  id: string,
  outcome: Outcome,
  now = Date.now(),
) {
  const records = read(now)
  const entries = records[platform] || []
  const existing = entries.find((item) => item.id === id)
  if (existing) {
    if (outcome !== 'success' || existing.outcome === outcome) return
    existing.outcome = 'success'
  } else entries.push({ id, outcome, at: now })
  records[platform] = entries.slice(-policy.timeout_threshold)
  try {
    localStorage.setItem(key, JSON.stringify(records))
    if (typeof window !== 'undefined')
      window.dispatchEvent(new Event('studio-login-health'))
  } catch {
    /* 本地统计不可写不影响取码 */
  }
}

export function loginMayBeBroken(platform: Platform, now = Date.now()) {
  const entries = read(now)[platform] || []
  return (
    entries.length >= policy.timeout_threshold &&
    entries.every((item) => item.outcome === 'timeout')
  )
}

export function subscribeLoginHealth(callback: () => void) {
  window.addEventListener('studio-login-health', callback)
  const timer = setInterval(callback, 30_000)
  return () => {
    window.removeEventListener('studio-login-health', callback)
    clearInterval(timer)
  }
}
