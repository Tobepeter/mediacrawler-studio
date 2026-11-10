import { useState, type PropsWithChildren } from 'react'
import { cn } from '@/lib/utils'

// 入场完成后移除动画，保留挂载的 Tab 再次显示时不会重播
export function Reveal(
  props: PropsWithChildren<{ delay?: number; instant?: boolean }>,
) {
  const [entered, setEntered] = useState(!!props.instant)
  return (
    <div
      className={cn(
        'min-w-0',
        !entered &&
          'motion-safe:duration-300 motion-safe:ease-out motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-backwards',
      )}
      style={{ animationDelay: `${props.delay || 0}ms` }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setEntered(true)
      }}
    >
      {props.children}
    </div>
  )
}
