/**
 * Chapter catalog — port of Android `ChapterCatalog.kt`.
 * Only unique chapter titles/volumes are reconciled; list positions never prove identity.
 */

import type { FileSystemApi } from '@platform/interfaces'
import type { ComicChapter } from './comicSourceTypes'

const MAX_CATALOG_BYTES = 4 * 1024 * 1024
const MAX_CATALOG_ENTRIES = 10_000

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  let out = ''
  const bytes = new Uint8Array(digest)
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0')
  }
  return out
}

export class ChapterCatalog {
  constructor(
    private readonly fs: FileSystemApi,
    private readonly rootDir = 'chapter_catalogs',
  ) {}

  private async file(source: string, comic: string): Promise<string> {
    const key = `${source.length}:${source}${comic}`
    const hash = await sha256Hex(key)
    return `${this.rootDir}/${hash}.json`
  }

  async read(source: string, comic: string): Promise<ComicChapter[]> {
    try {
      const path = await this.file(source, comic)
      if (!(await this.fs.exists(path))) return []
      const bytes = await this.fs.readFile(path)
      if (bytes.length > MAX_CATALOG_BYTES) return []
      const text = new TextDecoder('utf-8').decode(bytes)
      const arr = JSON.parse(text) as unknown
      if (!Array.isArray(arr) || arr.length > MAX_CATALOG_ENTRIES) return []
      return arr.map((o) => {
        const rec = o as Record<string, unknown>
        return {
          id: String(rec.id ?? ''),
          title: String(rec.title ?? ''),
          volume:
            typeof rec.volume === 'string' && rec.volume.trim() !== '' ? rec.volume : null,
          order: typeof rec.order === 'number' && Number.isFinite(rec.order) ? rec.order : 0,
          external: false,
          externalUrl: null,
        }
      })
    } catch {
      return []
    }
  }

  async write(source: string, comic: string, chapters: ComicChapter[]): Promise<void> {
    if (chapters.length > MAX_CATALOG_ENTRIES) throw new Error('too many chapters')
    const a = chapters.map((c) => ({
      id: c.id,
      title: c.title,
      volume: c.volume ?? '',
      order: c.order,
    }))
    const raw = new TextEncoder().encode(JSON.stringify(a))
    if (raw.length > MAX_CATALOG_BYTES) throw new Error('catalog too large')
    const path = await this.file(source, comic)
    // AtomicFile equivalent: write then replace via fs.writeFile (platform fs is atomic enough for web/iOS).
    await this.fs.writeFile(path, raw)
  }

  mapping(old: ComicChapter[], fresh: ComicChapter[]): Map<string, ComicChapter> {
    const key = (c: ComicChapter): string =>
      `${(c.volume ?? '').trim().toLowerCase()}|${c.title.trim().toLowerCase().replace(/\s+/g, '')}`
    const groupedOld = new Map<string, ComicChapter[]>()
    for (const c of old) {
      const k = key(c)
      const list = groupedOld.get(k)
      if (list) list.push(c)
      else groupedOld.set(k, [c])
    }
    const groupedNew = new Map<string, ComicChapter[]>()
    for (const c of fresh) {
      const k = key(c)
      const list = groupedNew.get(k)
      if (list) list.push(c)
      else groupedNew.set(k, [c])
    }
    const byId = new Map(fresh.map((c) => [c.id, c]))
    const result = new Map<string, ComicChapter>()
    for (const chapter of old) {
      const exact = byId.get(chapter.id)
      const exactOk = exact != null && key(exact) === key(chapter) ? exact : undefined
      const semanticGroup = groupedNew.get(key(chapter))
      const semantic =
        semanticGroup?.length === 1 && groupedOld.get(key(chapter))?.length === 1
          ? semanticGroup[0]
          : undefined
      const to = exactOk ?? semantic
      if (to != null) result.set(chapter.id, to)
    }
    return result
  }
}
