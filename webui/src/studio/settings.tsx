import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from 'next-themes'
import {
  Settings,
  FolderOpen,
  LogOut,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { ThemeToggle } from './theme-toggle'
import { CliSettings } from './cli-settings'
import { activeStatuses, platformNames, useStudio } from './store'

// 语言、外观、下载偏好和平台会话管理
export function StudioSettings() {
  const { t, i18n } = useTranslation('studio')
  const { setTheme } = useTheme()
  const {
    busy,
    pending,
    task,
    patch,
    setLoginMode,
    askBeforeDownload,
    setAskBeforeDownload,
  } = useStudio()
  const [clearing, setClearing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const blocked = busy || pending || activeStatuses.includes(task?.status || '')
  const changeLanguage = async (language: string) => {
    try {
      window.localStorage.setItem('studio-language', language)
      await i18n.changeLanguage(language)
      return true
    } catch {
      toast.error(t('设置保存失败，请重试'), { id: 'settings-save' })
      return false
    }
  }
  const reset = async () => {
    if (blocked || clearing || resetting) return
    setResetting(true)
    try {
      if (!(await changeLanguage('zh-CN'))) return
      window.localStorage.setItem('studio-theme', 'system')
      setTheme('system')
      const downloadSaved = setAskBeforeDownload(false)
      const loginSaved = setLoginMode('qrcode')
      if (downloadSaved && loginSaved)
        toast.success(i18n.t('已恢复默认设置', { ns: 'studio' }), {
          id: 'settings-save',
        })
    } catch {
      toast.error(t('设置保存失败，请重试'), { id: 'settings-save' })
    } finally {
      setResetting(false)
    }
  }
  const clear = async () => {
    if (!window.studio || blocked || clearing) return
    // 清理完成后保持退出状态，直到用户主动重新登录
    patch({
      pending: true,
      attempted: Object.fromEntries(
        Object.keys(platformNames).map((id) => [id, true]),
      ),
    })
    setClearing(true)
    try {
      const result = await window.studio.clearSessions()
      if (result.localOnly)
        toast.warning(t('部分平台未确认登出，本地登录态已清除'))
      else toast.success(t('登录态已清除'))
    } catch {
      toast.error(t('清除失败，请重试'))
    } finally {
      patch({ pending: false })
      setClearing(false)
    }
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <IconButton label={t('设置')}>
          <Settings />
        </IconButton>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className='max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl gap-6 overflow-y-auto'
      >
        <DialogHeader>
          <DialogTitle>{t('设置')}</DialogTitle>
        </DialogHeader>
        <div className='space-y-6'>
          <section aria-labelledby='studio-preferences' className='space-y-3'>
            <h2
              id='studio-preferences'
              className='flex items-center gap-2 text-sm font-medium text-muted-foreground'
            >
              <SlidersHorizontal className='size-4' aria-hidden='true' />
              {t('偏好设置')}
            </h2>
            <div className='space-y-5 rounded-xl bg-muted/40 p-4'>
              <div className='flex min-h-9 flex-wrap items-center justify-between gap-3'>
                <Label htmlFor='studio-language'>{t('语言')}</Label>
                <Select
                  value={i18n.resolvedLanguage || 'zh-CN'}
                  onValueChange={(value) => void changeLanguage(value)}
                >
                  <SelectTrigger
                    id='studio-language'
                    className='w-44 bg-background'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='zh-CN'>简体中文</SelectItem>
                    <SelectItem value='en-US'>English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='flex min-h-9 flex-wrap items-center justify-between gap-3'>
                <span className='font-medium'>{t('外观')}</span>
                <div className='rounded-lg bg-background p-1'>
                  <ThemeToggle />
                </div>
              </div>
              <div className='flex min-h-9 items-center justify-between gap-3'>
                <Label
                  htmlFor='studio-ask-before-download'
                  className='flex-1 cursor-pointer py-2'
                >
                  {t('下载前询问')}
                </Label>
                <Checkbox
                  id='studio-ask-before-download'
                  checked={askBeforeDownload}
                  onCheckedChange={(checked) =>
                    setAskBeforeDownload(checked === true)
                  }
                />
              </div>
            </div>
          </section>
          <CliSettings />
          <section
            aria-labelledby='studio-account-settings'
            className='space-y-3'
          >
            <h2
              id='studio-account-settings'
              className='flex items-center gap-2 text-sm font-medium text-muted-foreground'
            >
              <UserRound className='size-4' aria-hidden='true' />
              {t('账号')}
            </h2>
            <div className='space-y-5 rounded-xl bg-muted/40 p-4'>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div className='space-y-1'>
                  <p className='font-medium'>{t('登录态')}</p>
                  <p
                    id='studio-session-hint'
                    className='text-sm text-muted-foreground'
                  >
                    {t(blocked && !clearing ? '任务进行中' : '保留采集记录')}
                  </p>
                </div>
                <Button
                  variant='outline'
                  aria-describedby='studio-session-hint'
                  disabled={!window.studio || blocked || clearing}
                  onClick={() => void clear()}
                >
                  {clearing ? (
                    <Loader2 className='animate-spin motion-reduce:animate-none' />
                  ) : (
                    <LogOut />
                  )}
                  {t(clearing ? '清除中' : '清除所有登录态')}
                </Button>
              </div>
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={!window.studio?.openLogs}
            onClick={() =>
              void window.studio
                ?.openLogs()
                .catch(() => toast.error(t('打开日志目录失败')))
            }
          >
            <FolderOpen />
            {t('打开日志目录')}
          </Button>
          <Button
            variant='ghost'
            className='text-muted-foreground'
            disabled={blocked || clearing || resetting}
            onClick={() => void reset()}
          >
            <RotateCcw />
            {t('恢复默认设置')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
