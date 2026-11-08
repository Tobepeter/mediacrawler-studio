import policy from '../../../desktop/health-policy.json'
import type { Platform } from './types'

const key = 'studio-login-estimates-v1'
const platforms: Platform[] = [
  'bili',
  'dy',
  'xhs',
  'zhihu',
  'wb',
  'tieba',
  'ks',
]
export const loginTimeout = policy.qr_timeout_ms
interface Sample {
  count: number
  mean: number
}

function read(): Partial<Record<Platform, Sample>> {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '{}')
    return Object.fromEntries(
      platforms.flatMap((platform) => {
        const sample = stored?.[platform]
        return sample &&
          Number.isInteger(sample.count) &&
          sample.count > 0 &&
          sample.count <= 100 &&
          Number.isFinite(sample.mean) &&
          sample.mean > 0 &&
          sample.mean <= loginTimeout
          ? [[platform, sample]]
          : []
      }),
    )
  } catch {
    return {}
  }
}

export function loginEstimate(platform: Platform): number {
  return Math.min(20_000, Math.max(3000, read()[platform]?.mean || 8000))
}

export function recordLoginDuration(platform: Platform, milliseconds: number) {
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds <= 0 ||
    milliseconds > loginTimeout
  )
    return
  const samples = read()
  const old = samples[platform]
  const count = Math.min(100, (old?.count || 0) + 1)
  samples[platform] = {
    count,
    mean: old ? old.mean + (milliseconds - old.mean) / count : milliseconds,
  }
  try {
    localStorage.setItem(key, JSON.stringify(samples))
  } catch {
    /* 统计不可写不影响登录 */
  }
}
