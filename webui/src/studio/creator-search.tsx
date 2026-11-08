import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Search, UserSearch } from 'lucide-react'
import { ClearableInput } from '@/components/common/clearable-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { translateMessage } from '@/i18n/studio'
import { creatorPlatforms } from './creator-options'
import { CreatorAvatar, useCreatorStats } from './creator-ui'
import { useStudio } from './store'
import type { CreatorSummary, Platform } from './types'

const failure = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      )
    : '搜索失败，请重试'

function CreatorRow(props: {
  name: string
  avatar?: string
  handle?: string
  detail: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      disabled={props.disabled}
      className='flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50'
      onClick={props.onClick}
    >
      <CreatorAvatar name={props.name} avatar={props.avatar} />
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium'>
          {props.name}
          {props.handle && (
            <span className='ml-2 font-normal text-muted-foreground'>
              @{props.handle}
            </span>
          )}
        </span>
        <span className='block truncate text-xs text-muted-foreground'>
          {props.detail}
        </span>
      </span>
    </button>
  )
}

function Placeholder({ children }: { children: ReactNode }) {
  return <p className='p-2 text-sm text-muted-foreground'>{children}</p>
}

export function CreatorSearch(props: {
  platform: Platform
  keyword: string
  disabled?: boolean
  onSelect: (creator: CreatorSummary) => void
  onRestore: (id: string) => void
}) {
  const { platform, keyword: seed, disabled, onSelect, onRestore } = props
  const { t } = useTranslation('studio')
  const stats = useCreatorStats()
  const history = useStudio((state) => state.history)
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<CreatorSummary[]>([])
  const [cursor, setCursor] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  // 回看博主直接打开已有记录，不消耗对频率敏感的搜索
  const recent = useMemo(() => {
    const seen = new Set<string>()
    return history
      .filter(({ task, count }) => {
        if (
          task.platform !== platform ||
          task.mode !== 'creator' ||
          !task.creator?.name ||
          !count ||
          seen.has(task.query)
        )
          return false
        seen.add(task.query)
        return true
      })
      .slice(0, 6)
  }, [history, platform])
  if (!creatorPlatforms.includes(platform) || !window.studio?.searchCreators)
    return null

  const search = async (next?: string) => {
    const query = keyword.trim()
    if (!query || loading) return
    const id = ++request.current
    setLoading(true)
    setError('')
    if (!next) {
      setItems([])
      setCursor(undefined)
      setSearched(false)
    }
    try {
      const page = await window.studio!.searchCreators!(platform, query, next)
      if (id !== request.current || page.cancelled) return
      setItems((current) => {
        const base = next ? current : []
        const seen = new Set(base.map((item) => item.id))
        return [...base, ...page.items.filter((item) => !seen.has(item.id))]
      })
      setCursor(page.hasMore ? page.nextCursor : undefined)
      setSearched(true)
    } catch (reason) {
      if (id === request.current) setError(failure(reason))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }

  // 关闭时结束进行中的搜索，释放同平台的采集互斥
  const stop = () => {
    if (!loading) return
    request.current++
    setLoading(false)
    void window.studio?.cancel(platform).catch(() => {})
  }

  const clear = () => {
    stop()
    setKeyword('')
    setItems([])
    setCursor(undefined)
    setSearched(false)
    setError('')
  }

  const toggle = (value: boolean) => {
    if (!value) stop()
    if (value && seed.trim() && seed.trim() !== keyword.trim()) {
      // 只带入主输入框的词，由用户回车确认，避免打开弹窗就消耗一次搜索
      setKeyword(seed.trim())
      setItems([])
      setCursor(undefined)
      setSearched(false)
      setError('')
    }
    setOpen(value)
  }

  const empty = !items.length && !loading

  return (
    <Dialog open={open} onOpenChange={toggle}>
      <Button
        type='button'
        variant='ghost'
        className='shrink-0 gap-1.5 px-2'
        aria-label={t('找博主')}
        disabled={disabled}
        onClick={() => toggle(true)}
      >
        <UserSearch />
        <span className='hidden sm:inline'>{t('找博主')}</span>
      </Button>
      <DialogContent className='flex max-h-[85dvh] w-[calc(100vw-2rem)] flex-col sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('找博主')}</DialogTitle>
          <DialogDescription className='sr-only'>
            {t('结果包含名称匹配的博主，以及相关视频的作者')}
          </DialogDescription>
        </DialogHeader>
        <form
          className='flex items-center gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void search()
          }}
        >
          <ClearableInput
            className='flex-1'
            autoFocus
            aria-label={t('搜索博主名称或关键词')}
            placeholder={t('搜索博主名称或关键词')}
            value={keyword}
            maxLength={100}
            onChange={(event) => setKeyword(event.target.value)}
            onClear={clear}
            onFocus={(event) => event.target.select()}
          />
          <Button
            type='submit'
            variant='secondary'
            disabled={loading || !keyword.trim()}
          >
            {loading ? (
              <Loader2 className='animate-spin motion-reduce:animate-none' />
            ) : (
              <Search />
            )}
            {t('搜索')}
          </Button>
        </form>
        <div className='min-h-64 flex-1 space-y-1 overflow-y-auto'>
          {items.map((item) => (
            <CreatorRow
              key={item.id}
              name={item.name}
              avatar={item.avatar}
              handle={item.uniqueId}
              // 加载更多时搜索进程仍占用平台，选中会与采集互斥
              disabled={item.private || loading}
              detail={[
                ...stats(item),
                item.private && t('作品不公开'),
                item.source === 'video' && t('相关作品作者'),
                item.verified || item.signature,
              ]
                .filter(Boolean)
                .join(' · ')}
              onClick={() => {
                onSelect(item)
                toggle(false)
              }}
            />
          ))}
          {loading && !items.length && (
            <div role='status' aria-label={t('搜索')}>
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className='flex items-center gap-3 p-2'>
                  <div className='size-8 shrink-0 rounded-full bg-muted motion-safe:animate-pulse' />
                  <div className='flex-1 space-y-2'>
                    <div className='h-3 w-1/3 rounded bg-muted motion-safe:animate-pulse' />
                    <div className='h-3 w-2/3 rounded bg-muted motion-safe:animate-pulse' />
                  </div>
                </div>
              ))}
              <Placeholder>
                {t('为避免触发平台验证，搜索会放慢一些')}
              </Placeholder>
            </div>
          )}
          {error && (
            <div role='alert' className='p-2 text-sm'>
              <p className='text-destructive'>{translateMessage(error)}</p>
              <p className='mt-1 text-muted-foreground'>
                {t('也可以直接粘贴博主主页链接')}
              </p>
            </div>
          )}
          {searched && empty && !error && (
            <Placeholder>{t('没有找到博主，换个关键词试试')}</Placeholder>
          )}
          {empty && !!recent.length && (
            <>
              <h3 className='px-2 pb-1 pt-2 text-xs text-muted-foreground'>
                {t('最近采集')}
              </h3>
              {recent.map(({ id, task, count }) => (
                <CreatorRow
                  key={id}
                  name={task.creator!.name}
                  avatar={task.creator!.avatar}
                  detail={t('已采 {{count}} 条', { count })}
                  onClick={() => {
                    onRestore(id)
                    toggle(false)
                  }}
                />
              ))}
            </>
          )}
          {cursor && (
            <Button
              type='button'
              variant='ghost'
              className='w-full'
              disabled={loading}
              onClick={() => void search(cursor)}
            >
              {t('加载更多')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
