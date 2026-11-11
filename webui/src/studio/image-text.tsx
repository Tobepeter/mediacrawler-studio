import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw, ScanText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/common/copy-button'
import { IconButton } from '@/components/common/icon-button'
import { EstimateCountdown } from './estimate-countdown'
import { SettingRow } from './settings-row'
import type { ContentItem } from './types'

// 视频只有一张封面，图集至少两张；抖音旧记录的图集可能被标成 video
const isGallery = (item: ContentItem) =>
  item.images.length > 1 || item.contentType !== 'video'

const ocrKey = ['studio', 'ocr-status']

// OCR 可拆：打开应用查一次，运行时里没有就隐藏图中文字和暂停识别，设置里说明
export function useOcrStatus() {
  return useQuery({
    queryKey: ocrKey,
    queryFn: () => window.studio!.ocrStatus!(),
    enabled: !!window.studio?.ocrStatus,
    staleTime: Infinity,
  })
}

export function useOcrAvailable() {
  return useOcrStatus().data?.state !== 'missing'
}

// 有图的图文帖才有这个 Tab；视频的画面文字在播放器暂停时识别
export function useImageTextTab(item: ContentItem) {
  const available = useOcrAvailable()
  return (
    available &&
    !!window.studio?.recognizeImages &&
    item.images.length > 0 &&
    isGallery(item)
  )
}

function useCachedImageText(item: ContentItem) {
  return useQuery({
    queryKey: ['studio', 'image-text', item.id],
    queryFn: () => window.studio!.cachedImageText!(item.platform, item.id),
    enabled: !!window.studio?.cachedImageText && isGallery(item),
    staleTime: Infinity,
  })
}

// 下载图片和启动识别约几秒，之后每张不到半秒
const estimate = (item: ContentItem) => (4 + item.images.length * 0.5) * 1000

const failureText: Record<string, string> = {
  ocr_unavailable: '图片识别不可用',
  no_text: '图片里没有识别到文字',
  no_images: '这条作品没有图片',
  environment: '识别环境不可用，请检查 Python 环境',
  expired: '图片暂时拿不到，请重新打开后再试',
  unavailable: '图片暂时拿不到，请重新打开后再试',
}

// Tab 行的操作和列表各用一份，进度靠 mutation 状态共享，切 Tab 也不丢
function useRecognition(item: ContentItem) {
  const { t } = useTranslation('studio')
  const client = useQueryClient()
  const mutationKey = ['studio', 'recognize-images', item.platform, item.id]
  const cached = useCachedImageText(item)
  const [progress] = useMutationState({
    filters: { mutationKey, status: 'pending' },
    select: (mutation) => mutation.state.submittedAt,
  })
  const recognize = useMutation({
    mutationKey,
    mutationFn: () => window.studio!.recognizeImages!(item.platform, item.id),
    onSuccess: (result) => {
      if (result.imageText) {
        client.setQueryData(['studio', 'image-text', item.id], result.imageText)
        return
      }
      toast.warning(t(failureText[result.code] || '图片识别失败，请重试'), {
        id: 'image-text',
      })
      if (result.code === 'ocr_unavailable')
        void client.invalidateQueries({ queryKey: ocrKey })
    },
    onError: () => {
      toast.error(t('图片识别失败，请重试'), { id: 'image-text' })
    },
  })
  const running = !!progress
  return {
    imageText: cached.data,
    loading: cached.isLoading,
    running,
    start: () => {
      if (!running) recognize.mutate()
    },
    progressText: progress && (
      <EstimateCountdown
        estimateAt={progress + estimate(item)}
        overdue={t('图片较多，请耐心等待')}
      />
    ),
  }
}

export function ImageTextActions({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')
  const { imageText, running, start, progressText } = useRecognition(item)
  if (!imageText) return null
  return (
    <span className='flex min-w-0 items-center gap-1'>
      {progressText && (
        <span className='min-w-0 truncate px-1 text-caption text-muted-foreground'>
          {progressText}
        </span>
      )}
      <IconButton
        variant='ghost'
        className='size-7 shrink-0'
        label={t('重新识别')}
        disabled={running}
        onClick={start}
      >
        <RefreshCw
          className={
            running ? 'animate-spin motion-reduce:animate-none' : undefined
          }
        />
      </IconButton>
      <CopyButton
        text={imageText.text}
        label={t('复制图中文字')}
        className='size-7 shrink-0'
      />
    </span>
  )
}

export function ImageTextPanel({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')
  const { imageText, loading, running, start, progressText } =
    useRecognition(item)
  if (loading) return null
  if (!imageText)
    return (
      <div className='flex flex-col items-center gap-3 py-12'>
        {/* 文案不变，识别中只换图标，按钮不跳动 */}
        <Button
          variant='outline'
          disabled={running}
          aria-busy={running}
          onClick={start}
        >
          {running ? (
            <Loader2 className='animate-spin motion-reduce:animate-none' />
          ) : (
            <ScanText />
          )}
          {t('识别图中文字')}
        </Button>
        <p className='h-4 text-caption text-muted-foreground'>{progressText}</p>
      </div>
    )
  // 每张图配缩略图，对得上是哪张图里的字
  return (
    <div className='space-y-4 text-body'>
      {imageText.images.map((page) => (
        <div key={page.index} className='flex gap-3'>
          {item.images[page.index - 1] && (
            <img
              src={item.images[page.index - 1]}
              alt={t('第 {{index}} 张', { index: page.index })}
              referrerPolicy='no-referrer'
              className='size-14 shrink-0 rounded-md object-cover'
              // 平台图片地址会过期，加载失败就不占位
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
          )}
          <p
            className={
              page.text
                ? 'min-w-0 whitespace-pre-wrap break-words leading-relaxed'
                : 'text-caption text-muted-foreground'
            }
          >
            {page.text || t('这张图没有文字')}
          </p>
        </div>
      ))}
    </div>
  )
}

export function OcrSettings() {
  const { t } = useTranslation('studio')
  const status = useOcrStatus()
  if (!window.studio?.ocrStatus) return null
  const state = status.data?.state
  return (
    <SettingRow
      title={t('图片转文字')}
      hint={
        !state
          ? t('正在检查 OCR 组件')
          : state === 'missing'
            ? t('这个版本没有带 OCR 组件，图中文字和暂停识别不显示')
            : t('内置 RapidOCR，图文详情和视频暂停时可以识别文字')
      }
    />
  )
}
