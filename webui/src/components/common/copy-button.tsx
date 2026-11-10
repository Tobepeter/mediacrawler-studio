import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@/components/common/icon-button'

const copiedMs = 1500

// 复制后短暂显示对号，这段时间内重复点击不再写剪贴板
export function CopyButton(props: {
  text: string
  label?: string
  className?: string
}) {
  const { t } = useTranslation('studio')
  const [copied, setCopied] = useState(false)
  const locked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    if (locked.current) return
    locked.current = true
    try {
      await navigator.clipboard.writeText(props.text)
      setCopied(true)
      timer.current = setTimeout(() => {
        locked.current = false
        setCopied(false)
      }, copiedMs)
    } catch {
      locked.current = false
      toast.error(t('复制失败，请重试'))
    }
  }
  return (
    <IconButton
      variant='ghost'
      className={props.className}
      label={copied ? t('已复制') : props.label || t('复制')}
      onClick={() => void copy()}
    >
      {copied ? <Check /> : <Copy />}
    </IconButton>
  )
}
