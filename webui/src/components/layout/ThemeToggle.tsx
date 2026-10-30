import { Sun, Moon, Monitor } from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Theme = 'light' | 'dark' | 'system'

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor },
]

export function ThemeToggle() {
  const { theme, setTheme } = useThemeStore()

  const currentTheme = themes.find((t) => t.value === theme) || themes[0]
  const Icon = currentTheme.icon

  return (
    <Select value={theme} onValueChange={(value: Theme) => setTheme(value)}>
      <SelectTrigger className='border-cyber-border-subtle bg-cyber-bg-tertiary/50 hover:border-cyber-neon-cyan/50 h-7 w-20 font-mono text-xs transition-colors'>
        <Icon className='text-cyber-text-secondary mr-1 h-3 w-3' />
        <SelectValue>{currentTheme.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {themes.map(({ value, label, icon: ItemIcon }) => (
          <SelectItem key={value} value={value} className='font-mono text-xs'>
            <div className='flex items-center gap-2'>
              <ItemIcon className='h-3 w-3' />
              {label}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
