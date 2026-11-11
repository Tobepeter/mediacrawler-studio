import { useTranslation } from 'react-i18next'
import { Reveal } from '@/components/common/reveal'
import { memo } from 'react'
import { translateMessage } from '@/i18n/studio'
import { useStudioRoute } from './route'
import { Inbox, Loader2 } from 'lucide-react'
import { StableLabel } from '@/components/common/stable-label'
import { Button } from '@/components/ui/button'
import {
  accountChecking,
  activeStatuses,
  platformBusy,
  platformIds,
  useStudio,
} from './store'
import type { Platform } from './types'
import { matchesKeyword } from './creator-ui'
import { feedPlatforms } from './creator-options'
import { FeedList } from './feed-list'
import { isCoverReady } from './cover-preload'
import { ResultCard } from './result-card'
import { ScrollSentinel } from './scroll-sentinel'

export function Results() {
  const { t } = useTranslation('studio')

  const platform = useStudio((state) => state.platform)
  return (
    <section className='flex flex-1 flex-col' aria-label={t('结果')}>
      {/* 各平台卡片保留挂载，切回时复用已加载的封面 */}
      {platformIds.map((id) => (
        <div
          key={id}
          className={id === platform ? 'flex flex-1 flex-col' : 'hidden'}
          hidden={id !== platform}
        >
          <ResultItems platform={id} />
        </div>
      ))}
    </section>
  )
}

const ResultItems = memo(function ResultItems({
  platform,
}: {
  platform: Platform
}) {
  const { t } = useTranslation('studio')

  const page = useStudio((state) => state.pages[platform])
  const results = page?.results || []
  const active = activeStatuses.includes(page?.task.status || '')
  const busy = useStudio((state) => platformBusy(state, platform))
  // 博主页每张卡片的平台和作者都相同，改为展示点赞帮助挑选
  const creatorTask = page?.task.mode === 'creator' ? page.task : null
  // 自动模式接近底部就继续，看不到按钮；用户停止、失败或一批没有新内容时才交给手动
  const pagedTask = creatorTask || (page?.task.auto ? page.task : null)
  // 旧博主记录没有这个字段，只有明确选了数字的才是固定数量
  const keyword = useStudio((state) =>
    page ? state.creatorFilters[page.id] || '' : '',
  )
  // 只有空格不算在搜索，否则续采入口会消失
  const filter = keyword.trim()
  const shown = filter
    ? results.filter((item) => matchesKeyword(item, filter))
    : results
  const autoMode = !!pagedTask && pagedTask.auto !== false
  // 看详情、找博主或翻历史时暂停：续采占用平台，会让这些操作失败或被打断
  const route = useStudioRoute()
  const paused = useStudio(
    (state) => !!state.selected || state.creatorSearchOpen,
  )
  // 打开应用或历史看到的旧记录，要等用户真的滚动才请求，不能一打开就访问平台
  const fromEarlier = (pagedTask?.finishedAt ?? 0) < sessionStart
  const autoReady =
    autoMode &&
    !!pagedTask.nextCursor &&
    !pagedTask.stalled &&
    ['completed', 'restored'].includes(pagedTask.status)
  const checking = useStudio((state) => accountChecking(state, platform))
  const continueLabel = t('继续采集 {{count}} 条', {
    count: pagedTask?.limit,
  })
  const moreLabels = [t('采集中'), t('重试'), t('加载更多'), continueLabel]
  const hasFeed = feedPlatforms.includes(platform)
  return (
    <>
      {/* 看搜索或博主结果时推荐流也留着，否则加载被取消，返回时又要从头转圈 */}
      {hasFeed && (
        <div className={page ? 'hidden' : 'flex flex-1 flex-col'}>
          <FeedList platform={platform} visible={!page} />
        </div>
      )}
      {/* 没有推荐流的平台验证期间留空，不闪“暂无结果” */}
      {!page && (hasFeed || checking) ? null : !results.length ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-4 py-16 text-muted-foreground'>
          {active ? (
            <Loader2
              className='size-6 animate-spin motion-reduce:animate-none'
              aria-hidden='true'
            />
          ) : (
            <Inbox className='size-6' aria-hidden='true' />
          )}
          <span role='status'>{active ? t('等待结果') : t('暂无结果')}</span>
        </div>
      ) : (
        <div className='pb-2 pt-1'>
          {!shown.length && (
            <p
              className='py-16 text-center text-muted-foreground'
              role='status'
            >
              {t('没有匹配的作品')}
            </p>
          )}
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'>
            {shown.map((item, index) => (
              <Reveal
                key={`${page?.id}:${item.id}`}
                delay={Math.min(index, 4) * 40}
                // 返回列表时封面都显示过，不重播入场动画
                instant={isCoverReady(item.images[0])}
              >
                <ResultCard item={item} creatorPage={!!creatorTask} />
              </Reveal>
            ))}
          </div>
          {/* 搜索只看已采的内容，不触发继续采集 */}
          {pagedTask && !filter && (
            <ScrollSentinel
              key={`${page?.id}:${results.length}`}
              active={autoReady && !busy && !paused && route !== 'history'}
              needsScroll
              fillScreens={fromEarlier ? undefined : 0}
              onReach={continueCollect}
            >
              {(active && autoMode) || (autoReady && !fromEarlier) ? (
                <span className='inline-flex h-9 items-center' role='status'>
                  <Loader2
                    className='size-4 animate-spin motion-reduce:animate-none'
                    aria-hidden='true'
                  />
                  <span className='sr-only'>{t('加载中')}</span>
                </span>
              ) : active ? (
                <Button variant='outline' className='relative' disabled>
                  <Loader2 className='absolute left-3 animate-spin motion-reduce:animate-none' />
                  <StableLabel labels={moreLabels} current={t('采集中')} />
                </Button>
              ) : pagedTask.nextCursor ? (
                <span className='flex min-w-0 items-center gap-3'>
                  {pagedTask.status === 'error' && (
                    <span className='truncate text-destructive' role='alert'>
                      {translateMessage(pagedTask.message)}
                    </span>
                  )}
                  <Button
                    variant='outline'
                    className='shrink-0'
                    disabled={busy}
                    onClick={continueCollect}
                  >
                    <StableLabel
                      labels={moreLabels}
                      current={
                        pagedTask.status === 'error'
                          ? t('重试')
                          : autoMode
                            ? t('加载更多')
                            : continueLabel
                      }
                    />
                  </Button>
                </span>
              ) : (
                pagedTask.exhausted &&
                t(creatorTask ? '已采完全部作品' : '没有更多了')
              )}
            </ScrollSentinel>
          )}
        </div>
      )}
    </>
  )
})

const sessionStart = Date.now()
const continueCollect = () => void useStudio.getState().continueCollect()
