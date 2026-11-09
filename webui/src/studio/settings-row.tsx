import type { ReactNode } from 'react'

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
    <div className='flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3'>
      <div className='min-w-0 flex-1 space-y-0.5'>
        <div className='font-medium'>{props.title}</div>
        {props.hint && (
          <p className='text-sm text-muted-foreground'>{props.hint}</p>
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
  children: ReactNode
}) {
  return (
    <div className='flex h-full min-h-0 flex-col gap-4 p-6'>
      <div className='flex min-h-10 shrink-0 items-center justify-between gap-4 pr-8'>
        <div className='min-w-0 space-y-0.5'>
          <h2 className='text-base font-semibold'>{props.title}</h2>
          {props.hint && (
            <p className='text-sm text-muted-foreground'>{props.hint}</p>
          )}
        </div>
        {props.action}
      </div>
      <div className='min-h-0 flex-1'>{props.children}</div>
    </div>
  )
}
