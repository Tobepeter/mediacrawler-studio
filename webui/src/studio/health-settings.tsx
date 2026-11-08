import { useIsMutating, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Activity, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { healthSummary } from './health-summary'
import { platformNames, useStudio } from './store'
import i18n from '@/i18n'
import type { Platform } from './types'

// 显式检查跨 Tab 汇总，关闭设置仍完成通知
export function HealthSettings() {
  const { t } = useTranslation('studio')
  const progress = useStudio((state) => state.healthCheck)
  const mutating = useIsMutating({ mutationKey: ['health-check'] }) > 0
  const checking = mutating || (!!progress && progress.stage !== 'done')
  const check = useMutation({
    mutationKey: ['health-check'],
    mutationFn: async () => {
      if (!window.studio?.healthCheck) throw new Error('Unavailable')
      return window.studio.healthCheck()
    },
    retry: false,
    onSuccess: (report) => {
      const summary = healthSummary(report)
      const translate = (key: string) => i18n.t(key, { ns: 'studio' })
      const message = summary.groups.length
        ? summary.groups
            .map(
              (group) =>
                group.platforms
                  .map((platform) =>
                    translate(platformNames[platform as Platform]),
                  )
                  .join(translate('、')) +
                translate('：') +
                translate(group.reason),
            )
            .join(translate('；'))
        : translate(summary.message)
      toast[summary.kind](message, {
        id: 'health-check',
        duration: summary.groups.length ? 8000 : 4000,
      })
    },
    onError: () =>
      toast.error(i18n.t('检查未完成，请重试', { ns: 'studio' }), {
        id: 'health-check',
      }),
  })
  return (
    <div className='flex min-h-9 flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 p-4'>
      <div className='flex items-center gap-3'>
        <span className='font-medium'>{t('连接检查')}</span>
        {checking && (
          <span
            role='status'
            className='text-sm tabular-nums text-muted-foreground'
          >
            {progress?.stage === 'platforms'
              ? t('已检查 {{completed}}/{{total}}', {
                  completed: progress.completed,
                  total: progress.total,
                })
              : t('正在检查网络')}
          </span>
        )}
      </div>
      <Button
        variant='outline'
        disabled={!window.studio?.healthCheck || checking}
        onClick={() => check.mutate()}
      >
        {checking ? (
          <Loader2 className='animate-spin motion-reduce:animate-none' />
        ) : (
          <Activity />
        )}
        {t(checking ? '检查中' : '检查全部平台')}
      </Button>
    </div>
  )
}
