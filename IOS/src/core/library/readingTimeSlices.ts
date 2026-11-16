/**
 * Reading time slices — port of Android `ReadingTimeSlices.kt`.
 * Pure TS; splits a cross-midnight session into per-day slices.
 */

export interface ReadingTimeSlice {
  date: string
  start: number
  end: number
  seconds: number
  hour: number
}

const MS_PER_DAY = 7 * 24 * 60 * 60 * 1000

/** Local date string yyyy-MM-dd for a timestamp (UTC-based day boundary as UTC clock day). */
function localDateStr(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function hourOfDay(ms: number): number {
  return new Date(ms).getHours()
}

/** Next local midnight after ms (start of next calendar day in local time). */
function nextLocalMidnight(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

export function splitReadingTimeSlices(start: number, end: number, seconds: number): ReadingTimeSlice[] {
  if (end <= start || seconds <= 0) return []
  if (end - start > MS_PER_DAY) throw new Error('阅读会话时间范围异常')
  const result: ReadingTimeSlice[] = []
  let cursor = start
  let allocated = 0
  while (cursor < end) {
    const date = localDateStr(cursor)
    const hour = hourOfDay(cursor)
    const stop = Math.min(end, nextLocalMidnight(cursor))
    const through = stop === end ? seconds : Math.floor((seconds * (stop - start)) / (end - start))
    result.push({ date, start: cursor, end: stop, seconds: through - allocated, hour })
    allocated = through
    cursor = stop
  }
  return result
}
