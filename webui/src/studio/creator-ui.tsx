import { useTranslation } from 'react-i18next'
import { ArrowUpRight, X } from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { CreatorInfo } from './types'

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

// 博主模式下代替输入框，完整链接只放在悬浮提示里
export function CreatorField(props: {
  url: string
  creator?: CreatorInfo
  disabled?: boolean
  onClear: () => void
}) {
  const { url, creator, disabled, onClear } = props
  const { t } = useTranslation('studio')
  const name = creator?.name || t('博主主页')
  return (
    <div
      className={cn(
        'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input pl-2 pr-1 text-sm',
        disabled && 'opacity-50',
      )}
      title={url}
    >
      <CreatorAvatar
        name={name}
        avatar={creator?.avatar}
        className='size-6 text-xs'
      />
      <span className='truncate font-medium'>{name}</span>
      <span className='flex-1' />
      {!disabled && (
        <button
          type='button'
          className='flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          aria-label={t('清除博主')}
          title={t('清除博主')}
          onClick={onClear}
        >
          <X className='size-4' />
        </button>
      )}
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
        <p className='truncate text-xs text-muted-foreground'>
          {[...stats(creator), t('已采 {{count}} 条', { count })].join(' · ')}
        </p>
      </div>
      <IconButton
        variant='ghost'
        label={t('打开博主主页')}
        onClick={() => void window.studio?.openSource(creator.url)}
      >
        <ArrowUpRight />
      </IconButton>
    </div>
  )
}
