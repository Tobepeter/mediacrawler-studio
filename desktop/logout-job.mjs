import { createInterface } from 'node:readline'
import path from 'node:path'

export async function logoutPlatform({
  platform,
  root,
  endpoint,
  windows,
  spawnProcess,
}) {
  const controller = new AbortController()
  let child
  let deadline
  let force
  let result
  const fallback = {
    platform,
    remote: 'not_confirmed',
    reason: 'worker_failed',
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      clearTimeout(force)
      controller.abort()
      resolve(value)
    }
    deadline = setTimeout(() => {
      controller.abort()
      result = { ...fallback, reason: 'timeout' }
      if (!child) return finish(result)
      child.kill('SIGTERM')
      force = setTimeout(() => {
        child.kill('SIGKILL')
        finish(result)
      }, 2500)
    }, 55000)
    void (async () => {
      try {
        const targetId = await windows.prepare(platform, controller.signal)
        if (controller.signal.aborted) return
        const python =
          process.env.STUDIO_PYTHON ||
          path.join(
            root,
            '.venv',
            process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
          )
        child = spawnProcess(python, ['-u', '-m', 'desktop.worker'], {
          cwd: root,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
          },
        })
        child.stderr.resume()
        child.stdin.on('error', () => {})
        const lines = createInterface({ input: child.stdout })
        lines.on('line', (line) => {
          try {
            const event = JSON.parse(line)
            if (
              event.type === 'logout-result' &&
              event.result?.platform === platform &&
              ['confirmed', 'already_signed_out', 'not_confirmed'].includes(
                event.result.remote,
              )
            )
              result = event.result
          } catch {
            /* 非协议日志不进入界面 */
          }
        })
        child.once('error', () => finish(fallback))
        child.once('close', (code) => {
          lines.close()
          finish(code === 0 && result ? result : fallback)
        })
        child.stdin.end(
          JSON.stringify({
            action: 'logout',
            platform,
            mode: 'search',
            query: '',
            limit: 1,
            endpoint,
            targetId,
          }) + '\n',
        )
      } catch {
        finish(fallback)
      }
    })()
  })
}
