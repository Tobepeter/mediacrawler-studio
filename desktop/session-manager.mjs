import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { platforms } from './contracts.mjs'

// 应用级会话预热，不占用采集 task/busy，也不依赖当前 Tab
export class SessionManager {
  jobs = new Map()
  stopped = new Set()
  closed = false

  constructor(service, spawnProcess = spawn) {
    this.service = service
    this.spawnProcess = spawnProcess
  }

  start() {
    if (this.queue) return this.queue
    const pending = Object.keys(platforms)
    const consume = async () => {
      while (pending.length && !this.closed) {
        const platform = pending.shift()
        if (!this.stopped.has(platform)) await this.check(platform)
      }
    }
    // 限制冷启动负载，所有平台都进入队列，切页面不触发检查
    this.queue = Promise.all([consume(), consume()])
    return this.queue
  }

  check(platform) {
    const controller = new AbortController()
    const job = { controller, child: null, done: null }
    this.jobs.set(platform, job)
    job.done = this.probe(platform, job)
      .catch((error) => {
        if (!controller.signal.aborted)
          this.service.logger?.write('warn', 'session', 'check-failed', {
            platform,
            name: error.name,
          })
      })
      .finally(() => {
        this.jobs.delete(platform)
        // 未能确认会话也必须结束检查态，交由用户扫码恢复
        if (
          !this.stopped.has(platform) &&
          this.service.state.accounts[platform] === 'saved'
        ) {
          this.service.state.accounts[platform] = 'unknown'
          this.service.publish()
        }
      })
    return job.done
  }

  async probe(platform, job) {
    const service = this.service
    const { signal } = job.controller
    const timeout = setTimeout(() => {
      job.controller.abort()
      job.child?.kill('SIGKILL')
    }, 45000)
    try {
      const targetId = await service.windows.prepare(platform, signal)
      signal.throwIfAborted()
      // 没有持久会话时无需访问平台或启动 Python
      if (service.state.accounts[platform] !== 'saved') return
      const python =
        process.env.STUDIO_PYTHON ||
        path.join(
          service.root,
          '.venv',
          process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
        )
      const child = this.spawnProcess(python, ['-u', '-m', 'desktop.worker'], {
        cwd: service.root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      })
      job.child = child
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        if (signal.aborted) return
        try {
          const event = JSON.parse(line)
          if (event.type === 'account') {
            service.state.accounts[platform] = 'connected'
            service.state.profiles[platform] = {
              nickname:
                typeof event.profile?.nickname === 'string'
                  ? event.profile.nickname.slice(0, 100)
                  : '',
              avatar: /^https:\/\//i.test(event.profile?.avatar || '')
                ? event.profile.avatar
                : '',
            }
            void service.windows.flush(platform).catch(() => {})
          } else if (event.type === 'login-required') {
            service.state.accounts[platform] = 'expired'
            delete service.state.profiles[platform]
          } else if (event.type === 'error') {
            service.logger?.write('warn', 'session', 'check-failed', {
              platform,
            })
          } else return
          service.publish()
        } catch {
          /* 非协议输出不进入页面 */
        }
      })
      child.stderr.resume()
      child.stdin.on('error', () => {})
      const exited = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', resolve)
      })
      child.stdin.end(
        JSON.stringify({
          platform,
          action: 'connect',
          silent: true,
          mode: 'search',
          query: '',
          limit: 5,
          endpoint: service.endpoint,
          targetId,
        }) + '\n',
      )
      try {
        await exited
      } finally {
        lines.close()
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async stop(platform) {
    this.stopped.add(platform)
    const job = this.jobs.get(platform)
    if (!job) return
    job.controller.abort()
    job.child?.kill('SIGKILL')
    await job.done
  }

  async stopAll() {
    this.closed = true
    await Promise.all(
      Object.keys(platforms).map((platform) => this.stop(platform)),
    )
    await this.queue
  }
}
