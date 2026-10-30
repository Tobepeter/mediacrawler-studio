import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { StudioLibrary } from '../library.mjs'

const task = (platform, query, startedAt = 100) => ({
  platform,
  query,
  startedAt,
  limit: 5,
  mode: 'search',
  action: 'collect',
  status: 'completed',
})

test('历史批次相互独立，重启保留选择与输入，拒绝未知文件路径', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-history-'))
  try {
    const lib = new StudioLibrary(dir)
    await lib.init()
    await lib.saveRun({
      id: 'a',
      task: task('bili', '猫'),
      results: [{ id: 'bili:1' }],
    })
    await lib.saveRun({
      id: 'b',
      task: task('bili', '狗', 200),
      results: [{ id: 'bili:2' }],
    })
    await lib.saveRun({
      id: 'c',
      task: task('dy', '猫', 300),
      results: [{ id: 'dy:1' }],
    })
    lib.workspace.drafts = {
      bili: { query: '草稿', limit: 10 },
      dy: { query: '另一页', limit: 5 },
    }
    lib.workspace.selections = { bili: 'a', dy: 'c' }
    await lib.saveWorkspace()
    const restored = new StudioLibrary(dir)
    await restored.init()
    assert.deepEqual(
      restored.list().map((e) => e.id),
      ['c', 'b', 'a'],
    )
    assert.equal((await restored.get('a')).results[0].id, 'bili:1')
    assert.equal(restored.workspace.drafts.bili.query, '草稿')
    assert.equal(restored.workspace.selections.bili, 'a')
    await assert.rejects(restored.get('../workspace'), /不存在/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('旧结果迁移按真实内容平台归属，不误用最近登录任务，重复启动不复制', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-migration-'))
  try {
    const legacy = JSON.stringify({
      task: { ...task('bili', '不该套用'), action: 'connect' },
      results: [{ id: 'xhs:1', platform: 'xhs' }],
    })
    await writeFile(path.join(dir, 'results.json'), legacy)
    const lib = new StudioLibrary(dir)
    await lib.init()
    assert.equal(lib.list().length, 1)
    assert.equal(lib.list()[0].task.platform, 'xhs')
    assert.equal(lib.list()[0].task.query, '')
    assert.equal(lib.workspace.selections.xhs, 'legacy-xhs')
    await lib.init()
    assert.equal(lib.list().length, 1)
    assert.equal(await readFile(path.join(dir, 'results.json'), 'utf8'), legacy)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('异常退出的采集记录保留部分结果并标记中断', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-interrupted-'))
  try {
    const lib = new StudioLibrary(dir)
    await lib.init()
    await lib.saveRun({
      id: 'running',
      task: { ...task('xhs', '测试'), status: 'running' },
      results: [{ id: 'xhs:1' }],
    })
    await lib.init()
    const record = await lib.get('running')
    assert.equal(record.task.status, 'cancelled')
    assert.equal(record.results.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('新增平台独立保存历史、草稿和选中批次', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'studio-platforms-'))
  try {
    const lib = new StudioLibrary(dir)
    await lib.init()
    for (const platform of ['zhihu', 'wb', 'tieba', 'ks']) {
      await lib.saveRun({
        id: platform,
        task: task(platform, platform),
        results: [{ id: `${platform}:1`, platform }],
      })
      lib.workspace.drafts[platform] = {
        query: `${platform}草稿`,
        comments: true,
        replies: true,
      }
      lib.workspace.selections[platform] = platform
    }
    await lib.saveWorkspace()
    const restored = new StudioLibrary(dir)
    await restored.init()
    for (const platform of ['zhihu', 'wb', 'tieba', 'ks']) {
      assert.equal(restored.workspace.drafts[platform].query, `${platform}草稿`)
      assert.equal(
        (await restored.get(restored.workspace.selections[platform])).results[0]
          .platform,
        platform,
      )
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
