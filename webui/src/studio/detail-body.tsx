import { Skeleton } from '@/components/ui/skeleton'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton } from '@/components/common/copy-button'
import { MarkdownRenderer } from '@/components/common/markdown-renderer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CommentsPanel, useCommentsTab } from './comments-panel'
import { RetryNotice } from './retry-notice'
import {
  TranscriptActions,
  TranscriptPanel,
  useTranscriptTab,
} from './transcript'
import type { ContentItem } from './types'
import { useDetailMedia } from './use-detail-media'

// 只有正文时不显示 Tab，复制按钮仍在同一行
export function DetailBody({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')

  const detail = useDetailMedia(item)
  const hasTranscript = useTranscriptTab(item)
  const hasComments = useCommentsTab(item)
  const [tab, setTab] = useState('body')
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
  const comments = item.comments || []
  const bodyText = item.markdown || item.text
  const multiple = hasTranscript || hasComments
  // 选中的 Tab 可能消失（比如 stt 被卸载），退回正文，不留空白
  const active =
    (tab === 'transcript' && !hasTranscript) ||
    (tab === 'comments' && !hasComments)
      ? 'body'
      : tab
  return (
    <Tabs value={active} onValueChange={setTab} className='space-y-3'>
      {/* 复制等操作跟内容放一起，滚动时留在顶部；右边让出弹窗的关闭按钮 */}
      <div className='sticky top-0 z-10 mr-8 flex min-h-11 items-center justify-between gap-2 bg-background py-1'>
        {multiple ? (
          <TabsList className='shrink-0' aria-label={t('作品内容')}>
            <TabsTrigger value='body'>{t('正文')}</TabsTrigger>
            {hasTranscript && (
              <TabsTrigger value='transcript'>{t('字幕')}</TabsTrigger>
            )}
            {hasComments && (
              <TabsTrigger value='comments'>
                {t('评论')}
                {comments.length ? ` ${comments.length}` : ''}
              </TabsTrigger>
            )}
          </TabsList>
        ) : (
          <span className='text-caption text-muted-foreground'>
            {t('正文')}
          </span>
        )}
        {active === 'body' && !!bodyText && (
          <CopyButton
            text={bodyText}
            label={t('复制正文')}
            className='size-7 shrink-0'
          />
        )}
        {active === 'transcript' && <TranscriptActions item={item} />}
      </div>
      <TabsContent value='body' className='mt-0'>
        {body}
        {completing}
      </TabsContent>
      {hasTranscript && (
        <TabsContent value='transcript' className='mt-0'>
          <TranscriptPanel item={item} />
        </TabsContent>
      )}
      {hasComments && (
        <TabsContent value='comments' className='mt-0'>
          <CommentsPanel item={item} />
        </TabsContent>
      )}
    </Tabs>
  )
}
