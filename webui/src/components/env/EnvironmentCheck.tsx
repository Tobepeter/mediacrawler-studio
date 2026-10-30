import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { envApi, EnvCheckResult } from '@/lib/api'

const ENV_CHECK_KEY = 'mediacrawler_env_checked'

interface EnvironmentCheckProps {
  onCheckComplete: (success: boolean) => void
}

// 检查是否已经通过环境检测
export function isEnvChecked(): boolean {
  return localStorage.getItem(ENV_CHECK_KEY) === 'true'
}

// 清除环境检测状态
export function clearEnvCheck(): void {
  localStorage.removeItem(ENV_CHECK_KEY)
}

export function EnvironmentCheck({ onCheckComplete }: EnvironmentCheckProps) {
  const { t } = useTranslation('env')
  const [status, setStatus] = useState<'checking' | 'success' | 'error'>(
    'checking',
  )
  const [result, setResult] = useState<EnvCheckResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  const checkEnvironment = useCallback(async () => {
    setStatus('checking')
    setResult(null)
    try {
      const response = await envApi.check()
      setResult(response.data)
      if (response.data.success) {
        setStatus('success')
        // 存储到 localStorage
        localStorage.setItem(ENV_CHECK_KEY, 'true')
        // 成功后延迟关闭
        setTimeout(() => onCheckComplete(true), 1500)
      } else {
        setStatus('error')
      }
    } catch {
      setResult({
        success: false,
        message: t('defaultError'),
        error: t('defaultErrorHint'),
      })
      setStatus('error')
    }
  }, [onCheckComplete, t])

  useEffect(() => {
    void checkEnvironment()
  }, [checkEnvironment])

  const handleSkip = () => {
    localStorage.setItem(ENV_CHECK_KEY, 'true')
    onCheckComplete(false)
  }

  const handleRetry = () => {
    checkEnvironment()
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm'>
      <div className='bg-cyber-bg-panel border-cyber-border-DEFAULT shadow-cyber-card relative mx-4 w-full max-w-md rounded-lg border p-6'>
        {/* Corner decorations */}
        <div className='border-cyber-neon-cyan absolute left-0 top-0 h-4 w-4 border-l-2 border-t-2' />
        <div className='border-cyber-neon-cyan absolute right-0 top-0 h-4 w-4 border-r-2 border-t-2' />
        <div className='border-cyber-neon-cyan absolute bottom-0 left-0 h-4 w-4 border-b-2 border-l-2' />
        <div className='border-cyber-neon-cyan absolute bottom-0 right-0 h-4 w-4 border-b-2 border-r-2' />

        {/* Header */}
        <div className='mb-4 flex items-center gap-3'>
          <AlertTriangle className='text-cyber-neon-orange h-6 w-6' />
          <h2 className='text-cyber-neon-cyan glow-text-cyan font-mono text-lg font-semibold'>
            {t('title')}
          </h2>
        </div>

        {/* Status Display */}
        <div className='bg-cyber-bg-tertiary border-cyber-border-DEFAULT mb-4 rounded-lg border p-4'>
          <div className='flex items-center gap-3'>
            {status === 'checking' && (
              <>
                <Loader2 className='text-cyber-neon-cyan h-5 w-5 animate-spin' />
                <span className='text-cyber-text-primary font-mono text-sm'>
                  {t('scanning')}
                </span>
              </>
            )}
            {status === 'success' && (
              <>
                <CheckCircle className='text-cyber-neon-green h-5 w-5' />
                <span className='text-cyber-neon-green font-mono text-sm'>
                  {t('success', { message: result?.message })}
                </span>
              </>
            )}
            {status === 'error' && (
              <>
                <XCircle className='text-cyber-neon-pink h-5 w-5' />
                <span className='text-cyber-neon-pink font-mono text-sm'>
                  {t('error', { message: result?.message })}
                </span>
              </>
            )}
          </div>

          {/* Error Details */}
          {status === 'error' && result?.error && (
            <div className='mt-3'>
              <button
                onClick={() => setShowDetails(!showDetails)}
                className='text-cyber-neon-cyan font-mono text-sm hover:underline'
              >
                {showDetails ? t('hideDetails') : t('showDetails')}
              </button>
              {showDetails && (
                <pre className='text-cyber-neon-green border-cyber-border-DEFAULT mt-2 overflow-x-auto whitespace-pre-wrap rounded border bg-black p-3 font-mono text-xs'>
                  {result.error}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Help Text */}
        {status === 'error' && (
          <div className='text-cyber-text-secondary mb-4 space-y-2 font-mono text-sm'>
            <p className='text-cyber-neon-orange'>{t('requirements')}</p>
            <ol className='text-cyber-text-muted list-inside list-decimal space-y-1 pl-2'>
              <li>{t('requirementsList.1')}</li>
              <li>{t('requirementsList.2')}</li>
              <li>{t('requirementsList.3')}</li>
            </ol>
          </div>
        )}

        {/* Actions */}
        <div className='flex gap-3'>
          {status === 'error' && (
            <>
              <Button
                variant='outline'
                className='flex-1 font-mono'
                onClick={handleSkip}
              >
                {t('skipCheck')}
              </Button>
              <Button
                variant='default'
                className='flex-1 font-mono'
                onClick={handleRetry}
              >
                <RefreshCw className='h-4 w-4' />
                {t('retryCheck')}
              </Button>
            </>
          )}
          {status === 'checking' && (
            <Button
              variant='outline'
              className='w-full font-mono'
              onClick={handleSkip}
            >
              {t('skipCheck')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
