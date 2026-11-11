const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('studio', {
  platform: process.platform,
  healthCheck: () => ipcRenderer.invoke('studio:health-check'),
  resolveHandoff: (accepted) =>
    ipcRenderer.invoke('studio:resolve-handoff', accepted),
  cliStatus: () => ipcRenderer.invoke('studio:cli-status'),
  cliInstall: (action) => ipcRenderer.invoke('studio:cli-install', action),
  openLogs: () => ipcRenderer.invoke('studio:open-logs'),
  snapshot: () => ipcRenderer.invoke('studio:snapshot'),
  start: (request) => ipcRenderer.invoke('studio:start', request),
  cancel: (platform) => ipcRenderer.invoke('studio:cancel', platform),
  setLoginForeground: (platform) =>
    ipcRenderer.invoke('studio:login-foreground', platform),
  ensureLogin: (platform) =>
    ipcRenderer.invoke('studio:ensure-login', platform),
  retryLogin: (platform) => ipcRenderer.invoke('studio:retry-login', platform),
  refreshLogin: (platform) =>
    ipcRenderer.invoke('studio:refresh-login', platform),
  stopLogin: (platform) => ipcRenderer.invoke('studio:stop-login', platform),
  resolveVideo: (platform, id, requestId) =>
    ipcRenderer.invoke('studio:resolve-video', platform, id, requestId),
  loadFeed: (platform, cursor) =>
    ipcRenderer.invoke('studio:load-feed', platform, cursor),
  cancelFeed: (platform) => ipcRenderer.invoke('studio:cancel-feed', platform),
  focusFeed: (platform) => ipcRenderer.invoke('studio:focus-feed', platform),
  keepFeedFresh: (platform) =>
    ipcRenderer.invoke('studio:keep-feed-fresh', platform),
  loadComments: (platform, id, options) =>
    ipcRenderer.invoke('studio:load-comments', platform, id, options),
  sttStatus: () => ipcRenderer.invoke('studio:stt-status'),
  saveTranscript: (platform, id, format, ask) =>
    ipcRenderer.invoke('studio:save-transcript', platform, id, format, ask),
  cachedTranscript: (platform, id) =>
    ipcRenderer.invoke('studio:cached-transcript', platform, id),
  transcribe: (platform, id) =>
    ipcRenderer.invoke('studio:transcribe', platform, id),
  cachedImageText: (platform, id) =>
    ipcRenderer.invoke('studio:cached-image-text', platform, id),
  recognizeImages: (platform, id) =>
    ipcRenderer.invoke('studio:recognize-images', platform, id),
  captureFrame: (rect) => ipcRenderer.invoke('studio:capture-frame', rect),
  // 开发版探针用，安装版主进程不注册这两个通道
  debugWindow: () => ipcRenderer.invoke('studio:debug-window'),
  debugShowWindow: () => ipcRenderer.invoke('studio:debug-show-window'),
  recognizeFrame: (platform, png) =>
    ipcRenderer.invoke('studio:recognize-frame', platform, png),
  saveFrame: (platform, id, png, seconds, ask) =>
    ipcRenderer.invoke('studio:save-frame', platform, id, png, seconds, ask),
  loadDetail: (platform, id, options) =>
    ipcRenderer.invoke('studio:load-detail', platform, id, options),
  cancelDetail: (platform, id) =>
    ipcRenderer.invoke('studio:cancel-detail', platform, id),
  cancelVideo: (requestId) =>
    ipcRenderer.invoke('studio:cancel-video', requestId),
  cacheSize: () => ipcRenderer.invoke('studio:cache-size'),
  clearCache: () => ipcRenderer.invoke('studio:clear-cache'),
  clearSessions: () => ipcRenderer.invoke('studio:clear-sessions'),
  logout: (platform) => ipcRenderer.invoke('studio:logout', platform),
  downloadMedia: (
    platform,
    id,
    kind,
    askBeforeDownload = false,
    quality = 'best',
  ) =>
    ipcRenderer.invoke(
      'studio:download-media',
      platform,
      id,
      kind,
      askBeforeDownload,
      quality,
    ),
  captureLoginQr: (platform, refresh) =>
    ipcRenderer.invoke('studio:login-qr', platform, refresh),
  showLogin: (mode, platform) =>
    ipcRenderer.invoke('studio:show-login', mode, platform),
  attachLogin: (platform, bounds) =>
    ipcRenderer.invoke('studio:attach-login', platform, bounds),
  detachLogin: (platform) =>
    ipcRenderer.invoke('studio:detach-login', platform),
  focusLogin: () => ipcRenderer.invoke('studio:focus-login'),
  dismissLogin: () => ipcRenderer.invoke('studio:dismiss-login'),
  resolveCreatorLink: (url) =>
    ipcRenderer.invoke('studio:resolve-creator-link', url),
  checkFeatures: (platform) =>
    ipcRenderer.invoke('studio:check-features', platform),
  searchCreators: (platform, keyword, cursor) =>
    ipcRenderer.invoke('studio:search-creators', platform, keyword, cursor),
  saveDraft: (platform, form) =>
    ipcRenderer.invoke('studio:save-draft', platform, form),
  openHistory: (id) => ipcRenderer.invoke('studio:open-history', id),
  clearResults: (platform) =>
    ipcRenderer.invoke('studio:clear-results', platform),
  export: (format, platform, id) =>
    ipcRenderer.invoke('studio:export', format, platform, id),
  openSource: (url) => ipcRenderer.invoke('studio:open-source', url),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('studio:state', listener)
    return () => ipcRenderer.removeListener('studio:state', listener)
  },
})
