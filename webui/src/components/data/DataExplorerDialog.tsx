import { useTranslation } from 'react-i18next'
import { Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { DataExplorer } from './DataExplorer'

export function DataExplorerDialog() {
  const { t } = useTranslation('data')

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='border-[#30363d] bg-transparent font-mono text-xs text-[#c9d1d9] hover:border-[#00ffff]/50 hover:bg-[#21262d] hover:text-[#00ffff]'
        >
          <Database className='h-3.5 w-3.5' />
          {t('dialog.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className='max-h-[85vh] max-w-5xl overflow-hidden'>
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
        </DialogHeader>
        <div className='max-h-[calc(85vh-100px)] overflow-auto pr-2'>
          <DataExplorer />
        </div>
      </DialogContent>
    </Dialog>
  )
}
