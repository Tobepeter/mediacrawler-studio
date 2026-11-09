import { useTranslation } from 'react-i18next'
import { useId, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import searchOptions from '../../../desktop/search-options.json'
import { IconButton } from '@/components/common/icon-button'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { platformNames, useForm, useStudio } from './store'

type SearchField = {
  label: string
  default: string
  options: { value: string; label: string }[]
}

// 平台原生筛选与评论采集，应用后仅影响下一次采集
export function CollectOptions({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation('studio')
  const form = useForm()
  const updateForm = useStudio((state) => state.updateForm)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({
    filters: form.filters || {},
    comments: !!form.comments,
    replies: !!form.replies,
  })
  const fields: Record<string, SearchField> =
    form.mode === 'search' ? searchOptions[form.platform] : {}
  const changed =
    form.comments ||
    Object.entries(fields).some(
      ([key, field]) =>
        (form.filters?.[key] || field.default) !== field.default,
    )
  const id = useId()
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value)
          setDraft({
            filters: form.filters || {},
            comments: !!form.comments,
            replies: !!form.replies,
          })
        setOpen(value)
      }}
    >
      <DialogTrigger asChild>
        <IconButton
          label={t('采集选项')}
          disabled={disabled}
          variant={changed ? 'secondary' : 'ghost'}
        >
          <SlidersHorizontal />
        </IconButton>
      </DialogTrigger>
      <DialogContent className='max-h-[85dvh] w-[calc(100vw-2rem)] overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>
            {t(platformNames[form.platform])} · {t('采集选项')}
          </DialogTitle>
          <DialogDescription>{t('下次采集生效')}</DialogDescription>
        </DialogHeader>
        <div className='space-y-6 py-2'>
          {Object.keys(fields).length > 0 && (
            <div className='space-y-4'>
              {Object.entries(fields).map(([key, field]) => (
                <div key={key} className='grid grid-cols-2 items-center gap-4'>
                  <Label htmlFor={`${id}-${key}`}>{t(field.label)}</Label>
                  <Select
                    value={draft.filters[key] || field.default}
                    disabled={disabled}
                    onValueChange={(value) =>
                      setDraft({
                        ...draft,
                        filters: { ...draft.filters, [key]: value },
                      })
                    }
                  >
                    <SelectTrigger id={`${id}-${key}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {t(option.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
          <div className='space-y-4'>
            <div className='flex items-center gap-2'>
              <Checkbox
                id={`${id}-comments`}
                checked={draft.comments}
                disabled={disabled}
                onCheckedChange={(value) =>
                  setDraft({
                    ...draft,
                    comments: value === true,
                    replies: value === true && draft.replies,
                  })
                }
              />
              <Label htmlFor={`${id}-comments`}>{t('采集评论')}</Label>
              <span className='ml-auto text-caption text-muted-foreground'>
                {t('最多20条/篇')}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              <Checkbox
                id={`${id}-replies`}
                checked={draft.replies}
                disabled={disabled || !draft.comments}
                onCheckedChange={(value) =>
                  setDraft({ ...draft, replies: value === true })
                }
              />
              <Label htmlFor={`${id}-replies`}>{t('包含回复')}</Label>
              <span className='ml-auto text-caption text-muted-foreground'>
                {t('另取20条/篇')}
              </span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant='ghost'
            disabled={disabled}
            onClick={() =>
              setDraft({ filters: {}, comments: false, replies: false })
            }
          >
            {t('重置')}
          </Button>
          <Button
            disabled={disabled}
            onClick={() => {
              updateForm(draft)
              setOpen(false)
            }}
          >
            {t('应用')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
