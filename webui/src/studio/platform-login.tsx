import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { QrFrame } from './qr-frame'
import { PlatformIcon } from './platform-icon'
import { platformNames, useStudio } from './store'
import { healthReason } from './health-summary'
import { loginEstimate } from './login-estimate'
import { loginMayBeBroken, subscribeLoginHealth } from './login-health'

// 二维码由平台任务缓存，组件卸载与 Tab 切换不会重新取码
export function PlatformLogin() {
  const { t } = useTranslation('studio')
  const platform = useStudio((state) => state.platform)
  const login = useStudio((state) => state.logins?.[platform])
  const suspicious = useSyncExternalStore(subscribeLoginHealth, () =>
    loginMayBeBroken(platform),
  )
  const loading = !login || ['queued', 'preparing'].includes(login.status)
  const refreshing = !!login?.refreshing
  const run = (action?: Promise<void>) =>
    void action?.catch(() => {
      if (
        useStudio.getState().platform === platform &&
        document.visibilityState === 'visible'
      )
        toast.error(t('打开失败，请重试'))
    })
  const retry = () => run(window.studio?.retryLogin?.(platform))
  const refresh = () => run(window.studio?.refreshLogin?.(platform))
  return (
    <section
      className='flex flex-1 flex-col items-center justify-center gap-6 py-12'
      aria-label={t('扫码登录')}
    >
      <div className='flex items-center gap-2 text-heading font-medium'>
        <PlatformIcon platform={platform} />
        {t(platformNames[platform])}
      </div>
      <div className='flex min-h-80 w-80 max-w-full flex-col items-center justify-center gap-4'>
        <QrFrame
          image={login?.image}
          confirming={login?.status === 'confirming'}
          loading={loading || refreshing}
          estimateAt={
            refreshing
              ? undefined
              : (login?.startedAt || login?.scheduledAt || Date.now()) +
                loginEstimate(platform)
          }
          loadingLabel={t('正在获取二维码')}
          onRetry={retry}
          retryDisabled={loading}
          retryLabel={t('刷新二维码')}
        />
        <div className='flex min-h-9 items-center gap-2 text-body text-muted-foreground'>
          {login?.status === 'ready' ? (
            <>
              <span>{t('扫码登录')}</span>
              <ContextMenu>
                <ContextMenuTrigger asChild disabled={refreshing}>
                  <IconButton
                    label={t('刷新二维码')}
                    hint={t('刷新二维码（右键可重新连接）')}
                    disabled={refreshing}
                    onClick={(event) => (event.altKey ? retry() : refresh())}
                  >
                    <RefreshCw />
                  </IconButton>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={refresh}>
                    {t('刷新二维码')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={retry}>
                    {t('重新连接')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </>
          ) : !suspicious && login?.status === 'expired' ? (
            t('二维码已过期，请刷新')
          ) : !suspicious && login?.status === 'error' ? (
            t(healthReason(login.failure) || '暂时无法获取二维码，请重试')
          ) : null}
        </div>
      </div>
      {suspicious && !loading && (
        <div
          className='flex max-w-sm items-center gap-2 text-body text-muted-foreground'
          role='status'
        >
          <span>{t('连续获取超时，登录方式可能需要更新')}</span>
          <Button
            variant='link'
            onClick={() =>
              void window.studio
                ?.openSource(
                  'https://github.com/Tobepeter/mediacrawler-studio/issues',
                )
                .catch(() => toast.error(t('打开失败，请重试')))
            }
          >
            {t('反馈问题')}
          </Button>
        </div>
      )}
    </section>
  )
}
