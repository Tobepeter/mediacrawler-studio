import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AppWindow, X } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@/components/common/icon-button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LoginQr } from './login-qr'
import { PlatformIcon } from './platform-icon'
import { platformNames, useStudio } from './store'

export function LoginQrDialog() {
  const { t } = useTranslation('studio')
  const loginView = useStudio((state) => state.loginView)
  const focus = useRef<HTMLHeadingElement>(null)
  const platform = loginView?.mode === 'qrcode' ? loginView.platform : undefined
  const dismiss = () => {
    void window.studio
      ?.dismissLogin()
      .catch(() => toast.error(t('停止失败，请重试')))
  }

  return (
    <Dialog
      open={!!platform}
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className='max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-sm overflow-y-auto rounded-lg'
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focus.current?.focus()
        }}
      >
        <DialogHeader className='flex-row items-center justify-between gap-2 space-y-0'>
          <DialogTitle
            ref={focus}
            tabIndex={-1}
            className='flex items-center gap-2 outline-none'
          >
            {platform && (
              <>
                <PlatformIcon platform={platform} />
                {t(platformNames[platform])}
              </>
            )}
          </DialogTitle>
          <div className='flex items-center gap-1'>
            <IconButton
              label={t('打开完整登录页')}
              disabled={loginView?.preparing}
              onClick={() =>
                void window.studio
                  ?.showLogin('embedded')
                  .catch(() => toast.error(t('打开失败，请重试')))
              }
            >
              <AppWindow />
            </IconButton>
            <DialogClose asChild>
              <IconButton label={t('关闭')}>
                <X />
              </IconButton>
            </DialogClose>
          </div>
        </DialogHeader>
        {platform && (
          <LoginQr
            key={platform}
            platform={platform}
            preparing={loginView?.preparing}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
