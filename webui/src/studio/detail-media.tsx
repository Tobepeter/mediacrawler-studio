import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { ImageGallery } from '@/components/common/image-gallery/image-gallery'
import { cn } from '@/lib/utils'
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

// 地址和封面在打开时定下来，详情数据合并进来不能让播放器重新加载
function BiliPlayer({ src, item }: { src: string; item: ContentItem }) {
  const { t } = useTranslation('studio')
  const [poster] = useState(item.images[0])
  const [loaded, setLoaded] = useState(false)
  // 播放器的 load 事件可能被统计请求拖很久，到时间也要显示，不能让封面挡住播放
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 1500)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className='relative aspect-video overflow-hidden rounded-lg bg-muted'>
      {poster && (
        <img
          className='absolute inset-0 size-full object-cover'
          src={poster}
          alt=''
          referrerPolicy='no-referrer'
        />
      )}
      {/* 播放器加载完才显示，中间不露出黑屏 */}
      <iframe
        className={cn(
          'absolute inset-0 size-full border-0 transition-opacity duration-300 motion-reduce:transition-none',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
        src={src}
        title={`${item.title} · ${t('视频播放器')}`}
        allow='autoplay; fullscreen; picture-in-picture'
        allowFullScreen
        sandbox='allow-scripts allow-same-origin allow-presentation'
        referrerPolicy='strict-origin-when-cross-origin'
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}

export function DetailMedia({ item }: { item: ContentItem }) {
  const [player] = useState(() => biliPlayer(item))
  if (item.platform === 'dy') return <DouyinMedia key={item.id} item={item} />
  return (
    <div className='min-w-0 space-y-3'>
      {player ? (
        <BiliPlayer src={player} item={item} />
      ) : (
        <ImageGallery images={item.images} title={item.title} />
      )}
    </div>
  )
}
