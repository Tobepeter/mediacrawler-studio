import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { platforms } from './contracts.mjs'
import policy from './health-policy.json' with { type: 'json' }

const AUTO_RENEW_LIMIT = 2

// 平台级登录任务与二维码缓存；与前台 Tab、采集 task/busy 解耦
export class SessionManager {
  jobs = new Map()
  timers = new Map()
  retries = new Map()
  renewals = new Map()
  closed = false
  started = false
  foreground = null

  constructor(service, spawnProcess = spawn) {
    this.service = service
    this.spawnProcess = spawnProcess
    service.state.logins = {}
  }

  start() {
    if (this.started || this.closed) return
    this.started = true
    for (const platform of Object.keys(platforms)) {
      const delay = policy.login_delays_ms[platform]
      this.service.state.logins[platform] = {
        status: 'queued',
        scheduledAt: Date.now() + delay,
      }
      if (!delay) this.ensure(platform)
      else
        this.timers.set(
          platform,
          setTimeout(() => this.ensure(platform), delay),
        )
    }
    this.service.publish()
  }

  setForeground(platform) {
    if (platform !== null && !Object.hasOwn(platforms, platform))
      throw new Error('不支持的平台')
    if (this.foreground === platform) return
    const previous = this.jobs.get(this.foreground)
    this.foreground = platform
    if (previous) this.schedule(previous)
    if (this.wake()) return
    const job = this.jobs.get(platform)
    if (job?.image && !job.confirming) {
      clearTimeout(job.refresh)
      if (Date.now() - (job.checkedAt || 0) >= 2000) void this.capture(job)
      else this.schedule(job)
    }
  }

  // 用户回到这个平台时，已到期的码重新换，并重新计算自动换码次数
  wake() {
    const platform = this.foreground
    if (!platform || this.service.state.logins[platform]?.status !== 'expired')
      return false
    this.renewals.delete(platform)
    this.renew(platform)
    return true
  }

  schedule(job) {
    clearTimeout(job.refresh)
    if (!this.active(job) || job.connected || job.confirming || !job.image)
      return
    job.refresh = setTimeout(
      () => void this.capture(job),
      this.foreground === job.platform ? 2000 : 60000,
    )
  }

  occupied(platform) {
    return !!this.service.state.working?.[platform]
  }

  ensure(platform, reload = false) {
    if (!Object.hasOwn(platforms, platform)) throw new Error('不支持的平台')
    if (this.closed || this.occupied(platform)) return
    clearTimeout(this.timers.get(platform))
    this.timers.delete(platform)
    if (this.jobs.has(platform)) return
    const state = this.service.state.logins[platform]
    if (['error', 'expired', 'paused'].includes(state?.status)) return
    if (this.service.state.accounts[platform] === 'connected') {
      this.service.state.logins[platform] = {
        ...state,
        status: 'connected',
        image: undefined,
      }
      this.service.publish()
      return
    }
    const job = {
      id: randomUUID(),
      platform,
      controller: new AbortController(),
      child: null,
      image: null,
      reload,
    }
    this.jobs.set(platform, job)
    this.service.state.logins[platform] = {
      id: job.id,
      startedAt: Date.now(),
      status: 'preparing',
    }
    this.service.publish()
    job.deadline = setTimeout(
      () => this.fail(job, { code: 'TIMEOUT', stage: 'qr', retryable: true }),
      policy.qr_timeout_ms,
    )
    job.done = this.probe(job)
      .catch(() => {
        if (this.active(job))
          this.fail(job, { code: 'UNKNOWN', stage: 'worker', retryable: true })
      })
      .finally(() => {
        clearTimeout(job.deadline)
        clearTimeout(job.refresh)
        if (this.active(job)) {
          const current = this.service.state.logins[platform]
          if (!['connected', 'error', 'expired'].includes(current.status))
            this.fail(job, {
              code: 'UNKNOWN',
              stage: 'worker',
              retryable: true,
            })
        }
        if (this.jobs.get(platform) === job) this.jobs.delete(platform)
      })
  }

  active(job) {
    return !job.controller.signal.aborted && this.jobs.get(job.platform) === job
  }

  update(job, values) {
    if (!this.active(job)) return
    Object.assign(this.service.state.logins[job.platform], values)
    this.service.publish()
  }

  fail(job, failure) {
    if (!this.active(job)) return
    this.service.logger?.write('warn', 'login', 'failed', {
      platform: job.platform,
      ...failure,
    })
    // 取到码以后等待扫码超时，不计为“取码连续超时”
    const waited = (job.image || job.confirming) && failure.code === 'TIMEOUT'
    if (waited) {
      this.update(job, {
        status: 'expired',
        image: undefined,
        failure: undefined,
      })
    } else this.update(job, { status: 'error', image: undefined, failure })
    job.controller.abort()
    job.child?.kill('SIGKILL')
    // 手机上正在确认时换码会打断登录，交给用户手动刷新
    if (waited && !job.confirming) this.renew(job.platform)
  }

  // 只在用户看着这个平台时换码，后台不跑；无人操作时换几次就停，避免持续请求
  renew(platform) {
    if (this.closed || this.foreground !== platform || this.occupied(platform))
      return
    const count = this.renewals.get(platform) || 0
    if (count >= AUTO_RENEW_LIMIT) return
    void this.retry(platform).catch(() => {})
    this.renewals.set(platform, count + 1)
  }

  async probe(job) {
    const service = this.service
    if (service.online?.() === false) {
      this.fail(job, {
        code: 'NETWORK_OFFLINE',
        stage: 'connection',
        retryable: true,
      })
      return
    }
    const { signal } = job.controller
    let onAbort
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(new Error('cancelled'))
      signal.addEventListener('abort', onAbort, { once: true })
    })
    let targetId
    try {
      targetId = await Promise.race([
        service.windows.prepare(job.platform, signal),
        aborted,
      ])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    if (!this.active(job)) return
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
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    })
    job.child = child
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (!this.active(job)) return
      try {
        this.event(job, JSON.parse(line))
      } catch {
        /* 非协议输出不进入 UI */
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
        platform: job.platform,
        action: 'connect',
        loginMode: 'qrcode',
        mode: 'search',
        query: '',
        limit: 5,
        endpoint: service.endpoint,
        targetId,
      }) + '\n',
    )
    // 扫码等待有界，防止失联 worker 永久驻留
    const lifetime = setTimeout(
      () => this.fail(job, { code: 'TIMEOUT', stage: 'scan', retryable: true }),
      330000,
    )
    try {
      await exited
    } finally {
      clearTimeout(lifetime)
      lines.close()
    }
  }

  event(job, event) {
    const { platform } = job
    if (event.type === 'state' && event.status === 'auth') {
      void this.capture(job)
    } else if (event.type === 'account') {
      clearTimeout(job.deadline)
      clearTimeout(job.refresh)
      job.connected = true
      this.service.state.accounts[platform] = 'connected'
      this.service.state.profiles[platform] = {
        nickname:
          typeof event.profile?.nickname === 'string'
            ? event.profile.nickname.slice(0, 100)
            : '',
        avatar: /^https:\/\//i.test(event.profile?.avatar || '')
          ? event.profile.avatar
          : '',
      }
      this.update(job, {
        status: 'connected',
        image: undefined,
        failure: undefined,
      })
      void this.service.windows.flush(platform).catch(() => {})
    } else if (event.type === 'error' && !job.connected) {
      this.fail(
        job,
        event.failure || { code: 'UNKNOWN', stage: 'login', retryable: true },
      )
    }
  }

  async capture(job) {
    if (!this.active(job) || job.connected || job.confirming || job.capturing)
      return
    clearTimeout(job.refresh)
    job.capturing = true
    // Worker 复用后台页，换码必须重载页面，否则读回来的还是原来那张
    let refreshing = job.reload
    job.reload = false
    const swapping = refreshing && !!job.image
    // 原地换码失败时自动走一次完整流程，用户不用再点
    const giveUp = () => {
      if (swapping) void this.retry(job.platform).catch(() => {})
      else
        this.fail(job, {
          code: 'QR_IMAGE_FAILED',
          stage: 'qr_image',
          retryable: true,
        })
    }
    const active = () => this.active(job) && !job.connected && !job.confirming
    try {
      let result = await this.service.windows.captureBackgroundQr(
        job.platform,
        refreshing,
        active,
        { passive: !!job.image && !refreshing },
      )
      if (result.code === 'expired' && active()) {
        refreshing = true
        result = await this.service.windows.captureBackgroundQr(
          job.platform,
          true,
          active,
          { expiredOnly: true },
        )
      }
      if (!active()) return
      job.checkedAt = Date.now()
      if (result.code === 'confirming') {
        job.confirming = true
        clearTimeout(job.deadline)
        this.service.logger?.write('info', 'login', 'qr-scanned', {
          platform: job.platform,
        })
        this.update(job, {
          status: 'confirming',
          failure: undefined,
          refreshing: undefined,
        })
      } else if (result.image) {
        clearTimeout(job.deadline)
        const current = this.service.state.logins[job.platform]
        const changed =
          job.image !== result.image ||
          current?.status !== 'ready' ||
          current?.refreshing
        // 只记录换码时机，不写二维码内容
        if (job.image !== result.image) {
          this.service.logger?.write('info', 'login', 'qr-updated', {
            platform: job.platform,
            first: !job.image,
            reloaded: refreshing,
            shownMs: job.imageAt ? Date.now() - job.imageAt : 0,
          })
          job.imageAt = Date.now()
        }
        job.image = result.image
        if (changed)
          this.update(job, {
            status: 'ready',
            image: result.image,
            updatedAt: Date.now(),
            failure: undefined,
            refreshing: undefined,
          })
      } else if (
        result.code !== 'cancelled' &&
        (!job.image || swapping || (refreshing && result.code !== 'pending'))
      ) {
        giveUp()
      }
      // 已有码时，短暂消失/跳转/读图失败不取消扫码，不重开登录页
    } catch {
      if (!job.image || refreshing) giveUp()
    } finally {
      job.capturing = false
      if (job.reload) void this.capture(job)
      else this.schedule(job)
    }
  }

  // 常规刷新：等待进程不动，只重载后台页换码，旧码留在原地直到新码就绪
  refresh(platform) {
    if (!Object.hasOwn(platforms, platform)) throw new Error('不支持的平台')
    const job = this.jobs.get(platform)
    if (!job?.image || job.connected || job.confirming)
      return this.retry(platform)
    if (job.reload || this.service.state.logins[platform]?.refreshing) return
    job.reload = true
    this.update(job, { refreshing: true })
    if (!job.capturing) void this.capture(job)
  }

  retry(platform) {
    if (!Object.hasOwn(platforms, platform)) throw new Error('不支持的平台')
    if (this.closed || this.occupied(platform))
      return Promise.reject(new Error('任务进行中，请稍后重试'))
    if (this.retries.has(platform)) return this.retries.get(platform)
    this.renewals.delete(platform)
    const promise = this.stop(platform)
      .then(() => {
        if (this.closed || this.occupied(platform))
          throw new Error('任务进行中，请稍后重试')
        delete this.service.state.logins[platform]
        this.ensure(platform, true)
      })
      .finally(() => this.retries.delete(platform))
    this.retries.set(platform, promise)
    return promise
  }

  async stop(platform) {
    clearTimeout(this.timers.get(platform))
    this.timers.delete(platform)
    const job = this.jobs.get(platform)
    if (job) {
      job.controller.abort()
      clearTimeout(job.deadline)
      clearTimeout(job.refresh)
      job.child?.kill('SIGKILL')
    }
    this.service.state.logins[platform] = {
      status:
        this.service.state.accounts[platform] === 'connected'
          ? 'connected'
          : 'paused',
    }
    this.service.publish()
    if (job) await job.done
  }

  async stopAll(close = false) {
    if (close) this.closed = true
    await Promise.all(
      Object.keys(platforms).map((platform) => this.stop(platform)),
    )
  }
}
