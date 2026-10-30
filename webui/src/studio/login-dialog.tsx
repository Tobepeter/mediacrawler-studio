import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { IconButton } from '@/components/common/icon-button'
import { platformNames, useStudio } from './store'
import { PlatformIcon } from './platform-icon'
import { cn } from '@/lib/utils'

// 原生平台视图只覆盖内容占位区，标题/关闭按钮始终留在 HTML 层
export function LoginDialog() {
  const { t } = useTranslation('studio')
  const loginView = useStudio((state) => state.loginView)
  const preparing = !!loginView?.preparing
  const platform =
    loginView?.mode === 'embedded' ||
    (loginView?.mode === 'window' && preparing)
      ? loginView.platform
      : undefined
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const focus = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!platform || preparing || !area || !window.studio) return
    const bridge = window.studio
    let active = true
    let frame = 0
    setFailed(false)
    const place = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = area.getBoundingClientRect()
        void bridge
          .attachLogin(platform, {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          })
          .then((ok) => {
            if (active) setFailed(!ok)
          })
          .catch(() => {
            if (active) setFailed(true)
          })
      })
    }
    const observer = new ResizeObserver(place)
    observer.observe(area)
    window.addEventListener('resize', place)
    place()
    return () => {
      active = false
      observer.disconnect()
      window.removeEventListener('resize', place)
      cancelAnimationFrame(frame)
      void bridge.detachLogin(platform).catch(() => {})
    }
  }, [platform, area, preparing])
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
        className={cn(
          'flex w-[calc(100vw-2rem)] flex-col gap-0 p-0 data-[state=closed]:animate-none data-[state=open]:animate-none',
          loginView?.mode === 'window'
            ? 'max-w-sm'
            : 'h-[90dvh] max-w-none sm:w-[92vw]',
        )}
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focus.current?.focus()
        }}
      >
        <DialogHeader className='flex-row items-center justify-between gap-4 space-y-0 p-4'>
          <DialogTitle
            ref={focus}
            tabIndex={-1}
            className='flex items-center gap-2 outline-none'
          >
            {platform && (
              <>
                <PlatformIcon platform={platform} />
                {t('{{platform}}登录', {
                  platform: t(platformNames[platform]),
                })}
              </>
            )}
          </DialogTitle>
          <div className='flex shrink-0 items-center gap-1'>
            <IconButton
              label={t('在独立窗口打开')}
              disabled={preparing}
              onClick={() =>
                void window.studio
                  ?.showLogin('window')
                  .catch(() => toast.error(t('打开失败，请重试')))
              }
            >
              <ExternalLink />
            </IconButton>
            <DialogClose asChild>
              <IconButton label={t('关闭')}>
                <X />
              </IconButton>
            </DialogClose>
          </div>
        </DialogHeader>
        <div
          ref={setArea}
          tabIndex={0}
          aria-label={t('登录页面')}
          onFocus={() => {
            if (!preparing) void window.studio?.focusLogin().catch(() => {})
          }}
          className='m-2 mt-0 flex min-h-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-md bg-muted p-6 text-muted-foreground'
        >
          {(preparing || !failed) && (
            <Loader2 className='size-4 animate-spin motion-reduce:animate-none' />
          )}
          <span>
            {t(
              !preparing && failed
                ? '登录页面加载失败，请尝试独立窗口'
                : '正在准备登录页面',
            )}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
