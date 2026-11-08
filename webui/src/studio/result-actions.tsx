import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ellipsis, Eraser, FileJson, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@/components/common/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { platformBusy, usePage, useStudio } from './store'

// 当前平台结果操作，与采集按钮同排；历史结果无需登录也可导出
export function ResultActions() {
  const { t } = useTranslation('studio')
  const page = usePage()
  const results = page?.results || []
  const [exporting, setExporting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const blocked = useStudio(platformBusy)
  const clear = async () => {
    setClearing(true)
    try {
      await useStudio.getState().clearResults()
    } catch {
      toast.error(t('清空失败，请重试'))
    } finally {
      setClearing(false)
    }
  }
  const exportResults = async (format: 'csv' | 'json') => {
    if (!window.studio) {
      toast(t('示例内容不可导出'))
      return
    }
    setExporting(true)
    try {
      if (
        page &&
        (await window.studio.export(format, page.task.platform, page.id))
      )
        toast.success(t('已导出'))
    } catch {
      toast.error(t('导出失败，请重试'))
    } finally {
      setExporting(false)
    }
  }
  if (!results.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant='ghost'
          size='icon'
          aria-label={t('更多结果操作')}
          label={t('更多')}
          disabled={exporting || clearing}
        >
          <Ellipsis />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onSelect={() => void exportResults('csv')}>
          <FileSpreadsheet />
          {t('导出 CSV')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void exportResults('json')}>
          <FileJson />
          {t('导出 JSON')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={blocked || clearing}
          onSelect={() => void clear()}
        >
          <Eraser />
          {t('清空当前结果')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
