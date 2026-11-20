/**
 * keywordCacheAndRecordResolverParity.test.ts
 *   ├ `source/keyword/KeywordCache.kt`（82 行）→ `@core/source/keyword/keywordCache`
 *   └ `library/ReadingRecordResolver.kt`（81 行）→ `@core/library/libraryReadingRecords`
 *
 * 两个文件都有实现（`keywordCache.ts` 甚至已经按行号写过注释、`libraryReadingRecords.ts`
 * 还记着两处历史修复），缺的是**读 Kotlin 原文的测试**。
 *
 * 本轮要钉住的都是「数字与顺序」这类东西：
 *   · `KeywordCache` 的七个上限（128 KiB / version 1..3 / 16 个 concept / 64 个 name /
 *     160 字符 / 12 个 provider / 512 个文件）与 `"v1:"` 前缀 —— 少一个就是磁盘格式变了；
 *   · `ReadingRecordResolver` 的三级身份优先级（本地 → 缓存 → 收藏）与两个信号量（4 / 3）——
 *     顺序颠倒会让「本地已有的书」去走网络搜索。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { KeywordCache } from '@core/source/keyword/keywordCache';
import { query as keywordQuery } from '@core/source/keyword/keywordModels';
import {
  ReadingRecordResolver,
  type LibraryLocalBook,
  type LibraryReadingRecord,
  type LibraryRecordFavorite,
} from '@core/library/libraryReadingRecords';
import type { BookSource } from '@core/source/bookSource';
import { SourceResult } from '@core/source/sourceResult';
import { createSearchBook, type SearchBook } from '@core/source/searchBook';
import type { SourceSearchCoordinator } from '@core/library/librarySearchCoordinator';
import type { FileSystemApi } from '@platform/interfaces';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(rel, 'utf8');
}

const CACHE_KT = 'source/keyword/KeywordCache.kt';
const RESOLVER_KT = 'library/ReadingRecordResolver.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① KeywordCache.kt L14-19 文件名
   ══════════════════════════════════════════════════════════════════════════════ */

/** 最小的内存文件系统（只实现 `FileSystemApi` 里本模块用到的五个成员）。 */
class MemoryFs {
  readonly files = new Map<string, Uint8Array>();

  readonly deleted: string[] = [];

  async readFile(path: string): Promise<Uint8Array> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT ${path}`);
    return value;
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async delete(path: string): Promise<void> {
    this.deleted.push(path);
    this.files.delete(path);
  }

  async list(dir: string): Promise<string[]> {
    return [...this.files.keys()]
      .filter((key) => key.startsWith(`${dir}/`))
      .map((key) => key.slice(dir.length + 1));
  }
}

const fsOf = (memory: MemoryFs): FileSystemApi => memory as unknown as FileSystemApi;

const concept = (id: string, names: Array<{ text: string; language: string }>, source = 'anilist') => ({
  id,
  source,
  names,
});

describe('KeywordCache.kt L14-19 文件名 = SHA-256("v1:" + query(input))', () => {
  const src = kt(CACHE_KT);

  it('L16 前缀是 `"v1:"`，参与哈希的是**规范化后**的查询串', () => {
    expect(src).toContain('.digest(("v1:" + KeywordKeys.query(input)).toByteArray(Charsets.UTF_8))');
    expect(repoText('src/core/source/keyword/keywordCache.ts')).toContain('sha256Hex(`v1:${query(input)}`)');
  });

  it('同一输入写两次落到同一个文件；`<64 hex>.json`', async () => {
    const memory = new MemoryFs();
    const cache = new KeywordCache(fsOf(memory), 'kw', () => 1_000);
    await cache.write('三体', [concept('c1', [{ text: '三体', language: 'native' }])], 60_000);
    const first = [...memory.files.keys()];
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(/^kw\/[0-9a-f]{64}\.json$/);
    await cache.write('三体', [concept('c1', [{ text: '三体', language: 'native' }])], 60_000);
    expect([...memory.files.keys()]).toEqual(first);
    // 大小写/空白折叠后同键（`KeywordKeys.query`）
    expect(keywordQuery('  三体  ')).toBe(keywordQuery('三体'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② KeywordCache.kt L21-44 read 的七个上限
   ══════════════════════════════════════════════════════════════════════════════ */

describe('KeywordCache.kt L21-44 read 的边界', () => {
  const src = kt(CACHE_KT);

  it('L23 `length() > 128 * 1024` 直接放弃（不解析）', () => {
    expect(src).toContain('if (!target.isFile || target.length() > 128 * 1024) return null');
    expect(repoText('src/core/source/keyword/keywordCache.ts')).toContain('if (bytes.byteLength > 128 * 1024) return null;');
  });

  it('L26 `version !in 1..3` → null；L43 `fresh = version >= 3 && expires > now()`', () => {
    expect(src).toContain('if (version !in 1..3) return null');
    expect(src).toContain('Entry(concepts, version >= 3 && obj.getLong("expires") > now(), states)');
    expect(repoText('src/core/source/keyword/keywordCache.ts')).toContain(
      'fresh: version >= 3 && requireLong(obj, \'expires\') > this.now(),',
    );
  });

  it('L28 / L32 `require(rows.length() <= 16)`、`require(names.length() <= 64)`', () => {
    expect(src).toContain('require(rows.length() <= 16)');
    expect(src).toContain('require(names.length() <= 64)');
    expect(repoText('src/core/source/keyword/keywordCache.ts')).toContain('if (rows.length > 16) throw new Error(');
    expect(repoText('src/core/source/keyword/keywordCache.ts')).toContain('if (names.length > 64) throw new Error(');
  });

  it('L35 name 文本读时 `take(160)`、L39 provider 上限 `minOf(len, 12)`、只在 version >= 3 读', () => {
    expect(src).toContain('KeywordName(n.getString("text").take(160), n.getString("lang"))');
    expect(src).toContain('if (attempts == null || version < 3) emptyList() else (0 until minOf(attempts.length(), 12)).map { i ->');
    expect(src).toContain('KeywordProviderState(row.getString("id"), row.getString("outcome"), row.getLong("retryAt"), row.optString("detail"))');
  });

  it('L41 `getLong("retryAt")` 缺失即整条作废（E89 的核心）', async () => {
    const memory = new MemoryFs();
    const cache = new KeywordCache(fsOf(memory), 'kw', () => 1_000);
    await cache.write('x', [concept('c1', [{ text: 'abc', language: 'en' }])], 60_000, [
      { provider: 'anilist', outcome: 'ok', retryAt: 0, detail: '' },
    ]);
    const path = [...memory.files.keys()][0] as string;
    const parsed = JSON.parse(new TextDecoder().decode(memory.files.get(path)!)) as Record<string, unknown>;
    // 删掉 retryAt → 整条 cache 视为损坏
    const providers = parsed['providers'] as Array<Record<string, unknown>>;
    delete providers[0]?.['retryAt'];
    memory.files.set(path, new TextEncoder().encode(JSON.stringify(parsed)));
    expect(await cache.read('x')).toBeNull();
  });

  it('L43 `expires` 缺失同样整条作废', async () => {
    const memory = new MemoryFs();
    const cache = new KeywordCache(fsOf(memory), 'kw', () => 1_000);
    await cache.write('x', [concept('c1', [{ text: 'abc', language: 'en' }])], 60_000);
    const path = [...memory.files.keys()][0] as string;
    const parsed = JSON.parse(new TextDecoder().decode(memory.files.get(path)!)) as Record<string, unknown>;
    delete parsed['expires'];
    memory.files.set(path, new TextEncoder().encode(JSON.stringify(parsed)));
    expect(await cache.read('x')).toBeNull();
  });

  it('往返：`fresh` 随时间翻面、states 原样回来', async () => {
    const memory = new MemoryFs();
    const cache = new KeywordCache(fsOf(memory), 'kw', () => 1_000);
    await cache.write('x', [concept('c1', [{ text: 'abc', language: 'en' }])], 60_000, [
      { provider: 'anilist', outcome: 'ok', retryAt: 5, detail: 'd' },
    ]);
    const hit = await cache.read('x');
    expect(hit?.fresh).toBe(true);
    expect(hit?.concepts).toHaveLength(1);
    expect(hit?.states).toEqual([{ provider: 'anilist', outcome: 'ok', retryAt: 5, detail: 'd' }]);
    const later = new KeywordCache(fsOf(memory), 'kw', () => 1_000 + 60_001);
    expect((await later.read('x'))?.fresh).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ KeywordCache.kt L46-68 write 的上限与清理
   ══════════════════════════════════════════════════════════════════════════════ */

describe('KeywordCache.kt L46-68 write', () => {
  const src = kt(CACHE_KT);

  it('L50-57 写时 `take(16)` / `take(64)` / `take(160)` / `take(12)`', () => {
    expect(src).toContain('concepts.take(16).forEach { c ->');
    expect(src).toContain('c.names.take(64).forEach { n -> names.put(JSONObject().put("text", n.text.take(160)).put("lang", n.language)) }');
    expect(src).toContain('states.take(12).forEach { providers.put(JSONObject().put("id", it.provider)');
  });

  it('L58 `version = 3`、`expires = now() + ttlMs`', async () => {
    expect(src).toContain('JSONObject().put("version", 3).put("expires", now() + ttlMs).put("concepts", rows)');
    const memory = new MemoryFs();
    const cache = new KeywordCache(fsOf(memory), 'kw', () => 7_000);
    await cache.write('x', [concept('c1', [{ text: 'abc', language: 'en' }])], 1_000);
    const path = [...memory.files.keys()][0] as string;
    const parsed = JSON.parse(new TextDecoder().decode(memory.files.get(path)!)) as Record<string, unknown>;
    expect(parsed['version']).toBe(3);
    expect(parsed['expires']).toBe(8_000);
  });

  it('16 个 concept / 64 个 name 的截断真的生效', async () => {
    const memory = new MemoryFs();
    const cache = new KeywordCache(fsOf(memory), 'kw', () => 0);
    const many = Array.from({ length: 20 }, (_, i) =>
      concept(`c${i}`, Array.from({ length: 70 }, (_, j) => ({ text: `n${j}`, language: 'en' }))),
    );
    await cache.write('x', many, 1_000);
    const hit = await cache.read('x');
    expect(hit?.concepts).toHaveLength(16);
    expect(hit?.concepts[0]?.names).toHaveLength(64);
  });

  it('L65-67 清理：只留最近 512 个 `.json`（含过期条目）', () => {
    expect(src).toContain('directory.listFiles().orEmpty().filter { it.extension == "json" }');
    expect(src).toContain('.sortedByDescending { it.lastModified() }.drop(512).forEach { it.delete() }');
    const ts = repoText('src/core/source/keyword/keywordCache.ts');
    // `FileSystemApi` 没有 lastModified —— 端口按文件名序（内容哈希）保留 512 个，已在注释里登记
    expect(ts).toContain('listed.sort().slice(512)');
    expect(ts).toContain('Fixed bound, including stale entries; no growing archive of searched words.');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ KeywordCache.kt L70-81 writeAliases
   ══════════════════════════════════════════════════════════════════════════════ */

describe('KeywordCache.kt L70-81 writeAliases 的四个条件', () => {
  const src = kt(CACHE_KT);

  it('L72 只在 `concepts.size == 1` 时写', () => {
    expect(src).toContain('if (concepts.size != 1) return');
    const memory = new MemoryFs();
    const cache = new KeywordCache(fsOf(memory), 'kw', () => 0);
    return cache
      .writeAliases('orig', [concept('a', []), concept('b', [])], 1_000)
      .then(() => expect(memory.files.size).toBe(0));
  });

  it('L74 只认五种语言、文本长度 ≥ 4、每种语言只取首个', () => {
    expect(src).toContain('concept.names.filter { it.language in setOf("en", "ja", "native", "romaji", "latin") && it.text.length >= 4 }');
    expect(src).toContain('.distinctBy { it.language }.take(5).forEach { alias ->');
    const ts = repoText('src/core/source/keyword/keywordCache.ts');
    expect(ts).toContain("const allowed = new Set(['en', 'ja', 'native', 'romaji', 'latin']);");
    expect(ts).toContain('if (!allowed.has(name.language) || name.text.length < 4) continue;');
  });

  it('L76 别名与输入同键时跳过；L78 已有别的 id 时不覆盖', async () => {
    expect(src).toContain('if (KeywordKeys.query(alias.text) != KeywordKeys.query(input)) {');
    expect(src).toContain('if (existing == null || existing.concepts.all { it.id == concept.id }) write(alias.text, concepts, ttlMs)');
    const memory = new MemoryFs();
    const cache = new KeywordCache(fsOf(memory), 'kw', () => 0);
    // 自己的英文名 = 输入本身 → 不重复写
    await cache.writeAliases('c1', [concept('c1', [{ text: 'c1', language: 'en' }])], 1_000);
    expect(memory.files.size).toBe(0);
    // 另起一个英文别名 → 写一份
    await cache.writeAliases('orig', [concept('c1', [{ text: 'other-name', language: 'en' }])], 1_000);
    expect(memory.files.size).toBe(1);
    // 该别名已被**别的** concept 占着 → 不覆盖
    const before = [...memory.files.keys()];
    await cache.writeAliases('orig2', [concept('c2', [{ text: 'other-name', language: 'en' }])], 1_000);
    expect([...memory.files.keys()]).toEqual(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ ReadingRecordResolver.kt L22-23 两个信号量
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ReadingRecordResolver.kt L22-23 并发闸门', () => {
  const src = kt(RESOLVER_KT);

  it('`Semaphore(4)` 限请求、`Semaphore(3)` 限标题', () => {
    expect(src).toContain('private val requests = Semaphore(4)');
    expect(src).toContain('private val titles = Semaphore(3)');
    const ts = repoText('src/core/library/libraryReadingRecords.ts');
    expect(ts).toContain('private readonly requests = new Semaphore(4);');
    expect(ts).toContain('private readonly titles = new Semaphore(3);');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ ReadingRecordResolver.kt L25-51 三级身份优先级
   ══════════════════════════════════════════════════════════════════════════════ */

const localBook = (patch: Partial<LibraryLocalBook> = {}): LibraryLocalBook => ({
  id: 1,
  comicId: null,
  sourceId: 'src',
  title: '本地书名',
  author: '作者',
  coverUri: null,
  filePath: null,
  ...patch,
});

const record = (patch: Partial<LibraryReadingRecord> = {}): LibraryReadingRecord => ({
  id: 1,
  bookTitle: '书',
  bookId: null,
  ...patch,
});

/** 一个永远不该被调用的协调器（用于证明「本地命中不走网络」）。 */
function forbiddenCoordinator(): SourceSearchCoordinator {
  return {
    search: () => {
      throw new Error('search must not run for locally resolved records');
    },
  } as unknown as SourceSearchCoordinator;
}

describe('ReadingRecordResolver.kt L30-44 本地 → 缓存 → 收藏', () => {
  const src = kt(RESOLVER_KT);

  it('L35-38 本地命中优先，`id = comicId ?: "local:${id}"`、`sourceId.orEmpty()`', async () => {
    expect(src).toContain('id = it.comicId ?: "local:${it.id}", sourceId = it.sourceId.orEmpty(),');
    expect(src).toContain('title = it.title, author = it.author, cover = it.coverUri');
    const published: Array<[number, SearchBook]> = [];
    const resolver = new ReadingRecordResolver(forbiddenCoordinator());
    await resolver.resolve(
      [record({ id: 9, bookId: 3 })],
      [localBook({ id: 3, comicId: null, sourceId: null, title: 'T', author: 'A', coverUri: 'file://c' })],
      [],
      [],
      () => {
        throw new Error('cached must not run when local hits');
      },
      (r, b) => published.push([r.id, b]),
    );
    expect(published).toHaveLength(1);
    expect(published[0]?.[1]).toMatchObject({ id: 'local:3', sourceId: '', title: 'T', author: 'A', cover: 'file://c' });
  });

  it('L38 `cached(record)` 第二优先级（本地未命中时才问）', async () => {
    expect(src).toContain('} ?: cached(record) ?: favorite?.let { SearchBook(');
    const published: SearchBook[] = [];
    const resolver = new ReadingRecordResolver(forbiddenCoordinator());
    await resolver.resolve(
      [record({ id: 1, bookId: null, bookTitle: 'x' })],
      [],
      [],
      [],
      (r) => createSearchBook({ id: 'cached-id', sourceId: 's', title: r.bookTitle, author: 'a' }),
      (_r, b) => published.push(b),
    );
    expect(published.map((b) => b.id)).toEqual(['cached-id']);
  });

  it('L33-34 收藏要 `title == bookTitle` 且按 `(sourceId, comicId)` 去重后**恰好剩一个**', async () => {
    expect(src).toContain('val favorite = favorites.filter { it.title == record.bookTitle }');
    expect(src).toContain('.distinctBy { it.sourceId to it.comicId }.singleOrNull()');
    // `LibraryRecordFavorite.comicId` 在这一层是 string（Kotlin `FavoriteEntity.comicId: String`）
    const make = (comicId: string): LibraryRecordFavorite => ({
      sourceId: 's',
      comicId,
      title: 'x',
      author: 'a',
      localThumbPath: null,
      coverUrl: `https://c/${comicId}`,
    });
    // 两个**不同** comicId → 有歧义 → 不命中（走搜索）
    const ambiguous: SearchBook[] = [];
    const coordinator = { search: async () => SourceResult.Success([]) } as unknown as SourceSearchCoordinator;
    const resolver = new ReadingRecordResolver(coordinator);
    await resolver.resolve(
      [record({ id: 1, bookTitle: 'x' })],
      [],
      [make('c1'), make('c2')],
      [],
      () => null,
      (_r, b) => ambiguous.push(b),
    );
    expect(ambiguous).toEqual([]);
    // 同一个 comicId 出现两次（去重后只剩一个）→ 命中
    const single: SearchBook[] = [];
    const resolver2 = new ReadingRecordResolver(coordinator);
    await resolver2.resolve(
      [record({ id: 1, bookTitle: 'x' })],
      [],
      [make('c1'), make('c1')],
      [],
      () => null,
      (_r, b) => single.push(b),
    );
    expect(single.map((b) => b.id)).toEqual(['c1']);
    expect(single[0]?.cover).toBe('https://c/c1');
  });

  it('L45-49 未命中的按 `bookTitle` 分组，每组只搜一次、命中后整组 publish', async () => {
    expect(src).toContain('remaining.groupBy { it.bookTitle }.map { (title, group) -> async {');
    expect(src).toContain('search(title, sources)?.let { found -> group.forEach { publish(it, found) } }');
    let calls = 0;
    const coordinator = {
      search: async (_source: BookSource, title: string) => {
        calls += 1;
        return SourceResult.Success([createSearchBook({ id: `hit-${title}`, sourceId: 's', title, author: 'a' })]);
      },
    } as unknown as SourceSearchCoordinator;
    const published: Array<[number, string]> = [];
    const resolver = new ReadingRecordResolver(coordinator);
    const source = { id: 's' } as unknown as BookSource;
    await resolver.resolve(
      [record({ id: 1, bookTitle: 'Same' }), record({ id: 2, bookTitle: 'Same' })],
      [],
      [],
      [source],
      () => null,
      (r, b) => published.push([r.id, b.id]),
    );
    expect(calls).toBe(1);
    expect(published).toEqual([
      [1, 'hit-Same'],
      [2, 'hit-Same'],
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ ReadingRecordResolver.kt L53-80 search
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ReadingRecordResolver.kt L53-80 search', () => {
  const src = kt(RESOLVER_KT);

  it('L53 `normalized` = `TitleNormalizer.normalize` + 只留字母与数字（`\\p{Nd}`）', () => {
    expect(src).toContain('private fun normalized(title: String) = TitleNormalizer.normalize(title).filter { it.isLetterOrDigit() }');
    const ts = repoText('src/core/library/libraryReadingRecords.ts');
    expect(ts).toContain('/\\p{L}|\\p{Nd}/u.test(ch)');
    // 上标 ² 属于 `No`，不算 digit —— 留在里面会让标题匹配不上
    expect(ts).not.toContain('\\p{N}/u.test(ch)');
  });

  it('L57 归一化后为空、或没有书源 → null', async () => {
    expect(src).toContain('if (wanted.isBlank() || sources.isEmpty()) return@coroutineScope null');
    const resolver = new ReadingRecordResolver(forbiddenCoordinator());
    expect(await resolver.search('   ', [])).toBeNull();
    expect(await resolver.search('书', [])).toBeNull();
  });

  it('L62 `withTimeoutOrNull(8_000)`；L63 只收 `Success` 且标题归一化后相等', async () => {
    expect(src).toContain('val reply = withTimeoutOrNull(8_000) { searches.search(source, title) }');
    expect(src).toContain('(reply as? SourceResult.Success)?.data?.firstOrNull { normalized(it.title) == wanted }');
    const seen: string[] = [];
    const coordinator = {
      search: async (_s: BookSource, title: string) => {
        seen.push(title);
        return SourceResult.Success([
          createSearchBook({ id: 'wrong', sourceId: 's', title: '完全不同的书名', author: 'a' }),
          createSearchBook({ id: 'right', sourceId: 's', title: `《${title}》`, author: 'a' }),
        ]);
      },
    } as unknown as SourceSearchCoordinator;
    const resolver = new ReadingRecordResolver(coordinator);
    const hit = await resolver.search('三体', [{ id: 's' } as unknown as BookSource]);
    expect(seen).toEqual(['三体']);
    // 归一化会掉标点，`《三体》` 与 `三体` 同键
    expect(hit?.id).toBe('right');
  });

  it('L72 结果 id 用 `comicId?.takeIf { it.isNotBlank() } ?: id`', async () => {
    expect(src).toContain('found.copy(id = found.comicId?.takeIf { it.isNotBlank() } ?: found.id)');
    const coordinator = {
      search: async () =>
        SourceResult.Success([
          createSearchBook({ id: 'plain', sourceId: 's', title: '书', author: 'a', comicId: '  ' }),
        ]),
    } as unknown as SourceSearchCoordinator;
    const resolver = new ReadingRecordResolver(coordinator);
    // comicId 是纯空白 → 仍用 id
    expect((await resolver.search('书', [{ id: 's' } as unknown as BookSource]))?.id).toBe('plain');
  });
});
