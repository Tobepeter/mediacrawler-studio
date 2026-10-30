import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { captureLoginQr } from '../login-qr.mjs'

function fixture(rect = { x: 20, y: 30, width: 200, height: 200 }) {
  const commands = []
  const contents = new EventEmitter()
  contents.isDestroyed = () => false
  contents.executeJavaScript = async () => rect
  contents.reload = () => {
    commands.push('reload')
    queueMicrotask(() => contents.emit('dom-ready'))
  }
  contents.debugger = {
    attach: () => commands.push('attach'),
    detach: () => commands.push('detach'),
    sendCommand: async (method, args) => {
      commands.push([method, args])
      return method === 'Page.captureScreenshot' ? { data: 'cG5n' } : {}
    },
  }
  return { page: { webContents: contents }, commands }
}

test('截取指定区域，恢复 viewport，不刷新当前扫码页', async () => {
  const { page, commands } = fixture()
  assert.deepEqual(await captureLoginQr(page, 'dy', false, () => true), {
    image: 'data:image/png;base64,cG5n',
  })
  assert.equal(commands.includes('reload'), false)
  assert.deepEqual(
    commands.find(([method]) => method === 'Page.captureScreenshot')[1].clip,
    { x: 20, y: 30, width: 200, height: 200, scale: 1 },
  )
  assert.equal(commands.at(-2)[0], 'Emulation.clearDeviceMetricsOverride')
  assert.equal(commands.at(-1), 'detach')
})

test('手动刷新重新加载平台，过期二维码不当作有效图片返回', async () => {
  const { page, commands } = fixture({ expired: true })
  assert.deepEqual(await captureLoginQr(page, 'dy', true, () => true), {
    code: 'expired',
  })
  assert.equal(commands[0], 'reload')
  assert.equal(
    commands.some(([method]) => method === 'Page.captureScreenshot'),
    false,
  )
  assert.equal(commands.at(-1), 'detach')
})

test('切换模式或关闭后的结果丢弃；截图失败也释放调试会话', async () => {
  const { page, commands } = fixture()
  let active = true
  page.webContents.executeJavaScript = async () => {
    active = false
    return { x: 0, y: 0, width: 100, height: 100 }
  }
  assert.deepEqual(await captureLoginQr(page, 'dy', false, () => active), {
    code: 'cancelled',
  })
  assert.equal(commands.at(-1), 'detach')
  const broken = fixture()
  broken.page.webContents.executeJavaScript = async () => {
    throw new Error('private platform content')
  }
  assert.deepEqual(await captureLoginQr(broken.page, 'dy', false, () => true), {
    code: 'unavailable',
  })
  assert.equal(broken.commands.at(-1), 'detach')
})

test('首次取码等待异步登录框，并允许触发尚未就绪的登录入口', async () => {
  const { page, commands } = fixture()
  let attempts = 0
  page.webContents.executeJavaScript = async (script) => {
    attempts++
    // 首次加载也允许点登录，不必等待用户刷新整页
    assert.match(script, /, true\)$/)
    if (attempts === 1) return null
    return { image: 'data:image/png;base64,cG5n' }
  }
  assert.deepEqual(await captureLoginQr(page, 'dy', false, () => true), {
    image: 'data:image/png;base64,cG5n',
  })
  assert.equal(attempts, 2)
  assert.equal(commands.includes('reload'), false)
})

test('SPA 登录页跳转打断首次读取后继续取码', async () => {
  const { page } = fixture()
  let attempts = 0
  page.webContents.executeJavaScript = async () => {
    if (++attempts === 1)
      throw new Error(
        'Execution context was destroyed, most likely because of a navigation',
      )
    return { image: 'data:image/png;base64,cG5n' }
  }
  assert.deepEqual(await captureLoginQr(page, 'dy', false, () => true), {
    image: 'data:image/png;base64,cG5n',
  })
  assert.equal(attempts, 2)
})
