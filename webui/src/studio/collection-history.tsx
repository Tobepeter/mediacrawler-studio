import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { platformBusy, platformNames, useStudio } from './store'
import { PlatformIcon } from './platform-icon'
import type { Platform } from './types'

// 聚合最近采集批次，打开后回到采集页，不重新请求平台
export function CollectionHistory() {
  const { t, i18n } = useTranslation('studio')

  const state = useStudio()
  const { history, restore } = state
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const entries = history
    .filter((entry) => platform === 'all' || entry.task.platform === platform)
    .sort((a, b) => b.task.startedAt - a.task.startedAt)
    .slice(0, 50)
  const recovery = useMutation({
    mutationFn: (id: string) => restore(id),
    onSuccess: () => {
      if (window.location.hash === '#/history') window.location.hash = '/'
    },
    onError: () => toast.error(t('暂时无法打开记录，请稍后重试')),
  })
  const loading = recovery.isPending ? recovery.variables : null
  const recover = (id: string) => {
    if (!recovery.isPending) recovery.mutate(id)
  }
  return (
    <div className='p-1 pr-3'>
      <div className='mb-4 flex items-center justify-between gap-4'>
        <span className='text-muted-foreground'>{t('最近 50 次')}</span>
        <Select
          value={platform}
          onValueChange={(value) => setPlatform(value as Platform | 'all')}
        >
          <SelectTrigger className='w-36' aria-label={t('历史平台')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>{t('全部')}</SelectItem>
            {(Object.keys(platformNames) as Platform[]).map((id) => (
              <SelectItem key={id} value={id}>
                {t(platformNames[id])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!entries.length ? (
        <div className='flex flex-col items-center gap-3 py-16 text-muted-foreground'>
          <History className='size-6' aria-hidden='true' />
          <span>{t('暂无历史')}</span>
        </div>
      ) : (
        <ul className='space-y-1' aria-label={t('采集记录')}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <Button
                variant='ghost'
                className='w-full justify-start gap-3'
                disabled={
                  !window.studio ||
                  platformBusy(state, entry.task.platform) ||
                  !!loading
                }
                onClick={() => void recover(entry.id)}
              >
                <span className='flex min-w-0 flex-1 items-center justify-between gap-6'>
                  <span className='truncate'>
                    {entry.task.creator?.name ||
                      entry.task.query ||
                      t('之前的采集')}
                  </span>
                  <span className='flex shrink-0 items-center gap-4 font-normal text-muted-foreground'>
                    <span className='inline-flex items-center gap-1'>
                      <PlatformIcon platform={entry.task.platform} />
                      {t(platformNames[entry.task.platform])}
                    </span>
                    <time
                      dateTime={new Date(entry.task.startedAt).toISOString()}
                    >
                      {new Date(entry.task.startedAt).toLocaleString(
                        i18n.resolvedLanguage,
                        {
                          year: 'numeric',
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        },
                      )}
                    </time>
                    <span>{t('{{count}} 条', { count: entry.count })}</span>
                    {entry.task.status === 'cancelled' && (
                      <span>{t('已取消')}</span>
                    )}
                    {entry.task.status === 'error' && (
                      <span>{t('未完成')}</span>
                    )}
                  </span>
                </span>
                <span className='size-4 shrink-0' aria-hidden='true'>
                  {loading === entry.id && (
                    <Loader2 className='size-4 animate-spin motion-reduce:animate-none' />
                  )}
                </span>
                {loading === entry.id && (
                  <span className='sr-only' role='status'>
                    {t('正在打开')}
                  </span>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
