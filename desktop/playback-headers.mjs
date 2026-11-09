const xhsReferer = 'https://www.xiaohongshu.com/'
const refererFor = (url) =>
  new URL(url).hostname.endsWith('.xhscdn.com')
    ? xhsReferer
    : 'https://www.douyin.com/'

// 播放媒体沿用平台 Referer，不携带登录凭据；不影响网页或 B站 iframe
export function installPlaybackHeaders(contents) {
  contents.session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://www.douyin.com/*',
        'https://*.douyinvod.com/*',
        'https://*.xhscdn.com/*',
      ],
    },
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
}
