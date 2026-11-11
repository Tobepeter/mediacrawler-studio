const xhsReferer = 'https://www.xiaohongshu.com/'
const refererFor = (url) =>
  new URL(url).hostname.endsWith('.xhscdn.com')
    ? xhsReferer
    : 'https://www.douyin.com/'

// 播放媒体沿用平台 Referer，不携带登录凭据；不影响网页或 B站 iframe
export function installPlaybackHeaders(contents) {
  const filter = {
    urls: [
      'https://www.douyin.com/*',
      'https://*.douyinvod.com/*',
      'https://*.douyinstatic.com/*',
      'https://*.xhscdn.com/*',
    ],
  }
  contents.session.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      if (
        details.webContentsId === contents.id &&
        details.resourceType === 'media'
      ) {
        for (const name of Object.keys(headers)) {
          if (
            ['cookie', 'authorization', 'origin', 'referer'].includes(
              name.toLowerCase(),
            )
          )
            delete headers[name]
        }
        headers.Referer = refererFor(details.url)
        headers['User-Agent'] = contents
          .getUserAgent()
          .replace(/ Electron\/\S+/, '')
          .replace(/ MediaCrawlerStudio\/\S+/, '')
      }
      callback({ requestHeaders: headers })
    },
  )
  // 暂停时取当前帧要把视频画进画布，平台不给跨域头，这里只对本窗口的媒体响应补上
  contents.session.webRequest.onHeadersReceived(filter, (details, callback) => {
    if (
      details.webContentsId !== contents.id ||
      details.resourceType !== 'media'
    )
      return callback({})
    const responseHeaders = { ...details.responseHeaders }
    for (const name of Object.keys(responseHeaders))
      if (name.toLowerCase() === 'access-control-allow-origin')
        delete responseHeaders[name]
    responseHeaders['Access-Control-Allow-Origin'] = ['*']
    callback({ responseHeaders })
  })
}
