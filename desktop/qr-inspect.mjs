/* global document, getComputedStyle, HTMLImageElement, HTMLCanvasElement, scrollX, scrollY, location */
// 页面内只读状态探测；确认态优先，过期刷新须同轮复核
export function inspectQr(selector, openLogin, options = {}) {
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
  const nodes = [...document.querySelectorAll(selector)]
  const regions = new Set()
  for (const node of nodes) {
    let parent = node.parentElement
    for (
      let depth = 0;
      parent && depth < 3;
      depth++, parent = parent.parentElement
    ) {
      if (parent === document.body || parent === document.documentElement) break
      if (visible(parent) && (parent.innerText || '').length < 1000)
        regions.add(parent)
    }
  }
  // 扫码后二维码可能被移除，只检查可见登录/二维码区域，不扫描整页正文
  for (const region of document.querySelectorAll(
    '[role="dialog"], [class*="qrcode"], [class*="Qrcode"], [class*="QRCode"], .login-scan-box',
  )) {
    if (visible(region) && (region.innerText || '').length < 1000)
      regions.add(region)
  }
  const text = [...regions].map((node) => node.innerText || '').join('\n')
  if (
    /扫码成功|扫描成功|已扫码|已扫描|请在(?:手机|客户端|APP|App).{0,12}(?:确认|授权)|等待.{0,6}确认/.test(
      text,
    )
  )
    return { confirming: true }
  const expired = /二维码.{0,6}(失效|过期)|(失效|过期).{0,6}二维码/.test(text)
  // 检测与刷新在同一次页面脚本内执行，避免两次检查之间进入确认态
  if (options.refresh) {
    if (expired || options.refresh === 'manual') {
      location.reload()
      return { reloading: true }
    }
    return { changed: true }
  }
  if (expired) return { expired: true }
  for (const node of nodes) {
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
    const entry = [
      ...document.querySelectorAll(
        'button, a, p, span, .header-avatar-unlogin-entry, .login-btn',
      ),
    ].find(
      (node) =>
        visible(node) &&
        /^(登录|立即登录|登录\/注册|扫码登录)$/.test(
          node.textContent.replace(/\s+/g, ''),
        ),
    )
    entry?.click()
    return { clicked: !!entry }
  }
  return null
}
