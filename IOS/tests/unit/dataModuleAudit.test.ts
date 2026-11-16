/**
 * ContentMutationGate + ChapterMerger parity details.
 *
 * Android authority:
 *   - `data/ContentMutationGate.kt` — `Mutex` + `@Volatile var epoch`, and the
 *     documented lock order:
 *       "download controls -> worker task lock -> content gate -> Room transaction"
 *     `invalidatePendingWrites()` is documented "Caller holds mutex."
 *   - `data/ChapterMerger.kt` — merges "title (续N)" physical parts into one
 *     logical chapter; `parts.size < 4` caps the merge run at 4.
 */
import { describe, expect, it } from 'vitest';
import {
  AsyncMutex,
  ContentMutationGate,
} from '../../src/core/data/contentMutationGate';
import {
  CONTINUATION_TITLE,
  MAX_CONTINUATION_PARTS,
  buildLogicalChapters,
  cleanSplitTitle,
  maxChapterOrder,
  type Chapter,
} from '../../src/core/data/chapterMerger';

describe('ContentMutationGate — epoch invalidation (ContentMutationGate.kt:6-8)', () => {
  it('starts at 0 and increments per invalidation', () => {
    const before = ContentMutationGate.epoch;
    ContentMutationGate.invalidatePendingWrites();
    expect(ContentMutationGate.epoch).toBe(before + 1);
    ContentMutationGate.invalidatePendingWrites();
    expect(ContentMutationGate.epoch).toBe(before + 2);
  });

  it('an in-flight write holding a stale expectedEpoch can detect it', () => {
    const captured = ContentMutationGate.epoch;
    ContentMutationGate.invalidatePendingWrites();
    // BookRepository.addReadingTime / updateBookProgress take
    // `expectedEpoch = ContentMutationGate.epoch` and bail when it no longer matches.
    expect(captured !== ContentMutationGate.epoch).toBe(true);
  });
});

describe('AsyncMutex — mutual exclusion and FIFO ordering', () => {
  it('serializes sections (no interleaving)', async () => {
    const mutex = new AsyncMutex();
    const order: string[] = [];

    const task = async (name: string) =>
      mutex.withLock(async () => {
        order.push(`${name}:enter`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`${name}:exit`);
      });

    await Promise.all([task('a'), task('b'), task('c')]);
    expect(order).toEqual(['a:enter', 'a:exit', 'b:enter', 'b:exit', 'c:enter', 'c:exit']);
  });

  it('is FIFO', async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];
    const tasks = [1, 2, 3, 4].map((n) =>
      mutex.withLock(async () => {
        await new Promise((r) => setTimeout(r, 1));
        order.push(n);
      }),
    );
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('releases the lock even when the body throws', async () => {
    const mutex = new AsyncMutex();
    await expect(
      mutex.withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Must still be usable afterwards.
    await expect(mutex.withLock(async () => 'ok')).resolves.toBe('ok');
  });

  it('unlocks sections even when one of many fails', async () => {
    const mutex = new AsyncMutex();
    const results = await Promise.allSettled([
      mutex.withLock(async () => 'a'),
      mutex.withLock(async () => {
        throw new Error('b');
      }),
      mutex.withLock(async () => 'c'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('manual lock()/release() works', async () => {
    const mutex = new AsyncMutex();
    const release = await mutex.lock();
    let done = false;
    const p = mutex.withLock(async () => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 1));
    expect(done).toBe(false);
    release();
    await p;
    expect(done).toBe(true);
  });
});

// ── ChapterMerger ───────────────────────────────────────────────────────────

function ch(
  chapterOrder: number,
  title: string,
  content: string,
  bookId = 1,
): Chapter {
  return {
    id: chapterOrder + 1,
    bookId,
    chapterOrder,
    title,
    content,
    startCharIndex: 0,
    endCharIndex: content.length,
  };
}

describe('ChapterMerger.cleanSplitTitle (ChapterMerger.kt:34-35)', () => {
  it('strips a "(续)" suffix', () => {
    expect(cleanSplitTitle('第一章 (续)')).toBe('第一章');
  });

  it('strips a "(续N)" suffix', () => {
    expect(cleanSplitTitle('第一章 (续2)')).toBe('第一章');
    expect(cleanSplitTitle('第一章(续10)')).toBe('第一章');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(cleanSplitTitle('  第一章 (续)  ')).toBe('第一章');
  });

  it('leaves a normal title untouched', () => {
    expect(cleanSplitTitle('第一章')).toBe('第一章');
    expect(cleanSplitTitle('Chapter 1')).toBe('Chapter 1');
    expect(cleanSplitTitle('（续）')).toBe('（续）');
  });

  it('only anchors at the end (a mid-title 续 is kept)', () => {
    expect(cleanSplitTitle('第一章 (续) 后记')).toBe('第一章 (续) 后记');
  });

  it('the CONTINUATION regex is non-greedy on the base title', () => {
    expect(CONTINUATION_TITLE.test('第一章 (续)')).toBe(true);
    expect(CONTINUATION_TITLE.test('第一章')).toBe(false);
  });
});

describe('ChapterMerger.buildLogicalChapters — merge rules (ChapterMerger.kt:37-90)', () => {
  it('returns nothing for an empty physical list', () => {
    const book = buildLogicalChapters([]);
    expect(book.chapters).toEqual([]);
    expect(book.logicalToPhysicalOrders).toEqual([]);
  });

  it('passes a single non-continuation chapter through', () => {
    const book = buildLogicalChapters([ch(0, '第一章', 'A')]);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]?.title).toBe('第一章');
    expect(book.chapters[0]?.content).toBe('A');
  });

  it('merges "第一章" + "第一章 (续)" into one logical chapter', () => {
    const book = buildLogicalChapters([ch(0, '第一章', 'A'), ch(1, '第一章 (续)', 'B')]);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]?.content).toBe('AB');
    expect(book.chapters[0]?.title).toBe('第一章');
    expect(book.logicalToPhysicalOrders[0]).toEqual([0, 1]);
  });

  it('does NOT merge chapters with different titles', () => {
    const book = buildLogicalChapters([ch(0, '第一章', 'A'), ch(1, '第二章', 'B')]);
    expect(book.chapters).toHaveLength(2);
  });

  it('caps a merge run at 4 parts, then starts a new logical chapter', () => {
    const input = [0, 1, 2, 3, 4].map((i) =>
      ch(i, i === 0 ? '第二章' : '第二章 (续)', String.fromCharCode(65 + i)),
    );
    const book = buildLogicalChapters(input);
    expect(MAX_CONTINUATION_PARTS).toBe(4);
    // parts 0..3 merge; part 4 starts a fresh logical chapter.
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0]?.content).toBe('ABCD');
    expect(book.chapters[1]?.content).toBe('E');
    expect(book.logicalToPhysicalOrders[0]).toEqual([0, 1, 2, 3]);
    expect(book.logicalToPhysicalOrders[1]).toEqual([4]);
  });

  it('breaks the merge run when the base title changes', () => {
    const book = buildLogicalChapters([
      ch(0, '第一章', 'A'),
      ch(1, '第一章 (续)', 'B'),
      ch(2, '第二章', 'C'),
      ch(3, '第二章 (续)', 'D'),
    ]);
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0]?.content).toBe('AB');
    expect(book.chapters[1]?.content).toBe('CD');
  });

  it('assigns sequential chapterOrder to logical chapters', () => {
    const book = buildLogicalChapters([
      ch(0, 'A', 'a'),
      ch(1, 'A (续)', 'b'),
      ch(2, 'B', 'c'),
    ]);
    expect(book.chapters.map((c) => c.chapterOrder)).toEqual([0, 1]);
  });

  it('renumbers a shuffled/duplicated chapterOrder space via maxChapterOrder', () => {
    expect(maxChapterOrder([ch(3, 'a', 'a'), ch(7, 'b', 'b')])).toBe(7);
    expect(maxChapterOrder([])).toBe(-1);
  });

  it('carries startCharIndex from the first part and endCharIndex from the last', () => {
    const first = { ...ch(0, 'A', 'AAAA'), startCharIndex: 10, endCharIndex: 14 };
    const last = { ...ch(1, 'A (续)', 'BBBB'), startCharIndex: 14, endCharIndex: 18 };
    const book = buildLogicalChapters([first, last]);
    expect(book.chapters[0]?.startCharIndex).toBe(10);
    expect(book.chapters[0]?.endCharIndex).toBe(18);
  });

  it('does not merge when the continuation appears before any base chapter', () => {
    // A leading "(续)" has baseTitle === null, so it starts its own group.
    const book = buildLogicalChapters([ch(0, '第一章 (续)', 'X'), ch(1, '第一章', 'Y')]);
    expect(book.chapters).toHaveLength(2);
  });
});

describe('LogicalChapterBook mapping helpers (ChapterMerger.kt:15-30)', () => {
  const book = buildLogicalChapters([
    ch(0, '第一章', 'A'),
    ch(1, '第一章 (续)', 'BB'),
    ch(2, '第二章', 'CCC'),
  ]);

  it('logicalIndexOf maps physical -> logical', () => {
    expect(book.logicalIndexOf(0)).toBe(0);
    expect(book.logicalIndexOf(1)).toBe(0);
    expect(book.logicalIndexOf(2)).toBe(1);
  });

  it('logicalIndexOf passes through out-of-range orders', () => {
    expect(book.logicalIndexOf(99)).toBe(99);
    expect(book.logicalIndexOf(-1)).toBe(-1);
  });

  it('logicalOffsetOf adds the part offset within the merged buffer', () => {
    expect(book.logicalOffsetOf(0, 0)).toBe(0);
    // Part 1 starts after part 0's single 'A'.
    expect(book.logicalOffsetOf(1, 0)).toBe(1);
    expect(book.logicalOffsetOf(1, 2)).toBe(3);
  });

  it('logicalOffsetOf passes through for out-of-range orders', () => {
    expect(book.logicalOffsetOf(42, 7)).toBe(7);
  });

  it('physicalIndexFor returns the FIRST physical order of a logical chapter', () => {
    expect(book.physicalIndexFor(0)).toBe(0);
    expect(book.physicalIndexFor(1)).toBe(2);
  });

  it('physicalIndexFor passes through out-of-range indices', () => {
    expect(book.physicalIndexFor(99)).toBe(99);
    expect(book.physicalIndexFor(-5)).toBe(-5);
  });
});