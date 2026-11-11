import { loginFeedback } from './login-feedback'
import { recordLoginDuration } from './login-estimate'
import { recordLoginOutcome } from './login-health'
import { t, translateMessage } from '@/i18n/studio'
import { create } from 'zustand'
import { replaceEqualDeep } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  autoBatchSize,
  creatorPlatforms,
  creatorSearchPlatforms,
  isAutoForm,
  isCreatorUrl,
} from './creator-options'
import { taskFeedback } from './task-feedback'
import type {
  CollectRequest,
  ContentItem,
  Platform,
  PlatformForm,
  StudioState,
  StudioTask,
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
const draftTimers = new Map<Platform, ReturnType<typeof setTimeout>>()
export const activeStatuses = ['checking', 'auth', 'running', 'stopping']
const initialForm = (platform: Platform): PlatformForm => ({
  platform,
  mode: 'search',
  query: '',
  limit: 5,
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

export interface AuthorTrip {
  url: string
  name: string
  pageId?: string
  scroll: number
  form: PlatformForm
}

export interface StudioStore extends StudioState {
  platform: Platform
  forms: Record<Platform, PlatformForm>
  views: Record<Platform, ReturnType<typeof initialView>>
  edited: Partial<Record<Platform, boolean>>
  ready: boolean
  attempted: Partial<Record<Platform, boolean>>
  pending: boolean
  requests: Partial<
    Record<Platform, 'start' | 'continue' | 'logout' | 'download'>
  >
  setRequest: (
    platform: Platform,
    kind?: 'start' | 'continue' | 'logout' | 'download',
  ) => void
  downloadFailure: string
  creatorSearchOpen: boolean
  // 点作者名时要搜的名字，由找博主弹窗接走后清空
  creatorLookup: string
  searchAuthor: (name: string) => void
  // 从作品点进博主后记下来处，一步回到刚才看的位置
  authorTrips: Partial<Record<Platform, AuthorTrip>>
  creatorFilters: Record<string, string>
  setCreatorFilter: (pageId: string, value: string) => void
  openAuthor: (item: ContentItem) => Promise<void>
  leaveAuthor: () => Promise<void>
  backToFeed: () => Promise<void>
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
  start: (
    action?: 'collect' | 'connect',
    silent?: boolean,
    cursor?: string,
  ) => Promise<void>
  continueCollect: () => Promise<void>
  stopContinuation: (platform?: Platform) => Promise<void>
}

export const isContinuing = (task?: StudioTask) =>
  !!task?.continued && activeStatuses.includes(task.status)

export function platformBusy(state: StudioStore, platform = state.platform) {
  return (
    state.pending || !!state.requests[platform] || !!state.working[platform]
  )
}

// 滚动续采在后台进行，不算占用，用户发起别的操作时它会让路
export function platformBlocked(state: StudioStore, platform = state.platform) {
  const request = state.requests[platform]
  return (
    state.pending ||
    (!!request && request !== 'continue') ||
    (!!state.working[platform] && !isContinuing(state.tasks[platform]))
  )
}

// 启动时有登录 Cookie 但还没验证完，大概率已登录，不能先按未登录显示二维码
// 用户手动刷新二维码时账号也是这个状态，要继续留在二维码上
export function accountChecking(state: StudioStore, platform = state.platform) {
  if (!state.ready) return true
  if (state.accounts[platform] !== 'saved') return false
  const login = state.logins?.[platform]
  return (
    !login ||
    (['queued', 'preparing'].includes(login.status) && !login.retrying)
  )
}

export const mainScroller = () =>
  document
    .querySelector('main')
    ?.closest<HTMLElement>('[data-radix-scroll-area-viewport]')

// 内容切换和渲染不同步，等目标页面出现后再定位，最多等半秒
function scrollWhen(ready: () => boolean, top: number) {
  let frames = 30
  const step = () => {
    const scroller = mainScroller()
    if (scroller && ready()) {
      scroller.scrollTop = top
      if (Math.abs(scroller.scrollTop - top) <= 1) return
    }
    if (--frames > 0) requestAnimationFrame(step)
  }
  if (top) requestAnimationFrame(step)
}

const profilePath = (url: string) => url.split(/[?#]/)[0].replace(/\/$/, '')

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
  creatorSearchOpen: false,
  creatorLookup: '',
  // 不支持搜博主的平台退回关键词搜索，同样是立刻看到这个人的相关内容
  searchAuthor: (name) => {
    const { platform, forms, updateForm, start } = get()
    if (creatorSearchPlatforms.includes(platform)) {
      set({ selected: null, creatorLookup: name })
      return
    }
    updateForm({
      query: name,
      mode: 'search',
      limit: Math.min(forms[platform].limit, 100),
    })
    void start()
  },
  authorTrips: {},
  // 按结果页记，换一批结果自然失效
  creatorFilters: {},
  setCreatorFilter: (pageId, value) =>
    set((state) => ({
      creatorFilters: { ...state.creatorFilters, [pageId]: value },
    })),
  openAuthor: async (item) => {
    const { platform, forms, pages, history } = get()
    const url = item.authorUrl
    if (!url || !creatorPlatforms.includes(platform) || !isCreatorUrl(url)) {
      get().searchAuthor(item.author)
      return
    }
    // 看过的博主直接打开记录，不再请求平台；小红书的 token 每次不同，只比主页路径
    const seen = history.find(
      ({ task, count }) =>
        task.platform === platform &&
        task.mode === 'creator' &&
        !!count &&
        profilePath(task.query) === profilePath(url),
    )
    const trip: AuthorTrip = {
      url: seen?.task.query || url,
      name: item.author,
      pageId: pages[platform]?.id,
      scroll: mainScroller()?.scrollTop || 0,
      form: forms[platform],
    }
    set((state) => ({
      selected: null,
      authorTrips: { ...state.authorTrips, [platform]: trip },
    }))
    if (seen) {
      await get().stopContinuation(platform)
      await get().restore(seen.id)
      return
    }
    get().updateForm({
      query: url,
      mode: 'creator',
      // 只是看看这个人，先来一批，往下滚再继续，不沿用手选的条数
      auto: true,
    })
    await get().start()
  },
  leaveAuthor: async () => {
    const { platform, authorTrips } = get()
    const trip = authorTrips[platform]
    if (!trip) return
    // 博主作品可能还在采集，先停下，否则平台被占着回不去
    await halt(platform)
    try {
      if (trip.pageId) await get().restore(trip.pageId)
      else await get().clearResults()
    } catch {
      toast.error(t('无法返回，请从历史记录打开'), { id: 'author-back' })
      return
    }
    get().updateForm(trip.form)
    set((state) => {
      const authorTrips = { ...state.authorTrips }
      delete authorTrips[platform]
      return { authorTrips }
    })
    scrollWhen(() => {
      const page = get().pages[platform]
      return trip.pageId ? page?.id === trip.pageId : !page
    }, trip.scroll)
  },
  // 推荐流留在查询缓存里，回去不用重新请求，这里只要把结果页撤掉
  backToFeed: async () => {
    const { platform } = get()
    set((state) => {
      const authorTrips = { ...state.authorTrips }
      delete authorTrips[platform]
      return { authorTrips }
    })
    // 后台续采还占着平台时清不掉结果，先等它退出
    await halt(platform)
    try {
      await get().clearResults()
    } catch {
      toast.error(t('操作失败，请重试'), { id: 'back-to-feed' })
      return
    }
    const scroller = mainScroller()
    if (scroller) scroller.scrollTop = 0
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
    // 每个键都存一次会让主进程反复重写 workspace.json，停手一会儿再存
    clearTimeout(draftTimers.get(platform))
    const studio = window.studio
    draftTimers.set(
      platform,
      setTimeout(() => {
        draftTimers.delete(platform)
        studio?.saveDraft(platform, form).catch(() => {
          toast.error(t('输入暂未保存，请稍后重试'), { id: 'draft-save' })
        })
      }, 400),
    )
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
    set((current) => {
      // 主进程每次推整份快照，没变的部分沿用旧引用，订阅它的组件和卡片不重渲染
      const shared = replaceEqualDeep(current as unknown as StudioState, state)
      return {
        ...shared,
        // 主进程删除字段时快照里就没有这个键，合并不会清掉，要显式覆盖
        handoff: state.handoff,
        featureCheck: state.featureCheck,
        ready: true,
        selected: current.selected
          ? shared.pages[current.platform]?.results.find(
              (item) => item.id === current.selected?.id,
            ) || current.selected
          : null,
        forms: Object.fromEntries(
          (Object.keys(platformNames) as Platform[]).map((platform) => [
            platform,
            current.edited[platform]
              ? current.forms[platform]
              : shared.drafts[platform] || current.forms[platform],
          ]),
        ) as Record<Platform, PlatformForm>,
      }
    })
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
  continueCollect: async () => {
    const cursor = get().pages[get().platform]?.task.nextCursor
    if (cursor) await get().start('collect', false, cursor)
  },
  // 后台续采不占用表单，用户发起别的操作时让路，等平台真正空闲
  stopContinuation: async (platform = get().platform) => {
    if (isContinuing(get().tasks[platform])) await halt(platform)
  },
  start: async (action = 'collect', silent = false, cursor) => {
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
    if (action === 'collect' && !cursor && isContinuing(get().tasks[platform]))
      await get().stopContinuation(platform)
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
    get().setRequest(platform, cursor ? 'continue' : 'start')
    // 滚动续采不能关掉用户正在看的详情
    set({
      selected: cursor ? get().selected : null,
      attempted: { ...get().attempted, [platform]: true },
    })
    get().updateView({ error: '', historyId: '' }, platform)
    const taskBefore = get().tasks[platform]
    try {
      // 续采沿用原任务的条件，不读也不改用户正在编辑的表单
      const page = get().pages[platform]?.task
      const form = get().forms[platform]
      const request =
        cursor && page
          ? {
              platform,
              mode: page.mode,
              query: page.query,
              limit: page.auto === false ? page.limit : autoBatchSize,
              filters: page.filters,
              auto: page.auto !== false,
            }
          : isAutoForm(form)
            ? { ...form, auto: true, limit: autoBatchSize }
            : { ...form, auto: false }
      await window.studio.start({
        ...request,
        action,
        silent,
        loginMode: 'qrcode',
        ...(cursor ? { cursor } : {}),
      })
    } catch (error) {
      if (silent) return
      // 平台正被其他操作占用时，操作结束后续采会自动再次触发
      if (
        cursor &&
        error instanceof Error &&
        error.message.includes('请先结束当前任务')
      )
        return
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

// 结束平台上的任务并等它真正退出
async function halt(platform: Platform) {
  const { getState, subscribe } = useStudio
  if (!platformBusy(getState(), platform)) return
  await window.studio?.cancel(platform).catch(() => {})
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
    const timer = setTimeout(finish, 10000)
    const unsubscribe = subscribe(() => {
      if (!platformBusy(getState(), platform)) finish()
    })
    if (!platformBusy(getState(), platform)) finish()
  })
}

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
