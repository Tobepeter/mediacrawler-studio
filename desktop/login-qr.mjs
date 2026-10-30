/* global document, getComputedStyle, HTMLImageElement, HTMLCanvasElement, scrollX, scrollY */
// 复用上游 login.py 的二维码定位；不读取或返回 Cookie/账号凭据
export const qrSelectors = {
  bili: '.login-scan-box img',
  dy: '#animate_qrcode_container img',
  xhs: 'img.qrcode-img',
  zhihu: 'canvas.Qrcode-qrcode',
  wb: '[class*="qrcode"] img, [class*="QRCode"] img, img.w-full.h-full',
  tieba: 'img.tang-pass-qrcode-img',
  ks: '.qrcode-img img',
}

function inspectQr(selector, openLogin) {
  const visible = (node) => {
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    )
  }
  for (const node of document.querySelectorAll(selector)) {
    if (!visible(node)) continue
    const rect = node.getBoundingClientRect()
    if (
      rect.width < 80 ||
      rect.height < 80 ||
      rect.width > 600 ||
      rect.height > 600
    )
      continue
    if (
      node instanceof HTMLImageElement &&
      (!node.complete || !node.naturalWidth)
    )
      continue
    const hint = node.parentElement?.innerText || ''
    if (/二维码.{0,6}(失效|过期)|(失效|过期).{0,6}二维码/.test(hint))
      return { expired: true }
    try {
      const canvas =
        node instanceof HTMLCanvasElement
          ? node
          : document.createElement('canvas')
      if (node instanceof HTMLImageElement) {
        canvas.width = node.naturalWidth
        canvas.height = node.naturalHeight
        canvas.getContext('2d').drawImage(node, 0, 0)
      }
      return { image: canvas.toDataURL('image/png') }
    } catch {
      /* 跨域图片从浏览器已加载的资源读取，不另发网络请求 */
    }
    return {
      src: node.currentSrc || node.src,
      x: rect.x + scrollX,
      y: rect.y + scrollY,
      width: rect.width,
      height: rect.height,
    }
  }
  if (openLogin) {
    const entry = [...document.querySelectorAll('button, a, p, span')].find(
      (node) =>
        visible(node) &&
        /^(登录|登录\/注册|扫码登录)$/.test(node.textContent.trim()),
    )
    entry?.click()
    return { clicked: !!entry }
  }
  return null
}

function bounded(promise, ms = 4000) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('qr timeout')), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

// capturePage 在未挂载视图上没有显示 surface；CDP 支持隐藏页面的区域截图
export async function captureLoginQr(page, platform, refresh, active) {
  const contents = page.webContents
  const debuggerApi = contents.debugger
  let attached = false
  let metrics = false
  try {
    if (!active()) return { code: 'cancelled' }
    if (refresh) {
      // 重新加载同一平台页生成新码，不清会话；自动检查只截图，不打断扫码
      await bounded(
        new Promise((resolve, reject) => {
          const ready = () => {
            cleanup()
            resolve()
          }
          const failed = (_event, code, _description, _url, isMainFrame) => {
            if (isMainFrame && code !== -3) {
              cleanup()
              reject(new Error('navigation failed'))
            }
          }
          const timer = setTimeout(() => {
            cleanup()
            reject(new Error('navigation timeout'))
          }, 6000)
          const cleanup = () => {
            clearTimeout(timer)
            contents.removeListener('dom-ready', ready)
            contents.removeListener('did-fail-load', failed)
          }
          contents.once('dom-ready', ready)
          contents.on('did-fail-load', failed)
          contents.reload()
        }),
        7000,
      )
    }
    if (!active()) return { code: 'cancelled' }
    debuggerApi.attach('1.3')
    attached = true
    await bounded(
      debuggerApi.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: 1060,
        height: 780,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    )
    metrics = true
    // 登录框点击成功不等于二维码已生成，SPA 跳转也会短暂销毁 JS 上下文
    const deadline = Date.now() + 20000
    let clicked = false
    while (active() && Date.now() < deadline) {
      let rect
      try {
        rect = await bounded(
          contents.executeJavaScript(
            `(${inspectQr.toString()})(${JSON.stringify(qrSelectors[platform])}, ${!clicked})`,
          ),
        )
      } catch (error) {
        if (
          !/context.*(destroyed|specified|found)|navigation/i.test(
            error.message,
          )
        )
          throw error
        await new Promise((resolve) => setTimeout(resolve, 300))
        continue
      }
      if (!active()) return { code: 'cancelled' }
      if (rect?.expired) return { code: 'expired' }
      if (
        rect?.image?.startsWith('data:image/png;base64,') &&
        rect.image.length <= 2_000_000
      )
        return { image: rect.image }
      if (rect?.clicked) clicked = true
      if (rect?.width) {
        if (rect.src) {
          try {
            const { frameTree } = await bounded(
              debuggerApi.sendCommand('Page.getResourceTree'),
            )
            const resource = await bounded(
              debuggerApi.sendCommand('Page.getResourceContent', {
                frameId: frameTree.frame.id,
                url: rect.src,
              }),
            )
            const bytes = Buffer.from(
              resource.content,
              resource.base64Encoded ? 'base64' : 'utf8',
            )
            const mime = bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              ? 'image/png'
              : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
                ? 'image/jpeg'
                : null
            if (mime && bytes.length <= 1_500_000 && active())
              return {
                image: `data:${mime};base64,${bytes.toString('base64')}`,
              }
          } catch {
            /* 缓存不可读时再尝试区域截图 */
          }
        }
        const { x, y, width, height } = rect
        const result = await bounded(
          debuggerApi.sendCommand('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x, y, width, height, scale: 1 },
          }),
        )
        if (!active()) return { code: 'cancelled' }
        if (!result.data || result.data.length > 2_000_000)
          return { code: 'unavailable' }
        return { image: `data:image/png;base64,${result.data}` }
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    return { code: active() ? 'unavailable' : 'cancelled' }
  } catch {
    return { code: active() ? 'unavailable' : 'cancelled' }
  } finally {
    if (attached && !contents.isDestroyed()) {
      if (metrics)
        await bounded(
          debuggerApi.sendCommand('Emulation.clearDeviceMetricsOverride'),
        ).catch(() => {})
      debuggerApi.detach()
    }
  }
}
