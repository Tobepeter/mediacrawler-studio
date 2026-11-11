export type Platform = 'bili' | 'dy' | 'xhs' | 'zhihu' | 'wb' | 'tieba' | 'ks'
export type LoginMode = 'embedded' | 'window' | 'qrcode'
export type AccountStatus = 'unknown' | 'saved' | 'connected' | 'expired'
export type TaskStatus =
  | 'checking'
  | 'auth'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'cancelled'
  | 'error'
  | 'restored'

export interface CollectRequest {
  platform: Platform
  mode: 'search' | 'link' | 'creator'
  query: string
  limit: number
  action: 'collect' | 'connect'
  filters?: Record<string, string>
  cursor?: string
  // 抖音默认：按批采集，滚动到底继续；false 表示用户选了固定数量
  auto?: boolean
  silent?: boolean
  loginMode?: LoginMode
}

export interface FeatureResult {
  id: 'feed' | 'creator' | 'detail' | 'download' | 'search'
  status: 'ok' | 'degraded' | 'failed' | 'skipped'
  count?: number
  expected?: number
  missing?: string[]
  message?: string
}

export interface ContentComment {
  id: string
  parentId: string
  author: string
  text: string
  likes: string
  replyCount?: number
}

export interface CommentPage {
  code: string
  items: ContentComment[]
  nextCursor: string | number | null
  hasMore: boolean
  throttleCode?: string
  retryAfter?: number
  message?: string
}

export type CommentStatus =
  'pending' | 'running' | 'completed' | 'error' | 'cancelled'

export interface FeedPage {
  items: ContentItem[]
  nextCursor?: string
  hasMore: boolean
  throttled?: { code: string; retryAfter: number; message: string }
  cancelled?: boolean
}

export interface ContentTranscript {
  source: 'stt' | 'subtitle'
  model?: string
  language?: string
  text: string
  segments: { start: number; end: number; text: string }[]
  createdAt: string
}

// 图中文字：图文帖逐张识别，或视频暂停时识别当前画面
export interface ContentImageText {
  source: 'ocr'
  text: string
  images: { index: number; text: string }[]
  createdAt: string
}

// 和 desktop/stt-status.mjs 的 missingOf 对应
export interface SttMissing {
  id: string
  kind: 'model' | 'dependency' | 'ffmpeg' | 'platform' | string
  name: string
  message: string
  sizeBytes: number | null
  path: string | null
  files: string[]
  hint: string
  pages: { hub: 'modelscope' | 'huggingface'; url: string }[]
}

export interface SttStatus {
  // ready 服务已连上；installed 条件齐了、提取时启动；incomplete 缺模型或依赖；missing 没有 stt
  state: 'ready' | 'installed' | 'incomplete' | 'missing'
  busy: boolean
  source: 'bundled' | 'system' | null
  path: string | null
  version: string | null
  missing?: SttMissing[]
  downloadBytes?: number
}

export interface ContentItem {
  id: string
  platform: Platform
  title: string
  text: string
  // 带结构的正文，有就按文章排版显示；旧记录和其他平台没有
  markdown?: string
  author: string
  // 博主主页；旧记录和链接采集可能没有，此时按名字搜
  authorUrl?: string
  url: string
  images: string[]
  likes: string
  collectedAt: string
  contentType?: string
  feed?: boolean
  // 只有列表字段，详情回来后合并进这条记录并清掉
  detailPending?: boolean
  media?: {
    status: string
    variants: {
      id: string
      kind: 'video' | 'audio'
      url?: string
      backupUrls?: string[]
      codec?: string | null
      width?: number | null
      height?: number | null
      bitrate?: number | null
      hasAudio?: boolean | null
    }[]
  }
  durationSeconds?: number | null
  subtitles?: {
    status: string
    items: {
      language?: string
      segments?: ContentTranscript['segments']
    }[]
  }
  comments?: ContentComment[]
  commentStatus?: CommentStatus
}

export interface CreatorSummary {
  id: string
  name: string
  uniqueId: string
  avatar: string
  signature: string
  followers: number | null
  posts: number | null
  verified: string
  private: boolean
  source: 'user' | 'video'
  url: string
}

export interface CreatorInfo {
  name: string
  url: string
  avatar?: string
  followers?: number | null
  posts?: number | null
}

export interface CreatorPage {
  items: CreatorSummary[]
  nextCursor?: string
  hasMore: boolean
  cancelled?: boolean
}

export interface StudioTask extends CollectRequest {
  creator?: CreatorInfo
  nextCursor?: string
  exhausted?: boolean
  continued?: boolean
  // 续采一批没有新增内容，停止自动加载，避免对同一位置反复请求
  stalled?: boolean
  status: TaskStatus
  message: string
  startedAt: number
  finishedAt?: number
  warning?: string
  // 采集正文之后取评论时是 comments，底栏据此显示“采集评论”
  stage?: 'comments'
  failure?: { code: string; stage: string; retryable?: boolean }
}

export type PlatformForm = Omit<CollectRequest, 'action'>

export interface Collection {
  id: string
  task: StudioTask
  results: ContentItem[]
}

export interface HistoryEntry {
  id: string
  task: StudioTask
  count: number
}

export interface AccountProfile {
  nickname: string
  avatar: string
}

export interface PlatformLoginState {
  retrying?: boolean
  id?: string
  status:
    | 'queued'
    | 'preparing'
    | 'ready'
    | 'confirming'
    | 'connected'
    | 'error'
    | 'expired'
    | 'paused'
  scheduledAt?: number
  startedAt?: number
  updatedAt?: number
  image?: string
  refreshing?: boolean
  failure?: { code: string; stage: string; retryable?: boolean }
}

export interface StudioState {
  featureCheck?: {
    platform: Platform
    step: string
    results?: FeatureResult[]
    waitSeconds?: number
  }
  // 另一个版本正等着启动
  handoff?: { build: 'dev' | 'packaged' }
  healthCheck?: {
    stage: 'network' | 'platforms' | 'done'
    completed: number
    total: number
  }
  logins?: Partial<Record<Platform, PlatformLoginState>>
  policy?: {
    qr_timeout_ms: number
    timeout_threshold: number
    failure_window_ms: number
  }
  loginView?: {
    platform: Platform
    mode: LoginMode
    preparing?: boolean
  } | null
  busy: boolean
  profiles: Partial<Record<Platform, AccountProfile>>
  mode: 'desktop' | 'preview'
  accounts: Partial<Record<Platform, AccountStatus>>
  tasks: Partial<Record<Platform, StudioTask>>
  working: Partial<Record<Platform, string>>
  pages: Partial<Record<Platform, Collection>>
  history: HistoryEntry[]
  drafts: Partial<Record<Platform, PlatformForm>>
}

export interface CliStatus {
  supported: boolean
  development: boolean
  available: boolean
  installed: boolean
  conflict: boolean
  path: string
}

export interface HealthReport {
  failure?: { code: string; stage?: string }
  network?: {
    error?: { code: string; stage?: string }
    local?: { internet: string; status: string }
  }
  platforms: {
    platform: Platform
    status: string
    error?: { code: string; stage?: string }
  }[]
}

export interface StudioBridge {
  setLoginForeground?(platform: Platform | null): Promise<void>
  healthCheck?(): Promise<HealthReport>
  resolveHandoff?(accepted: boolean): Promise<void>
  checkFeatures?(
    platform: Platform,
  ): Promise<{ items: FeatureResult[]; cancelled?: boolean }>
  ensureLogin?(platform: Platform): Promise<void>
  retryLogin?(platform: Platform): Promise<void>
  refreshLogin?(platform: Platform): Promise<void>
  stopLogin?(platform: Platform): Promise<void>
  cliStatus(): Promise<CliStatus>
  cliInstall(
    action: 'install' | 'remove',
  ): Promise<{ ok: true; state: CliStatus } | { ok: false; code: string }>
  readonly platform: string
  snapshot(): Promise<StudioState>
  start(request: CollectRequest): Promise<void>
  cancel(platform: Platform): Promise<void>
  resolveVideo(
    platform: Platform,
    id: string,
    requestId: string,
  ): Promise<{ urls: string[]; code: string }>
  cancelVideo(requestId: string): Promise<void>
  loadComments?(
    platform: Platform,
    id: string,
    options?: { cursor?: string | number; parent?: string },
  ): Promise<CommentPage>
  sttStatus?(): Promise<SttStatus>
  ocrStatus?(): Promise<{ state: 'ready' | 'missing' | 'unknown' }>
  sttOpen?(kind: 'page' | 'folder', target: string): Promise<void>
  saveTranscript?(
    platform: Platform,
    id: string,
    format: 'srt' | 'txt',
    ask?: boolean,
  ): Promise<{ saved: boolean; name?: string }>
  cachedTranscript?(
    platform: Platform,
    id: string,
  ): Promise<ContentTranscript | null>
  transcribe?(
    platform: Platform,
    id: string,
  ): Promise<{
    code: string
    transcript?: ContentTranscript
    retryAfter?: number
    message?: string
  }>
  cachedImageText?(
    platform: Platform,
    id: string,
  ): Promise<ContentImageText | null>
  recognizeImages?(
    platform: Platform,
    id: string,
  ): Promise<{ code: string; imageText?: ContentImageText; message?: string }>
  debugWindow?(): Promise<{
    visible: boolean
    minimized: boolean
    focused: boolean
  }>
  debugShowWindow?(): Promise<void>
  recognizeFrame?(
    platform: Platform,
    png: Uint8Array,
  ): Promise<{ code: string; imageText?: ContentImageText }>
  saveFrame?(
    platform: Platform,
    id: string,
    png: Uint8Array,
    seconds: number,
    ask?: boolean,
  ): Promise<{ saved: boolean; name?: string }>
  loadDetail?(
    platform: Platform,
    id: string,
    options?: { background?: boolean },
  ): Promise<{
    code: string
    item?: ContentItem
    throttleCode?: string
    retryAfter?: number
    message?: string
  }>
  loadFeed?(platform: Platform, cursor?: string): Promise<FeedPage>
  cancelFeed?(platform: Platform): Promise<void>
  focusFeed?(platform: Platform): Promise<void>
  keepFeedFresh?(platform: Platform): Promise<void>
  cancelDetail?(platform: Platform, id: string): Promise<void>
  cacheSize?(): Promise<number>
  clearCache?(): Promise<void>
  clearSessions(): Promise<{ localOnly: boolean }>
  logout(platform: Platform): Promise<{ localOnly: boolean }>
  downloadMedia(
    platform: Platform,
    id: string,
    kind: 'images' | 'video',
    askBeforeDownload?: boolean,
    quality?: string,
  ): Promise<DownloadResult>
  captureLoginQr(
    platform: Platform,
    refresh?: boolean,
  ): Promise<{
    image?: string
    code?: 'cancelled' | 'expired' | 'unavailable' | 'confirming' | 'pending'
  }>
  showLogin(mode?: LoginMode, platform?: Platform): Promise<void>
  attachLogin(
    platform: Platform,
    bounds: { x: number; y: number; width: number; height: number },
  ): Promise<boolean>
  detachLogin(platform: Platform): Promise<void>
  focusLogin(): Promise<void>
  dismissLogin(): Promise<void>
  saveDraft(platform: Platform, form: PlatformForm): Promise<void>
  openHistory(id: string): Promise<Collection>
  clearResults(platform: Platform): Promise<void>
  resolveCreatorLink?(url: string): Promise<string | null>
  searchCreators?(
    platform: Platform,
    keyword: string,
    cursor?: string,
  ): Promise<CreatorPage>
  export(
    format: 'csv' | 'json',
    platform: Platform,
    id: string,
  ): Promise<boolean>
  openLogs(): Promise<void>
  openSource(url: string): Promise<void>
  subscribe(callback: (state: StudioState) => void): () => void
}

export interface DownloadResult {
  saved: number
  total: number
  code: string
}

declare global {
  interface Window {
    studio?: StudioBridge
  }
}
