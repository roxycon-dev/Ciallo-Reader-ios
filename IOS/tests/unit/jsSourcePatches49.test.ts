import { describe, expect, it } from 'vitest';
import { Script, runInNewContext } from 'node:vm';
import { JS_SOURCE_PATCH_VERSION, patchScript, patchCachedScript } from '@core/source/js/jsSourcePatches49';

describe('current source repairs execute real repaired code', () => {
  it('keeps the e-hentai update URL quoted and leaves valid class syntax', () => {
    const patched = patchScript('ehentai', 'class Ehentai {\n    // update url\n    url = "https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/ehentai.js"\n}');
    expect(JS_SOURCE_PATCH_VERSION).toBe(49); expect(patched).toContain('async init()');
    expect(() => new Script(patched)).not.toThrow();
  });
  it('repairs hitomi without closing the image function before its return', () => {
    const source = `async function get_image_srcs(files) {
      const resp = await Network.get("https://" + domain + "/" + "gg.js?_=" + new Date().getTime(), {referer: refererUrl,});
      if (resp.status >= 400) { throw new Error(resp.status); }
      eval(resp.body); if (!gg.b) throw new Error();
      return files.map((image) => url_from_url_from_hash(0, image, "avif"));
    }`;
    const patched = patchScript('hitomi', source);
    expect(patched).toContain('__ggCacheTime'); expect(patched).toContain('"webp"'); expect(() => new Script(patched)).not.toThrow();
  });
  it.each(['copy_manga', 'copy_manga_multi_accounts'])('prevents optional network jobs during %s initialization, including pre-raw caches', (key) => {
    const source = `class CopyManga {
    init() {
        this.refreshSearchApi();
        this.refreshAppApi().catch(() => {});
    }
    refreshSearchApi() { throw new Error('Network must remain idle during init'); }
    refreshAppApi() { throw new Error('Network must remain idle during init'); }
}`;
    const patched = patchCachedScript(key, source);
    expect(() => runInNewContext(patched + '\nnew CopyManga().init()')).not.toThrow();
    expect(patched.match(/void 0/g)).toHaveLength(2);
  });
  it('parses balanced MYCOMIC chapter JSON without truncating brackets or escaped quotes in titles', () => {
    const patched = patchScript('mycomic', 'class MyComic {}');
    const chapters = [{ id: 7, title: '第一章 ] "中括号"', name: '\\path' }];
    const encoded = JSON.stringify(chapters);
    const result = runInNewContext(patched + '\n__cialloChapterJson(doc, html)', { doc: { querySelectorAll: () => [{ attributes: { 'x-data': `reader({chapters: ${encoded}, other: true})` } }] }, html: '' }) as string[];
    expect(JSON.parse(result[1]!)).toEqual(chapters);
    expect(patchCachedScript('mycomic', patched)).toBe(patched);
  });
  it('uses Comick cursors and truthful follow-count metadata in its native discovery handler', async () => {
    const calls: string[] = [];
    const patched = patchScript('comick', 'class Comick { static comic_status = {}; }');
    const result = await runInNewContext(patched + `\nComick.prototype.discover.load.call(new Comick(), {dimension:'ranking',range:'热门',status:'连载',page:2,offset:20,cursor:'next/token'})`, {
      Network: { get: async (url: string) => { calls.push(url); return { status: 200, body: JSON.stringify({ data: [{ slug: 'real-work', title: '作品', user_follow_count: 27, status: 1, md_covers: [] }], next_cursor: 'third-page' }) }; } },
    }) as { entries: Array<{ id: string; rank: number; followCount: number; statistic: string }>; nextCursor: string; hasMore: boolean };
    expect(calls).toEqual(['https://comick.art/api/search?order_by=user_follow_count&status=1&cursor=next%2Ftoken']);
    expect(result).toMatchObject({ hasMore: true, nextCursor: 'third-page', entries: [{ id: 'real-work//作品', rank: 21, followCount: 27, statistic: '关注 27' }] });
  });
  it('repairs both JVM-style multiline route arrays and retries only valid encrypted API responses', async () => {
    const source = `class JM {
    static fallbackServers = [
        "old.invalid",
    ];
    static apiDomains = ["old.invalid"];
    get baseUrl() { return 'https://' + JM.apiDomains[0]; }
    loadSetting() { return '1'; } loadData() { return null; } saveData(key, value) { this.saved = value; }
    getApiHeaders() { return {}; } convertData(value) { return value; }
    async get(url) { throw new Error('old route'); }
    async post(url, body) { return body; }
}`;
    const calls: string[] = [];
    const patched = patchScript('jm', source);
    expect(patched).not.toContain('old.invalid'); expect(() => new Script(patched)).not.toThrow();
    const result = await runInNewContext(patched + '\nnew JM().get("https://www.cdnhjk.net/api/test")', { Network: { get: async (url: string) => {
      calls.push(url); if (calls.length === 1) throw new Error('TLS unavailable'); if (calls.length === 2) return { status: 200, body: 'upstream proxy error' };
      return { status: 200, body: JSON.stringify({ data: '{"ok":true}' }) };
    } } }) as string;
    expect(JSON.parse(result)).toEqual({ ok: true }); expect(calls).toHaveLength(3);
  });
});
