import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// 预计耗时独立于真实超时；估计用尽也不宣布请求完成
export function LoginCountdown({ estimateAt }: { estimateAt: number }) {
  const { t } = useTranslation('studio')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [estimateAt])
  const seconds = Math.max(1, Math.ceil((estimateAt - now) / 1000))
  return (
    <span className='tabular-nums'>
      {seconds > 1
        ? t('预计还需 {{seconds}} 秒', { seconds })
        : t('即将完成，请稍候')}
    </span>
  )
}
