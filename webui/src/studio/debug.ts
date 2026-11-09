import { markDebugDriven } from './playback'
import { activeStatuses, useStudio } from './store'
import type { CollectRequest, CreatorSummary, Platform } from './types'

// 仅开发环境由 main.tsx 动态加载，生产包不含此模块
const state = () => useStudio.getState()
const form = (platform: Platform) => state().forms[platform]
const finished = (platform: Platform) =>
  !activeStatuses.includes(state().tasks[platform]?.status || '') &&
  !state().working[platform]

const snapshot = () => {
  const { platform, ready, accounts, tasks, working, requests, pages, logins } =
    state()
  return {
    ready,
    platform,
    accounts,
    working,
    requests,
    tasks,
    form: form(platform),
    // 二维码是大段 base64，只给状态，读取结果另用 results
    logins: Object.fromEntries(
      Object.entries(logins || {}).map(([id, login]) => [id, login?.status]),
    ),
    counts: Object.fromEntries(
      Object.entries(pages).map(([id, page]) => [id, page?.results.length]),
    ),
  }
}

const debug = {
  ready: () => state().ready,
  snapshot,
  results: (platform = state().platform) =>
    state().pages[platform]?.results || [],
  history: () => state().history,
  actions: {
    switchPlatform: (platform: Platform) => state().switchPlatform(platform),
    setForm: (value: Partial<CollectRequest>) => state().updateForm(value),
    collect: () => state().start('collect'),
    cancel: (platform = state().platform) => window.studio?.cancel(platform),
    clearResults: () => state().clearResults(),
    searchCreators: (platform: Platform, keyword: string, cursor?: string) =>
      window.studio?.searchCreators?.(platform, keyword, cursor),
    pickCreator: (creator: CreatorSummary, limit = 20) =>
      state().updateForm({ query: creator.url, mode: 'creator', limit }),
  },
  waitTask: async (platform = state().platform, timeoutMs = 300000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (finished(platform)) return state().tasks[platform]
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error('waitTask timeout')
  },
}

declare global {
  interface Window {
    __STUDIO_DEBUG__?: typeof debug
  }
}

export function installStudioDebug() {
  Object.defineProperty(window, '__STUDIO_DEBUG__', {
    configurable: true,
    get: () => {
      markDebugDriven()
      return debug
    },
  })
}
