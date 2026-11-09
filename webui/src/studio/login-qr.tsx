import { recordLoginOutcome, loginMayBeBroken } from './login-health'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import { QrFrame } from './qr-frame'
import type { Platform } from './types'
import { useStudio } from './store'
import {
  loginEstimate,
  loginTimeout,
  recordLoginDuration,
} from './login-estimate'

export function LoginQr({
  platform,
  preparing = false,
  startedAt,
}: {
  platform: Platform
  preparing?: boolean
  startedAt?: number
}) {
  const { t } = useTranslation('studio')
  const [attempt, setAttempt] = useState(0)
  const [attemptStarted, setAttemptStarted] = useState(
    () => startedAt || Date.now(),
  )
  const [estimate, setEstimate] = useState(() => loginEstimate(platform))
  const [image, setImage] = useState<string>()
  const [error, setError] = useState<'expired' | 'unavailable' | 'timeout'>()
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const sampled = useRef(false)
  const deadline = attemptStarted + loginTimeout

  useEffect(() => {
    if (image || error || confirming) return
    const timer = setTimeout(
      () => {
        recordLoginOutcome(
          platform,
          `${startedAt}:${attemptStarted}`,
          'timeout',
        )
        setError('timeout')
        setLoading(false)
        const state = useStudio.getState()
        const task = state.tasks[platform]
        if (
          task?.platform === platform &&
          task.action === 'connect' &&
          task.startedAt === startedAt
        ) {
          state.updateView({ error: '获取二维码超时，请重试' }, platform)
          void window.studio?.cancel(platform).catch(() => {})
        }
      },
      Math.max(0, deadline - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [deadline, image, error, confirming, platform, startedAt, attemptStarted])

  useEffect(() => {
    if (preparing) return
    let active = true
    let running = false
    let hasImage = false
    let scanned = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const capture = async (refresh: boolean) => {
      if (running || scanned || !window.studio) return
      running = true
      setLoading(true)
      setError(undefined)
      try {
        const request = async () => {
          const result = await window.studio!.captureLoginQr(platform, refresh)
          return result
        }
        const result = await Promise.race([
          request(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('qr timeout')),
              hasImage ? loginTimeout : Math.max(0, deadline - Date.now()),
            )
          }),
        ])
        if (
          !active ||
          (!hasImage && Date.now() >= deadline) ||
          result.code === 'cancelled'
        )
          return
        if (result.code === 'confirming') {
          scanned = true
          setConfirming(true)
          return
        }
        if (result.code === 'pending' && hasImage) return
        hasImage = !!result.image
        if (result.image) {
          recordLoginOutcome(
            platform,
            `${startedAt}:${attemptStarted}`,
            'success',
          )
          setImage(result.image)
          if (!sampled.current) {
            recordLoginDuration(platform, Date.now() - attemptStarted)
            sampled.current = true
          }
        } else {
          recordLoginOutcome(
            platform,
            `${startedAt}:${attemptStarted}`,
            'failed',
          )
          setImage(undefined)
          setError(result.code === 'expired' ? 'expired' : 'unavailable')
        }
      } catch (failure) {
        hasImage = false
        if (active) {
          recordLoginOutcome(
            platform,
            `${startedAt}:${attemptStarted}`,
            failure instanceof Error && failure.message === 'qr timeout'
              ? 'timeout'
              : 'failed',
          )
          setImage(undefined)
          setError(
            failure instanceof Error && failure.message === 'qr timeout'
              ? 'timeout'
              : 'unavailable',
          )
        }
      } finally {
        clearTimeout(timeout)
        running = false
        if (active) setLoading(false)
      }
    }
    void capture(attempt > 0)
    const timer = setInterval(() => {
      if (hasImage) void capture(false)
    }, 60_000)
    return () => {
      active = false
      clearInterval(timer)
      clearTimeout(timeout)
    }
  }, [platform, attempt, preparing, deadline, attemptStarted, startedAt])

  const waiting = !error && (preparing || (loading && !image))
  const retry = async () => {
    if (preparing || error === 'timeout') {
      setRetrying(true)
      try {
        await window.studio?.cancel(platform)
        if (useStudio.getState().platform === platform)
          await useStudio.getState().start('connect')
      } finally {
        setRetrying(false)
      }
    } else {
      sampled.current = false
      setImage(undefined)
      setError(undefined)
      setLoading(true)
      setAttemptStarted(Date.now())
      setEstimate(loginEstimate(platform))
      setAttempt((value) => value + 1)
    }
  }
  const handleRetry = () =>
    void retry().catch(() => {
      if (
        useStudio.getState().platform === platform &&
        document.visibilityState === 'visible'
      )
        toast.error(t('打开失败，请重试'))
    })
  return (
    <div className='flex flex-col items-center gap-4' aria-busy={waiting}>
      <QrFrame
        image={image}
        confirming={confirming}
        loading={waiting}
        estimateAt={attemptStarted + estimate}
        loadingLabel={t(preparing ? '正在连接平台' : '正在获取二维码')}
        onRetry={handleRetry}
        retryDisabled={retrying}
        retryLabel={t(
          error === 'timeout'
            ? '获取超时，请重试'
            : error === 'expired'
              ? '二维码已过期，请刷新'
              : '刷新二维码',
        )}
      />
      <div className='flex h-9 items-center gap-2 text-body text-muted-foreground'>
        {!waiting && !image && error && !loginMayBeBroken(platform) && (
          <span>
            {t(
              error === 'timeout'
                ? '获取超时，请重试'
                : '暂时无法获取二维码，请重试',
            )}
          </span>
        )}
        {image && !confirming && (
          <>
            <span>{t('扫码登录')}</span>
            <IconButton
              label={t('刷新二维码')}
              disabled={waiting || retrying}
              onClick={handleRetry}
            >
              <RefreshCw />
            </IconButton>
          </>
        )}
      </div>
    </div>
  )
}
