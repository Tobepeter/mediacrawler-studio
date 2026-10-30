import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileJson,
  FileSpreadsheet,
  FileText,
  Download,
  Eye,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { dataApi } from '@/lib/api'
import { formatFileSize, formatDateTime } from '@/lib/utils'
import { DataPreviewDialog } from './preview/DataPreviewDialog'
import type { DataFile } from '@/types/crawler'

interface FileCardProps {
  file: DataFile
}

const fileIcons: Record<string, typeof FileJson> = {
  json: FileJson,
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
}

const fileStyles: Record<
  string,
  { icon: string; border: string; badge: string }
> = {
  json: {
    icon: 'text-cyber-neon-yellow',
    border: 'hover:border-cyber-neon-yellow/50',
    badge:
      'border-cyber-neon-yellow/30 bg-cyber-neon-yellow/10 text-cyber-neon-yellow',
  },
  csv: {
    icon: 'text-cyber-neon-green',
    border: 'hover:border-cyber-neon-green/50',
    badge:
      'border-cyber-neon-green/30 bg-cyber-neon-green/10 text-cyber-neon-green',
  },
  xlsx: {
    icon: 'text-cyber-neon-cyan',
    border: 'hover:border-cyber-neon-cyan/50',
    badge:
      'border-cyber-neon-cyan/30 bg-cyber-neon-cyan/10 text-cyber-neon-cyan',
  },
  xls: {
    icon: 'text-cyber-neon-cyan',
    border: 'hover:border-cyber-neon-cyan/50',
    badge:
      'border-cyber-neon-cyan/30 bg-cyber-neon-cyan/10 text-cyber-neon-cyan',
  },
}

export function FileCard({ file }: FileCardProps) {
  const { t } = useTranslation('data')
  const [previewOpen, setPreviewOpen] = useState(false)

  const Icon = fileIcons[file.type] || FileText
  const styles = fileStyles[file.type] || {
    icon: 'text-cyber-text-muted',
    border: 'hover:border-cyber-neon-cyan/50',
    badge:
      'border-cyber-border-DEFAULT bg-cyber-bg-tertiary text-cyber-text-secondary',
  }

  // 检查是否支持预览
  const isPreviewable = ['json', 'csv', 'xlsx', 'xls'].includes(
    file.type.toLowerCase(),
  )

  const handleDownload = () => {
    const url = dataApi.getDownloadUrl(file.path)
    window.open(url, '_blank')
  }

  return (
    <>
      <Card
        className={`card-scan group relative overflow-hidden transition-all ${styles.border} hover:shadow-[0_0_15px_rgb(var(--cyber-neon-cyan)/0.15)]`}
      >
        {/* Scan effect overlay */}
        <div className='via-cyber-neon-cyan/5 pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent to-transparent transition-transform duration-700 group-hover:translate-x-full' />

        <CardContent className='relative p-4'>
          <div className='flex items-start gap-3'>
            <div
              className={`bg-cyber-bg-panel border-cyber-border-DEFAULT rounded border p-2 ${styles.icon}`}
            >
              <Icon className='h-6 w-6' />
            </div>
            <div className='min-w-0 flex-1'>
              <h3
                className='text-cyber-text-primary truncate font-mono text-sm font-medium'
                title={file.name}
              >
                {file.name}
              </h3>
              <p className='text-cyber-text-muted mt-1 font-mono text-xs'>
                {formatFileSize(file.size)}
                {file.record_count !== null && (
                  <span className='text-cyber-neon-green'>
                    {' '}
                    | {t('file.entries', { count: file.record_count })}
                  </span>
                )}
              </p>
              <p className='text-cyber-text-muted mt-1 font-mono text-xs'>
                {formatDateTime(file.modified_at)}
              </p>
            </div>
          </div>

          <div className='border-cyber-border-subtle mt-3 flex items-center justify-between border-t pt-3'>
            <Badge
              variant='outline'
              className={`font-mono text-[10px] ${styles.badge}`}
            >
              .{file.type.toUpperCase()}
            </Badge>
            <div className='flex gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
              {isPreviewable && (
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-cyber-neon-cyan hover:text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10 h-7 px-2 font-mono'
                  onClick={() => setPreviewOpen(true)}
                >
                  <Eye className='mr-1 h-3 w-3' />
                  {t('file.preview')}
                </Button>
              )}
              <Button
                variant='ghost'
                size='sm'
                className='text-cyber-neon-cyan hover:text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10 h-7 px-2 font-mono'
                onClick={handleDownload}
              >
                <Download className='mr-1 h-3 w-3' />
                {t('file.extract')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 预览对话框 */}
      {isPreviewable && (
        <DataPreviewDialog
          file={file}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}
    </>
  )
}
