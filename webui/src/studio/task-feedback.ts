import type { StudioState } from './types'

// 只响应同一任务的状态变化；快照、历史恢复和重复事件保持安静
export function taskFeedback(
  previous: StudioState | undefined,
  next: StudioState,
) {
  const before = previous?.task
  const task = next.task
  if (
    !before ||
    !task ||
    (task.silent && task.status !== 'auth' && before.status !== 'auth') ||
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
  if (!wasActive && !newWarning) return
  const id = `task-${task.platform}-${task.startedAt}`
  const count = next.results.length
  if (task.silent && task.status === 'error') return
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
