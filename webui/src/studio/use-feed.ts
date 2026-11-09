import {
  useInfiniteQuery,
  useMutation,
  type InfiniteData,
} from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { t } from '@/i18n/studio'
import { feedPlatforms } from './creator-options'
import { mergePages } from './merge-pages'
import { queryClient } from './query-client'
import { failureText } from './retry-notice'
import { mainScroller, platformBlocked, useStudio } from './store'
import { formatWait, retrySilently, ThrottledError } from './throttle'
import type { ContentItem, FeedPage, Platform } from './types'

const feedKey = (platform: Platform) => ['feed', platform] as const
const noop = () => {}

function request(
  platform: Platform,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  signal.addEventListener(
    'abort',
    () => void window.studio?.cancelFeed?.(platform).catch(noop),
    { once: true },
  )
  return window.studio!.loadFeed!(platform, cursor).then((page) => {
    // 被取消的空结果不能进缓存
    if (page.cancelled) throw new DOMException('cancelled', 'AbortError')
    if (page.throttled) throw new ThrottledError(page.throttled)
    return page
  })
}

const selectFeed = (data: InfiniteData<FeedPage>) => mergePages(data.pages)

// 换账号或退出后，上个账号的推荐不能留着；列表可能被搜索结果替换而没有挂载，放在组件外监听
useStudio.subscribe((state, previous) => {
  for (const platform of feedPlatforms)
    if (
      previous.accounts[platform] === 'connected' &&
      state.accounts[platform] !== 'connected'
    )
      queryClient.removeQueries({ queryKey: feedKey(platform) })
})

// 切到这个平台且已登录才向主进程要第一页，后台预取和缓存由主进程调度；
// 一次运行内不重新验证，无限列表重新验证会逐页重放，等于在狂刷接口
export function useFeed(platform: Platform) {
  const current = useStudio((state) => state.platform === platform)
  const connected = useStudio(
    (state) => state.accounts[platform] === 'connected',
  )
  useEffect(() => {
    if (current) void window.studio?.focusFeed?.(platform).catch(noop)
  }, [current, platform])
  return useInfiniteQuery({
    queryKey: feedKey(platform),
    enabled: connected && current && !!window.studio?.loadFeed,
    queryFn: ({ pageParam, signal }) => request(platform, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    select: selectFeed,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
  })
}

const refreshing = new Map<Platform, Promise<boolean>>()
const refreshListeners = new Set<() => void>()
const refreshChanged = () => refreshListeners.forEach((listener) => listener())

// 刷新期间不能翻页：翻页请求会把正在跑的刷新取消
export const useFeedRefreshing = (platform: Platform) =>
  useSyncExternalStore(
    (listener) => {
      refreshListeners.add(listener)
      return () => refreshListeners.delete(listener)
    },
    () => refreshing.has(platform),
  )

// 新内容回来才整页替换，旧列表一直留着；手动和静默刷新共用，同平台只跑一个
function replaceFeed(platform: Platform) {
  const running = refreshing.get(platform)
  if (running) return running
  const task = (async () => {
    const queryKey = feedKey(platform)
    await queryClient.cancelQueries({ queryKey })
    const page = await request(
      platform,
      undefined,
      new AbortController().signal,
    )
    if (!page.items.length) return false
    queryClient.setQueryData<InfiniteData<FeedPage>>(queryKey, {
      pages: [page],
      pageParams: [undefined],
    })
    const scroller = mainScroller()
    if (scroller) scroller.scrollTop = 0
    return true
  })().finally(() => {
    refreshing.delete(platform)
    refreshChanged()
  })
  refreshing.set(platform, task)
  refreshChanged()
  return task
}

// 手动刷新没有固定的提示位置，结果用全局提示告知
export function useFeedRefresh(platform: Platform) {
  return useMutation({
    mutationKey: ['feed-refresh', platform],
    mutationFn: () => replaceFeed(platform),
    onSuccess: (changed) => {
      if (!changed) toast(t('暂时没有新内容'), { id: 'feed-refresh' })
    },
    onError: (error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const wait =
        error instanceof ThrottledError
          ? t('{{wait}}后可刷新', { wait: formatWait(error.retryAfter) })
          : undefined
      toast.warning(failureText(error), {
        id: 'feed-refresh',
        description: wait,
      })
    },
  })
}

const FEED_STALE_MS = 30 * 60 * 1000
const ACTIVE_WITHIN_MS = 5 * 60 * 1000
let lastActivity = Date.now()
for (const event of ['pointerdown', 'keydown', 'wheel'])
  window.addEventListener(event, () => (lastActivity = Date.now()), {
    passive: true,
  })

const inUse = () =>
  document.visibilityState === 'visible' &&
  document.hasFocus() &&
  Date.now() - lastActivity < ACTIVE_WITHIN_MS

// 回到页面时列表已过期，且用户没在往下读，才静默换成新内容
function renewIfStale(platform: Platform) {
  const state = useStudio.getState()
  const updatedAt = queryClient.getQueryState(feedKey(platform))?.dataUpdatedAt
  if (
    !updatedAt ||
    Date.now() - updatedAt < FEED_STALE_MS ||
    (mainScroller()?.scrollTop || 0) > 0 ||
    !!state.selected ||
    state.creatorSearchOpen ||
    platformBlocked(state, platform)
  )
    return
  void retrySilently(() => replaceFeed(platform), {
    active: () => useStudio.getState().platform === platform,
  })
}

// 只在用户真的在用当前平台时维护缓存，窗口闲置不发请求
export function useFeedFreshness(platform: Platform, current: boolean) {
  useEffect(() => {
    if (!current) return
    const beat = () => {
      if (inUse()) void window.studio?.keepFeedFresh?.(platform).catch(noop)
    }
    const back = () => renewIfStale(platform)
    back()
    const timer = setInterval(beat, 60 * 1000)
    window.addEventListener('focus', back)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', back)
    }
  }, [current, platform])
}

// 详情补全后同步回列表，下次打开同一条不用再取
export function updateFeedItem(item: ContentItem) {
  queryClient.setQueryData<InfiniteData<FeedPage>>(
    feedKey(item.platform),
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map((value) =>
            value.id === item.id ? item : value,
          ),
        })),
      },
  )
}
