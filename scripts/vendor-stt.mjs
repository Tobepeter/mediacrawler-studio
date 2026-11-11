// 把 ai-voice 构建的 stt 独立包放进 build/vendor/stt，打包时随安装版分发
// 用法：npm run vendor:stt -- /path/to/stt-<版本>-macos-arm64.zip（同目录要有 .sha256）
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// 接口版本对不上就不收，免得装进去才发现字段变了
export const STT_SCHEMA = { check: 2, http: 'v1' }

export function sttManifestProblem(manifest) {
  if (manifest?.name !== 'stt') return 'manifest 不是 stt'
  if (
    manifest.platform !==
    `${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`
  )
    return `平台不符：${manifest.platform}`
  if (manifest.schema_version?.check !== STT_SCHEMA.check)
    return `stt check 的 schema_version 是 ${manifest.schema_version?.check}，需要 ${STT_SCHEMA.check}`
  if (manifest.schema_version?.http !== STT_SCHEMA.http)
    return `HTTP 接口是 ${manifest.schema_version?.http}，需要 ${STT_SCHEMA.http}`
  return ''
}

export async function readSttManifest(directory) {
  try {
    return JSON.parse(
      await readFile(path.join(directory, 'manifest.json'), 'utf8'),
    )
  } catch {
    return null
  }
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function vendor(zip) {
  const root = process.cwd()
  const expected = (await readFile(`${zip}.sha256`, 'utf8'))
    .trim()
    .split(/\s+/)[0]
  if ((await sha256(zip)) !== expected)
    throw new Error('sha256 不符，包可能不完整')
  const vendorDir = path.join(root, 'build/vendor')
  const staging = path.join(vendorDir, '.stt-new')
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  // onedir 里有符号链接，用 ditto 解压才能原样保留
  const result = spawnSync('ditto', ['-x', '-k', zip, staging], {
    stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error('解压失败')
  const extracted = path.join(staging, 'stt')
  const manifest = await readSttManifest(extracted)
  const problem = sttManifestProblem(manifest)
  if (problem) throw new Error(problem)
  const target = path.join(vendorDir, 'stt')
  await rm(target, { recursive: true, force: true })
  await rename(extracted, target)
  await rm(staging, { recursive: true, force: true })
  console.log(
    `stt ${manifest.version}（${manifest.build}）已放到 ${path.relative(root, target)}`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const zip = process.argv[2]
  if (!zip) throw new Error('用法：npm run vendor:stt -- <stt-版本-平台.zip>')
  await vendor(path.resolve(zip))
}
