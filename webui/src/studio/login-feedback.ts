import type { Platform, StudioState } from './types'

// 前端自己判定取码超时时写进视图的错误，同时也是翻译键
export const QR_TIMEOUT = '获取二维码超时，请重试'

// 并行登录只通知当前前台平台，不重放缓存或其他平台的事件
export function loginFeedback(
  previous: StudioState | undefined,
  next: StudioState,
  foreground: { platform: Platform; visible: boolean },
) {
  if (!previous || !foreground.visible) return
  const before = previous.logins?.[foreground.platform]
  const login = next.logins?.[foreground.platform]
  if (!login?.id || before?.id !== login.id || before.status === login.status)
    return
  const id = `login-${foreground.platform}-${login.id}`
  if (
    login.status === 'connected' &&
    ['ready', 'confirming'].includes(before.status)
  )
    return { id, kind: 'success' as const, message: '登录成功' }
  if (login.status !== 'error') return
  const messages: Record<string, string> = {
    NETWORK_OFFLINE: '网络已断开，请检查网络连接',
    DNS_FAILED: '暂时无法解析平台地址，请检查网络',
    CONNECTION_FAILED: '暂时无法连接平台，请稍后重试',
    TLS_FAILED: '平台安全连接失败，请检查网络设置',
    VERIFICATION_REQUIRED: '平台需要额外验证，请稍后重试或反馈问题',
  }
  const message = messages[login.failure?.code || '']
  if (message) return { id, kind: 'warning' as const, message }
}
