import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  bundledStt,
  locateStt,
  missingOf,
  runCheck,
  sttStatus,
} from '../stt-status.mjs'

// stt check（schema_version 2）缺模型时的真实结构，裁掉了无关字段
const report = {
  ok: false,
  missing: [
    {
      id: 'model.qwen',
      kind: 'model',
      required_for_default: true,
      hint: 'uvx modelscope download ...',
      model: 'qwen',
      size_bytes: 1010698116,
      expected_path: '/cache/ms/models/mlx-community/Qwen3-ASR-0___6B-8bit',
      files: ['model.safetensors'],
    },
    { id: 'model.nano', kind: 'model', required_for_default: false },
  ],
  checks: [
    {
      id: 'model.qwen',
      message: '缺 1 个模型文件',
      model: {
        name: 'Qwen3-ASR 0.6B 8bit（MLX）',
        missing_bytes: 1006229426,
        missing_files: ['model.safetensors'],
        sources: [
          { hub: 'modelscope', repo_id: 'mlx-community/Qwen3-ASR-0.6B-8bit' },
          { hub: 'huggingface', repo_id: 'mlx-community/Qwen3-ASR-0.6B-8bit' },
          { hub: 'other', repo_id: 'x' },
        ],
      },
    },
  ],
}
const offline = () => Promise.reject(new Error('refused'))

async function executable(dir, name = 'stt', body = '') {
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, name)
  await writeFile(file, `#!/bin/sh\n${body}`, { mode: 0o755 })
  return file
}

test('只列默认模型需要的，带下载页、目录和大小', () => {
  const [row, ...rest] = missingOf(report)
  assert.equal(rest.length, 0)
  assert.equal(row.name, 'Qwen3-ASR 0.6B 8bit（MLX）')
  assert.equal(row.sizeBytes, 1006229426)
  assert.deepEqual(
    row.pages.map((page) => page.url),
    [
      'https://modelscope.cn/models/mlx-community/Qwen3-ASR-0.6B-8bit/files',
      'https://huggingface.co/mlx-community/Qwen3-ASR-0.6B-8bit/tree/main',
    ],
  )
})

test('包里的优先，没有再找 PATH 和 ~/.local/bin', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-stt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(bundledStt({ packaged: false, root }), null)
  const vendored = await executable(path.join(root, 'vendor/stt'))
  assert.equal(bundledStt({ packaged: false, root }), vendored)
  const packaged = await executable(path.join(root, 'Resources/stt'))
  assert.equal(
    bundledStt({ packaged: true, resources: path.join(root, 'Resources') }),
    packaged,
  )
  const home = path.join(root, 'home')
  assert.deepEqual(locateStt({ bundled: null, pathEnv: '', home }), {
    path: null,
    source: null,
  })
  const local = await executable(path.join(home, '.local/bin'))
  assert.deepEqual(locateStt({ bundled: null, pathEnv: '', home }), {
    path: local,
    source: 'system',
  })
  assert.equal(locateStt({ bundled: vendored, home }).source, 'bundled')
})

test('状态：连上算 ready，缺模型列出来，检查跑不起来不拦提取', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-stt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = await executable(path.join(root, 'stt'))
  await writeFile(
    path.join(path.dirname(file), 'manifest.json'),
    JSON.stringify({ version: '0.1.0' }),
  )
  const ready = await sttStatus({
    bundled: file,
    fetchImpl: async () => ({
      json: async () => ({ service: 'stt', busy: 1 }),
    }),
  })
  assert.deepEqual(
    [ready.state, ready.busy, ready.source, ready.version],
    ['ready', true, 'bundled', '0.1.0'],
  )
  const incomplete = await sttStatus({
    bundled: file,
    fetchImpl: offline,
    check: async () => report,
  })
  assert.equal(incomplete.state, 'incomplete')
  assert.equal(incomplete.downloadBytes, 1006229426)
  for (const check of [async () => null, async () => ({ ok: true })]) {
    const state = await sttStatus({ bundled: file, fetchImpl: offline, check })
    assert.equal(state.state, 'installed')
  }
  const missing = await sttStatus({
    bundled: null,
    fetchImpl: offline,
    locate: () => ({ path: null, source: null }),
  })
  assert.equal(missing.state, 'missing')
})

test('检查没通过时退出码是 1，JSON 照样读', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-stt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const failing = await executable(
    root,
    'stt',
    `echo '${JSON.stringify(report)}'\nexit 1\n`,
  )
  assert.equal((await runCheck(failing)).ok, false)
  const broken = await executable(root, 'broken', 'echo oops\n')
  assert.equal(await runCheck(broken), null)
})
