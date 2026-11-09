// Electron 会在错误前加调用信息，界面只显示主进程给的原因
export const ipcFailure = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      )
    : '搜索失败，请重试'
