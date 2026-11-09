import { forwardRef } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// 图标操作共用默认 Button 和 Tooltip，ref/events 透传给菜单、弹窗触发器
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & { label: string; hint?: string }
>(({ label, hint, children, ...props }, ref) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        aria-label={label}
        {...props}
        ref={ref}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{hint || label}</TooltipContent>
  </Tooltip>
))
IconButton.displayName = 'IconButton'
