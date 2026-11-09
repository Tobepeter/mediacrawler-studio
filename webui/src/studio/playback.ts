import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const defaults = { autoplay: true, autoplayMuted: false }
const debugMuteMs = 60000
let debugDrivenAt = 0

export const usePlayback = create(
  persist(() => defaults, { name: 'studio-playback' }),
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
