import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageDown, Loader2, ScanText } from 'lucide-react'
import { toast } from 'sonner'
import { CopyButton } from '@/components/common/copy-button'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useOcrAvailable } from './image-text'
import { useStudio } from './store'
import type { ContentItem } from './types'

// 视频按 object-contain 显示，算出画面本身在元素里的位置，去掉两侧或上下的空白
function contentBox(element: HTMLVideoElement) {
  const box = element.getBoundingClientRect()
  const ratio = element.videoWidth / element.videoHeight
  let width = box.width
  let height = box.height
  if (ratio > 0 && width / height > ratio) width = height * ratio
  else if (ratio > 0) height = width / ratio
  const left = (box.width - width) / 2
  const top = (box.height - height) / 2
  return { box, left, top, width, height }
}

const waitFor = (target: HTMLVideoElement, event: string, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
    target.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error('error'))
      },
      { once: true },
    )
  })

// 正在播放的视频不开跨域模式，免得某个域名没补上跨域头时播不了；取帧时另开一个
// 隐藏的视频，跳到同一时间点画进画布，拿到原始分辨率，界面上什么都不用隐藏
async function grabFrame(source: HTMLVideoElement) {
  const probe = document.createElement('video')
  probe.crossOrigin = 'anonymous'
  probe.muted = true
  probe.preload = 'auto'
  try {
    const loaded = waitFor(probe, 'loadeddata', 8000)
    probe.src = source.currentSrc
    await loaded
    const seeked = waitFor(probe, 'seeked', 8000)
    probe.currentTime = source.currentTime
    await seeked
    const canvas = document.createElement('canvas')
    canvas.width = probe.videoWidth
    canvas.height = probe.videoHeight
    canvas.getContext('2d')!.drawImage(probe, 0, 0)
    // 没补上跨域头时画布被污染，这里会抛错
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    if (!blob) throw new Error('empty')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    probe.removeAttribute('src')
    probe.load()
  }
}

export type Recognition =
  | { status: 'idle' | 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error'; message: string }

// 只在开发版赋值，见 debug.ts
export const frameDebug: {
  current: {
    capture: () => Promise<Uint8Array | null>
    recognize: () => Promise<Recognition>
  } | null
} = { current: null }

// 暂停时出现在画面右上角：保存当前画面、识别画面里的字；继续播放就收起
// 识别和保存都是后台任务：工具条随播放收起、弹出框关掉都不影响任务；
// 结果回来时界面已经没了，这一次就丢掉；每次识别带编号，旧结果不会盖住新的
export function FrameTools(props: {
  item: ContentItem
  video: RefObject<HTMLVideoElement | null>
}) {
  const { item, video } = props
  const latest = useRef(0)
  const capture = () =>
    video.current ? grabFrame(video.current) : Promise.resolve(null)
  const { t } = useTranslation('studio')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const ocr = useOcrAvailable()
  const [result, setResult] = useState<Recognition>({ status: 'idle' })
  // 竖屏视频居中时，播放区的角落离画面很远，工具条要贴着画面本身的右上角
  const [place, setPlace] = useState({ top: 8, right: 8 })
  useEffect(() => {
    const element = video.current
    if (!element) return
    const update = () => {
      const { box, left, top, width } = contentBox(element)
      setPlace({ top: top + 8, right: box.width - left - width + 8 })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [video])

  const save = async () => {
    if (saving || !window.studio?.saveFrame) return
    setSaving(true)
    try {
      const png = await capture().catch(() => null)
      if (!png) {
        toast.error(t('取不到当前画面，请重试'), { id: 'frame' })
        return
      }
      const saved = await window.studio.saveFrame(
        item.platform,
        item.id,
        png,
        video.current?.currentTime || 0,
        useStudio.getState().askBeforeDownload,
      )
      if (saved.saved)
        toast.success(t('画面已保存'), {
          id: 'frame',
          description: saved.name,
        })
    } catch {
      toast.error(t('画面保存失败，请重试'), { id: 'frame' })
    } finally {
      setSaving(false)
    }
  }

  const recognize = async (): Promise<Recognition> => {
    if (result.status === 'loading' || !window.studio?.recognizeFrame)
      return result
    const id = ++latest.current
    setResult({ status: 'loading' })
    let next: Recognition
    const png = await capture().catch(() => null)
    if (!png) {
      next = { status: 'error', message: '取不到当前画面，请重试' }
      if (id === latest.current) setResult(next)
      return next
    }
    try {
      const answer = await window.studio.recognizeFrame(item.platform, png)
      next = answer.imageText
        ? { status: 'done', text: answer.imageText.text }
        : {
            status: 'error',
            message:
              answer.code === 'no_text'
                ? '画面里没有识别到文字'
                : answer.code === 'ocr_unavailable'
                  ? '图片识别不可用'
                  : '识别失败，请重试',
          }
    } catch {
      next = { status: 'error', message: '识别失败，请重试' }
    }
    if (id === latest.current) setResult(next)
    return next
  }

  // 开发版把截图和识别交给调试入口，验收时一次调用拿结果，不用点按钮、读 DOM
  useEffect(() => {
    if (!import.meta.env.DEV) return
    frameDebug.current = { capture, recognize }
    return () => {
      frameDebug.current = null
    }
  })

  return (
    <div className='absolute flex gap-1.5' style={place}>
      {/* 带文字更好找；保存中只换图标，宽度不变 */}
      <Button
        variant='secondary'
        size='sm'
        className='bg-background/85 shadow-sm backdrop-blur'
        disabled={saving}
        aria-busy={saving}
        onClick={() => void save()}
      >
        {saving ? (
          <Loader2 className='animate-spin motion-reduce:animate-none' />
        ) : (
          <ImageDown />
        )}
        {t('保存画面')}
      </Button>
      {ocr && (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (next) void recognize()
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant='secondary'
              size='sm'
              className='bg-background/85 shadow-sm backdrop-blur'
            >
              <ScanText />
              {t('识别文字')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align='end' className='w-80'>
            <div className='mb-2 flex min-h-7 items-center justify-between gap-2'>
              <span className='text-caption text-muted-foreground'>
                {t('画面文字')}
              </span>
              {result.status === 'done' && (
                <CopyButton
                  text={result.text}
                  label={t('复制画面文字')}
                  className='size-7 shrink-0'
                />
              )}
            </div>
            {result.status === 'loading' ? (
              <p
                className='flex items-center gap-2 text-body text-muted-foreground'
                role='status'
              >
                <Loader2 className='size-4 animate-spin motion-reduce:animate-none' />
                {t('正在识别')}
              </p>
            ) : result.status === 'done' ? (
              <p className='max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-body leading-relaxed'>
                {result.text}
              </p>
            ) : result.status === 'error' ? (
              <p className='text-body text-muted-foreground'>
                {t(result.message)}
              </p>
            ) : null}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
