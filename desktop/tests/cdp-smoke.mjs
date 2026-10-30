import { app } from 'electron'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { PlatformWindows } from '../platform-windows.mjs'

app.setPath('userData', path.resolve('.temp/data/cdp-smoke'))
const restore = process.argv.includes('--restore')
mkdirSync('.temp/data', { recursive: true })
const previousPort = restore
  ? Number(readFileSync('.temp/data/cdp-smoke-port', 'utf8'))
  : 0
const server = createServer((_req, res) => {
  res.end('<title>session probe</title>')
})
await new Promise((resolve) =>
  server.listen(previousPort, '127.0.0.1', resolve),
)
writeFileSync('.temp/data/cdp-smoke-port', String(server.address().port))
const origin = `http://127.0.0.1:${server.address().port}`
const socket = createServer()
await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve))
const port = socket.address().port
await new Promise((resolve) => socket.close(resolve))
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
app.commandLine.appendSwitch('remote-debugging-port', String(port))
app
  .whenReady()
  .then(async () => {
    const windows = new PlatformWindows()
    try {
      const targets = {}
      for (const platform of ['bili', 'dy']) {
        targets[platform] = await windows.prepare(platform)
        const win = windows.windows.get(platform)
        await win.loadURL(origin)
        await windows
          .getSession(platform)
          .cookies.set({ url: origin, name: 'studio_test', value: platform })
        await win.webContents.executeJavaScript(
          `localStorage.setItem('studio_test', '${platform}')`,
        )
        if (!win.webContents.isAudioMuted())
          throw new Error('platform audio is not muted')
        const prefs = win.webContents.getLastWebPreferences()
        if (!prefs.sandbox || prefs.nodeIntegration || prefs.preload)
          throw new Error('unsafe platform preferences')
      }
      // 回归：切到独立登录窗口并隐藏后，不能留下阻塞 CDP 初始化的空页面
      windows.show('dy', 'window')
      windows.hide('dy')
      const targetsAfterWindow = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json()
      if (
        targetsAfterWindow.some(
          (target) => target.type === 'page' && !target.url,
        )
      )
        throw new Error('uninitialized host page blocks CDP')
      const child = spawn(
        path.resolve('.venv/bin/python'),
        ['-m', 'desktop.tests.cdp-probe'],
        {
          stdio: ['pipe', 'inherit', 'inherit'],
        },
      )
      child.stdin.end(
        JSON.stringify({
          endpoint: `http://127.0.0.1:${port}`,
          targets,
          origin,
        }),
      )
      const code = await new Promise((resolve) => child.on('exit', resolve))
      if (code !== 0) throw new Error(`probe failed ${code}`)
      console.log('Electron CDP / partition / mute / isolation: PASS')
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      windows.destroy()
      server.close()
      app.exit(process.exitCode || 0)
    }
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
