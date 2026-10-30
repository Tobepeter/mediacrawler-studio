import { homedir } from 'node:os'

const sensitive =
  /cookie|authorization|password|passwd|secret|token|session|credential|signature|a_bogus|msToken|^headers$|^body$|^response$|^query$|^text$|^nickname$|^avatar$|^email$|^phone$/i
const secretPair =
  /((?<![\w-])["']?(?:[\w-]{0,64}(?:cookie|token|password|passwd|secret|authorization|session|signature|credential)[\w-]{0,64}|a_bogus|query|body|response)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi

function cleanText(value) {
  return value
    .slice(0, 65536)
    .replace(
      /\b(?:set-cookie|cookie|authorization|proxy-authorization)\s*:[^\r\n]+/gi,
      '[redacted header]',
    )
    .replace(/\b(?:Bearer|Basic)\s+[\w+/=._-]+/gi, '[redacted authorization]')
    .replace(secretPair, '$1[redacted]')
    .replace(/https?:\/\/[^\s<>"')]+/gi, (raw) => {
      try {
        const url = new URL(raw)
        return `${url.origin}${url.pathname}${url.search ? '?[redacted]' : ''}`
      } catch {
        return '[redacted URL]'
      }
    })
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[redacted token]')
    .replace(
      /(?<![\w.+-])[\w.+-]{1,64}@[\w.-]{1,253}\.[a-z]{2,24}/gi,
      '[redacted email]',
    )
    .replace(/\b1[3-9]\d{9}\b/g, '[redacted phone]')
    .replaceAll(homedir(), '~')
    .slice(0, 8000)
}

// 所有日志入口统一脱敏；不序列化任意对象的 toJSON
export function redact(value, seen = new WeakSet(), depth = 0) {
  if (depth > 6) return '[truncated]'
  if (typeof value === 'string') return cleanText(value)
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return value
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (value instanceof Error)
    return redact(
      {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause: value.cause,
      },
      seen,
      depth + 1,
    )
  if (Array.isArray(value))
    return value.slice(0, 30).map((item) => redact(item, seen, depth + 1))
  const result = {}
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  ).slice(0, 40)) {
    Object.defineProperty(result, cleanText(key), {
      enumerable: true,
      value: sensitive.test(key)
        ? '[redacted]'
        : 'value' in descriptor
          ? redact(descriptor.value, seen, depth + 1)
          : '[accessor]',
    })
  }
  return result
}
