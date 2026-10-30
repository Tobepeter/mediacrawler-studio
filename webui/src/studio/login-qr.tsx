import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { QrFrame } from './qr-frame'
import { RefreshCw } from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import type { Platform } from './types'
import { useStudio } from './store'

export function LoginQr({
  platform,
  preparing = false,
}: {
  platform: Platform
  preparing?: boolean
}) {
  const { t } = useTranslation('studio')
  const [attempt, setAttempt] = useState(0)
  const [image, setImage] = useState<string>()
  const [error, setError] = useState<'expired' | 'unavailable'>()
  const [loading, setLoading] = useState(true)
  const [preparationTimedOut, setPreparationTimedOut] = useState(false)
  const [retrying, setRetrying] = useState(false)
  useEffect(() => {
    setPreparationTimedOut(false)
    if (!preparing) return
    const timer = setTimeout(() => setPreparationTimedOut(true), 30_000)
    return () => clearTimeout(timer)
  }, [platform, preparing, attempt])
  useEffect(() => {
    if (preparing) return
    let active = true
    let running = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const capture = async (refresh: boolean) => {
      if (running || !window.studio) return
      running = true
      setLoading(true)
      if (refresh) setImage(undefined)
      setError(undefined)
      try {
        const request = async () => {
          const result = await window.studio!.captureLoginQr(platform, refresh)
          // 明确过期才换码，正常检查不重载页面
          return active && result.code === 'expired' && !refresh
            ? window.studio!.captureLoginQr(platform, true)
            : result
        }
        // IPC 异常也不能让界面无限等待
        const result = await Promise.race([
          request(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('qr timeout')), 35_000)
          }),
        ])
        if (!active) return
        if (result.image) setImage(result.image)
        else if (result.code !== 'cancelled') {
          setImage(undefined)
          setError(result.code === 'expired' ? 'expired' : 'unavailable')
        }
      } catch {
        if (active) {
          setImage(undefined)
          setError('unavailable')
        }
      } finally {
        clearTimeout(timeout)
        running = false
        if (active) setLoading(false)
      }
    }
    void capture(attempt > 0)
    // 只重新截取，避免每分钟强行换码，打断手机上的确认流程
    const timer = setInterval(() => void capture(false), 60_000)
    return () => {
      active = false
      clearInterval(timer)
      clearTimeout(timeout)
    }
  }, [platform, attempt, preparing])
  const waiting = !preparationTimedOut && (preparing || (loading && !image))
  const retry = async () => {
    if (preparing) {
      setRetrying(true)
      try {
        await window.studio?.cancel()
        await useStudio.getState().start('connect')
      } finally {
        setRetrying(false)
      }
    } else setAttempt((value) => value + 1)
  }
  const handleRetry = () =>
    void retry().catch(() => toast.error(t('打开失败，请重试')))
  return (
    <div className='flex flex-col items-center gap-4' aria-busy={waiting}>
      <QrFrame
        image={image}
        loading={waiting}
        onRetry={handleRetry}
        retryDisabled={retrying}
        retryLabel={t(
          preparationTimedOut
            ? '准备超时，请重试'
            : error === 'expired'
              ? '二维码已过期，请刷新'
              : '刷新二维码',
        )}
      />
      <div
        className='flex h-9 items-center gap-2'
        style={{ visibility: waiting || !image ? 'hidden' : 'visible' }}
      >
        <span
          className='text-sm text-muted-foreground'
          style={{ visibility: image ? 'visible' : 'hidden' }}
        >
          {t('扫码登录')}
        </span>
        <IconButton
          label={t('刷新二维码')}
          disabled={waiting || retrying}
          onClick={handleRetry}
        >
          <RefreshCw />
        </IconButton>
      </div>
    </div>
  )
}
