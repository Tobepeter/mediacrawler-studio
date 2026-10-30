import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImageGallery } from '@/components/common/image-gallery/image-gallery'
import { DouyinMedia } from './douyin-media'
import type { ContentItem } from './types'

// 仅使用 B站官方外链播放器，不解析或缓存临时视频地址
export function biliPlayer(item: ContentItem) {
  if (item.platform !== 'bili') return null
  try {
    const url = new URL(item.url)
    if (
      url.protocol !== 'https:' ||
      !['www.bilibili.com', 'bilibili.com'].includes(url.hostname)
    )
      return null
    const match = url.pathname.match(/^\/video\/(BV[a-zA-Z0-9]+|av\d+)(?:\/|$)/)
    if (!match) return null
    const params = new URLSearchParams({ autoplay: '1', danmaku: '0' })
    params.set(
      match[1].startsWith('BV') ? 'bvid' : 'aid',
      match[1].startsWith('BV') ? match[1] : match[1].slice(2),
    )
    const part = url.searchParams.get('p')
    if (part && /^[1-9]\d*$/.test(part)) params.set('p', part)
    return `https://player.bilibili.com/player.html?${params}`
  } catch {
    return null
  }
}

export function DetailMedia({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')

  const [playing, setPlaying] = useState(false)
  const player = biliPlayer(item)
  if (item.platform === 'dy') return <DouyinMedia key={item.id} item={item} />
  return (
    <div className='min-w-0 space-y-3'>
      {player ? (
        <div className='relative aspect-video overflow-hidden rounded-lg bg-muted'>
          {playing ? (
            <iframe
              className='absolute inset-0 size-full border-0'
              src={player}
              title={`${item.title} · ${t('视频播放器')}`}
              allow='autoplay; fullscreen; picture-in-picture'
              allowFullScreen
              sandbox='allow-scripts allow-same-origin allow-presentation'
              referrerPolicy='strict-origin-when-cross-origin'
            />
          ) : (
            <Button
              variant='ghost'
              className='group absolute inset-0 h-full w-full overflow-hidden rounded-none p-0'
              aria-label={t('播放视频')}
              onClick={() => setPlaying(true)}
            >
              {item.images[0] && (
                <img
                  className='absolute inset-0 size-full object-cover'
                  src={item.images[0]}
                  alt=''
                  referrerPolicy='no-referrer'
                />
              )}
              <span className='relative flex size-12 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-transform group-hover:scale-105'>
                <Play className='size-5 fill-current' />
              </span>
            </Button>
          )}
        </div>
      ) : (
        <ImageGallery images={item.images} title={item.title} />
      )}
    </div>
  )
}
