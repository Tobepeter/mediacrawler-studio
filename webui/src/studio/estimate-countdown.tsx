import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// 预计耗时独立于真实超时；估计用尽也不宣布请求完成
export function EstimateCountdown(props: {
  estimateAt: number
  overdue?: string
}) {
  const { estimateAt, overdue } = props
  const { t } = useTranslation('studio')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [estimateAt])
  const seconds = Math.ceil((estimateAt - now) / 1000)
  return (
    <span className='tabular-nums'>
      {seconds > (overdue ? 0 : 1)
        ? t('预计还需 {{seconds}} 秒', { seconds })
        : overdue || t('即将完成，请稍候')}
    </span>
  )
}
