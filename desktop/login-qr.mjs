import { inspectQr } from './qr-inspect.mjs'
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
export async function captureLoginQr(
  page,
  platform,
  refresh,
  active,
  options = {},
) {
  const contents = page.webContents
  const debuggerApi = contents.debugger
  let attached = false
  let metrics = false
  try {
    if (!active()) return { code: 'cancelled' }
    if (!refresh) {
      // 热页面通常已有二维码，直接读图不需要接管 debugger 或改变 viewport
      try {
        const ready = await bounded(
          contents.executeJavaScript(
            `(${inspectQr.toString()})(${JSON.stringify(qrSelectors[platform])}, false)`,
          ),
          500,
        )
        if (!active()) return { code: 'cancelled' }
        if (ready?.confirming) return { code: 'confirming' }
        if (ready?.expired) return { code: 'expired' }
        if (!ready && options.passive) return { code: 'pending' }
        if (
          ready?.image?.startsWith('data:image/png;base64,') &&
          ready.image.length <= 2_000_000
        )
          return { image: ready.image }
      } catch {
        // 页面正在跳转、跨域图片等仍走完整截图路径
      }
    }
    if (refresh) {
      // 自动刷新必须再次确认过期；扫码确认中连手动刷新也不执行
      const refreshed = await bounded(
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
          contents
            .executeJavaScript(
              `(${inspectQr.toString()})(${JSON.stringify(qrSelectors[platform])}, false, ${JSON.stringify({ refresh: options.expiredOnly ? 'expired' : 'manual' })})`,
            )
            .then(
              (result) => {
                if (!active() || !result?.reloading) {
                  cleanup()
                  resolve(result || { changed: true })
                }
              },
              (error) => {
                cleanup()
                reject(error)
              },
            )
        }),
        7000,
      )
      if (!active()) return { code: 'cancelled' }
      if (refreshed?.confirming) return { code: 'confirming' }
      if (refreshed?.changed) return { code: 'pending' }
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
    let clicks = 0
    let nextClick = 0
    while (active() && Date.now() < deadline) {
      let rect
      try {
        rect = await bounded(
          contents.executeJavaScript(
            `(${inspectQr.toString()})(${JSON.stringify(qrSelectors[platform])}, ${!options.passive && clicks < 3 && Date.now() >= nextClick})`,
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
      if (rect?.confirming) return { code: 'confirming' }
      if (rect?.expired) return { code: 'expired' }
      if (!rect && options.passive) return { code: 'pending' }
      if (
        rect?.image?.startsWith('data:image/png;base64,') &&
        rect.image.length <= 2_000_000
      )
        return { image: rect.image }
      if (rect?.clicked) {
        clicks++
        nextClick = Date.now() + 2000
      }
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
      if (options.passive) return { code: 'pending' }
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
