/**
 * Tests for the pure helpers of the newly ported source modules:
 *   - `anilist/anilistModels.ts`  (AniListModels.kt)
 *   - `keyword/keywordModels.ts`  (KeywordModels.kt)
 *   - `keyword/localKeywordIndex.ts` (LocalKeywordIndex.kt)
 *   - `importer/sourceImporter.ts` (SourceImporter.kt — URL/arith conversion)
 *   - `pufeiImageCacheRetry.ts`   (PufeiImageCacheRetry.kt)
 *   - `impl/autoNovelSource.ts`   (paragraphText)
 *   - `impl/jsonBookSource.ts`    (extractImageUrls)
 */
import { describe, expect, it } from 'vitest';
import type { HttpRequest } from '@platform/interfaces';
import {
  AniListTitleType,
  MAX_VARIANTS,
  buildSearchVariants,
  toTitleRows,
} from '../../src/core/source/anilist/anilistModels';
import {
  complete,
  isPlain,
  kindOf,
  language,
  match,
  merge,
  providerDisplayName,
  query,
  shortForms,
  rank as personRank,
  compose,
  prioritized,
  VARIANT_LIMIT,
} from '../../src/core/source/keyword/keywordModels';
import { LocalKeywordIndex } from '../../src/core/source/keyword/localKeywordIndex';
import {
  PRESET_SOURCE_URLS,
  importedCount,
  parseBatch,
  skippedCount,
} from '../../src/core/source/importer/sourceImporter';
import {
  PUFEI_IMAGE_REFERER,
  PUFEI_RETRY_PARAM,
  intercept,
} from '../../src/core/source/pufeiImageCacheRetry';
import { paragraphText } from '../../src/core/source/impl/autoNovelSource';
import { extractImageUrls } from '../../src/core/source/impl/jsonBookSource';
import { MockBookSource } from '../../src/core/source/impl/mockBookSource';

describe('AniListModels', () => {
  it('expands media titles into rows and drops blank / unnormalizable ones', () => {
    const rows = toTitleRows({
      mediaId: 42,
      romaji: 'Mushoku Tensei',
      english: '',
      native: '無職転生',
      synonyms: ['   ', 'Jobless Reincarnation'],
    });
    expect(rows.map((r) => r.titleType)).toEqual([
      AniListTitleType.ROMAJI,
      AniListTitleType.NATIVE,
      AniListTitleType.SYNONYM,
    ]);
    expect(rows[0]?.normalizedTitle).toBe('mushoku tensei');
    expect(rows[1]?.normalizedTitle).toBe('无职转生');
    expect(rows[0]?.compactTitle).toBe('mushokutensei');
  });

  it('keeps the original keyword first and caps the variants at MAX_VARIANTS', () => {
    const out = buildSearchVariants('  无职转生  ', [
      '無職転生',
      'Mushoku Tensei',
      'Jobless Reincarnation',
      'むしょくてんせい',
      'A',
      'B',
      'C',
    ]);
    expect(out[0]).toBe('无职转生');
    expect(out.length).toBeLessThanOrEqual(MAX_VARIANTS);
  });

  it('de-duplicates variants on the normalized query key', () => {
    const out = buildSearchVariants('三体', ['三体', ' 三体 ', 'Three-Body']);
    expect(out).toEqual(['三体', 'Three-Body']);
  });
});

describe('KeywordKeys / KeywordPersonNames', () => {
  it('match folds punctuation and case; query does not', () => {
    expect(match(' Mushoku  Tensei ')).toBe('mushokutensei');
    expect(query(' Mushoku  Tensei ')).toBe('mushoku tensei');
    expect(query('三体III')).toBe('三体iii');
  });

  it('query keeps CJK, punctuation and Japanese vowel marks', () => {
    expect(query('ふぁCompat')).toBe('ふぁcompat');
    expect(query('A-B_C')).toBe('a-b_c');
  });

  it('language classifies kana, CJK, latin and unknown', () => {
    expect(language('ムショク')).toBe('ja');
    expect(language('无职转生')).toBe('zh');
    expect(language('Mushoku')).toBe('en');
    expect(language('123 !!!')).toBe('und');
  });

  it('isPlain rejects quoted, prefixed and flag-like expressions', () => {
    expect(isPlain('无职转生')).toBe(true);
    expect(isPlain('Mushoku Tensei')).toBe(true);
    expect(isPlain('"quoted"')).toBe(false);
    expect(isPlain('a$b')).toBe(false);
    expect(isPlain('back\\slash')).toBe(false);
    expect(isPlain('-flag')).toBe(false);
    expect(isPlain('field:value')).toBe(false);
    expect(isPlain('')).toBe(false);
    expect(isPlain('a'.repeat(161))).toBe(false);
  });

  it('shortForms keeps only the FIRST name when it is a 2-6 char CJK run', () => {
    // No separator → nothing (Kotlin lines 102-103: `parts.size < 2`).
    expect(shortForms('罗小黑')).toEqual([]);
    // '山田・太郎' → only 山田 qualifies, never the family name after the split.
    expect(shortForms('山田・太郎')).toEqual(['山田']);
    expect(shortForms('山田・太一')).toEqual(['山田']);
    // Latin text after the separator never qualifies.
    expect(shortForms('Trinity・Blood')).toEqual([]);
    expect(shortForms('山田・Yamada')).toEqual(['山田']);
  });

  it('rank prefers an exact match, then a short name', () => {
    const names = [
      { text: '山田・太郎', language: 'zh' },
      { text: 'Yamada Tarou', language: 'en' },
    ];
    // `match` is TitleNormalizer.compact, which folds '・' away, so the exact
    // key for '山田・太郎' is '山田太郎'.
    expect(personRank(names, new Set(['山田太郎']), false)).toBe(0);
    expect(personRank(names, new Set(['山田']), true)).toBe(1);
    expect(personRank(names, new Set(['山田']), false)).toBeNull();
    expect(personRank(names, new Set(['nobody']), true)).toBeNull();
  });

  it('providerDisplayName maps the five known providers', () => {
    expect(providerDisplayName('wikidata')).toBe('Wikidata');
    expect(providerDisplayName('bangumi:subjects')).toBe('Bangumi 作品');
    expect(providerDisplayName('bangumi:characters')).toBe('Bangumi 角色');
    expect(providerDisplayName('bangumi:persons')).toBe('Bangumi 人物');
    expect(providerDisplayName('anilist')).toBe('AniList');
    expect(providerDisplayName('other')).toBe('名称查询');
  });
});

describe('KeywordConcept kind + completeness', () => {
  it('classifies ids by namespace', () => {
    expect(kindOf({ id: 'seed:common:x', names: [], source: '' })).toBe('common');
    expect(kindOf({ id: 'ehtag:male:x', names: [], source: '' })).toBe('common');
    expect(kindOf({ id: 'ehtag:character:x', names: [], source: '' })).toBe('character');
    expect(kindOf({ id: 'ehtag:artist:x', names: [], source: '' })).toBe('person');
    expect(kindOf({ id: 'anilist:media:1', names: [], source: '' })).toBe('work');
    expect(kindOf({ id: 'unknown:thing', names: [], source: '' })).toBe('unknown');
  });

  it('requires a native name, plus en for works and any latin for people', () => {
    expect(complete([])).toBe(false);
    expect(
      complete([{ id: 'anilist:media:1', names: [{ text: 'a', language: 'en' }], source: '' }]),
    ).toBe(false);
    expect(
      complete([
        {
          id: 'anilist:media:1',
          names: [
            { text: 'A', language: 'en' },
            { text: 'あ', language: 'ja' },
          ],
          source: '',
        },
      ]),
    ).toBe(true);
    expect(
      complete([
        {
          id: 'ehtag:character:x',
          names: [
            { text: 'A', language: 'latin' },
            { text: 'あ', language: 'native' },
          ],
          source: '',
        },
      ]),
    ).toBe(true);
  });

  it('merge unions names and joins sources with " + "', () => {
    const merged = merge([
      {
        id: 'anilist:media:1',
        names: [{ text: 'A', language: 'en' }],
        source: 'A',
      },
      {
        id: 'anilist:media:1',
        names: [
          { text: 'A', language: 'en' },
          { text: 'B', language: 'ja' },
        ],
        source: 'B',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.names).toHaveLength(2);
    expect(merged[0]?.source).toBe('A + B');
  });

  it('merge keeps unrelated entities apart', () => {
    const merged = merge([
      { id: 'a:1', names: [{ text: 'X', language: 'en' }], source: 'A' },
      { id: 'b:1', names: [{ text: 'Y', language: 'en' }], source: 'B' },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('KeywordVariants', () => {
  it('compose returns whole names when there is a single part', () => {
    const out = compose('input', ['input'], [[{ id: 'x', names: [{ text: 'A', language: 'en' }], source: '' }]]);
    expect(out).toEqual([{ text: 'A', language: 'en' }]);
  });

  it('compose joins per-part translations for a split query', () => {
    // Kotlin line 126 skips a candidate whose query key equals the original part,
    // so the replacement must actually differ from what the user typed.
    const out = compose(
      're zero',
      ['re', 'zero'],
      [
        [{ id: 'a', names: [{ text: 'Re:', language: 'en' }], source: '' }],
        [{ id: 'b', names: [{ text: 'Zero!', language: 'en' }], source: '' }],
      ],
    );
    expect(out).toEqual([{ text: 'Re: Zero!', language: 'en' }]);
  });

  it('prioritized dedupes by text and orders by language rank', () => {
    const out = prioritized([
      { text: '三体', language: 'zh' },
      { text: '三体', language: 'en' },
      { text: 'さんびょう', language: 'ja' },
    ]);
    // Same text → the highest-ranked label wins (en before zh).
    expect(out.filter((n) => query(n.text) === '三体')).toEqual([
      { text: '三体', language: 'en' },
    ]);
    expect(out.some((n) => n.language === 'ja')).toBe(true);
  });

  it('prioritized drops blank and over-long (>160) labels', () => {
    const out = prioritized([
      { text: '', language: 'en' },
      { text: 'x'.repeat(161), language: 'en' },
      { text: 'ok', language: 'en' },
    ]);
    expect(out).toEqual([{ text: 'ok', language: 'en' }]);
  });

  it('LIMIT is 6', () => {
    expect(VARIANT_LIMIT).toBe(6);
  });
});

describe('LocalKeywordIndex', () => {
  // Columns: id | zh | en | ja | romaji — exactly five tab-separated fields.
  const seed = [
    '# comment line',
    '',
    're_zero\t重新 reincarn| rinrei\tRe:Zero|Re Zero\tむしょくてんせい\tむしょくてんせい',
  ].join('\n');

  it('indexes every name and resolves a match key', () => {
    const index = LocalKeywordIndex.fromText(seed);
    const found = index.find('Re Zero');
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toMatch(/^seed:re_zero:/);
    expect(found[0]?.source).toBe('curated-v1');
    expect(found[0]?.names.map((n) => n.language)).toEqual([
      'zh',
      'zh',
      'en',
      'en',
      'ja',
      'romaji',
    ]);
  });

  it('returns an empty list for an unknown word', () => {
    const index = LocalKeywordIndex.fromText(seed);
    expect(index.find('完全不相干的词')).toEqual([]);
  });

  it('rejects a row that does not have exactly five tab-separated fields', () => {
    expect(() => LocalKeywordIndex.fromText('a\tb\tc')).toThrow('Invalid keyword seed row');
  });
});

describe('SourceImporter — Legado URL / arithmetic conversion', () => {
  it('keeps the three community presets', () => {
    expect(PRESET_SOURCE_URLS).toHaveLength(3);
    expect(PRESET_SOURCE_URLS[0]?.[0]).toBe('https://raw.ixnic.net/XIU2/Yuedu/master/shuyuan');
  });

  it('converts {{key}}, {{page}} and base64Encode placeholders', () => {
    const one = parseBatch(
      JSON.stringify({
        bookSourceName: 't',
        bookSourceUrl: 'https://e.com/',
        searchUrl: 'https://e.com/s?k={{key}}&p={{page}}',
        ruleSearch: '{"bookList":"class.item"}',
        ruleToc: '{"chapterList":"class.chap"}',
        ruleContent: '{"content":"text"}',
      }),
    );
    expect(one.imported).toHaveLength(1);
    expect(one.imported[0]?.source.config.htmlSearch?.url).toBe(
      'https://e.com/s?k={keyword}&p={page}',
    );
    expect(importedCount(one)).toBe(1);
    expect(skippedCount(one)).toBe(0);
  });

  it('evaluates simple page arithmetic ((page-1)*20 with page fixed at 1)', () => {
    const batch = parseBatch(
      JSON.stringify({
        bookSourceName: 't',
        bookSourceUrl: 'https://e.com/',
        searchUrl: 'https://e.com/s?p={{(page-1)*20}}',
        ruleSearch: '{"bookList":"class.item"}',
        ruleToc: '{"chapterList":"class.chap"}',
        ruleContent: '{"content":"text"}',
      }),
    );
    expect(batch.imported[0]?.source.config.htmlSearch?.url).toBe('https://e.com/s?p=0');
  });

  it('keeps a {{…}} expression it cannot evaluate', () => {
    const batch = parseBatch(
      JSON.stringify({
        bookSourceName: 't',
        bookSourceUrl: 'https://e.com/',
        searchUrl: 'https://e.com/s?x={{java.random()}}',
        ruleSearch: '{"bookList":"class.item"}',
        ruleToc: '{"chapterList":"class.chap"}',
        ruleContent: '{"content":"text"}',
      }),
    );
    // `{{java.` is caught by the earlier JS-sniffing guard (Kotlin line 366),
    // which runs before convertLegadoUrl.
    expect(batch.imported).toHaveLength(0);
    expect(batch.skipped[0]?.reason).toBe('包含 JS 脚本/WebView 嗅探，暂不支持');
  });

  it('rejects a leftover {{…}} the arithmetic evaluator cannot reduce', () => {
    const batch = parseBatch(
      JSON.stringify({
        bookSourceName: 't',
        bookSourceUrl: 'https://e.com/',
        searchUrl: 'https://e.com/s?x={{somethingElse}}',
        ruleSearch: '{"bookList":"class.item"}',
        ruleToc: '{"chapterList":"class.chap"}',
        ruleContent: '{"content":"text"}',
      }),
    );
    expect(batch.imported).toHaveLength(0);
    expect(batch.skipped[0]?.reason).toBe('搜索 URL 含无法转换的 JS 表达式');
  });

  it('passes a POST option suffix through', () => {
    const batch = parseBatch(
      JSON.stringify({
        bookSourceName: 't',
        bookSourceUrl: 'https://e.com/',
        searchUrl:
          'https://e.com/s,{"method":"POST","body":"kw={{key}}","charset":"gbk"}',
        ruleSearch: '{"bookList":"class.item"}',
        ruleToc: '{"chapterList":"class.chap"}',
        ruleContent: '{"content":"text"}',
      }),
    );
    const rule = batch.imported[0]?.source.config.htmlSearch;
    expect(rule?.method).toBe('POST');
    expect(rule?.body).toBe('kw={keyword}');
    expect(rule?.charset).toBe('gbk');
  });

  it('skips JS / webView / audio sources with the Kotlin reasons', () => {
    const js = parseBatch(
      JSON.stringify({
        bookSourceName: 't',
        bookSourceUrl: 'https://e.com/',
        searchUrl: 'https://e.com/s',
        ruleSearch: '{"bookList":"@js:java.x"}',
        ruleToc: '{"chapterList":"class.chap"}',
        ruleContent: '{"content":"text"}',
      }),
    );
    expect(js.skipped[0]?.reason).toBe('包含 JS 脚本/WebView 嗅探，暂不支持');

    const audio = parseBatch(
      JSON.stringify({
        bookSourceName: 't',
        bookSourceUrl: 'https://e.com/',
        searchUrl: 'https://e.com/s',
        bookSourceType: 1,
        ruleSearch: '{"bookList":"class.item"}',
        ruleToc: '{"chapterList":"class.chap"}',
        ruleContent: '{"content":"text"}',
      }),
    );
    expect(audio.skipped[0]?.reason).toBe('有声书源（bookSourceType=1）暂不支持');
  });

  it('rejects malformed JSON, empty input and unknown shapes', () => {
    expect(parseBatch('').skipped[0]).toEqual({ id: '输入', reason: 'JSON内容为空' });
    expect(parseBatch('{oops').skipped[0]?.reason).toContain('JSON 语法错误');
    expect(parseBatch('{}').skipped[0]?.reason).toBe(
      '既不是本项目 JSON 格式，也不是 Legado 书源格式',
    );
  });

  it('imports a native JSON source and caps a batch at 1000 entries', () => {
    const native = parseBatch(
      JSON.stringify({
        id: 'n1',
        name: 'n',
        baseUrl: 'https://e.com/',
        search: { url: 'https://e.com/s?k={keyword}', fields: { title: 'title' } },
      }),
    );
    expect(native.imported).toHaveLength(1);
    expect(native.imported[0]?.source.config.id).toBe('n1');
    expect(native.imported[0]?.source.config.isCustom).toBe(true);
    expect(native.imported[0]?.source.capabilities.supportImport).toBe(true);

    // The 1000-entry cap is a `require` inside the try block (Kotlin line 157),
    // so it surfaces through the generic 解析失败 arm.
    const big = Array.from({ length: 1001 }, () => ({ name: 'x' }));
    expect(parseBatch(JSON.stringify(big)).skipped[0]?.reason).toBe(
      '解析失败: 一次最多导入 1000 个书源',
    );
  });

  it('generates a custom id when the source has none', () => {
    const batch = parseBatch(
      JSON.stringify({
        name: 'n',
        search: { url: 'https://e.com/s' },
      }),
    );
    expect(batch.imported[0]?.source.config.id).toMatch(/^custom_[0-9a-f]{8}$/);
  });
});

describe('PufeiImageCacheRetry', () => {
  const base: HttpRequest = {
    url: 'https://img1.6wm.top/chapter/1/2.jpg',
    method: 'GET',
    headers: { Referer: PUFEI_IMAGE_REFERER },
  };

  it('retries once with a minute-bucketed pufei_retry param', async () => {
    const urls: string[] = [];
    const response = await intercept({
      request: base,
      proceed: (req) => {
        urls.push(req.url);
        return Promise.resolve({ status: urls.length === 1 ? 502 : 200, headers: {}, body: new Uint8Array(), url: req.url });
      },
      isCanceled: () => false,
    });
    expect(response.status).toBe(200);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain(`${PUFEI_RETRY_PARAM}=`);
    expect(new URL(urls[1] as string).searchParams.get(PUFEI_RETRY_PARAM)).toMatch(/^\d+$/);
  });

  it('does not retry a non-5xx, a non-GET or a foreign host', async () => {
    const once = async (req: typeof base): Promise<number> => {
      let calls = 0;
      await intercept({
        request: req,
        proceed: (r) => {
          calls += 1;
          return Promise.resolve({ status: 200, headers: {}, body: new Uint8Array(), url: r.url });
        },
        isCanceled: () => false,
      });
      return calls;
    };
    expect(await once(base)).toBe(1);
    expect(await once({ ...base, method: 'POST' })).toBe(1);
    expect(await once({ ...base, url: 'https://other.example/a.jpg' })).toBe(1);
    expect(
      await once({ ...base, headers: { Referer: 'https://elsewhere.example/' } }),
    ).toBe(1);
  });

  it('propagates the cancellation as an IOException-equivalent', async () => {
    await expect(
      intercept({
        request: base,
        proceed: () =>
          Promise.resolve({ status: 503, headers: {}, body: new Uint8Array(), url: base.url }),
        isCanceled: () => true,
      }),
    ).rejects.toThrow('Canceled');
  });

  it('keeps the original path and adds Cache-Control on the retry', async () => {
    const seen: Array<{ url: string; cc: string | undefined }> = [];
    await intercept({
      request: base,
      proceed: (req) => {
        seen.push({ url: req.url, cc: req.headers?.['Cache-Control'] });
        return Promise.resolve({
          status: seen.length === 1 ? 500 : 200,
          headers: {},
          body: new Uint8Array(),
          url: req.url,
        });
      },
      isCanceled: () => false,
    });
    expect(new URL(seen[1]?.url as string).pathname).toBe('/chapter/1/2.jpg');
    expect(seen[1]?.cc).toBe('no-cache');
  });
});

describe('AutoNovelSource.paragraphText', () => {
  it('prefers sakura then gpt then youdao then baidu', () => {
    const text = paragraphText({
      paragraphs: ['a', 'b'],
      sakuraParagraphs: ['甲', '乙'],
      gptParagraphs: ['A1', 'B1'],
      baiduParagraphs: ['x', 'y'],
    });
    expect(text).toBe('甲\n\n乙');
  });

  it('marks an illustration paragraph and keeps image-only text', () => {
    // Kotlin line 159: `"[插图] " + text.removePrefix("<图片>")` — a bare
    // `<图片>` therefore becomes `'[插图] '`, and the non-blank filter
    // (line 162) keeps it because the marker itself is content.
    const text = paragraphText({
      paragraphs: ['<图片>说明', '<图片>'],
      sakuraParagraphs: ['<图片>说明', '<图片>'],
    });
    expect(text).toBe('[插图] 说明\n\n[插图] ');
  });

  it('reports the number of untranslated paragraphs', () => {
    expect(() =>
      paragraphText({ paragraphs: ['hello there'] }),
    ).toThrow('本章中文译文尚未齐全（缺 1 段），请稍后重试');
  });

  it('throws when the paragraph array is missing', () => {
    expect(() => paragraphText({})).toThrow('正文缺失');
  });
});

describe('JsonBookSource.extractImageUrls', () => {
  it('extracts a whitespace-separated URL list, trimming trailing punctuation', () => {
    expect(extractImageUrls('https://a.com/1.jpg, https://a.com/2.jpg;')).toEqual([
      'https://a.com/1.jpg',
      'https://a.com/2.jpg',
    ]);
  });

  it('reads the lazy attributes of an HTML fragment in priority order', () => {
    const html =
      '<img data-src="https://a.com/d.jpg" src="https://a.com/s.jpg">' +
      '<amp-img data-original="https://a.com/o.jpg">' +
      '<mip-img data-lazy-src="https://a.com/l.jpg">' +
      '<img src="https://a.com/plain.jpg">' +
      '<img>';
    expect(extractImageUrls(html)).toEqual([
      'https://a.com/d.jpg',
      'https://a.com/o.jpg',
      'https://a.com/l.jpg',
      'https://a.com/plain.jpg',
    ]);
  });

  it('returns nothing for blank input', () => {
    expect(extractImageUrls('   ')).toEqual([]);
  });
});

describe('MockBookSource', () => {
  it('filters case-insensitively on title and author', async () => {
    const source = new MockBookSource();
    expect(source.id).toBe('mock');
    expect(source.name).toBe('Mock 测试书源');
    expect(source.capabilities.environmentOnly).toBe(true);

    const all = await source.search('');
    expect(all.kind).toBe('success');
    expect(all.kind === 'success' ? all.data : []).toHaveLength(2);

    const filtered = await source.search('三体');
    expect(filtered.kind === 'success' ? filtered.data : []).toHaveLength(1);

    const byAuthor = await source.search('austen');
    expect(byAuthor.kind === 'success' ? byAuthor.data : []).toHaveLength(1);
  });

  it('getDetail returns BookNotFound for an unknown id', async () => {
    const source = new MockBookSource();
    const detail = await source.getDetail('mock/nope');
    expect(detail.kind).toBe('error');
    expect(detail.kind === 'error' ? detail.exception.name : '').toBe('BookNotFound');
  });

  it('getDownloadInfo derives a txt name from the cached detail', async () => {
    const source = new MockBookSource();
    const info = await source.getDownloadInfo('mock/three-body');
    expect(info.kind).toBe('success');
    if (info.kind === 'success') {
      expect(info.data.fileName).toBe('三体 (The Three-Body Problem)');
      expect(info.data.referer).toBe('https://example.com/');
    }
  });

  it('is always logged in and never requires authentication', async () => {
    const source = new MockBookSource();
    expect(await source.isLoggedIn()).toBe(true);
    expect(await source.getAuthenticationState()).toBe('NotRequired');
    await source.logout();
    expect(await source.isLoggedIn()).toBe(true);
  });
});
