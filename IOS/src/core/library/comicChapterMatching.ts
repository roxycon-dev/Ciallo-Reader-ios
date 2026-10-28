/**
 * Comic chapter matching — port of Android `ComicChapterMatching.kt`.
 * Cross-source identity uses unique titles or explicit episode numbers,
 * never list positions or IDs.
 */

import { compact } from '@core/data/titleNormalizer'
import type { ComicChapter } from './comicSourceTypes'

function normalizeNFKC(s: string): string {
  return s.normalize('NFKC')
}

function volumeOf(c: ComicChapter): string {
  const inlineMatch = /第\s*(\d+)\s*[卷巻]|vol(?:ume)?\.?\s*(\d+)/i.exec(c.title)
  const inlineDigits = inlineMatch?.slice(1).find((g) => g != null && g !== '') ?? ''
  const rawTrimmed = c.volume?.trim() ?? ''
  const raw = rawTrimmed !== '' ? rawTrimmed : inlineDigits
  const normalized = normalizeNFKC(raw)
  const digitsMatch = /^(?:第\s*)?(\d+)(?:\s*[卷巻])?$|^vol(?:ume)?\.?\s*(\d+)$/i.exec(normalized)
  const digitStr = digitsMatch?.slice(1).find((g) => g != null && g !== '') ?? ''
  const n = digitStr !== '' ? Number.parseInt(digitStr, 10) : Number.NaN
  return Number.isFinite(n) ? String(n) : compact(raw)
}

function compatibleVolumes(a: ComicChapter, b: ComicChapter): boolean {
  const va = volumeOf(a)
  const vb = volumeOf(b)
  return va.trim() === '' || vb.trim() === '' || va === vb
}

/** Chinese numeral → int for episode numbers. */
function chineseNumber(raw: string): number | null {
  const digits = new Map<string, number>([
    ['零', 0],
    ['〇', 0],
    ['一', 1],
    ['二', 2],
    ['两', 2],
    ['兩', 2],
    ['三', 3],
    ['四', 4],
    ['五', 5],
    ['六', 6],
    ['七', 7],
    ['八', 8],
    ['九', 9],
  ])
  const chars = [...raw]
  if (chars.every((ch) => digits.has(ch))) {
    const joined = chars.map((ch) => String(digits.get(ch))).join('')
    return Number.isFinite(Number.parseInt(joined, 10)) ? Number.parseInt(joined, 10) : null
  }
  let total = 0
  let current = 0
  for (const ch of chars) {
    const digit = digits.get(ch)
    if (digit != null) {
      current = digit
    } else {
      const unit = ch === '十' ? 10 : ch === '百' ? 100 : ch === '千' ? 1000 : null
      if (unit == null) return null
      total += (current === 0 ? 1 : current) * unit
      current = 0
    }
  }
  return total + current
}

function number(raw: string): string | null {
  let title = normalizeNFKC(raw).trim()
  title = title.replace(
    /第\s*([零〇一二两兩三四五六七八九十百千]+)\s*([话話回章])/g,
    (_m, cn: string, unit: string) => {
      const n = chineseNumber(cn)
      return n != null ? `第${n}${unit}` : _m
    },
  )
  if (
    /番外|特別|特别|extra|special|omake|附录|附錄|上篇|下篇|前篇|后篇|後篇|上半|下半|part|[（(]\s*[上下前后後]\s*[）)]/i.test(
      title,
    )
  ) {
    return null
  }
  const explicit =
    /第\s*(\d+(?:\.\d+)?)\s*[话話回章]|(?<![\p{L}\p{N}])(?:chapter\s*|ch\.?\s*|episode\s*|ep\.?\s*)(\d+(?:\.\d+)?)/iu.exec(
      title,
    )
  const bare = /^(\d+(?:\.\d+)?)(?:$|\s|[话話回章:：])/.exec(title)
  const value =
    explicit?.slice(1).find((g) => g != null && g !== '') ?? bare?.[1] ?? null
  if (value == null) return null
  if (value.length > 16) return null
  // toBigDecimalOrNull().stripTrailingZeros().toPlainString()
  let stripped = value
  if (stripped.includes('.')) {
    stripped = stripped.replace(/0+$/, '').replace(/\.$/, '')
  }
  return stripped
}

function groupBy<T, K>(items: T[], key: (t: T) => K | null): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    if (k == null) continue
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

export function mapping(old: ComicChapter[], fresh: ComicChapter[]): Map<string, ComicChapter> {
  const result = new Map<string, ComicChapter>()
  const used = new Set<string>()

  const pair = (key: (c: ComicChapter) => string | null): void => {
    const oldGroups = groupBy(old, key)
    const newGroups = groupBy(fresh, key)
    for (const [identity, group] of oldGroups) {
      const newGroup = newGroups.get(identity)
      const to = newGroup?.length === 1 ? newGroup[0] : undefined
      const from = group.length === 1 ? group[0] : undefined
      if (
        from != null &&
        to != null &&
        !result.has(from.id) &&
        !used.has(to.id) &&
        compatibleVolumes(from, to)
      ) {
        result.set(from.id, to)
        used.add(to.id)
      }
    }
  }

  pair((c) => {
    const key = compact(c.title)
    return key.trim() !== '' ? `${volumeOf(c)}|${key}` : null
  })
  pair((c) => {
    const n = number(c.title)
    return n != null ? `${volumeOf(c)}|${n}` : null
  })
  // Some sources omit volume names. Only globally unique numbers may bridge that omission.
  pair((c) => number(c.title))
  return result
}
