import { useTranslation } from 'react-i18next'
import { useEffect, useRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Dialog, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { openImagePreviewGroup } from './image-preview'
import type { ImagePreviewGroup } from './types'

// Radix 接管弹窗层级和焦点，PhotoSwipe 负责图片交互
export function PreviewDialog(props: PreviewDialogProps) {
  const { t } = useTranslation('studio')

  const trigger = useRef(document.activeElement as HTMLElement | null)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogPortal>
        <DialogPrimitive.Content
          className='fixed inset-0 z-50 outline-none'
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (props.onRestoreFocus) props.onRestoreFocus()
            else trigger.current?.focus()
          }}
        >
          <DialogTitle className='sr-only'>{t('图片预览')}</DialogTitle>
          <PreviewContent {...props} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}

function PreviewContent(props: PreviewDialogProps) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let disposed = false
    let preview: ReturnType<typeof openImagePreviewGroup>
    // StrictMode 的试挂载不创建第三方实例
    queueMicrotask(() => {
      if (disposed || !container.current) return
      preview = openImagePreviewGroup({
        ...props.group,
        container: container.current,
        onClose: props.onClose,
        onIndexChange: props.onIndexChange,
      })
    })
    return () => {
      disposed = true
      if (!preview || preview.isDestroying) return
      preview.off('close', props.onClose)
      const destroy = () => preview?.destroy()
      // 图片解码中的 PhotoSwipe 尚不能 close，打开结束后立即清理
      if (preview.opener.isOpen) destroy()
      else preview.on('openingAnimationEnd', destroy)
    }
  }, [props.group, props.onClose, props.onIndexChange])
  return <div ref={container} className='size-full' />
}

export type PreviewDialogProps = {
  group: ImagePreviewGroup
  onRestoreFocus?: () => void
  onClose: () => void
  onIndexChange: (index: number) => void
}
