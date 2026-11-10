import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Captions, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/common/copy-button'
import { IconButton } from '@/components/common/icon-button'
import { EstimateCountdown } from './estimate-countdown'
import { SettingRow } from './settings-row'
import { recordTranscribe, transcribeEstimate } from './transcribe-estimate'
import type { ContentItem, ContentTranscript } from './types'

const statusKey = ['studio', 'stt-status']

interface Extraction {
  cold: boolean
  estimate?: number
}

// 打开应用查一次，之后只在设置里手动检查，或提取时发现不可用才重查
function useSttStatus() {
  return useQuery({
    queryKey: statusKey,
    queryFn: () => window.studio!.sttStatus!(),
    enabled: !!window.studio?.sttStatus,
    staleTime: Infinity,
  })
}

// 生成过的字幕在主进程的应用缓存里，详情打开时取一次
function useCachedTranscript(item: ContentItem) {
  return useQuery({
    queryKey: ['studio', 'transcript', item.id],
    queryFn: () => window.studio!.cachedTranscript!(item.platform, item.id),
    enabled: item.contentType === 'video' && !!window.studio?.cachedTranscript,
    staleTime: Infinity,
  })
}

function platformSubtitle(item: ContentItem): ContentTranscript | undefined {
  const tracks = (item.subtitles?.items || []).flatMap(
    ({ language, segments }) =>
      segments?.length ? [{ language, segments }] : [],
  )
  if (!tracks.length) return undefined
  const track =
    tracks.find((value) => /^(ai-)?zh/i.test(value.language || '')) || tracks[0]
  return {
    source: 'subtitle',
    language: track.language,
    segments: track.segments,
    text: track.segments.map((row) => row.text).join('\n'),
    createdAt: '',
  }
}

function clock(seconds: number) {
  const total = Math.floor(seconds || 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  const minutes = Math.floor(total / 60)
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(total % 60)}`
    : `${pad(minutes)}:${pad(total % 60)}`
}

// 这条视频现在有没有可用的字幕，下载菜单用
export function useHasTranscript(item: ContentItem) {
  const cached = useCachedTranscript(item)
  return (
    item.contentType === 'video' && (!!cached.data || !!platformSubtitle(item))
  )
}

// 有字幕或能提取时才有这个 Tab；stt 不可用且没有现成字幕时不显示入口
export function useTranscriptTab(item: ContentItem) {
  const status = useSttStatus()
  const cached = useCachedTranscript(item)
  if (item.contentType !== 'video') return false
  return (
    !!cached.data ||
    !!platformSubtitle(item) ||
    (!!status.data && status.data.state !== 'missing')
  )
}

// 右上角的操作和字幕列表各用一份，进度靠 mutation 状态共享
function useExtraction(item: ContentItem) {
  const { t } = useTranslation('studio')
  const client = useQueryClient()
  const { platform, id } = item
  const mutationKey = ['studio', 'transcribe', platform, id]
  const status = useSttStatus()
  const cached = useCachedTranscript(item)
  // 切 Tab 或关掉详情再打开时，进行中的提取和倒计时还要显示出来
  const [progress] = useMutationState({
    filters: { mutationKey, status: 'pending' },
    select: (mutation) => ({
      startedAt: mutation.state.submittedAt,
      estimate: (mutation.state.variables as Extraction | undefined)?.estimate,
    }),
  })
  const running = !!progress
  const extract = useMutation({
    mutationKey,
    mutationFn: async ({ cold }: Extraction) => {
      const startedAt = Date.now()
      const result = await window.studio!.transcribe!(platform, id)
      // 只有真正转写过的才算速度，平台字幕是直接返回的
      if (result.transcript?.source === 'stt')
        recordTranscribe(item.durationSeconds, Date.now() - startedAt, cold)
      return result
    },
    onSuccess: (result) => {
      if (result.transcript) {
        client.setQueryData(['studio', 'transcript', id], result.transcript)
        // 提取后后台已经起来了，下次预估不能再按冷启动算
        void client.invalidateQueries({ queryKey: statusKey })
        return
      }
      if (result.code === 'stt_unavailable') {
        toast.error(t('字幕提取不可用'), {
          id: 'transcribe',
          description: t('需要本机运行 stt 语音转写服务'),
        })
        void client.invalidateQueries({ queryKey: statusKey })
      } else if (result.code === 'stt_busy')
        toast.warning(
          result.retryAfter
            ? t('语音转写正忙，约 {{seconds}} 秒后再试', {
                seconds: result.retryAfter,
              })
            : t('语音转写正忙，请稍后再试'),
          { id: 'transcribe' },
        )
      else if (result.code === 'no_audio')
        toast.warning(t('这条视频没有音轨'), { id: 'transcribe' })
      else if (result.code === 'no_speech')
        toast.warning(t('没有识别到语音'), { id: 'transcribe' })
      else if (result.code === 'login')
        toast.warning(t('请先登录这个平台'), { id: 'transcribe' })
      else if (result.code === 'environment')
        toast.error(t('下载环境不可用，请检查 Python 环境'), {
          id: 'transcribe',
        })
      else if (['unavailable', 'expired'].includes(result.code))
        toast.warning(t('视频暂时拿不到，请重新打开后再试'), {
          id: 'transcribe',
        })
      else if (result.code === 'throttled')
        toast.warning(result.message || t('操作太频繁，请稍后再试'), {
          id: 'transcribe',
        })
      else toast.error(t('字幕提取失败，请重试'), { id: 'transcribe' })
    },
    onError: () => {
      toast.error(t('字幕提取失败，请重试'), { id: 'transcribe' })
    },
  })
  const start = () => {
    if (running) return
    const cold = status.data?.state === 'installed'
    extract.mutate({
      cold,
      estimate: transcribeEstimate(item.durationSeconds, cold),
    })
  }
  const progressText =
    progress &&
    (progress.estimate ? (
      <EstimateCountdown
        estimateAt={progress.startedAt + progress.estimate}
        overdue={t('任务有点长，请耐心等待')}
      />
    ) : (
      t('长视频需要一会儿，可以先看别的')
    ))
  const transcript = cached.data || platformSubtitle(item)
  const canRegenerate =
    transcript?.source === 'stt' &&
    !!status.data &&
    status.data.state !== 'missing'
  return {
    transcript,
    loading: cached.isLoading,
    running,
    start,
    progressText,
    canRegenerate,
  }
}

// 放在 Tab 行右侧，滚动时一直可见；转写期间旧字幕继续显示，失败也不丢
export function TranscriptActions({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')
  const { transcript, running, start, progressText, canRegenerate } =
    useExtraction(item)
  if (!transcript) return null
  return (
    <span className='flex min-w-0 items-center gap-1'>
      <span className='min-w-0 truncate px-1 text-caption text-muted-foreground'>
        {t(transcript.source === 'stt' ? '语音转写' : '平台字幕')}
        {progressText && <> · {progressText}</>}
      </span>
      {canRegenerate && (
        <IconButton
          variant='ghost'
          className='size-7 shrink-0'
          label={t('重新生成')}
          disabled={running}
          onClick={start}
        >
          <RefreshCw
            className={
              running ? 'animate-spin motion-reduce:animate-none' : undefined
            }
          />
        </IconButton>
      )}
      <CopyButton
        text={transcript.text}
        label={t('复制字幕')}
        className='size-7 shrink-0'
      />
    </span>
  )
}

export function TranscriptPanel({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')
  const { transcript, loading, running, start, progressText } =
    useExtraction(item)
  if (loading) return null
  if (!transcript)
    return (
      <div className='flex flex-col items-center gap-3 py-12'>
        {/* 文案不变，提取中只换图标，按钮不跳动 */}
        <Button
          variant='outline'
          disabled={running}
          aria-busy={running}
          onClick={start}
        >
          {running ? (
            <Loader2 className='animate-spin motion-reduce:animate-none' />
          ) : (
            <Captions />
          )}
          {t('提取字幕')}
        </Button>
        {/* 占位固定，状态变化时按钮不上下移动 */}
        <p className='h-4 text-caption text-muted-foreground'>{progressText}</p>
      </div>
    )
  return (
    <div className='space-y-2 text-body'>
      {transcript.segments.length ? (
        transcript.segments.map((row, index) => (
          <p key={index} className='flex gap-3 leading-relaxed'>
            <span className='shrink-0 text-caption tabular-nums leading-relaxed text-muted-foreground'>
              {clock(row.start)}
            </span>
            <span className='min-w-0 whitespace-pre-wrap break-words'>
              {row.text}
            </span>
          </p>
        ))
      ) : (
        <p className='whitespace-pre-wrap break-words leading-relaxed'>
          {transcript.text}
        </p>
      )}
    </div>
  )
}

export function SttSettings() {
  const { t } = useTranslation('studio')
  const status = useSttStatus()
  if (!window.studio?.sttStatus) return null
  const state = status.data?.state
  return (
    <SettingRow
      title={t('语音转写')}
      hint={
        state === 'ready'
          ? t('stt 服务已连接，可以在视频详情里提取字幕')
          : state === 'installed'
            ? t('检测到 stt，提取字幕时会自动启动服务')
            : state === 'missing'
              ? t('未检测到本机 stt 服务，视频详情不显示提取字幕')
              : t('正在检查 stt 服务')
      }
    >
      <Button
        variant='outline'
        disabled={status.isFetching}
        onClick={() => void status.refetch()}
      >
        {status.isFetching ? (
          <Loader2 className='animate-spin motion-reduce:animate-none' />
        ) : (
          <RefreshCw />
        )}
        {t('重新检查')}
      </Button>
    </SettingRow>
  )
}
