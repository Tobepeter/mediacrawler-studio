import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import placeholder from '@/assets/qr-placeholder.svg'
import { cn } from '@/lib/utils'
import { LoginCountdown } from './login-countdown'

// 占位与真码共用尺寸，模糊遮罩明确表示当前不可扫码
export function QrFrame({
  image,
  loading,
  confirming,
  estimateAt,
  loadingLabel,
  children,
  onRetry,
  retryDisabled,
  retryLabel,
}: {
  image?: string
  loading?: boolean
  confirming?: boolean
  estimateAt?: number
  loadingLabel?: string
  children?: ReactNode
  onRetry?: () => void
  retryDisabled?: boolean
  retryLabel?: string
}) {
  const { t } = useTranslation('studio')
  return (
    <div
      className={cn(
        'relative aspect-square w-72 max-w-full overflow-hidden rounded-lg p-4',
        image ? 'bg-white' : 'bg-card',
      )}
      aria-busy={loading}
    >
      <img
        src={image || placeholder}
        alt={image ? t('登录二维码') : ''}
        aria-hidden={!image}
        draggable={false}
        className={cn(
          'size-full object-contain',
          !image && 'select-none opacity-40 blur-sm dark:invert',
        )}
      />
      {(loading || confirming || !image) && (
        <div className='absolute inset-0 flex items-center justify-center bg-card/80 p-6 text-center text-body text-foreground'>
          {confirming ? (
            <span role='status' className='flex flex-col items-center gap-2'>
              <Check className='size-5' aria-hidden='true' />
              {t('请在手机上确认')}
            </span>
          ) : loading ? (
            <span className='flex flex-col items-center gap-2 text-muted-foreground'>
              <Loader2
                aria-hidden='true'
                className='size-4 animate-spin motion-reduce:animate-none'
              />
              <span
                role='status'
                className={estimateAt ? undefined : 'sr-only'}
              >
                {loadingLabel || t('加载中')}
              </span>
              {estimateAt && <LoginCountdown estimateAt={estimateAt} />}
            </span>
          ) : onRetry ? (
            <IconButton
              variant='outline'
              label={retryLabel || t('刷新二维码')}
              disabled={retryDisabled}
              onClick={onRetry}
            >
              <RefreshCw />
            </IconButton>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
}
