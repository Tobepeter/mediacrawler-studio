import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const languages = [
  { code: 'zh-CN', label: '中文' },
  { code: 'en-US', label: 'EN' },
]

export function LanguageSwitch() {
  const { i18n } = useTranslation()

  const currentLang =
    languages.find((l) => l.code === i18n.language) || languages[0]

  return (
    <Select
      value={i18n.language}
      onValueChange={(lang) => i18n.changeLanguage(lang)}
    >
      <SelectTrigger className='border-cyber-border-subtle bg-cyber-bg-tertiary/50 hover:border-cyber-neon-cyan/50 h-7 w-20 font-mono text-xs transition-colors'>
        <Globe className='text-cyber-text-secondary mr-1 h-3 w-3' />
        <SelectValue>{currentLang.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {languages.map((lang) => (
          <SelectItem
            key={lang.code}
            value={lang.code}
            className='font-mono text-xs'
          >
            {lang.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
