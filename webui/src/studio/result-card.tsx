import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, Heart, Images, MessageSquare } from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { openSource } from './content-detail'
import { AuthorName } from './creator-ui'
import { PlatformIcon } from './platform-icon'
import { platformNames, useStudio } from './store'
import type { ContentItem } from './types'

// 博主页每张卡片的平台和作者都相同，改为展示点赞；推荐流只隐藏平台标签
export function ResultCard(props: {
  item: ContentItem
  creatorPage?: boolean
  hidePlatform?: boolean
}) {
  const { item, creatorPage, hidePlatform } = props
  const { t, i18n } = useTranslation('studio')
  const compact = new Intl.NumberFormat(i18n.language, { notation: 'compact' })
  const patch = useStudio((state) => state.patch)
  return (
    <Card className='group flex h-full flex-col overflow-hidden transition-[transform,box-shadow,border-color] duration-200 focus-within:border-primary/30 focus-within:shadow-lg hover:border-primary/30 hover:shadow-lg motion-safe:hover:-translate-y-1 motion-reduce:transition-none'>
      <button
        className='flex w-full flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
        aria-label={t('查看详情：') + item.title}
        onClick={() => patch({ selected: item })}
      >
        {!!item.images.length && (
          <span className='relative block aspect-video w-full shrink-0 overflow-hidden bg-muted'>
            <ResultCover key={item.images[0]} src={item.images[0]} />
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
          {!creatorPage && !hidePlatform && (
            <div>
              <Badge variant='secondary' className='gap-1'>
                <PlatformIcon platform={item.platform} className='size-3' />
                {t(platformNames[item.platform])}
              </Badge>
            </div>
          )}
          <h3 className='line-clamp-2 font-semibold'>{item.title}</h3>
        </CardHeader>
        {/* 抖音等平台没有单独的标题，标题就是正文开头，再显示一遍是重复；完整内容在详情里 */}
        {item.text && !item.text.startsWith(item.title) && (
          <CardContent>
            <p className='line-clamp-3 text-muted-foreground'>{item.text}</p>
          </CardContent>
        )}
      </button>
      <CardFooter className='justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2 text-muted-foreground'>
          {creatorPage ? (
            item.likes && (
              <span className='inline-flex items-center gap-1 text-xs'>
                <Heart className='size-3' aria-hidden='true' />
                {Number.isFinite(Number(item.likes))
                  ? compact.format(Number(item.likes))
                  : item.likes}
              </span>
            )
          ) : (
            <AuthorName item={item} />
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
