import { t } from '@/i18n/studio'
// 复用 tobe-lab 的 PhotoSwipe 组图预览与带动画导航
import PhotoSwipe from 'photoswipe'
import 'photoswipe/style.css'
import type {
  ImagePreviewDirection,
  ImagePreviewGroup,
  ImagePreviewItem,
  ImagePreviewSize,
  ImagePreviewZoomContext,
  PhotoSwipeSlideData,
} from './types'

export const imagePreviewFallbackSize: ImagePreviewSize = {
  height: 720,
  width: 1280,
}

const maxInitialUpscale = 1.5

// 单图预览
export function openImagePreview(item: ImagePreviewItem) {
  openImagePreviewGroup({
    items: [item],
  })
}

// 组图预览
export function openImagePreviewGroup(group: ImagePreviewGroup) {
  return new ImagePreviewSession(group).open()
}

// PhotoSwipe 预览会话
class ImagePreviewSession {
  private readonly index: number
  private readonly items: ImagePreviewItem[]

  constructor(private readonly group: ImagePreviewGroup) {
    this.items = group.items.filter((item) => item.src)
    this.index = this.clampIndex(group.index ?? 0)
  }

  // 初始化 PhotoSwipe 实例
  open() {
    if (this.items.length === 0) {
      return
    }

    const preview = new PhotoSwipe({
      appendToEl: this.group.container,
      trapFocus: false,
      returnFocus: false,
      escKey: false,
      errorMsg: t('图片暂时无法加载'),
      arrowNext: false,
      arrowPrev: false,
      bgOpacity: 0.86,
      closeTitle: t('关闭图片'),
      dataSource: this.items.map((item) => this.createSlide(item)),
      index: this.index,
      initialZoomLevel: this.initialZoom,
      maxZoomLevel: this.maxZoom,
      padding: {
        bottom: 24,
        left: 24,
        right: 24,
        top: 24,
      },
      secondaryZoomLevel: this.secondaryZoom,
      showHideAnimationType: 'fade',
      showAnimationDuration: 0,
      hideAnimationDuration: 0,
      zoomTitle: t('缩放图片'),
    })

    this.setupNav(preview)
    preview.on('afterInit', () => {
      // 弹窗语义由外层 Radix 提供，避免嵌套两个 modal
      preview.element?.removeAttribute('role')
      preview.element?.removeAttribute('aria-modal')
    })
    // 远程图片不带尺寸时，加载后用真实比例更新当前 Slide
    preview.on('contentLoadImage', ({ content }) => {
      if (content.element instanceof HTMLImageElement)
        content.element.referrerPolicy = 'no-referrer'
    })
    preview.on('loadComplete', ({ content, isError }) => {
      const img = content.element
      if (isError || !(img instanceof HTMLImageElement) || !img.naturalWidth)
        return
      if (
        content.data.width === img.naturalWidth &&
        content.data.height === img.naturalHeight
      )
        return
      content.data.width = img.naturalWidth
      content.data.height = img.naturalHeight
      queueMicrotask(() => {
        if (preview.isOpen && !preview.isDestroying)
          preview.refreshSlideContent(content.index)
      })
    })
    preview.on('change', () => this.group.onIndexChange?.(preview.currIndex))
    if (this.group.onClose) preview.on('close', this.group.onClose)
    preview.init()
    return preview
  }

  // Slide 尺寸模型
  private createSlide(item: ImagePreviewItem): PhotoSwipeSlideData {
    return {
      alt: item.alt,
      element: item.element,
      height: item.height || imagePreviewFallbackSize.height,
      msrc: item.msrc,
      src: item.src,
      srcset: item.srcset,
      thumbCropped: item.thumbCropped,
      width: item.width || imagePreviewFallbackSize.width,
    }
  }

  // 自定义导航
  private setupNav(preview: PhotoSwipe) {
    // PhotoSwipe 默认箭头没有 swipe 动画，这里统一走 moveIndexBy(..., true)
    preview.on('uiRegister', () => {
      preview.ui?.registerElement(this.createArrow('prev'))
      preview.ui?.registerElement(this.createArrow('next'))
    })

    preview.on('keydown', (event) => {
      const originalEvent = event.originalEvent

      if (
        originalEvent.key !== 'ArrowLeft' &&
        originalEvent.key !== 'ArrowRight'
      ) {
        return
      }

      if (
        originalEvent.metaKey ||
        originalEvent.ctrlKey ||
        originalEvent.altKey ||
        originalEvent.shiftKey
      ) {
        return
      }

      originalEvent.preventDefault()
      event.preventDefault()
      this.move(preview, originalEvent.key === 'ArrowRight' ? 1 : -1)
    })
  }

  // 箭头 UI 注册
  private createArrow(direction: ImagePreviewDirection) {
    const isNext = direction === 'next'

    return {
      appendTo: 'wrapper' as const,
      ariaLabel: isNext ? t('下一张图片') : t('上一张图片'),
      className: `pswp__button--arrow--${direction}`,
      html: {
        inner: isNext
          ? '<use xlink:href="#pswp__icn-arrow"/>'
          : '<path d="M29 43l-3 3-16-16 16-16 3 3-13 13 13 13z" id="pswp__icn-arrow"/>',
        isCustomSVG: true,
        outlineID: 'pswp__icn-arrow',
        size: 60,
      },
      isButton: true,
      name: `animatedArrow${isNext ? 'Next' : 'Prev'}`,
      onClick: (
        _event: MouseEvent,
        _element: HTMLElement,
        preview: PhotoSwipe,
      ) => this.move(preview, isNext ? 1 : -1),
      onInit: (element: HTMLElement, preview: PhotoSwipe) => {
        element.classList.add('pswp__button--arrow')
        element.setAttribute('aria-controls', 'pswp__items')
        preview.on('change', () => this.updateArrow(element, preview, isNext))
        this.updateArrow(element, preview, isNext)
      },
      order: isNext ? 11 : 10,
      title: isNext ? t('下一张图片') : t('上一张图片'),
    }
  }

  // 带动画切换
  private move(preview: PhotoSwipe, diff: number) {
    if (preview.getNumItems() <= 1) {
      return
    }

    preview.mainScroll.moveIndexBy(diff, true)
  }

  // 边界箭头状态
  private updateArrow(
    element: HTMLElement,
    preview: PhotoSwipe,
    isNext: boolean,
  ) {
    const count = preview.getNumItems()
    const canLoop = Boolean(preview.options.loop && count > 2)

    // PhotoSwipe 只有 3 张及以上才循环，1/2 张边界直接隐藏箭头
    if (count <= 1) {
      element.hidden = true
      return
    }

    if (canLoop) {
      element.hidden = false
      return
    }

    element.hidden = isNext
      ? preview.currIndex >= count - 1
      : preview.currIndex <= 0
  }

  // 初始缩放
  private initialZoom = (ctx: ImagePreviewZoomContext) =>
    this.containZoom(ctx, maxInitialUpscale)

  // 二次缩放
  private secondaryZoom = (ctx: ImagePreviewZoomContext) =>
    Math.max(1, this.containZoom(ctx, 2.5))

  // 最大缩放
  private maxZoom = (ctx: ImagePreviewZoomContext) =>
    Math.max(1, this.containZoom(ctx, 3))

  // contain 初始缩放
  private containZoom(ctx: ImagePreviewZoomContext, maxUpscale: number) {
    if (!ctx.elementSize || !ctx.panAreaSize) {
      return ctx.fit
    }

    const xRatio = ctx.panAreaSize.x / ctx.elementSize.x
    const yRatio = ctx.panAreaSize.y / ctx.elementSize.y

    return Math.min(maxUpscale, xRatio, yRatio)
  }

  // 初始索引边界
  private clampIndex(index: number) {
    return Math.min(Math.max(index, 0), Math.max(this.items.length - 1, 0))
  }
}
