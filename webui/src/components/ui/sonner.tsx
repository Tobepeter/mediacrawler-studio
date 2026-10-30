import type { CSSProperties } from 'react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import {
  CircleCheck,
  Info,
  TriangleAlert,
  OctagonX,
  Loader2,
} from 'lucide-react'

// 参考 tobe-lab；本项目的颜色 token 使用 HSL 分量
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme()
  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position='bottom-right'
      icons={{
        success: <CircleCheck className='size-4' />,
        info: <Info className='size-4' />,
        warning: <TriangleAlert className='size-4' />,
        error: <OctagonX className='size-4' />,
        loading: (
          <Loader2 className='size-4 animate-spin motion-reduce:animate-none' />
        ),
      }}
      style={
        {
          '--normal-bg': 'hsl(var(--popover))',
          '--normal-text': 'hsl(var(--popover-foreground))',
          '--normal-border': 'hsl(var(--border))',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      {...props}
    />
  )
}
