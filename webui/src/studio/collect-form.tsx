import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ClearableInput } from '@/components/common/clearable-input'
import { CountPicker } from '@/components/common/count-picker'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CollectOptions } from './collect-options'
import { CreatorSearch } from './creator-search'
import { CreatorField } from './creator-ui'
import {
  creatorLimit,
  creatorPlatforms,
  creatorPresets,
  extractShareUrl,
  isAutoForm,
  isCreatorUrl,
  isDouyinShortLink,
  platformOfUrl,
} from './creator-options'
import { useState } from 'react'
import { LoginGate } from './login-gate'
import { PlatformIcon } from './platform-icon'
import { ResultActions } from './result-actions'
import {
  activeStatuses,
  isContinuing,
  platformNames,
  useForm,
  usePage,
  useStudio,
} from './store'
import type { CreatorInfo, CreatorSummary, Platform } from './types'

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
    restore,
    history,
  } = useStudio()
  const form = useForm()
  const page = usePage()
  const task = tasks[form.platform]
  // 滚动续采在后台进行，不锁定表单，也不把采集按钮切成停止
  const continuing = isContinuing(task)
  const pending =
    clearing ||
    (!!requests[form.platform] && requests[form.platform] !== 'continue')
  const blocked = pending || (!!working[form.platform] && !continuing)
  const busy =
    blocked &&
    task?.platform === form.platform &&
    task.action === 'collect' &&
    activeStatuses.includes(task.status)
  const account = accounts[form.platform] || 'unknown'
  const locked = account !== 'connected'
  // 进入博主模式默认多采一些；离开时收回普通模式的上限
  const limitFor = (mode: typeof form.mode) =>
    mode === 'creator'
      ? form.mode === 'creator'
        ? form.limit
        : Math.max(form.limit, 50)
      : Math.min(form.limit, 100)
  const [picked, setPicked] = useState<CreatorInfo>()
  // 从主页切回输入时才需要抢焦点，首屏不打扰
  const [cleared, setCleared] = useState(false)
  const creator =
    (picked?.url === form.query && picked) ||
    (page?.task.query === form.query && page.task.creator) ||
    history.find((entry) => entry.task.query === form.query)?.task.creator ||
    undefined
  const chooseCreator = (summary: CreatorSummary) => {
    setPicked(summary)
    updateForm({
      query: summary.url,
      mode: 'creator',
      limit: limitFor('creator'),
    })
    void start()
  }
  const clearQuery = () => {
    setCleared(true)
    updateForm({ query: '', mode: 'search', limit: limitFor('search') })
  }
  const updateQuery = (input: string) => {
    const query = extractShareUrl(input)
    const url = /^https?:\/\//i.test(query.trim())
    const mode = !url ? 'search' : isCreatorUrl(query) ? 'creator' : 'link'
    const platform = (url && platformOfUrl(query)) || form.platform
    updateForm({ query, mode, platform, limit: limitFor(mode) })
    if (isDouyinShortLink(query)) void expandShortLink(query)
  }
  // 短链要请求后才知道指向作品还是主页，是主页就原位换成完整链接
  const expandShortLink = async (query: string) => {
    const target = await window.studio
      ?.resolveCreatorLink?.(query)
      .catch(() => null)
    const state = useStudio.getState()
    if (!target || state.platform !== 'dy' || state.forms.dy.query !== query)
      return
    state.updateForm({
      query: target,
      mode: 'creator',
      limit: Math.max(state.forms.dy.limit, 50),
    })
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
                {form.mode === 'creator' ? (
                  <CreatorField
                    url={form.query}
                    creator={creator}
                    disabled={busy || pending || locked}
                    onClear={clearQuery}
                  />
                ) : (
                  <ClearableInput
                    className='flex-1'
                    id='query'
                    autoFocus={cleared}
                    aria-label={t('关键词或作品链接')}
                    placeholder={
                      locked
                        ? t('登录后即可采集')
                        : creatorPlatforms.includes(form.platform)
                          ? t('关键词、作品或博主主页链接')
                          : t('关键词或作品链接')
                    }
                    value={form.query}
                    onChange={(event) => updateQuery(event.target.value)}
                    onClear={clearQuery}
                    required
                    maxLength={2000}
                    disabled={busy || pending || locked}
                  />
                )}
                <CreatorSearch
                  key={`creators-${form.platform}`}
                  platform={form.platform}
                  keyword={form.mode === 'search' ? form.query : ''}
                  disabled={blocked || locked}
                  onSelect={chooseCreator}
                  onRestore={(id) => void restore(id)}
                />
                <CollectOptions
                  key={form.platform}
                  disabled={busy || pending || locked}
                />
              </div>
              {form.mode !== 'link' && (
                <CountPicker
                  key={form.platform}
                  value={form.limit}
                  disabled={busy || pending || locked}
                  max={form.mode === 'creator' ? creatorLimit : undefined}
                  presets={form.mode === 'creator' ? creatorPresets : undefined}
                  auto={isAutoForm(form)}
                  onAuto={
                    creatorPlatforms.includes(form.platform)
                      ? () => updateForm({ auto: true })
                      : undefined
                  }
                  onChange={(limit) => updateForm({ limit, auto: false })}
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
