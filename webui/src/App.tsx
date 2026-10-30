import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import { History } from 'lucide-react'
import appIcon from '@/assets/app-icon.png'
import { Toaster } from '@/components/ui/sonner'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/common/icon-button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { CollectForm } from './studio/collect-form'
import { Results } from './studio/results'
import { TaskStatus } from './studio/task-status'
import { ContentDetail } from './studio/content-detail'
import { DownloadFeedback } from './studio/media-download'
import { LoginDialog } from './studio/login-dialog'
import { LoginPanel } from './studio/login-panel'
import { LoginController } from './studio/login-controller'
import { StudioSettings } from './studio/settings'
import { connectStudio, useStudio } from './studio/store'
import { CollectionHistory } from './studio/collection-history'
import { useStudioRoute } from './studio/route'

export default function App() {
  const { t } = useTranslation('studio')

  const nativeTitlebar = window.studio?.platform === 'darwin'
  const history = useStudioRoute() === 'history'
  const account = useStudio((state) => state.accounts[state.platform])
  const page = useStudio((state) => state.pages[state.platform])
  const inlineLogin = useStudio(
    (state) =>
      state.loginView?.platform === state.platform &&
      state.loginView.mode === 'qrcode',
  )
  const showContent =
    !inlineLogin && (!window.studio || account === 'connected' || !!page)
  useEffect(connectStudio, [])
  useEffect(() => new LoginController().start(), [])
  return (
    <div className='flex h-dvh flex-col overflow-hidden text-sm'>
      <header
        className={cn(
          'shrink-0 bg-background',
          nativeTitlebar && 'desktop-titlebar',
        )}
      >
        <div
          className={cn(
            'flex items-center justify-between gap-4',
            nativeTitlebar ? 'py-3 pl-28 pr-6' : 'p-4 sm:px-6',
          )}
        >
          <div className='flex items-center gap-2'>
            <img
              src={appIcon}
              alt=''
              className='size-6 shrink-0 rounded-md'
              draggable={false}
            />
            <h1 className='font-medium'>MediaCrawler Studio</h1>
            {!window.studio && <Badge variant='outline'>{t('预览')}</Badge>}
          </div>
          <div data-no-drag className='flex items-center gap-2'>
            <IconButton asChild label={t('历史')}>
              <a href='#/history'>
                <History />
              </a>
            </IconButton>
            <StudioSettings />
          </div>
        </div>
      </header>
      {/* 内容独立滚动；底部留出窗口圆角，Radix 包装层保留空状态撑满布局 */}
      <ScrollArea
        className={cn(
          'min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:!flex [&>[data-radix-scroll-area-viewport]>div]:min-h-full',
        )}
      >
        <main className='flex min-w-0 flex-1 flex-col px-4 sm:px-6'>
          <CollectForm />
          <div className={showContent ? 'contents' : 'hidden'}>
            <Results />
          </div>
          {!showContent && <LoginPanel />}
        </main>
      </ScrollArea>
      <Dialog
        open={history}
        onOpenChange={(open) => {
          if (!open) window.location.hash = '/'
        }}
      >
        <DialogContent
          className='flex h-[85dvh] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col overflow-hidden'
          aria-describedby={undefined}
        >
          <DialogHeader className='shrink-0 pr-8'>
            <DialogTitle>{t('历史')}</DialogTitle>
          </DialogHeader>
          <ScrollArea className='min-h-0 flex-1'>
            <CollectionHistory />
          </ScrollArea>
        </DialogContent>
      </Dialog>
      <footer className='mb-3 shrink-0 px-4 sm:px-6'>
        <TaskStatus />
      </footer>
      <ContentDetail />
      <DownloadFeedback />
      <LoginDialog />

      <Toaster />
    </div>
  )
}
