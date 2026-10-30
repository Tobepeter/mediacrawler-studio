import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw } from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import placeholder from '@/assets/qr-placeholder.svg'
import { cn } from '@/lib/utils'

// 占位与真码共用尺寸，模糊遮罩明确表示当前不可扫码
export function QrFrame({
  image,
  loading,
  children,
  onRetry,
  retryDisabled,
  retryLabel,
}: {
  image?: string
  loading?: boolean
  children?: ReactNode
  onRetry?: () => void
  retryDisabled?: boolean
  retryLabel?: string
}) {
  const { t } = useTranslation('studio')
  return (
    <div
      className='relative aspect-square w-72 max-w-full overflow-hidden rounded-lg bg-white p-4'
      aria-busy={loading}
    >
      <img
        src={image || placeholder}
        alt={image ? t('登录二维码') : ''}
        aria-hidden={!image}
        draggable={false}
        className={cn(
          'size-full object-contain',
          !image && 'select-none opacity-40 blur-sm',
        )}
      />
      {(loading || !image) && (
        <div className='absolute inset-0 flex items-center justify-center bg-white/70 p-6 text-center text-sm text-black/60'>
          {loading ? (
            <span role='status'>
              <Loader2
                aria-hidden='true'
                className='size-4 animate-spin motion-reduce:animate-none'
              />
              <span className='sr-only'>{t('加载中')}</span>
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
