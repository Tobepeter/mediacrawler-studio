import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { platforms } from './contracts.mjs'

const active = ['checking', 'auth', 'running', 'stopping']

// 按采集批次保存，页面只持有选中记录；旧结果文件保留作为迁移备份
export class StudioLibrary {
  persistence = Promise.resolve()
  entries = new Map()
  workspace = { drafts: {}, selections: {} }

  constructor(dataDir) {
    this.dataDir = dataDir
    this.directory = path.join(dataDir, 'history')
  }

  async init() {
    await mkdir(this.directory, { recursive: true })
    try {
      this.workspace = JSON.parse(
        await readFile(path.join(this.dataDir, 'workspace.json'), 'utf8'),
      )
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error('无法读取页面记录，请保留数据目录后重试', {
          cause: error,
        })
    }
    this.entries.clear()
    for (const name of await readdir(this.directory)) {
      if (!/^[a-zA-Z0-9-]+\.json$/.test(name)) continue
      const record = JSON.parse(
        await readFile(path.join(this.directory, name), 'utf8'),
      )
      if (
        record.id !== name.slice(0, -5) ||
        !record.task ||
        !Array.isArray(record.results)
      )
        continue
      if (active.includes(record.task.status)) {
        record.task = {
          ...record.task,
          status: 'cancelled',
          message: '上次采集中断，已保留结果',
          finishedAt: Date.now(),
        }
        for (const item of record.results) {
          if (['pending', 'running'].includes(item.commentStatus))
            item.commentStatus = 'cancelled'
        }
        await this.saveRun(record)
      } else this.index(record)
    }
    if (!this.workspace.migrated) {
      await this.migrate()
      this.workspace.migrated = true
      this.saveWorkspace()
    }
    await this.persistence
  }

  index(record) {
    this.entries.set(record.id, {
      id: record.id,
      task: { ...record.task },
      count: record.results.length,
    })
  }

  list() {
    return [...this.entries.values()].sort(
      (a, b) => b.task.startedAt - a.task.startedAt,
    )
  }

  write(file, value) {
    const data = JSON.stringify(value)
    const job = this.persistence
      .catch(() => {})
      .then(async () => {
        await writeFile(`${file}.tmp`, data, { mode: 0o600 })
        await rename(`${file}.tmp`, file)
      })
    this.persistence = job
    return job
  }

  saveRun(record) {
    this.index(record)
    return this.write(path.join(this.directory, `${record.id}.json`), record)
  }

  saveWorkspace() {
    return this.write(path.join(this.dataDir, 'workspace.json'), this.workspace)
  }

  async get(id) {
    if (typeof id !== 'string' || !this.entries.has(id))
      throw new Error('历史记录不存在')
    await this.persistence
    return JSON.parse(
      await readFile(path.join(this.directory, `${id}.json`), 'utf8'),
    )
  }

  async migrate() {
    let saved
    try {
      saved = JSON.parse(
        await readFile(path.join(this.dataDir, 'results.json'), 'utf8'),
      )
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw new Error('无法迁移上次结果，原始文件已保留', { cause: error })
    }
    for (const platform of Object.keys(platforms)) {
      const results = (saved.results || []).filter(
        (item) => item.platform === platform,
      )
      if (!results.length) continue
      const matches =
        saved.task?.action === 'collect' && saved.task.platform === platform
      const task = matches
        ? saved.task
        : {
            platform,
            action: 'collect',
            mode: 'search',
            query: '',
            limit: results.length,
            startedAt: Date.now(),
          }
      const id = `legacy-${platform}`
      if (!this.entries.has(id))
        await this.saveRun({
          id,
          results,
          task: {
            ...task,
            status: 'restored',
            message: '之前的采集',
            finishedAt: task.finishedAt || Date.now(),
          },
        })
      this.workspace.selections[platform] = id
      this.workspace.drafts[platform] = {
        platform,
        mode: task.mode,
        query: task.query,
        limit: Math.min(100, task.limit),
      }
    }
  }
}
