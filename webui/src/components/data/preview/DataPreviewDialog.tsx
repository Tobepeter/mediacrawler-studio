import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { dataApi } from '@/lib/api'
import { DataPreviewTable } from './DataPreviewTable'
import type { DataFile } from '@/types/crawler'

interface DataPreviewDialogProps {
  file: DataFile
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DataPreviewDialog({
  file,
  open,
  onOpenChange,
}: DataPreviewDialogProps) {
  const { t } = useTranslation('data')

  const { data, isLoading, error } = useQuery({
    queryKey: ['filePreview', file.path],
    queryFn: async () => {
      const { data } = await dataApi.getFileContent(file.path, 100)
      return data
    },
    enabled: open,
  })

  const handleDownload = () => {
    const url = dataApi.getDownloadUrl(file.path)
    window.open(url, '_blank')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[85vh] max-w-6xl flex-col'>
        <DialogHeader className='flex-shrink-0'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <DialogTitle className='text-cyber-neon-cyan font-mono'>
                {file.name}
              </DialogTitle>
              <Badge variant='outline' className='font-mono text-[10px]'>
                .{file.type.toUpperCase()}
              </Badge>
              {data && (
                <Badge variant='default' className='font-mono text-[10px]'>
                  {t('preview.records', { count: data.total })}
                </Badge>
              )}
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={handleDownload}
              className='font-mono text-xs'
            >
              <Download className='mr-1 h-3 w-3' />
              {t('preview.download')}
            </Button>
          </div>
        </DialogHeader>

        {/* 内容区域 */}
        <div className='mt-4 min-h-0 flex-1 overflow-hidden'>
          {isLoading ? (
            <div className='flex h-full items-center justify-center'>
              <div className='text-cyber-text-muted animate-pulse font-mono'>
                {t('preview.loading')}
              </div>
            </div>
          ) : error ? (
            <div className='flex h-full items-center justify-center'>
              <div className='text-cyber-neon-pink font-mono'>
                {t('preview.error')}
              </div>
            </div>
          ) : data ? (
            <DataPreviewTable data={data.data} columns={data.columns} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
