import { useTranslation } from 'react-i18next'
import { ShieldAlert, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

const LICENSE_KEY = 'mediacrawler_license_accepted'

// 检查是否已经接受协议
export function isLicenseAccepted(): boolean {
  return localStorage.getItem(LICENSE_KEY) === 'true'
}

// 清除协议接受状态
export function clearLicenseAccepted(): void {
  localStorage.removeItem(LICENSE_KEY)
}

interface LicenseDisclaimerProps {
  onAccept: () => void
}

export function LicenseDisclaimer({ onAccept }: LicenseDisclaimerProps) {
  const { t } = useTranslation('license')

  const handleConfirm = () => {
    localStorage.setItem(LICENSE_KEY, 'true')
    onAccept()
  }

  const handleDecline = () => {
    // 尝试关闭当前标签页（不会关闭整个浏览器，只关闭当前tab）
    try {
      // 方式1: 直接关闭当前标签页
      window.close()

      // 方式2: 将当前标签页导航到空白页
      setTimeout(() => {
        window.location.href = 'about:blank'
      }, 100)
    } catch {
      // 忽略错误
    }

    // 如果无法关闭（浏览器安全限制），显示拒绝访问页面
    setTimeout(() => {
      document.body.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background: #0d1117;
          color: #f85149;
          font-family: 'JetBrains Mono', monospace;
          text-align: center;
          padding: 20px;
        ">
          <div style="font-size: 48px; margin-bottom: 20px;">⛔</div>
          <div style="font-size: 24px; font-weight: bold; margin-bottom: 10px;">访问已拒绝</div>
          <div style="font-size: 14px; color: #8b949e;">您未同意使用条款，请关闭此标签页</div>
        </div>
      `
    }, 200)
  }

  return (
    <div className='fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/95 py-8 backdrop-blur-sm'>
      <div className='bg-cyber-bg-panel border-cyber-neon-pink shadow-cyber-card relative mx-4 w-full max-w-2xl rounded-lg border-2 p-6'>
        {/* Corner decorations - Pink/Red theme for seriousness */}
        <div className='border-cyber-neon-pink absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2' />
        <div className='border-cyber-neon-pink absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2' />
        <div className='border-cyber-neon-pink absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2' />
        <div className='border-cyber-neon-pink absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2' />

        {/* Header with warning icon */}
        <div className='mb-4 flex items-center justify-center gap-3'>
          <ShieldAlert className='text-cyber-neon-pink h-8 w-8 animate-pulse' />
          <h2 className='text-cyber-neon-pink font-mono text-xl font-bold'>
            {t('title')}
          </h2>
        </div>

        {/* Warning subtitle */}
        <div className='mb-4 text-center'>
          <span className='text-cyber-neon-orange font-mono text-base'>
            {t('warning')}
          </span>
        </div>

        {/* Content box */}
        <div className='border-cyber-neon-pink/30 mb-4 rounded-lg border bg-black/50 p-4'>
          <ul className='space-y-2 font-mono text-sm'>
            <li className='flex items-start gap-2'>
              <span className='text-cyber-neon-pink font-bold'>1.</span>
              <span className='text-cyber-text-primary'>
                {t('content.line1')}
              </span>
            </li>
            <li className='flex items-start gap-2'>
              <span className='text-cyber-neon-pink font-bold'>2.</span>
              <span className='text-cyber-text-primary'>
                {t('content.line2')}
              </span>
            </li>
            <li className='flex items-start gap-2'>
              <span className='text-cyber-neon-pink font-bold'>3.</span>
              <span className='text-cyber-text-primary'>
                {t('content.line3')}
              </span>
            </li>
            <li className='flex items-start gap-2'>
              <span className='text-cyber-neon-pink font-bold'>4.</span>
              <span className='text-cyber-text-primary'>
                {t('content.line4')}
              </span>
            </li>
          </ul>
        </div>

        {/* License Link */}
        <div className='mb-6 flex justify-center'>
          <a
            href='https://github.com/NanmiCoder/MediaCrawler/blob/main/LICENSE'
            target='_blank'
            rel='noopener noreferrer'
            className='text-cyber-neon-cyan flex items-center gap-1.5 font-mono text-sm hover:underline'
          >
            <ExternalLink className='h-4 w-4' />
            {t('license')}
          </a>
        </div>

        {/* Action buttons */}
        <div className='flex gap-4'>
          <Button
            onClick={handleDecline}
            variant='outline'
            className='border-cyber-neon-pink/50 text-cyber-neon-pink hover:bg-cyber-neon-pink/10 flex-1 font-mono'
          >
            {t('decline')}
          </Button>
          <Button
            onClick={handleConfirm}
            className='bg-cyber-neon-green hover:bg-cyber-neon-green/90 flex-1 font-mono font-bold text-black'
          >
            {t('confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
