import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useInView } from 'react-intersection-observer'

// 列表每次变化都重新挂载：inView 由观察器异步更新，沿用旧值会在追加后多请求一批
// 新实例从不可见开始，观察器首次回调给出真实位置，内容没填满时也会继续
// needsScroll 时必须有用户的真实滚动才触发，不能一打开就访问平台
// fillScreens 例外：内容不够可视区下方这么多屏时不等滚动先补，0 表示只铺满当前屏，不传不补
// screens 是滚动时提前加载的距离，按可视区屏数算，窗口变化时自动跟随
export function ScrollSentinel(props: {
  active: boolean
  needsScroll: boolean
  fillScreens?: number
  screens?: number
  onReach: () => void
  children: ReactNode
}) {
  const {
    active,
    needsScroll,
    fillScreens,
    screens = 1,
    onReach,
    children,
  } = props
  const [scrolled, setScrolled] = useState(false)
  const [short, setShort] = useState(false)
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [root, setRoot] = useState<Element | null>(null)
  const { ref, inView } = useInView({
    root,
    rootMargin: `0px 0px ${screens * 100}% 0px`,
    skip: !root,
  })
  const anchor = useCallback(
    (element: HTMLDivElement | null) => {
      ref(element)
      setNode(element)
      setRoot(element?.closest('[data-radix-scroll-area-viewport]') ?? null)
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
    // 调整窗口也算用户在操作；观察器注册时的第一次回调不算
    let measured = false
    const resized = new ResizeObserver(() => {
      if (measured) setScrolled(true)
      measured = true
    })
    resized.observe(root)
    return () => {
      root.removeEventListener('scroll', mark)
      resized.disconnect()
    }
  }, [root, needsScroll])
  useEffect(() => {
    if (!root || !node || fillScreens === undefined) {
      setShort(false)
      return
    }
    // 哨兵紧跟列表末尾，用它的位置判断可视区下方还备着多少内容
    const measure = () => {
      const view = root.getBoundingClientRect()
      setShort(
        node.getBoundingClientRect().top <
          view.bottom + view.height * fillScreens,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [root, node, fillScreens])
  const shouldContinue = active && inView && (!needsScroll || scrolled || short)
  useEffect(() => {
    if (shouldContinue) onReach()
  }, [shouldContinue, onReach])
  return (
    <div
      ref={anchor}
      className='flex justify-center pt-6 text-body text-muted-foreground'
    >
      {children}
    </div>
  )
}
