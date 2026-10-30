import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { QrFrame } from './qr-frame'
import { LoginQr } from './login-qr'
import { platformNames, useStudio } from './store'
import { PlatformIcon } from './platform-icon'

export function LoginPanel() {
  const { t } = useTranslation('studio')
  const {
    platform,
    loginView,
    accounts,
    ready,
    busy,
    pending,
    attempted,
    start,
  } = useStudio()
  const view = loginView?.platform === platform ? loginView : null
  const checking = !ready || accounts[platform] === 'saved'
  const [checkTimedOut, setCheckTimedOut] = useState(false)
  useEffect(() => {
    setCheckTimedOut(false)
    if (!checking) return
    const timer = setTimeout(() => setCheckTimedOut(true), 45_000)
    return () => clearTimeout(timer)
  }, [checking, platform])
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
        {view?.mode === 'qrcode' ? (
          <LoginQr
            key={platform}
            platform={platform}
            preparing={view.preparing}
          />
        ) : checking && !checkTimedOut ? (
          <div className='flex flex-col items-center gap-4'>
            <QrFrame loading />
            <div className='h-9' />
          </div>
        ) : (
          <div className='flex flex-col items-center gap-4'>
            <QrFrame
              loading={pending || (!checkTimedOut && !attempted[platform])}
              onRetry={() => void start('connect')}
              retryDisabled={!window.studio || !ready || busy || pending}
            />
            <div className='h-9' />
          </div>
        )}
      </div>
    </section>
  )
}
