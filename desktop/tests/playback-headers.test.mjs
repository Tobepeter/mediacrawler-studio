import test from 'node:test'
import assert from 'node:assert/strict'
import { installPlaybackHeaders } from '../playback-headers.mjs'

test('仅调整主界面媒体请求，保留 Range 且不转发登录凭据', () => {
  let listener
  const contents = {
    id: 1,
    getUserAgent: () => 'Chrome/146.0 Electron/45.0 MediaCrawlerStudio/1.0',
    session: {
      webRequest: {
        onBeforeSendHeaders(filter, handler) {
          assert.deepEqual(filter.urls, [
            'https://www.douyin.com/*',
            'https://*.douyinvod.com/*',
            'https://*.xhscdn.com/*',
          ])
          listener = handler
        },
      },
    },
  }
  installPlaybackHeaders(contents)
  const requestHeaders = {
    Cookie: 'private',
    Authorization: 'private',
    Origin: 'file://',
    Referer: 'http://localhost',
    Range: 'bytes=100-',
  }
  const url = 'https://v1.douyinvod.com/video.mp4'
  let result
  listener(
    { url, webContentsId: 1, resourceType: 'media', requestHeaders },
    (response) => (result = response.requestHeaders),
  )
  assert.deepEqual(result, {
    Referer: 'https://www.douyin.com/',
    Range: 'bytes=100-',
    'User-Agent': 'Chrome/146.0',
  })
  assert.equal(requestHeaders.Cookie, 'private')
  listener(
    {
      url: 'https://sns-video-v3.xhscdn.com/video.mp4',
      webContentsId: 1,
      resourceType: 'media',
      requestHeaders,
    },
    (response) => (result = response.requestHeaders),
  )
  assert.equal(result.Referer, 'https://www.xiaohongshu.com/')
  assert.equal(result.Cookie, undefined)
  listener(
    { url, webContentsId: 2, resourceType: 'media', requestHeaders },
    (response) => (result = response.requestHeaders),
  )
  assert.deepEqual(result, requestHeaders)
  listener(
    { url, webContentsId: 1, resourceType: 'xhr', requestHeaders },
    (response) => (result = response.requestHeaders),
  )
  assert.deepEqual(result, requestHeaders)
})
