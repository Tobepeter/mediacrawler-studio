import { lstatSync } from 'node:fs'

const sleepSync = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const lockHeld = (file) => {
  try {
    lstatSync(file)
    return true
  } catch {
    return false
  }
}

// 用系统级单实例锁，进程崩溃也会自动释放，不靠全局变量或探测杀进程
// 拿不到锁时通知已打开的窗口，由用户决定是否切换，这里同步等对方退出
// 返回 owner 表示已持有锁；released 表示对方已退出，需要重新启动一个干净进程；busy 表示没等到
// 不在本进程里接管：Electron 重新申请到锁后不会正常创建窗口
export function acquireInstance(
  app,
  {
    build,
    lockFile,
    wait = true,
    onWaiting,
    timeoutMs = 60000,
    intervalMs = 250,
    sleep = sleepSync,
    now = Date.now,
  },
) {
  if (app.requestSingleInstanceLock({ build })) return 'owner'
  if (!wait) return 'busy'
  onWaiting?.()
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    sleep(intervalMs)
    if (!lockHeld(lockFile)) return 'released'
  }
  return 'busy'
}
