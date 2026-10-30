import test from 'node:test'
import assert from 'node:assert/strict'
import { DownloadJob } from '../download-job.mjs'

for (const kind of ['images', 'video', 'playback']) {
  test(`${kind} 在任务启动前取消，不准备页面也不启动进程`, async () => {
    const job = new DownloadJob({
      windows: { prepare: () => assert.fail('不应准备页面') },
      spawnProcess: () => assert.fail('不应启动进程'),
    })
    await job.cancel()
    const result = await job.run({
      kind,
      record: {
        platform: 'bili',
        images: ['a', 'b'],
        media: { variants: [{}] },
      },
    })
    assert.equal(result.code, 'cancelled')
    assert.equal(result.saved, 0)
  })
}

test('等待平台上下文期间取消，异步返回后不能启动视频下载', async () => {
  let release
  const prepared = new Promise((resolve) => {
    release = resolve
  })
  const job = new DownloadJob({
    windows: { prepare: () => prepared },
    spawnProcess: () => assert.fail('取消后不应启动进程'),
  })
  const running = job.run({
    kind: 'video',
    record: { platform: 'bili', media: { variants: [{}] } },
  })
  const cancelled = job.cancel()
  release('target')
  assert.equal((await running).code, 'cancelled')
  await cancelled
})
