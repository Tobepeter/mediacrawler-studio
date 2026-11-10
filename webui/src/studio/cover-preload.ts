const ready = new Set<string>()
const limit = 3000

export const isCoverReady = (src?: string) => !!src && ready.has(src)

export function markCoverReady(src: string) {
  ready.delete(src)
  ready.add(src)
  if (ready.size > limit) ready.delete(ready.values().next().value as string)
}

function load(src: string) {
  return new Promise<void>((resolve) => {
    const image = new Image()
    image.referrerPolicy = 'no-referrer'
    image.onload = () => {
      markCoverReady(src)
      resolve()
    }
    image.onerror = () => resolve()
    image.src = src
  })
}

// 静默换内容前先把封面下好，超时也继续，慢的那几张按普通方式淡入
export async function preloadCovers(urls: string[], timeoutMs: number) {
  await Promise.race([
    Promise.all(urls.map(load)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}
