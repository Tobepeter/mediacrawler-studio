import type { SlideData } from 'photoswipe'

export type ImagePreviewItem = {
  alt?: string // 大图 alt
  element?: HTMLElement // 打开动画起点元素
  height?: number // PhotoSwipe 布局高度
  msrc?: string // 低清占位图 / 缩略图
  src: string // 大图地址
  srcset?: string // 响应式大图候选
  thumbCropped?: boolean // 起点缩略图是否被 cover 裁剪
  width?: number // PhotoSwipe 布局宽度
}

export type ImagePreviewGroup = {
  container?: HTMLElement
  onClose?: () => void
  onIndexChange?: (index: number) => void
  index?: number // 初始打开位置
  items: ImagePreviewItem[] // 可切换图片组
}

export type ImagePreviewSize = {
  height: number // PhotoSwipe 布局高度
  width: number // PhotoSwipe 布局宽度
}

export type ImagePreviewDirection = 'next' | 'prev'

export type ImagePreviewZoomContext = {
  elementSize: { x: number; y: number } | null // PhotoSwipe 认为的图片尺寸
  fit: number // PhotoSwipe 默认 contain 缩放
  panAreaSize: { x: number; y: number } | null // 可用预览区域
}

export type PhotoSwipeSlideData = SlideData
