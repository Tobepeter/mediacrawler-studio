import { PlatformLogin } from './platform-login'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { loginMayBeBroken, subscribeLoginHealth } from './login-health'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { QrFrame } from './qr-frame'
import { LoginQr } from './login-qr'
import { platformNames, useStudio } from './store'
import { PlatformIcon } from './platform-icon'
import { loginEstimate, loginTimeout } from './login-estimate'

export function LoginPanel() {
  const taskLogin = useStudio(
    (state) =>
      state.tasks[state.platform]?.status === 'auth' &&
      state.tasks[state.platform]?.action === 'collect',
  )
  return window.studio?.ensureLogin && !taskLogin ? (
    <PlatformLogin />
  ) : (
    <LegacyLoginPanel />
  )
}

function LegacyLoginPanel() {
  const { t } = useTranslation('studio')
  const {
    platform,
    loginView,
    accounts,
    ready,
    working,
    requests,
    pending: clearing,
    attempted,
    start,
    tasks,
    views,
  } = useStudio()
  const suspicious = useSyncExternalStore(subscribeLoginHealth, () =>
    loginMayBeBroken(platform),
  )
  const view = loginView?.platform === platform ? loginView : null
  const task = tasks[platform]
  const busy = !!working[platform]
  const pending = clearing || !!requests[platform]
  const checking = !ready || accounts[platform] === 'saved'
  const waiting = checking || pending || !attempted[platform]
  const failed = task?.platform === platform && task.status === 'error'
  const [checkTimedOut, setCheckTimedOut] = useState(false)
  const [estimateAt, setEstimateAt] = useState(
    () => Date.now() + loginEstimate(platform),
  )
  useEffect(() => {
    setCheckTimedOut(false)
    if (!waiting) return
    setEstimateAt(Date.now() + loginEstimate(platform))
    const timer = setTimeout(() => setCheckTimedOut(true), loginTimeout)
    return () => clearTimeout(timer)
  }, [waiting, platform])
  return (
    <section
      className='flex flex-1 flex-col items-center justify-center gap-6 py-12'
      aria-label={t('扫码登录')}
    >
      <div className='flex items-center gap-2 text-lg font-medium'>
        <PlatformIcon platform={platform} />
        {t(platformNames[platform])}
      </div>
      <div className='flex min-h-80 w-80 max-w-full flex-col items-center justify-center gap-4'>
        {view?.mode === 'qrcode' ||
        (task?.status === 'auth' && task.loginMode === 'qrcode') ? (
          <LoginQr
            key={`${platform}:${task?.startedAt || 0}`}
            platform={platform}
            preparing={view?.preparing}
            startedAt={task?.platform === platform ? task.startedAt : undefined}
          />
        ) : checking && !checkTimedOut ? (
          <div className='flex flex-col items-center gap-4'>
            <QrFrame
              loading
              estimateAt={estimateAt}
              loadingLabel={t('正在检查登录状态')}
            />
            <div className='h-9' />
          </div>
        ) : (
          <div className='flex flex-col items-center gap-4'>
            <QrFrame
              loading={!checkTimedOut && waiting}
              estimateAt={estimateAt}
              loadingLabel={t('正在连接平台')}
              onRetry={() => void start('connect')}
              retryDisabled={!window.studio || !ready || busy || pending}
            />
            <div className='flex h-9 items-center text-sm text-muted-foreground'>
              {!suspicious &&
                (checkTimedOut ||
                views[platform].error === '获取二维码超时，请重试' ||
                (task?.platform === platform &&
                  task.message === '获取二维码超时，请重试')
                  ? t('获取超时，请重试')
                  : failed && t('暂时无法获取二维码，请重试'))}
            </div>
          </div>
        )}
      </div>
      {suspicious && (
        <div
          className='flex max-w-sm items-center gap-2 text-sm text-muted-foreground'
          role='status'
        >
          <span>{t('连续获取超时，登录方式可能需要更新')}</span>
          <Button
            variant='link'
            className='shrink-0'
            onClick={() =>
              void window.studio
                ?.openSource(
                  'https://github.com/Tobepeter/mediacrawler-studio/issues',
                )
                .catch(() => toast.error(t('打开失败，请重试')))
            }
          >
            {t('反馈问题')}
          </Button>
        </div>
      )}
    </section>
  )
}
