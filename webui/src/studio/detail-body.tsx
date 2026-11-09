import { Skeleton } from '@/components/ui/skeleton'
import { useTranslation } from 'react-i18next'
import { Heart, Loader2 } from 'lucide-react'
import { MarkdownRenderer } from '@/components/common/markdown-renderer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RetryNotice } from './retry-notice'
import type { ContentComment, ContentItem } from './types'
import { useDetailMedia } from './use-detail-media'

// 旧记录不显示评论页；新任务明确区分等待、空结果、失败和取消
export function DetailBody({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')

  const detail = useDetailMedia(item)
  // 推荐流卡片没有正文，补全时占位，失败时不要说成“没有正文”
  if (item.feed && !item.text && !detail.loading) {
    const error =
      detail.error ??
      (item.media?.status === 'failed'
        ? new Error('正文暂时没有加载出来，可以查看原文')
        : null)
    if (error) return <RetryNotice error={error} onRetry={detail.retry} />
  }
  if (item.feed && !item.text && !item.media)
    return (
      <div className='space-y-2' role='status' aria-busy='true'>
        <span className='sr-only'>{t('加载中')}</span>
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-4 w-2/3' />
      </div>
    )
  const body = item.markdown ? (
    <MarkdownRenderer content={item.markdown} />
  ) : (
    <p className='whitespace-pre-wrap break-words text-body leading-relaxed'>
      {item.text || t('这条作品没有正文')}
    </p>
  )
  // 卡片已有摘要时先显示，全文回来再替换；失败留在原位可重试，不弹全局提示
  const completing = item.detailPending && !!item.text && (
    <div className='mt-3 text-caption text-muted-foreground'>
      {detail.loading ? (
        <span role='status'>{t('正在加载完整内容')}</span>
      ) : (
        detail.error && (
          <RetryNotice error={detail.error} onRetry={detail.retry} />
        )
      )}
    </div>
  )
  if (!item.commentStatus)
    return (
      <>
        {body}
        {completing}
      </>
    )
  const comments = item.comments || []
  const roots = comments.filter((comment) => !comment.parentId)
  const replies = new Map<string, ContentComment[]>()
  for (const comment of comments) {
    if (comment.parentId)
      replies.set(comment.parentId, [
        ...(replies.get(comment.parentId) || []),
        comment,
      ])
  }
  const loading = ['pending', 'running'].includes(item.commentStatus)
  const status =
    item.commentStatus === 'pending'
      ? t('等待采集评论')
      : item.commentStatus === 'running'
        ? t('正在采集评论')
        : item.commentStatus === 'error'
          ? t('评论未取全，已保留现有内容')
          : item.commentStatus === 'cancelled'
            ? t('已停止，保留已获取的评论')
            : ''
  return (
    <Tabs defaultValue='body' className='space-y-4'>
      <TabsList aria-label={t('作品内容')}>
        <TabsTrigger value='body'>{t('正文')}</TabsTrigger>
        <TabsTrigger value='comments'>
          {t('评论')}
          {comments.length ? ` ${comments.length}` : ''}
        </TabsTrigger>
      </TabsList>
      <TabsContent value='body'>{body}</TabsContent>
      <TabsContent value='comments' className='space-y-4'>
        {status && (
          <p
            className='flex items-center gap-2 text-body text-muted-foreground'
            role='status'
          >
            {loading && (
              <Loader2 className='size-4 animate-spin motion-reduce:animate-none' />
            )}
            {status}
          </p>
        )}
        {!comments.length && item.commentStatus === 'completed' && (
          <p className='text-body text-muted-foreground'>{t('暂无评论')}</p>
        )}
        {roots.map((comment) => (
          <div key={comment.id} className='space-y-3'>
            <CommentRow comment={comment} />
            {!!replies.get(comment.id)?.length && (
              <div className='ml-4 space-y-3 rounded-md bg-muted/40 p-3'>
                {replies.get(comment.id)!.map((reply) => (
                  <CommentRow key={reply.id} comment={reply} />
                ))}
              </div>
            )}
          </div>
        ))}
      </TabsContent>
    </Tabs>
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
