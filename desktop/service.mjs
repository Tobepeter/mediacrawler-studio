import healthPolicy from './health-policy.json' with { type: 'json' }
import { logoutPlatform } from './logout-job.mjs'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { StudioLibrary } from './library.mjs'
import { DownloadJob } from './download-job.mjs'
import { FeedScheduler } from './feed-scheduler.mjs'
import { FileCache } from './file-cache.mjs'
import { JsonCache } from './json-cache.mjs'
import path from 'node:path'
import { homedir } from 'node:os'
import {
  creatorLimit,
  creatorSearchPlatforms,
  creatorPlatforms,
  feedPlatforms,
  isCreatorUrl,
  platforms,
  validateRequest,
  validateFilters,
} from './contracts.mjs'

const creatorCount = (value) =>
  Number.isFinite(value) && value >= 0 ? value : null

// 进程事件不可信，只保留展示需要的字段
function creatorInfo(value, platform) {
  if (typeof value?.url !== 'string' || !isCreatorUrl(value.url, platform))
    return null
  const avatar = typeof value.avatar === 'string' ? value.avatar : ''
  return {
    name: String(value.name || '').slice(0, 100),
    url: value.url,
    avatar:
      avatar.startsWith('https://') && avatar.length <= 2048 ? avatar : '',
    followers: creatorCount(value.followers),
    posts: creatorCount(value.posts),
  }
}

const feedMemoryLimit = 600
const feedCacheTtl = 30 * 60 * 1000
const feedWaitLimit = 12
const sttUrl = 'http://127.0.0.1:29556'

export class StudioService {
  // 同平台的采集、播放解析、下载和登出共用一个浏览器页面
  operations = new Map()
  get busy() {
    return this.operations.size > 0
  }

  assertAvailable(platform) {
    if (this.operations.has(platform)) throw new Error('请先结束当前任务')
  }

  details = new Map()
  feedItems = new Map()
  transcripts = new Map()
  persistence = Promise.resolve()
  state = {
    policy: healthPolicy,
    mode: 'desktop',
    loginView: null,
    busy: false,
    profiles: {},
    accounts: {},
    tasks: {},
    working: {},
    pages: {},
    history: [],
    drafts: {},
  }
  qrReady(platform) {
    clearTimeout(this.operations.get(platform)?.loginTimer)
  }

  constructor(options) {
    Object.assign(this, options)
    this.spawnProcess = options.spawnProcess || spawn
    this.library = new StudioLibrary(this.dataDir)
    // 字幕按作品 ID 存，和哪条记录、推荐流是否刷新都无关，可以随时重新生成
    // macOS 目录名不区分大小写，cache 会和 Chromium 的 Cache 混在一起
    const cacheDir = path.join(this.dataDir, 'app-cache')
    this.transcriptCache = new FileCache(path.join(cacheDir, 'transcripts'), {
      maxEntries: 100,
      logger: this.logger,
    })
    this.feed = new FeedScheduler({
      platforms: feedPlatforms,
      cache: new JsonCache(cacheDir, 'feed', {
        version: 4,
        ttlMs: feedCacheTtl,
        logger: this.logger,
      }),
      status: (platform) => this.state.accounts[platform],
      busy: (platform) =>
        this.operations.has(platform) || this.details.has(platform),
      account: (platform) => this.state.profiles[platform]?.nickname || '',
      fetch: (platform, cursor, run) => this.fetchFeed(platform, cursor, run),
      logger: this.logger,
    })
  }

  async init() {
    await this.library.init()
    this.state.accounts = await this.windows.accounts()
    // 启动进入新采集，历史只在用户主动打开时恢复；Tab 状态仍在本次运行保留
    this.state.drafts = {}
    this.state.pages = {}
    this.state.history = this.library.list()
    this.state.tasks = {}
  }

  publish() {
    this.state.loginView = this.windows.presentation || null
    this.state.busy = this.busy
    this.state.working = Object.fromEntries(
      [...this.operations].map(([platform, op]) => [platform, op.kind]),
    )
    this.state.history = this.library.list()
    this.onState(this.state)
    this.feed?.sync()
  }

  trackSave(job, task) {
    this.persistence = job
    job.catch((error) => {
      this.logger?.write('error', 'storage', 'save-failed', error)
      if (task) task.warning = '记录暂未保存到磁盘，请先导出'
      this.publish()
    })
    return job
  }

  save(run) {
    if (!run.id) return
    const record = {
      id: run.id,
      task: { ...run.task },
      results: [...run.results],
    }
    this.state.pages[run.task.platform] = record
    this.trackSave(this.library.saveRun(record), run.task)
  }

  saveDraft(platform, value) {
    if (
      !Object.hasOwn(platforms, platform) ||
      !value ||
      typeof value.query !== 'string' ||
      value.query.length > 2000 ||
      !['search', 'link', 'creator'].includes(value.mode) ||
      !Number.isInteger(value.limit) ||
      value.limit < 1 ||
      value.limit > (value.mode === 'creator' ? creatorLimit : 100)
    )
      throw new Error('无效的页面输入')
    this.library.workspace.drafts[platform] = {
      platform,
      query: value.query,
      mode: value.mode,
      limit: value.limit,
      comments: value.comments === true,
      replies: value.comments === true && value.replies === true,
      filters: validateFilters(platform, value.filters),
      ...(typeof value.auto === 'boolean' ? { auto: value.auto } : {}),
    }
    return this.trackSave(this.library.saveWorkspace())
  }

  async openHistory(id) {
    const platform = this.library.entries.get(id)?.task.platform
    this.assertAvailable(platform)
    const record = await this.library.get(id)
    this.assertAvailable(platform)
    this.state.pages[platform] = record
    delete this.state.tasks[platform]
    this.library.workspace.selections[record.task.platform] = id
    await this.trackSave(this.library.saveWorkspace())
    this.publish()
    return record
  }

  clearResults(platform) {
    if (!Object.hasOwn(platforms, platform)) throw new Error('不支持的平台')
    this.assertAvailable(platform)
    delete this.state.pages[platform]
    delete this.state.tasks[platform]
    this.publish()
  }

  async clearSessions(platform) {
    if (platform !== undefined && !Object.hasOwn(platforms, platform))
      throw new Error('不支持的平台')
    const targets = platform === undefined ? Object.keys(platforms) : [platform]
    for (const id of targets) this.assertAvailable(id)
    const op = { kind: 'logout' }
    for (const id of targets) this.operations.set(id, op)
    this.publish()
    op.done = (async () => {
      if (platform) await this.sessions?.stop(platform)
      else await this.sessions?.stopAll()
      const accounts = await this.windows.accounts()
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
        if (this.state.logins) this.state.logins[id] = { status: 'paused' }
        delete this.state.profiles[id]
      }
      for (const id of targets) {
        if (this.state.tasks[id]?.action === 'connect')
          delete this.state.tasks[id]
      }
      return {
        localOnly: outcomes.some((item) => item.remote === 'not_confirmed'),
        results: outcomes.map((item) => ({ ...item, localCleared: true })),
      }
    })()
    try {
      return await op.done
    } finally {
      for (const id of targets) this.operations.delete(id)
      this.publish()
    }
  }

  mediaItem(platform, id, kind) {
    this.assertAvailable(platform)
    if (!['images', 'video'].includes(kind)) throw new Error('不支持的操作')
    const item = this.findItem(platform, id)
    if (!item || item.platform !== platform) throw new Error('历史记录不存在')
    if (kind === 'images' && !item.images?.length)
      throw new Error('没有可下载的图片')
    return item
  }

  async downloadMedia(platform, id, kind, directory, quality = 'best') {
    if (
      typeof quality !== 'string' ||
      !/^(best|worst|[1-9]\d{1,4}p)$/.test(quality)
    )
      throw new Error('清晰度无效')
    const record = this.mediaItem(platform, id, kind)
    return this.runMedia(record, { kind, directory, quality })
  }

  async resolveVideo(platform, id, requestId) {
    if (
      !['dy', 'xhs'].includes(platform) ||
      typeof requestId !== 'string' ||
      !/^[\w-]{1,80}$/.test(requestId)
    )
      throw new Error('不支持的操作')
    const record = this.mediaItem(platform, id, 'video')
    const result = await this.runMedia(record, { kind: 'playback', requestId })
    return { urls: result.urls || [], code: result.code }
  }

  get python() {
    return (
      process.env.STUDIO_PYTHON ||
      path.join(
        this.root,
        '.venv',
        process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      )
    )
  }

  mediaJob(platform, requestId) {
    return new DownloadJob({
      platform,
      python: this.python,
      root: this.root,
      endpoint: this.endpoint,
      windows: this.windows,
      spawnProcess: this.spawnProcess,
      requestId,
      logger: this.logger,
    })
  }

  // 只读补全，不占平台互斥：采集和下载可以同时进行，同平台只保留最新一次
  // 用户打开的详情会取消进行中的任务；后台补封面只在平台空闲时跑，不抢任何请求
  async loadDetail(platform, id, { background = false } = {}) {
    if (!Object.hasOwn(platforms, platform) || typeof id !== 'string')
      throw new Error('不支持的操作')
    if (this.state.accounts[platform] !== 'connected') return { code: 'login' }
    if (
      background &&
      (this.details.has(platform) || this.operations.has(platform))
    )
      return { code: 'busy' }
    await this.details.get(platform)?.cancel()
    const page = this.state.pages[platform]
    const record = this.findItem(platform, id)
    if (!record) return { code: 'unavailable' }
    if (!existsSync(this.python)) return { code: 'environment' }
    const job = this.mediaJob(platform)
    job.itemId = id
    this.details.set(platform, job)
    try {
      const result = await job.run({ record, kind: 'detail', background })
      if (result.item?.id !== id || result.item.platform !== platform)
        return {
          code: result.code || 'failed',
          throttleCode: result.throttleCode,
          retryAfter: result.retryAfter,
          message: result.message,
        }
      if (this.feedItems.get(platform)?.get(id) === record) {
        const item = { ...record, ...result.item }
        this.feedItems.get(platform).set(id, item)
        return { code: result.code, item }
      }
      this.applyDetail(platform, page?.id, result.item)
      return { code: result.code }
    } finally {
      if (this.details.get(platform) === job) this.details.delete(platform)
    }
  }

  // 只依赖 stt 的本机 HTTP 服务；后台空闲会退出，有命令就算能用，提取时再叫醒
  async sttStatus() {
    try {
      const response = await fetch(`${sttUrl}/v1/status`, {
        signal: AbortSignal.timeout(2000),
      })
      const data = await response.json()
      if (data?.service === 'stt') return { state: 'ready', busy: !!data.busy }
    } catch {
      /* 连不上按未运行处理 */
    }
    return {
      state: existsSync(path.join(homedir(), '.local/bin/stt'))
        ? 'installed'
        : 'missing',
      busy: false,
    }
  }

  async cacheSize() {
    const browser = await Promise.all(
      this.windows.cacheSessions().map((session) => session.getCacheSize()),
    )
    return browser.reduce(
      (sum, value) => sum + value,
      this.transcriptCache.bytes() + this.feed.cache.bytes(),
    )
  }

  // 只清可以重新获取的内容，登录态和采集记录不在缓存里
  async clearCache() {
    this.transcriptCache.clear()
    this.feed.cache.clear()
    await Promise.all(
      this.windows.cacheSessions().map((session) => session.clearCache()),
    )
  }

  // 保存字幕时用：生成过的优先，否则用平台字幕，中文轨优先
  transcriptExport(platform, id) {
    const item = this.findItem(platform, id)
    const tracks = (item?.subtitles?.items || []).filter(
      (track) => track.segments?.length,
    )
    const track =
      tracks.find((value) => /^(ai-)?zh/i.test(value.language || '')) ||
      tracks[0]
    const transcript =
      this.cachedTranscript(platform, id) ||
      (track && {
        segments: track.segments,
        text: track.segments.map((row) => row.text).join('\n'),
      })
    return { transcript: transcript || null, title: item?.title }
  }

  cachedTranscript(platform, id) {
    if (!Object.hasOwn(platforms, platform) || typeof id !== 'string')
      throw new Error('不支持的操作')
    return (
      this.transcriptCache.get(id) ||
      this.findItem(platform, id)?.transcript ||
      null
    )
  }

  // 只读，不占平台互斥；同一条重复点击共用同一次提取
  transcribe(platform, id) {
    if (!Object.hasOwn(platforms, platform) || typeof id !== 'string')
      throw new Error('不支持的操作')
    const key = `${platform}:${id}`
    const running = this.transcripts.get(key)
    if (running) return running.result
    const job = this.mediaJob(platform)
    const result = this.runTranscribe(job, platform, id).finally(() =>
      this.transcripts.delete(key),
    )
    this.transcripts.set(key, { job, result })
    return result
  }

  async runTranscribe(job, platform, id) {
    if (this.state.accounts[platform] !== 'connected') return { code: 'login' }
    const record = this.findItem(platform, id)
    if (!record) return { code: 'unavailable' }
    if (!existsSync(this.python)) return { code: 'environment' }
    const result = await job.run({ record, kind: 'transcribe' })
    if (!result.transcript)
      return {
        code: result.code || 'failed',
        retryAfter: result.retryAfter,
        message: result.message,
      }
    this.transcriptCache.set(id, result.transcript)
    return { code: '', transcript: result.transcript }
  }

  async cancelDetail(platform, id) {
    const job = this.details.get(platform)
    if (job?.itemId === id) await job.cancel()
  }

  applyDetail(platform, pageId, item) {
    // 采集进行中结果在 run 上，否则在当前页；已切到别的记录就不写回
    const run = [
      this.operations.get(platform),
      this.state.pages[platform],
    ].find((value) => value?.id === pageId && value.results)
    const index = run?.results.findIndex((value) => value.id === item.id) ?? -1
    if (index === -1) return
    run.results[index] = { ...run.results[index], ...item }
    this.save(run)
    this.publish()
  }

  async cancelVideo(requestId) {
    if (typeof requestId !== 'string') return
    for (const { downloadJob } of this.operations.values())
      if (downloadJob?.requestId === requestId) await downloadJob.cancel()
  }

  // 搜索博主与采集共用平台页面，走同一互斥；结果只回给调用方，不进历史
  async searchCreators(platform, keyword, cursor) {
    if (!creatorSearchPlatforms.includes(platform))
      throw new Error('该平台暂不支持博主搜索')
    const query = typeof keyword === 'string' ? keyword.trim() : ''
    if (!query || query.length > 100) throw new Error('请输入博主名称或关键词')
    if (
      cursor !== undefined &&
      (typeof cursor !== 'string' || !cursor || cursor.length > 4096)
    )
      throw new Error('翻页位置无效，请重新搜索')
    this.assertAvailable(platform)
    if (this.state.accounts[platform] !== 'connected')
      throw new Error('登录后才能搜索博主')
    const python = this.python
    if (!existsSync(python))
      throw new Error('采集环境尚未安装，请在项目目录运行 uv sync')
    const run = { kind: 'creator-search', child: null, cancelled: false }
    this.operations.set(platform, run)
    this.publish()
    try {
      await this.sessions?.stop(platform)
      const targetId = await this.windows.prepare(platform)
      if (run.cancelled) return { items: [], hasMore: false, cancelled: true }
      // 抖音一次最多翻 3 页，按节流要等将近一分钟
      return await this.queryWorker(
        run,
        'creators',
        '搜索',
        {
          platform,
          action: 'creator-search',
          mode: 'search',
          query,
          limit: 20,
          cursor,
          targetId,
        },
        90000,
      )
    } finally {
      this.operations.delete(platform)
      this.publish()
    }
  }

  // 用户手动触发，占用平台互斥；各接口只请求一次，同样走平台节流
  async checkFeatures(platform) {
    if (!creatorPlatforms.includes(platform))
      throw new Error('该平台暂不支持功能体检')
    this.assertAvailable(platform)
    if (this.state.accounts[platform] !== 'connected')
      throw new Error('登录后才能体检')
    if (!existsSync(this.python))
      throw new Error('采集环境尚未安装，请在项目目录运行 uv sync')
    const run = { kind: 'feature-check', child: null, cancelled: false }
    this.operations.set(platform, run)
    this.publish()
    try {
      await this.sessions?.stop(platform)
      const targetId = await this.windows.prepare(platform)
      if (run.cancelled) return { items: [], hasMore: false, cancelled: true }
      return await this.queryWorker(
        run,
        'feature-check',
        '体检',
        {
          platform,
          action: 'feature-check',
          mode: 'search',
          query: '',
          limit: 20,
          targetId,
        },
        180000,
        (event) => this.reportFeatureProgress(platform, event),
      )
    } finally {
      delete this.state.featureCheck
      this.operations.delete(platform)
      this.publish()
    }
  }

  // 节流等待可能十几秒，告诉用户在等什么，别以为卡住了
  reportFeatureProgress(platform, event) {
    if (event.type === 'feature-progress')
      this.state.featureCheck = {
        platform,
        step: event.step,
        results: Array.isArray(event.results) ? event.results : [],
      }
    else if (
      event.type === 'log' &&
      event.event === 'pacing-wait' &&
      this.state.featureCheck
    )
      this.state.featureCheck = {
        ...this.state.featureCheck,
        waitSeconds: Math.round(event.detail?.seconds || 0),
      }
    else return
    this.publish()
  }

  // 一次性查询 worker：结果只回给调用方，取消时返回 cancelled，不进历史
  queryWorker(run, resultEvent, label, payload, timeoutMs = 45000, onEvent) {
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(
        this.python,
        ['-u', '-m', 'desktop.worker'],
        {
          cwd: this.root,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
          },
        },
      )
      run.child = child
      let result = null
      let message = ''
      const timer = setTimeout(() => {
        message = `${label}超时，请重试`
        child.kill('SIGKILL')
      }, timeoutMs)
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        try {
          const event = JSON.parse(line)
          onEvent?.(event)
          if (event.type === resultEvent) result = event
          else if (event.type === 'error') message = event.message
          else if (event.type === 'log')
            this.logger?.write(
              event.level === 'warn' ? 'warn' : 'info',
              'crawler',
              event.event,
              { platform: payload.platform, ...event.detail },
            )
        } catch {
          /* 非协议输出不进入页面 */
        }
      })
      child.stderr.resume()
      child.stdin.on('error', () => {})
      child.once('error', (error) => {
        this.logger?.write('error', 'crawler', 'spawn-failed', error)
        clearTimeout(timer)
        reject(new Error('采集进程无法启动，请检查 Python 环境'))
      })
      child.once('close', () => {
        clearTimeout(timer)
        lines.close()
        if (run.cancelled)
          resolve({ items: [], hasMore: false, cancelled: true })
        else if (result)
          resolve({
            items: Array.isArray(result.items) ? result.items : [],
            nextCursor: result.next_cursor || undefined,
            hasMore: result.has_more === true,
            ...(result.busy === true && { busy: true }),
            ...(result.throttled && {
              throttled: {
                code: result.throttled.code,
                retryAfter: result.throttled.retry_after,
                message: result.throttled.message,
              },
            }),
          })
        else reject(new Error(message || `${label}失败，请重试`))
      })
      child.stdin.end(
        JSON.stringify({ ...payload, endpoint: this.endpoint }) + '\n',
      )
    })
  }

  // 推荐流只读、不跳转页面，不占平台互斥；同平台只保留最新一次
  async loadFeed(platform, cursor) {
    if (!feedPlatforms.includes(platform)) throw new Error('该平台暂不支持推荐')
    if (
      cursor !== undefined &&
      (typeof cursor !== 'string' || !cursor || cursor.length > 4096)
    )
      throw new Error('翻页位置无效，请重试')
    if (this.state.accounts[platform] !== 'connected')
      throw new Error('登录后才能查看推荐')
    const page = await this.feed.load(platform, cursor)
    if (!page.cancelled && !page.throttled)
      this.rememberFeed(platform, page.items, !cursor)
    return page
  }

  async fetchFeed(platform, cursor, run) {
    if (!existsSync(this.python))
      throw new Error('采集环境尚未安装，请在项目目录运行 uv sync')
    const targetId = await this.windows.prepare(platform)
    if (run.cancelled) return { items: [], hasMore: false, cancelled: true }
    const page = await this.queryWorker(run, 'feed', '获取推荐', {
      platform,
      action: 'feed',
      mode: 'search',
      query: '',
      limit: 20,
      cursor,
      targetId,
      background: run.background,
      // 用户等着的请求排队有上限，超过就把等多久告诉界面
      waitLimit: run.background ? undefined : feedWaitLimit,
    })
    // 排查风控要能还原请求时间线
    this.logger?.write('info', 'crawler', 'feed-page', {
      platform,
      background: run.background,
      next: !!cursor,
      count: page.items.length,
      busy: !!page.busy,
      cancelled: !!page.cancelled,
      ...(page.throttled && { throttled: page.throttled.code }),
    })
    return page
  }

  cancelFeed(platform) {
    this.feed.cancel(platform)
  }

  keepFeedFresh(platform) {
    if (feedPlatforms.includes(platform)) this.feed.keepFresh(platform)
  }

  focusFeed(platform) {
    if (feedPlatforms.includes(platform)) this.feed.focus(platform)
  }

  // 卡片数据只留在内存，供详情和下载按 ID 找回，不写历史
  rememberFeed(platform, items, reset) {
    const known = reset ? new Map() : this.feedItems.get(platform) || new Map()
    for (const item of items)
      if (item?.id && item.platform === platform) known.set(item.id, item)
    while (known.size > feedMemoryLimit) known.delete(known.keys().next().value)
    this.feedItems.set(platform, known)
  }

  findItem(platform, id) {
    return (
      this.state.pages[platform]?.results?.find((item) => item.id === id) ||
      this.feedItems.get(platform)?.get(id)
    )
  }

  async runMedia(record, options) {
    const { kind } = options
    if (!existsSync(this.python))
      return {
        saved: 0,
        total: kind === 'images' ? record.images.length : 1,
        code: 'environment',
      }
    const job = this.mediaJob(record.platform, options.requestId)
    this.operations.set(record.platform, { kind, downloadJob: job })
    this.publish()
    try {
      if (this.sessions) await this.sessions.stop(record.platform)
      return await job.run({ record, ...options })
    } finally {
      this.operations.delete(record.platform)
      this.publish()
    }
  }

  resultsFor(platform, id) {
    const page = this.state.pages[platform]
    if (!page || page.id !== id) throw new Error('当前结果已更新，请重新导出')
    return page.results
  }

  async start(value) {
    const request = validateRequest(value)
    const running = this.operations.get(request.platform)
    if (running)
      this.logger?.write('warn', 'crawler', 'start-rejected', {
        platform: request.platform,
        running: running.kind,
        runningStatus: running.task?.status,
        runningContinued: !!running.task?.continued,
        action: request.action,
        mode: request.mode,
        cursor: !!request.cursor,
      })
    this.assertAvailable(request.platform)
    const python = this.python
    if (!existsSync(python))
      throw new Error('采集环境尚未安装，请在项目目录运行 uv sync')
    // 继续采集写回同一批次，换博主或记录已清空时不能拼接
    const previous = request.cursor ? this.state.pages[request.platform] : null
    if (
      request.cursor &&
      (previous?.task.mode !== request.mode ||
        previous.task.query !== request.query)
    )
      throw new Error('采集记录已变化，请重新开始')
    const task = {
      ...request,
      status: 'checking',
      message: '正在检查登录状态',
      startedAt: Date.now(),
    }
    delete task.cursor
    if (previous) {
      task.creator = previous.task.creator
      // 本批在拿到新游标前失败或被停止时，仍能从原位置继续
      task.nextCursor = request.cursor
      task.continued = true
    }
    const run = {
      kind: request.action,
      task,
      results: previous ? [...previous.results] : [],
      baseCount: previous?.results.length ?? 0,
      stopRequested: false,
    }
    this.operations.set(request.platform, run)
    this.state.tasks[request.platform] = task
    if (request.action === 'collect') {
      run.id = previous?.id || randomUUID()
      this.library.workspace.selections[request.platform] = run.id
      this.save(run)
      this.trackSave(this.library.saveWorkspace())
    }
    if (this.online?.() === false) {
      this.publish()
      task.failure = {
        code: 'NETWORK_OFFLINE',
        stage: 'connection',
        retryable: true,
      }
      this.finish(run, 'error', '网络已断开，请检查网络连接')
      return
    }
    if (request.action === 'connect' && !request.silent)
      this.windows.beginLogin(request.platform, request.loginMode)
    if (
      request.action === 'connect' &&
      request.loginMode === 'qrcode' &&
      !request.silent
    ) {
      run.loginTimer = setTimeout(() => {
        run.loginTimer = null
        void this.cancel(request.platform)
          .then(() => {
            if (
              this.state.tasks[request.platform] === task &&
              this.state.accounts[request.platform] !== 'connected'
            ) {
              task.failure = { code: 'TIMEOUT', stage: 'qr', retryable: true }
              this.finish(run, 'error', '获取二维码超时，请重试')
            }
          })
          .catch(() => {})
      }, healthPolicy.qr_timeout_ms)
      run.loginTimer.unref?.()
    }
    this.publish()
    try {
      await this.sessions?.stop(request.platform)
      if (this.operations.get(request.platform) !== run) return
      if (run.stopRequested) {
        this.finish(run, 'cancelled', '已取消')
        return
      }
      const targetId = await this.windows.prepare(request.platform)
      if (this.operations.get(request.platform) !== run) return
      if (run.stopRequested) {
        this.finish(run, 'cancelled', '已取消')
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
      run.child = child
      let terminal = false
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        try {
          const event = JSON.parse(line)
          if (run.stopRequested || terminal || run.child !== child) return
          if (event.type === 'diagnostic') {
            this.logger?.write('error', 'crawler', 'exception', {
              platform: request.platform,
              ...event.detail,
            })
          } else if (event.type === 'page') {
            task.nextCursor =
              typeof event.next_cursor === 'string' &&
              event.next_cursor.length <= 4096
                ? event.next_cursor
                : undefined
            task.exhausted = event.has_more === false
          } else if (event.type === 'creator') {
            const creator = creatorInfo(event.creator, request.platform)
            if (creator) task.creator = creator
          } else if (event.type === 'log') {
            this.logger?.write(
              event.level === 'warn' ? 'warn' : 'info',
              'crawler',
              event.event,
              { platform: request.platform, ...event.detail },
            )
          } else if (event.type === 'timing') {
            this.logger?.write('info', 'login', 'stage', {
              platform: request.platform,
              stage: event.stage,
              milliseconds: event.milliseconds,
              reused: event.reused,
            })
          } else if (event.type === 'state') {
            if (request.silent && event.status === 'auth') return
            Object.assign(task, {
              status: event.status,
              message: event.message,
            })
            if (event.status === 'auth') {
              this.state.accounts[request.platform] = 'expired'
              delete this.state.profiles[request.platform]
              if (!request.silent)
                this.windows.show(request.platform, request.loginMode)
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
            task.warning = event.message
          } else if (event.type === 'item-update') {
            const index = run.results.findIndex(
              (item) => item.id === event.item?.id,
            )
            if (index !== -1) {
              run.results[index] = event.item
              this.save(run)
            }
          } else if (event.type === 'item') {
            if (!run.results.some((item) => item.id === event.item.id))
              run.results.push(event.item)
            this.save(run)
          } else if (event.type === 'done' || event.type === 'error') {
            terminal = true
            if (event.failure) task.failure = event.failure
            this.finish(
              run,
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
        if (run.stopRequested) {
          terminal = true
          this.finish(run, 'cancelled', '已取消', false)
          return
        }
        this.logger?.write('error', 'crawler', 'spawn-failed', error)
        terminal = true
        this.finish(run, 'error', '采集进程无法启动，请检查 Python 环境', false)
      })
      child.once('close', (exitCode, signal) => {
        if (!terminal && !run.stopRequested)
          this.logger?.write('error', 'crawler', 'process-ended', {
            exitCode,
            signal,
          })
        run.child = null
        this.operations.delete(request.platform)
        if (run.stopRequested)
          this.finish(run, 'cancelled', '已取消，已获取的结果已保留')
        else if (!terminal)
          this.finish(run, 'error', '采集进程意外结束，请重试')
        else this.publish()
        lines.close()
      })
      child.stdin.end(
        JSON.stringify({ ...request, targetId, endpoint: this.endpoint }) +
          '\n',
      )
    } catch (error) {
      if (this.operations.get(request.platform) !== run) return
      if (run.stopRequested) {
        this.finish(run, 'cancelled', '已取消')
        return
      }
      this.finish(run, 'error', error.message)
      throw error
    }
  }

  finish(run, status, message, release = true) {
    const { task } = run
    clearTimeout(run.loginTimer)
    if (status === 'error')
      this.logger?.write('error', 'crawler', 'failed', {
        platform: task?.platform,
        message,
        code: task?.failure?.code,
        stage: task?.failure?.stage,
        mode: task?.mode,
        continued: !!task?.continued,
      })
    if (task.action === 'collect')
      this.logger?.write('info', 'crawler', 'run-finished', {
        platform: task.platform,
        status,
        mode: task.mode,
        auto: task.auto,
        continued: !!task.continued,
        total: run.results.length,
        added: run.results.length - (run.baseCount ?? 0),
        milliseconds: Date.now() - task.startedAt,
        hasMore: !!task.nextCursor,
      })
    if (release && this.operations.get(task.platform) === run)
      this.operations.delete(task.platform)
    Object.assign(task, { status, message, finishedAt: Date.now() })
    if (task.continued && status === 'completed')
      task.stalled = run.results.length === run.baseCount
    this.windows.hide(task.platform)
    if (status === 'cancelled' || status === 'error') {
      for (const item of run.results) {
        if (['pending', 'running'].includes(item.commentStatus))
          item.commentStatus = status
      }
    }
    this.save(run)
    this.publish()
  }

  dismissLogin() {
    const platform = this.windows.presentation?.platform
    if (['checking', 'auth'].includes(this.state.tasks[platform]?.status))
      return this.cancel(platform)
  }

  async stopAll() {
    await Promise.all(
      [
        ...this.details.values(),
        ...[...this.transcripts.values()].map(({ job }) => job),
      ].map((job) => job.cancel()),
    )
    this.feed.close()
    await Promise.all(
      [...this.operations.keys()].map((platform) => this.cancel(platform)),
    )
  }

  async cancel(platform) {
    if (!Object.hasOwn(platforms, platform)) throw new Error('不支持的平台')
    const run = this.operations.get(platform)
    if (!run) return
    if (run.kind === 'creator-search') {
      run.cancelled = true
      run.child?.kill('SIGKILL')
      return
    }
    if (run.downloadJob) return run.downloadJob.cancel()
    if (run.kind === 'logout') return run.done?.catch(() => {})
    clearTimeout(run.loginTimer)
    if (run.cancellation) return run.cancellation
    if (run.stopRequested) return
    run.stopRequested = true
    run.task.status = 'stopping'
    run.task.message = '正在停止'
    this.windows.hide(platform)
    this.publish()
    const child = run.child
    if (!child) return
    run.cancellation = new Promise((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2500)
      child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
    return run.cancellation
  }
}
