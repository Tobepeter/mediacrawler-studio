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

// CLI 的运行时就是桌面的运行时，每次都重新构建，免得带上旧版本
export function buildSteps() {
  return ['build:cli', 'build']
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

// 接口版本对不上就不带，免得装进去才发现字段变了
export const STT_SCHEMA = { check: 2, http: 'v1' }

export function sttManifestProblem(manifest) {
  if (manifest?.name !== 'stt') return 'manifest.json 不是 stt 的'
  const platform = `${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`
  if (manifest.platform !== platform)
    return `平台是 ${manifest.platform}，这台机器是 ${platform}`
  if (manifest.schema_version?.check !== STT_SCHEMA.check)
    return `stt check 的 schema_version 是 ${manifest.schema_version?.check}，需要 ${STT_SCHEMA.check}`
  if (manifest.schema_version?.http !== STT_SCHEMA.http)
    return `HTTP 接口是 ${manifest.schema_version?.http}，需要 ${STT_SCHEMA.http}`
  return ''
}

async function readManifest(directory) {
  try {
    return JSON.parse(
      await readFile(path.join(directory, 'manifest.json'), 'utf8'),
    )
  } catch {
    return null
  }
}

export async function selectResources(root) {
  const cli = path.join(root, 'dist/cli/mediacrawler')
  if (!(await bundleExists(cli, 'mediacrawler')))
    throw new Error('Python 运行时缺失，请先运行 npm run build:cli')
  // 语音转写可选：把 ai-voice 交付的 stt 文件夹复制到 vendor/stt 才带，没有就不带
  const sttDir = path.join(root, 'vendor/stt')
  let stt = null
  if (await bundleExists(sttDir, 'stt')) {
    const problem = sttManifestProblem(await readManifest(sttDir))
    if (problem) throw new Error(`vendor/stt 不能用：${problem}`)
    stt = (await readManifest(sttDir)).version
  }
  return { resources: [cli, ...(stt ? [sttDir] : [])], stt }
}

// packager 自带的复制会把相对符号链接改成指向构建目录的绝对路径，换台机器就断；这里原样再复制一遍
async function copyResources(appPath, name, resources) {
  const target =
    process.platform === 'darwin'
      ? path.join(appPath, `${name}.app`, 'Contents/Resources')
      : path.join(appPath, 'resources')
  for (const resource of resources) {
    const destination = path.join(target, path.basename(resource))
    await rm(destination, { recursive: true, force: true })
    await cp(resource, destination, { recursive: true, verbatimSymlinks: true })
  }
}

async function buildDesktop() {
  const root = process.cwd()
  for (const step of buildSteps()) {
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
  const { resources, stt } = await selectResources(root)
  console.log(`语音转写：${stt ? `stt ${stt}` : '未包含（vendor/stt 没有）'}`)
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
  const name = 'MediaCrawler Studio'
  const apps = await packager({
    dir: stage,
    out: path.join(root, 'dist/desktop'),
    name,
    appBundleId: 'studio.mediacrawler.app',
    electronVersion: electron.version,
    icon: path.join(root, 'desktop/assets/icon'),
    asar: true,
    overwrite: true,
    prune: false,
  })
  for (const app of apps) await copyResources(app, name, resources)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  if (process.argv.length > 2) throw new Error('不支持参数')
  await buildDesktop()
}
