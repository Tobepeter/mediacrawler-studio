import { useTranslation } from 'react-i18next'
import { useRef } from 'react'
import { t } from '@/i18n/studio'
import { ExternalLink, Heart } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { platformNames, useStudio } from './store'
import type { ContentItem } from './types'
import { AuthorName } from './creator-ui'
import { PlatformIcon } from './platform-icon'
import { biliPlayer, DetailMedia } from './detail-media'
import { DetailBody } from './detail-body'
import { hasNativeVideo } from './native-video'
import { MediaDownload } from './media-download'

export function openSource(item: ContentItem) {
  if (!window.studio) {
    toast(t('示例内容不包含真实作品链接'))
    return
  }
  void window.studio
    .openSource(item.url)
    .catch(() => toast.error(t('无法打开来源链接')))
}

// 抖音这类没有独立标题，标题就是正文开头，再显示一遍是重复的
function repeatsBody(item: ContentItem) {
  const clean = (value: string) => value.replace(/\s+/g, '')
  const title = clean(item.title).replace(/…$/, '')
  return !!title && clean(item.text).startsWith(title)
}

export function ContentDetail() {
  const { t } = useTranslation('studio')
  const title = useRef<HTMLHeadingElement>(null)

  const selected = useStudio((state) => state.selected)
  const patch = useStudio((state) => state.patch)
  // 文章的图片排在正文里，单栏阅读，不再拆到左侧图集
  const hasMedia =
    selected &&
    !selected.markdown &&
    (selected.images.length > 0 ||
      hasNativeVideo(selected) ||
      !!biliPlayer(selected))
  return (
    <Dialog
      open={!!selected}
      onOpenChange={(open) => {
        if (!open) patch({ selected: null })
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          title.current?.focus()
        }}
        className={cn(
          'flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-lg p-0',
          hasMedia
            ? 'max-w-none sm:w-[92vw]'
            : selected?.markdown
              ? 'max-w-3xl'
              : 'max-w-5xl',
        )}
      >
        {selected && (
          <ScrollArea className='min-h-0 [&>[data-radix-scroll-area-viewport]]:max-h-[90dvh]'>
            <div
              className={cn(
                'grid',
                hasMedia &&
                  'lg:min-h-[calc(90dvh-2px)] lg:grid-cols-[minmax(0,1fr)_clamp(24rem,30vw,32rem)]',
              )}
            >
              {hasMedia && (
                <div className='min-w-0 p-6 pb-0 lg:flex lg:min-h-80 lg:items-center lg:pb-6 lg:pr-0'>
                  <div
                    className={cn(
                      'mx-auto w-full',
                      biliPlayer(selected) &&
                        'max-w-[calc((90dvh-3rem-2px)*16/9)]',
                    )}
                  >
                    <DetailMedia key={selected.id} item={selected} />
                  </div>
                </div>
              )}
              {/* 桌面端侧栏跟随媒体高度，长正文不会撑大播放器所在行 */}
              <div className='relative min-w-0'>
                <div
                  className={cn(
                    'flex min-h-0 flex-col',
                    hasMedia && 'lg:absolute lg:inset-0',
                  )}
                >
                  <ScrollArea
                    className={cn(
                      'min-h-0 flex-1',
                      !hasMedia &&
                        '[&>[data-radix-scroll-area-viewport]]:max-h-[calc(90dvh-8rem)]',
                    )}
                  >
                    <div className='space-y-3 p-6 pb-4'>
                      <DialogHeader className='space-y-2 pr-8 text-left'>
                        {/* 平台、作者、点赞放一行，标题只有和正文不重复时才显示 */}
                        <DialogDescription asChild>
                          <div className='flex min-w-0 items-center gap-2'>
                            <Badge
                              variant='secondary'
                              className='shrink-0 gap-1'
                            >
                              <PlatformIcon
                                platform={selected.platform}
                                className='size-3'
                              />
                              {t(platformNames[selected.platform])}
                            </Badge>
                            <span className='flex min-w-0 flex-1'>
                              <AuthorName item={selected} />
                            </span>
                            <span className='inline-flex shrink-0 items-center gap-1 tabular-nums'>
                              <Heart className='size-4' />
                              {selected.likes}
                            </span>
                          </div>
                        </DialogDescription>
                        <DialogTitle
                          ref={title}
                          tabIndex={-1}
                          className={cn(
                            'break-words leading-snug outline-none',
                            repeatsBody(selected) && 'sr-only',
                          )}
                        >
                          {selected.title}
                        </DialogTitle>
                      </DialogHeader>
                      <DetailBody key={selected.id} item={selected} />
                    </div>
                  </ScrollArea>
                  {/* 两个按钮等宽，下载状态变化时布局不动 */}
                  <div className='grid shrink-0 grid-cols-2 gap-2 border-t bg-background p-4'>
                    <MediaDownload key={selected.id} item={selected} />
                    <Button onClick={() => openSource(selected)}>
                      {t('查看原文')}
                      <ExternalLink />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
