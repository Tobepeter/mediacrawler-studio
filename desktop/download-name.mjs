// 话题标签只是推广，文件名里不要；其余去掉文件系统不允许的字符和首尾标点
function clean(value, limit) {
  return String(value || '')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.，,。、]+|[\s.，,。、]+$/g, '')
    .slice(0, limit)
    .trim()
}

// 视频、封面和字幕共用一个名字：作者 - 标题，放在一起时播放器能自动匹配字幕
export function downloadName(item) {
  const author = clean(item?.author, 24)
  const title = clean(item?.title, 60) || clean(item?.text, 60)
  const name = [author, title].filter(Boolean).join(' - ')
  return name || String(item?.id || '未命名').replace(/[^\w-]/g, '_')
}
