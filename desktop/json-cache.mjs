import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// 一类缓存一个文件，条目带写入时间；文件损坏或版本变化都当作没有缓存，缓存不能影响主流程
export class JsonCache {
  entries = null

  constructor(dir, name, { version = 1, ttlMs, now = Date.now, logger } = {}) {
    Object.assign(this, { dir, version, ttlMs, now, logger })
    this.file = path.join(dir, `${name}.json`)
  }

  load() {
    if (this.entries) return this.entries
    try {
      const stored = JSON.parse(readFileSync(this.file, 'utf8'))
      this.entries =
        stored?.version === this.version && stored.entries
          ? new Map(Object.entries(stored.entries))
          : new Map()
    } catch {
      this.entries = new Map()
    }
    return this.entries
  }

  get(key) {
    const entry = this.load().get(key)
    if (!entry) return undefined
    if (this.now() - entry.savedAt < this.ttlMs) return entry.value
    this.delete(key)
    return undefined
  }

  // 距写入过去了多久；没有条目或已过期返回 undefined
  age(key) {
    const entry = this.load().get(key)
    const age = entry && this.now() - entry.savedAt
    return age !== undefined && age < this.ttlMs ? age : undefined
  }

  has(key) {
    return this.get(key) !== undefined
  }

  set(key, value) {
    this.load().set(key, { savedAt: this.now(), value })
    this.write()
  }

  delete(key) {
    if (this.load().delete(key)) this.write()
  }

  write() {
    const temporary = `${this.file}.tmp`
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      // 地址里带平台的访问参数，只给当前用户读
      writeFileSync(
        temporary,
        JSON.stringify({
          version: this.version,
          entries: Object.fromEntries(this.entries),
        }),
        { mode: 0o600 },
      )
      renameSync(temporary, this.file)
    } catch (error) {
      this.logger?.write('warn', 'storage', 'cache-write-failed', error)
    }
  }
}
