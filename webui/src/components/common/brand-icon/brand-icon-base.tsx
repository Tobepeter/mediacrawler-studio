import type { SimpleIcon } from 'simple-icons'
import { cn } from '@/lib/utils'
import type { BrandIconProps } from './types'

// simple-icons 品牌图标基础渲染
export function BrandIconBase(props: BrandIconBaseProps) {
  return (
    <svg
      viewBox='0 0 24 24'
      aria-hidden='true'
      className={cn('fill-current', props.className)}
    >
      <path d={props.icon.path} />
    </svg>
  )
}

type BrandIconBaseProps = BrandIconProps & {
  icon: SimpleIcon
}
