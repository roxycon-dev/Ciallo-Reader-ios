import { describe, expect, it, vi } from 'vitest';
import { favoriteShareText } from '@core/library/favoriteShare';
import { sharedWorkLinkParse } from '@core/library/sharedWorkLink';
import type { BookSource } from '@core/source/bookSource';

const work = (id: string, sourceId = 'source') => ({ sourceId, comicId: id, title: `作品 ${id}` });
const preferences = () => { const values = new Map<string, string>(); return { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { values.set(key, value); } }; };
const source = (getShareUrl: (id: string) => Promise<string | null>) => ({ getShareUrl }) as BookSource;

describe('favorite public detail sharing', () => {
  it('shares deduplicated public URLs in selection order and reuses their cache', async () => {
    const get = vi.fn(async (id: string) => `https://example.org/title/${id}`), prefs = preferences();
    const shared = await favoriteShareText([work('a'), work('b'), work('a')], () => source(get), prefs);
    expect(shared).toEqual({ title: '作品 a、作品 b', text: '《作品 a》\nhttps://example.org/title/a\n\n《作品 b》\nhttps://example.org/title/b' });
    await favoriteShareText([work('a')], () => source(get), prefs);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('uses direct public IDs and falls back to exact offline app targets', async () => {
    const get = vi.fn(async () => null);
    const shared = await favoriteShareText([work('https://example.org/work/1'), work('opaque 编号', '私有源')], () => source(get), preferences());
    expect(get).toHaveBeenCalledTimes(1);
    const link = shared.text.split('\n').find((line) => line.startsWith('ciallo:'))!;
    expect(sharedWorkLinkParse(link)).toEqual({ sourceId: '私有源', bookId: 'opaque 编号', title: '作品 opaque 编号' });
    expect(sharedWorkLinkParse(link.replace('ciallo://detail?', 'ciallo://detail/?'))).toBeNull();
  });
  it('rejects invalid source links and embedded account credentials', async () => {
    await expect(favoriteShareText([work('a')], () => source(async () => 'javascript:alert(1)'), preferences())).rejects.toThrow('书源详情链接无效');
    await expect(favoriteShareText([work('https://user:secret@example.org/a')], () => source(async () => null), preferences())).rejects.toThrow('账号信息');
  });
  it('limits source lookups to three and keeps fallback links on source failures', async () => {
    let active = 0, peak = 0;
    const shared = await favoriteShareText(Array.from({ length: 7 }, (_, i) => work(String(i))), () => source(async () => {
      active++; peak = Math.max(active, peak); await Promise.resolve(); active--; throw new Error('offline');
    }), preferences());
    expect(peak).toBeLessThanOrEqual(3);
    expect(shared.text.match(/ciallo:\/\/detail/g)).toHaveLength(7);
  });
  it('releases a stuck source after four seconds and produces an app link', async () => {
    vi.useFakeTimers();
    try {
      const pending = favoriteShareText([work('slow')], () => source(() => new Promise(() => {})), preferences());
      await vi.advanceTimersByTimeAsync(4001);
      expect((await pending).text).toContain('ciallo://detail');
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
