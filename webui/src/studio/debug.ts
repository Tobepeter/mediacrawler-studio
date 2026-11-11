import { frameDebug } from './frame-tools'
import { markDebugDriven } from './playback'
import { activeStatuses, useStudio } from './store'
import type { CollectRequest, CreatorSummary, Platform } from './types'

// 仅开发环境由 main.tsx 动态加载，生产包不含此模块
const state = () => useStudio.getState()
const form = (platform: Platform) => state().forms[platform]
const finished = (platform: Platform) =>
  !activeStatuses.includes(state().tasks[platform]?.status || '') &&
  !state().working[platform]

const until = async (check: () => boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return true
}
const dialogVideo = () =>
  document.querySelector<HTMLVideoElement>('[role=dialog] video')
const base64 = (bytes: Uint8Array) => {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000)
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(text)
}
const frameStatus = () => {
  const video = dialogVideo()
  return video
    ? {
        paused: video.paused,
        time: video.currentTime,
        readyState: video.readyState,
        tools: !!frameDebug.current,
      }
    : null
}

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
    // 打开当前结果里的一条作品详情
    openItem: (id: string, platform = state().platform) => {
      const item = state().pages[platform]?.results.find((row) => row.id === id)
      if (item) state().patch({ selected: item })
      return !!item
    },
  },
  // 视频暂停后的保存画面、识别画面文字；截图以 base64 返回，由脚本决定存哪
  frame: {
    status: frameStatus,
    pauseAt: async (seconds = 2, timeoutMs = 30000) => {
      const ready = await until(
        () => (dialogVideo()?.currentTime || 0) >= seconds,
        timeoutMs,
      )
      dialogVideo()?.pause()
      await until(() => !!frameDebug.current, 3000)
      return { ready, ...frameStatus() }
    },
    capture: async () => {
      const png = await frameDebug.current?.capture()
      return png ? { bytes: png.length, base64: base64(png) } : null
    },
    recognize: () => frameDebug.current?.recognize() ?? null,
  },
  // 图文帖的图中文字，走和界面同一个 IPC
  imageText: {
    cached: (id: string, platform = state().platform) =>
      window.studio?.cachedImageText?.(platform, id),
    recognize: (id: string, platform = state().platform) =>
      window.studio?.recognizeImages?.(platform, id),
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
