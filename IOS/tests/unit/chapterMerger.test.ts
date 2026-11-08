import { describe, expect, it } from 'vitest';
import {
  buildLogicalChapters,
  cleanSplitTitle,
  type Chapter,
} from '../../src/core/data/chapterMerger';

function ch(order: number, title: string, content: string): Chapter {
  return {
    id: order + 1,
    bookId: 1,
    chapterOrder: order,
    title,
    content,
    startCharIndex: order * 100,
    endCharIndex: order * 100 + content.length,
  };
}

describe('chapterMerger', () => {
  it('cleanSplitTitle strips (续)/(续N)', () => {
    expect(cleanSplitTitle('长章节 (续)')).toBe('长章节');
    expect(cleanSplitTitle('长章节 (续1)')).toBe('长章节');
    expect(cleanSplitTitle('长章节（续2）')).toBe('长章节（续2）');
    expect(cleanSplitTitle('独立章节')).toBe('独立章节');
  });

  it('merges (续)(续1) into one logical chapter', () => {
    const physical = [ch(0, '长章节', 'AAA'), ch(1, '长章节 (续)', 'BBB'), ch(2, '长章节 (续1)', 'CCC')];
    const book = buildLogicalChapters(physical);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0]?.title).toBe('长章节');
    expect(book.chapters[0]?.content).toBe('AAABBBCCC');
    expect(book.chapters[0]?.chapterOrder).toBe(0);
    expect(book.chapters[0]?.startCharIndex).toBe(0);
    expect(book.chapters[0]?.endCharIndex).toBe(2 * 100 + 3);
  });

  it('caps merges at 4 parts', () => {
    const titles = ['长章节', '长章节 (续)', '长章节 (续1)', '长章节 (续2)', '长章节 (续3)', '长章节 (续4)'];
    const physical = titles.map((t, i) => ch(i, t, `c${i}`));
    const book = buildLogicalChapters(physical);
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0]?.content).toBe('c0c1c2c3');
    expect(book.chapters[1]?.content).toBe('c4c5');
    expect(book.logicalToPhysicalOrders[0]).toEqual([0, 1, 2, 3]);
    expect(book.logicalToPhysicalOrders[1]).toEqual([4, 5]);
  });

  it('logicalOffsetOf maps physical offsets into merged content', () => {
    const physical = [ch(0, '长章节', 'AAA'), ch(1, '长章节 (续)', 'BBB')];
    const book = buildLogicalChapters(physical);
    expect(book.logicalOffsetOf(0, 0)).toBe(0);
    expect(book.logicalOffsetOf(0, 2)).toBe(2);
    expect(book.logicalOffsetOf(1, 0)).toBe(3);
    expect(book.logicalOffsetOf(1, 1)).toBe(4);
    expect(book.logicalIndexOf(1)).toBe(0);
    expect(book.physicalIndexFor(0)).toBe(0);
  });

  it('out-of-range orders fall back to input values', () => {
    const book = buildLogicalChapters([ch(0, '章', 'X')]);
    expect(book.logicalIndexOf(99)).toBe(99);
    expect(book.logicalOffsetOf(99, 5)).toBe(5);
    expect(book.physicalIndexFor(99)).toBe(99);
  });

  it('physicalToLogical sized maxOrder+1 with identity/zero defaults', () => {
    const book = buildLogicalChapters([ch(0, 'A', 'a'), ch(2, 'B', 'b')]);
    expect(book.physicalToLogical).toEqual([0, 1, 1]);
    expect(book.physicalToLogicalOffset).toEqual([0, 0, 0]);
  });
});
