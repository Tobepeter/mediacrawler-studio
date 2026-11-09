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
  Stethoscope,
  UserRound,
} from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
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
import { FeatureSettings } from './feature-settings'
import { PlatformIcon } from './platform-icon'
import { SettingGroup, SettingPage, SettingRow } from './settings-row'
import { platformNames, useStudio } from './store'
import type { Platform } from './types'

const tabs = [
  { id: 'general', label: '通用', icon: SlidersHorizontal },
  { id: 'health', label: '体检', icon: Stethoscope },
  { id: 'account', label: '账号', icon: UserRound },
]

// 语言、外观、下载偏好和平台会话管理
export function StudioSettings() {
  const { t, i18n } = useTranslation('studio')
  const { setTheme } = useTheme()
  const {
    accounts,
    profiles,
    busy,
    pending,
    requests,
    patch,
    setLoginMode,
    askBeforeDownload,
    setAskBeforeDownload,
  } = useStudio()
  const [clearing, setClearing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const blocked = busy || pending || Object.keys(requests).length > 0
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
      {/* 16:10，桌面设置窗口的常见比例；尺寸固定，切换分页和内容变化都不跳动 */}
      <DialogContent
        aria-describedby={undefined}
        className='h-[min(41.25rem,85dvh)] w-[min(66rem,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0'
      >
        <Tabs
          defaultValue='general'
          orientation='vertical'
          className='flex h-full min-h-0 flex-col sm:flex-row'
        >
          <div className='shrink-0 space-y-4 border-b bg-muted/40 p-4 sm:w-48 sm:border-b-0 sm:border-r'>
            <DialogHeader className='px-2 text-left'>
              <DialogTitle>{t('设置')}</DialogTitle>
            </DialogHeader>
            <TabsList className='flex h-auto gap-1 bg-transparent p-0 sm:flex-col sm:items-stretch'>
              {tabs.map(({ id, label, icon: Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className='justify-start gap-2 data-[state=active]:bg-background'
                >
                  <Icon className='size-4' aria-hidden='true' />
                  {t(label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value='general' className='mt-0 min-h-0 min-w-0 flex-1'>
            <SettingPage title={t('通用')}>
              <div className='h-full overflow-y-auto'>
                <SettingGroup>
                  <SettingRow
                    title={<Label htmlFor='studio-language'>{t('语言')}</Label>}
                  >
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
                  </SettingRow>
                  <SettingRow title={t('外观')}>
                    <div className='rounded-lg bg-background p-1'>
                      <ThemeToggle />
                    </div>
                  </SettingRow>
                  <SettingRow
                    title={
                      <Label
                        htmlFor='studio-ask-before-download'
                        className='cursor-pointer'
                      >
                        {t('下载前询问')}
                      </Label>
                    }
                  >
                    <Checkbox
                      id='studio-ask-before-download'
                      checked={askBeforeDownload}
                      onCheckedChange={(checked) =>
                        setAskBeforeDownload(checked === true)
                      }
                    />
                  </SettingRow>
                  <CliSettings />
                  <SettingRow
                    title={t('运行日志')}
                    hint={t('反馈问题时可以附上')}
                  >
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
                  </SettingRow>
                  <SettingRow title={t('恢复默认设置')}>
                    <Button
                      variant='outline'
                      disabled={blocked || clearing || resetting}
                      onClick={() => void reset()}
                    >
                      <RotateCcw />
                      {t('恢复')}
                    </Button>
                  </SettingRow>
                </SettingGroup>
              </div>
            </SettingPage>
          </TabsContent>
          <TabsContent value='health' className='mt-0 min-h-0 min-w-0 flex-1'>
            <FeatureSettings />
          </TabsContent>
          <TabsContent value='account' className='mt-0 min-h-0 min-w-0 flex-1'>
            <SettingPage
              title={t('账号')}
              action={
                <Button
                  variant='outline'
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
              }
              hint={t(
                blocked && !clearing
                  ? '任务进行中'
                  : '清除登录态不影响采集记录',
              )}
            >
              <div className='h-full overflow-y-auto'>
                <SettingGroup>
                  {(Object.keys(platformNames) as Platform[]).map(
                    (platform) => (
                      <SettingRow
                        key={platform}
                        title={
                          <span className='inline-flex items-center gap-2'>
                            <PlatformIcon
                              platform={platform}
                              className='size-4'
                            />
                            {t(platformNames[platform])}
                          </span>
                        }
                      >
                        <span className='truncate text-sm text-muted-foreground'>
                          {accounts[platform] === 'connected'
                            ? profiles[platform]?.nickname || t('已连接')
                            : t('未登录')}
                        </span>
                      </SettingRow>
                    ),
                  )}
                </SettingGroup>
              </div>
            </SettingPage>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
