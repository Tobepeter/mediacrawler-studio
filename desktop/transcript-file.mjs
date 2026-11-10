import { existsSync } from 'node:fs'
import path from 'node:path'

function timestamp(seconds) {
  const total = Math.max(0, Math.round((Number(seconds) || 0) * 1000))
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  return `${pad(Math.floor(total / 3600000))}:${pad(Math.floor(total / 60000) % 60)}:${pad(Math.floor(total / 1000) % 60)},${pad(total % 1000, 3)}`
}

export function transcriptContent(transcript, format) {
  if (format === 'txt' || !transcript.segments?.length)
    return `${transcript.text}\n`
  return transcript.segments
    .map(
      (row, index) =>
        `${index + 1}\n${timestamp(row.start)} --> ${timestamp(row.end)}\n${row.text}\n`,
    )
    .join('\n')
}

// 已有同名文件时加序号，不覆盖之前下载的
export function availablePath(target) {
  if (!existsSync(target)) return target
  const { dir, name, ext } = path.parse(target)
  for (let index = 2; ; index += 1) {
    const candidate = path.join(dir, `${name} (${index})${ext}`)
    if (!existsSync(candidate)) return candidate
  }
}
