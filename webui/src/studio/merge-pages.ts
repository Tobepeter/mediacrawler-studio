// 无限列表合并去重；最后一页没有新内容时 stalled，上层据此停止继续请求
export function mergePages<T extends { id: string }>(
  pages: readonly { items: T[] }[],
) {
  const seen = new Set<string>()
  let added = 0
  const items = pages.flatMap((page) => {
    added = 0
    return page.items.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      added++
      return true
    })
  })
  return { items, stalled: added === 0 }
}
