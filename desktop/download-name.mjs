// 话题标签只是推广，文件名里不要；其余去掉文件系统不允许的字符和首尾标点
function clean(value) {
  return String(value || '')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.，,。、]+|[\s.，,。、]+$/g, '')
    .trim()
}

// 按字符截断，按 UTF-16 截会切开 emoji，Python 写文件时直接报错
const shorten = (value, limit) =>
  Array.from(value).slice(0, limit).join('').trim()

// 视频、封面和字幕共用一个名字：作者 - 标题，放在一起时播放器能自动匹配字幕
export function downloadName(item) {
  const author = shorten(clean(item?.author), 24)
  const title = shorten(clean(item?.title) || clean(item?.text), 60)
  const name = [author, title].filter(Boolean).join(' - ')
  return name || String(item?.id || '未命名').replace(/[^\w-]/g, '_')
}
