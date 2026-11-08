const hops = 3

function douyinCreator(target) {
  if (!/(^|\.)(iesdouyin|douyin)\.com$/.test(target.hostname)) return null
  const match = target.pathname.match(/^(?:\/share)?\/user\/([^/?#]+)\/?$/)
  return match && match[1] !== 'self'
    ? `https://www.douyin.com/user/${match[1]}`
    : null
}

// 小红书主页必须保留 xsec_token，否则接口拿不到笔记
function xhsCreator(target) {
  if (!/(^|\.)xiaohongshu\.com$/.test(target.hostname)) return null
  return /^\/user\/profile\/[^/]+\/?$/.test(target.pathname)
    ? `https://www.xiaohongshu.com${target.pathname}${target.search}`
    : null
}

const resolvers = {
  'v.douyin.com': douyinCreator,
  'xhslink.com': xhsCreator,
  'www.xhslink.com': xhsCreator,
}

// 只跟随分享短链自身的跳转，不走登录态，不请求最终页面
export async function resolveCreatorLink(value, fetcher = fetch) {
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const resolve = Object.hasOwn(resolvers, url.hostname)
    ? resolvers[url.hostname]
    : null
  if (url.protocol !== 'https:' || !resolve) return null
  try {
    for (let hop = 0; hop < hops; hop++) {
      const response = await fetcher(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      })
      const target = new URL(response.headers.get('location') || '', url)
      const creator = resolve(target)
      if (creator) return creator
      // 只有短链域名内部的跳转才继续，别的目标就是作品页或其他内容
      if (target.hostname !== url.hostname || !response.headers.get('location'))
        return null
      url = target
    }
  } catch {
    return null
  }
  return null
}
