import { describe, expect, it } from 'vitest';
import { splitHtmlIntoChapters } from '../../src/core/parser/mobiParser';

describe('splitHtmlIntoChapters', () => {
  it('按 pagebreak / hr 粗切并以 h1 标题命名', () => {
    const html = '<h1>第一章</h1><p>甲</p><hr /><h1>第二章</h1><p>乙</p>';
    const chapters = splitHtmlIntoChapters(html);
    // Kotlin quirk (MobiParser.kt L842-869): each heading is its OWN segment
    // carrying the title hint, and the body following it becomes a separate
    // hint-less segment titled 第 N 章. One `<h1>+<p>` pair therefore yields
    // TWO chapters on Android — the TS port reproduces that, test follows.
    expect(chapters).toHaveLength(4);
    expect(chapters[0]?.title).toBe('第一章');
    expect(chapters[0]?.content).toContain('第一章');
    expect(chapters[1]?.title).toBe('第 2 章');
    expect(chapters[1]?.content).toContain('甲');
    expect(chapters[2]?.title).toBe('第二章');
    expect(chapters[3]?.title).toBe('第 4 章');
    expect(chapters[3]?.content).toContain('乙');
  });

  it('mbp:pagebreak 也可作为切分点', () => {
    const html = '<p>前</p><mbp:pagebreak/><p>后</p>';
    const chapters = splitHtmlIntoChapters(html);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.content).toContain('前');
    expect(chapters[1]?.content).toContain('后');
  });

  it('无标题段落回退为「未命名」默认章节名 第 N 章', () => {
    const chapters = splitHtmlIntoChapters('<p>正文一</p><hr /><p>正文二</p>');
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe('第 1 章');
    expect(chapters[1]?.title).toBe('第 2 章');
    expect(chapters[0]?.content).toContain('正文一');
    expect(chapters[1]?.content).toContain('正文二');
  });

  it('标题标签清理标签与实体', () => {
    const chapters = splitHtmlIntoChapters('<h2>标题 &amp; 副题</h2><p>a &lt;b&gt; c&nbsp;d</p>');
    // Android: the <h2> segment is its own chapter (title from the hint),
    // the <p> segment is the body chapter titled 第 2 章.
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe('标题 & 副题');
    expect(chapters[0]?.content).toContain('标题 & 副题');
    expect(chapters[1]?.title).toBe('第 2 章');
    expect(chapters[1]?.content).toContain('a <b> c d');
  });

  it('单章超过 5000 字时按 5000 字拆分为「第 N 部分」', () => {
    const content = '字'.repeat(12_000);
    const chapters = splitHtmlIntoChapters(`<p>${content}</p>`);
    expect(chapters.length).toBe(3);
    expect(chapters[0]?.title).toBe('第 1 部分');
    expect(chapters[1]?.title).toBe('第 2 部分');
    expect(chapters[0]?.content.length).toBe(5_000);
    expect(chapters[2]?.content.length).toBe(2_000);
  });

  it('超大章节按 30000 字拆分并追加 (续N)', () => {
    const content = '字'.repeat(70_000);
    const chapters = splitHtmlIntoChapters(`<h1>超长</h1><p>${content}</p>`);
    // Android: the <h1> segment is a chapter of its own; the 70000-char
    // paragraph is a separate chapter split into 30000/30000/10000 parts.
    expect(chapters.length).toBe(4);
    expect(chapters[0]?.title).toBe('超长');
    expect(chapters[0]?.content).toContain('超长');
    expect(chapters[1]?.title).toBe('第 2 章');
    expect(chapters[2]?.title).toBe('第 2 章 (续2)');
    expect(chapters[3]?.title).toBe('第 2 章 (续3)');
    expect(chapters[1]?.content.length).toBe(30_000);
    expect(chapters[3]?.content.length).toBe(10_000);
  });

  it('空白输入返回空数组', () => {
    expect(splitHtmlIntoChapters('')).toEqual([]);
    expect(splitHtmlIntoChapters('   \n  ')).toEqual([]);
  });
});
