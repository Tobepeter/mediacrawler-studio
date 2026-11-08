import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Search, UserSearch } from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { translateMessage } from '@/i18n/studio'
import { creatorPlatforms } from './creator-options'
import type { CreatorSummary, Platform } from './types'

const failure = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      )
    : '搜索失败，请重试'

export function CreatorSearch(props: {
  platform: Platform
  disabled?: boolean
  onSelect: (creator: CreatorSummary) => void
}) {
  const { platform, disabled, onSelect } = props
  const { t, i18n } = useTranslation('studio')
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState<CreatorSummary[]>([])
  const [cursor, setCursor] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  if (!creatorPlatforms.includes(platform) || !window.studio?.searchCreators)
    return null
  const compact = new Intl.NumberFormat(i18n.language, { notation: 'compact' })

  const search = async (next?: string) => {
    const query = keyword.trim()
    if (!query || loading) return
    const id = ++request.current
    setLoading(true)
    setError('')
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
  const toggle = (value: boolean) => {
    if (!value && loading) {
      request.current++
      setLoading(false)
      void window.studio?.cancel(platform).catch(() => {})
    }
    setOpen(value)
  }

  return (
    <Dialog open={open} onOpenChange={toggle}>
      <IconButton
        label={t('找博主')}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <UserSearch />
      </IconButton>
      <DialogContent className='flex max-h-[85dvh] w-[calc(100vw-2rem)] flex-col sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('找博主')}</DialogTitle>
          <DialogDescription>
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
          <Input
            autoFocus
            aria-label={t('搜索博主名称或关键词')}
            placeholder={t('搜索博主名称或关键词')}
            value={keyword}
            maxLength={100}
            onChange={(event) => setKeyword(event.target.value)}
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
        <div className='min-h-40 flex-1 space-y-1 overflow-y-auto'>
          {items.map((item) => (
            <button
              type='button'
              key={item.id}
              className='flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
              onClick={() => {
                onSelect(item)
                toggle(false)
              }}
            >
              <Avatar>
                {item.avatar && <AvatarImage src={item.avatar} alt='' />}
                <AvatarFallback>{item.name.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-sm font-medium'>
                  {item.name}
                  {item.uniqueId && (
                    <span className='ml-2 font-normal text-muted-foreground'>
                      @{item.uniqueId}
                    </span>
                  )}
                </span>
                <span className='block truncate text-xs text-muted-foreground'>
                  {[
                    item.followers !== null &&
                      t('{{value}} 粉丝', {
                        value: compact.format(item.followers),
                      }),
                    item.posts !== null &&
                      t('{{value}} 作品', {
                        value: compact.format(item.posts),
                      }),
                    item.private && t('作品不公开'),
                    item.source === 'video' && t('相关作品作者'),
                    item.verified || item.signature,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </button>
          ))}
          {error ? (
            <p className='p-2 text-sm text-destructive' role='alert'>
              {translateMessage(error)}
            </p>
          ) : (
            searched &&
            !loading &&
            !items.length && (
              <p className='p-2 text-sm text-muted-foreground'>
                {t('没有找到博主，换个关键词试试')}
              </p>
            )
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
