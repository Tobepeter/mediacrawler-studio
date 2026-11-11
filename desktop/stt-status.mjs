// stt 在哪、能不能用、缺什么；和 desktop/transcribe.py 的 locate / check / missing_of 一一对应
import { execFile } from 'node:child_process'
import { accessSync, constants, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const sttUrl = 'http://127.0.0.1:29556'

function executable(file) {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// 安装版在资源目录 resources/stt/stt，源码运行时在 vendor/stt/stt（手动复制进来，没有就算没有）
export function bundledStt({ packaged, resources, root }) {
  const file = packaged
    ? path.join(resources, 'stt', 'stt')
    : path.join(root, 'vendor/stt/stt')
  return executable(file) ? file : null
}

// 包里的优先，没有再找本机装的；Electron 启动的进程 PATH 里通常没有 ~/.local/bin
export function locateStt({
  bundled,
  pathEnv = process.env.PATH,
  home = homedir(),
}) {
  if (bundled) return { path: bundled, source: 'bundled' }
  const dirs = [
    ...(pathEnv || '').split(path.delimiter).filter(Boolean),
    path.join(home, '.local/bin'),
  ]
  const file = dirs.map((dir) => path.join(dir, 'stt')).find(executable)
  return file ? { path: file, source: 'system' } : { path: null, source: null }
}

export function bundleVersion(file) {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(path.dirname(file), 'manifest.json'), 'utf8'),
    )
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

const pages = {
  modelscope: (repo) => `https://modelscope.cn/models/${repo}/files`,
  huggingface: (repo) => `https://huggingface.co/${repo}/tree/main`,
}

// stt check（schema_version 2）收成界面要的样子：缺什么、多大、放到哪；只看默认模型需要的
export function missingOf(report) {
  const checks = new Map(
    (report?.checks || []).map((item) => [item?.id, item || {}]),
  )
  return (report?.missing || [])
    .filter((item) => item && item.required_for_default !== false)
    .map((item) => {
      const detail = checks.get(item.id) || {}
      const model =
        detail.model && typeof detail.model === 'object' ? detail.model : {}
      return {
        id: item.id,
        kind: item.kind,
        name: model.name || item.model || item.id,
        message: detail.message || '',
        sizeBytes: model.missing_bytes ?? item.size_bytes ?? null,
        path: item.expected_path || detail.path || null,
        files: model.missing_files || item.files || [],
        hint: item.hint || detail.hint || '',
        pages: (model.sources || []).flatMap((source) =>
          pages[source?.hub] && source.repo_id
            ? [{ hub: source.hub, url: pages[source.hub](source.repo_id) }]
            : [],
        ),
      }
    })
}

// 静态检查，不加载模型、不下载；没通过时退出码是 1，JSON 照样在 stdout
export function runCheck(file, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(file, ['check', '--json'], { timeout }, (_error, stdout) => {
      try {
        const report = JSON.parse(stdout)
        resolve(
          report && typeof report === 'object' && 'ok' in report
            ? report
            : null,
        )
      } catch {
        resolve(null)
      }
    })
  })
}

async function service(fetchImpl) {
  try {
    const response = await fetchImpl(`${sttUrl}/v1/status`, {
      signal: AbortSignal.timeout(2000),
    })
    const data = await response.json()
    return data?.service === 'stt' ? data : null
  } catch {
    return null
  }
}

// ready 已连上；installed 后台没起但条件齐了，提取时叫醒；incomplete 缺模型或依赖；missing 没有 stt
export async function sttStatus({
  bundled,
  fetchImpl = fetch,
  check = runCheck,
  locate = locateStt,
}) {
  const { path: file, source } = locate({ bundled })
  const base = {
    source,
    path: file,
    version: source === 'bundled' ? bundleVersion(file) : null,
  }
  const data = await service(fetchImpl)
  if (data) return { ...base, state: 'ready', busy: !!data.busy }
  if (!file) return { ...base, state: 'missing', busy: false }
  const report = await check(file)
  const missing = report && !report.ok ? missingOf(report) : []
  if (!missing.length) return { ...base, state: 'installed', busy: false }
  return {
    ...base,
    state: 'incomplete',
    busy: false,
    missing,
    downloadBytes: missing.reduce((sum, row) => sum + (row.sizeBytes || 0), 0),
  }
}
