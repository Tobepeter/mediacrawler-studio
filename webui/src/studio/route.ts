import { useSyncExternalStore } from 'react'

// 两个桌面页面使用 hash 地址，兼容 Vite 与打包后的 file 页面
const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}
const snapshot = () =>
  window.location.hash === '#/history' ? 'history' : 'collect'

export const useStudioRoute = () =>
  useSyncExternalStore(subscribe, snapshot, () => 'collect')
