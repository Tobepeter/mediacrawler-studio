import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Heart, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { RetryNotice } from './retry-notice'
import { ScrollSentinel } from './scroll-sentinel'
import { commentPlatforms } from './creator-options'
import { useStudio } from './store'
import { ThrottledError } from './throttle'
import type { CommentPage, ContentComment, ContentItem } from './types'

async function fetchComments(
  item: ContentItem,
  cursor?: string | number,
  parent?: string,
): Promise<CommentPage> {
  const page = await window.studio!.loadComments!(item.platform, item.id, {
    cursor,
    parent,
  })
  if (page.code === 'throttled')
    throw new ThrottledError({
      code: page.throttleCode || 'RATE_LIMITED',
      retryAfter: page.retryAfter || 0,
      message: page.message || '',
    })
  if (page.code)
    throw new Error(
      page.code === 'login' ? '请先登录这个平台' : '评论暂时加载不出来，请重试',
    )
  return page
}

// 切到评论 Tab 才请求，往下滚一次取一页；回复点开才取
function useComments(item: ContentItem, parent?: string, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: ['studio', 'comments', item.id, parent || ''],
    queryFn: ({ pageParam }) => fetchComments(item, pageParam, parent),
    initialPageParam: undefined as string | number | undefined,
    getNextPageParam: (last) =>
      last.hasMore ? (last.nextCursor ?? undefined) : undefined,
    enabled,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  })
  // 平台的不同页可能有重复
  const seen = new Set<string>()
  const rows = (query.data?.pages || [])
    .flatMap((page) => page.items)
    .filter((row) => !seen.has(row.id) && !!seen.add(row.id))
  return { ...query, rows }
}

export function useCommentsTab(item: ContentItem) {
  return useStudio(
    (state) =>
      !!item.commentStatus ||
      (commentPlatforms.includes(item.platform) &&
        state.accounts[item.platform] === 'connected' &&
        !!window.studio?.loadComments),
  )
}

function CommentRow({ comment }: { comment: ContentComment }) {
  const { t } = useTranslation('studio')
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between gap-2 text-caption text-muted-foreground'>
        <span className='truncate'>{comment.author || t('匿名用户')}</span>
        <span className='inline-flex shrink-0 items-center gap-1'>
          <Heart className='size-3' />
          {comment.likes}
        </span>
      </div>
      <p className='whitespace-pre-wrap break-words text-body leading-relaxed'>
        {comment.text}
      </p>
    </div>
  )
}

function Replies({
  item,
  comment,
}: {
  item: ContentItem
  comment: ContentComment
}) {
  const { t } = useTranslation('studio')
  const [open, setOpen] = useState(false)
  const replies = useComments(item, comment.id, open)
  return (
    <div className='ml-4 space-y-3'>
      <Button
        variant='ghost'
        className='h-auto gap-1 p-0 text-caption text-muted-foreground'
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          className={cn('transition-transform', open && 'rotate-90')}
        />
        {t('{{count}} 条回复', { count: comment.replyCount })}
      </Button>
      {open && (
        <div className='space-y-3 rounded-md bg-muted/40 p-3'>
          {replies.isPending && <CommentSkeleton rows={1} />}
          {replies.rows.map((reply) => (
            <CommentRow key={reply.id} comment={reply} />
          ))}
          {replies.isError && (
            <RetryNotice
              error={replies.error}
              onRetry={() => void replies.refetch()}
            />
          )}
          {replies.hasNextPage && !replies.isError && (
            <Button
              variant='ghost'
              className='h-auto gap-1 p-0 text-caption text-muted-foreground'
              disabled={replies.isFetchingNextPage}
              onClick={() => void replies.fetchNextPage()}
            >
              {replies.isFetchingNextPage && (
                <Loader2 className='animate-spin motion-reduce:animate-none' />
              )}
              {t('更多回复')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function CommentSkeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useTranslation('studio')
  return (
    <div className='space-y-4' role='status' aria-busy='true'>
      <span className='sr-only'>{t('加载中')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className='space-y-2'>
          <Skeleton className='h-3 w-1/4' />
          <Skeleton className='h-4 w-full' />
        </div>
      ))}
    </div>
  )
}

function LiveComments({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')
  const comments = useComments(item)
  if (comments.isPending) return <CommentSkeleton />
  if (comments.isError && !comments.rows.length)
    return (
      <RetryNotice
        error={comments.error}
        onRetry={() => void comments.refetch()}
      />
    )
  if (!comments.rows.length)
    return <p className='text-body text-muted-foreground'>{t('暂无评论')}</p>
  return (
    <div className='space-y-4'>
      {comments.rows.map((comment) => (
        <div key={comment.id} className='space-y-2'>
          <CommentRow comment={comment} />
          {!!comment.replyCount && <Replies item={item} comment={comment} />}
        </div>
      ))}
      {(comments.hasNextPage || comments.isFetchNextPageError) && (
        <ScrollSentinel
          key={comments.rows.length}
          active={!comments.isFetchingNextPage && !comments.isError}
          needsScroll={false}
          onReach={() => void comments.fetchNextPage({ cancelRefetch: false })}
        >
          {comments.isError ? (
            <RetryNotice
              error={comments.error}
              onRetry={() => void comments.fetchNextPage()}
            />
          ) : (
            <span className='inline-flex h-9 items-center' role='status'>
              <Loader2
                className='size-4 animate-spin motion-reduce:animate-none'
                aria-hidden='true'
              />
              <span className='sr-only'>{t('加载中')}</span>
            </span>
          )}
        </ScrollSentinel>
      )}
    </div>
  )
}

// 之前随采集存下来的评论，照原样显示，不再请求
function StoredComments({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')
  const comments = item.comments || []
  const roots = comments.filter((comment) => !comment.parentId)
  const notice =
    item.commentStatus === 'error'
      ? t('评论未取全，已保留现有内容')
      : item.commentStatus === 'cancelled'
        ? t('已停止，保留已获取的评论')
        : ''
  return (
    <div className='space-y-4'>
      {notice && <p className='text-body text-muted-foreground'>{notice}</p>}
      {!comments.length && (
        <p className='text-body text-muted-foreground'>{t('暂无评论')}</p>
      )}
      {roots.map((comment) => {
        const replies = comments.filter((row) => row.parentId === comment.id)
        return (
          <div key={comment.id} className='space-y-3'>
            <CommentRow comment={comment} />
            {!!replies.length && (
              <div className='ml-4 space-y-3 rounded-md bg-muted/40 p-3'>
                {replies.map((reply) => (
                  <CommentRow key={reply.id} comment={reply} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function CommentsPanel({ item }: { item: ContentItem }) {
  return item.commentStatus ? (
    <StoredComments item={item} />
  ) : (
    <LiveComments item={item} />
  )
}
