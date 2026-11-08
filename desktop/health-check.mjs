import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { platforms } from './contracts.mjs'

// 手动全量检查：独立内存分区，单次执行，有限生命周期
export class HealthCheck {
  pending = null
  child = null
  views = []
  closed = false
  abortRun = null

  constructor(service, createView, spawnProcess = spawn) {
    this.service = service
    this.createView = createView
    this.spawnProcess = spawnProcess
  }

  run() {
    if (this.closed) return Promise.reject(new Error('检查已停止'))
    if (!this.pending)
      this.pending = this.perform().finally(() => {
        this.pending = null
      })
    return this.pending
  }

  progress(stage, completed = 0) {
    if (!this.service.state) return
    this.service.state.healthCheck = {
      stage,
      completed,
      total: Object.keys(platforms).length,
    }
    this.service.publish()
  }

  async perform() {
    const reports = new Map()
    const sessions = new Set()
    let ended = false
    let network
    let failure = { code: 'UNKNOWN', stage: 'worker' }
    let timer
    let lines
    this.progress('network')
    const cancelled = new Promise((_, reject) => {
      this.abortRun = () => reject(new Error('检查已停止'))
    })
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        failure = { code: 'TIMEOUT', stage: 'worker' }
        this.child?.kill('SIGKILL')
        reject(new Error('检查超时'))
      }, 140000)
    })
    const work = async () => {
      const targets = {}
      for (const platform of Object.keys(platforms)) {
        if (this.closed || ended) throw new Error('检查已停止')
        const view = this.createView()
        this.views.push(view)
        view.setBounds({ x: 0, y: 0, width: 1060, height: 780 })
        view.setVisible(false)
        const contents = view.webContents
        sessions.add(contents.session)
        contents.session.setPermissionRequestHandler(
          (_contents, _permission, callback) => callback(false),
        )
        contents.session.setPermissionCheckHandler(() => false)
        contents.setAudioMuted(true)
        contents.setUserAgent(
          contents
            .getUserAgent()
            .replace(/ Electron\/\S+/, '')
            .replace(/ MediaCrawlerStudio\/\S+/, ''),
        )
        contents.setWindowOpenHandler(() => ({ action: 'deny' }))
        targets[platform] = `about:blank#studio-health-${platform}`
        await contents.loadURL(targets[platform])
      }
      if (this.closed || ended) throw new Error('检查已停止')
      const service = this.service
      const python =
        process.env.STUDIO_PYTHON ||
        path.join(
          service.root,
          '.venv',
          process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
        )
      const child = this.spawnProcess(
        python,
        ['-u', '-m', 'desktop.health_worker'],
        {
          cwd: service.root,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
          },
        },
      )
      this.child = child
      lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        try {
          const report = JSON.parse(line)
          if (ended) return
          if (report.type === 'network') {
            network = report
            this.progress('platforms')
          }
          if (
            report.type === 'platform' &&
            Object.hasOwn(platforms, report.platform)
          ) {
            reports.set(report.platform, report)
            this.progress('platforms', reports.size)
          }
          if (report.type === 'error') failure = report.error
        } catch {
          /* 非协议输出不进入结果 */
        }
      })
      child.stderr.resume()
      child.stdin.on('error', () => {})
      const exited = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', resolve)
      })
      child.stdin.end(
        JSON.stringify({ endpoint: service.endpoint, targets }) + '\n',
      )
      await exited
    }
    try {
      await Promise.race([work(), timeout, cancelled])
    } catch {
      // 保留已完成项，缺失项不能算作成功
    } finally {
      ended = true
      this.abortRun = null
      clearTimeout(timer)
      this.child?.kill('SIGKILL')
      this.child = null
      lines?.close()
      this.destroyViews()
      await Promise.allSettled(
        [...sessions].map(async (session) => {
          let cleanupTimer
          try {
            await Promise.race([
              Promise.all([
                session.clearStorageData(),
                session.clearCache(),
                session.closeAllConnections(),
              ]),
              new Promise((resolve) => {
                cleanupTimer = setTimeout(resolve, 3000)
              }),
            ])
          } finally {
            clearTimeout(cleanupTimer)
          }
        }),
      )
    }
    const result = {
      network,
      failure: reports.size ? undefined : failure,
      platforms: Object.keys(platforms).map(
        (platform) =>
          reports.get(platform) || {
            platform,
            status: 'failed',
            error: { ...failure },
          },
      ),
    }
    this.progress('done', reports.size)
    this.service.logger?.write('info', 'health', 'check-completed', result)
    return result
  }

  destroyViews() {
    for (const view of this.views)
      if (!view.webContents.isDestroyed())
        view.webContents.close({ waitForBeforeUnload: false })
    this.views = []
  }

  stop() {
    this.closed = true
    this.abortRun?.()
    this.child?.kill('SIGKILL')
    this.destroyViews()
    return this.pending
  }
}
