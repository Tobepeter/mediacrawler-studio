// 只解析抖音分享短链的一跳跳转，不走登录态，不访问跳转目标
export async function resolveCreatorLink(value, fetcher = fetch) {
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'v.douyin.com') return null
  try {
    const response = await fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    })
    const target = new URL(response.headers.get('location') || '', url)
    if (!/(^|\.)(iesdouyin|douyin)\.com$/.test(target.hostname)) return null
    const match = target.pathname.match(/^(?:\/share)?\/user\/([^/?#]+)\/?$/)
    return match && match[1] !== 'self'
      ? `https://www.douyin.com/user/${match[1]}`
      : null
  } catch {
    return null
  }
}
