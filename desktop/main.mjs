import { app, BrowserWindow, ipcMain, dialog, shell, screen } from 'electron'
import { createServer } from 'node:net'
import { writeFile, mkdir, mkdtemp, readdir, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PlatformWindows } from './platform-windows.mjs'
import { SessionManager } from './session-manager.mjs'
import { StudioService } from './service.mjs'
import { isPlatformUrl, serializeResults } from './contracts.mjs'
import { StudioLogger, attachRendererLogs } from './logging/logger.mjs'
import { appIcon } from './app-icon.mjs'
import { installPlaybackHeaders } from './playback-headers.mjs'
import { CliInstall } from './cli-install.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
app.setName('MediaCrawler Studio')
if (app.isPackaged && !process.env.STUDIO_PYTHON) {
  process.env.STUDIO_PYTHON = path.join(
    process.resourcesPath,
    'studio-python',
    process.platform === 'win32' ? 'studio-python.exe' : 'studio-python',
  )
}
app.setPath(
  'userData',
  process.env.STUDIO_USER_DATA ||
    path.join(
      app.getPath('appData'),
      app.isPackaged ? 'mediacrawler-studio' : 'mediacrawler-studio-dev',
    ),
)
if (!app.requestSingleInstanceLock()) app.exit(0)
const logger = new StudioLogger(path.join(app.getPath('userData'), 'logs'))
process.on('uncaughtExceptionMonitor', (error) =>
  logger.write('error', 'main', 'uncaught', error),
)
logger.write('info', 'main', 'startup', {
  version: app.getVersion(),
  electron: process.versions.electron,
})

// CDP 仅供本机 Python 连接，端口随启动分配
const port = await new Promise((resolve) => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => {
    const selected = server.address().port
    server.close(() => resolve(selected))
  })
})
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
app.commandLine.appendSwitch('remote-debugging-port', String(port))
// ESM 入口不顶层等待 ready，避免模块初始化与 ready 互相等待
app
  .whenReady()
  .then(async () => {
    // 正式包使用 ICNS/系统图标处理，避免 PNG 覆盖应用包的 Dock 图标
    if (!app.isPackaged) app.dock?.setIcon(appIcon)
    const windows = new PlatformWindows()
    let mainWindow
    const service = new StudioService({
      // 子进程 cwd 必须是真实目录，不能使用打包后的 app.asar
      root: app.isPackaged ? app.getPath('userData') : root,
      logger,
      windows,
      dataDir: app.getPath('userData'),
      endpoint: `http://127.0.0.1:${port}`,
      onState: (state) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send('studio:state', state)
      },
    })
    windows.onChange = () => service.publish()
    windows.onDismiss = () => {
      void service.cancel()
    }
    await service.init()
    service.sessions = new SessionManager(service)

    function handle(channel, action) {
      ipcMain.handle(`studio:${channel}`, async (event, ...args) => {
        if (
          event.sender !== mainWindow.webContents ||
          event.senderFrame !== mainWindow.webContents.mainFrame
        )
          throw new Error('无效的请求来源')
        try {
          return await action(...args)
        } catch (error) {
          logger.write('error', 'ipc', channel, error)
          throw error
        }
      })
    }

    handle('open-logs', async () => {
      await mkdir(logger.directory, { recursive: true, mode: 0o700 })
      const error = await shell.openPath(logger.directory)
      if (error) throw new Error('无法打开日志目录')
    })
    handle('snapshot', () => service.state)
    const cliInstall = new CliInstall({
      packaged: app.isPackaged,
      resources: process.resourcesPath,
    })
    handle('cli-status', () => cliInstall.status())
    handle('cli-install', (action) => cliInstall.change(action))
    handle('start', (value) => service.start(value))
    handle('cancel', () => service.cancel())
    handle('resolve-video', (platform, id, requestId) =>
      service.resolveVideo(platform, id, requestId),
    )
    handle('cancel-video', (requestId) => service.cancelVideo(requestId))
    handle('clear-sessions', () => service.clearSessions())
    handle('logout', (platform) => {
      if (typeof platform !== 'string') throw new Error('不支持的平台')
      return service.clearSessions(platform)
    })
    let choosingDownload = false
    handle(
      'download-media',
      async (platform, id, kind, askBeforeDownload = false) => {
        service.mediaItem(platform, id, kind)
        if (choosingDownload) throw new Error('请先结束当前任务')
        choosingDownload = true
        let directory
        try {
          let destination = app.getPath('downloads')
          if (askBeforeDownload === true) {
            const selected = await dialog.showOpenDialog(mainWindow, {
              defaultPath: destination,
              properties: ['openDirectory', 'createDirectory'],
            })
            if (selected.canceled)
              return { saved: 0, total: 0, code: 'cancelled' }
            destination = selected.filePaths[0]
          }
          await mkdir(destination, { recursive: true })
          directory = await mkdtemp(path.join(destination, 'MediaCrawler-'))
          const result = await service.downloadMedia(
            platform,
            id,
            kind,
            directory,
          )
          return result
        } catch (error) {
          if (
            ['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'EROFS'].includes(
              error.code,
            )
          )
            return { saved: 0, total: 0, code: 'disk' }
          throw error
        } finally {
          choosingDownload = false
          if (directory) {
            try {
              if (!(await readdir(directory)).length) await rmdir(directory)
            } catch {
              /* 清理空目录失败不覆盖下载结果 */
            }
          }
        }
      },
    )
    handle('save-draft', (platform, form) => service.saveDraft(platform, form))
    handle('open-history', (id) => service.openHistory(id))
    handle('show-login', (mode) => {
      if (
        mode !== undefined &&
        !['embedded', 'window', 'qrcode'].includes(mode)
      )
        throw new Error('不支持的登录方式')
      if (service.state.task?.status === 'auth')
        windows.show(service.state.task.platform, mode)
    })
    handle('login-qr', (platform, refresh = false) => {
      if (typeof refresh !== 'boolean') throw new Error('不支持的操作')
      if (
        service.state.task?.status !== 'auth' ||
        service.state.task.platform !== platform
      )
        return { code: 'cancelled' }
      return windows.captureQr(platform, refresh)
    })
    handle('attach-login', (platform, bounds) =>
      windows.attachLogin(platform, bounds),
    )
    handle('detach-login', (platform) => {
      if (
        windows.presentation?.platform === platform &&
        windows.presentation.mode === 'embedded'
      )
        windows.windows.get(platform)?.hide()
    })
    handle('focus-login', () => {
      if (windows.presentation?.mode === 'embedded')
        windows.windows.get(windows.presentation.platform)?.webContents.focus()
    })
    handle('dismiss-login', () => service.dismissLogin())
    handle('open-source', (url) => {
      if (!isPlatformUrl(url)) throw new Error('不支持的来源链接')
      return shell.openExternal(url)
    })
    handle('export', async (format, platform, id) => {
      const items = service.resultsFor(platform, id)
      if (!['json', 'csv'].includes(format) || !items.length)
        throw new Error('暂无可导出的结果')
      const content = serializeResults(items, format)
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `采集结果-${new Date().toISOString().slice(0, 10)}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      })
      if (result.canceled) return false
      await writeFile(result.filePath, content, 'utf8')
      return true
    })

    function createWindow() {
      // 每次按鼠标所在屏幕的可用区域居中，不恢复上次窗口尺寸
      const { workArea } = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint(),
      )
      const width = Math.round(workArea.width * 0.8)
      const height = Math.round(workArea.height * 0.85)
      mainWindow = new BrowserWindow({
        width,
        height,
        x: workArea.x + Math.round((workArea.width - width) / 2),
        y: workArea.y + Math.round((workArea.height - height) / 2),
        minWidth: Math.min(860, width),
        minHeight: Math.min(640, height),
        backgroundColor: '#f8f7f3',
        title: 'MediaCrawler Studio',
        icon: appIcon,
        // macOS 原生红绿灯融入页面顶部，保留系统窗口行为
        ...(process.platform === 'darwin'
          ? {
              titleBarStyle: 'hiddenInset',
              trafficLightPosition: { x: 16, y: 24 },
            }
          : {}),
        webPreferences: {
          preload: path.join(root, 'desktop/preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      attachRendererLogs(mainWindow.webContents, logger)
      windows.setMainWindow(mainWindow)
      installPlaybackHeaders(mainWindow.webContents)
      mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      mainWindow.webContents.on('will-navigate', (event) =>
        event.preventDefault(),
      )
      if (process.env.STUDIO_DEV_URL)
        mainWindow.loadURL(process.env.STUDIO_DEV_URL)
      else mainWindow.loadFile(path.join(root, 'api/webui/index.html'))
    }
    createWindow()
    mainWindow.on('closed', () => app.quit())
    app.on('second-instance', () => {
      mainWindow.show()
      mainWindow.focus()
    })
    app.on('activate', () => {
      if (mainWindow.isDestroyed()) createWindow()
      else mainWindow.show()
    })
    void service.sessions.start()
    let quitting = false
    app.on('before-quit', (event) => {
      if (quitting) return
      event.preventDefault()
      quitting = true
      Promise.all([service.sessions.stopAll(), service.cancel()]).finally(
        async () => {
          await service.persistence.catch(() => {})
          windows.destroy()
          app.quit()
        },
      )
    })
    app.on('window-all-closed', () => app.quit())

    // 本地验收入口，不进入发布模式
    if (process.env.STUDIO_DEV_URL)
      console.log(`Studio CDP: http://127.0.0.1:${port}`)
  })
  .catch((error) => {
    logger.write('error', 'main', 'startup-failed', error)
    app.exit(1)
  })
