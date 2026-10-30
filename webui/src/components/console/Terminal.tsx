import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Trash2, RefreshCw } from 'lucide-react'
import { TerminalLine } from './TerminalLine'
import { useCrawlerStore } from '@/store/crawlerStore'
import { Button } from '@/components/ui/button'
import { DataExplorerDialog } from '@/components/data/DataExplorerDialog'

export function Terminal() {
  const { t } = useTranslation('terminal')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const logs = useCrawlerStore((state) => state.logs)
  const clearLogs = useCrawlerStore((state) => state.clearLogs)
  const restoreLogs = useCrawlerStore((state) => state.restoreLogs)
  const clearedAfterLogId = useCrawlerStore((state) => state.clearedAfterLogId)
  const status = useCrawlerStore((state) => state.status)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current && !isCollapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, isCollapsed])

  return (
    <div
      className={`border-cyber-border-subtle flex flex-col overflow-hidden rounded-lg border bg-[#0d1117] transition-all duration-300 ${isCollapsed ? 'h-12' : 'h-full'}`}
    >
      {/* Terminal Header */}
      <div className='flex flex-shrink-0 items-center justify-between border-b border-[#30363d] bg-[#161b22] px-4 py-2.5'>
        <div className='flex items-center gap-3'>
          {/* Window buttons */}
          <div className='flex gap-1.5'>
            <span className='bg-cyber-neon-pink/80 h-2.5 w-2.5 rounded-full' />
            <span className='bg-cyber-neon-orange/80 h-2.5 w-2.5 rounded-full' />
            <span className='bg-cyber-neon-green/80 h-2.5 w-2.5 rounded-full' />
          </div>
          <span className='font-mono text-xs tracking-wider text-[#8b949e]'>
            {t('header.title')}
          </span>
        </div>

        <div className='flex items-center gap-3'>
          {/* Log count & status */}
          <div className='flex items-center gap-3 font-mono text-xs'>
            <span className='text-[#8b949e]'>
              {t('header.entries', { count: logs.length })}
            </span>
            {status === 'running' && (
              <div className='flex items-center gap-1.5'>
                <span className='bg-cyber-neon-green shadow-glow-green-sm animate-pulse-fast h-1.5 w-1.5 rounded-full' />
                <span className='text-cyber-neon-green'>
                  {t('header.active')}
                </span>
              </div>
            )}
          </div>

          {/* Data Explorer */}
          <DataExplorerDialog />

          {/* Restore logs - 只在有清除标记时显示 */}
          {clearedAfterLogId !== null && (
            <Button
              variant='ghost'
              size='sm'
              onClick={restoreLogs}
              className='h-7 px-2 text-[#8b949e] hover:bg-[#00ffff]/10 hover:text-[#00ffff]'
              title={t('header.restore')}
            >
              <RefreshCw className='h-4 w-4' />
            </Button>
          )}

          {/* Clear logs */}
          <Button
            variant='ghost'
            size='sm'
            onClick={clearLogs}
            disabled={logs.length === 0}
            className='h-7 px-2 text-[#8b949e] hover:bg-[#ff0080]/10 hover:text-[#ff0080] disabled:opacity-30'
            title={t('header.clear')}
          >
            <Trash2 className='h-4 w-4' />
          </Button>

          {/* Collapse toggle */}
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setIsCollapsed(!isCollapsed)}
            className='h-7 px-2 text-[#8b949e] hover:bg-[#00ffff]/10 hover:text-[#00ffff]'
          >
            {isCollapsed ? (
              <ChevronDown className='h-4 w-4' />
            ) : (
              <ChevronUp className='h-4 w-4' />
            )}
          </Button>
        </div>
      </div>

      {/* Terminal Content - only show when not collapsed */}
      {!isCollapsed && (
        <>
          <div
            ref={scrollRef}
            className='terminal-scroll min-h-0 flex-1 overflow-auto bg-[#0d1117] p-4 font-mono text-sm'
          >
            {/* ASCII Art Banner when empty */}
            {logs.length === 0 ? (
              <div className='space-y-4'>
                <pre className='text-cyber-neon-cyan/70 text-xs leading-tight'>
                  {`  ╔══════════════════════════════════════════════════════╗
  ║   __  __          _ _       ____                     ║
  ║  |  \\/  | ___  __| (_) __ _/ ___|_ __ __ ___      __ ║
  ║  | |\\/| |/ _ \\/ _\` | |/ _\` | |   | '__/ _\` \\ \\ /\\ / / ║
  ║  | |  | |  __/ (_| | | (_| | |___| | | (_| |\\ V  V /  ║
  ║  |_|  |_|\\___|\\__,_|_|\\__,_|\\____|_|  \\__,_| \\_/\\_/   ║
  ║                                                      ║
  ║          [ NEURAL EXTRACTION UNIT v1.0 ]             ║
  ╚══════════════════════════════════════════════════════╝`}
                </pre>
                <div className='space-y-1 text-xs text-[#c9d1d9]'>
                  <p className='text-cyber-neon-green/70'>
                    {t('banner.systemInit')}
                  </p>
                  <p className='text-[#8b949e]'>{t('banner.configHint')}</p>
                </div>
              </div>
            ) : (
              <div className='space-y-0.5'>
                {logs.map((log) => (
                  <TerminalLine key={log.id} log={log} />
                ))}
              </div>
            )}

            {/* Active Cursor */}
            {status === 'running' && (
              <div className='mt-3 flex items-center gap-1'>
                <span className='text-cyber-neon-green/80'>
                  root@crawler:~$
                </span>
                <span className='bg-cyber-neon-green/80 cursor-blink h-4 w-2' />
              </div>
            )}
          </div>

          {/* Terminal Footer */}
          <div className='flex flex-shrink-0 items-center justify-end border-t border-[#30363d] bg-[#161b22] px-4 py-2'>
            <div className='font-mono text-xs text-[#8b949e]'>
              {status.toUpperCase()}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
