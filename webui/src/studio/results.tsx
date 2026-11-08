import { useTranslation } from 'react-i18next'
import { IconButton } from '@/components/common/icon-button'
import { Reveal } from '@/components/common/reveal'
import { cn } from '@/lib/utils'
import { memo, useState } from 'react'
import {
  ArrowUpRight,
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
  const { t } = useTranslation('studio')

  const page = useStudio((state) => state.pages[platform])
  const patch = useStudio((state) => state.patch)
  const results = page?.results || []
  const active = activeStatuses.includes(page?.task.status || '')
  const busy = useStudio((state) => platformBusy(state, platform))
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
                      <div>
                        <Badge variant='secondary' className='gap-1'>
                          <PlatformIcon
                            platform={item.platform}
                            className='size-3'
                          />
                          {t(platformNames[item.platform])}
                        </Badge>
                      </div>
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
                      <span className='truncate'>
                        {item.author || t('未知作者')}
                      </span>
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
          {page?.task.mode === 'creator' && page.task.nextCursor && (
            <div className='flex justify-center pt-6'>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => void useStudio.getState().continueCreator()}
              >
                {t('继续采集 {{count}} 条', { count: page.task.limit })}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  )
})

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
