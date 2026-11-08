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
  comments?: boolean
  replies?: boolean
  filters?: Record<string, string>
  cursor?: string
  silent?: boolean
  loginMode?: LoginMode
}

export interface ContentComment {
  id: string
  parentId: string
  author: string
  text: string
  likes: string
}

export type CommentStatus =
  'pending' | 'running' | 'completed' | 'error' | 'cancelled'

export interface ContentItem {
  id: string
  platform: Platform
  title: string
  text: string
  author: string
  url: string
  images: string[]
  likes: string
  collectedAt: string
  contentType?: string
  media?: {
    status: string
    variants: {
      id: string
      kind: 'video' | 'audio'
      width?: number | null
      height?: number | null
      bitrate?: number | null
      hasAudio?: boolean | null
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

export interface CreatorPage {
  items: CreatorSummary[]
  nextCursor?: string
  hasMore: boolean
  cancelled?: boolean
}

export interface StudioTask extends CollectRequest {
  creator?: { name: string; url: string }
  nextCursor?: string
  status: TaskStatus
  message: string
  startedAt: number
  finishedAt?: number
  warning?: string
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
  failure?: { code: string; stage: string; retryable?: boolean }
}

export interface StudioState {
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
  ensureLogin?(platform: Platform): Promise<void>
  retryLogin?(platform: Platform): Promise<void>
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
