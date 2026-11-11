import { session } from 'electron'
import { platforms } from './contracts.mjs'
import { PlatformPage } from './platform-page.mjs'
import { captureLoginQr } from './login-qr.mjs'

// 独立持久化会话，平台页面不加载产品 preload
export class PlatformWindows {
  windows = new Map()
  mainWindow = null
  presentation = null
  bounds = null
  qrCapture = null
  backgroundCaptures = new Map()
  preparing = new Map()
  // 每个平台页面最后一次被用到的时间，空闲久了由 service 释放
  used = new Map()
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

  // 应用界面和各平台页面的网络缓存，不含 Cookie 等登录数据
  cacheSessions() {
    return [
      session.defaultSession,
      ...Object.keys(platforms).map((platform) => this.getSession(platform)),
    ]
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

  // 详情、评论、字幕这些只读任务不占平台互斥，同一平台可能同时来几次；
  // 排队进行，避免两个调用同时建页或同时 attach debugger
  prepare(platform, signal) {
    const next = (this.preparing.get(platform) || Promise.resolve())
      .catch(() => {})
      .then(() => this.prepareNow(platform, signal))
    this.preparing.set(platform, next)
    const clear = () => {
      if (this.preparing.get(platform) === next) this.preparing.delete(platform)
    }
    next.then(clear, clear)
    return next
  }

  async prepareNow(platform, signal) {
    this.touch(platform)
    // 上次取码可能仍在释放 debugger，重试不能抢占同一调试会话
    if (this.qrCapture?.presentation.platform === platform)
      await this.qrCapture.promise.catch(() => {})
    if (this.backgroundCaptures.has(platform))
      await this.backgroundCaptures.get(platform).catch(() => {})
    signal?.throwIfAborted()
    let win = this.windows.get(platform)
    if (!win || win.isDestroyed()) {
      win = new PlatformPage(platform, () => this.dismiss(platform))
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

  touch(platform, now = Date.now()) {
    this.used.set(platform, now)
  }

  // 开着的平台页面和它们最后被用到的时间
  openPages() {
    return [...this.windows.entries()]
      .filter(([, win]) => !win.isDestroyed())
      .map(([platform]) => ({ platform, usedAt: this.used.get(platform) ?? 0 }))
  }

  // 正在给用户看、正在取码或正在准备的页面不能关
  inUse(platform) {
    return (
      this.presentation?.platform === platform ||
      this.qrCapture?.presentation.platform === platform ||
      this.backgroundCaptures.has(platform) ||
      this.preparing.has(platform)
    )
  }

  // 关掉页面省内存，登录态在分区里不受影响；下次用时 prepare 重新建页
  release(platform) {
    if (this.inUse(platform)) return false
    const win = this.windows.get(platform)
    if (!win) return false
    win.destroy()
    this.windows.delete(platform)
    this.used.delete(platform)
    return true
  }

  beginLogin(platform, mode = 'embedded') {
    if (this.presentation) this.windows.get(this.presentation.platform)?.hide()
    this.presentation = { platform, mode, preparing: true }
    this.bounds = null
    this.onChange()
  }

  show(platform, mode = 'embedded') {
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

  async captureBackgroundQr(platform, refresh, active, options) {
    if (this.backgroundCaptures.has(platform))
      return this.backgroundCaptures.get(platform)
    const page = this.windows.get(platform)
    if (!page || page.isDestroyed() || !active()) return { code: 'cancelled' }
    const promise = captureLoginQr(
      page,
      platform,
      refresh,
      () => active() && !page.isDestroyed(),
      options,
    )
    this.backgroundCaptures.set(platform, promise)
    try {
      return await promise
    } finally {
      if (this.backgroundCaptures.get(platform) === promise)
        this.backgroundCaptures.delete(platform)
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

  dismiss(platform = this.presentation?.platform) {
    if (!platform || this.presentation?.platform !== platform) return
    this.hide(platform)
    this.onDismiss(platform)
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
      this.used.delete(id)
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
