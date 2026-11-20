// @vitest-environment node
import { readFileSync } from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTINUATION_TITLE,
  MAX_CONTINUATION_PARTS,
  buildLogicalChapters,
  cleanSplitTitle,
  maxChapterOrder,
  type Chapter,
} from '../../src/core/data/chapterMerger';
import { naturalOrderCompare } from '../../src/core/data/naturalOrderCompare';
import { androidReference } from '../helpers/androidReference';

/** 读 Kotlin 原文（本地工作区读 `novel-reader/`，CI 读快照）。 */
function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

const MERGER_KT = 'data/ChapterMerger.kt';
const BOOK_KT = 'data/Book.kt';

interface ChapterMergerFixtureCase {
  name: string;
  input: Chapter[];
  logical: Chapter[];
  physicalToLogical: number[];
  physicalToLogicalOffset: number[];
  logicalToPhysicalOrders?: number[][];
}

interface NaturalOrderFixturePair {
  a: string;
  b: string;
  cmp: -1 | 0 | 1;
}

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../parity/fixtures',
);

describe('chapterMerger parity vs Android fixtures', () => {
  const fixture = JSON.parse(
    readFileSync(path.join(fixturesDir, 'chapterMerger.generated.json'), 'utf8'),
  ) as { cases: ChapterMergerFixtureCase[] };

  it('has the required cases', () => {
    const names = fixture.cases.map((c) => c.name);
    expect(names).toContain('single-chapter');
    expect(names).toContain('merge-continuation');
    expect(names).toContain('max-4-parts-then-new');
    expect(names).toContain('title-cleanup-xu2');
  });

  for (const c of fixture.cases) {
    it(`case ${c.name}`, () => {
      const result = buildLogicalChapters(c.input);
      /*
       * 夹具里的 `logical` 条目**没有 `id` 键** —— 那是 kotlinx.serialization 的
       * `encodeDefaults = false`：`Chapter.id` 的默认值 `0`（`Book.kt` L53
       * `@PrimaryKey(autoGenerate = true) val id: Int = 0`）不写进 JSON。
       *
       * 所以缺省 `id` 必须按 **0** 参与比较，而不是「不比较」：合并出来的逻辑章是
       * 合成行，`id` 恒为 0，绝不能是物理分片的主键（E197）。
       */
      expect(result.chapters).toEqual(c.logical.map((x) => ({ ...x, id: x.id ?? 0 })));
      expect(result.physicalToLogical).toEqual(c.physicalToLogical);
      expect(result.physicalToLogicalOffset).toEqual(c.physicalToLogicalOffset);
      if (c.logicalToPhysicalOrders) {
        expect(result.logicalToPhysicalOrders).toEqual(c.logicalToPhysicalOrders);
      }
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
   读 Kotlin 原文的强断言（`ChapterMerger.kt` 91 行 + `Book.kt` L51-60）
   —— 上面那组走的是生成好的 JSON 夹具，证明不了「端口与当前原文一致」；
      这一组每条都先读 `androidReference()`，再验证行为。
   ══════════════════════════════════════════════════════════════════════════════ */

function ch(order: number, title: string, content = `body${String(order)}`, extra: Partial<Chapter> = {}): Chapter {
  return {
    id: order + 1, // 物理行在 DB 里是有 id 的
    bookId: 7,
    chapterOrder: order,
    title,
    content,
    startCharIndex: order * 100,
    endCharIndex: order * 100 + content.length,
    ...extra,
  };
}

describe('ChapterMerger.kt L7 CONTINUATION_TITLE', () => {
  const src = kt(MERGER_KT);

  it('`^(.+?)\\s*\\((?:续|续[0-9]+)\\)\\s*$` —— `续` 与 `续N` 两种，括号前允许空白', () => {
    expect(src).toContain('private val CONTINUATION_TITLE = Regex("""^(.+?)\\s*\\((?:续|续[0-9]+)\\)\\s*$""")');
    expect(CONTINUATION_TITLE.source).toBe('^(.+?)\\s*\\((?:续|续[0-9]+)\\)\\s*$');
    expect(CONTINUATION_TITLE.test('第三章 (续)')).toBe(true);
    expect(CONTINUATION_TITLE.test('第三章(续)')).toBe(true);
    expect(CONTINUATION_TITLE.test('第三章 (续2)')).toBe(true);
    expect(CONTINUATION_TITLE.test('第三章(续12)')).toBe(true);
    // `续` 与数字之间不允许空格
    expect(CONTINUATION_TITLE.test('第三章 (续 2)')).toBe(false);
    // 全角括号不在规则内
    expect(CONTINUATION_TITLE.test('第三章（续）')).toBe(false);
    expect(CONTINUATION_TITLE.test('第三章 (续) 加笔')).toBe(false);
  });

  it('L34-35 `cleanSplitTitle`：命中返回 group(1)，未命中返回**未 trim 的**原始入参', () => {
    expect(src).toContain('CONTINUATION_TITLE.matchEntire(title.trim())?.groupValues?.get(1) ?: title');
    expect(cleanSplitTitle('第三章 (续)')).toBe('第三章');
    expect(cleanSplitTitle('  第三章(续3)  ')).toBe('第三章');
    expect(cleanSplitTitle('第三章')).toBe('第三章');
    expect(cleanSplitTitle('  第三章  ')).toBe('  第三章  ');
  });

  it('L39 `physical.maxOfOrNull { it.chapterOrder } ?: -1`（空表 = -1，全负表取真实最大值）', () => {
    expect(src).toContain('val maxOrder = physical.maxOfOrNull { it.chapterOrder } ?: -1');
    expect(maxChapterOrder([])).toBe(-1);
    expect(maxChapterOrder([ch(0, 'a')])).toBe(0);
    expect(maxChapterOrder([ch(3, 'a'), ch(1, 'b')])).toBe(3);
    // `maxOfOrNull` 在单元素表上返回该元素本身，不夹到 -1
    expect(maxChapterOrder([ch(-2, 'a')])).toBe(-2);
    // 全负表在 Kotlin 里会 `IntArray(maxOrder + 1)` 抛 NegativeArraySizeException；
    // 端口夹到 0 个槽位，不崩溃、也不写出越界下标。
    const book = buildLogicalChapters([ch(-2, 'a')]);
    expect(book.physicalToLogical).toEqual([]);
    expect(book.physicalToLogicalOffset).toEqual([]);
    expect(book.chapters).toHaveLength(1);
  });
});

describe('ChapterMerger.kt L37-90 buildLogicalChapters 的合并规则', () => {
  const src = kt(MERGER_KT);

  it('空输入 → 四个空容器（`maxOrder = -1` ⇒ 数组长度 0）', () => {
    const book = buildLogicalChapters([]);
    expect(book.chapters).toEqual([]);
    expect(book.physicalToLogical).toEqual([]);
    expect(book.physicalToLogicalOffset).toEqual([]);
    expect(book.logicalToPhysicalOrders).toEqual([]);
  });

  it('无 `(续)` 时逐一成章：`physToLog` 恒等、offset 全 0', () => {
    const book = buildLogicalChapters([ch(0, '第一章'), ch(1, '第二章')]);
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章', '第二章']);
    expect(book.chapters.map((c) => c.chapterOrder)).toEqual([0, 1]);
    expect(book.physicalToLogical).toEqual([0, 1]);
    expect(book.physicalToLogicalOffset).toEqual([0, 0]);
    expect(book.logicalToPhysicalOrders).toEqual([[0], [1]]);
  });

  it('`标题 (续)` 并进前一章：正文拼接、标题取基础标题、offset 指向拼接点', () => {
    const rows = [ch(0, '第一章', 'A'), ch(1, '第二章', 'BB'), ch(2, '第二章 (续)', 'CC')];
    const book = buildLogicalChapters(rows);
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[1]?.title).toBe('第二章');
    expect(book.chapters[1]?.content).toBe('BBCC');
    expect(book.physicalToLogical).toEqual([0, 1, 1]);
    // L74 `physOffset[order] = buffer.length`
    expect(book.physicalToLogicalOffset).toEqual([0, 0, 2]);
    expect(book.logicalToPhysicalOrders[1]).toEqual([1, 2]);
    // L59-60 起止字符取首片与末片
    expect(book.chapters[1]?.startCharIndex).toBe(rows[1]?.startCharIndex);
    expect(book.chapters[1]?.endCharIndex).toBe(rows[2]?.endCharIndex);
  });

  it('L53-61 合并出来的逻辑章 **`id` 恒为 0**（`Chapter.id` 的默认值 = 合成行）', () => {
    // `Book.kt` L53 `@PrimaryKey(autoGenerate = true) val id: Int = 0`
    expect(kt(BOOK_KT)).toContain('@PrimaryKey(autoGenerate = true) val id: Int = 0');
    // Kotlin 的 `Chapter(...)` 调用里没有 `id =`，所以走默认值 0
    const ctor = src.slice(src.indexOf('logical.add('), src.indexOf('logToPhys.add('));
    expect(ctor).not.toContain('id =');
    const book = buildLogicalChapters([ch(0, 'A'), ch(1, 'B (续)')]);
    expect(book.chapters.map((c) => c.id)).toEqual([0, 0]);
  });

  it('L72 `baseTitle == m.groupValues[1]` —— 基础标题必须与当前打开的章一致', () => {
    const book = buildLogicalChapters([ch(0, '第一章'), ch(1, '第二章 (续)')]);
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[1]?.title).toBe('第二章');
    expect(book.chapters[1]?.content).toBe('body1');
  });

  it('L72 `parts.size < 4` —— 一章最多 4 个物理分片（1 正片 + 3 续篇）', () => {
    expect(src).toContain('parts.size < 4');
    expect(MAX_CONTINUATION_PARTS).toBe(4);
    const rows = [
      ch(0, '第X章', '1'),
      ch(1, '第X章 (续)', '2'),
      ch(2, '第X章 (续2)', '3'),
      ch(3, '第X章 (续3)', '4'),
      ch(4, '第X章 (续4)', '5'),
    ];
    const book = buildLogicalChapters(rows);
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0]?.content).toBe('1234');
    expect(book.logicalToPhysicalOrders[0]).toEqual([0, 1, 2, 3]);
    expect(book.chapters[1]?.content).toBe('5');
    expect(book.logicalToPhysicalOrders[1]).toEqual([4]);
    expect(book.chapters[1]?.title).toBe('第X章');
  });

  it('`(续)` 出现在开头（没有前台章可并）→ 自成新章且标题被剥', () => {
    const book = buildLogicalChapters([ch(0, '序章 (续)', 'X')]);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]?.title).toBe('序章');
    expect(book.physicalToLogical).toEqual([0]);
  });

  it('L40-41 `IntArray(maxOrder + 1) { it }` —— order 不从 0 起时前缀是恒等映射', () => {
    const book = buildLogicalChapters([ch(5, 'A'), ch(6, 'A (续)')]);
    expect(book.physicalToLogical).toEqual([0, 1, 2, 3, 4, 0, 0]);
    expect(book.physicalToLogicalOffset).toHaveLength(7);
    expect(book.logicalToPhysicalOrders).toEqual([[5, 6]]);
    expect(book.logicalIndexOf(3)).toBe(3);
    expect(book.logicalOffsetOf(3, 9)).toBe(9);
  });

  it('重复 `chapterOrder` 时 `associateBy` 取最后一个（Kotlin L38 语义）', () => {
    // 两行同 order、标题都不带 `(续)` → **各自成章**（第二行不是续篇），
    // 但 `logicalToPhysicalOrders` 里两章都记着同一个 order，且 `physToLog[0]` 被后写覆盖成 1。
    const book = buildLogicalChapters([ch(0, 'A', 'first'), ch(0, 'A', 'second')]);
    expect(book.chapters).toHaveLength(2);
    expect(book.logicalToPhysicalOrders).toEqual([[0], [0]]);
    expect(book.physicalToLogical).toEqual([1]);
  });
});

describe('ChapterMerger.kt L9-31 LogicalChapterBook 的三个方法', () => {
  const src = kt(MERGER_KT);
  const book = buildLogicalChapters([ch(0, 'A', 'aa'), ch(1, 'B', 'bb'), ch(2, 'B (续)', 'cc')]);

  it('L15-16 `logicalIndexOf`：在 indices 内查表，否则原样返回', () => {
    expect(src).toContain(
      'if (physicalOrder in physicalToLogical.indices) physicalToLogical[physicalOrder] else physicalOrder',
    );
    expect(book.logicalIndexOf(0)).toBe(0);
    expect(book.logicalIndexOf(2)).toBe(1);
    expect(book.logicalIndexOf(-1)).toBe(-1);
    expect(book.logicalIndexOf(99)).toBe(99);
  });

  it('L18-23 `logicalOffsetOf`：在 indices 内加偏移，否则原样返回', () => {
    expect(src).toContain('physicalToLogicalOffset[physicalOrder] + physicalOffset');
    expect(book.logicalOffsetOf(0, 3)).toBe(3);
    // order 2 是续篇，offset = 2（'bb' 的长度）
    expect(book.logicalOffsetOf(2, 3)).toBe(5);
    expect(book.logicalOffsetOf(99, 4)).toBe(4);
    expect(book.logicalOffsetOf(-1, 4)).toBe(4);
  });

  it('L25-30 `physicalIndexFor`：取该逻辑章的第一个物理 order', () => {
    expect(src).toContain('return logicalToPhysicalOrders[logicalIndex].firstOrNull() ?: logicalIndex');
    expect(book.physicalIndexFor(0)).toBe(0);
    expect(book.physicalIndexFor(1)).toBe(1);
    expect(book.physicalIndexFor(99)).toBe(99);
    expect(book.physicalIndexFor(-3)).toBe(-3);
  });

  it('L27 `firstOrNull() ?: logicalIndex` —— 空数组回落到逻辑下标本身', () => {
    const empty = buildLogicalChapters([]);
    expect({ ...empty, logicalToPhysicalOrders: [[]] }.physicalIndexFor(0)).toBe(0);
  });
});

describe('ChapterMerger.kt L51-52 `byOrder.getValue(...)` 的缺行语义', () => {
  it('端口必须抛错（旧实现静默 return，会把「少一章」伪装成「少一个逻辑章」）', () => {
    const src = readFileSync('src/core/data/chapterMerger.ts', 'utf8');
    expect(src).toContain('NoSuchElementException');
    expect(src).toContain('throw new Error(');
  });

  it('§ L51-52 原文用的是 `getValue`（缺行即抛 NoSuchElementException）', () => {
    expect(kt(MERGER_KT)).toContain('val first = byOrder.getValue(parts.first())');
    expect(kt(MERGER_KT)).toContain('val last = byOrder.getValue(parts.last())');
  });
});

describe('naturalOrder parity vs Android fixtures', () => {
  const fixture = JSON.parse(
    readFileSync(path.join(fixturesDir, 'naturalOrder.generated.json'), 'utf8'),
  ) as { pairs: NaturalOrderFixturePair[] };

  it('has pairs', () => {
    expect(fixture.pairs.length).toBeGreaterThan(0);
  });

  for (const p of fixture.pairs) {
    it(`compare(${JSON.stringify(p.a)}, ${JSON.stringify(p.b)}) === ${p.cmp}`, () => {
      expect(naturalOrderCompare(p.a, p.b)).toBe(p.cmp);
      const reverse = p.cmp === 0 ? 0 : -p.cmp;
      expect(naturalOrderCompare(p.b, p.a)).toBe(reverse);
    });
  }
});
