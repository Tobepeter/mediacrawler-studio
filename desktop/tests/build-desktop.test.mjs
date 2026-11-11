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

test('宽松包始终要求内部运行时，CLI 缺失可打包，严格模式拒绝', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(selectResources(root), /Python 运行时缺失/)
  const runtime = await bundle(root, 'runtime', 'studio-python')
  assert.deepEqual(await selectResources(root), {
    resources: [runtime],
    hasCli: false,
    stt: null,
  })
  await assert.rejects(selectResources(root, { strict: true }), /完整的 CLI/)
  const cli = await bundle(root, 'cli', 'mediacrawler')
  assert.deepEqual(await selectResources(root, { strict: true }), {
    resources: [runtime, cli],
    hasCli: true,
    stt: null,
  })
  assert.deepEqual(await selectResources(root, { withoutCli: true }), {
    resources: [runtime],
    hasCli: false,
    stt: null,
  })
  await rm(path.join(cli, '_internal'), { recursive: true })
  assert.equal((await selectResources(root)).hasCli, false)
  await assert.rejects(selectResources(root, { strict: true }), /完整的 CLI/)
})

test('严格模式只构建一次 CLI，全量命令复用严格模式', async () => {
  assert.deepEqual(buildSteps(), ['build:runtime', 'build'])
  assert.deepEqual(buildSteps({ strict: true }), [
    'build:cli',
    'build:runtime',
    'build',
  ])
  assert.throws(
    () => buildSteps({ strict: true, withoutCli: true }),
    /不能排除/,
  )
  const { readFile } = await import('node:fs/promises')
  const pkg = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  )
  assert.equal(pkg.scripts['build:all'], 'npm run build:desktop:strict')
})

test('build/vendor/stt 接口版本对得上才随包，不对直接报错', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runtime = await bundle(root, 'runtime', 'studio-python')
  const stt = path.join(root, 'build/vendor/stt')
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
    resources: [runtime, stt],
    hasCli: false,
    stt: '0.1.0',
  })
  await manifest({ schema_version: { check: 1, http: 'v1' } })
  await assert.rejects(selectResources(root), /schema_version 是 1/)
  await manifest({ platform: 'linux-x64' })
  await assert.rejects(selectResources(root), /平台不符/)
})
