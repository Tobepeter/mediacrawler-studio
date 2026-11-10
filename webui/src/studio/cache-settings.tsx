import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Eraser } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmButton, SettingRow } from './settings-row'

const sizeKey = ['studio', 'cache-size']

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.ceil(bytes / 1024)} KB`
}

export function CacheSettings() {
  const { t } = useTranslation('studio')
  const client = useQueryClient()
  const size = useQuery({
    queryKey: sizeKey,
    queryFn: () => window.studio!.cacheSize!(),
    enabled: !!window.studio?.cacheSize,
    staleTime: 0,
  })
  const clear = useMutation({
    mutationFn: () => window.studio!.clearCache!(),
    onSuccess: () => {
      client.removeQueries({ queryKey: ['studio', 'transcript'] })
      void client.invalidateQueries({ queryKey: sizeKey })
      toast.success(t('缓存已清理'), { id: 'clear-cache' })
    },
    onError: () => {
      toast.error(t('清理失败，请重试'), { id: 'clear-cache' })
    },
  })
  if (!window.studio?.cacheSize) return null
  return (
    <SettingRow
      title={t('清理缓存')}
      hint={
        size.data === undefined
          ? t('字幕、推荐预取和图片')
          : t('字幕、推荐预取和图片，共 {{size}}', {
              size: formatBytes(size.data),
            })
      }
    >
      <ConfirmButton
        icon={<Eraser />}
        label={t('清理')}
        confirm={t('清理')}
        message={t('字幕要重新生成，图片要重新加载，登录态和采集记录不受影响')}
        disabled={clear.isPending}
        onConfirm={() => clear.mutate()}
      />
    </SettingRow>
  )
}
