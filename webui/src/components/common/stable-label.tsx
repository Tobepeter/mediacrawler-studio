import { cn } from '@/lib/utils'

// 按钮文案会随状态变化时用它：所有文案叠在同一格，宽度始终按最长的算，切换状态按钮不跳动
export function StableLabel(props: { labels: string[]; current: string }) {
  const { labels, current } = props
  return (
    <span className='inline-grid text-center'>
      {[...new Set([current, ...labels])].map((label) => (
        <span
          key={label}
          aria-hidden={label !== current}
          className={cn(
            'col-start-1 row-start-1 whitespace-nowrap',
            label !== current && 'invisible',
          )}
        >
          {label}
        </span>
      ))}
    </span>
  )
}
