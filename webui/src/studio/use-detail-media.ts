import { useQuery } from '@tanstack/react-query'
import { feedPlatforms } from './creator-options'
import { useStudio } from './store'
import { ThrottledError } from './throttle'
import { updateFeedItem } from './use-feed'
import type { ContentItem } from './types'

const noop = () => {}

// 知乎卡片自带正文和配图，没有要补的
export const needsDetail = (item: ContentItem) =>
  feedPlatforms.includes(item.platform) &&
  item.platform !== 'zhihu' &&
  (!item.media || ['pending', 'failed'].includes(item.media.status))

// 详情先用列表数据打开，清晰度等慢数据在后台补，写回后由主进程状态推送更新
export function useDetailMedia(item: ContentItem) {
  const { platform, id } = item
  const connected = useStudio(
    (state) => state.accounts[platform] === 'connected',
  )
  const detail = useQuery({
    queryKey: ['detail-media', platform, id],
    enabled: connected && needsDetail(item) && !!window.studio?.loadDetail,
    gcTime: 0,
    staleTime: Infinity,
    queryFn: ({ signal }) => {
      signal.addEventListener(
        'abort',
        () => void window.studio?.cancelDetail?.(platform, id).catch(noop),
        { once: true },
      )
      return window.studio!.loadDetail!(platform, id).then((result) => {
        if (result.code === 'throttled')
          throw new ThrottledError({
            code: result.throttleCode || 'RATE_LIMITED',
            retryAfter: result.retryAfter || 0,
            message: result.message || '',
          })
        // 推荐流不在页面记录里，要由这里写回详情和列表
        if (result.item) {
          updateFeedItem(result.item)
          if (useStudio.getState().selected?.id === id)
            useStudio.getState().patch({ selected: result.item })
        }
        return result
      })
    },
  })
  const unavailable = !!detail.data?.code && !detail.data.item
  return {
    loading: detail.isFetching,
    // 补全失败要让用户能重试，否则正文会一直停在占位
    error:
      detail.error ??
      (unavailable ? new Error('正文暂时没有加载出来，可以查看原文') : null),
    retry: () => void detail.refetch(),
  }
}
