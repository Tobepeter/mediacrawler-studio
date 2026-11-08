import type { ContentItem } from './types'

// 与共用下载器一致：竖屏以短边标记画质，不把备用地址当不同档位
export function videoQualities(item: ContentItem) {
  const heights = (item.media?.variants || [])
    .filter((variant) => variant.kind === 'video' && Number(variant.height) > 0)
    .map((variant) =>
      Math.min(variant.height!, variant.width || variant.height!),
    )
    .filter(
      (height) => Number.isInteger(height) && height >= 10 && height <= 99999,
    )
  return [...new Set(heights)]
    .sort((a, b) => b - a)
    .map((height) => `${height}p`)
}
