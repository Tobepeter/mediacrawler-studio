import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useInView } from 'react-intersection-observer'

// 列表每次变化都重新挂载：inView 由观察器异步更新，沿用旧值会在追加后多请求一批
// 新实例从不可见开始，观察器首次回调给出真实位置，内容没填满时也会继续
// needsScroll 时必须有用户的真实滚动才触发，不能一打开就访问平台
export function ScrollSentinel(props: {
  active: boolean
  needsScroll: boolean
  onReach: () => void
  children: ReactNode
}) {
  const { active, needsScroll, onReach, children } = props
  const [scrolled, setScrolled] = useState(false)
  const [root, setRoot] = useState<Element | null>(null)
  const { ref, inView } = useInView({
    root,
    rootMargin: '0px 0px 800px 0px',
    skip: !root,
  })
  const anchor = useCallback(
    (node: HTMLDivElement | null) => {
      ref(node)
      setRoot(node?.closest('[data-radix-scroll-area-viewport]') ?? null)
    },
    [ref],
  )
  useEffect(() => {
    if (!root || !needsScroll) return
    // 内容变短时浏览器也会触发 scroll，回到顶部的不算用户往下看
    const mark = () => {
      if (root.scrollTop > 0) setScrolled(true)
    }
    root.addEventListener('scroll', mark, { passive: true })
    return () => root.removeEventListener('scroll', mark)
  }, [root, needsScroll])
  const shouldContinue = active && inView && (!needsScroll || scrolled)
  useEffect(() => {
    if (shouldContinue) onReach()
  }, [shouldContinue, onReach])
  return (
    <div
      ref={anchor}
      className='flex justify-center pt-6 text-sm text-muted-foreground'
    >
      {children}
    </div>
  )
}
