import {
  access,
  lstat,
  mkdir,
  readlink,
  stat,
  symlink,
  unlink,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'

// macOS 命令入口，只管理指向当前应用的软链接
export class CliInstall {
  constructor({
    packaged,
    resources,
    platform = process.platform,
    directory = '/usr/local/bin',
  }) {
    this.packaged = packaged
    this.platform = platform
    this.target = path.join(resources, 'mediacrawler', 'mediacrawler')
    this.link = path.join(directory, 'mediacrawler')
    this.busy = false
  }

  async status() {
    const supported = this.platform === 'darwin'
    const development = !this.packaged
    let available = false
    if (supported && this.packaged) {
      try {
        available =
          (await stat(this.target)).isFile() &&
          (
            await stat(path.join(path.dirname(this.target), '_internal'))
          ).isDirectory()
        await access(this.target, constants.X_OK)
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error
        available = false
      }
    }
    let installed = false
    let conflict = false
    if (supported && !development) {
      try {
        const info = await lstat(this.link)
        installed =
          info.isSymbolicLink() &&
          path.resolve(path.dirname(this.link), await readlink(this.link)) ===
            this.target
        conflict = !installed
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    return {
      supported,
      development,
      available,
      installed,
      conflict,
      path: this.link,
    }
  }

  async change(action) {
    if (!['install', 'remove'].includes(action))
      return { ok: false, code: 'invalid' }
    if (this.busy) return { ok: false, code: 'busy' }
    this.busy = true
    try {
      const state = await this.status()
      if (!state.available) return { ok: false, code: 'unavailable' }
      if (state.conflict) return { ok: false, code: 'conflict' }
      if (action === 'install' && !state.installed) {
        await mkdir(path.dirname(this.link), { recursive: true })
        // 不使用覆盖/强制选项，保留其他来源的同名命令
        await symlink(this.target, this.link)
      }
      if (action === 'remove' && state.installed) await unlink(this.link)
      return { ok: true, state: await this.status() }
    } catch (error) {
      const code = ['EACCES', 'EPERM', 'EROFS'].includes(error.code)
        ? 'permission'
        : error.code === 'EEXIST'
          ? 'conflict'
          : 'failed'
      return { ok: false, code }
    } finally {
      this.busy = false
    }
  }
}
