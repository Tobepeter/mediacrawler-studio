import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Images, Film, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu'
import { videoQualities } from './media-options'
import { useDetailMedia } from './use-detail-media'
import { platformBusy, useStudio } from './store'
import type { ContentItem } from './types'

// 一个下载入口：整组图片或视频，失败使用全局弹窗说明，关闭详情后仍能收到结果
export function MediaDownload({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')
  const busy = useStudio((state) => platformBusy(state, item.platform))
  const [downloading, setDownloading] = useState(false)
  const qualities = videoQualities(item)
  // 清晰度还在取时“自动”已经能下，不用等
  const loadingQualities = useDetailMedia(item)
  const video =
    item.contentType === 'video' ||
    item.media?.variants?.some((variant) => variant.kind === 'video')
  const coverOnly = video && item.images.length === 1
  const canDownloadVideo =
    video || !['available', 'not_provided'].includes(item.media?.status || '')
  const setFailure = (downloadFailure: string) =>
    useStudio.getState().patch({ downloadFailure })
  const download = async (kind: 'images' | 'video', quality = 'best') => {
    if (!window.studio || busy || downloading) return
    setDownloading(true)
    useStudio.getState().setRequest(item.platform, 'download')
    try {
      const result = await window.studio.downloadMedia(
        item.platform,
        item.id,
        kind,
        useStudio.getState().askBeforeDownload,
        quality,
      )
      if (result.code && result.code !== 'cancelled') {
        const messages: Record<string, string> = {
          expired: '资源已过期或被删除，请重新采集后重试',
          unavailable: '链接可能已过期，或平台暂不允许下载',
          ffmpeg_required: '此视频需要 FFmpeg，请安装后重试',
          hls_unsupported: '暂不支持直播或加密的 M3U8 内容',
          hls_failed: 'M3U8 合并失败，请稍后重试',
          quality_unavailable: '未找到指定清晰度',
          audio_unavailable: '未找到匹配的音频轨',
          timeout: '下载超时，请稍后重试',
          unsupported: '未找到可下载的视频直链，暂不支持下载此内容',
          login: '请先登录对应平台，再下载视频',
          disk: '无法保存文件，请检查目录权限和可用空间',
          environment: '下载环境不可用，请检查 Python 环境',
          network: '下载失败，请检查网络后重试',
          failed: '下载未完成，请稍后重试',
        }
        const reason = t(messages[result.code] || messages.network)
        setFailure(
          result.saved
            ? `${reason} · ${t('已保存 {{count}} 个文件，其余未完成', { count: result.saved })}`
            : reason,
        )
      } else if (result.saved) {
        if (result.code === 'cancelled')
          toast.info(
            t('下载已取消，已保存 {{count}} 个文件', { count: result.saved }),
            { id: 'media-download' },
          )
        else
          toast.success(t('已保存 {{count}} 个文件', { count: result.saved }), {
            id: 'media-download',
          })
      }
    } catch {
      setFailure('下载失败，请检查网络后重试')
    } finally {
      setDownloading(false)
      useStudio.getState().setRequest(item.platform)
    }
  }
  return (
    <>
      {downloading ? (
        <Button
          variant='outline'
          onClick={() =>
            void window.studio
              ?.cancel(item.platform)
              .catch(() => toast.error(t('停止失败，请重试')))
          }
        >
          <Loader2 className='animate-spin motion-reduce:animate-none' />
          {t('取消下载')}
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='outline' disabled={!window.studio || busy}>
              <Download />
              {t('下载')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {!!item.images.length && (
              <DropdownMenuItem onSelect={() => void download('images')}>
                <Images />
                {t(coverOnly ? '下载封面' : '下载全部图片')}
              </DropdownMenuItem>
            )}
            {canDownloadVideo &&
              (qualities.length > 1 || loadingQualities ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Film />
                    {t('下载视频')}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className='max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto'>
                      <DropdownMenuItem onSelect={() => void download('video')}>
                        {t('自动（推荐）')}
                      </DropdownMenuItem>
                      {qualities.map((quality) => (
                        <DropdownMenuItem
                          key={quality}
                          onSelect={() => void download('video', quality)}
                        >
                          {quality.toUpperCase()}
                        </DropdownMenuItem>
                      ))}
                      {loadingQualities && (
                        <DropdownMenuItem disabled>
                          <Loader2 className='animate-spin motion-reduce:animate-none' />
                          {t('正在获取清晰度')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem onSelect={() => void download('video')}>
                  <Film />
                  {t('下载视频')}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}

export function DownloadFeedback() {
  const { t } = useTranslation('studio')
  const failure = useStudio((state) => state.downloadFailure)
  const setFailure = (downloadFailure: string) =>
    useStudio.getState().patch({ downloadFailure })
  return (
    <Dialog
      open={!!failure}
      onOpenChange={(open) => {
        if (!open) setFailure('')
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('下载未完成')}</DialogTitle>
          <DialogDescription>{t(failure)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => setFailure('')}>{t('知道了')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
