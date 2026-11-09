import { useEffect, useState } from 'react'
import { t } from '@/i18n/studio'

export interface ThrottleInfo {
  code: string
  retryAfter: number
  message: string
}

// 排队超限或平台冷却不算故障，带上还要等多久，由调用方决定继续、重试还是提示
export class ThrottledError extends Error {
  code: string
  retryAfter: number
  until: number

  constructor({ code, retryAfter, message }: ThrottleInfo) {
    super(message)
    this.code = code
    this.retryAfter = retryAfter
    this.until = Date.now() + retryAfter * 1000
  }

  // 要等很久的（通常是平台验证）不值得自动重试
  get resumable() {
    return this.retryAfter <= 60
  }
}

export const formatWait = (seconds: number) =>
  seconds < 60
    ? t('约 {{count}} 秒', { count: seconds })
    : t('约 {{count}} 分钟', { count: Math.ceil(seconds / 60) })

// 还要等多少秒，非限流错误或已到时间返回 0
export function useRetryWait(error: unknown) {
  const until = error instanceof ThrottledError ? error.until : 0
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (until <= Date.now()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    const stop = setTimeout(
      () => clearInterval(timer),
      until - Date.now() + 1000,
    )
    return () => {
      clearInterval(timer)
      clearTimeout(stop)
    }
  }, [until])
  return Math.max(0, Math.ceil((until - now) / 1000))
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 静默任务排不上时按平台给的时间再试，次数用完或等太久就放弃，不打扰用户
export async function retrySilently<T>(
  task: () => Promise<T>,
  {
    attempts = 3,
    active = () => true,
  }: { attempts?: number; active?: () => boolean } = {},
): Promise<T | undefined> {
  for (let left = attempts; left > 0 && active(); left -= 1) {
    try {
      return await task()
    } catch (error) {
      if (!(error instanceof ThrottledError) || !error.resumable || left === 1)
        return undefined
      await wait(error.retryAfter * 1000)
    }
  }
  return undefined
}
