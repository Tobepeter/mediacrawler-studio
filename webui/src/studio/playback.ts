import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 开关都用否定含义，默认全不勾选，恢复默认就是全部取消
const defaults = { noAutoplay: false, autoplayMuted: false }
const debugMuteMs = 60000
let debugDrivenAt = 0

export const usePlayback = create(
  persist(() => defaults, { name: 'studio-video-playback' }),
)

export function setPlayback(value: Partial<typeof defaults>) {
  try {
    usePlayback.setState(value)
    return true
  } catch {
    return false
  }
}

export const resetPlayback = () => setPlayback(defaults)

// 调试脚本碰过调试入口后一分钟内都静音，不改设置，脚本停了声音自动恢复
export function markDebugDriven() {
  debugDrivenAt = Date.now()
}

export function startMuted(auto: boolean) {
  return (
    (auto && usePlayback.getState().autoplayMuted) ||
    Date.now() - debugDrivenAt < debugMuteMs
  )
}
