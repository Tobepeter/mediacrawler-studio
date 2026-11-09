import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { translateMessage } from '@/i18n/studio'
import { cn } from '@/lib/utils'
import { ipcFailure } from './ipc-failure'
import { formatWait, ThrottledError, useRetryWait } from './throttle'

const verification = ['RATE_COOLDOWN', 'SEARCH_VERIFICATION_REQUIRED']

export function failureText(error: unknown) {
  if (!(error instanceof ThrottledError))
    return translateMessage(ipcFailure(error))
  return translateMessage(
    verification.includes(error.code)
      ? '平台要求验证，暂时不能访问'
      : '请求太频繁，稍等一下',
  )
}

// 失败原因和重试按钮放在出错的位置；限流时倒计时结束才能点，不弹全局提示
export function RetryNotice(props: {
  error: unknown
  onRetry: () => void
  label?: string
}) {
  const { error, onRetry, label = '重试' } = props
  const { t } = useTranslation('studio')
  const wait = useRetryWait(error)
  return (
    <span className='flex min-w-0 items-center gap-3'>
      <span
        role='alert'
        className={cn(
          'truncate',
          error instanceof ThrottledError
            ? 'text-muted-foreground'
            : 'text-destructive',
        )}
      >
        {failureText(error)}
      </span>
      <Button
        variant='outline'
        className='shrink-0'
        disabled={wait > 0}
        onClick={onRetry}
      >
        {wait > 0
          ? t('{{wait}}后可继续', { wait: formatWait(wait) })
          : t(label)}
      </Button>
    </span>
  )
}
