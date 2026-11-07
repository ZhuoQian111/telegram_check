import { DateTime } from 'luxon'
export function nextRun(time: string, timezone: string, after = new Date()): string {
  const [hour, minute] = time.split(':').map(Number)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !DateTime.now().setZone(timezone).isValid) throw new Error('无效的时间或时区')
  let day = DateTime.fromJSDate(after, { zone: timezone }).startOf('day')
  for (let i = 0; i < 370; i++, day = day.plus({ days: 1 })) {
    const candidate = day.set({ hour, minute, second: 0, millisecond: 0 })
    if (candidate.hour !== hour || candidate.minute !== minute) continue
    // During a fall-back, always select the first occurrence of the wall-clock time.
    const first = candidate.getPossibleOffsets().sort((a,b) => a.toMillis() - b.toMillis())[0]!
    if (first.toMillis() > after.getTime()) return first.toUTC().toISO()!
  }
  throw new Error('无法计算下次发送时间')
}
export const isOnTime = (scheduled: string, now: Date) => now.getTime() >= Date.parse(scheduled) && now.getTime() - Date.parse(scheduled) < 60_000
