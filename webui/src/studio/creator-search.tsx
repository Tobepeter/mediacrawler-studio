import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useInView } from 'react-intersection-observer'
import { useTranslation } from 'react-i18next'
import { Loader2, Search, UserSearch } from 'lucide-react'
import { ClearableInput } from '@/components/common/clearable-input'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
import { settleCreatorSearch, useCreatorSearch } from './use-creator-search'
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

// 列表每次变化都重新挂载：inView 由观察器异步更新，沿用旧值会在追加后多请求一页
// 新实例从不可见开始，观察器首次回调给出真实位置，内容没填满时也能继续加载
function LoadMoreSentinel(props: {
  root: HTMLElement | null
  active: boolean
  onLoad: () => void
  children: ReactNode
}) {
  const { root, active, onLoad, children } = props
  const { ref, inView } = useInView({
    root,
    rootMargin: '0px 0px 120px 0px',
    skip: !root,
  })
  const shouldLoad = active && inView
  useEffect(() => {
    if (shouldLoad) onLoad()
  }, [shouldLoad, onLoad])
  return (
    <div
      ref={ref}
      className='flex min-h-12 items-center justify-center gap-2 text-xs text-muted-foreground'
    >
      {children}
    </div>
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
  const [submitted, setSubmitted] = useState('')
  const search = useCreatorSearch(platform, submitted)
  const items = search.data?.items ?? []
  const firstLoading = search.isFetching && !items.length
  // 同一时间只发一页，失败或整页重复时停下，不自动重试对频率敏感的接口
  const { fetchNextPage } = search
  const loadNext = useCallback(
    () => void fetchNextPage({ cancelRefetch: false }),
    [fetchNextPage],
  )
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const autoLoad =
    open &&
    search.hasNextPage &&
    !search.isFetching &&
    !search.isError &&
    !search.data?.stalled
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

  const submit = () => {
    const query = keyword.trim()
    if (!query) return
    if (query === submitted && search.isError && !search.data)
      void search.refetch()
    else setSubmitted(query)
  }

  const clear = () => {
    setKeyword('')
    setSubmitted('')
  }

  // 关闭时结束进行中的搜索，释放同平台的采集互斥
  const toggle = (value: boolean) => {
    if (!value) {
      // 没拿到结果的词不保留，否则再次打开会自动发起搜索
      if (!search.data) setSubmitted('')
      void settleCreatorSearch()
    }
    useStudio.getState().patch({ creatorSearchOpen: value })
    // 搜索和采集互斥，打开弹窗时先结束后台续采
    if (value) void useStudio.getState().stopContinuation(platform)
    if (value && seed.trim() && seed.trim() !== keyword.trim()) {
      // 只带入主输入框的词，由用户回车确认，避免打开弹窗就消耗一次搜索
      setKeyword(seed.trim())
      setSubmitted('')
    }
    setOpen(value)
  }

  const leave = async (action: () => void) => {
    toggle(false)
    await settleCreatorSearch()
    action()
  }

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
      {/* 高度固定，切换搜索状态不跳动；矮窗口按视口收缩 */}
      <DialogContent className='flex h-[min(34rem,85dvh)] w-[calc(100vw-2rem)] flex-col sm:max-w-xl'>
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
            submit()
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
          <Button type='submit' variant='secondary' disabled={!keyword.trim()}>
            {firstLoading ? (
              <Loader2 className='animate-spin motion-reduce:animate-none' />
            ) : (
              <Search />
            )}
            {t('搜索')}
          </Button>
        </form>
        {/* 换关键词时重建滚动容器，回到顶部 */}
        <div
          key={submitted}
          ref={setScroller}
          className='min-h-0 flex-1 space-y-1 overflow-y-auto'
        >
          {items.map((item) => (
            <CreatorRow
              key={item.id}
              name={item.name}
              avatar={item.avatar}
              handle={item.uniqueId}
              disabled={item.private}
              detail={[
                ...stats(item),
                item.private && t('作品不公开'),
                item.source === 'video' && t('相关作品作者'),
                item.verified || item.signature,
              ]
                .filter(Boolean)
                .join(' · ')}
              onClick={() => void leave(() => onSelect(item))}
            />
          ))}
          {firstLoading && (
            <div role='status' aria-label={t('搜索')}>
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className='flex items-center gap-3 p-2'>
                  <Skeleton className='size-8 shrink-0 rounded-full motion-reduce:animate-none' />
                  <div className='flex-1 space-y-2'>
                    <Skeleton className='h-3 w-1/3 motion-reduce:animate-none' />
                    <Skeleton className='h-3 w-2/3 motion-reduce:animate-none' />
                  </div>
                </div>
              ))}
              <Placeholder>
                {t('为避免触发平台验证，搜索会放慢一些')}
              </Placeholder>
            </div>
          )}
          {search.isError && !search.data && (
            <div role='alert' className='p-2 text-sm'>
              <p className='text-destructive'>
                {translateMessage(failure(search.error))}
              </p>
              <p className='mt-1 text-muted-foreground'>
                {t('也可以直接粘贴博主主页链接')}
              </p>
            </div>
          )}
          {search.isSuccess &&
            !items.length &&
            !search.isFetching &&
            !search.hasNextPage && (
              <Placeholder>{t('没有找到博主，换个关键词试试')}</Placeholder>
            )}
          {!items.length && !firstLoading && !!recent.length && (
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
                  onClick={() => void leave(() => onRestore(id))}
                />
              ))}
            </>
          )}
          {/* 哨兵常驻列表末尾：正常滚动时已提前加载，滚得快才会看到 */}
          {search.hasNextPage && !!items.length && (
            <LoadMoreSentinel
              key={`${submitted}:${items.length}`}
              root={scroller}
              active={autoLoad}
              onLoad={loadNext}
            >
              {search.isFetchNextPageError ? (
                <>
                  <span className='min-w-0 truncate text-destructive'>
                    {translateMessage(failure(search.error))}
                  </span>
                  <Button type='button' variant='ghost' onClick={loadNext}>
                    {t('重试')}
                  </Button>
                </>
              ) : search.data?.stalled && !search.isFetching ? (
                <Button type='button' variant='ghost' onClick={loadNext}>
                  {t('加载更多')}
                </Button>
              ) : (
                <>
                  <Loader2
                    className='size-3 animate-spin motion-reduce:animate-none'
                    aria-hidden='true'
                  />
                  {t('加载更多')}
                </>
              )}
            </LoadMoreSentinel>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
