import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Inbox, Loader2 } from 'lucide-react'
import { Reveal } from '@/components/common/reveal'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ResultCard } from './result-card'
import { RetryNotice } from './retry-notice'
import { useStudioRoute } from './route'
import { ScrollSentinel } from './scroll-sentinel'
import { useStudio } from './store'
import { ThrottledError, useRetryWait } from './throttle'
import type { Platform } from './types'
import {
  justSwapped,
  useFeed,
  useFeedFreshness,
  useFeedRefreshing,
} from './use-feed'

const gridClass =
  'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
const placeholders = Array.from({ length: 10 }, (_, index) => index)
// 连续排不上时最多自动续几次，之后只留按钮
const AUTO_RESUMES = 3

// 没有搜索结果时的默认内容；只跟滚动翻页，不写历史
export function FeedList({ platform }: { platform: Platform }) {
  const { t } = useTranslation('studio')
  const feed = useFeed(platform)
  // 隐藏的 Tab 量不出高度，切回来时重新量
  const current = useStudio((state) => state.platform === platform)
  const route = useStudioRoute()
  const paused = useStudio(
    (state) => !!state.selected || state.creatorSearchOpen,
  )
  const { fetchNextPage } = feed
  const loadMore = useCallback(
    () => void fetchNextPage({ cancelRefetch: false }),
    [fetchNextPage],
  )
  const items = feed.data?.items || []
  // 静默换内容时直接显示，不重播入场动画
  const instant = justSwapped(platform)
  useFeedFreshness(platform, current)
  const refreshing = useFeedRefreshing(platform)
  // 被限流时等倒计时结束，用户再滚动或调整窗口才继续；次数用完只留按钮
  const resumeBase = useRef({
    items: items.length,
    errors: feed.errorUpdateCount,
  })
  if (resumeBase.current.items !== items.length)
    resumeBase.current = {
      items: items.length,
      errors: feed.errorUpdateCount,
    }
  const failure = feed.isFetchNextPageError ? feed.error : null
  const wait = useRetryWait(failure)
  const resumable =
    failure instanceof ThrottledError &&
    failure.resumable &&
    wait === 0 &&
    feed.errorUpdateCount - resumeBase.current.errors < AUTO_RESUMES
  if (!items.length && (feed.isPending || feed.isFetching))
    return (
      <div className={`${gridClass} pb-2 pt-1`} role='status' aria-busy='true'>
        <span className='sr-only'>{t('加载中')}</span>
        {placeholders.map((key) => (
          <Skeleton key={key} className='h-72 rounded-xl' />
        ))}
      </div>
    )
  if (!items.length)
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-4 py-16 text-muted-foreground'>
        <Inbox className='size-6' aria-hidden='true' />
        {feed.isError ? (
          <RetryNotice error={feed.error} onRetry={() => void feed.refetch()} />
        ) : (
          <>
            <span role='status'>{t('暂时没有推荐内容')}</span>
            <Button variant='outline' onClick={() => void feed.refetch()}>
              {t('重试')}
            </Button>
          </>
        )}
      </div>
    )
  const more = feed.hasNextPage && !feed.data?.stalled
  return (
    <div className='pb-2 pt-1'>
      <div className={gridClass}>
        {items.map((item, index) => (
          <Reveal
            key={item.id}
            delay={Math.min(index, 4) * 40}
            instant={instant}
          >
            <ResultCard item={item} hidePlatform />
          </Reveal>
        ))}
      </div>
      <ScrollSentinel
        key={`${items.length}:${feed.errorUpdateCount}`}
        active={
          !!more &&
          !feed.isFetchingNextPage &&
          !refreshing &&
          (!failure || resumable) &&
          !paused &&
          route !== 'history'
        }
        needsScroll
        fillScreens={current && !failure ? 1 : undefined}
        screens={2}
        onReach={loadMore}
      >
        {failure ? (
          <RetryNotice error={failure} onRetry={loadMore} label='继续加载' />
        ) : feed.isFetchingNextPage ? (
          <span className='inline-flex h-9 items-center' role='status'>
            <Loader2
              className='size-4 animate-spin motion-reduce:animate-none'
              aria-hidden='true'
            />
            <span className='sr-only'>{t('加载中')}</span>
          </span>
        ) : (
          !more && t('没有更多了')
        )}
      </ScrollSentinel>
    </div>
  )
}
