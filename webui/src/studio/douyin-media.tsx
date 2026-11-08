import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ImageGallery } from '@/components/common/image-gallery/image-gallery'
import { platformBusy, useStudio } from './store'
import type { ContentItem } from './types'

// 播放地址只在当前详情内存中保留，切换封面或卸载即停止请求和播放
export function DouyinMedia({ item }: { item: ContentItem }) {
  const { t } = useTranslation('studio')
  const busy = useStudio((state) => platformBusy(state, item.platform))
  const [mode, setMode] = useState('video')
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'playing' | 'error'
  >('idle')
  const [error, setError] = useState('')
  const [urls, setUrls] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [buffering, setBuffering] = useState(false)
  const request = useRef<string | null>(null)
  const refreshed = useRef(false)
  const failedSource = useRef('')

  useEffect(
    () => () => {
      const id = request.current
      request.current = null
      if (id) void window.studio?.cancelVideo(id).catch(() => {})
    },
    [],
  )

  const load = async (refresh = false) => {
    const bridge = window.studio
    if (!bridge || request.current) return
    if (platformBusy(useStudio.getState(), item.platform)) {
      setError('请先结束当前任务')
      setStatus('error')
      return
    }
    if (!refresh) refreshed.current = false
    const id = crypto.randomUUID()
    request.current = id
    setStatus('loading')
    setError('')
    setUrls([])
    try {
      const result = await bridge.resolveVideo(item.platform, item.id, id)
      if (request.current !== id) return
      if (!result.urls.length || result.code) {
        const messages: Record<string, string> = {
          login: '请先登录对应平台，再播放视频',
          unsupported: '这条作品没有可播放的视频',
          cancelled: '已取消',
          network: '视频加载失败，请重试',
          environment: '播放环境不可用，请检查 Python 环境',
        }
        setError(messages[result.code] || '视频暂时无法播放，可重试或查看原文')
        setStatus('error')
        return
      }
      setUrls(result.urls)
      setIndex(0)
      failedSource.current = ''
      setBuffering(true)
      setStatus('playing')
    } catch {
      if (request.current === id) {
        setError('视频加载失败，请重试')
        setStatus('error')
      }
    } finally {
      if (request.current === id) request.current = null
    }
  }
  const failed = () => {
    if (mode !== 'video' || status !== 'playing') return
    const source = urls[index]
    if (!source || failedSource.current === source) return
    failedSource.current = source
    if (index + 1 < urls.length) {
      setBuffering(true)
      setIndex(index + 1)
    } else if (!refreshed.current) {
      refreshed.current = true
      void load(true)
    } else {
      setError('视频暂时无法播放，可重试或查看原文')
      setStatus('error')
    }
  }
  // 网络停滞也有终点，不让原生播放器无限等待
  useEffect(() => {
    if (status !== 'playing' || !buffering) return
    const timer = setTimeout(() => {
      setError('视频加载失败，请重试')
      setStatus('error')
    }, 20000)
    return () => clearTimeout(timer)
  }, [status, buffering, index, urls])

  const changeMode = (value: string) => {
    const id = request.current
    request.current = null
    if (id) void window.studio?.cancelVideo(id).catch(() => {})
    setUrls([])
    setStatus('idle')
    setMode(value)
  }
  return (
    <Tabs value={mode} onValueChange={changeMode} className='space-y-3'>
      <TabsContent value='video' className='mt-0'>
        <div className='relative aspect-square max-h-[calc(90dvh-8rem)] w-full overflow-hidden rounded-lg bg-muted/40'>
          {status === 'playing' ? (
            <>
              <video
                key={urls[index]}
                src={urls[index]}
                poster={item.images[0]}
                className='absolute inset-0 size-full object-contain'
                controls
                autoPlay
                playsInline
                preload='metadata'
                controlsList='nodownload'
                aria-label={`${item.title} · ${t('视频播放器')}`}
                onError={failed}
                onWaiting={() => setBuffering(true)}
                onCanPlay={() => setBuffering(false)}
                onPlaying={() => setBuffering(false)}
              />
              {buffering && (
                <Loader2
                  aria-label={t('正在加载视频')}
                  className='pointer-events-none absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 animate-spin text-primary'
                />
              )}
            </>
          ) : (
            <>
              {item.images[0] && (
                <img
                  src={item.images[0]}
                  alt=''
                  referrerPolicy='no-referrer'
                  className='absolute inset-0 size-full object-contain'
                />
              )}
              {status === 'idle' ? (
                <Button
                  variant='ghost'
                  className='group absolute inset-0 h-full w-full rounded-none p-0 hover:bg-transparent focus-visible:ring-inset'
                  aria-label={t('播放视频')}
                  disabled={!window.studio || busy}
                  onClick={() => void load()}
                >
                  <span className='flex size-12 items-center justify-center rounded-full bg-background/90 shadow-sm transition-transform motion-safe:group-hover:scale-105'>
                    <Play className='size-5 fill-current' />
                  </span>
                </Button>
              ) : (
                <div
                  className='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 p-6 text-center'
                  role='status'
                >
                  {status === 'loading' ? (
                    <>
                      <Loader2 className='size-6 animate-spin motion-reduce:animate-none' />
                      <span className='text-sm'>{t('正在加载视频')}</span>
                      <Button
                        variant='ghost'
                        onClick={() => changeMode('video')}
                      >
                        {t('取消')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className='text-sm text-muted-foreground'>
                        {t(error)}
                      </p>
                      <Button
                        variant='outline'
                        disabled={busy}
                        onClick={() => void load()}
                      >
                        {t('重试')}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </TabsContent>
      <TabsContent value='cover' className='mt-0'>
        <ImageGallery images={item.images} title={item.title} />
      </TabsContent>
      <TabsList aria-label={t('媒体内容')}>
        <TabsTrigger value='video'>{t('视频')}</TabsTrigger>
        <TabsTrigger value='cover' disabled={!item.images.length}>
          {t('封面')}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
