import path from 'node:path'

// 开发版用项目里的 .venv，打包版和测试用 STUDIO_PYTHON 指定
export function pythonPath(root) {
  return (
    process.env.STUDIO_PYTHON ||
    path.join(
      root,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    )
  )
}

// 所有 Python worker 同样启动：实时输出，统一 UTF-8，Windows 中文区域下标题带 emoji 也不出错
export function spawnWorker(spawnProcess, python, root, module) {
  return spawnProcess(python, ['-u', '-m', module], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  })
}
