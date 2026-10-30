import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { StudioService } from '../service.mjs'

const request = {
  platform: 'bili',
  action: 'collect',
  mode: 'search',
  query: 'test',
  limit: 5,
}
const windows = {
  accounts: async () => ({}),
  prepare: async () => 'exact-target',
  beginLogin(platform) {
    this.presentation = { platform, mode: this.loginMode, preparing: true }
  },
  show(platform) {
    this.presentation = { platform, mode: this.loginMode }
  },
  hide() {
    this.presentation = null
  },
  flush: async () => {},
}
const until = async (check) => {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('state timed out')
}
async function createService(script) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'studio-test-'))
  const service = new StudioService({
    root: process.cwd(),
    dataDir,
    windows: { ...windows, presentation: null },
    endpoint: 'http://127.0.0.1:1',
    onState() {},
    spawnProcess: () => spawn(process.execPath, ['-e', script]),
  })
  await service.init()
  return {
    service,
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  }
}
const itemScript = `process.stdin.once('data', () => {
  console.log(JSON.stringify({type:'state',status:'running',message:'正在获取内容'}));
  console.log(JSON.stringify({type:'item',item:{id:'bili:1',title:'test',text:'body',platform:'bili',url:'https://bilibili.com/video/1',images:[]}}));
`

test('取消保留历史，重启进入空白采集页', async () => {
  const { service, cleanup } = await createService(
    itemScript + 'setInterval(() => {}, 1000); });',
  )
  try {
    await service.start(request)
    await until(() => service.state.results.length === 1)
    await assert.rejects(service.start(request), /请先结束/)
    await service.cancel()
    assert.equal(service.state.task.status, 'cancelled')
    assert.equal(service.state.results.length, 1)
    assert.equal(service.busy, false)
    await service.persistence
    await service.init()
    assert.equal(service.state.task, null)
    assert.equal(service.state.results.length, 0)
    assert.equal(service.state.history.length, 1)
  } finally {
    await service.cancel()
    await cleanup()
  }
})

test('异常退出变为失败，不伪报成功', async () => {
  const { service, cleanup } = await createService(
    "process.stdin.once('data', () => process.exit(1))",
  )
  try {
    await service.start(request)
    await until(() => !service.busy)
    assert.equal(service.state.task.status, 'error')
    await service.persistence
  } finally {
    await cleanup()
  }
})

test('正常完成释放进程，允许再次开始', async () => {
  const script =
    itemScript +
    "console.log(JSON.stringify({type:'done',message:'已获取 1 条内容'})); process.exit(0); });"
  const { service, cleanup } = await createService(script)
  try {
    await service.start(request)
    await until(() => !service.busy)
    assert.equal(service.state.task.status, 'completed')
    await service.start(request)
    await until(() => !service.busy)
    assert.equal(service.state.results.length, 1)
    await service.persistence
  } finally {
    await service.cancel()
    await cleanup()
  }
})

test('平台结果隔离、登录不覆盖历史、旧批次恢复后导出对应内容', async () => {
  const script = `process.stdin.once('data', data => {
    const req=JSON.parse(data);
    if(req.action==='collect') console.log(JSON.stringify({type:'item',item:{id:req.platform+':'+req.query,platform:req.platform,title:req.query,images:[]}}));
    console.log(JSON.stringify({type:'done',message:'完成'}));
  });`
  const { service, cleanup } = await createService(script)
  try {
    await service.start(request)
    await until(() => !service.busy)
    const first = service.state.pages.bili.id
    await service.start({ ...request, platform: 'dy', query: '抖音输入' })
    await until(() => !service.busy)
    assert.equal(service.state.pages.bili.results[0].title, 'test')
    assert.equal(service.state.pages.dy.results[0].title, '抖音输入')
    await service.start({ ...request, query: '第二批' })
    await until(() => !service.busy)
    assert.notEqual(service.state.pages.bili.id, first)
    assert.equal(service.state.history.length, 3)
    await service.start({ ...request, action: 'connect' })
    await until(() => !service.busy)
    assert.equal(service.state.history.length, 3)
    await service.openHistory(first)
    assert.equal(service.resultsFor('bili', first)[0].title, 'test')
    assert.throws(() => service.resultsFor('dy', first), /结果已更新/)
    await service.saveDraft('bili', {
      query: '尚未提交',
      mode: 'search',
      limit: 100,
    })
    await assert.rejects(
      async () =>
        service.saveDraft('dy', { query: '', mode: 'search', limit: 101 }),
      /无效/,
    )
    await service.init()
    assert.deepEqual(service.state.pages, {})
    assert.deepEqual(service.state.drafts, {})
    await service.openHistory(first)
    assert.equal(service.state.pages.bili.id, first)
  } finally {
    await service.cancel()
    await service.persistence
    await cleanup()
  }
})

test('账号资料按平台隔离，完成事件后仍等进程退出再解除 busy', async () => {
  const { service, cleanup } =
    await createService(`process.stdin.once('data', data => {
    const req = JSON.parse(data)
    console.log(JSON.stringify({type:'account',profile:{nickname:req.platform,avatar:'https://example.com/avatar.png',cookie:'must-not-leak'}}))
    console.log(JSON.stringify({type:'done',message:'完成'}))
    setTimeout(() => process.exit(0), 150)
  })`)
  try {
    await service.start({ ...request, action: 'connect' })
    await until(() => service.state.task.status === 'completed')
    assert.equal(service.state.busy, true)
    assert.deepEqual(service.state.profiles.bili, {
      nickname: 'bili',
      avatar: 'https://example.com/avatar.png',
    })
    assert.equal(service.state.profiles.dy, undefined)
    await until(() => !service.state.busy)
    await service.start({ ...request, platform: 'dy', action: 'connect' })
    await until(() => !service.state.busy)
    assert.equal(service.state.profiles.bili.nickname, 'bili')
    assert.equal(service.state.profiles.dy.nickname, 'dy')
  } finally {
    await service.cancel()
    await cleanup()
  }
})

test('评论增量更新、取消保留、草稿选项和历史恢复', async () => {
  const { service, cleanup } = await createService(
    itemScript +
      `
    console.log(JSON.stringify({type:'item-update',item:{id:'bili:1',platform:'bili',title:'test',images:[],comments:[{id:'c1',parentId:'',text:'已收到的评论',author:'测试',likes:'1'}],commentStatus:'running'}}));
    setInterval(() => {},1000);
  });`,
  )
  try {
    await service.saveDraft('bili', {
      ...request,
      comments: true,
      replies: true,
    })
    await service.start({ ...request, comments: true, replies: true })
    await until(() => service.state.results[0]?.comments?.length === 1)
    await service.cancel()
    assert.equal(service.state.results.length, 1)
    assert.equal(service.state.results[0].commentStatus, 'cancelled')
    const id = service.state.pages.bili.id
    await service.persistence
    await service.init()
    assert.deepEqual(service.state.drafts, {})
    const record = await service.openHistory(id)
    assert.equal(record.results[0].comments[0].text, '已收到的评论')
    assert.equal(record.task.comments, true)
  } finally {
    await service.cancel()
    await cleanup()
  }
})

test('清除登录态独占任务槽，保留历史和草稿，禁止采集中清理', async () => {
  const { service, cleanup } = await createService('')
  try {
    const record = {
      id: 'saved',
      task: { ...request, startedAt: 1, status: 'completed' },
      results: [{ id: 'bili:1' }],
    }
    await service.library.saveRun(record)
    service.state.pages.bili = record
    service.state.profiles.bili = { nickname: '测试账号' }
    service.state.accounts.bili = 'connected'
    await service.saveDraft('bili', { ...request, comments: true })
    let release
    let calls = 0
    service.windows = {
      ...windows,
      clearSessions: async () => {
        calls++
        await new Promise((resolve) => {
          release = resolve
        })
      },
    }
    service.busy = true
    await assert.rejects(service.clearSessions(), /请先结束/)
    assert.equal(calls, 0)
    service.busy = false
    const clearing = service.clearSessions()
    assert.equal(service.busy, true)
    await assert.rejects(service.start(request), /请先结束/)
    await assert.rejects(service.clearSessions(), /请先结束/)
    const stopping = service.cancel()
    assert.equal(service.state.task, null)
    await until(() => typeof release === 'function')
    release()
    await clearing
    await stopping
    assert.equal(calls, 1)
    assert.equal(service.busy, false)
    assert.deepEqual(service.state.accounts, {})
    assert.deepEqual(service.state.profiles, {})
    assert.equal(service.state.pages.bili, record)
    assert.equal((await service.library.get('saved')).results.length, 1)
    assert.equal(service.library.workspace.drafts.bili.query, 'test')
    service.windows.clearSessions = async () => {
      throw new Error('清理失败')
    }
    await assert.rejects(service.clearSessions(), /清理失败/)
    assert.equal(service.busy, false)
    assert.deepEqual(service.state.profiles, {})
  } finally {
    await cleanup()
  }
})

test('下载只使用已有结果，互斥到进程退出且不改变采集历史', async () => {
  const { service, cleanup } =
    await createService(`process.stdin.once('data', data => {
    const req = JSON.parse(data);
    console.log(JSON.stringify({type:'download-result',saved:req.record.images.length,total:req.record.images.length,code:''}));
    setTimeout(() => process.exit(0), 100);
  });`)
  try {
    service.state.pages.bili = { results: [] }
    service.state.pages.bili.results = [
      {
        id: 'bili:1',
        platform: 'bili',
        images: ['https://example.com/image.jpg'],
      },
    ]
    const before = JSON.stringify(service.state)
    assert.throws(
      () => service.mediaItem('bili', 'missing', 'images'),
      /不存在/,
    )
    assert.throws(
      () => service.mediaItem('__proto__', 'bili:1', 'images'),
      /不存在/,
    )
    assert.throws(
      () => service.mediaItem('bili', 'bili:1', 'anything'),
      /不支持/,
    )
    const result = service.downloadMedia('bili', 'bili:1', 'images', '/unused')
    assert.equal(service.busy, true)
    await assert.rejects(service.start(request), /请先结束/)
    await assert.rejects(service.clearSessions(), /请先结束/)
    assert.equal((await result).saved, 1)
    assert.equal(service.busy, false)
    assert.equal(JSON.stringify(service.state), before)
  } finally {
    await service.cancel()
    await cleanup()
  }
})

test('取消下载等待进程关闭，保留已完成文件数量', async () => {
  const { service, cleanup } =
    await createService(`process.stdin.once('data', () => {
    console.log(JSON.stringify({type:'download-progress',saved:1}));
    setInterval(() => {}, 1000);
  });`)
  try {
    service.state.pages.bili = { results: [] }
    service.state.pages.bili.results = [
      {
        id: 'bili:1',
        platform: 'bili',
        images: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      },
    ]
    const result = service.downloadMedia('bili', 'bili:1', 'images', '/unused')
    await new Promise((resolve) =>
      service.downloadJob.child.stdout.once('data', resolve),
    )
    await service.cancel()
    assert.deepEqual(await result, { saved: 1, total: 2, code: 'cancelled' })
    assert.equal(service.busy, false)
  } finally {
    await service.cancel()
    await cleanup()
  }
})

test('单平台退出只清理目标账号，失败可重试且不影响记录', async () => {
  const { service, cleanup } = await createService('')
  try {
    service.state.accounts = { bili: 'connected', dy: 'connected' }
    service.state.profiles = { bili: { nickname: 'B' }, dy: { nickname: 'D' } }
    service.state.task = { ...request, action: 'connect', status: 'completed' }
    const pages = service.state.pages
    let release
    const cleared = []
    service.windows = {
      ...windows,
      clearSessions: async (platform) => {
        cleared.push(platform)
        await new Promise((resolve) => {
          release = resolve
        })
      },
    }
    await assert.rejects(service.clearSessions('__proto__'), /不支持/)
    const clearing = service.clearSessions('bili')
    await Promise.resolve()
    assert.equal(service.busy, true)
    await assert.rejects(service.start(request), /请先结束/)
    await assert.rejects(service.clearSessions('dy'), /请先结束/)
    await until(() => typeof release === 'function')
    release()
    await clearing
    assert.deepEqual(cleared, ['bili'])
    assert.deepEqual(service.state.accounts, { dy: 'connected' })
    assert.deepEqual(service.state.profiles, { dy: { nickname: 'D' } })
    assert.equal(service.state.task, null)
    assert.equal(service.state.pages, pages)
    service.windows.clearSessions = async () => {
      throw new Error('mock failure')
    }
    await assert.rejects(service.clearSessions('dy'), /mock failure/)
    assert.equal(service.state.accounts.dy, 'connected')
    assert.equal(service.busy, false)
    service.windows.clearSessions = async () => {}
    await service.clearSessions('dy')
    assert.deepEqual(service.state.accounts, {})
  } finally {
    await cleanup()
  }
})

test('抖音播放地址解析复用已有结果，互斥且不写入历史', async () => {
  const { service, cleanup } =
    await createService(`process.stdin.once('data', data => {
    const req=JSON.parse(data)
    if(req.kind!=='playback'||req.record.id!=='dy:1'||req.directory) process.exit(1)
    console.log(JSON.stringify({type:'download-result',urls:['https://example.com/video.mp4'],code:''}))
    setTimeout(()=>process.exit(0),50)
  })`)
  const record = {
    id: 'run',
    task: { ...request, platform: 'dy' },
    results: [
      {
        id: 'dy:1',
        platform: 'dy',
        images: [],
        url: 'https://www.douyin.com/video/1',
      },
    ],
  }
  service.state.pages.dy = record
  const before = JSON.stringify(service.state.pages)
  try {
    await assert.rejects(service.resolveVideo('bili', 'dy:1', 'token'))
    await assert.rejects(service.resolveVideo('dy', 'dy:missing', 'token'))
    const pending = service.resolveVideo('dy', 'dy:1', 'token')
    assert.equal(service.busy, true)
    await assert.rejects(service.start(request), /结束当前任务/)
    await service.cancelVideo('stale-token')
    const result = await pending
    assert.deepEqual(result, {
      urls: ['https://example.com/video.mp4'],
      code: '',
    })
    assert.equal(service.busy, false)
    assert.equal(JSON.stringify(service.state.pages), before)
    assert.equal(service.state.history.length, 0)
  } finally {
    await service.cancel()
    await cleanup()
  }
})

test('关闭播放器仅取消对应请求，释放媒体任务槽', async () => {
  const { service, cleanup } = await createService(
    `process.stdin.once('data',()=>setInterval(()=>{},1000))`,
  )
  service.state.pages.dy = {
    results: [
      {
        id: 'dy:1',
        platform: 'dy',
        images: [],
        url: 'https://www.douyin.com/video/1',
      },
    ],
  }
  try {
    const result = service.resolveVideo('dy', 'dy:1', 'current')
    await until(() => !!service.downloadJob?.child)
    await service.cancelVideo('current')
    assert.equal((await result).code, 'cancelled')
    assert.equal(service.busy, false)
    assert.equal(service.downloadJob, null)
  } finally {
    await service.cancel()
    await cleanup()
  }
})

test('先完成平台登出再清本地，未确认时返回 localOnly', async () => {
  for (const remote of ['confirmed', 'not_confirmed']) {
    const script = `process.stdin.once('data', data => {
      const request = JSON.parse(data);
      console.log(JSON.stringify({type:'logout-result',result:{platform:request.platform,remote:'${remote}'}}));
    });`
    const { service, cleanup } = await createService(script)
    try {
      service.windows.accounts = async () => ({ bili: 'saved' })
      service.state.accounts.bili = 'connected'
      service.state.profiles.bili = { nickname: 'B' }
      let cleaned = false
      service.windows.clearSessions = async () => {
        assert.equal(service.busy, true)
        assert.equal(service.state.accounts.bili, 'connected')
        cleaned = true
      }
      const outcome = await service.clearSessions('bili')
      assert.equal(cleaned, true)
      assert.equal(outcome.localOnly, remote === 'not_confirmed')
      assert.equal(outcome.results[0].localCleared, true)
      assert.equal(service.state.accounts.bili, undefined)
    } finally {
      await cleanup()
    }
  }
})

test('静默连接不创建登录弹层，未登录保留手动入口', async () => {
  const { service, cleanup } =
    await createService(`process.stdin.once('data', () => {
    console.log(JSON.stringify({type:'state', status:'auth'}));
    console.log(JSON.stringify({type:'login-required'}));
    console.log(JSON.stringify({type:'done', message:'检查完成'}));
  });`)
  let presented = 0
  service.windows.beginLogin = () => {
    presented++
  }
  service.windows.show = () => {
    presented++
  }
  try {
    await service.start({ ...request, action: 'connect', silent: true })
    await until(() => !service.busy)
    assert.equal(presented, 0)
    assert.equal(service.state.accounts.bili, 'expired')
    assert.equal(service.state.loginView, null)
    assert.equal(service.state.task.status, 'completed')
  } finally {
    await service.cancel()
    await cleanup()
  }
})
