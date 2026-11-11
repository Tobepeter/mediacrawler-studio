import { platformOfUrl } from './creator-options'
import { frameDebug } from './frame-tools'
import { markDebugDriven } from './playback'
import { queryClient } from './query-client'
import { activeStatuses, useStudio } from './store'
import type {
  CollectRequest,
  CreatorSummary,
  Platform,
  SttStatus,
} from './types'
import type { StudioStore } from './store'

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

// 改了这里要刷新页面：入口在页面启动时装上，热更新不会替换；探针按版本号判断
const VERSION = 4

const waitTask = async (platform = state().platform, timeoutMs = 300000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (finished(platform)) return state().tasks[platform]
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('waitTask timeout')
}

const detail = () => {
  const item = state().selected
  if (!item) return null
  return {
    id: item.id,
    platform: item.platform,
    contentType: item.contentType,
    images: item.images.length,
    title: item.title,
    tabs: [...document.querySelectorAll('[role=dialog] [role=tab]')].map(
      (tab) => ({
        name: tab.textContent,
        active: tab.getAttribute('data-state') === 'active',
      }),
    ),
    video: frameStatus(),
  }
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
  version: VERSION,
  ready: () => state().ready,
  snapshot,
  detail,
  profiles: () => state().profiles,
  // 截图前确保窗口可见：后台或收起时浏览器不刷新画面
  window: {
    state: () => window.studio?.debugWindow?.(),
    show: async () => {
      await window.studio?.debugShowWindow?.()
      await until(() => document.visibilityState === 'visible', 3000)
      await new Promise((resolve) => setTimeout(resolve, 300))
      return document.visibilityState
    },
  },
  // 界面上正在显示的提示，验收保存、失败提示时用
  toasts: () =>
    [...document.querySelectorAll('[data-sonner-toast]')].map(
      (toast) => (toast as HTMLElement).innerText,
    ),
  // 直接构造状态，比如关掉下载前询问、塞一个长昵称看截断；只改内存，不落盘
  patch: (value: Partial<StudioStore>) => state().patch(value),
  waitReady: (timeoutMs = 60000) => until(() => state().ready, timeoutMs),
  waitAccount: async (platform: Platform, timeoutMs = 60000) => {
    await until(() => state().accounts[platform] === 'connected', timeoutMs)
    return state().accounts[platform]
  },
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
    closeDetail: () => state().patch({ selected: null }),
    // 按作品链接采一条并打开详情；已在结果里就不重复采，返回作品 ID
    openLink: async (url: string, timeoutMs = 120000) => {
      const platform = platformOfUrl(url)
      if (!platform) throw new Error('无法识别平台')
      state().switchPlatform(platform)
      const id = (row: { url: string; id: string }) =>
        row.url === url || url.includes(row.id.split(':').pop() || '\0')
      let item = state().pages[platform]?.results.find(id)
      if (!item) {
        state().updateForm({ mode: 'link', query: url, limit: 1, auto: false })
        await state().start('collect')
        // 请求刚发出时任务状态还没更新，按“结果出现或任务失败”来等
        await until(
          () =>
            !!state().pages[platform]?.results.find(id) ||
            ['failed', 'error', 'cancelled'].includes(
              state().tasks[platform]?.status || '',
            ),
          timeoutMs,
        )
        item = state().pages[platform]?.results.find(id)
      }
      if (item) state().patch({ selected: item })
      return item?.id ?? null
    },
    // Radix 的 Tab 要用 mousedown 切换，click 不生效
    openTab: async (name: string) => {
      const tab = [
        ...document.querySelectorAll<HTMLElement>('[role=dialog] [role=tab]'),
      ].find((node) => node.textContent?.includes(name))
      tab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await until(() => tab?.getAttribute('data-state') === 'active', 2000)
      return tab?.getAttribute('data-state') === 'active'
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
  // 字幕和评论，走和界面同一个 IPC
  transcript: {
    cached: (id: string, platform = state().platform) =>
      window.studio?.cachedTranscript?.(platform, id),
    extract: (id: string, platform = state().platform) =>
      window.studio?.transcribe?.(platform, id),
  },
  comments: {
    load: (
      id: string,
      options: { cursor?: string | number; parent?: string } = {},
      platform = state().platform,
    ) => window.studio?.loadComments?.(platform, id, options),
  },
  // 语音转写状态：check 走真实检查；preview 只改界面看到的状态，用来看缺模型时的样子，refresh 恢复
  stt: {
    check: () =>
      queryClient.fetchQuery({
        queryKey: ['studio', 'stt-status'],
        queryFn: () => window.studio!.sttStatus!(),
        staleTime: 0,
      }),
    preview: (status: SttStatus) =>
      queryClient.setQueryData(['studio', 'stt-status'], status),
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: ['studio', 'stt-status'] }),
  },
  // 图文帖的图中文字，走和界面同一个 IPC
  imageText: {
    cached: (id: string, platform = state().platform) =>
      window.studio?.cachedImageText?.(platform, id),
    recognize: (id: string, platform = state().platform) =>
      window.studio?.recognizeImages?.(platform, id),
  },
  waitTask,
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
