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
  let result
  listener(
    { webContentsId: 1, resourceType: 'media', requestHeaders },
    (response) => (result = response.requestHeaders),
  )
  assert.deepEqual(result, {
    Referer: 'https://www.douyin.com/',
    Range: 'bytes=100-',
    'User-Agent': 'Chrome/146.0',
  })
  assert.equal(requestHeaders.Cookie, 'private')
  listener(
    { webContentsId: 2, resourceType: 'media', requestHeaders },
    (response) => (result = response.requestHeaders),
  )
  assert.deepEqual(result, requestHeaders)
  listener(
    { webContentsId: 1, resourceType: 'xhr', requestHeaders },
    (response) => (result = response.requestHeaders),
  )
  assert.deepEqual(result, requestHeaders)
})
