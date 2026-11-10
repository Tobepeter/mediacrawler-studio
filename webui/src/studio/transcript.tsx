import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Captions, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/common/copy-button'
import { SettingRow } from './settings-row'
import { useStudio } from './store'
import { updateFeedItem } from './use-feed'
import type { ContentItem, ContentTranscript } from './types'

const statusKey = ['studio', 'stt-status']

// 打开应用查一次，之后只在设置里手动检查，或提取时发现不可用才重查
function useSttStatus() {
  return useQuery({
    queryKey: statusKey,
    queryFn: () => window.studio!.sttStatus!(),
    enabled: !!window.studio?.sttStatus,
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

// 有字幕或能提取时才有这个 Tab；stt 不可用且没有现成字幕时不显示入口
export function useTranscriptTab(item: ContentItem) {
  const status = useSttStatus()
  if (item.contentType !== 'video') return false
  return (
    !!item.transcript ||
    !!platformSubtitle(item) ||
    (!!status.data && status.data.state !== 'missing')
  )
}

export function TranscriptPanel({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')
  const client = useQueryClient()
  const { platform, id } = item
  const mutationKey = ['studio', 'transcribe', platform, id]
  // 切 Tab 或关掉详情再打开时，进行中的提取还要显示出来
  const running = useIsMutating({ mutationKey }) > 0
  const extract = useMutation({
    mutationKey,
    mutationFn: () => window.studio!.transcribe!(platform, id),
    onSuccess: (result) => {
      if (result.transcript) {
        const next = { ...item, transcript: result.transcript }
        updateFeedItem(next)
        const state = useStudio.getState()
        if (state.selected?.id === id)
          state.patch({
            selected: { ...state.selected, transcript: result.transcript },
          })
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
  const transcript = item.transcript || platformSubtitle(item)
  if (!transcript)
    return (
      <div className='flex flex-col items-center gap-3 py-12'>
        {/* 文案不变、宽度固定，提取中只换图标，按钮不跳动 */}
        <Button
          variant='outline'
          className='w-32'
          disabled={running}
          aria-busy={running}
          onClick={() => {
            if (!running) extract.mutate()
          }}
        >
          {running ? (
            <Loader2 className='animate-spin motion-reduce:animate-none' />
          ) : (
            <Captions />
          )}
          {t('提取字幕')}
        </Button>
        {/* 占位固定，状态变化时按钮不上下移动 */}
        <p className='h-4 text-caption text-muted-foreground' role='status'>
          {running && t('长视频需要一会儿，可以先看别的')}
        </p>
      </div>
    )
  return (
    <div className='space-y-2'>
      {/* 字幕很长，滚动时来源和复制按钮留在顶部；右边让出弹窗的关闭按钮 */}
      <div className='sticky top-0 z-10 mr-8 flex items-center justify-between gap-2 bg-background py-1'>
        <span className='text-caption text-muted-foreground'>
          {t(transcript.source === 'stt' ? '语音转写' : '平台字幕')}
        </span>
        <CopyButton
          text={transcript.text}
          label={t('复制字幕')}
          className='size-7'
        />
      </div>
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
