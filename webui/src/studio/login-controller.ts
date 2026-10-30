import { activeStatuses, useStudio } from './store'

// 应用级协调二维码登录，组件仅负责展示；主动退出/失败后不循环重试
export class LoginController {
  private unsubscribe?: () => void
  private stopping = false
  private active = false
  private resumeAfterHistory?: string

  start() {
    this.active = true
    this.unsubscribe = useStudio.subscribe(this.sync)
    window.addEventListener('hashchange', this.sync)
    this.sync()
    return () => {
      this.active = false
      this.unsubscribe?.()
      window.removeEventListener('hashchange', this.sync)
    }
  }

  private sync = () => {
    const state = useStudio.getState()
    if (!this.active || !window.studio || !state.ready || this.stopping) return
    const history = window.location.hash === '#/history'
    const task = state.task
    if (
      task?.action === 'connect' &&
      task.loginMode === 'qrcode' &&
      activeStatuses.includes(task.status) &&
      (history || task.platform !== state.platform)
    ) {
      if (history && task.platform === state.platform)
        this.resumeAfterHistory = task.platform
      this.stopping = true
      void window.studio
        .cancel()
        .catch(() => {})
        .finally(() => {
          this.stopping = false
          this.sync()
        })
      return
    }
    if (
      history ||
      state.busy ||
      state.pending ||
      activeStatuses.includes(task?.status || '')
    )
      return
    const resume =
      this.resumeAfterHistory === state.platform &&
      task?.platform === state.platform &&
      task.action === 'connect' &&
      task.status === 'cancelled'
    this.resumeAfterHistory = undefined
    // 真正打开历史记录时 task 会清空，不覆盖用户刚选中的结果
    if (state.pages[state.platform] && !resume) return
    const account = state.accounts[state.platform]
    if (
      account === 'connected' ||
      account === 'saved' ||
      (state.attempted[state.platform] && !resume)
    )
      return
    void state.start('connect')
  }
}
