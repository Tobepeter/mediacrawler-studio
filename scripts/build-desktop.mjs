import { packager } from '@electron/packager'
import {
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
  stat,
  access,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function buildSteps({ strict = false, withoutCli = false } = {}) {
  if (strict && withoutCli) throw new Error('严格模式不能排除 CLI')
  return [...(strict ? ['build:cli'] : []), 'build:runtime', 'build']
}

// PyInstaller onedir 必须连同依赖目录一起分发
export async function bundleExists(directory, name) {
  const executable = path.join(
    directory,
    process.platform === 'win32' ? `${name}.exe` : name,
  )
  try {
    if (!(await stat(executable)).isFile()) return false
    if (!(await stat(path.join(directory, '_internal'))).isDirectory())
      return false
    await access(executable, constants.X_OK)
    return true
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return false
    throw error
  }
}

export async function selectResources(
  root,
  { strict = false, withoutCli = false } = {},
) {
  buildSteps({ strict, withoutCli })
  const runtime = path.join(root, 'dist/runtime/studio-python')
  const cli = path.join(root, 'dist/cli/mediacrawler')
  if (!(await bundleExists(runtime, 'studio-python')))
    throw new Error('桌面 Python 运行时缺失，请先运行 npm run build:runtime')
  const hasCli = !withoutCli && (await bundleExists(cli, 'mediacrawler'))
  if (strict && !hasCli) throw new Error('严格模式要求完整的 CLI 构建产物')
  return { resources: [runtime, ...(hasCli ? [cli] : [])], hasCli }
}

async function buildDesktop(options) {
  const root = process.cwd()
  for (const step of buildSteps(options)) {
    const result = spawnSync('npm', ['run', step], {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if (result.error || result.status !== 0)
      throw new Error(`构建 ${step} 失败，桌面打包已停止`, {
        cause: result.error,
      })
  }
  const { resources, hasCli } = await selectResources(root, options)
  console.log(`桌面 Python：已包含；独立 CLI：${hasCli ? '已包含' : '未包含'}`)
  const stage = path.join(root, 'build/desktop-app')
  await rm(stage, { recursive: true, force: true })
  await mkdir(stage, { recursive: true })
  for (const source of ['desktop', 'api/webui', 'LICENSE']) {
    await cp(path.join(root, source), path.join(stage, source), {
      recursive: true,
      filter: (file) =>
        !file.includes('/tests') && !file.includes('__pycache__'),
    })
  }
  const pkg = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  )
  await writeFile(
    path.join(stage, 'package.json'),
    JSON.stringify({ name: pkg.name, version: pkg.version, main: pkg.main }),
  )
  const electron = JSON.parse(
    await readFile(
      path.join(root, 'node_modules/electron/package.json'),
      'utf8',
    ),
  )
  await packager({
    dir: stage,
    out: path.join(root, 'dist/desktop'),
    name: 'MediaCrawler Studio',
    appBundleId: 'studio.mediacrawler.app',
    electronVersion: electron.version,
    icon: path.join(root, 'desktop/assets/icon'),
    extraResource: resources,
    asar: true,
    overwrite: true,
    prune: false,
  })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const flags = process.argv.slice(2)
  if (flags.some((flag) => !['--strict', '--without-cli'].includes(flag)))
    throw new Error('支持的参数：--strict、--without-cli')
  await buildDesktop({
    strict: flags.includes('--strict'),
    withoutCli: flags.includes('--without-cli'),
  })
}
