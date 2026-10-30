# 应用图标

选用「狐狸与放大镜」，由本项目图标设计任务生成，原图直接保留为 `icon.png`

- `icon.png`：开发模式 Dock 与窗口使用；正式包不再调用 dock.setIcon 覆盖应用包图标
- `icon.icns`：macOS 应用包图标，使用系统 `sips` 生成标准多尺寸 PNG，再经 `iconutil` 转换

`scripts/build-desktop.mjs` 已将 `icon.icns` 配置为应用包图标。正式包保留系统对应用图标的处理；本次移除运行时 PNG 覆盖后的外观仍需安装验收

接入参考 FoxMeter 的 PNG/ICNS 资源组织；Electron Dock 使用官方 [dock.setIcon](https://www.electronjs.org/docs/latest/api/dock#dockseticonimage) API，不修改 `node_modules` 中的 Electron 应用
