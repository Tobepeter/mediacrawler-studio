import { useTranslation } from 'react-i18next'
import { useRef } from 'react'
import { t } from '@/i18n/studio'
import { Copy, ExternalLink, Heart } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/common/icon-button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { platformNames, useStudio } from './store'
import type { ContentItem } from './types'
import { AuthorName } from './creator-ui'
import { PlatformIcon } from './platform-icon'
import { biliPlayer, DetailMedia } from './detail-media'
import { DetailBody } from './detail-body'
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

export function ContentDetail() {
  const { t } = useTranslation('studio')
  const title = useRef<HTMLHeadingElement>(null)

  const selected = useStudio((state) => state.selected)
  const patch = useStudio((state) => state.patch)
  const hasMedia =
    selected &&
    (selected.images.length > 0 ||
      selected.platform === 'dy' ||
      !!biliPlayer(selected))
  const copy = async () => {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(
        `${selected.title}\n\n${selected.text}\n\n${selected.url}`,
      )
      toast.success(t('已复制内容和来源'))
    } catch {
      toast.error(t('复制失败，请重试'))
    }
  }
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
          hasMedia ? 'max-w-none sm:w-[92vw]' : 'max-w-5xl',
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
                    <div className='space-y-6 p-6'>
                      <DialogHeader className='pr-8 text-left'>
                        <div>
                          <Badge variant='secondary' className='gap-1'>
                            <PlatformIcon
                              platform={selected.platform}
                              className='size-3'
                            />
                            {t(platformNames[selected.platform])}
                          </Badge>
                        </div>
                        <DialogTitle
                          ref={title}
                          tabIndex={-1}
                          className='break-words leading-snug outline-none'
                        >
                          {selected.title}
                        </DialogTitle>
                        <DialogDescription className='flex items-center justify-between gap-2'>
                          <AuthorName item={selected} />
                          <span className='inline-flex shrink-0 items-center gap-1'>
                            <Heart className='size-4' />
                            {selected.likes}
                          </span>
                        </DialogDescription>
                      </DialogHeader>
                      <DetailBody key={selected.id} item={selected} />
                    </div>
                  </ScrollArea>
                  <DialogFooter className='shrink-0 flex-row flex-wrap justify-end gap-2 bg-background p-4 sm:space-x-0'>
                    <MediaDownload key={selected.id} item={selected} />
                    <IconButton
                      label={t('复制内容')}
                      onClick={() => void copy()}
                    >
                      <Copy />
                    </IconButton>
                    <Button onClick={() => openSource(selected)}>
                      {t('查看原文')}
                      <ExternalLink />
                    </Button>
                  </DialogFooter>
                </div>
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
