import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface CountPickerProps {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  max?: number
  presets?: readonly number[]
}

// 快捷数量与自定义输入，确认后才写回，关闭时丢弃草稿
export function CountPicker(props: CountPickerProps) {
  const { t } = useTranslation('studio')
  const {
    value,
    onChange,
    disabled,
    max = 100,
    presets = [5, 10, 20, 50, 100],
  } = props
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const id = useId()
  const count = Number(draft)
  const valid =
    draft.trim() !== '' && Number.isInteger(count) && count >= 1 && count <= max
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  const apply = (next: number) => {
    if (disabled || !Number.isInteger(next) || next < 1 || next > max) return
    onChange(next)
    setOpen(false)
  }
  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        if (next) setDraft(String(value))
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          disabled={disabled}
          className='w-28 shrink-0 justify-between px-3'
          aria-label={t('采集数量')}
        >
          {t('{{count}} 条', { count: value })}
          <ChevronDown className='opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align='end'
        className='space-y-3'
        aria-label={t('采集数量')}
      >
        <div className='flex gap-1' role='group' aria-label={t('采集数量')}>
          {presets
            .filter(
              (preset) =>
                Number.isInteger(preset) && preset >= 1 && preset <= max,
            )
            .map((preset) => (
              <Button
                key={preset}
                type='button'
                variant={value === preset ? 'secondary' : 'outline'}
                className='flex-1 px-0'
                aria-pressed={value === preset}
                onClick={() => apply(preset)}
              >
                {preset}
              </Button>
            ))}
        </div>
        <div className='flex items-center justify-between gap-2'>
          <Label htmlFor={id}>{t('自定义数量')}</Label>
          <span
            id={`${id}-range`}
            className={
              valid || !draft
                ? 'text-xs text-muted-foreground'
                : 'text-xs text-destructive'
            }
          >
            1–{max}
          </span>
        </div>
        <div className='flex gap-2'>
          <Input
            id={id}
            type='number'
            inputMode='numeric'
            min={1}
            max={max}
            step={1}
            value={draft}
            aria-describedby={`${id}-range`}
            aria-invalid={!valid && !!draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              event.stopPropagation()
              if (valid) apply(count)
            }}
          />
          <Button
            type='button'
            size='icon'
            className='shrink-0'
            disabled={!valid}
            aria-label={t('确认数量')}
            onClick={() => apply(count)}
          >
            <Check />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
