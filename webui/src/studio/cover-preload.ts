const ready = new Set<string>()

export const isPreloaded = (src: string) => ready.has(src)

function load(src: string) {
  return new Promise<void>((resolve) => {
    const image = new Image()
    image.referrerPolicy = 'no-referrer'
    image.onload = () => {
      ready.add(src)
      resolve()
    }
    image.onerror = () => resolve()
    image.src = src
  })
}

// 静默换内容前先把封面下好，超时也继续，慢的那几张按普通方式淡入
export async function preloadCovers(urls: string[], timeoutMs: number) {
  ready.clear()
  await Promise.race([
    Promise.all(urls.map(load)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}
