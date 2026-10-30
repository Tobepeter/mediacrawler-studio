import { Bug, Wifi, AlertTriangle, Github } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { useCrawlerStore } from '@/store/crawlerStore'
import { useCrawlerStatus } from '@/hooks/useCrawler'
import { LanguageSwitch } from './LanguageSwitch'
import { ThemeToggle } from './ThemeToggle'

interface SidebarProps {
  onShowDisclaimer?: () => void
}

export function Sidebar({ onShowDisclaimer }: SidebarProps) {
  const { t } = useTranslation()
  const { t: tLicense } = useTranslation('license')
  const status = useCrawlerStore((state) => state.status)

  // Poll status
  useCrawlerStatus()

  const isRunning = status === 'running'

  return (
    <header className='glass-panel border-cyber-border-subtle relative z-10 h-14 flex-shrink-0 border-b'>
      <div className='flex h-full items-center justify-between px-4'>
        {/* Left: Logo and GitHub Star */}
        <div className='flex items-center gap-3'>
          <Bug className='text-cyber-neon-cyan h-5 w-5' />
          <span className='text-cyber-text-primary font-mono text-sm font-bold tracking-wider'>
            MediaCrawler
          </span>
          <a
            href='https://github.com/NanmiCoder/MediaCrawler'
            target='_blank'
            rel='noopener noreferrer'
            className='border-cyber-border-subtle hover:border-cyber-neon-cyan hover:shadow-glow-cyan-sm bg-cyber-bg-tertiary flex items-center gap-1.5 rounded-md border px-2 py-1 transition-all'
          >
            <Github className='text-cyber-text-secondary h-4 w-4' />
            <span className='text-cyber-text-secondary font-mono text-xs'>
              Star
            </span>
          </a>
          {isRunning && (
            <Badge variant='secondary' className='text-[10px]'>
              {t('status.active')}
            </Badge>
          )}
          {isRunning && (
            <span className='bg-cyber-neon-green shadow-glow-green-sm animate-pulse-fast h-2 w-2 rounded-full' />
          )}
        </div>

        {/* Center: Warning Text */}
        <button
          onClick={onShowDisclaimer}
          className='border-cyber-neon-orange/50 bg-cyber-neon-orange/10 hover:bg-cyber-neon-orange/20 flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-1.5 transition-all'
        >
          <AlertTriangle className='text-cyber-neon-orange h-4 w-4 flex-shrink-0' />
          <div className='flex items-center gap-4 font-mono text-xs'>
            <span className='text-cyber-neon-orange'>
              <span className='text-cyber-neon-pink font-bold'>1.</span>{' '}
              {tLicense('content.line1')}
            </span>
            <span className='text-cyber-neon-orange'>
              <span className='text-cyber-neon-pink font-bold'>2.</span>{' '}
              {tLicense('content.line2')}
            </span>
          </div>
        </button>

        {/* Right: Actions and Status */}
        <div className='flex items-center gap-3'>
          {/* Theme Toggle */}
          <ThemeToggle />
          {/* Language Switch */}
          <LanguageSwitch />

          {/* Status Info */}
          <div className='hidden items-center gap-2 font-mono text-xs lg:flex'>
            <span className='text-cyber-text-muted'>{t('sidebar.api')}:</span>
            <span className='text-cyber-neon-green'>v1.0.0</span>
            <div className='flex items-center gap-1.5'>
              <Wifi className='text-cyber-text-secondary h-3 w-3' />
              <span className='text-cyber-text-secondary'>
                {t('sidebar.local')}
              </span>
              <span className='status-dot status-dot-online' />
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
