import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { useEffect } from 'react'
import { feedPlatforms } from './creator-options'
import { mergePages } from './merge-pages'
import { queryClient } from './query-client'
import { useStudio } from './store'
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
