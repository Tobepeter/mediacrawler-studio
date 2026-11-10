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
  beginLogin(platform, mode) {
    this.presentation = { platform, mode, preparing: true }
  },
  show(platform, mode) {
    this.presentation = { platform, mode }
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
    await until(() => (service.state.pages.bili?.results || []).length === 1)
    await assert.rejects(service.start(request), /请先结束/)
    await service.cancel('bili')
    assert.equal(service.state.tasks.bili.status, 'cancelled')
    assert.equal((service.state.pages.bili?.results || []).length, 1)
    assert.equal(service.busy, false)
    await service.persistence
    await service.init()
    assert.equal(service.state.tasks.bili, undefined)
    assert.equal((service.state.pages.bili?.results || []).length, 0)
    assert.equal(service.state.history.length, 1)
  } finally {
    await service.stopAll()
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
    assert.equal(service.state.tasks.bili.status, 'error')
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
    assert.equal(service.state.tasks.bili.status, 'completed')
    await service.start(request)
    await until(() => !service.busy)
    assert.equal((service.state.pages.bili?.results || []).length, 1)
    await service.persistence
  } finally {
    await service.stopAll()
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
    await service.stopAll()
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
    await until(() => service.state.tasks.bili.status === 'completed')
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
    await service.stopAll()
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
    await until(
      () =>
        (service.state.pages.bili?.results || [])[0]?.comments?.length === 1,
    )
    await service.cancel('bili')
    assert.equal((service.state.pages.bili?.results || []).length, 1)
    assert.equal(
      (service.state.pages.bili?.results || [])[0].commentStatus,
      'cancelled',
    )
    const id = service.state.pages.bili.id
    await service.persistence
    await service.init()
    assert.deepEqual(service.state.drafts, {})
    const record = await service.openHistory(id)
    assert.equal(record.results[0].comments[0].text, '已收到的评论')
    assert.equal(record.task.comments, true)
  } finally {
    await service.stopAll()
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
    service.operations.set('bili', { kind: 'collect' })
    await assert.rejects(service.clearSessions(), /请先结束/)
    assert.equal(calls, 0)
    service.operations.delete('bili')
    const clearing = service.clearSessions()
    assert.equal(service.busy, true)
    await assert.rejects(service.start(request), /请先结束/)
    await assert.rejects(service.clearSessions(), /请先结束/)
    const stopping = service.cancel('bili')
    assert.equal(service.state.tasks.bili, undefined)
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
    await service.stopAll()
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
      service.operations
        .get('bili')
        .downloadJob.child.stdout.once('data', resolve),
    )
    await service.cancel('bili')
    assert.deepEqual(await result, { saved: 1, total: 2, code: 'cancelled' })
    assert.equal(service.busy, false)
  } finally {
    await service.stopAll()
    await cleanup()
  }
})

test('单平台退出只清理目标账号，失败可重试且不影响记录', async () => {
  const { service, cleanup } = await createService('')
  try {
    service.state.accounts = { bili: 'connected', dy: 'connected' }
    service.state.profiles = { bili: { nickname: 'B' }, dy: { nickname: 'D' } }
    service.state.tasks.bili = {
      ...request,
      action: 'connect',
      status: 'completed',
    }
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
    await assert.rejects(service.clearSessions('bili'), /请先结束/)
    await until(() => typeof release === 'function')
    release()
    await clearing
    assert.deepEqual(cleared, ['bili'])
    assert.deepEqual(service.state.accounts, { dy: 'connected' })
    assert.deepEqual(service.state.profiles, { dy: { nickname: 'D' } })
    assert.equal(service.state.tasks.bili, undefined)
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
    await assert.rejects(
      service.start({ ...request, platform: 'dy' }),
      /结束当前任务/,
    )
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
    await service.stopAll()
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
    await until(() => !!service.operations.get('dy')?.downloadJob?.child)
    await service.cancelVideo('current')
    assert.equal((await result).code, 'cancelled')
    assert.equal(service.busy, false)
    assert.equal(service.operations.has('dy'), false)
  } finally {
    await service.stopAll()
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
    assert.equal(service.state.tasks.bili.status, 'completed')
  } finally {
    await service.stopAll()
    await cleanup()
  }
})

test('清空只移除当前平台展示，后台推送不恢复，历史与输入仍可复用', async () => {
  const { service, cleanup } = await createService(
    itemScript +
      "console.log(JSON.stringify({type:'done'})); process.exit(0); });",
  )
  try {
    await service.start(request)
    await until(() => !service.busy)
    await service.persistence
    const id = service.state.pages.bili.id
    const other = { id: 'other', results: [] }
    service.state.pages.dy = other
    service.state.accounts.bili = 'connected'
    service.state.drafts.bili = { query: 'test' }
    service.operations.set('bili', { kind: 'collect' })
    assert.throws(() => service.clearResults('bili'), /请先结束/)
    service.operations.delete('bili')
    service.clearResults('bili')
    service.publish()
    assert.equal(service.state.pages.bili, undefined)
    assert.equal(service.state.pages.dy, other)
    assert.equal(service.state.tasks.bili, undefined)
    assert.deepEqual(service.state.pages.bili?.results || [], [])
    assert.equal(service.state.accounts.bili, 'connected')
    assert.equal(service.state.drafts.bili.query, 'test')
    assert.equal(service.state.history.length, 1)
    const restored = await service.openHistory(id)
    assert.equal(restored.results.length, 1)
    assert.equal(service.state.pages.bili.id, id)
    assert.throws(() => service.clearResults('invalid'), /不支持/)
  } finally {
    await cleanup()
  }
})

test('下载画质传给共用下载器，筛选写入草稿与历史', async () => {
  const { service, cleanup } = await createService(
    itemScript +
      "console.log(JSON.stringify({type:'done'})); process.exit(0); });",
  )
  try {
    await service.saveDraft('bili', {
      ...request,
      filters: { sort: 'pubdate' },
    })
    assert.deepEqual(service.library.workspace.drafts.bili.filters, {
      sort: 'pubdate',
    })
    await service.start({ ...request, filters: { sort: 'pubdate' } })
    await until(() => !service.busy)
    await service.persistence
    assert.deepEqual(service.state.pages.bili.task.filters, { sort: 'pubdate' })
    const id = service.state.pages.bili.results[0].id
    service.runMedia = async (_record, options) => options
    assert.equal(
      (await service.downloadMedia('bili', id, 'video', '/tmp', '720p'))
        .quality,
      '720p',
    )
    assert.equal(
      (await service.downloadMedia('bili', id, 'video', '/tmp')).quality,
      'best',
    )
    await assert.rejects(
      service.downloadMedia('bili', id, 'video', '/tmp', 'arbitrary'),
      /清晰度无效/,
    )
  } finally {
    await cleanup()
  }
})

test('两平台同时采集，停止其中一个后另一个继续写入自己的结果和历史', async () => {
  const { service, cleanup } =
    await createService(`process.stdin.once('data', data => {
    const { platform } = JSON.parse(data)
    let n = 0
    const emit = () => console.log(JSON.stringify({type:'item',item:{id:String(++n),platform}}))
    emit()
    setInterval(emit, 30)
  })`)
  try {
    await Promise.all([
      service.start(request),
      service.start({ ...request, platform: 'xhs' }),
    ])
    await until(
      () =>
        service.state.pages.bili.results.length &&
        service.state.pages.xhs.results.length,
    )
    assert.deepEqual(service.state.working, { bili: 'collect', xhs: 'collect' })
    await assert.rejects(service.start(request), /请先结束/)
    await service.cancel('xhs')
    const before = service.state.pages.bili.results.length
    await until(() => service.state.pages.bili.results.length > before)
    assert.deepEqual(service.state.working, { bili: 'collect' })
    assert.equal(service.state.tasks.xhs.status, 'cancelled')
    await service.stopAll()
    for (const platform of ['bili', 'xhs']) {
      const record = await service.library.get(service.state.pages[platform].id)
      assert.equal(record.task.status, 'cancelled')
      assert.ok(record.results.every((item) => item.platform === platform))
    }
  } finally {
    await service.stopAll()
    await service.persistence
    await cleanup()
  }
})

const creatorScript = (body) => `process.stdin.once('data', () => { ${body} });`
async function connectedDouyin(script) {
  const context = await createService(script)
  context.service.state.accounts.dy = 'connected'
  return context
}

test('搜索博主占用同平台并返回分页结果', async () => {
  const { service, cleanup } = await connectedDouyin(
    creatorScript(
      `console.log(JSON.stringify({type:'creators',items:[{id:'a'}],next_cursor:'n',has_more:true})); setTimeout(()=>{}, 50);`,
    ),
  )
  try {
    process.env.STUDIO_PYTHON = process.execPath
    const pending = service.searchCreators('dy', ' 罗翔 ')
    assert.equal(service.operations.get('dy').kind, 'creator-search')
    await assert.rejects(service.searchCreators('dy', 'x'), /结束当前任务/)
    assert.deepEqual(await pending, {
      items: [{ id: 'a' }],
      nextCursor: 'n',
      hasMore: true,
    })
    assert.equal(service.busy, false)
  } finally {
    delete process.env.STUDIO_PYTHON
    await cleanup()
  }
})

test('搜索博主校验入口并透传失败原因', async () => {
  const { service, cleanup } = await connectedDouyin(
    creatorScript(
      `console.log(JSON.stringify({type:'error',message:'抖音要求验证，请稍后重试'}));`,
    ),
  )
  try {
    process.env.STUDIO_PYTHON = process.execPath
    await assert.rejects(service.searchCreators('wb', 'x'), /暂不支持/)
    await assert.rejects(service.searchCreators('dy', '  '), /请输入/)
    await assert.rejects(service.searchCreators('dy', 'x', 1), /翻页/)
    delete service.state.accounts.dy
    await assert.rejects(service.searchCreators('dy', 'x'), /登录后/)
    service.state.accounts.dy = 'connected'
    await assert.rejects(service.searchCreators('dy', 'x'), /要求验证/)
    assert.equal(service.busy, false)
  } finally {
    delete process.env.STUDIO_PYTHON
    await cleanup()
  }
})

test('取消搜索博主立即释放平台', async () => {
  const { service, cleanup } = await connectedDouyin(
    creatorScript(`setInterval(() => {}, 1000);`),
  )
  try {
    process.env.STUDIO_PYTHON = process.execPath
    const pending = service.searchCreators('dy', 'x')
    await until(() => service.operations.get('dy')?.child)
    await service.cancel('dy')
    assert.equal((await pending).cancelled, true)
    assert.equal(service.busy, false)
  } finally {
    delete process.env.STUDIO_PYTHON
    await cleanup()
  }
})

test('采集任务记录博主名称，草稿接受博主模式', async () => {
  const url = 'https://www.douyin.com/user/MS4wLjABAAAAabc'
  const { service, cleanup } = await connectedDouyin(
    creatorScript(
      `console.log(JSON.stringify({type:'creator',creator:{name:'博主',url:${JSON.stringify(url)}}})); console.log(JSON.stringify({type:'done',message:'ok'}));`,
    ),
  )
  try {
    process.env.STUDIO_PYTHON = process.execPath
    await service.saveDraft('dy', { query: url, mode: 'creator', limit: 200 })
    await service.start({
      platform: 'dy',
      action: 'collect',
      mode: 'creator',
      query: url,
      limit: 150,
    })
    await until(
      () => service.state.tasks.dy?.status === 'completed' && !service.busy,
    )
    assert.deepEqual(service.state.tasks.dy.creator, {
      name: '博主',
      url,
      avatar: '',
      followers: null,
      posts: null,
    })
    assert.equal(service.state.tasks.dy.limit, 150)
  } finally {
    delete process.env.STUDIO_PYTHON
    await service.persistence.catch(() => {})
    await cleanup()
  }
})

test('继续采集并入原批次并更新翻页位置', async () => {
  const url = 'https://www.douyin.com/user/MS4wLjABAAAAabc'
  const emit = (id, cursor) =>
    `console.log(JSON.stringify({type:'item',item:{id:'dy:${id}',title:'t',text:'',platform:'dy',url:'https://www.douyin.com/video/${id}',images:[]}})); console.log(JSON.stringify({type:'page',next_cursor:${cursor},has_more:${cursor !== 'null'}})); console.log(JSON.stringify({type:'done',message:'ok'}));`
  const { service, cleanup } = await connectedDouyin(creatorScript(''))
  let script = emit('1', `'next'`)
  service.spawnProcess = () =>
    spawn(process.execPath, ['-e', creatorScript(script)])
  const finished = () =>
    until(() => service.state.tasks.dy?.status === 'completed' && !service.busy)
  const start = (extra) =>
    service.start({
      platform: 'dy',
      action: 'collect',
      mode: 'creator',
      query: url,
      limit: 5,
      ...extra,
    })
  try {
    process.env.STUDIO_PYTHON = process.execPath
    await assert.rejects(start({ cursor: 'c' }), /重新开始/)
    await start()
    await finished()
    const first = service.state.pages.dy
    assert.equal(first.task.nextCursor, 'next')
    script = `console.log(JSON.stringify({type:'error',message:'失败'}));`
    await start({ cursor: 'next' })
    await until(
      () => service.state.tasks.dy?.status === 'error' && !service.busy,
    )
    assert.equal(service.state.pages.dy.task.nextCursor, 'next')
    assert.equal(service.state.pages.dy.results.length, 1)
    script = emit('1', `'next2'`)
    await start({ cursor: 'next' })
    await finished()
    assert.equal(service.state.pages.dy.task.stalled, true)
    assert.equal(service.state.pages.dy.results.length, 1)
    script = emit('2', 'null')
    const logs = []
    service.logger = { write: (...entry) => logs.push(entry) }
    await start({ cursor: 'next' })
    await finished()
    const finishedLog = logs.find((entry) => entry[2] === 'run-finished')[3]
    assert.equal(finishedLog.added, 1)
    assert.equal(finishedLog.continued, true)
    const merged = service.state.pages.dy
    assert.equal(merged.id, first.id)
    assert.deepEqual(
      merged.results.map((item) => item.id),
      ['dy:1', 'dy:2'],
    )
    assert.equal(merged.task.nextCursor, undefined)
    assert.equal(merged.task.cursor, undefined)
  } finally {
    delete process.env.STUDIO_PYTHON
    await service.persistence.catch(() => {})
    await cleanup()
  }
})

test('详情补全写回当前记录，已切换记录或未登录时不写', async () => {
  const service = Object.create(StudioService.prototype)
  Object.assign(service, {
    details: new Map(),
    operations: new Map(),
    state: { accounts: { bili: 'saved' }, pages: {} },
    publish() {},
    trackSave() {},
    library: { saveRun: async () => {} },
  })
  assert.deepEqual(await service.loadDetail('bili', 'bili:1'), {
    code: 'login',
  })
  const results = [{ id: 'bili:1', platform: 'bili', title: '标题' }]
  service.state.pages.bili = { id: 'r1', task: { platform: 'bili' }, results }
  service.applyDetail('bili', 'r1', {
    id: 'bili:1',
    platform: 'bili',
    media: { status: 'available', variants: [] },
  })
  const saved = service.state.pages.bili.results[0]
  assert.equal(saved.title, '标题')
  assert.equal(saved.media.status, 'available')
  service.applyDetail('bili', 'other', {
    id: 'bili:1',
    platform: 'bili',
    media: { status: 'failed', variants: [] },
  })
  assert.equal(service.state.pages.bili.results[0].media.status, 'available')
})

test('推荐流校验平台和登录，卡片数据只留在内存里', async () => {
  const service = Object.create(StudioService.prototype)
  Object.assign(service, {
    feedItems: new Map(),
    details: new Map(),
    operations: new Map(),
    state: { accounts: { bili: 'connected', dy: 'saved' }, pages: {} },
  })
  await assert.rejects(service.loadFeed('wb'), /暂不支持/)
  await assert.rejects(service.loadFeed('dy'), /登录后/)

  const item = (id) => ({ id, platform: 'bili', title: id })
  service.rememberFeed('bili', [item('a'), item('b')], true)
  service.rememberFeed('bili', [item('c'), { id: 'x', platform: 'dy' }], false)
  assert.deepEqual([...service.feedItems.get('bili').keys()], ['a', 'b', 'c'])
  assert.equal(service.findItem('bili', 'c').title, 'c')
  service.rememberFeed('bili', [item('d')], true)
  assert.equal(service.findItem('bili', 'a'), undefined)
  assert.equal(service.state.pages.bili, undefined)

  service.state.pages.bili = {
    id: 'r',
    task: {},
    results: [{ id: 'd', platform: 'bili', title: '结果页' }],
  }
  assert.equal(service.findItem('bili', 'd').title, '结果页')
  service.rememberFeed(
    'bili',
    Array.from({ length: 700 }, (_, index) => item(`n${index}`)),
    true,
  )
  assert.equal(service.feedItems.get('bili').size, 600)
})
