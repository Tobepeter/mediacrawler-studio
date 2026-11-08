import { useEffect, useRef, useState } from 'react'

// 哨兵元素进入滚动容器底部的预加载范围时触发一次
// enabled 在每次加载期间变为 false，结束后重建观察器；observe 总会回调一次当前状态，
// 所以内容没填满容器（窗口很高、一页太短）时也能继续加载，不依赖用户滚动
export function useLoadOnVisible(
  onVisible: () => void,
  enabled: boolean,
  margin = 120,
) {
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null)
  const callback = useRef(onVisible)
  useEffect(() => {
    callback.current = onVisible
  })
  useEffect(() => {
    if (!enabled || !root || !sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callback.current()
      },
      { root, rootMargin: `0px 0px ${margin}px 0px` },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [enabled, root, sentinel, margin])
  return { rootRef: setRoot, sentinelRef: setSentinel }
}
