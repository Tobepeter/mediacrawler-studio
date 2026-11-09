import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'

export function SettingGroup({ children }: { children: ReactNode }) {
  return <Card className='divide-y'>{children}</Card>
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

// 第一行只放标题，右上角留给关闭按钮；说明和操作放到第二行
export function SettingPage(props: {
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className='flex h-full min-h-0 flex-col gap-4 p-6'>
      <div className='shrink-0 space-y-2'>
        <h2 className='pr-8 text-heading'>{props.title}</h2>
        {(props.hint || props.action) && (
          <div className='flex min-h-9 items-center justify-between gap-4'>
            <p className='min-w-0 text-muted-foreground'>{props.hint}</p>
            {props.action}
          </div>
        )}
      </div>
      <div className='min-h-0 flex-1'>{props.children}</div>
    </div>
  )
}
