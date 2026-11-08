import type { Platform } from './types'
import { useStudio } from './store'

// 切 Tab 只提升该平台优先级；队列、缓存和取消属于主进程
export class LoginController {
  private unsubscribe?: () => void
  private platform?: string
  private active = false
  private foreground?: Platform | null

  start() {
    this.active = true
    this.foreground = undefined
    this.platform = undefined
    this.unsubscribe = useStudio.subscribe(this.sync)
    window.addEventListener('hashchange', this.sync)
    document.addEventListener('visibilitychange', this.sync)
    this.sync()
    return () => {
      this.active = false
      this.unsubscribe?.()
      window.removeEventListener('hashchange', this.sync)
      document.removeEventListener('visibilitychange', this.sync)
      void window.studio?.setLoginForeground?.(null).catch(() => {})
    }
  }

  private sync = () => {
    const state = useStudio.getState()
    if (!this.active || !state.ready || !window.studio?.ensureLogin) return
    const foreground =
      document.visibilityState === 'visible' &&
      window.location.hash !== '#/history'
        ? state.platform
        : null
    if (foreground !== this.foreground) {
      this.foreground = foreground
      void window.studio.setLoginForeground?.(foreground).catch(() => {})
    }
    if (
      window.location.hash === '#/history' ||
      this.platform === state.platform
    )
      return
    this.platform = state.platform
    void window.studio.ensureLogin(state.platform).catch(() => {})
  }
}
