// 一串连续调用只执行一次：空闲时立刻执行，后续调用丢弃；冷却中才开始的一串等冷却结束执行一次，用最新参数
// burstGap 是隔多久算新的一串，必须小于 cooldown，否则冷却中不会出现新的一串
// 头执行后同一串的后续调用会被丢弃，必须以最后一次为准的场景（同步输入内容等）用防抖
export function throttleOnce(fn, { cooldown, burstGap = cooldown / 4 }) {
  if (!(burstGap > 0 && burstGap < cooldown))
    throw new RangeError('burstGap 必须大于 0 且小于 cooldown')
  let lastRun = -Infinity
  let lastCall = -Infinity
  let timer = null
  let lastArgs
  const run = () => {
    timer = null
    lastRun = Date.now()
    fn(...lastArgs)
  }
  const throttled = (...args) => {
    const now = Date.now()
    const sameBurst = now - lastCall < burstGap
    lastCall = now
    lastArgs = args
    if (timer !== null || sameBurst) return
    const left = lastRun + cooldown - now
    if (left <= 0) run()
    // 系统时间被往回调时，最多等一个冷却
    else timer = setTimeout(run, Math.min(left, cooldown))
  }
  throttled.cancel = () => {
    clearTimeout(timer)
    timer = null
  }
  return throttled
}
