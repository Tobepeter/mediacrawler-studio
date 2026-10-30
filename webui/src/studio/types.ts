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
  mode: 'search' | 'link'
  query: string
  limit: number
  action: 'collect' | 'connect'
  comments?: boolean
  replies?: boolean
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
  comments?: ContentComment[]
  commentStatus?: CommentStatus
}

export interface StudioTask extends CollectRequest {
  status: TaskStatus
  message: string
  startedAt: number
  finishedAt?: number
  warning?: string
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

export interface StudioState {
  loginView?: {
    platform: Platform
    mode: LoginMode
    preparing?: boolean
  } | null
  busy: boolean
  profiles: Partial<Record<Platform, AccountProfile>>
  mode: 'desktop' | 'preview'
  accounts: Partial<Record<Platform, AccountStatus>>
  task: StudioTask | null
  results: ContentItem[]
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

export interface StudioBridge {
  cliStatus(): Promise<CliStatus>
  cliInstall(
    action: 'install' | 'remove',
  ): Promise<{ ok: true; state: CliStatus } | { ok: false; code: string }>
  readonly platform: string
  snapshot(): Promise<StudioState>
  start(request: CollectRequest): Promise<void>
  cancel(): Promise<void>
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
  ): Promise<DownloadResult>
  captureLoginQr(
    platform: Platform,
    refresh?: boolean,
  ): Promise<{ image?: string; code?: 'cancelled' | 'expired' | 'unavailable' }>
  showLogin(mode?: LoginMode): Promise<void>
  attachLogin(
    platform: Platform,
    bounds: { x: number; y: number; width: number; height: number },
  ): Promise<boolean>
  detachLogin(platform: Platform): Promise<void>
  focusLogin(): Promise<void>
  dismissLogin(): Promise<void>
  saveDraft(platform: Platform, form: PlatformForm): Promise<void>
  openHistory(id: string): Promise<Collection>
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
