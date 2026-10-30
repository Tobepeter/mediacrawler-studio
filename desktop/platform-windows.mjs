import { session } from 'electron'
import { platforms } from './contracts.mjs'
import { PlatformPage } from './platform-page.mjs'
import { captureLoginQr } from './login-qr.mjs'

// 独立持久化会话，平台页面不加载产品 preload
export class PlatformWindows {
  windows = new Map()
  mainWindow = null
  loginMode = 'embedded'
  presentation = null
  bounds = null
  qrCapture = null
  onChange = () => {}
  onDismiss = () => {}

  setMainWindow(window) {
    this.mainWindow = window
    window.on('resize', () => {
      if (this.presentation?.mode === 'embedded' && this.bounds)
        this.attachLogin(this.presentation.platform, this.bounds)
    })
    // 页面重载时撤下原生层，待新弹层报尺寸后恢复，避免留下不可关闭的视图
    window.webContents.on('did-start-loading', () => {
      if (this.presentation?.mode === 'embedded')
        this.windows.get(this.presentation.platform)?.hide()
    })
  }

  getSession(platform) {
    return session.fromPartition(`persist:studio-${platform}`)
  }

  async accounts() {
    const entries = await Promise.all(
      Object.entries(platforms).map(async ([id, config]) => {
        const cookies = (
          await Promise.all(
            (config.cookieUrls || [config.url]).map((url) =>
              this.getSession(id).cookies.get({ url, name: config.cookie }),
            ),
          )
        ).flat()
        return [id, cookies.length ? 'saved' : 'unknown']
      }),
    )
    return Object.fromEntries(entries)
  }

  async prepare(platform, signal) {
    // 上次取码可能仍在释放 debugger，重试不能抢占同一调试会话
    if (this.qrCapture) await this.qrCapture.promise.catch(() => {})
    signal?.throwIfAborted()
    let win = this.windows.get(platform)
    if (!win || win.isDestroyed()) {
      win = new PlatformPage(platform, () => this.dismiss())
      this.getSession(platform).setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      )
      this.windows.set(platform, win)
      await win.loadURL(`data:text/html,<title>studio-${platform}</title>`)
    }
    signal?.throwIfAborted()
    win.webContents.debugger.attach('1.3')
    try {
      const { targetInfo } = await win.webContents.debugger.sendCommand(
        'Target.getTargetInfo',
      )
      return targetInfo.targetId
    } finally {
      win.webContents.debugger.detach()
    }
  }

  beginLogin(platform) {
    if (this.presentation) this.windows.get(this.presentation.platform)?.hide()
    this.presentation = { platform, mode: this.loginMode, preparing: true }
    this.bounds = null
    this.onChange()
  }

  show(platform, mode = this.loginMode) {
    const page = this.windows.get(platform)
    if (!page || page.isDestroyed()) return
    if (this.presentation) this.windows.get(this.presentation.platform)?.hide()
    this.presentation = { platform, mode }
    this.bounds = null
    if (mode === 'window') page.showWindow(this.mainWindow)
    this.onChange()
  }

  attachLogin(platform, bounds) {
    if (
      this.presentation?.platform !== platform ||
      this.presentation.mode !== 'embedded' ||
      this.presentation.preparing ||
      !this.mainWindow ||
      this.mainWindow.isDestroyed()
    )
      return false
    if (
      !bounds ||
      !['x', 'y', 'width', 'height'].every((key) =>
        Number.isFinite(bounds[key]),
      )
    )
      return false
    const [width, height] = this.mainWindow.getContentSize()
    const zoom = this.mainWindow.webContents.getZoomFactor()
    const x = Math.max(0, Math.min(width, Math.round(bounds.x * zoom)))
    const y = Math.max(0, Math.min(height, Math.round(bounds.y * zoom)))
    const rect = {
      x,
      y,
      width: Math.min(width - x, Math.round(bounds.width * zoom)),
      height: Math.min(height - y, Math.round(bounds.height * zoom)),
    }
    if (rect.width < 1 || rect.height < 1) return false
    const page = this.windows.get(platform)
    if (!page || page.isDestroyed()) return false
    this.bounds = bounds
    page.embed(this.mainWindow, rect)
    return true
  }

  async captureQr(platform, refresh) {
    const presentation = this.presentation
    const page = this.windows.get(platform)
    if (
      presentation?.platform !== platform ||
      presentation.mode !== 'qrcode' ||
      presentation.preparing ||
      !page ||
      page.isDestroyed()
    )
      return { code: 'cancelled' }
    if (this.qrCapture) {
      if (this.qrCapture.presentation === presentation)
        return this.qrCapture.promise
      await this.qrCapture.promise
      if (this.presentation !== presentation) return { code: 'cancelled' }
      return this.captureQr(platform, refresh)
    }
    const operation = { presentation }
    this.qrCapture = operation
    try {
      operation.promise = captureLoginQr(
        page,
        platform,
        refresh,
        () => this.presentation === presentation && !page.isDestroyed(),
      )
      return await operation.promise
    } finally {
      if (this.qrCapture === operation) this.qrCapture = null
    }
  }

  hide(platform) {
    this.windows.get(platform)?.hide()
    if (this.presentation?.platform === platform) {
      this.presentation = null
      this.bounds = null
      if (this.mainWindow && !this.mainWindow.isDestroyed())
        this.mainWindow.webContents.focus()
      this.onChange()
    }
  }

  dismiss() {
    if (!this.presentation) return
    this.hide(this.presentation.platform)
    this.onDismiss()
  }
  async flush(platform) {
    await this.getSession(platform).cookies.flushStore()
  }
  async clearSessions(platform) {
    // 先关闭目标平台页，避免页面在清理期间重新写入会话
    const targets = platform === undefined ? Object.keys(platforms) : [platform]
    for (const id of targets) {
      if (this.presentation?.platform === id) this.hide(id)
      this.windows.get(id)?.destroy()
      this.windows.delete(id)
    }
    const results = await Promise.allSettled(
      targets.map(async (platform) => {
        const ses = this.getSession(platform)
        await ses.closeAllConnections()
        await ses.clearStorageData()
        await ses.clearAuthCache()
        await ses.clearCache()
        await ses.cookies.flushStore()
      }),
    )
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('部分登录态清除失败，请重试')
  }
  destroy() {
    this.presentation = null
    for (const win of this.windows.values()) win.destroy()
    this.windows.clear()
  }
}
