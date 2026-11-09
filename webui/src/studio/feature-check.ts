import { create } from 'zustand'
import { toast } from 'sonner'
import { t, translateMessage } from '@/i18n/studio'
import { creatorPlatforms } from './creator-options'
import { healthReason } from './health-summary'
import { ipcFailure } from './ipc-failure'
import { platformBlocked, platformNames, useStudio } from './store'
import type { FeatureResult, HealthReport, Platform } from './types'

export interface PlatformReport {
  entry?: { ok: boolean; reason?: string }
  items?: FeatureResult[]
  error?: string
}

interface FeatureCheck {
  phase: 'idle' | 'entry' | 'features'
  stopped: boolean
  current: Platform | null
  position: number
  total: number
  reports: Partial<Record<Platform, PlatformReport>>
  summary: string
  run: () => Promise<void>
  stop: () => void
}

const merge = (
  reports: FeatureCheck['reports'],
  platform: Platform,
  value: PlatformReport,
) => ({ ...reports, [platform]: { ...reports[platform], ...value } })

function entryReports(report: HealthReport) {
  let reports: FeatureCheck['reports'] = {}
  for (const item of report.platforms)
    reports = merge(reports, item.platform, {
      entry: {
        ok: item.status === 'ok',
        reason: healthReason(item.error) || '访问异常',
      },
    })
  return reports
}

// 放在设置面板外，关掉面板也继续；没登录的只查入口，登录的再逐个查功能，不并发打平台
export const useFeatureCheck = create<FeatureCheck>((set, get) => ({
  phase: 'idle',
  stopped: false,
  current: null,
  position: 0,
  total: 0,
  reports: {},
  summary: '',
  run: async () => {
    if (get().phase !== 'idle') return
    set({ phase: 'entry', stopped: false, reports: {}, summary: '' })
    try {
      const report = await window.studio?.healthCheck?.()
      if (report) set({ reports: entryReports(report) })
    } catch {
      set({ summary: '平台入口没有检查完' })
    }
    const targets = creatorPlatforms.filter((id) =>
      ['connected', 'saved'].includes(useStudio.getState().accounts[id] || ''),
    )
    set({ phase: 'features', total: targets.length })
    for (const [index, platform] of targets.entries()) {
      if (get().stopped) break
      set({ current: platform, position: index + 1 })
      const report = await inspect(platform)
      if (report)
        set((state) => ({ reports: merge(state.reports, platform, report) }))
    }
    set({ phase: 'idle', current: null })
    finish()
  },
  stop: () => {
    const { current } = get()
    set({ stopped: true })
    if (current) void window.studio?.cancel(current).catch(() => {})
  },
}))

// 刚启动时已保存的账号还在确认，等结果出来，别把它漏掉
async function settled(platform: Platform) {
  const status = () => useStudio.getState().accounts[platform]
  for (let wait = 0; wait < 60 && status() === 'saved'; wait++)
    await new Promise((resolve) => setTimeout(resolve, 500))
  return status() === 'connected'
}

async function inspect(platform: Platform): Promise<PlatformReport | null> {
  if (!(await settled(platform))) return null
  if (platformBlocked(useStudio.getState(), platform))
    return { error: '平台正在使用，已跳过' }
  try {
    const page = await window.studio!.checkFeatures!(platform)
    return page.cancelled ? null : { items: page.items }
  } catch (error) {
    return { error: ipcFailure(error) }
  }
}

function finish() {
  const { stopped, reports, summary } = useFeatureCheck.getState()
  if (stopped) {
    useFeatureCheck.setState({ summary: '已停止' })
    return
  }
  const all = Object.values(reports)
  const problems =
    all
      .flatMap((report) => report.items || [])
      .filter((item) => item.status !== 'ok').length +
    all.filter((report) => report.error || report.entry?.ok === false).length
  if (summary) toast.warning(t(summary), { id: 'feature-check' })
  else if (problems) {
    useFeatureCheck.setState({ summary: 'problems' })
    toast.warning(t('体检发现 {{count}} 项需要留意', { count: problems }), {
      id: 'feature-check',
    })
  } else {
    useFeatureCheck.setState({ summary: '全部功能正常' })
    toast.success(t('全部功能正常'), { id: 'feature-check' })
  }
}

// 把检查结果翻成一句人话，正常的项目不解释
export function featureIssue(item: FeatureResult) {
  if (item.status === 'ok') return ''
  if (item.message) return translateMessage(item.message)
  if (!item.count) return t('没有返回内容')
  if (item.missing?.length)
    return t('部分卡片缺少：{{fields}}', { fields: item.missing.join('、') })
  return t('只有 {{count}} 条，通常不少于 {{expected}} 条', {
    count: item.count,
    expected: item.expected,
  })
}

export const featureLabels: Record<string, string> = {
  feed: '推荐',
  creator: '主页',
  detail: '详情',
  download: '下载',
  search: '搜索',
}

// 进度一句话说清现在在干什么；节流等待会停十几秒，必须讲明白，不然像卡住
export function useProgressText() {
  const phase = useFeatureCheck((state) => state.phase)
  const stopped = useFeatureCheck((state) => state.stopped)
  const current = useFeatureCheck((state) => state.current)
  const position = useFeatureCheck((state) => state.position)
  const total = useFeatureCheck((state) => state.total)
  const health = useStudio((state) => state.healthCheck)
  const feature = useStudio((state) => state.featureCheck)
  if (phase === 'idle') return ''
  if (stopped) return t('正在停止')
  if (phase === 'entry')
    return health?.stage === 'platforms'
      ? t('正在检查平台入口 {{completed}}/{{total}}', {
          completed: health.completed,
          total: health.total,
        })
      : t('正在检查网络')
  if (!current) return t('正在收尾')
  const name = t(platformNames[current])
  if (feature?.platform !== current)
    return t('{{name}}：正在准备（第 {{position}}/{{total}} 个平台）', {
      name,
      position,
      total,
    })
  const step = t(featureLabels[feature.step] || feature.step)
  return feature.waitSeconds
    ? t(
        '{{name}}：{{step}}，按节流等待 {{seconds}} 秒（第 {{position}}/{{total}} 个平台）',
        {
          name,
          step,
          seconds: feature.waitSeconds,
          position,
          total,
        },
      )
    : t('{{name}}：正在检查{{step}}（第 {{position}}/{{total}} 个平台）', {
        name,
        step,
        position,
        total,
      })
}
