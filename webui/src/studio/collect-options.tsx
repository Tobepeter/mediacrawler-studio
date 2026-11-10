import { useTranslation } from 'react-i18next'
import { useId, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import searchOptions from '../../../desktop/search-options.json'
import { IconButton } from '@/components/common/icon-button'
import { Button } from '@/components/ui/button'
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

// 平台原生筛选，应用后仅影响下一次采集；没有可选项的模式不显示入口
export function CollectOptions({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation('studio')
  const form = useForm()
  const updateForm = useStudio((state) => state.updateForm)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({
    filters: form.filters || {},
  })
  const fields: Record<string, SearchField> =
    form.mode === 'search' ? searchOptions[form.platform] : {}
  const changed = Object.entries(fields).some(
    ([key, field]) => (form.filters?.[key] || field.default) !== field.default,
  )
  const id = useId()
  if (!Object.keys(fields).length) return null
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value)
          setDraft({
            filters: form.filters || {},
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
        </div>
        <DialogFooter>
          <Button
            variant='ghost'
            disabled={disabled}
            onClick={() => setDraft({ filters: {} })}
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
