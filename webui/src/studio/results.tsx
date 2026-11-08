import { useTranslation } from 'react-i18next'
import { IconButton } from '@/components/common/icon-button'
import { Reveal } from '@/components/common/reveal'
import { cn } from '@/lib/utils'
import { memo, useCallback, useEffect, useState, type ReactNode } from 'react'
import { translateMessage } from '@/i18n/studio'
import { useStudioRoute } from './route'
import { useInView } from 'react-intersection-observer'
import {
  ArrowUpRight,
  Heart,
  MessageSquare,
  Inbox,
  Images,
  Loader2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { activeStatuses, platformBusy, platformNames, useStudio } from './store'
import type { Platform } from './types'
import { openSource } from './content-detail'
import { CreatorHeader } from './creator-ui'
import { PlatformIcon } from './platform-icon'

export function Results() {
  const { t } = useTranslation('studio')

  const platform = useStudio((state) => state.platform)
  return (
    <section className='flex flex-1 flex-col' aria-label={t('结果')}>
      {/* 各平台卡片保留挂载，切回时复用已加载的封面 */}
      {(Object.keys(platformNames) as Platform[]).map((id) => (
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
  const { t, i18n } = useTranslation('studio')
  const compact = new Intl.NumberFormat(i18n.language, { notation: 'compact' })

  const page = useStudio((state) => state.pages[platform])
  const patch = useStudio((state) => state.patch)
  const results = page?.results || []
  const active = activeStatuses.includes(page?.task.status || '')
  const busy = useStudio((state) => platformBusy(state, platform))
  // 博主页每张卡片的平台和作者都相同，改为展示点赞帮助挑选
  const creatorTask = page?.task.mode === 'creator' ? page.task : null
  // 自动模式接近底部就继续，看不到按钮；用户停止、失败或一批没有新内容时才交给手动
  const pagedTask = creatorTask || (page?.task.auto ? page.task : null)
  // 旧博主记录没有这个字段，只有明确选了数字的才是固定数量
  const formQuery = useStudio((state) => state.forms[platform].query)
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
  return (
    <>
      {!results.length ? (
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
          {/* 输入框已显示同一位博主时不重复，改看别的内容时才在这里标明结果归属 */}
          {creatorTask?.creator && formQuery !== creatorTask.query && (
            <CreatorHeader
              creator={creatorTask.creator}
              count={results.length}
            />
          )}
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'>
            {results.map((item, index) => (
              <Reveal
                key={`${page?.id}:${item.id}`}
                delay={Math.min(index, 4) * 40}
              >
                <Card className='group flex h-full flex-col overflow-hidden transition-[transform,box-shadow,border-color] duration-200 focus-within:border-primary/30 focus-within:shadow-lg hover:border-primary/30 hover:shadow-lg motion-safe:hover:-translate-y-1 motion-reduce:transition-none'>
                  <button
                    className='flex w-full flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                    aria-label={t('查看详情：') + item.title}
                    onClick={() => patch({ selected: item })}
                  >
                    {!!item.images.length && (
                      <span className='relative block aspect-video w-full shrink-0 overflow-hidden bg-muted'>
                        <ResultCover
                          key={item.images[0]}
                          src={item.images[0]}
                        />
                        {item.images.length > 1 && (
                          <Badge
                            variant='secondary'
                            className='absolute bottom-2 right-2 gap-1'
                            aria-label={t('{{count}} 张图片', {
                              count: item.images.length,
                            })}
                          >
                            <Images className='size-3' />
                            {item.images.length}
                          </Badge>
                        )}
                      </span>
                    )}
                    <CardHeader>
                      {!creatorTask && (
                        <div>
                          <Badge variant='secondary' className='gap-1'>
                            <PlatformIcon
                              platform={item.platform}
                              className='size-3'
                            />
                            {t(platformNames[item.platform])}
                          </Badge>
                        </div>
                      )}
                      <h3 className='font-semibold'>{item.title}</h3>
                    </CardHeader>
                    {item.text && (
                      <CardContent>
                        <p className='line-clamp-3 text-muted-foreground'>
                          {item.text}
                        </p>
                      </CardContent>
                    )}
                  </button>
                  <CardFooter className='justify-between gap-2'>
                    <div className='flex min-w-0 items-center gap-2 text-muted-foreground'>
                      {creatorTask ? (
                        item.likes && (
                          <span className='inline-flex items-center gap-1 text-xs'>
                            <Heart className='size-3' aria-hidden='true' />
                            {Number.isFinite(Number(item.likes))
                              ? compact.format(Number(item.likes))
                              : item.likes}
                          </span>
                        )
                      ) : (
                        <span className='truncate'>
                          {item.author || t('未知作者')}
                        </span>
                      )}
                      {item.commentStatus && (
                        <span
                          className='inline-flex shrink-0 items-center gap-1 text-xs'
                          aria-label={t('已获取 {{count}} 条评论', {
                            count: item.comments?.length || 0,
                          })}
                        >
                          <MessageSquare className='size-3' />
                          {item.comments?.length || 0}
                        </span>
                      )}
                    </div>
                    <IconButton
                      variant='ghost'
                      onClick={() => openSource(item)}
                      aria-label={t('查看原文：') + item.title}
                      label={t('查看原文')}
                    >
                      <ArrowUpRight />
                    </IconButton>
                  </CardFooter>
                </Card>
              </Reveal>
            ))}
          </div>
          {pagedTask && (
            <AutoContinue
              key={`${page?.id}:${results.length}`}
              active={autoReady && !busy && !paused && route !== 'history'}
              needsScroll={fromEarlier}
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
                <Button variant='outline' disabled>
                  <Loader2 className='animate-spin motion-reduce:animate-none' />
                  {t('采集中')}
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
                    {pagedTask.status === 'error'
                      ? t('重试')
                      : autoMode
                        ? t('加载更多')
                        : t('继续采集 {{count}} 条', {
                            count: pagedTask.limit,
                          })}
                  </Button>
                </span>
              ) : (
                pagedTask.exhausted &&
                t(creatorTask ? '已采完全部作品' : '没有更多了')
              )}
            </AutoContinue>
          )}
        </div>
      )}
    </>
  )
})

const sessionStart = Date.now()
const continueCollect = () => void useStudio.getState().continueCollect()

// 列表每次变化都重新挂载：inView 由观察器异步更新，沿用旧值会在追加后多采一批
// 新实例从不可见开始，观察器首次回调给出真实位置，内容没填满时也会继续
function AutoContinue(props: {
  active: boolean
  needsScroll: boolean
  children: ReactNode
}) {
  const { active, needsScroll, children } = props
  const [scrolled, setScrolled] = useState(false)
  const [root, setRoot] = useState<Element | null>(null)
  const { ref, inView } = useInView({
    root,
    rootMargin: '0px 0px 800px 0px',
    skip: !root,
  })
  const anchor = useCallback(
    (node: HTMLDivElement | null) => {
      ref(node)
      setRoot(node?.closest('[data-radix-scroll-area-viewport]') ?? null)
    },
    [ref],
  )
  useEffect(() => {
    if (!root || !needsScroll) return
    // 内容变短时浏览器也会触发 scroll，回到顶部的不算用户往下看
    const mark = () => {
      if (root.scrollTop > 0) setScrolled(true)
    }
    root.addEventListener('scroll', mark, { passive: true })
    return () => root.removeEventListener('scroll', mark)
  }, [root, needsScroll])
  const shouldContinue = active && inView && (!needsScroll || scrolled)
  useEffect(() => {
    if (shouldContinue) continueCollect()
  }, [shouldContinue])
  return (
    <div
      ref={anchor}
      className='flex justify-center pt-6 text-sm text-muted-foreground'
    >
      {children}
    </div>
  )
}

// 封面占位尺寸固定；网络图片与缓存图片均按加载完成淡入
function ResultCover({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      ref={(image) => {
        if (image?.complete && image.naturalWidth) setLoaded(true)
      }}
      className={cn(
        'size-full object-cover transition-[opacity,transform] duration-300 motion-safe:group-hover:scale-105 motion-reduce:transition-none',
        loaded ? 'opacity-100' : 'opacity-0',
      )}
      src={src}
      alt=''
      loading='lazy'
      decoding='async'
      referrerPolicy='no-referrer'
      onLoad={() => setLoaded(true)}
    />
  )
}
