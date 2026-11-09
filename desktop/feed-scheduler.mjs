// 推荐流调度：用户正在等的请求立刻发，后台只给每个平台备一份首屏，下次打开秒开
// 后台同一时间只跑一个，当前 Tab 优先；同平台有用户操作时让路，操作结束后再补
// 只在连接成功和首屏被用掉时各补一次，缓存过期不重新拉，不会定时刷接口
export class FeedScheduler {
  runs = new Map()
  wanted = new Set()
  seen = new Set()
  quietUntil = new Map()
  attempts = new Map()
  focused = null
  timer = null
  closed = false

  constructor(options) {
    Object.assign(
      this,
      {
        quietMs: 60000,
        gapMs: [3000, 5000],
        idleMs: 10000,
        retryMs: 15000,
        maxAttempts: 4,
        now: Date.now,
        random: Math.random,
      },
      options,
    )
  }

  focus(platform) {
    this.focused = platform
  }

  // 状态每次变化都调用：发现新连接的平台、清掉失效账号的缓存、给用户操作让路
  sync() {
    for (const platform of this.platforms) {
      const status = this.status(platform)
      if (status === 'connected') {
        if (!this.seen.has(platform)) {
          this.seen.add(platform)
          if (!this.cache.has(platform)) this.want(platform)
        }
      } else if (status !== 'saved') this.reset(platform)
      const run = this.runs.get(platform)
      if (run?.background && !run.waiter && this.busy(platform))
        this.stop(run, true)
    }
    this.schedule()
  }

  async load(platform, cursor) {
    this.touch(platform)
    if (cursor === undefined) {
      const stored = this.take(platform)
      if (stored) {
        this.want(platform)
        this.schedule()
        return stored
      }
      const running = this.runs.get(platform)
      if (running?.background) return this.join(platform, running)
    }
    this.abort(platform)
    const run = { background: false, child: null, cancelled: false }
    this.runs.set(platform, run)
    try {
      const page = await this.fetch(platform, cursor, run)
      if (cursor === undefined && !page.cancelled) {
        this.want(platform)
        this.touch(platform)
      }
      return page
    } finally {
      if (this.runs.get(platform) === run) this.runs.delete(platform)
      this.schedule()
    }
  }

  // 用户不等了：后台预取继续跑完存起来，只有用户自己发起的请求才真正取消
  cancel(platform) {
    const run = this.runs.get(platform)
    if (!run) return
    if (!run.background) return this.stop(run, false)
    const waiter = run.waiter
    run.waiter = null
    waiter?.resolve({ items: [], hasMore: false, cancelled: true })
  }

  reset(platform) {
    this.wanted.delete(platform)
    this.seen.delete(platform)
    this.attempts.delete(platform)
    this.cache.delete(platform)
    const run = this.runs.get(platform)
    if (run) this.stop(run, false)
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    this.timer = null
    for (const run of this.runs.values()) this.stop(run, false)
  }

  want(platform) {
    this.attempts.delete(platform)
    this.wanted.add(platform)
  }

  touch(platform) {
    this.quietUntil.set(platform, this.now() + this.quietMs)
  }

  take(platform) {
    const page = this.cache.get(platform)
    if (page === undefined) return null
    this.cache.delete(platform)
    return Array.isArray(page?.items) && page.items.length ? page : null
  }

  // 首屏已经在后台取了，接上同一个请求，平台只收到一次
  join(platform, run) {
    return new Promise((resolve, reject) => {
      run.waiter = { resolve, reject }
    }).then((page) => (page.retry ? this.load(platform) : page))
  }

  stop(run, requeue) {
    run.cancelled = true
    run.requeue = requeue
    run.child?.kill('SIGTERM')
  }

  abort(platform) {
    const run = this.runs.get(platform)
    if (run) this.stop(run, run.background)
  }

  gap() {
    const [low, high] = this.gapMs
    return low + this.random() * (high - low)
  }

  schedule(delay = this.gap()) {
    if (this.timer || this.closed || !this.wanted.size) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.pump()
    }, delay)
    this.timer.unref?.()
  }

  ready(platform) {
    return (
      this.status(platform) === 'connected' &&
      !this.busy(platform) &&
      !this.runs.has(platform) &&
      this.now() >= (this.quietUntil.get(platform) || 0)
    )
  }

  pump() {
    if (this.closed) return
    if ([...this.runs.values()].some((run) => run.background)) return
    const next = [this.focused, ...this.platforms].find(
      (platform) => this.wanted.has(platform) && this.ready(platform),
    )
    if (next) void this.prefetch(next)
    else this.schedule(this.idleMs)
  }

  async prefetch(platform) {
    const run = { background: true, child: null, cancelled: false }
    this.runs.set(platform, run)
    this.wanted.delete(platform)
    let page
    let failure
    try {
      page = await this.fetch(platform, undefined, run)
    } catch (error) {
      failure = error
    }
    if (this.runs.get(platform) === run) this.runs.delete(platform)
    this.settle(platform, run, page, failure)
    this.schedule()
  }

  settle(platform, run, page, failure) {
    const { waiter } = run
    if (failure) {
      waiter?.reject(failure)
      this.logger?.write('warn', 'crawler', 'feed-prefetch-failed', {
        platform,
        message: String(failure.message || failure).slice(0, 200),
      })
    } else if (waiter) {
      // 后台请求节流没排上时，换成用户请求重新排队
      if (page.busy) waiter.resolve({ retry: true })
      else {
        waiter.resolve(page)
        if (!page.cancelled) this.want(platform)
      }
    } else if (page.busy) this.retry(platform)
    else if (page.cancelled) {
      if (run.requeue) this.wanted.add(platform)
    } else if (page.items.length && !run.cancelled)
      this.cache.set(platform, page)
  }

  retry(platform) {
    const count = (this.attempts.get(platform) || 0) + 1
    this.attempts.set(platform, count)
    if (count >= this.maxAttempts) return
    this.wanted.add(platform)
    this.schedule(this.retryMs)
  }
}
