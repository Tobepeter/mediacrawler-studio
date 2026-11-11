import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildSteps, selectResources } from '../../scripts/build-desktop.mjs'

async function bundle(root, folder, name) {
  const dir = path.join(root, 'dist', folder, name)
  await mkdir(path.join(dir, '_internal'), { recursive: true })
  await writeFile(
    path.join(dir, process.platform === 'win32' ? `${name}.exe` : name),
    'fixture',
    { mode: 0o755 },
  )
  return dir
}

test('运行时只有 CLI 这一份，缺了不能打包', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(selectResources(root), /npm run build:cli/)
  const cli = await bundle(root, 'cli', 'mediacrawler')
  assert.deepEqual(await selectResources(root), { resources: [cli], stt: null })
  await rm(path.join(cli, '_internal'), { recursive: true })
  await assert.rejects(selectResources(root), /npm run build:cli/)
  assert.deepEqual(buildSteps(), ['build:cli', 'build'])
})

test('vendor/stt 接口版本对得上才随包，不对直接报错', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cli = await bundle(root, 'cli', 'mediacrawler')
  const stt = path.join(root, 'vendor/stt')
  await mkdir(path.join(stt, '_internal'), { recursive: true })
  await writeFile(path.join(stt, 'stt'), 'fixture', { mode: 0o755 })
  const manifest = (fields) =>
    writeFile(
      path.join(stt, 'manifest.json'),
      JSON.stringify({
        name: 'stt',
        version: '0.1.0',
        platform: `${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`,
        schema_version: { check: 2, status: 1, http: 'v1' },
        ...fields,
      }),
    )
  await manifest({})
  assert.deepEqual(await selectResources(root), {
    resources: [cli, stt],
    stt: '0.1.0',
  })
  await manifest({ schema_version: { check: 1, http: 'v1' } })
  await assert.rejects(selectResources(root), /schema_version 是 1/)
  await manifest({ platform: 'linux-x64' })
  await assert.rejects(selectResources(root), /平台是 linux-x64/)
})
