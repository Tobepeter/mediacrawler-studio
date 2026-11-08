import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { inspectQr } from '../qr-inspect.mjs'
import { captureLoginQr } from '../login-qr.mjs'

for (const label of ['登录', '立即\n登录'])
  test(`div 或分行登录入口可以触发：${JSON.stringify(label)}`, async () => {
    const { page } = fixture()
    let clicked = false
    const entry = {
      textContent: label,
      getBoundingClientRect: () => ({ width: 40, height: 40 }),
      click: () => {
        clicked = true
      },
    }
    page.webContents.executeJavaScript = async (script) => {
      if (clicked) return { image: 'data:image/png;base64,cG5n' }
      return runInNewContext(script, {
        document: {
          querySelectorAll: (selector) =>
            selector.includes('.header-avatar-unlogin-entry') ? [entry] : [],
        },
        getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
      })
    }
    assert.deepEqual(await captureLoginQr(page, 'bili', false, () => true), {
      image: 'data:image/png;base64,cG5n',
    })
    assert.equal(clicked, true)
  })

function fixture(rect = { x: 20, y: 30, width: 200, height: 200 }) {
  const commands = []
  const contents = new EventEmitter()
  contents.isDestroyed = () => false
  contents.executeJavaScript = async (script) => {
    if (
      script.includes('"refresh":"manual"') ||
      script.includes('"refresh":"expired"')
    ) {
      if (rect?.confirming) return rect
      contents.reload()
      return { reloading: true }
    }
    return rect
  }
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
  assert.deepEqual(commands, [])
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
    if (script.endsWith(', false)')) return null
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

test('热页面直接返回二维码，不挂调试器、不改变视口，失效码不复用', async () => {
  const ready = fixture({ image: 'data:image/png;base64,cG5n' })
  assert.deepEqual(await captureLoginQr(ready.page, 'dy', false, () => true), {
    image: 'data:image/png;base64,cG5n',
  })
  assert.deepEqual(ready.commands, [])
  const expired = fixture({ expired: true })
  assert.deepEqual(
    await captureLoginQr(expired.page, 'dy', false, () => true),
    {
      code: 'expired',
    },
  )
  assert.deepEqual(expired.commands, [])
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

test('确认中优先于过期；过期复核已变为新码时不刷新', () => {
  let reloads = 0
  const region = {
    innerText: '二维码已过期\n扫码成功，请在手机上确认',
    getBoundingClientRect: () => ({ width: 300, height: 300 }),
  }
  const env = {
    document: {
      querySelectorAll: (selector) => (selector === 'qr' ? [] : [region]),
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    location: { reload: () => reloads++ },
  }
  const inspect = (refresh) =>
    JSON.parse(
      JSON.stringify(
        runInNewContext(
          `(${inspectQr.toString()})('qr', false, {refresh: ${JSON.stringify(refresh)}})`,
          env,
        ),
      ),
    )
  assert.deepEqual(inspect('expired'), { confirming: true })
  assert.deepEqual(inspect('manual'), { confirming: true })
  assert.equal(reloads, 0)
  region.innerText = '扫码登录'
  assert.deepEqual(inspect('expired'), { changed: true })
  assert.equal(reloads, 0)
  region.innerText = '二维码已过期'
  assert.deepEqual(inspect('expired'), { reloading: true })
  assert.equal(reloads, 1)
})

test('周期检查读不到图片时不点击登录、不重载；确认态也不改图', async () => {
  const empty = fixture(null)
  assert.deepEqual(
    await captureLoginQr(empty.page, 'bili', false, () => true, {
      passive: true,
    }),
    { code: 'pending' },
  )
  assert.deepEqual(empty.commands, [])
  const scanned = fixture({ confirming: true })
  assert.deepEqual(
    await captureLoginQr(scanned.page, 'bili', true, () => true, {
      expiredOnly: true,
    }),
    { code: 'confirming' },
  )
  assert.deepEqual(scanned.commands, [])
})
