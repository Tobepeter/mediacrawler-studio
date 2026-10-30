import {
  siBilibili,
  siTiktok,
  siZhihu,
  siSinaweibo,
  siBaidu,
  siKuaishou,
} from 'simple-icons'
import { BrandIconBase } from '@/components/common/brand-icon/brand-icon-base'
import type { BrandIconProps } from '@/components/common/brand-icon/types'
import { cn } from '@/lib/utils'
import type { Platform } from './types'

// Simple Icons 没有独立 Douyin 条目，抖音使用同形音符标志
const icons = {
  bili: siBilibili,
  dy: siTiktok,
  zhihu: siZhihu,
  wb: siSinaweibo,
  tieba: siBaidu,
  ks: siKuaishou,
}

export function PlatformIcon(props: PlatformIconProps) {
  // 小红书是横向文字标志，保留相邻名称，避免缩小后重复显示
  if (props.platform === 'xhs') return null

  return (
    <BrandIconBase
      icon={icons[props.platform]}
      className={cn('size-4 shrink-0', props.className)}
    />
  )
}

export type PlatformIconProps = BrandIconProps & { platform: Platform }
