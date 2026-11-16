/**
 * Comic reading logic — port of Android `ComicReadingLogic.kt`.
 * Pure functions: reading order, continue target, chapter states.
 */

import type { ComicChapter } from './comicSourceTypes'
import type { ComicProgressEntity, ChapterReadStateCode } from './favoriteTypes'
import { ChapterReadState } from './favoriteTypes'

/** 归一化到「阅读顺序」后的章节。 */
export interface OrderedChapter {
  /** 在源返回的原始列表中的下标 */
  rawIndex: number
  /** 在阅读顺序（升序）中的序号：0 起 */
  order: number
  chapter: ComicChapter
  orderKey: number
  /** 从标题里解析出的话数；解析不到则为序号+1 */
  displayNumber: number
}

export function orderKey(chapter: ComicChapter, rawIndex: number, hasSourceOrder = chapter.order !== 0): number {
  return hasSourceOrder && Number.isFinite(chapter.order) ? chapter.order : rawIndex
}

/** 把源返回的任意顺序列表归一化成阅读顺序（升序）。 */
export function ordered(chapters: ComicChapter[]): OrderedChapter[] {
  const hasSourceOrder = chapters.some((c) => Number.isFinite(c.order) && c.order !== 0)
  const decorated = chapters.map((chapter, index) => ({ index, chapter }))
  const sorted = decorated.sort((a, b) => {
    const ka = orderKey(a.chapter, a.index, hasSourceOrder)
    const kb = orderKey(b.chapter, b.index, hasSourceOrder)
    if (ka !== kb) return ka - kb
    return a.index - b.index
  })
  return sorted.map(({ index, chapter }, order) => ({
    rawIndex: index,
    order,
    chapter,
    orderKey: orderKey(chapter, index, hasSourceOrder),
    displayNumber: chapterNumber(chapter.title) ?? order + 1,
  }))
}

/** 目录、前后章、预取和进度写入共用同一套阅读顺序下标。 */
export interface ChapterNavigation {
  chapters: ComicChapter[]
  currentIndex: number
  previous: ComicChapter | null
  next: ComicChapter | null
}

export function navigation(chapters: ComicChapter[], currentChapterId: string | null): ChapterNavigation {
  const sequence = ordered(chapters).map((o) => o.chapter)
  const currentIndex = sequence.findIndex((c) => c.id === currentChapterId)
  return {
    chapters: sequence,
    currentIndex,
    previous: currentIndex > 0 ? (sequence[currentIndex - 1] ?? null) : null,
    next: currentIndex >= 0 ? (sequence[currentIndex + 1] ?? null) : null,
  }
}

/** 从「第 12 话」等标题里取话数。 */
export function chapterNumber(title: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(title)
  if (!m) return null
  const n = Number.parseFloat(m[1] as string)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/** Decimal-safe chapter number for comparison. */
function chapterDecimal(title: string): string | null {
  const m = /(\d+(?:\.\d+)?)/.exec(title)
  if (!m) return null
  const value = m[1] as string
  return value.length <= 64 ? value : null
}

/**
 * AUDIT FIX — Kotlin compares with `java.math.BigDecimal.compareTo`:
 *   `if (newNum != null && oldNum != null && newNum.compareTo(oldNum) == 0) return false`
 * which is **numeric**: "12", "12.0" and "12.00" all compare equal. The first TS pass
 * compared the matched *strings*, so "第12话" vs "第12.0话" was reported as a new episode
 * and the 「最近更新」 badge flapped on every check for sources that normalise numbering.
 * This reproduces `BigDecimal.stripTrailingZeros().toPlainString()` on both sides.
 */
function normalizeDecimal(value: string): string {
  let s = value
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '')
  }
  if (s.length > 1 && s.startsWith('0') && !s.includes('.')) {
    // BigDecimal("000").toPlainString() === "0"
    s = s.replace(/^0+(?=\d)/, '')
  }
  return s
}

/**
 * 更新检测：这次抓到的最新一话，是否真的算「有新话」。
 * 话数归一化：两边都能从标题解析出话数且相等 → 同一话；任一边解析不到 → 退回纯 id 比较。
 */
export function isNewChapterObserved(
  oldLatestId: string | null,
  oldLatestTitle: string | null,
  newLatest: OrderedChapter | null,
): boolean {
  if (newLatest == null) return false
  const oldId = oldLatestId
  if (oldId == null) return true
  if (newLatest.chapter.id === oldId) return false
  const newNum = chapterDecimal(newLatest.chapter.title)
  const oldNum = oldLatestTitle != null ? chapterDecimal(oldLatestTitle) : null
  if (newNum != null && oldNum != null && normalizeDecimal(newNum) === normalizeDecimal(oldNum)) {
    return false
  }
  return true
}

/** 已读判定：最后一页 或 进度 ≥ 90%。 */
export function isFinished(pageIndex: number, pageCount: number): boolean {
  if (pageCount <= 0) return false
  if (pageIndex >= pageCount - 1) return true
  return (pageIndex + 1) / pageCount >= 0.9
}

/** 续读目标。 */
export type ContinueTarget =
  | { kind: 'start' }
  | { kind: 'resume'; chapterIndex: number; pageIndex: number }
  | { kind: 'next'; chapterIndex: number }
  | { kind: 'upToDate' }

export const ContinueTargetStart: ContinueTarget = { kind: 'start' }
export const ContinueTargetUpToDate: ContinueTarget = { kind: 'upToDate' }

export function resolveContinue(
  chapters: ComicChapter[],
  states: Map<string, ChapterReadStateCode>,
  progress: ComicProgressEntity | null,
): ContinueTarget {
  const seq = ordered(chapters)
  if (seq.length === 0) return ContinueTargetStart
  const lastId = progress?.lastChapterId ?? null
  if (lastId == null) return ContinueTargetStart

  const lastOrder = seq.findIndex((o) => o.chapter.id === lastId)
  if (lastOrder < 0) {
    const firstUnread = seq.find((o) => states.get(o.chapter.id) !== ChapterReadState.READ)
    if (firstUnread != null) return { kind: 'next', chapterIndex: firstUnread.order }
    return ContinueTargetUpToDate
  }
  const lastState = states.get(lastId) ?? ChapterReadState.UNREAD
  const finishedByPage = progress != null && isFinished(progress.lastPageIndex, progress.lastPageCount)
  if (lastState === ChapterReadState.READ || finishedByPage) {
    const next = seq[lastOrder + 1]
    if (next != null) return { kind: 'next', chapterIndex: next.order }
    return ContinueTargetUpToDate
  }
  return {
    kind: 'resume',
    chapterIndex: lastOrder,
    pageIndex: Math.max(0, progress?.lastPageIndex ?? 0),
  }
}

/** 「继续阅读」按钮文案（带上下文）。 */
export function continueLabel(target: ContinueTarget, chapters: ComicChapter[]): string {
  const seq = ordered(chapters)
  const number = (index: number): number => seq[index]?.displayNumber ?? index + 1
  switch (target.kind) {
    case 'start':
      return '开始阅读'
    case 'resume': {
      const page = Math.max(1, target.pageIndex + 1)
      return `继续阅读 · 第${number(target.chapterIndex)}话 · 第${page}页`
    }
    case 'next':
      return `继续阅读 · 第${number(target.chapterIndex)}话`
    case 'upToDate':
      return '已读到最新'
    default:
      return ''
  }
}

/**
 * 上次进入章节列表后新增的章节 id（用于「新」小红点）。
 */
export function newChapterIds(
  chapters: ComicChapter[],
  progress: ComicProgressEntity | null,
): Set<string> {
  if (progress == null) return new Set()
  const seq = ordered(chapters)
  const topId = progress.seenTopChapterId
  if (topId != null) {
    const idx = seq.findIndex((o) => o.chapter.id === topId)
    if (idx >= 0) {
      return new Set(seq.slice(idx + 1).map((o) => o.chapter.id))
    }
  }
  const delta = seq.length - progress.seenChapterCount
  if (delta > 0) {
    return new Set(seq.slice(Math.max(0, seq.length - delta)).map((o) => o.chapter.id))
  }
  return new Set()
}

/** 已读章节占比（卡片底部细进度条）。 */
export function readRatio(chapters: ComicChapter[], states: Map<string, ChapterReadStateCode>): number {
  if (chapters.length === 0) return 0
  const read = chapters.filter((c) => states.get(c.id) === ChapterReadState.READ).length
  return read / chapters.length
}

/** 未读话数。 */
export function unreadCount(chapters: ComicChapter[], states: Map<string, ChapterReadStateCode>): number {
  return chapters.filter((c) => states.get(c.id) !== ChapterReadState.READ).length
}
