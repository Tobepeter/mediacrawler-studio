import { create } from 'zustand'
import { toast } from 'sonner'
import { t, translateMessage } from '@/i18n/studio'
import { creatorPlatforms } from './creator-options'
import { ipcFailure } from './ipc-failure'
import { platformBlocked, useStudio } from './store'
import type { FeatureResult, Platform } from './types'

export interface PlatformReport {
  items?: FeatureResult[]
  error?: string
}

interface FeatureCheck {
  current: Platform | null
  stopped: boolean
  reports: Partial<Record<Platform, PlatformReport>>
  run: () => Promise<void>
  stop: () => void
}

// 放在设置面板外，关掉面板检查也继续；一个平台查完再查下一个，不并发打平台
export const useFeatureCheck = create<FeatureCheck>((set, get) => ({
  current: null,
  stopped: false,
  reports: {},
  run: async () => {
    if (get().current || !window.studio?.checkFeatures) return
    const targets = creatorPlatforms.filter((id) =>
      ['connected', 'saved'].includes(useStudio.getState().accounts[id] || ''),
    )
    set({ reports: {}, stopped: false })
    for (const platform of targets) {
      if (get().stopped) break
      set({ current: platform })
      const report = await inspect(platform)
      if (report)
        set((state) => ({ reports: { ...state.reports, [platform]: report } }))
    }
    set({ current: null })
    if (!get().stopped) announce(Object.values(get().reports))
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
  if (!(await settled(platform))) return { error: '登录后才能体检' }
  if (platformBlocked(useStudio.getState(), platform))
    return { error: '平台正在使用，已跳过' }
  try {
    const page = await window.studio!.checkFeatures!(platform)
    return page.cancelled ? null : { items: page.items }
  } catch (error) {
    return { error: ipcFailure(error) }
  }
}

function announce(reports: PlatformReport[]) {
  if (!reports.length) return
  const results = reports.flatMap((report) => report.items || [])
  const problems =
    results.filter((item) => item.status !== 'ok').length +
    reports.filter((report) => report.error).length
  if (problems)
    toast.warning(t('体检发现 {{count}} 项需要留意', { count: problems }), {
      id: 'feature-check',
    })
  else toast.success(t('全部功能正常'), { id: 'feature-check' })
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
