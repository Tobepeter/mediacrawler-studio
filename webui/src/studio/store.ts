import { loginFeedback } from './login-feedback'
import { recordLoginDuration } from './login-estimate'
import { recordLoginOutcome } from './login-health'
import { t, translateMessage } from '@/i18n/studio'
import { create } from 'zustand'
import { toast } from 'sonner'
import { taskFeedback } from './task-feedback'
import type {
  CollectRequest,
  LoginMode,
  ContentItem,
  Platform,
  PlatformForm,
  StudioState,
} from './types'

export const platformNames = {
  bili: 'B站',
  dy: '抖音',
  xhs: '小红书',
  zhihu: '知乎',
  wb: '微博',
  tieba: '贴吧',
  ks: '快手',
}
export const accountNames = {
  unknown: '未连接',
  saved: '已保存会话',
  connected: '已连接',
  expired: '需要登录',
}
export const activeStatuses = ['checking', 'auth', 'running', 'stopping']
const initialForm = (platform: Platform): PlatformForm => ({
  platform,
  mode: 'search',
  query: '',
  limit: 5,
  comments: false,
  replies: false,
  filters: {},
})
const initialView = () => ({ error: '', historyId: '' })
const downloadPromptKey = 'studio-ask-before-download'
const readDownloadPrompt = () => {
  try {
    return window.localStorage.getItem(downloadPromptKey) === 'true'
  } catch {
    return false
  }
}

interface StudioStore extends StudioState {
  platform: Platform
  forms: Record<Platform, PlatformForm>
  views: Record<Platform, ReturnType<typeof initialView>>
  edited: Partial<Record<Platform, boolean>>
  ready: boolean
  attempted: Partial<Record<Platform, boolean>>
  pending: boolean
  requests: Partial<Record<Platform, 'start' | 'logout' | 'download'>>
  setRequest: (
    platform: Platform,
    kind?: 'start' | 'logout' | 'download',
  ) => void
  downloadFailure: string
  loginMode: LoginMode
  setLoginMode: (value: LoginMode) => boolean
  askBeforeDownload: boolean
  setAskBeforeDownload: (value: boolean) => boolean
  selected: ContentItem | null
  patch: (value: Partial<StudioStore>) => void
  switchPlatform: (platform: Platform) => void
  updateForm: (value: Partial<CollectRequest>) => void
  updateView: (
    value: Partial<ReturnType<typeof initialView>>,
    platform?: Platform,
  ) => void
  receive: (state: StudioState) => void
  restore: (id: string) => Promise<void>
  clearResults: () => Promise<void>
  cancelLogin: () => Promise<void>
  start: (action?: 'collect' | 'connect', silent?: boolean) => Promise<void>
}

export function platformBusy(state: StudioStore, platform = state.platform) {
  return (
    state.pending || !!state.requests[platform] || !!state.working[platform]
  )
}

function taskSnapshot(state: StudioState, platform: Platform) {
  return {
    accounts: state.accounts,
    task: state.tasks[platform],
    results: state.pages[platform]?.results || [],
  }
}

export const useStudio = create<StudioStore>((set, get) => ({
  mode: window.studio ? 'desktop' : 'preview',
  accounts: {},
  profiles: {},
  busy: false,
  ready: false,
  attempted: {},
  tasks: {},
  working: {},
  pages: {},
  history: [],
  drafts: {},
  platform: 'bili',
  forms: {
    bili: initialForm('bili'),
    dy: initialForm('dy'),
    xhs: initialForm('xhs'),
    zhihu: initialForm('zhihu'),
    wb: initialForm('wb'),
    tieba: initialForm('tieba'),
    ks: initialForm('ks'),
  },
  views: {
    bili: initialView(),
    dy: initialView(),
    xhs: initialView(),
    zhihu: initialView(),
    wb: initialView(),
    tieba: initialView(),
    ks: initialView(),
  },
  edited: {},
  pending: false,
  requests: {},
  setRequest: (platform, kind) =>
    set((state) => {
      const requests = { ...state.requests }
      if (kind) requests[platform] = kind
      else delete requests[platform]
      return { requests }
    }),
  downloadFailure: '',
  loginMode: 'qrcode',
  setLoginMode: (value) => {
    try {
      window.localStorage.setItem('studio-login-mode', value)
      set({ loginMode: value })
      return true
    } catch {
      toast.error(t('设置保存失败，请重试'), { id: 'settings-save' })
      return false
    }
  },
  askBeforeDownload: readDownloadPrompt(),
  setAskBeforeDownload: (value) => {
    try {
      window.localStorage.setItem(downloadPromptKey, String(value))
      set({ askBeforeDownload: value })
      return true
    } catch {
      toast.error(t('设置保存失败，请重试'), { id: 'settings-save' })
      return false
    }
  },
  selected: null,
  patch: (value) => set(value),
  switchPlatform: (platform) => {
    if (platform === get().platform) return
    // 页面切换保留平台结果；后台任务由 SessionManager 独立维护
    set((state) => ({
      platform,
      selected: null,
      attempted: { ...state.attempted, [platform]: false },
    }))
  },
  updateView: (value, platform = get().platform) =>
    set((state) => ({
      views: {
        ...state.views,
        [platform]: { ...state.views[platform], ...value },
      },
    })),
  updateForm: (value) => {
    const platform = value.platform || get().platform
    const form = { ...get().forms[platform], ...value, platform }
    set((state) => ({
      platform,
      forms: { ...state.forms, [platform]: form },
      edited: { ...state.edited, [platform]: true },
    }))
    get().updateView({ error: '' }, platform)
    window.studio?.saveDraft(platform, form).catch(() => {
      toast.error(t('输入暂未保存，请稍后重试'), { id: 'draft-save' })
    })
  },
  receive: (state) => {
    const previous = get()
    const feedback = taskFeedback(
      previous.ready ? taskSnapshot(previous, previous.platform) : undefined,
      taskSnapshot(state, previous.platform),
      {
        platform: previous.platform,
        visible:
          document.visibilityState === 'visible' &&
          window.location.hash !== '#/history',
      },
    )
    const loginNotice = loginFeedback(
      previous.ready ? previous : undefined,
      state,
      {
        platform: previous.platform,
        visible:
          document.visibilityState === 'visible' &&
          window.location.hash !== '#/history',
      },
    )
    for (const platform of Object.keys(state.logins || {}) as Platform[]) {
      const login = state.logins?.[platform]
      const before = previous.logins?.[platform]
      if (
        !previous.ready ||
        !login?.id ||
        login.id !== before?.id ||
        login.status === before.status
      )
        continue
      if (login.status === 'ready' || login.status === 'connected') {
        recordLoginOutcome(platform, login.id, 'success')
        if (login.status === 'ready' && login.startedAt)
          recordLoginDuration(platform, Date.now() - login.startedAt)
      } else if (login.status === 'error')
        recordLoginOutcome(
          platform,
          login.id,
          login.failure?.code === 'TIMEOUT' ? 'timeout' : 'failed',
        )
    }
    const task = state.tasks[previous.platform]
    const beforeTask = previous.tasks[previous.platform]
    if (
      previous.ready &&
      task?.action === 'connect' &&
      beforeTask?.startedAt === task.startedAt &&
      beforeTask?.platform === task.platform
    ) {
      const id = `${task.platform}:${task.startedAt}`
      if (state.accounts[task.platform] === 'connected')
        recordLoginOutcome(task.platform, id, 'success')
      else if (task.status === 'error' && beforeTask.status !== 'error') {
        recordLoginOutcome(
          task.platform,
          id,
          task.failure?.code === 'TIMEOUT' ||
            task.message === '获取二维码超时，请重试'
            ? 'timeout'
            : 'failed',
        )
      }
    }
    set((current) => ({
      ...state,
      ready: true,
      selected: current.selected
        ? state.pages[current.platform]?.results.find(
            (item) => item.id === current.selected?.id,
          ) || current.selected
        : null,
      forms: Object.fromEntries(
        (Object.keys(platformNames) as Platform[]).map((platform) => [
          platform,
          current.edited[platform]
            ? current.forms[platform]
            : state.drafts[platform] || current.forms[platform],
        ]),
      ) as Record<Platform, PlatformForm>,
    }))
    if (loginNotice)
      toast[loginNotice.kind](t(loginNotice.message), { id: loginNotice.id })
    if (feedback)
      toast[feedback.kind](t(feedback.message, { count: feedback.count }), {
        id: feedback.id,
        description: feedback.detail
          ? translateMessage(feedback.detail)
          : undefined,
      })
  },
  restore: async (id) => {
    if (!window.studio) return
    const record = await window.studio.openHistory(id)
    get().updateForm({
      platform: record.task.platform,
      query: record.task.query,
      mode: record.task.mode,
      limit: record.task.limit,
      comments: record.task.comments === true,
      replies: record.task.replies === true,
      filters: record.task.filters || {},
    })
    get().updateView({ error: '', historyId: record.id }, record.task.platform)
    set({ selected: null })
  },
  clearResults: async () => {
    const { platform } = get()
    if (platformBusy(get(), platform)) return
    const id = get().pages[platform]?.id
    if (window.studio) await window.studio.clearResults(platform)
    set((state) => {
      if (state.pages[platform] && state.pages[platform]?.id !== id) return {}
      const pages = { ...state.pages }
      delete pages[platform]
      return {
        pages,
        views: { ...state.views, [platform]: initialView() },
        selected: state.selected?.platform === platform ? null : state.selected,
      }
    })
  },
  cancelLogin: async () => {
    const { platform, tasks } = get()
    const task = tasks[platform]
    if (task?.platform === platform && activeStatuses.includes(task.status))
      await window.studio?.cancel(platform)
    else if (window.studio?.stopLogin) await window.studio.stopLogin(platform)
    else await window.studio?.cancel(platform)
  },
  start: async (action = 'collect', silent = false) => {
    if (action === 'connect' && window.studio?.retryLogin) {
      const platform = get().platform
      get().updateView({ historyId: '' }, platform)
      if (
        ['error', 'expired', 'paused'].includes(
          get().logins?.[platform]?.status || '',
        )
      )
        await window.studio.retryLogin(platform)
      else await window.studio.ensureLogin?.(platform)
      return
    }
    const platform = get().platform
    if (platformBusy(get(), platform)) return
    if (action === 'collect' && get().accounts[platform] !== 'connected') {
      get().updateView(
        {
          error: t('请先登录{{platform}}', {
            platform: t(platformNames[platform]),
          }),
        },
        platform,
      )
      return
    }
    if (!window.studio) {
      get().updateView(
        { error: '当前是界面预览，请在桌面应用中扫码登录与采集' },
        platform,
      )
      return
    }
    get().setRequest(platform, 'start')
    set({
      selected: null,
      attempted: { ...get().attempted, [platform]: true },
    })
    get().updateView({ error: '', historyId: '' }, platform)
    const taskBefore = get().tasks[platform]
    try {
      await window.studio.start({
        ...get().forms[platform],
        action,
        silent,
        loginMode: 'qrcode',
      })
    } catch (error) {
      if (silent) return
      get().updateView(
        {
          error:
            error instanceof Error
              ? error.message.replace(
                  /^Error invoking remote method '[^']+': Error: /,
                  '',
                )
              : '操作失败，请重试',
        },
        platform,
      )
      // 主进程已发布失败状态时，由 receive 通知，避免再弹一次
      if (
        get().platform === platform &&
        (get().tasks[platform] === taskBefore ||
          get().tasks[platform]?.status !== 'error')
      ) {
        toast.error(t('无法开始'), {
          id: 'task-start',
          description: translateMessage(get().views[platform].error),
        })
      }
    } finally {
      get().setRequest(platform)
    }
  },
}))

export const useForm = () => useStudio((state) => state.forms[state.platform])
export const usePage = () => useStudio((state) => state.pages[state.platform])
export const useView = () => useStudio((state) => state.views[state.platform])
export const useViewTask = () =>
  useStudio((state) => {
    const task = state.tasks[state.platform]
    if (
      task?.platform === state.platform &&
      (activeStatuses.includes(task.status) ||
        (task.action === 'connect' && task.status === 'error'))
    )
      return task
    return state.pages[state.platform]?.task || null
  })

// 单一事件订阅，卸载后释放
export function connectStudio() {
  const bridge = window.studio
  if (!bridge) return () => {}
  let active = true
  let received = false
  const unsubscribe = bridge.subscribe((state) => {
    received = true
    if (active) useStudio.getState().receive(state)
  })
  bridge
    .snapshot()
    .then((state) => {
      if (active && !received) useStudio.getState().receive(state)
    })
    .catch(() => {
      if (active) {
        useStudio
          .getState()
          .updateView({ error: '无法连接桌面进程，请重新打开应用' })
        toast.error(t('无法连接桌面进程，请重新打开应用'), {
          id: 'studio-connection',
        })
      }
    })
  return () => {
    active = false
    unsubscribe()
  }
}
