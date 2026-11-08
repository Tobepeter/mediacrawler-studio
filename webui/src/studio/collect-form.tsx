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
import { ResultActions } from './result-actions'
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
    tasks,
    requests,
    working,
    pending: clearing,
    updateForm,
    start,
    switchPlatform,
  } = useStudio()
  const form = useForm()
  const page = usePage()
  const task = tasks[form.platform]
  const pending = clearing || !!requests[form.platform]
  const blocked = pending || !!working[form.platform]
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
      await window.studio?.cancel(form.platform)
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
        {/* 单行高度固定，账号和状态按钮不参与撑高 */}
        <div className='flex h-10 items-center justify-between gap-2'>
          <TabsList
            aria-label={t('平台')}
            className='min-w-0 justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          >
            {(Object.keys(platformNames) as Platform[]).map((platform) => (
              <TabsTrigger
                className='relative shrink-0 gap-2'
                title={
                  working[platform] === 'collect' ? t('采集中') : undefined
                }
                key={platform}
                value={platform}
              >
                <PlatformIcon platform={platform} />
                {t(platformNames[platform])}
                {working[platform] === 'collect' && (
                  <span className='absolute right-1 top-1 size-1 rounded-full bg-primary'>
                    <span className='sr-only'>{t('采集中')}</span>
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className='flex h-10 shrink-0 items-center gap-2'>
            {(account === 'connected' || !!page) && <LoginGate />}
          </div>
        </div>
        {/* 未登录只隐藏控件，保留响应式占位，切平台时不收缩顶部布局 */}
        <TabsContent value={form.platform} className='flex items-start gap-2'>
          <form
            className={`min-w-0 flex-1 ${locked && window.studio ? 'invisible' : ''}`}
            aria-label={t('采集条件')}
            aria-hidden={locked && !!window.studio}
            aria-describedby={locked ? 'login-gate-label' : undefined}
            onSubmit={(event) => {
              event.preventDefault()
              if (!blocked) void start()
            }}
          >
            <fieldset
              disabled={locked}
              className='flex min-w-0 flex-wrap items-center justify-end gap-2 sm:h-9 sm:flex-nowrap'
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
                <CollectOptions
                  key={form.platform}
                  disabled={busy || pending || locked}
                />
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
          <div className='flex size-9 shrink-0 items-center justify-center'>
            <ResultActions />
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}
