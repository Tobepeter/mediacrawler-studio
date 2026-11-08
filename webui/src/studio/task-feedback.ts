import type { Platform, StudioState, StudioTask, ContentItem } from './types'

type TaskSnapshot = Pick<StudioState, 'accounts'> & {
  task?: StudioTask
  results: ContentItem[]
}

// 只响应同一任务的状态变化；快照、历史恢复和重复事件保持安静
export function taskFeedback(
  previous: TaskSnapshot | undefined,
  next: TaskSnapshot,
  foreground?: { platform: Platform; visible: boolean },
) {
  const before = previous?.task
  const task = next.task
  if (
    !before ||
    !task ||
    task.silent ||
    (foreground &&
      (!foreground.visible || foreground.platform !== task.platform)) ||
    before.startedAt !== task.startedAt ||
    before.platform !== task.platform ||
    before.action !== task.action
  )
    return
  const wasActive = ['checking', 'auth', 'running', 'stopping'].includes(
    before.status,
  )
  // 磁盘保存可能在任务结束后失败，用同一条通知更新为警告
  const newWarning =
    task.status === 'completed' &&
    task.warning &&
    task.warning !== before.warning
  const diagnosedStop =
    before.status === 'cancelled' && task.status === 'error' && !!task.failure
  if (!wasActive && !newWarning && !diagnosedStop) return
  const id = `task-${task.platform}-${task.startedAt}`
  const count = next.results.length
  // 滚动加载的结果和失败都显示在列表末尾，弹通知只会打扰；首批失败和空结果仍要提示
  if (
    !task.warning &&
    ((task.continued &&
      ['completed', 'cancelled', 'error'].includes(task.status)) ||
      (task.auto && task.status === 'completed' && count))
  )
    return
  if (task.silent && task.status === 'error') return
  if (task.status === 'error' && task.failure) {
    const messages: Record<string, string> = {
      NETWORK_OFFLINE: '网络已断开，请检查网络连接',
      DNS_FAILED: '暂时无法解析平台地址，请检查网络',
      CONNECTION_FAILED: '暂时无法连接平台，请稍后重试',
      HTTP_ERROR: '平台暂时无法正常响应，请稍后重试',
      ACCESS_RESTRICTED: '平台暂时限制访问，请稍后重试',
      TLS_FAILED: '平台安全连接失败，请检查网络设置',
      VERIFICATION_REQUIRED: '平台需要额外验证，请稍后重试或反馈问题',
    }
    const message = messages[task.failure.code]
    if (message) return { id, kind: 'warning' as const, message }
  }
  // 内联二维码已就地显示重试入口，后台失败不再叠加登录失败 toast
  if (
    task.action === 'connect' &&
    task.loginMode === 'qrcode' &&
    task.status === 'error'
  )
    return
  if (task.status === 'error')
    return {
      id,
      kind: 'error' as const,
      message: task.action === 'connect' ? '登录失败' : '采集失败',
      detail: task.message,
    }
  if (task.action === 'collect' && task.status === 'completed')
    return {
      id,
      kind: task.warning
        ? ('warning' as const)
        : count
          ? ('success' as const)
          : ('info' as const),
      message: task.warning
        ? '采集完成'
        : count
          ? '采集完成，共 {{count}} 条'
          : '未找到内容，试试其他关键词',
      detail: task.warning,
      count,
    }
  if (task.action === 'collect' && task.status === 'cancelled')
    return {
      id,
      kind: 'info' as const,
      message: count ? '采集已停止，保留 {{count}} 条结果' : '采集已停止',
      count,
    }
  if (
    before.status === 'auth' &&
    task.status !== 'cancelled' &&
    task.status !== 'stopping' &&
    previous?.accounts[task.platform] !== 'connected' &&
    next.accounts[task.platform] === 'connected'
  )
    return {
      id: `${id}-login`,
      kind: 'success' as const,
      message: '登录成功',
    }
}
