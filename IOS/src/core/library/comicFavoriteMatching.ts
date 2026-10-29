/**
 * Comic favorite matching — port of Android `ComicFavoriteMatching.kt`.
 */

import { compact } from '@core/data/titleNormalizer'
import { isKnownComicAuthor, type ComicChapter } from './comicSourceTypes'
import type { DuplicateComicCandidate, FavoriteEntity } from './favoriteTypes'

export function candidates(
  book: { sourceId: string; title: string; author: string; comicInfo?: { alternateTitles: string[] } | null },
  favorites: FavoriteEntity[],
  aliases: string[],
): DuplicateComicCandidate[] {
  const titles = new Set(
    [book.title, ...(book.comicInfo?.alternateTitles ?? []), ...aliases]
      .map(compact)
      .filter(usableTitle),
  )
  const author = isKnownComicAuthor(book.author) ? compact(book.author) : null
  const out: DuplicateComicCandidate[] = []
  for (const favorite of favorites) {
    if (favorite.sourceId === book.sourceId) continue
    const title = compact(favorite.title)
    if (!usableTitle(title)) continue
    const sameAuthor =
      author != null && isKnownComicAuthor(favorite.author) && compact(favorite.author) === author
    let maxSim = 0
    for (const t of titles) {
      const sim = dice(t, title)
      if (sim > maxSim) maxSim = sim
    }
    if (titles.has(title)) {
      out.push({ favorite, reason: '书名或已知别名相同', score: 1.0 })
    } else if (title.length >= 4 && maxSim >= 0.82) {
      out.push({
        favorite,
        reason: sameAuthor ? '书名相似，作者相同' : '书名相似，请核对作品',
        score: maxSim,
      })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

function usableTitle(title: string): boolean {
  return (
    title.trim() !== '' &&
    !['未知书名', '未知', 'unknown', 'untitled'].includes(title)
  )
}

/** Dice coefficient on character bigrams. */
function dice(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.length < 4 || b.length < 4) return 0.0
  const left = bigramCounts(a)
  const right = bigramCounts(b)
  let common = 0
  for (const [pair, count] of left) {
    common += Math.min(count, right.get(pair) ?? 0)
  }
  return (2.0 * common) / (a.length + b.length - 2)
}

function bigramCounts(s: string): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i + 1 < s.length; i += 1) {
    const pair = s.slice(i, i + 2)
    map.set(pair, (map.get(pair) ?? 0) + 1)
  }
  return map
}

export type { ComicChapter, DuplicateComicCandidate }
