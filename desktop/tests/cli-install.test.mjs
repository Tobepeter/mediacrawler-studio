import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtemp,
  mkdir,
  writeFile,
  chmod,
  readlink,
  readFile,
  rm,
  symlink,
  lstat,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CliInstall } from '../cli-install.mjs'

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cli = new CliInstall({
    packaged: true,
    platform: 'darwin',
    resources: root,
    directory: path.join(root, 'bin'),
    ...overrides,
  })
  await mkdir(path.join(root, 'mediacrawler', '_internal'), { recursive: true })
  await writeFile(cli.target, '#!/bin/sh\nexit 0\n')
  await chmod(cli.target, 0o755)
  return cli
}

test('安装和移除幂等，保留 CLI 本体', async (t) => {
  const cli = await fixture(t)
  assert.equal((await cli.status()).available, true)
  assert.equal((await cli.change('install')).state.installed, true)
  assert.equal(await readlink(cli.link), cli.target)
  assert.equal((await cli.change('install')).ok, true)
  assert.equal((await cli.change('remove')).state.installed, false)
  assert.equal((await cli.change('remove')).ok, true)
  assert.ok((await readFile(cli.target, 'utf8')).includes('exit 0'))
})

test('同名文件和其他来源的软链接均不覆盖、不删除', async (t) => {
  const cli = await fixture(t)
  await mkdir(path.dirname(cli.link))
  await writeFile(cli.link, 'other installation')
  for (const action of ['install', 'remove']) {
    assert.deepEqual(await cli.change(action), { ok: false, code: 'conflict' })
  }
  assert.equal(await readFile(cli.link, 'utf8'), 'other installation')
  await rm(cli.link)
  await symlink('/missing/other/mediacrawler', cli.link)
  assert.equal((await cli.change('remove')).code, 'conflict')
  assert.equal(await readlink(cli.link), '/missing/other/mediacrawler')
})

test('开发、未包含 CLI 和不支持的平台不能安装', async (t) => {
  for (const overrides of [{ packaged: false }, { platform: 'win32' }]) {
    const cli = await fixture(t, overrides)
    assert.equal((await cli.change('install')).code, 'unavailable')
    await assert.rejects(lstat(cli.link), { code: 'ENOENT' })
  }
  const cli = await fixture(t)
  await rm(path.join(path.dirname(cli.target), '_internal'), {
    recursive: true,
  })
  assert.equal((await cli.status()).available, false)
  assert.equal((await cli.change('install')).code, 'unavailable')
})

test('重复点击串行化，错误返回可翻译的状态码', async (t) => {
  const cli = await fixture(t)
  const first = cli.change('install')
  assert.equal((await cli.change('remove')).code, 'busy')
  assert.equal((await first).ok, true)
  assert.equal((await cli.change('anything')).code, 'invalid')
  cli.status = async () => {
    throw Object.assign(new Error('denied'), { code: 'EACCES' })
  }
  assert.equal((await cli.change('remove')).code, 'permission')
  assert.equal(cli.busy, false)
})
