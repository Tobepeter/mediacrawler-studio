import { useTranslation } from 'react-i18next'
import { IconButton } from '@/components/common/icon-button'
import { memo, useState } from 'react'
import {
  ArrowUpRight,
  MessageSquare,
  FileJson,
  FileSpreadsheet,
  Ellipsis,
  Inbox,
  Images,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { activeStatuses, platformNames, usePage, useStudio } from './store'
import type { Platform } from './types'
import { openSource } from './content-detail'
import { PlatformIcon } from './platform-icon'

export function Results() {
  const { t } = useTranslation('studio')

  const platform = useStudio((state) => state.platform)
  const page = usePage()
  const results = page?.results || []
  const [exporting, setExporting] = useState(false)
  const exportResults = async (format: 'csv' | 'json') => {
    if (!window.studio) {
      toast(t('示例内容不可导出'))
      return
    }
    setExporting(true)
    try {
      if (
        page &&
        (await window.studio.export(format, page.task.platform, page.id))
      )
        toast.success(t('已导出'))
    } catch {
      toast.error(t('导出失败，请重试'))
    } finally {
      setExporting(false)
    }
  }
  return (
    <section className='flex flex-1 flex-col' aria-label={t('结果')}>
      {!!results.length && (
        <div className='flex items-center justify-end pb-4'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant='ghost'
                size='icon'
                aria-label={t('更多结果操作')}
                label={t('更多')}
                disabled={exporting}
              >
                <Ellipsis />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onSelect={() => void exportResults('csv')}>
                <FileSpreadsheet />
                {t('导出 CSV')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportResults('json')}>
                <FileJson />
                {t('导出 JSON')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
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
  return (
    <>
      {!results.length ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-4 py-16 text-muted-foreground'>
          <Inbox className='size-6' aria-hidden='true' />
          <span>{active ? t('等待结果') : t('暂无结果')}</span>
        </div>
      ) : (
        <div className='pb-6'>
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'>
            {results.map((item) => (
              <Card
                className='group flex h-full flex-col overflow-hidden transition-[transform,box-shadow,border-color] duration-200 focus-within:border-primary/30 focus-within:shadow-lg hover:border-primary/30 hover:shadow-lg motion-safe:hover:-translate-y-1 motion-reduce:transition-none'
                key={item.id}
              >
                <button
                  className='flex w-full flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                  aria-label={t('查看详情：') + item.title}
                  onClick={() => patch({ selected: item })}
                >
                  {!!item.images.length && (
                    <span className='relative block aspect-video w-full shrink-0 overflow-hidden'>
                      <img
                        className='size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105 motion-reduce:transition-none'
                        src={item.images[0]}
                        alt=''
                        loading='lazy'
                        referrerPolicy='no-referrer'
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
            ))}
          </div>
        </div>
      )}
    </>
  )
})
