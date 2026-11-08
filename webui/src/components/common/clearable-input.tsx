import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type ComponentProps,
} from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function ClearButton({
  label,
  className,
  ...props
}: ComponentProps<'button'> & { label?: string }) {
  const { t } = useTranslation('studio')
  const text = label || t('清除')
  return (
    <button
      type='button'
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
      aria-label={text}
      title={text}
      {...props}
    >
      <X className='size-4' aria-hidden='true' />
    </button>
  )
}

export interface ClearableInputProps extends ComponentProps<typeof Input> {
  onClear: () => void
  clearLabel?: string
}

// className 作用于外层，便于调用方参与 flex 布局；有内容且可编辑时才显示清除
export const ClearableInput = forwardRef<HTMLInputElement, ClearableInputProps>(
  ({ className, onClear, clearLabel, ...props }, ref) => {
    const input = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => input.current as HTMLInputElement)
    const clearable =
      !!String(props.value ?? '') && !props.disabled && !props.readOnly
    return (
      <div className={cn('relative w-full min-w-0', className)}>
        <Input {...props} ref={input} className='pr-9' />
        {clearable && (
          <ClearButton
            label={clearLabel}
            className='absolute right-1 top-1'
            // 按下时不让输入框失焦，避免焦点样式闪动
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onClear()
              input.current?.focus()
            }}
          />
        )}
      </div>
    )
  },
)
ClearableInput.displayName = 'ClearableInput'
