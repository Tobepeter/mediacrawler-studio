import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { ClearButton } from '@/components/common/clearable-input'
import { IconButton } from '@/components/common/icon-button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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

export function AuthorBack(props: { fromPage: boolean; disabled?: boolean }) {
  const { t } = useTranslation('studio')
  const leaveAuthor = useStudio((state) => state.leaveAuthor)
  return (
    <IconButton
      variant='ghost'
      className='shrink-0'
      label={props.fromPage ? t('返回刚才的结果') : t('返回推荐')}
      disabled={props.disabled}
      onClick={() => void leaveAuthor()}
    >
      <ArrowLeft />
    </IconButton>
  )
}

// 博主模式下代替输入框，也是这批结果的标题；完整链接只放在悬浮提示里
export function CreatorField(props: {
  url: string
  creator?: CreatorInfo
  disabled?: boolean
  onClear: () => void
}) {
  const { url, creator, disabled, onClear } = props
  const { t } = useTranslation('studio')
  const stats = useCreatorStats()
  const name = creator?.name || t('博主主页')
  const detail = creator ? stats(creator).join(' · ') : ''
  return (
    <div
      className='flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input pl-2 pr-1 text-body'
      title={url}
    >
      <CreatorAvatar
        name={name}
        avatar={creator?.avatar}
        className='size-6 text-caption'
      />
      <span className='shrink-0 truncate font-medium'>{name}</span>
      <span className='hidden min-w-0 truncate text-caption text-muted-foreground sm:inline'>
        {detail}
      </span>
      <span className='flex-1' />
      <OpenCreator url={creator?.url || url} className='size-7' />
      {!disabled && <ClearButton label={t('清除博主')} onClick={onClear} />}
    </div>
  )
}

export function CreatorHeader(props: { creator: CreatorInfo; count: number }) {
  const { creator, count } = props
  const { t } = useTranslation('studio')
  const stats = useCreatorStats()
  return (
    <div className='flex items-center gap-3 pb-4'>
      <CreatorAvatar
        name={creator.name}
        avatar={creator.avatar}
        className='size-10'
      />
      <div className='min-w-0'>
        <h2 className='truncate font-semibold'>{creator.name}</h2>
        <p className='truncate text-caption text-muted-foreground'>
          {[...stats(creator), t('已采 {{count}} 条', { count })].join(' · ')}
        </p>
      </div>
      <OpenCreator url={creator.url} />
    </div>
  )
}
