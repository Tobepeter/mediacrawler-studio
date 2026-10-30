import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CountPicker } from '@/components/common/count-picker'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CollectOptions } from './collect-options'
import { LoginGate } from './login-gate'
import { PlatformIcon } from './platform-icon'
import {
  activeStatuses,
  platformNames,
  useForm,
  usePage,
  useStudio,
} from './store'
import type { Platform } from './types'

// 链接自动识别，基础控件使用默认尺寸
export function CollectForm() {
  const { t } = useTranslation('studio')

  const {
    accounts,
    task,
    pending,
    busy: workerBusy,
    updateForm,
    start,
    switchPlatform,
  } = useStudio()
  const form = useForm()
  const page = usePage()
  const blocked =
    workerBusy || pending || activeStatuses.includes(task?.status || '')
  const busy =
    blocked &&
    task?.platform === form.platform &&
    task.action === 'collect' &&
    activeStatuses.includes(task.status)
  const account = accounts[form.platform] || 'unknown'
  const locked = account !== 'connected'
  const updateQuery = (query: string) => {
    const mode = /^https?:\/\//i.test(query.trim()) ? 'link' : 'search'
    let platform = form.platform
    if (mode === 'link') {
      try {
        const host = new URL(query.trim()).hostname
        const hosts: Record<Platform, string[]> = {
          bili: ['bilibili.com', 'b23.tv'],
          dy: ['douyin.com', 'iesdouyin.com'],
          xhs: ['xiaohongshu.com', 'xhslink.com'],
          zhihu: ['zhihu.com'],
          wb: ['weibo.com', 'weibo.cn'],
          tieba: ['tieba.baidu.com'],
          ks: ['kuaishou.com', 'gifshow.com'],
        }
        for (const id of Object.keys(hosts) as Platform[]) {
          if (
            hosts[id].some(
              (domain) => host === domain || host.endsWith(`.${domain}`),
            )
          )
            platform = id
        }
      } catch {
        /* 输入中的链接保留到提交时校验 */
      }
    }
    updateForm({ query, mode, platform })
  }
  const cancel = async () => {
    try {
      await window.studio?.cancel()
    } catch {
      toast.error(t('停止失败，请重试'))
    }
  }
  return (
    <section aria-label={t('采集')}>
      <Tabs
        className='space-y-4 py-6'
        value={form.platform}
        onValueChange={(platform) => switchPlatform(platform as Platform)}
      >
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <TabsList
            aria-label={t('平台')}
            className='h-auto flex-wrap justify-start'
          >
            {(Object.keys(platformNames) as Platform[]).map((platform) => (
              <TabsTrigger className='gap-2' key={platform} value={platform}>
                <PlatformIcon platform={platform} />
                {t(platformNames[platform])}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className='flex items-center gap-2'>
            {blocked && task && task.platform !== form.platform && (
              <Button
                variant='ghost'
                onClick={() => switchPlatform(task.platform)}
              >
                <Loader2 className='animate-spin motion-reduce:animate-none' />
                {t(platformNames[task.platform])}
                {t('处理中')}
              </Button>
            )}
            {(account === 'connected' || !!page) && <LoginGate />}
          </div>
        </div>
        <TabsContent value={form.platform} hidden={locked && !!window.studio}>
          <form
            aria-label={t('采集条件')}
            aria-describedby={locked ? 'login-gate-label' : undefined}
            onSubmit={(event) => {
              event.preventDefault()
              if (!blocked) void start()
            }}
          >
            <fieldset
              disabled={locked}
              className='flex min-w-0 flex-wrap items-center justify-end gap-2'
            >
              <div className='flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1'>
                <Input
                  className='min-w-0 flex-1'
                  id='query'
                  aria-label={t('关键词或作品链接')}
                  placeholder={
                    locked ? t('登录后即可采集') : t('关键词或作品链接')
                  }
                  value={form.query}
                  onChange={(event) => updateQuery(event.target.value)}
                  required
                  maxLength={2000}
                  disabled={busy || pending || locked}
                />
                <CollectOptions disabled={busy || pending || locked} />
              </div>
              {form.mode === 'search' && (
                <CountPicker
                  key={form.platform}
                  value={form.limit}
                  disabled={busy || pending || locked}
                  onChange={(limit) => updateForm({ limit })}
                />
              )}
              {/* 固定操作占位，状态切换不挤动输入框 */}
              <Button
                className='relative w-24 shrink-0'
                type={busy ? 'button' : 'submit'}
                disabled={
                  pending ||
                  (blocked && !busy) ||
                  locked ||
                  task?.status === 'stopping' ||
                  (!busy && !form.query.trim())
                }
                aria-busy={busy}
                onClick={
                  busy
                    ? (event) => {
                        // 停止可能立即完成，阻止同次点击变成表单提交
                        event.preventDefault()
                        void cancel()
                      }
                    : undefined
                }
              >
                {busy && (
                  <Loader2
                    className='absolute left-3 animate-spin motion-reduce:animate-none'
                    aria-hidden='true'
                  />
                )}
                {busy ? t('停止') : t('采集')}
              </Button>
            </fieldset>
          </form>
        </TabsContent>
      </Tabs>
    </section>
  )
}
