import { createInterface } from 'node:readline'

// 媒体下载/播放地址解析，不写回采集历史；进程退出后才解除忙碌
export class DownloadJob {
  child = null
  stopped = false
  finished = null
  running = null

  constructor(options) {
    Object.assign(this, options)
  }

  run(request) {
    this.running = this.execute(request)
    return this.running
  }

  async execute(request) {
    const cancelled = {
      saved: 0,
      total: request.kind === 'images' ? request.record.images.length : 1,
      code: 'cancelled',
    }
    if (this.stopped) return cancelled
    // 视频保留平台上下文，候选失效或缺少 FFmpeg 时可刷新/兜底
    if (request.kind !== 'images') {
      request.targetId = await this.windows.prepare(request.record.platform)
    }
    if (this.stopped) return cancelled
    this.finished = new Promise((resolve) => {
      let saved = 0,
        result = null,
        code = 'network',
        throttle = {}
      const child = this.spawnProcess(
        this.python,
        ['-u', '-m', 'desktop.download_worker'],
        { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'] },
      )
      this.child = child
      let timedOut = false
      const timer = setTimeout(
        () => {
          this.logger?.write('error', 'media', 'timeout', {
            platform: request.record.platform,
            kind: request.kind,
          })
          timedOut = true
          void this.cancel()
        },
        ['playback', 'detail'].includes(request.kind) ? 45000 : 30 * 60 * 1000,
      )
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        try {
          const event = JSON.parse(line)
          if (event.type === 'diagnostic')
            this.logger?.write('error', 'media', 'exception', {
              platform: request.record.platform,
              kind: request.kind,
              ...event.detail,
            })
          if (event.type === 'log')
            this.logger?.write(
              event.level === 'warn' ? 'warn' : 'info',
              'crawler',
              event.event,
              { platform: request.record.platform, ...event.detail },
            )
          if (event.type === 'download-progress') saved = event.saved
          if (event.type === 'download-result') result = event
          if (event.type === 'download-error') {
            code = event.code
            if (code === 'throttled')
              throttle = {
                throttleCode: event.throttle_code,
                retryAfter: event.retry_after,
                message: event.message,
              }
            else if (code !== 'cancelled')
              this.logger?.write('error', 'media', 'failed', {
                platform: request.record.platform,
                kind: request.kind,
                code,
              })
          }
        } catch {
          /* 上游日志不进入界面 */
        }
      })
      child.stderr.resume()
      child.stdin.on('error', () => {})
      child.on('error', (error) => {
        this.logger?.write('error', 'media', 'spawn-failed', error)
        code = 'environment'
      })
      child.once('close', (exitCode, signal) => {
        if (!result && !this.stopped)
          this.logger?.write('error', 'media', 'process-ended', {
            exitCode,
            signal,
          })
        clearTimeout(timer)
        this.child = null
        resolve({
          saved,
          total: request.kind === 'images' ? request.record.images.length : 1,
          ...result,
          ...throttle,
          code: timedOut
            ? 'network'
            : this.stopped
              ? 'cancelled'
              : result?.code || (result ? '' : code),
        })
      })
      child.stdin.end(JSON.stringify({ ...request, endpoint: this.endpoint }))
    })
    return this.finished
  }

  async cancel() {
    this.stopped = true
    const child = this.child
    if (!child) return this.running?.catch(() => {})
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
    try {
      await this.finished
    } finally {
      clearTimeout(timer)
    }
  }
}
