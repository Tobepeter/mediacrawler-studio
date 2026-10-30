import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function ThemeToggle() {
  const { t } = useTranslation('studio')
  const { theme, setTheme } = useTheme()
  const options = [
    { value: 'system', label: t('跟随系统'), icon: Monitor },
    { value: 'light', label: t('浅色'), icon: Sun },
    { value: 'dark', label: t('深色'), icon: Moon },
  ]
  return (
    <ToggleGroup
      type='single'
      value={theme || 'system'}
      onValueChange={(value) => {
        if (!value) return
        try {
          window.localStorage.setItem('studio-theme', value)
          setTheme(value)
        } catch {
          toast.error(t('设置保存失败，请重试'), { id: 'settings-save' })
        }
      }}
      aria-label={t('外观')}
    >
      {options.map((option) => (
        <Tooltip key={option.value}>
          <TooltipTrigger asChild>
            <span className='inline-flex'>
              {/* Tooltip 的 data-state 不覆盖 Toggle 的选中状态 */}
              <ToggleGroupItem value={option.value} aria-label={option.label}>
                <option.icon />
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          <TooltipContent>{option.label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  )
}
