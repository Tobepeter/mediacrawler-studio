import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import { cn } from '@/lib/utils'
import { platformBlocked, useStudio } from './store'
import { formatWait, useRetryWait } from './throttle'
import type { Platform } from './types'
import { useFeed, useFeedRefresh } from './use-feed'

export function FeedRefresh({ platform }: { platform: Platform }) {
  const { t } = useTranslation('studio')
  const feed = useFeed(platform)
  const refresh = useFeedRefresh(platform)
  const blocked = useStudio((state) => platformBlocked(state, platform))
  const wait = useRetryWait(refresh.error)
  return (
    <IconButton
      label={
        wait > 0
          ? t('{{wait}}后可刷新', { wait: formatWait(wait) })
          : t('刷新推荐')
      }
      disabled={refresh.isPending || wait > 0 || blocked || !feed.data}
      onClick={() => refresh.mutate()}
    >
      <RefreshCw
        className={cn(
          refresh.isPending && 'animate-spin motion-reduce:animate-none',
        )}
      />
    </IconButton>
  )
}
