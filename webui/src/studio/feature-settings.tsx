import { useTranslation } from 'react-i18next'
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleX,
  Loader2,
  Stethoscope,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translateMessage } from '@/i18n/studio'
import { cn } from '@/lib/utils'
import { creatorPlatforms } from './creator-options'
import {
  featureIssue,
  featureLabels,
  useFeatureCheck,
  useProgressText,
} from './feature-check'
import { PlatformIcon } from './platform-icon'
import { SettingPage } from './settings-row'
import { platformNames, useStudio } from './store'
import type { FeatureResult, Platform } from './types'

const platforms = Object.keys(platformNames) as Platform[]
const steps = Object.keys(featureLabels) as FeatureResult['id'][]
// 列宽和行高固定，结果陆续进来时表格不动，说明文字统一放在表格下面
const gridClass =
  'grid min-w-[30rem] grid-cols-[minmax(8rem,1.25fr)_repeat(6,minmax(3.5rem,1fr))] items-stretch'
const legend = [
  ['入口', '平台能否打开、二维码能否取到，不需要登录'],
  ['推荐、主页、搜索', '接口返回的条数和字段是否正常'],
  ['详情', '正文和图片能否拿到'],
  ['下载', '媒体地址是否可用，不会真的下载'],
]
const appearance = {
  ok: { icon: CircleCheck, tone: 'text-emerald-600 dark:text-emerald-400' },
  degraded: { icon: CircleAlert, tone: 'text-amber-600 dark:text-amber-400' },
  failed: { icon: CircleX, tone: 'text-destructive' },
  skipped: { icon: CircleMinus, tone: 'text-muted-foreground' },
}

function Cell(props: {
  status?: keyof typeof appearance
  count?: number
  active?: boolean
  title?: string
}) {
  const shape = appearance[props.status || 'skipped']
  return (
    <span
      title={props.title}
      className='flex h-full items-center justify-center gap-1 text-caption tabular-nums text-muted-foreground'
    >
      {props.active ? (
        <Loader2
          className='size-3.5 animate-spin motion-reduce:animate-none'
          aria-hidden='true'
        />
      ) : props.status ? (
        <>
          <shape.icon
            className={cn('size-3.5', shape.tone)}
            aria-label={props.status}
          />
          {props.count || ''}
        </>
      ) : (
        <span aria-hidden='true'>·</span>
      )}
    </span>
  )
}

function useItems(platform: Platform) {
  const final = useFeatureCheck((state) => state.reports[platform]?.items)
  const live = useStudio((state) =>
    state.featureCheck?.platform === platform
      ? state.featureCheck.results
      : undefined,
  )
  return final || live || []
}

function PlatformRow({ platform }: { platform: Platform }) {
  const { t } = useTranslation('studio')
  const entry = useFeatureCheck((state) => state.reports[platform]?.entry)
  const checkingEntry = useFeatureCheck((state) => state.phase === 'entry')
  const items = useItems(platform)
  const step = useStudio((state) =>
    state.featureCheck?.platform === platform
      ? state.featureCheck.step
      : undefined,
  )
  return (
    <div className={cn(gridClass, 'h-11 border-t border-border/60')}>
      <span className='flex h-full items-center gap-2 px-4'>
        <PlatformIcon platform={platform} className='size-4 shrink-0' />
        <span className='truncate'>{t(platformNames[platform])}</span>
      </span>
      <Cell
        active={checkingEntry}
        status={entry && (entry.ok ? 'ok' : 'failed')}
        title={entry?.ok === false ? t(entry.reason || '') : undefined}
      />
      {steps.map((id) => {
        const item = items.find((value) => value.id === id)
        return (
          <Cell
            key={id}
            active={step === id && !item}
            status={item?.status}
            count={item?.count}
            title={item ? featureIssue(item) : undefined}
          />
        )
      })}
    </div>
  )
}

function Issues() {
  const { t } = useTranslation('studio')
  const reports = useFeatureCheck((state) => state.reports)
  const lines = platforms.flatMap((platform) => {
    const report = reports[platform]
    if (!report) return []
    const prefix = t(platformNames[platform]) + ' '
    return [
      ...(report.entry?.ok === false
        ? [`${prefix}${t('入口')}${t('：')}${t(report.entry.reason || '')}`]
        : []),
      ...(report.error ? [prefix + translateMessage(report.error)] : []),
      ...(report.items || [])
        .filter((item) => item.status !== 'ok')
        .map(
          (item) =>
            `${prefix}${t(featureLabels[item.id])}${t('：')}${featureIssue(item)}`,
        ),
    ]
  })
  if (!lines.length) return null
  return (
    <ul className='space-y-1.5 text-caption text-muted-foreground'>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

// 还没结果时解释每一列查什么，结果框不空着
function Legend() {
  const { t } = useTranslation('studio')
  return (
    <dl className='grid gap-3 text-caption text-muted-foreground sm:grid-cols-2 xl:grid-cols-4'>
      {legend.map(([name, text]) => (
        <div key={name}>
          <dt className='font-medium text-foreground'>{t(name)}</dt>
          <dd>{t(text)}</dd>
        </div>
      ))}
    </dl>
  )
}

function LoginHint() {
  const { t } = useTranslation('studio')
  const accounts = useStudio((state) => state.accounts)
  const names = creatorPlatforms
    .filter((id) => !['connected', 'saved'].includes(accounts[id] || ''))
    .map((id) => t(platformNames[id]))
  if (!names.length) return null
  return (
    <p className='mt-auto pt-3 text-caption text-muted-foreground'>
      {t('{{names}} 未登录，只检查入口；登录后可以查更多项目', {
        names: names.join(t('、')),
      })}
    </p>
  )
}

export function FeatureSettings() {
  const { t } = useTranslation('studio')
  const running = useFeatureCheck((state) => state.phase !== 'idle')
  const stopped = useFeatureCheck((state) => state.stopped)
  const summary = useFeatureCheck((state) => state.summary)
  const run = useFeatureCheck((state) => state.run)
  const stop = useFeatureCheck((state) => state.stop)
  const progress = useProgressText()
  const status = running
    ? progress
    : summary === 'problems'
      ? t('有项目需要留意')
      : summary
        ? t(summary)
        : t('还没有检查结果')
  return (
    <SettingPage
      title={t('体检')}
      hint={t('实际走一遍常用功能，看平台接口有没有变化')}
      action={
        <Button
          variant='outline'
          className='w-28 shrink-0'
          disabled={!window.studio?.checkFeatures || stopped}
          onClick={() => (running ? stop() : void run())}
        >
          {running ? (
            <Loader2 className='animate-spin motion-reduce:animate-none' />
          ) : (
            <Stethoscope />
          )}
          {t(running ? '停止' : '开始体检')}
        </Button>
      }
    >
      {/* 表格行高固定在上面，结果占满下方固定区域并自己滚动，内容多少都不影响布局 */}
      <div className='flex h-full min-h-0 flex-col gap-4'>
        <div className='shrink-0 overflow-x-auto rounded-xl bg-muted/40'>
          <div className='min-w-[30rem]'>
            <div
              className={cn(
                gridClass,
                'h-9 shrink-0 items-center text-caption text-muted-foreground',
              )}
              aria-hidden='true'
            >
              <span />
              <span className='text-center'>{t('入口')}</span>
              {steps.map((id) => (
                <span key={id} className='text-center'>
                  {t(featureLabels[id])}
                </span>
              ))}
            </div>
            {platforms.map((platform) => (
              <PlatformRow key={platform} platform={platform} />
            ))}
          </div>
        </div>
        <aside
          aria-label={t('检查结果')}
          className='flex min-h-24 flex-1 flex-col overflow-y-auto rounded-xl border p-4'
        >
          <p role='status' className='pb-2 font-medium tabular-nums'>
            {status}
          </p>
          {!running && !summary && <Legend />}
          <Issues />
          <LoginHint />
        </aside>
      </div>
    </SettingPage>
  )
}
