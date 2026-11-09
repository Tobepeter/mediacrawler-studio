import { useTranslation } from 'react-i18next'
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleX,
  Loader2,
  Square,
  Stethoscope,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translateMessage } from '@/i18n/studio'
import { cn } from '@/lib/utils'
import { creatorPlatforms } from './creator-options'
import { featureIssue, useFeatureCheck } from './feature-check'
import { PlatformIcon } from './platform-icon'
import { SettingRow } from './settings-row'
import { platformNames, useStudio } from './store'
import type { FeatureResult, Platform } from './types'

const labels = { feed: '推荐', creator: '博主页', search: '搜索' }
const appearance = {
  ok: { icon: CircleCheck, tone: 'text-emerald-600 dark:text-emerald-400' },
  degraded: { icon: CircleAlert, tone: 'text-amber-600 dark:text-amber-400' },
  failed: { icon: CircleX, tone: 'text-destructive' },
  skipped: { icon: CircleMinus, tone: 'text-muted-foreground' },
}

function Result({ item }: { item: FeatureResult }) {
  const { t } = useTranslation('studio')
  const { icon: Icon, tone } = appearance[item.status]
  return (
    <span className='inline-flex items-center gap-1 text-xs tabular-nums'>
      <Icon className={cn('size-3.5', tone)} aria-hidden='true' />
      {t(labels[item.id])}
      {item.count ? ` ${item.count}` : ''}
    </span>
  )
}

function PlatformLine({ platform }: { platform: Platform }) {
  const { t } = useTranslation('studio')
  const report = useFeatureCheck((state) => state.reports[platform])
  const current = useFeatureCheck((state) => state.current === platform)
  const connected = useStudio(
    (state) => state.accounts[platform] === 'connected',
  )
  const issues = (report?.items || []).filter((item) => item.status !== 'ok')
  return (
    <li className='space-y-1 px-4 py-2.5'>
      <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-1'>
        <span className='inline-flex items-center gap-2'>
          <PlatformIcon platform={platform} className='size-4' />
          {t(platformNames[platform])}
        </span>
        <span className='flex items-center gap-3 text-muted-foreground'>
          {current ? (
            <span className='inline-flex items-center gap-1 text-xs'>
              <Loader2 className='size-3.5 animate-spin motion-reduce:animate-none' />
              {t('检查中')}
            </span>
          ) : report?.items ? (
            report.items.map((item) => <Result key={item.id} item={item} />)
          ) : (
            !connected && <span className='text-xs'>{t('未登录')}</span>
          )}
        </span>
      </div>
      {report?.error && (
        <p className='text-xs text-destructive'>
          {translateMessage(report.error)}
        </p>
      )}
      {issues.map((item) => (
        <p key={item.id} className='text-xs text-muted-foreground'>
          {t(labels[item.id])}
          {t('：')}
          {featureIssue(item)}
        </p>
      ))}
    </li>
  )
}

export function FeatureSettings() {
  const { t } = useTranslation('studio')
  const running = useFeatureCheck((state) => !!state.current)
  const run = useFeatureCheck((state) => state.run)
  const stop = useFeatureCheck((state) => state.stop)
  const ready = useStudio((state) =>
    creatorPlatforms.some((id) => state.accounts[id] === 'connected'),
  )
  return (
    <>
      <SettingRow
        title={t('功能体检')}
        hint={t('用当前账号实际请求推荐、博主页和搜索，看接口有没有变化')}
      >
        <Button
          variant='outline'
          disabled={!running && (!ready || !window.studio?.checkFeatures)}
          onClick={() => (running ? stop() : void run())}
        >
          {running ? <Square /> : <Stethoscope />}
          {t(running ? '停止' : '开始体检')}
        </Button>
      </SettingRow>
      <ul className='divide-y divide-border/60'>
        {creatorPlatforms.map((platform) => (
          <PlatformLine key={platform} platform={platform} />
        ))}
      </ul>
    </>
  )
}
