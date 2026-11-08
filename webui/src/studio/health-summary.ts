import type { HealthReport } from './types'

const reasons: Record<string, string> = {
  NETWORK_OFFLINE: '网络未连接',
  DNS_FAILED: '地址解析失败',
  CONNECTION_FAILED: '连接失败',
  TLS_FAILED: '安全连接失败',
  HTTP_ERROR: '访问异常',
  ACCESS_RESTRICTED: '访问受限',
  VERIFICATION_REQUIRED: '需要验证',
  LOGIN_ENTRY_NOT_FOUND: '登录入口异常',
  QR_NOT_FOUND: '未获取到二维码',
  QR_IMAGE_FAILED: '二维码读取失败',
  TIMEOUT: '连接超时',
}

export function healthReason(error?: { code: string; stage?: string }) {
  if (
    error?.code === 'TIMEOUT' &&
    ['qr', 'qr_image', 'login'].includes(error.stage || '')
  )
    return '获取二维码超时'
  return reasons[error?.code || '']
}

// 按相同原因合并平台，只给一条检查结果
export function healthSummary(report: HealthReport) {
  if (
    report.network?.error?.code === 'NETWORK_OFFLINE' &&
    !report.platforms.some((item) => item.status === 'ok')
  )
    return { kind: 'warning' as const, message: '网络未连接', groups: [] }
  if (report.failure)
    return {
      kind: 'warning' as const,
      message:
        report.failure.code === 'TIMEOUT'
          ? '检查连接超时，请重试'
          : '检查未完成，请重试',
      groups: [],
    }
  const groups = new Map<string, string[]>()
  for (const item of report.platforms) {
    if (item.status === 'ok') continue
    const reason = healthReason(item.error) || '检查未完成'
    const platforms = groups.get(reason) || []
    platforms.push(item.platform)
    groups.set(reason, platforms)
  }
  if (!report.platforms.length)
    return {
      kind: 'warning' as const,
      message: '检查未完成，请重试',
      groups: [],
    }
  return {
    kind: groups.size ? ('warning' as const) : ('success' as const),
    message: groups.size ? '部分平台连接异常' : '全部平台正常',
    groups: [...groups].map(([reason, platforms]) => ({ reason, platforms })),
  }
}
