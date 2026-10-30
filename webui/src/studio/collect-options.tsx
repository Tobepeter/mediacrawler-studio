import { useTranslation } from 'react-i18next'
import { useId } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { IconButton } from '@/components/common/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useForm, useStudio } from './store'

export function CollectOptions({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation('studio')

  const form = useForm()
  const updateForm = useStudio((state) => state.updateForm)
  const id = useId()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          label={t('采集选项')}
          disabled={disabled}
          variant={form.comments ? 'secondary' : 'ghost'}
        >
          <SlidersHorizontal />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align='end'
        className='w-80 max-w-[calc(100vw-2rem)] space-y-4'
        aria-label={t('采集选项')}
      >
        <div className='flex items-center gap-2'>
          <Checkbox
            id={`${id}-comments`}
            checked={!!form.comments}
            disabled={disabled}
            onCheckedChange={(value) =>
              updateForm({
                comments: value === true,
                replies: value === true && form.replies === true,
              })
            }
          />
          <Label htmlFor={`${id}-comments`}>{t('采集评论')}</Label>
          <span className='ml-auto text-xs text-muted-foreground'>
            {t('最多20条/篇')}
          </span>
        </div>
        <div className='flex items-center gap-2'>
          <Checkbox
            id={`${id}-replies`}
            checked={!!form.replies}
            disabled={disabled || !form.comments}
            onCheckedChange={(value) => updateForm({ replies: value === true })}
          />
          <Label htmlFor={`${id}-replies`}>{t('包含回复')}</Label>
          <span className='ml-auto text-xs text-muted-foreground'>
            {t('另取20条/篇')}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
