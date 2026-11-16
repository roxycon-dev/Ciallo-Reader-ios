/**
 * Chapter merger — port of Android `ChapterMerger.kt`.
 *
 * Merges DB chapters that were split into "title (续N)" physical parts.
 * Reader sees one merged chapter; the database is left untouched.
 */

import { tr } from '@core/i18n';

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

/* ═══════════════════════════════════════════════════════════════════════
 * data/ReaderChapterWindow.kt — 三章滑动窗口（42 行）
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Kotlin `data class ReaderChapterWindow(val chapters: List<Chapter>, val loaded: Set<Int>)`。
 *
 * `loaded` 是**逻辑**章节下标集合：`loadReaderChapterWindow` 只把这个集合里的条目算作
 * "内容已在内存里"，下一次调用用它决定复用哪些、要拉哪些。
 */
export interface ReaderChapterWindow {
  chapters: Chapter[];
  loaded: Set<number>;
}

/** Kotlin `readParts: suspend (List<Int>) -> List<Chapter>` — 按物理 order 批量取正文。 */
export type ChapterPartReader = (orders: number[]) => Promise<Chapter[]>;

/**
 * Kotlin `loadReaderChapterWindow`（L12-41）：读当前章的 ±1 三章窗口，只拉**新进入**的章。
 *
 * 逐行对照：
 *   L20  `check(currentIndex in metadata.indices) { tr("没有可读取的章节") }`
 *   L21  `targets = ((currentIndex-1)..(currentIndex+1)).filter { it in metadata.indices }`
 *   L22  `reusable = targets.filter { it in loaded && it in previous.indices }`
 *   L23  `missing = targets.filterNot { it in reusable }`
 *   L24  `orders = missing.flatMap { logicalToPhysicalOrders[it] }.distinct()`
 *   L25  `parts = if (orders.isEmpty()) emptyMap() else readParts(orders).associateBy { it.chapterOrder }`
 *   L26  `complete = reusable + missing.filter { index -> logicalToPhysicalOrders[index].all { it in parts } }`
 *   L27  `check(currentIndex in complete) { tr("当前章节数据缺失，请重试加载") }`
 *   L28-39 逐章写回：可复用的直接搬 `previous[index]`，其余按物理 order 拼接 content
 *
 * 差异（已在 docs/PARITY_EXCEPTIONS.md E110 登记）：Kotlin `withContext(Dispatchers.Default)`
 * 与 `ensureActive()` 没有协程上下文可挂，改为调用方传入 `AbortSignal`，
 * 循环里用 `signal.throwIfAborted()`（语义 = `ensureActive()` 抛 `CancellationException`）。
 */
export async function loadReaderChapterWindow(
  mapping: LogicalChapterBook,
  currentIndex: number,
  previous: readonly Chapter[],
  loaded: ReadonlySet<number>,
  readParts: ChapterPartReader,
  signal?: AbortSignal,
): Promise<ReaderChapterWindow> {
  const metadata = mapping.chapters;
  if (!(currentIndex >= 0 && currentIndex < metadata.length)) {
    throw new Error(tr('没有可读取的章节'));
  }

  const targets: number[] = [];
  for (let index = currentIndex - 1; index <= currentIndex + 1; index += 1) {
    if (index >= 0 && index < metadata.length) targets.push(index);
  }

  const reusable = new Set<number>(
    targets.filter((index) => loaded.has(index) && index < previous.length),
  );
  const missing = targets.filter((index) => !reusable.has(index));

  const orders: number[] = [];
  for (const index of missing) {
    for (const order of mapping.logicalToPhysicalOrders[index] ?? []) {
      if (!orders.includes(order)) orders.push(order);
    }
  }

  const parts = new Map<number, Chapter>();
  if (orders.length > 0) {
    for (const part of await readParts(orders)) parts.set(part.chapterOrder, part);
  }

  // Kotlin `reusable + missing.filter{…}` 是 LinkedHashSet：先复用项，再补全项，保持插入序。
  const completeOrder: number[] = [...reusable];
  for (const index of missing) {
    const physicalOrders = mapping.logicalToPhysicalOrders[index] ?? [];
    if (physicalOrders.every((order) => parts.has(order))) completeOrder.push(index);
  }
  const complete = new Set<number>(completeOrder);
  if (!complete.has(currentIndex)) {
    throw new Error(tr('当前章节数据缺失，请重试加载'));
  }

  const chapters: Chapter[] = [...metadata];
  for (const index of targets) {
    signal?.throwIfAborted();
    if (reusable.has(index)) {
      const carried = previous[index];
      if (carried !== undefined) chapters[index] = carried;
      continue;
    }
    const content: string[] = [];
    for (const order of mapping.logicalToPhysicalOrders[index] ?? []) {
      const part = parts.get(order);
      if (part !== undefined) content.push(part.content);
    }
    const base = metadata[index];
    if (content.length > 0 && base !== undefined) {
      chapters[index] = { ...base, content: content.join('') };
    }
  }

  return { chapters, loaded: complete };
}
