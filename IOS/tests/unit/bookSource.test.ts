import { describe, expect, it } from 'vitest';
import {
  countEnabledSources,
  describeBookSource,
  mergeSources,
  moveSource,
  parseBookSourceJson,
  parseBookSourceList,
  serializeBookSource,
  serializeBookSourceList,
  setSourceEnabled,
  type BookSourceConfig,
} from '../../src/core/source/bookSourceTypes';

const LEGADO_SAMPLE = JSON.stringify({
  bookSourceName: '示例书源',
  bookSourceUrl: 'https://example.com',
  bookSourceGroup: '自定义',
  enabled: 1,
  searchUrl: 'https://example.com/search?q={{key}}',
  ruleBookList: '$.data.list.*',
  ruleBookName: 'name@text',
  ruleAuthor: 'author@text',
  ruleCoverUrl: 'cover@src',
  ruleChapterList: '$.data.chapters.*',
  ruleChapterName: 'title@text',
  ruleChapterUrl: 'url@text',
  ruleContent: 'content@html',
  ruleNextContentUrl: 'next@href',
  header: '{"User-Agent":"Mozilla/5.0"}',
  weight: 100,
  enabledIsAdult: false,
});

describe('bookSourceTypes', () => {
  it('parses Legado-like JSON into BookSourceConfig', () => {
    const cfg = parseBookSourceJson(LEGADO_SAMPLE);

    expect(cfg.id).toBe('https://example.com');
    expect(cfg.name).toBe('示例书源');
    expect(cfg.enabled).toBe(true);
    expect(cfg.group).toBe('自定义');
    expect(cfg.bookSourceUrl).toBe('https://example.com');
    expect(cfg.searchUrl).toBe('https://example.com/search?q={{key}}');
    expect(cfg.ruleBookList).toBe('$.data.list.*');
    expect(cfg.ruleBookName).toBe('name@text');
    expect(cfg.ruleAuthor).toBe('author@text');
    expect(cfg.ruleCoverUrl).toBe('cover@src');
    expect(cfg.ruleChapterList).toBe('$.data.chapters.*');
    expect(cfg.ruleChapterName).toBe('title@text');
    expect(cfg.ruleChapterUrl).toBe('url@text');
    expect(cfg.ruleContent).toBe('content@html');
    expect(cfg.ruleNextContentUrl).toBe('next@href');
    expect(cfg.header).toBe('{"User-Agent":"Mozilla/5.0"}');
    expect(cfg.weight).toBe(100);
    expect(cfg.enabledIsAdult).toBe(false);
    expect(cfg.exploreUrl).toBeUndefined();
  });

  it('accepts explicit id/name and boolean enabled', () => {
    const cfg = parseBookSourceJson(
      JSON.stringify({ id: 'src-a', name: 'A', enabled: false, weight: 1 }),
    );
    expect(cfg.id).toBe('src-a');
    expect(cfg.name).toBe('A');
    expect(cfg.enabled).toBe(false);
    expect(cfg.weight).toBe(1);
  });

  it('throws when id cannot be determined', () => {
    expect(() => parseBookSourceJson(JSON.stringify({ name: 'x' }))).toThrow();
  });

  it('serializeBookSource round-trips through parse', () => {
    const src = parseBookSourceJson(LEGADO_SAMPLE);
    const json = serializeBookSource(src);
    const back = parseBookSourceJson(json);
    expect(back).toEqual(src);
  });

  it('mergeSources replaces by id (incoming wins), keeps order', () => {
    const existing: BookSourceConfig[] = [
      { id: 'a', name: 'A-old', enabled: true },
      { id: 'b', name: 'B', enabled: false, group: 'G' },
    ];
    const incoming: BookSourceConfig[] = [
      { id: 'a', name: 'A-new', enabled: false },
      { id: 'c', name: 'C', enabled: true },
    ];

    const merged = mergeSources(existing, incoming);

    expect(merged.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(merged[0]?.name).toBe('A-new');
    expect(merged[0]?.enabled).toBe(false);
    expect(merged[1]).toEqual({ id: 'b', name: 'B', enabled: false, group: 'G' });
    expect(merged[2]).toEqual({ id: 'c', name: 'C', enabled: true });
  });

  it('parses single object, array, and wrapped list payloads', () => {
    const single = parseBookSourceList(LEGADO_SAMPLE);
    expect(single).toHaveLength(1);
    expect(single[0]?.id).toBe('https://example.com');

    const array = parseBookSourceList(
      JSON.stringify([
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B', enabled: false },
      ]),
    );
    expect(array.map((s) => s.id)).toEqual(['a', 'b']);

    const wrapped = parseBookSourceList(
      JSON.stringify({ data: [{ id: 'w1', name: 'W' }, { name: 'bad' }] }),
    );
    expect(wrapped.map((s) => s.id)).toEqual(['w1']);
  });

  it('throws on empty or invalid list payloads', () => {
    expect(() => parseBookSourceList('')).toThrow();
    expect(() => parseBookSourceList('[]')).toThrow();
    expect(() => parseBookSourceList('"nope"')).toThrow();
  });

  it('serializeBookSourceList round-trips through parseBookSourceList', () => {
    const sources = parseBookSourceList(LEGADO_SAMPLE);
    const json = serializeBookSourceList(sources);
    expect(parseBookSourceList(json)).toEqual(sources);
  });

  it('setSourceEnabled toggles only matching id', () => {
    const sources: BookSourceConfig[] = [
      { id: 'a', name: 'A', enabled: true },
      { id: 'b', name: 'B', enabled: false },
    ];
    const next = setSourceEnabled(sources, 'a', false);
    expect(next[0]?.enabled).toBe(false);
    expect(next[1]?.enabled).toBe(false);
  });

  it('moveSource reorders up/down and ignores out-of-range moves', () => {
    const sources: BookSourceConfig[] = [
      { id: 'a', name: 'A', enabled: true },
      { id: 'b', name: 'B', enabled: true },
      { id: 'c', name: 'C', enabled: true },
    ];
    expect(moveSource(sources, 'b', 'up').map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(moveSource(sources, 'b', 'down').map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(moveSource(sources, 'a', 'up')).toBe(sources);
    expect(moveSource(sources, 'c', 'down')).toBe(sources);
  });

  it('describeBookSource and countEnabledSources', () => {
    const sources: BookSourceConfig[] = [
      { id: 'a', name: 'A', enabled: true, group: '小说', bookSourceUrl: 'https://a.test', weight: 3 },
      { id: 'b', name: 'B', enabled: false },
    ];
    expect(describeBookSource(sources[0] as BookSourceConfig)).toBe(
      '小说 · https://a.test · 权重 3',
    );
    expect(describeBookSource(sources[1] as BookSourceConfig)).toBe('b');
    expect(countEnabledSources(sources)).toBe(1);
  });
});
