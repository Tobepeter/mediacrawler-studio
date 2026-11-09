import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { queryClient } from './query-client'
import { mergePages } from './merge-pages'
import type { CreatorPage, Platform } from './types'

const queryKey = ['creator-search'] as const
const noop = () => {}

// 搜索进程独占平台，新请求要等上一个真正退出，否则主进程会报平台忙
let inflight: Promise<unknown> = Promise.resolve()

function request(
  platform: Platform,
  keyword: string,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  const previous = inflight
  const current = (async (): Promise<CreatorPage> => {
    await previous.catch(noop)
    signal.throwIfAborted()
    const stop = () => void window.studio?.cancel(platform).catch(noop)
    signal.addEventListener('abort', stop, { once: true })
    try {
      const page = await window.studio!.searchCreators!(
        platform,
        keyword,
        cursor,
      )
      // 被取消的空结果不能进缓存
      if (page.cancelled) throw new DOMException('cancelled', 'AbortError')
      return page
    } finally {
      signal.removeEventListener('abort', stop)
    }
  })()
  inflight = current
  return current
}

// 接口是混排结果，不同页可能重复；整页都重复时 stalled，交给用户决定是否继续
const selectCreators = (data: InfiniteData<CreatorPage>) =>
  mergePages(data.pages)

export function useCreatorSearch(platform: Platform, keyword: string) {
  return useInfiniteQuery({
    queryKey: [...queryKey, platform, keyword],
    enabled: !!keyword,
    queryFn: ({ pageParam, signal }) =>
      request(platform, keyword, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    select: selectCreators,
    // 博主资料短时间不变；无限列表一旦重新验证会逐页重放，搜索接口承受不起
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    refetchOnMount: false,
  })
}

// 取消后等进程退出，之后才能在同平台开始采集或打开记录
export async function settleCreatorSearch() {
  await queryClient.cancelQueries({ queryKey })
  await inflight.catch(noop)
}
