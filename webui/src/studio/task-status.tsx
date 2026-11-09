import { useTranslation } from 'react-i18next'
import { translateMessage } from '@/i18n/studio'
import { IconButton } from '@/components/common/icon-button'
import { useEffect, useState } from 'react'
import { ScanLine, Square, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Help } from './help'
import {
  activeStatuses,
  usePage,
  useStudio,
  useView,
  useViewTask,
} from './store'

// 次要统计固定在窗口右下角，不占结果工具栏
export function TaskStatus() {
  const { t } = useTranslation('studio')

  const currentTask = useViewTask()
  const task =
    currentTask?.silent && currentTask.status === 'error' ? null : currentTask
  const { error } = useView()
  const results = usePage()?.results || []
  const mode = useStudio((state) => state.mode)
  const platform = useStudio((state) => state.platform)
  const downloadPending = useStudio((state) =>
    ['video', 'images'].includes(state.working[platform] || ''),
  )
  const [now, setNow] = useState(Date.now())
  const active = activeStatuses.includes(task?.status || '')
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  const failed = !!error || task?.status === 'error'
  const labels = {
    checking: t('连接中'),
    auth: t('等待扫码'),
    running: task?.message === '正在获取评论' ? t('采集评论') : t('采集中'),
    stopping: t('正在停止'),
    completed: t('已完成'),
    cancelled: t('已取消'),
    error: task?.action === 'connect' ? t('登录失败') : t('采集失败'),
    restored: '',
  }
  const label = error ? t('无法开始') : task ? labels[task.status] : ''
  const seconds = task
    ? Math.max(
        0,
        Math.floor(((task.finishedAt || now) - task.startedAt) / 1000),
      )
    : 0
  const detail = error || (failed ? task?.message : '')
  const showLogin = async () => {
    try {
      await window.studio?.showLogin(undefined, platform)
    } catch {
      toast.error(t('打开失败，请重试'))
    }
  }
  if (downloadPending)
    return (
      <div
        className='flex h-9 items-center justify-end gap-2 text-caption text-muted-foreground'
        role='status'
      >
        <Loader2 className='size-3 animate-spin motion-reduce:animate-none' />
        {t('下载中')}
        <IconButton
          label={t('取消下载')}
          onClick={() =>
            void window.studio
              ?.cancel(platform)
              .catch(() => toast.error(t('停止失败，请重试')))
          }
        >
          <Square />
        </IconButton>
      </div>
    )
  if (currentTask?.action === 'connect') return <div className='h-9' />
  return (
    <div
      className='flex h-9 min-w-0 items-center justify-end gap-2 text-caption text-muted-foreground'
      role={failed ? 'alert' : 'status'}
    >
      {!!results.length && (
        <span>
          {t('{{count}} 条', { count: results.length })}
          {mode === 'preview' ? t(' · 示例') : ''}
        </span>
      )}
      <span
        className={cn(
          'truncate text-muted-foreground',
          failed && 'text-destructive',
        )}
      >
        {label}
      </span>
      {!!label && !failed && (
        <span className='hidden shrink-0 tabular-nums text-muted-foreground sm:inline'>
          {seconds < 60
            ? `${seconds}s`
            : `${Math.floor(seconds / 60)}m ${seconds % 60}s`}
        </span>
      )}
      {(detail || task?.warning) && (
        <Help label={t('状态说明')}>
          {detail && <p>{translateMessage(detail)}</p>}
          {task?.warning && <p>{translateMessage(task.warning)}</p>}
        </Help>
      )}
      {task?.status === 'auth' && (
        <IconButton
          variant='ghost'
          className='shrink-0'
          aria-label={t('打开平台')}
          label={t('打开平台')}
          onClick={() => void showLogin()}
        >
          <ScanLine />
        </IconButton>
      )}
    </div>
  )
}
