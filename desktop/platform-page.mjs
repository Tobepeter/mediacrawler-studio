import { BaseWindow, WebContentsView } from 'electron'
import { platforms } from './contracts.mjs'
import { appIcon } from './app-icon.mjs'

// 同一平台页在主窗口和独立窗口之间移动，不更换会话或 CDP target
export class PlatformPage {
  host = null
  parent = null

  constructor(platform, onDismiss) {
    this.platform = platform
    this.onDismiss = onDismiss
    this.view = new WebContentsView({
      webPreferences: {
        partition: `persist:studio-${platform}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    this.view.setBounds({ x: 0, y: 0, width: 1060, height: 780 })
    this.view.setVisible(false)
    const contents = this.webContents
    contents.setAudioMuted(true)
    contents.setUserAgent(
      contents
        .getUserAgent()
        .replace(/ Electron\/\S+/, '')
        .replace(/ MediaCrawlerStudio\/\S+/, ''),
    )
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith('https://')) event.preventDefault()
    })
    contents.on('before-input-event', (event, input) => {
      if (
        input.type === 'keyDown' &&
        input.key === 'Escape' &&
        this.view.getVisible()
      ) {
        event.preventDefault()
        this.onDismiss()
      }
    })
  }

  get webContents() {
    return this.view.webContents
  }
  isDestroyed() {
    return this.webContents.isDestroyed()
  }
  loadURL(url) {
    return this.webContents.loadURL(url)
  }

  mount(parent, bounds) {
    if (this.parent !== parent) {
      if (this.parent && !this.parent.isDestroyed())
        this.parent.contentView.removeChildView(this.view)
      parent.contentView.addChildView(this.view)
      this.parent = parent
    }
    this.view.setBounds(bounds)
    this.view.setVisible(true)
  }

  embed(parent, bounds) {
    this.host?.hide()
    this.view.setBorderRadius(8)
    this.mount(parent, bounds)
  }

  showWindow(parent) {
    if (!this.host || this.host.isDestroyed()) {
      // 这里只承载已有视图，BrowserWindow 会额外生成未加载的 CDP 页面
      // Playwright 连接时等待所有页面初始化，该空页面会阻塞整个连接
      this.host = new BaseWindow({
        width: 1060,
        height: 780,
        show: false,
        parent,
        title: `${platforms[this.platform].name} · 登录与验证`,
        icon: appIcon,
        autoHideMenuBar: true,
      })
      this.host.on('resize', () => {
        if (this.parent === this.host) {
          const [width, height] = this.host.getContentSize()
          this.view.setBounds({ x: 0, y: 0, width, height })
        }
      })
      this.host.on('close', (event) => {
        event.preventDefault()
        this.onDismiss()
      })
    }
    const [width, height] = this.host.getContentSize()
    this.view.setBorderRadius(0)
    this.mount(this.host, { x: 0, y: 0, width, height })
    this.host.show()
    this.webContents.focus()
  }

  hide() {
    this.view.setVisible(false)
    this.host?.hide()
  }

  destroy() {
    if (this.parent && !this.parent.isDestroyed())
      this.parent.contentView.removeChildView(this.view)
    if (!this.isDestroyed())
      this.webContents.close({ waitForBeforeUnload: false })
    this.host?.destroy()
    this.parent = null
  }
}
