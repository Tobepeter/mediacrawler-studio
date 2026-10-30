import {
  appendFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { redact } from './redact.mjs'

// 单主进程写入，有限大小轮转；故障日志同步写入以保留退出前的异常
export class StudioLogger {
  window = 0
  count = 0
  dropped = 0
  warned = false

  constructor(
    directory,
    { maxBytes = 5 * 1024 * 1024, maxFiles = 5, maxPerMinute = 120 } = {},
  ) {
    this.directory = directory
    this.maxBytes = Math.max(1024, maxBytes)
    this.maxFiles = Math.max(1, maxFiles)
    this.maxPerMinute = maxPerMinute
  }

  file(index = 0) {
    return path.join(
      this.directory,
      index ? `studio.${index}.log` : 'studio.log',
    )
  }

  write(level, source, event, detail = {}) {
    try {
      const minute = Math.floor(Date.now() / 60000)
      if (this.window !== minute) {
        this.window = minute
        this.count = 0
        if (this.dropped)
          this.append('warn', 'logger', 'rate-limited', { count: this.dropped })
        this.dropped = 0
      }
      if (++this.count > this.maxPerMinute) {
        this.dropped++
        return
      }
      this.append(level, source, event, detail)
    } catch {
      // 磁盘故障不影响业务，也不把未经脱敏的异常输出到控制台
      if (!this.warned)
        process.stderr.write('Studio: diagnostic log unavailable\n')
      this.warned = true
    }
  }

  append(level, source, event, detail) {
    const entry = {
      time: new Date().toISOString(),
      level: ['info', 'warn', 'error'].includes(level) ? level : 'error',
      source: redact(String(source)).slice(0, 80),
      event: redact(String(event)).slice(0, 120),
      detail: redact(detail),
    }
    let line = JSON.stringify(entry) + '\n'
    if (Buffer.byteLength(line) > Math.min(32768, this.maxBytes)) {
      entry.detail = { truncated: true }
      line = JSON.stringify(entry) + '\n'
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    let size = 0
    try {
      size = statSync(this.file()).size
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (size + Buffer.byteLength(line) > this.maxBytes) {
      rmSync(this.file(this.maxFiles - 1), { force: true })
      for (let i = this.maxFiles - 2; i >= 0; i--) {
        try {
          renameSync(this.file(i), this.file(i + 1))
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
      }
    }
    appendFileSync(this.file(), line, { mode: 0o600 })
  }
}

// 仅监听应用自身页面，不采集第三方登录页面/播放器控制台
export function attachRendererLogs(contents, logger) {
  contents.on('console-message', (details) => {
    if (
      details.frame !== contents.mainFrame ||
      !['warning', 'error'].includes(details.level)
    )
      return
    logger.write(
      details.level === 'error' ? 'error' : 'warn',
      'renderer',
      'console',
      {
        message: details.message,
        file: details.sourceId,
        line: details.lineNumber,
      },
    )
  })
  contents.on('render-process-gone', (_event, details) =>
    logger.write('error', 'renderer', 'process-gone', details),
  )
  contents.on('preload-error', (_event, _path, error) =>
    logger.write('error', 'renderer', 'preload', error),
  )
  contents.on('did-fail-load', (_event, code, message, _url, mainFrame) => {
    if (mainFrame && code !== -3)
      logger.write('error', 'renderer', 'load-failed', { code, message })
  })
}
