// 预计耗时 = 固定开销 + 视频时长 × 速度；默认速度来自实测，之后按最近几次真实耗时校准
// 2026-11-10 实测：转写约 21 毫秒每秒视频，加下载后三条长视频 32～70 毫秒，默认取偏高一点
const key = 'studio-transcribe-rates-v1'
const defaultRate = 60
const overheadMs = 3000
const coldStartMs = 12000
const keep = 5
// 太短的视频几乎全是固定开销，算出来的速度不准
const minSeconds = 30

function read(): number[] {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(stored)
      ? stored
          .filter((rate) => Number.isFinite(rate) && rate > 0 && rate <= 1000)
          .slice(-keep)
      : []
  } catch {
    return []
  }
}

const startup = (cold: boolean) => overheadMs + (cold ? coldStartMs : 0)

export function transcribeEstimate(duration?: number | null, cold = false) {
  if (!duration || duration <= 0) return undefined
  const rates = read()
  const rate = rates.length
    ? rates.reduce((sum, value) => sum + value, 0) / rates.length
    : defaultRate
  return startup(cold) + duration * rate
}

export function recordTranscribe(
  duration: number | null | undefined,
  milliseconds: number,
  cold: boolean,
) {
  if (!duration || duration < minSeconds) return
  const rate = (milliseconds - startup(cold)) / duration
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) return
  try {
    localStorage.setItem(key, JSON.stringify([...read(), rate].slice(-keep)))
  } catch {
    /* 统计不可写不影响提取 */
  }
}
