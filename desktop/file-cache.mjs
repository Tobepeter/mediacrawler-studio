import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

// 一条内容一个文件：读写只碰自己，不用整份重写；文件的修改时间就是淘汰顺序，不需要索引
export class FileCache {
  constructor(dir, { maxEntries, logger } = {}) {
    Object.assign(this, { dir, maxEntries, logger })
  }

  // 键里可能有冒号或平台给的特殊字符，编码后才能安全当文件名
  file(key) {
    return path.join(this.dir, `${encodeURIComponent(key)}.json`)
  }

  get(key) {
    try {
      return JSON.parse(readFileSync(this.file(key), 'utf8'))
    } catch {
      return undefined
    }
  }

  set(key, value) {
    const target = this.file(key)
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      writeFileSync(`${target}.tmp`, JSON.stringify(value), { mode: 0o600 })
      renameSync(`${target}.tmp`, target)
      this.evict()
    } catch (error) {
      this.logger?.write('warn', 'storage', 'cache-write-failed', error)
    }
  }

  entries() {
    try {
      return readdirSync(this.dir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
          const file = path.join(this.dir, name)
          return { file, ...statSync(file) }
        })
    } catch {
      return []
    }
  }

  evict() {
    const entries = this.entries()
    if (!this.maxEntries || entries.length <= this.maxEntries) return
    entries
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
      .slice(0, entries.length - this.maxEntries)
      .forEach(({ file }) => rmSync(file, { force: true }))
  }

  bytes() {
    return this.entries().reduce((sum, { size }) => sum + size, 0)
  }

  clear() {
    rmSync(this.dir, { recursive: true, force: true })
  }
}
