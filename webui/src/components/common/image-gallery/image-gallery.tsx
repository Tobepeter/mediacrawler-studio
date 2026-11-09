import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import { WheelGesturesPlugin } from 'embla-carousel-wheel-gestures'
import { ChevronLeft, ChevronRight, Expand } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PreviewDialog } from './preview-dialog'
import type { ImagePreviewGroup, ImagePreviewSize } from './types'

// Embla 负责详情内滑动，PhotoSwipe 负责全屏缩放
export function ImageGallery(props: ImageGalleryProps) {
  const { t } = useTranslation('studio')

  const [index, setIndex] = useState(0)
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const [preview, setPreview] = useState<ImagePreviewGroup | null>(null)
  const sizes = useRef(new Map<string, ImagePreviewSize>())
  const closePreview = useCallback(() => setPreview(null), [])
  const [viewportRef, carousel] = useEmblaCarousel(
    {
      watchDrag: props.images.length > 1,
      duration: 20,
      breakpoints: { '(prefers-reduced-motion: reduce)': { duration: 0 } },
    },
    [WheelGesturesPlugin({ active: props.images.length > 1 })],
  )
  useEffect(() => {
    if (!carousel) return
    const sync = () => setIndex(carousel.selectedScrollSnap())
    sync()
    carousel.on('select', sync).on('reInit', sync)
    return () => {
      carousel.off('select', sync).off('reInit', sync)
    }
  }, [carousel])
  const select = useCallback(
    (position: number) => {
      carousel?.scrollTo(position)
    },
    [carousel],
  )
  const restoreFocus = useCallback(() => {
    if (!carousel) return
    carousel
      .slideNodes()
      [carousel.selectedScrollSnap()]?.querySelector('button')
      ?.focus({ preventScroll: true })
  }, [carousel])
  const current = Math.min(index, props.images.length - 1)
  if (!props.images[current]) return null
  const rememberSize = (img: HTMLImageElement) => {
    sizes.current.set(img.src, {
      width: img.naturalWidth,
      height: img.naturalHeight,
    })
  }
  const open = (position: number) =>
    setPreview({
      index: position,
      items: props.images.map((url, position) => ({
        src: url,
        alt: `${props.title} · ${position + 1}`,
        ...sizes.current.get(new URL(url, document.baseURI).href),
      })),
    })
  return (
    <div
      className='min-w-0 space-y-3'
      role='region'
      aria-label={t('作品图片')}
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget &&
          !(
            event.target instanceof HTMLButtonElement &&
            event.target.hasAttribute('data-image-navigation')
          )
        )
          return
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          select(current + (event.key === 'ArrowRight' ? 1 : -1))
        }
      }}
    >
      <div className='relative aspect-square max-h-[calc(90dvh-8rem)] w-full overflow-hidden rounded-lg bg-muted/40'>
        <div
          ref={viewportRef}
          className='pinch-zoom absolute inset-0 touch-pan-y overflow-hidden'
        >
          <div className='flex h-full'>
            {props.images.map((url, position) => (
              <div
                key={url + position}
                className='relative h-full min-w-0 flex-[0_0_100%]'
                aria-hidden={position !== current}
              >
                <Button
                  variant='ghost'
                  className='absolute inset-0 h-full w-full cursor-grab rounded-none p-0 hover:bg-transparent active:cursor-grabbing'
                  aria-label={t('放大第 {{index}} 张图片', {
                    index: position + 1,
                  })}
                  data-image-navigation
                  tabIndex={position === current ? 0 : -1}
                  disabled={failed.has(url)}
                  onClick={() => open(position)}
                >
                  {failed.has(url) ? (
                    <span className='text-muted-foreground'>
                      {t('图片暂时无法加载')}
                    </span>
                  ) : (
                    <img
                      src={url}
                      alt={t('作品图片 {{index}}', { index: position + 1 })}
                      className='size-full select-none object-contain'
                      draggable={false}
                      loading={position === 0 ? 'eager' : 'lazy'}
                      referrerPolicy='no-referrer'
                      onLoad={(event) => rememberSize(event.currentTarget)}
                      onError={() =>
                        setFailed((urls) => new Set(urls).add(url))
                      }
                    />
                  )}
                  {!failed.has(url) && (
                    <span
                      className='absolute bottom-3 right-3 rounded-md bg-background/90 p-2'
                      aria-hidden='true'
                    >
                      <Expand />
                    </span>
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
        {props.images.length > 1 && (
          <>
            <Button
              variant='secondary'
              size='icon'
              className='absolute left-3 top-1/2 -translate-y-1/2'
              aria-label={t('上一张图片')}
              data-image-navigation
              disabled={current === 0}
              onClick={() => select(current - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant='secondary'
              size='icon'
              className='absolute right-3 top-1/2 -translate-y-1/2'
              aria-label={t('下一张图片')}
              data-image-navigation
              disabled={current === props.images.length - 1}
              onClick={() => select(current + 1)}
            >
              <ChevronRight />
            </Button>
            <span className='pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-background/90 px-2 py-1 text-caption tabular-nums'>
              {current + 1} / {props.images.length}
            </span>
          </>
        )}
      </div>
      {props.images.length > 1 && (
        <ScrollArea className='w-full'>
          <ToggleGroup
            type='single'
            value={String(current)}
            onValueChange={(value) => {
              if (value) select(Number(value))
            }}
            className='w-max justify-start p-1'
            aria-label={t('选择图片')}
          >
            {props.images.map((url, position) => (
              <ToggleGroupItem
                key={url + position}
                value={String(position)}
                variant='outline'
                className='shrink-0 overflow-hidden p-1'
                aria-label={t('查看第 {{index}} 张图片', {
                  index: position + 1,
                })}
              >
                <img
                  src={url}
                  alt=''
                  className='size-7 rounded-sm object-cover'
                  loading='lazy'
                  referrerPolicy='no-referrer'
                  onLoad={(event) => rememberSize(event.currentTarget)}
                />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ScrollBar orientation='horizontal' />
        </ScrollArea>
      )}
      {preview && (
        <PreviewDialog
          group={preview}
          onClose={closePreview}
          onIndexChange={select}
          onRestoreFocus={restoreFocus}
        />
      )}
    </div>
  )
}

export type ImageGalleryProps = { images: string[]; title: string }
