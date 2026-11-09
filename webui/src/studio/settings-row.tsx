import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SettingGroup({ children }: { children: ReactNode }) {
  return (
    <div className='divide-y divide-border/60 rounded-xl bg-muted/40'>
      {children}
    </div>
  )
}

// 左边说明、右边操作，整个设置面板用同一种行
export function SettingRow(props: {
  title: ReactNode
  hint?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className='flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-1.5'>
      <div className='min-w-0 flex-1'>
        <div className='font-medium'>{props.title}</div>
        {props.hint && (
          <p className='text-caption text-muted-foreground'>{props.hint}</p>
        )}
      </div>
      {props.children}
    </div>
  )
}

// 一页设置：标题和主操作在顶部，右侧留出关闭按钮的位置，内容占满剩余高度
export function SettingPage(props: {
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  // 列表型设置限制宽度，左右两端不至于隔得太远
  narrow?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col gap-4 p-6',
        props.narrow && 'mx-auto max-w-3xl',
      )}
    >
      <div className='flex min-h-10 shrink-0 items-center justify-between gap-4 pr-8'>
        <div className='min-w-0'>
          <h2 className='text-heading'>{props.title}</h2>
          {props.hint && (
            <p className='text-caption text-muted-foreground'>{props.hint}</p>
          )}
        </div>
        {props.action}
      </div>
      <div className='min-h-0 flex-1'>{props.children}</div>
    </div>
  )
}
