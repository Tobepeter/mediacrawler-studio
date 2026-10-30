import { logoutPlatform } from './logout-job.mjs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { StudioLibrary } from './library.mjs'
import { DownloadJob } from './download-job.mjs'
import path from 'node:path'
import { platforms, validateRequest } from './contracts.mjs'

// 一次一个采集进程，状态和结果由主进程持有
export class StudioService {
  child = null
  busy = false
  stopRequested = false
  cancellation = null
  clearingSessions = null
  downloadJob = null
  persistence = Promise.resolve()
  state = {
    mode: 'desktop',
    loginView: null,
    busy: false,
    profiles: {},
    accounts: {},
    task: null,
    results: [],
    pages: {},
    history: [],
    drafts: {},
  }
  runId = null

  constructor(options) {
    Object.assign(this, options)
    this.spawnProcess = options.spawnProcess || spawn
    this.library = new StudioLibrary(this.dataDir)
  }

  async init() {
    await this.library.init()
    this.state.accounts = await this.windows.accounts()
    // 启动进入新采集，历史只在用户主动打开时恢复；Tab 状态仍在本次运行保留
    this.state.drafts = {}
    this.state.pages = {}
    this.state.history = this.library.list()
    this.state.results = []
    this.state.task = null
  }

  publish() {
    this.state.loginView = this.windows.presentation || null
    this.state.busy = this.busy
    this.state.history = this.library.list()
    this.onState(this.state)
  }

  trackSave(job) {
    this.persistence = job
    job.catch((error) => {
      this.logger?.write('error', 'storage', 'save-failed', error)
      if (this.state.task)
        this.state.task.warning = '记录暂未保存到磁盘，请先导出'
      this.publish()
    })
    return job
  }

  save() {
    if (this.state.task?.action !== 'collect' || !this.runId) return
    const platform = this.state.task.platform
    const record = {
      id: this.runId,
      task: { ...this.state.task },
      results: [...this.state.results],
    }
    this.state.pages[platform] = record
    this.trackSave(this.library.saveRun(record))
  }

  saveDraft(platform, value) {
    if (
      !Object.hasOwn(platforms, platform) ||
      !value ||
      typeof value.query !== 'string' ||
      value.query.length > 2000 ||
      !['search', 'link'].includes(value.mode) ||
      !Number.isInteger(value.limit) ||
      value.limit < 1 ||
      value.limit > 100
    )
      throw new Error('无效的页面输入')
    this.library.workspace.drafts[platform] = {
      platform,
      query: value.query,
      mode: value.mode,
      limit: value.limit,
      comments: value.comments === true,
      replies: value.comments === true && value.replies === true,
    }
    return this.trackSave(this.library.saveWorkspace())
  }

  async openHistory(id) {
    if (this.busy) throw new Error('请先结束当前任务')
    const record = await this.library.get(id)
    if (this.busy) throw new Error('请先结束当前任务')
    this.state.pages[record.task.platform] = record
    this.state.task = null
    this.library.workspace.selections[record.task.platform] = id
    await this.trackSave(this.library.saveWorkspace())
    this.publish()
    return record
  }

  async clearSessions(platform) {
    if (platform !== undefined && !Object.hasOwn(platforms, platform))
      throw new Error('不支持的平台')
    if (this.busy) throw new Error('请先结束当前任务')
    this.busy = true
    this.publish()
    this.clearingSessions = (async () => {
      if (platform) await this.sessions?.stop(platform)
      else await this.sessions?.stopAll()
      const accounts = await this.windows.accounts()
      const targets =
        platform === undefined ? Object.keys(platforms) : [platform]
      const outcomes = await Promise.all(
        targets.map(async (id) => {
          if (
            !['saved', 'connected', 'expired'].includes(accounts[id]) &&
            !this.state.profiles[id]
          )
            return { platform: id, remote: 'no_local_session' }
          return logoutPlatform({
            platform: id,
            root: this.root,
            endpoint: this.endpoint,
            windows: this.windows,
            spawnProcess: this.spawnProcess,
          })
        }),
      )
      // 保留 Cookie 直到平台退出操作完成，随后再关闭页面并清理分区
      await this.windows.clearSessions(platform)
      for (const id of targets) {
        delete this.state.accounts[id]
        delete this.state.profiles[id]
      }
      if (
        this.state.task?.action === 'connect' &&
        targets.includes(this.state.task.platform)
      )
        this.state.task = null
      return {
        localOnly: outcomes.some((item) => item.remote === 'not_confirmed'),
        results: outcomes.map((item) => ({ ...item, localCleared: true })),
      }
    })()
    try {
      return await this.clearingSessions
    } finally {
      this.clearingSessions = null
      this.busy = false
      this.publish()
    }
  }

  mediaItem(platform, id, kind) {
    if (this.busy) throw new Error('请先结束当前任务')
    if (!['images', 'video'].includes(kind)) throw new Error('不支持的操作')
    const item = this.state.pages[platform]?.results?.find(
      (item) => item.id === id,
    )
    if (!item || item.platform !== platform) throw new Error('历史记录不存在')
    if (kind === 'images' && !item.images?.length)
      throw new Error('没有可下载的图片')
    return item
  }

  async downloadMedia(platform, id, kind, directory) {
    const record = this.mediaItem(platform, id, kind)
    return this.runMedia(record, { kind, directory })
  }

  async resolveVideo(platform, id, requestId) {
    if (
      platform !== 'dy' ||
      typeof requestId !== 'string' ||
      !/^[\w-]{1,80}$/.test(requestId)
    )
      throw new Error('不支持的操作')
    const record = this.mediaItem(platform, id, 'video')
    const result = await this.runMedia(record, { kind: 'playback', requestId })
    return { urls: result.urls || [], code: result.code }
  }

  async cancelVideo(requestId) {
    if (
      this.downloadJob?.requestId === requestId &&
      typeof requestId === 'string'
    )
      await this.downloadJob.cancel()
  }

  async runMedia(record, options) {
    const { kind } = options
    const python =
      process.env.STUDIO_PYTHON ||
      path.join(
        this.root,
        '.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      )
    if (!existsSync(python))
      return {
        saved: 0,
        total: kind === 'images' ? record.images.length : 1,
        code: 'environment',
      }
    this.busy = true
    const job = new DownloadJob({
      python,
      root: this.root,
      endpoint: this.endpoint,
      windows: this.windows,
      spawnProcess: this.spawnProcess,
      requestId: options.requestId,
      logger: this.logger,
    })
    this.downloadJob = job
    this.publish()
    try {
      if (this.sessions) await this.sessions.stop(record.platform)
      return await job.run({ record, ...options })
    } finally {
      this.downloadJob = null
      this.busy = false
      this.publish()
    }
  }

  resultsFor(platform, id) {
    const page = this.state.pages[platform]
    if (!page || page.id !== id) throw new Error('当前结果已更新，请重新导出')
    return page.results
  }

  async start(value) {
    if (this.busy) throw new Error('请先结束当前任务')
    const request = validateRequest(value)
    const python =
      process.env.STUDIO_PYTHON ||
      path.join(
        this.root,
        '.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      )
    if (!existsSync(python))
      throw new Error('采集环境尚未安装，请在项目目录运行 uv sync')
    this.busy = true
    this.stopRequested = false
    this.state.task = {
      ...request,
      status: 'checking',
      message: '正在检查登录状态',
      startedAt: Date.now(),
    }
    if (request.action === 'collect') {
      this.runId = randomUUID()
      this.state.results = []
      this.library.workspace.selections[request.platform] = this.runId
      this.save()
      this.trackSave(this.library.saveWorkspace())
    }
    this.windows.loginMode = request.loginMode || 'embedded'
    if (request.action === 'connect' && !request.silent)
      this.windows.beginLogin(request.platform)
    this.publish()
    try {
      await this.sessions?.stop(request.platform)
      const targetId = await this.windows.prepare(request.platform)
      if (this.stopRequested) {
        this.finish('cancelled', '已取消')
        return
      }
      const child = this.spawnProcess(python, ['-u', '-m', 'desktop.worker'], {
        cwd: this.root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      })
      this.child = child
      let terminal = false
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        try {
          const event = JSON.parse(line)
          if (this.stopRequested || terminal || this.child !== child) return
          if (event.type === 'diagnostic') {
            this.logger?.write('error', 'crawler', 'exception', {
              platform: request.platform,
              ...event.detail,
            })
          } else if (event.type === 'state') {
            if (request.silent && event.status === 'auth') return
            Object.assign(this.state.task, {
              status: event.status,
              message: event.message,
            })
            if (event.status === 'auth') {
              this.state.accounts[request.platform] = 'expired'
              delete this.state.profiles[request.platform]
              if (!request.silent) this.windows.show(request.platform)
            }
          } else if (event.type === 'login-required') {
            this.state.accounts[request.platform] = 'expired'
            delete this.state.profiles[request.platform]
          } else if (event.type === 'account') {
            this.state.accounts[request.platform] = 'connected'
            this.state.profiles[request.platform] = {
              nickname:
                typeof event.profile?.nickname === 'string'
                  ? event.profile.nickname.slice(0, 100)
                  : '',
              avatar:
                typeof event.profile?.avatar === 'string' &&
                /^https:\/\//i.test(event.profile.avatar)
                  ? event.profile.avatar
                  : '',
            }
            this.windows.flush(request.platform).catch(() => {})
            this.windows.hide(request.platform)
          } else if (event.type === 'warning') {
            this.logger?.write('warn', 'crawler', 'warning', {
              platform: request.platform,
              message: event.message,
            })
            this.state.task.warning = event.message
          } else if (event.type === 'item-update') {
            const index = this.state.results.findIndex(
              (item) => item.id === event.item?.id,
            )
            if (index !== -1) {
              this.state.results[index] = event.item
              this.save()
            }
          } else if (event.type === 'item') {
            if (!this.state.results.some((item) => item.id === event.item.id))
              this.state.results.push(event.item)
            this.save()
          } else if (event.type === 'done' || event.type === 'error') {
            terminal = true
            this.finish(
              event.type === 'done' ? 'completed' : 'error',
              event.message,
              false,
            )
          }
          this.publish()
        } catch {
          /* 非协议输出不进入产品界面 */
        }
      })
      // 上游日志可能含 Cookie/响应内容，不落盘、不向渲染器转发
      child.stderr.resume()
      child.stdin.on('error', () => {})
      child.once('error', (error) => {
        if (this.stopRequested) {
          terminal = true
          this.finish('cancelled', '已取消', false)
          return
        }
        this.logger?.write('error', 'crawler', 'spawn-failed', error)
        terminal = true
        this.finish('error', '采集进程无法启动，请检查 Python 环境', false)
      })
      child.once('close', (exitCode, signal) => {
        if (!terminal && !this.stopRequested)
          this.logger?.write('error', 'crawler', 'process-ended', {
            exitCode,
            signal,
          })
        this.child = null
        this.busy = false
        if (this.stopRequested)
          this.finish('cancelled', '已取消，已获取的结果已保留')
        else if (!terminal) this.finish('error', '采集进程意外结束，请重试')
        else this.publish()
        lines.close()
      })
      child.stdin.end(
        JSON.stringify({ ...request, targetId, endpoint: this.endpoint }) +
          '\n',
      )
    } catch (error) {
      if (this.stopRequested) {
        this.finish('cancelled', '已取消')
        return
      }
      this.finish('error', error.message)
      throw error
    }
  }

  finish(status, message, release = true) {
    if (status === 'error')
      this.logger?.write('error', 'crawler', 'failed', {
        platform: this.state.task?.platform,
        message,
      })
    if (release) this.busy = false
    Object.assign(this.state.task, { status, message, finishedAt: Date.now() })
    this.windows.hide(this.state.task.platform)
    if (status === 'cancelled' || status === 'error') {
      for (const item of this.state.results) {
        if (['pending', 'running'].includes(item.commentStatus))
          item.commentStatus = status
      }
    }
    this.save()
    this.publish()
  }

  dismissLogin() {
    const task = this.state.task
    if (
      this.windows.presentation?.platform !== task?.platform ||
      !['checking', 'auth'].includes(task?.status)
    )
      return
    return this.cancel()
  }

  async cancel() {
    if (this.downloadJob) return this.downloadJob.cancel()
    // 退出应用时等会话清理落盘，不把清理当成可停止的采集任务
    if (this.clearingSessions) return this.clearingSessions.catch(() => {})
    if (this.cancellation) return this.cancellation
    if (!this.busy || this.stopRequested) return
    this.stopRequested = true
    this.state.task.status = 'stopping'
    this.state.task.message = '正在停止'
    this.windows.hide(this.state.task.platform)
    this.publish()
    const child = this.child
    if (!child) return
    this.cancellation = new Promise((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2500)
      child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
    try {
      await this.cancellation
    } finally {
      this.cancellation = null
    }
  }
}
