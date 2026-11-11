import { useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageDown, Loader2, ScanText } from 'lucide-react'
import { toast } from 'sonner'
import { CopyButton } from '@/components/common/copy-button'
import { IconButton } from '@/components/common/icon-button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useStudio } from './store'
import type { ContentItem } from './types'

// 等控件收起后再截；窗口在后台时浏览器不刷新画面，最多等 100 毫秒，避免一直卡住
const nextFrame = () =>
  Promise.race([
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    ),
    new Promise((resolve) => setTimeout(resolve, 100)),
  ])

// 平台视频跨域，页面读不到像素，由主进程截取播放器区域；截之前收起控件和工具条，
// 只截画面本身，按视频比例去掉 object-contain 留下的黑边
export function useFrameCapture(video: RefObject<HTMLVideoElement | null>) {
  const [capturing, setCapturing] = useState(false)
  const capture = async () => {
    const element = video.current
    if (!element || !window.studio?.captureFrame) return null
    setCapturing(true)
    try {
      await nextFrame()
      const box = element.getBoundingClientRect()
      const ratio = element.videoWidth / element.videoHeight
      let width = box.width
      let height = box.height
      if (ratio > 0 && width / height > ratio) width = height * ratio
      else if (ratio > 0) height = width / ratio
      return await window.studio.captureFrame({
        x: box.left + (box.width - width) / 2,
        y: box.top + (box.height - height) / 2,
        width,
        height,
      })
    } finally {
      setCapturing(false)
    }
  }
  return { capturing, capture }
}

type Recognition =
  | { status: 'idle' | 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error'; message: string }

// 暂停时出现在画面右上角：保存当前画面、识别画面里的字；继续播放就收起
export function FrameTools(props: {
  item: ContentItem
  video: RefObject<HTMLVideoElement | null>
  capture: () => Promise<Uint8Array | null>
  hidden?: boolean
}) {
  const { item, video, capture, hidden } = props
  const { t } = useTranslation('studio')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<Recognition>({ status: 'idle' })

  const save = async () => {
    if (saving || !window.studio?.saveFrame) return
    setSaving(true)
    try {
      const png = await capture()
      if (!png) return
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

  const recognize = async () => {
    if (result.status === 'loading' || !window.studio?.recognizeFrame) return
    setResult({ status: 'loading' })
    try {
      const png = await capture()
      if (!png) throw new Error('capture')
      const answer = await window.studio.recognizeFrame(item.platform, png)
      if (answer.imageText)
        setResult({ status: 'done', text: answer.imageText.text })
      else
        setResult({
          status: 'error',
          message:
            answer.code === 'no_text'
              ? '画面里没有识别到文字'
              : answer.code === 'ocr_unavailable'
                ? '图片识别不可用'
                : '识别失败，请重试',
        })
    } catch {
      setResult({ status: 'error', message: '识别失败，请重试' })
    }
  }

  return (
    <div
      className={`absolute right-2 top-2 flex gap-1 ${hidden ? 'invisible' : ''}`}
    >
      <IconButton
        variant='secondary'
        className='size-8 bg-background/85 backdrop-blur'
        label={t('保存当前画面')}
        disabled={saving}
        aria-busy={saving}
        onClick={() => void save()}
      >
        {saving ? (
          <Loader2 className='animate-spin motion-reduce:animate-none' />
        ) : (
          <ImageDown />
        )}
      </IconButton>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) void recognize()
        }}
      >
        <PopoverTrigger asChild>
          <IconButton
            variant='secondary'
            className='size-8 bg-background/85 backdrop-blur'
            label={t('识别画面文字')}
          >
            <ScanText />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent
          align='end'
          className={`w-80 ${hidden ? 'invisible' : ''}`}
        >
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
    </div>
  )
}
