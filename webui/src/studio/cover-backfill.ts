import { useEffect } from 'react'
import { useInView } from 'react-intersection-observer'
import { updateFeedItem } from './use-feed'
import type { ContentItem, Platform } from './types'

const BUSY_RETRY_MS = 5000
const MAX_THROTTLE_WAIT_MS = 60 * 1000

interface Queue {
  visible: Map<string, ContentItem>
  tried: Set<string>
  running: boolean
}
const queues = new Map<Platform, Queue>()
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function queueOf(platform: Platform) {
  let queue = queues.get(platform)
  if (!queue) {
    queue = { visible: new Map(), tried: new Set(), running: false }
    queues.set(platform, queue)
  }
  return queue
}

// 只补还在视口里的，最新进入视口的优先；一个平台同一时间一条，排不上就等，失败不重复试
async function pump(platform: Platform) {
  const queue = queueOf(platform)
  if (queue.running) return
  queue.running = true
  try {
    while (queue.visible.size && document.visibilityState === 'visible') {
      const item = [...queue.visible.values()].pop()!
      const result = await window.studio!.loadDetail!(platform, item.id, {
        background: true,
      }).catch(() => ({ code: 'failed' }) as const)
      if (result.code === 'busy') {
        await wait(BUSY_RETRY_MS)
        continue
      }
      if (result.code === 'throttled') {
        const delay =
          (('retryAfter' in result && result.retryAfter) || 0) * 1000
        if (delay > MAX_THROTTLE_WAIT_MS) return
        await wait(Math.max(delay, 1000))
        continue
      }
      queue.tried.add(item.id)
      queue.visible.delete(item.id)
      if ('item' in result && result.item) updateFeedItem(result.item)
    }
  } finally {
    queue.running = false
  }
}

// 卡片进入视口且列表没给封面时，排队取一次详情，封面和正文一起回来
export function useCoverBackfill(item: ContentItem) {
  const needed =
    !!item.detailPending &&
    !item.images.length &&
    !!window.studio?.loadDetail &&
    !queueOf(item.platform).tried.has(item.id)
  const { ref, inView } = useInView({ skip: !needed })
  useEffect(() => {
    if (!needed || !inView) return
    const queue = queueOf(item.platform)
    queue.visible.set(item.id, item)
    void pump(item.platform)
    return () => void queue.visible.delete(item.id)
  }, [needed, inView, item])
  // 知乎纯文字回答本来就没有封面，占位会白白跳动
  return {
    ref,
    pending:
      !!item.detailPending && !item.images.length && item.platform !== 'zhihu',
  }
}
