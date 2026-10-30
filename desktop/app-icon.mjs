import { nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'

// 与主进程一起分发，不依赖 Vite 地址或前端构建目录
export const appIcon = nativeImage.createFromPath(
  fileURLToPath(new URL('./assets/icon.png', import.meta.url)),
)

if (appIcon.isEmpty()) throw new Error('应用图标加载失败')
