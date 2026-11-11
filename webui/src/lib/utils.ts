import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// 自定义字号要登记，否则会被当成文字颜色，和 text-muted-foreground 互相覆盖
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: { 'font-size': [{ text: ['heading', 'body', 'caption'] }] },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 给人看的大小：GB 留一位小数，MB 和 KB 取整
export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.ceil(bytes / 1024)} KB`
}

export function formatDateTime(date: string | Date | number): string {
  const d =
    typeof date === 'string'
      ? new Date(date)
      : typeof date === 'number'
        ? new Date(date * 1000)
        : date
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
