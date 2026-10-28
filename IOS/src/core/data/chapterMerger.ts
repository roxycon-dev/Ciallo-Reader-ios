/**
 * Chapter merger — port of Android `ChapterMerger.kt`.
 *
 * Merges DB chapters that were split into "title (续N)" physical parts.
 * Reader sees one merged chapter; the database is left untouched.
 */

export interface Chapter {
  id: number;
  bookId: number;
  chapterOrder: number;
  title: string;
  content: string;
  startCharIndex: number;
  endCharIndex: number;
}

export interface LogicalChapterBook {
  chapters: Chapter[];
  physicalToLogical: number[];
  physicalToLogicalOffset: number[];
  logicalToPhysicalOrders: number[][];
  logicalIndexOf(physicalOrder: number): number;
  logicalOffsetOf(physicalOrder: number, physicalOffset: number): number;
  physicalIndexFor(logicalIndex: number): number;
}

export const CONTINUATION_TITLE = /^(.+?)\s*\((?:续|续[0-9]+)\)\s*$/;
export const MAX_CONTINUATION_PARTS = 4;

export function cleanSplitTitle(title: string): string {
  const m = CONTINUATION_TITLE.exec(title.trim());
  return m?.[1] ?? title;
}

/** Kotlin `physical.maxOfOrNull { it.chapterOrder } ?: -1` — 含负 order。 */
export function maxChapterOrder(physical: readonly Chapter[]): number {
  let max = -1;
  for (const ch of physical) {
    if (ch.chapterOrder > max) max = ch.chapterOrder;
  }
  return max;
}

export function buildLogicalChapters(physical: Chapter[]): LogicalChapterBook {
  const byOrder = new Map<number, Chapter>();
  for (const ch of physical) {
    byOrder.set(ch.chapterOrder, ch);
  }
  const maxOrder = maxChapterOrder(physical);

  const physToLog: number[] = [];
  const physOffset: number[] = [];
  for (let i = 0; i <= maxOrder; i += 1) {
    physToLog.push(i);
    physOffset.push(0);
  }

  const logToPhys: number[][] = [];
  const logical: Chapter[] = [];

  let parts: number[] = [];
  let baseTitle: string | null = null;
  let buffer = '';

  const flush = (): void => {
    if (parts.length === 0) return;
    const firstOrder = parts[0] as number;
    const lastOrder = parts[parts.length - 1] as number;
    const first = byOrder.get(firstOrder);
    const last = byOrder.get(lastOrder);
    if (!first || !last) {
      parts = [];
      buffer = '';
      baseTitle = null;
      return;
    }
    logical.push({
      id: first.id,
      bookId: first.bookId,
      chapterOrder: logical.length,
      title: baseTitle ?? first.title,
      content: buffer,
      startCharIndex: first.startCharIndex,
      endCharIndex: last.endCharIndex,
    });
    logToPhys.push([...parts]);
    parts = [];
    buffer = '';
    baseTitle = null;
  };

  for (const ch of physical) {
    const order = ch.chapterOrder;
    const m = CONTINUATION_TITLE.exec(ch.title.trim());
    const isContinuation =
      m !== null &&
      baseTitle === m[1] &&
      parts.length > 0 &&
      parts.length < MAX_CONTINUATION_PARTS;
    if (isContinuation) {
      if (order >= 0 && order <= maxOrder) {
        physOffset[order] = buffer.length;
      }
      buffer += ch.content;
      parts.push(order);
      if (order >= 0 && order <= maxOrder) {
        physToLog[order] = logical.length;
      }
    } else {
      flush();
      baseTitle = cleanSplitTitle(ch.title.trim());
      buffer += ch.content;
      parts.push(order);
      if (order >= 0 && order <= maxOrder) {
        physOffset[order] = 0;
        physToLog[order] = logical.length;
      }
    }
  }
  flush();

  return {
    chapters: logical,
    physicalToLogical: physToLog,
    physicalToLogicalOffset: physOffset,
    logicalToPhysicalOrders: logToPhys,
    logicalIndexOf(physicalOrder: number): number {
      if (physicalOrder >= 0 && physicalOrder < physToLog.length) {
        return physToLog[physicalOrder] as number;
      }
      return physicalOrder;
    },
    logicalOffsetOf(physicalOrder: number, physicalOffset: number): number {
      if (physicalOrder >= 0 && physicalOrder < physOffset.length) {
        return (physOffset[physicalOrder] as number) + physicalOffset;
      }
      return physicalOffset;
    },
    physicalIndexFor(logicalIndex: number): number {
      if (logicalIndex >= 0 && logicalIndex < logToPhys.length) {
        const orders = logToPhys[logicalIndex];
        if (orders && orders.length > 0) {
          return orders[0] as number;
        }
        return logicalIndex;
      }
      return logicalIndex;
    },
  };
}
