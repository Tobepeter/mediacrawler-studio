import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { ClearButton } from '@/components/common/clearable-input'
import { IconButton } from '@/components/common/icon-button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { platformBlocked, useStudio } from './store'
import type { ContentItem, CreatorInfo } from './types'

export function CreatorAvatar(props: {
  name: string
  avatar?: string
  className?: string
}) {
  const { name, avatar, className } = props
  return (
    <Avatar className={className}>
      {avatar && (
        <AvatarImage src={avatar} alt='' referrerPolicy='no-referrer' />
      )}
      <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
    </Avatar>
  )
}

export function useCreatorStats() {
  const { t, i18n } = useTranslation('studio')
  const compact = new Intl.NumberFormat(i18n.language, { notation: 'compact' })
  return (creator: Pick<CreatorInfo, 'followers' | 'posts'>) =>
    [
      creator.followers != null &&
        t('{{value}} 粉丝', { value: compact.format(creator.followers) }),
      creator.posts != null &&
        t('{{value}} 作品', { value: compact.format(creator.posts) }),
    ].filter(Boolean) as string[]
}

// 旧记录里的昵称是脱敏过的，拿去搜也找不到人
const maskedName = /^(\*|.\*|.\*{3}.)$/u

// 对这个人感兴趣时点名字直接进主页，没有主页地址才按名字搜
// 平台忙、没登录或已经在博主页时只显示名字
export function AuthorName({ item }: { item: ContentItem }) {
  const { author: name, authorUrl } = item
  const { t } = useTranslation('studio')
  const openAuthor = useStudio((state) => state.openAuthor)
  const available = useStudio(
    (state) =>
      state.accounts[state.platform] === 'connected' &&
      state.pages[state.platform]?.task.mode !== 'creator' &&
      !platformBlocked(state),
  )
  if (
    !name ||
    !window.studio ||
    !available ||
    (!authorUrl && maskedName.test(name))
  )
    return <span className='truncate'>{name || t('未知作者')}</span>
  return (
    <button
      type='button'
      className='min-w-0 truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
      title={authorUrl ? t('查看这位博主的作品') : t('搜索这位博主')}
      onClick={() => void openAuthor(item)}
    >
      {name}
    </button>
  )
}

// 空格分开的词都要出现，大小写不敏感
export function matchesKeyword(item: ContentItem, keyword: string) {
  const text = `${item.title} ${item.text}`.toLowerCase()
  return keyword
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}

function OpenCreator({ url, className }: { url: string; className?: string }) {
  const { t } = useTranslation('studio')
  return (
    <IconButton
      variant='ghost'
      className={className}
      label={t('打开博主主页')}
      onClick={() => void window.studio?.openSource(url)}
    >
      <ArrowUpRight />
    </IconButton>
  )
}

// 博主模式下代替输入框：左边是这批结果属于谁，右边在已采的作品里继续搜
export function CreatorField(props: {
  url: string
  creator?: CreatorInfo
  disabled?: boolean
  onClear: () => void
  filter?: { value: string; count: number; onChange: (value: string) => void }
}) {
  const { url, creator, disabled, onClear, filter } = props
  const { t } = useTranslation('studio')
  const stats = useCreatorStats()
  const name = creator?.name || t('博主主页')
  const detail = creator ? stats(creator).join(' · ') : ''
  return (
    <div className='flex h-9 min-w-0 flex-1 items-center gap-1 rounded-md border border-input px-1 text-body focus-within:ring-1 focus-within:ring-ring'>
      <span
        className='flex h-7 min-w-0 max-w-[60%] shrink-0 items-center gap-1.5 rounded-sm bg-muted pl-1'
        title={[detail, url].filter(Boolean).join('\n')}
      >
        <CreatorAvatar
          name={name}
          avatar={creator?.avatar}
          className='size-5 text-caption'
        />
        <span className='truncate font-medium'>{name}</span>
        <OpenCreator url={creator?.url || url} className='size-7' />
        {!disabled && <ClearButton label={t('清除博主')} onClick={onClear} />}
      </span>
      {filter ? (
        <>
          <Input
            className='h-7 min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0'
            aria-label={t('在这位博主的作品里搜索')}
            placeholder={t('在已采的 {{count}} 条里搜索', {
              count: filter.count,
            })}
            value={filter.value}
            onChange={(event) => filter.onChange(event.target.value)}
            // 回车是筛选，不是重新采集
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault()
            }}
          />
          {filter.value && (
            <ClearButton
              label={t('清除搜索')}
              onClick={() => filter.onChange('')}
            />
          )}
        </>
      ) : (
        <span className='hidden min-w-0 flex-1 truncate px-1 text-caption text-muted-foreground sm:inline'>
          {detail}
        </span>
      )}
    </div>
  )
}
