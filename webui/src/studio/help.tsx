import type { PropsWithChildren } from 'react'
import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

// 就近说明，支持点击和键盘操作
export function Help(props: PropsWithChildren<{ label: string }>) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='shrink-0'
          aria-label={props.label}
        >
          <CircleHelp />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='text-sm' aria-label={props.label}>
        {props.children}
      </PopoverContent>
    </Popover>
  )
}
