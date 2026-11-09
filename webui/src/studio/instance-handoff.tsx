import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useStudio } from './store'

// 开发版和安装版共用数据，不能同时运行；另一个版本启动时由用户决定留哪个
export function InstanceHandoff() {
  const { t } = useTranslation('studio')
  const handoff = useStudio((state) => state.handoff)
  const resolve = (accepted: boolean) =>
    void window.studio?.resolveHandoff?.(accepted)
  return (
    <Dialog
      open={!!handoff}
      onOpenChange={(open) => {
        if (!open) resolve(false)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(handoff?.build === 'dev' ? '开发版想要启动' : '安装版想要启动')}
          </DialogTitle>
          <DialogDescription>
            {t(
              handoff?.build === 'packaged'
                ? '两个版本共用登录态和数据，同一时间只能运行一个。退出后开发服务也会结束，需要再打开一次安装版'
                : '两个版本共用登录态和数据，同一时间只能运行一个',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={() => resolve(false)}>
            {t('继续使用当前版本')}
          </Button>
          <Button onClick={() => resolve(true)}>
            {t(handoff?.build === 'dev' ? '退出并切换' : '退出开发版')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
