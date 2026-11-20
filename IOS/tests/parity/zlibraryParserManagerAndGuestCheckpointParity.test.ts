/**
 * zlibraryParserManagerAndGuestCheckpointParity.test.ts
 *   ├ `source/zlibrary/parser/ZLibraryParserManager.kt`（**77 行**）→
 *   │   `@core/source/zlibrary/parser/zLibraryParserManager`
 *   └ `download/GuestNovelCheckpoint.kt`（85 行）→ `@core/download/guestNovelCheckpoint`
 *
 * 本轮实测到的偏差（E213）：
 *
 * ① `ZLibraryParserManager` 的端口自述「67 lines, 53 non-blank」（旧版原文行数），
 *    据此写成，于是 **L33-41 的两条隐藏元素移除整段缺失** —— 而那是原文里唯一
 *    「在选 parser 之前清洗 DOM」的步骤。少了它，镜像站插入的隐藏 decoy 卡片会被
 *    `GenericFallbackParser` 从 `/book/` 链接里当成真实结果捞回来，用户会看到一条
 *    「书名就是自己刚搜的关键词、下载地址为空」的假书。
 * ② `GuestNovelCheckpoint` 的端口结构上做了拆分（构造子不做事，`initialize()` 显式调用），
 *    并加了四处**原文没有的**防护（读上限 / 写上限 / mime↔扩展名 / 恢复数钳位）与一处
 *    范围收窄（清空只删白名单文件名，而 Kotlin 是 `deleteRecursively()`）。这些属于
 *    有意偏差，本轮逐条钉成「Kotlin 行为 → 端口行为」，不假装等价。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HIDDEN_STYLE_PATTERN,
  ZLibraryParserManager,
  stripHiddenDecoys,
} from '@core/source/zlibrary/parser/zLibraryParserManager';
import { parseHtmlDocument } from '@core/source/zlibrary/parser/htmlDocument';
import {
  GuestNovelCheckpoint,
  clearGuestNovelCheckpoint,
  digestHex,
} from '@core/download/guestNovelCheckpoint';
import type { ComicChapter } from '@core/source/comicChapter';
import type { NovelPart } from '@core/source/impl/novelParts';
import type { FileSystemApi } from '@platform/interfaces';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const PARSER_KT = 'source/zlibrary/parser/ZLibraryParserManager.kt';
const CHECKPOINT_KT = 'download/GuestNovelCheckpoint.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① ZLibraryParserManager.kt L11-27 常量与 detectLayoutName
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ZLibraryParserManager.kt L11-27 五个 parser 与 detectLayoutName', () => {
  const src = kt(PARSER_KT);

  it('L13 TAG 逐字，且 `Log.i` 的三条日志都带它', () => {
    expect(src).toContain('private const val TAG = "ZLibraryParserManager"');
    expect(src).toContain('Log.i(TAG, "Selected search parser: ${selectedParser.name}")');
    expect(src).toContain('Log.i(TAG, "Parsed ${results.size} books using ${selectedParser.name}")');
    expect(src).toContain('Log.i(TAG, "Selected detail parser: ${selectedParser.name}")');
  });

  it('L15-21 parser 列表**恰好五个**，顺序即优先级', () => {
    expect(src).toContain('private val parsers: List<ZLibraryLayoutParser> = listOf(');
    // 切到 `detectLayoutName` 之前，避免把后面的 `GenericFallbackParser()` 兜底调用数进来
    const block = src.slice(src.indexOf('private val parsers'), src.indexOf('fun detectLayoutName'));
    const names = [...block.matchAll(/(\w+LayoutParser|GenericFallbackParser)\(\)/g)].map((m) => m[1]);
    expect(names).toEqual([
      'BookcardLayoutParser',
      'DesktopLayoutParser',
      'MobileLayoutParser',
      'LegacyLayoutParser',
      'GenericFallbackParser',
    ]);
  });

  it('L23-27 `detectLayoutName` 命中就返回名字，落空回落 `"Unknown / Default"`', () => {
    expect(src).toContain('val selectedParser = parsers.firstOrNull { it.canParseSearch(doc) }');
    expect(src).toContain('return selectedParser?.name ?: "Unknown / Default"');
    // 空文档 → 谁都不认 → 回落串（逐字含空格与斜杠）
    expect(ZLibraryParserManager.detectLayoutName('<html><body></body></html>')).toBe('Unknown / Default');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② ZLibraryParserManager.kt L29-55 parseSearchPage 的隐藏 decoy 清洗
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ZLibraryParserManager.kt L33-41 隐藏 decoy 必须在选 parser 之前摘掉', () => {
  const src = kt(PARSER_KT);

  it('L33-36 注释逐字（说明了为什么必须在选 parser 之前）', () => {
    expect(src).toContain('// Some mirrors insert an explicitly hidden bookcard reflecting the query,');
    expect(src).toContain('// with a random id/format and an empty download endpoint. It is not a visible');
    expect(src).toContain('// search result. Remove hidden subtrees before layout selection so the generic');
    expect(src).toContain('// fallback cannot reintroduce the same decoy via its /book/ link.');
  });

  it('L37 先摘 `[hidden], [aria-hidden=true]` 整棵子树', () => {
    expect(src).toContain('doc.select("[hidden], [aria-hidden=true]").remove()');
  });

  it('L38-41 再摘 `[style]` 里 `display:none` / `visibility:hidden` 的', () => {
    expect(src).toContain('doc.select("[style]").filter { element ->');
    expect(src).toContain(
      'Regex("(?:^|;)\\\\s*(?:display\\\\s*:\\\\s*none|visibility\\\\s*:\\\\s*hidden)\\\\s*(?:!important)?\\\\s*(?:;|$)",',
    );
    expect(src).toContain('RegexOption.IGNORE_CASE).containsMatchIn(element.attr("style"))');
    expect(src).toContain('}.forEach { it.remove() }');
  });

  it('端口：两条移除按顺序都在 `PARSERS.find` **之前**', () => {
    const ts = repoText('src/core/source/zlibrary/parser/zLibraryParserManager.ts');
    const hidden = ts.indexOf("doc.select('[hidden], [aria-hidden=true]')");
    const style = ts.indexOf("doc.select('[style]')");
    const select = ts.indexOf('PARSERS.find((it) => it.canParseSearch(doc))', ts.indexOf('parseSearchPage'));
    expect(hidden).toBeGreaterThan(0);
    expect(style).toBeGreaterThan(hidden);
    expect(select).toBeGreaterThan(style);
  });

  it('`stripHiddenDecoys` 真的摘掉 `[hidden]` 与 `[aria-hidden=true]`', () => {
    const doc = parseHtmlDocument(`
      <html><body>
        <div class="book-item" hidden><a href="/book/1">decoy-1</a></div>
        <div class="book-item" aria-hidden="true"><a href="/book/2">decoy-2</a></div>
        <div class="book-item" aria-hidden="false"><a href="/book/3">real-3</a></div>
        <div class="book-item"><a href="/book/4">real-4</a></div>
      </body></html>`);
    expect(doc.select('[hidden]')).toHaveLength(1);
    stripHiddenDecoys(doc);
    expect(doc.select('[hidden]')).toHaveLength(0);
    expect(doc.select('[aria-hidden=true]')).toHaveLength(0);
    const remaining = doc.select('[href]').map((el) => el.text());
    expect(remaining).toEqual(['real-3', 'real-4']);
  });

  it('`stripHiddenDecoys` 摘掉 `style` 里隐藏的那些', () => {
    const doc = parseHtmlDocument(`
      <html><body>
        <div href="/a" style="display:none">a</div>
        <div href="/b" style="display: none !important">b</div>
        <div href="/c" style="color:red;visibility:hidden">c</div>
        <div href="/d" style="DISPLAY: NONE">d</div>
        <div href="/e" style="display:block">e</div>
        <div href="/f">f</div>
      </body></html>`);
    stripHiddenDecoys(doc);
    expect(doc.select('[style]').map((el) => el.text())).toEqual(['e']);
    expect(doc.select('[href]').map((el) => el.text())).toEqual(['e', 'f']);
  });

  it('`HIDDEN_STYLE_PATTERN` 三处细节：`(?:^|;)` 锚定、`!important` 可选、冒号两侧空白', () => {
    // 必须
    expect(HIDDEN_STYLE_PATTERN.test('display:none')).toBe(true);
    expect(HIDDEN_STYLE_PATTERN.test('display: none')).toBe(true);
    expect(HIDDEN_STYLE_PATTERN.test('display:  none  ')).toBe(true);
    expect(HIDDEN_STYLE_PATTERN.test('display:none!important')).toBe(true);
    expect(HIDDEN_STYLE_PATTERN.test('display: none !important')).toBe(true);
    expect(HIDDEN_STYLE_PATTERN.test('visibility:hidden')).toBe(true);
    expect(HIDDEN_STYLE_PATTERN.test('visibility: hidden !important')).toBe(true);
    expect(HIDDEN_STYLE_PATTERN.test('color:red;display:none')).toBe(true);
    expect(HIDDEN_STYLE_PATTERN.test('display:none;color:red')).toBe(true);
    // `(?:^|;)` 是必需的：前面不是分号/开头就不算
    expect(HIDDEN_STYLE_PATTERN.test('xdisplay:none')).toBe(false);
    expect(HIDDEN_STYLE_PATTERN.test('--my-display:none')).toBe(false);
    // 非隐藏值
    expect(HIDDEN_STYLE_PATTERN.test('display:block')).toBe(false);
    expect(HIDDEN_STYLE_PATTERN.test('display:flex')).toBe(false);
    expect(HIDDEN_STYLE_PATTERN.test('visibility:visible')).toBe(false);
    expect(HIDDEN_STYLE_PATTERN.test('')).toBe(false);
  });

  it('L43-44 选中的 parser 落空时用 `parsers.last()`（GenericFallback）', () => {
    expect(src).toContain('val selectedParser = parsers.firstOrNull { it.canParseSearch(doc) }');
    expect(src).toContain('?: parsers.last()');
    expect(repoText('src/core/source/zlibrary/parser/zLibraryParserManager.ts')).toContain(
      '?? (PARSERS[PARSERS.length - 1] as ZLibraryLayoutParser)',
    );
  });

  it('L50-53 选中的 parser 返回 0 条且它不是 GenericFallback 时再跑一遍 fallback', () => {
    expect(src).toContain('if (results.isEmpty() && selectedParser !is GenericFallbackParser) {');
    expect(src).toContain('return GenericFallbackParser().parseSearch(doc, baseUrl, sourceId)');
    // 端口用 name 做身份比较，且那个字面量在 Kotlin 侧就是 `"GenericFallback"`
    const fallbackKt = kt('source/zlibrary/parser/GenericFallbackParser.kt');
    expect(fallbackKt).toContain('override val name: String = "GenericFallback"');
    expect(repoText('src/core/source/zlibrary/parser/zLibraryParserManager.ts')).toContain(
      "const GENERIC_FALLBACK_NAME = 'GenericFallback';",
    );
  });

  it('L57-67 `parseDetailPage` **没有** L37-41 的两条移除（原文只在搜索页做）', () => {
    const searchAt = src.indexOf('fun parseSearchPage');
    const detailAt = src.indexOf('fun parseDetailPage');
    expect(searchAt).toBeGreaterThan(0);
    expect(detailAt).toBeGreaterThan(searchAt);
    const searchBody = src.slice(searchAt, detailAt);
    const detailBody = src.slice(detailAt, src.indexOf('private fun fakeResponse'));
    expect(searchBody).toContain('doc.select("[hidden], [aria-hidden=true]").remove()');
    expect(detailBody).not.toContain('doc.select(');
    expect(detailBody).toContain('val selectedParser = parsers.firstOrNull { it.canParseDetail(doc) }');
    // 端口：`stripHiddenDecoys(doc)` 只出现一次（= 搜索页那一处调用），详情页没有
    const ts = repoText('src/core/source/zlibrary/parser/zLibraryParserManager.ts');
    expect((ts.match(/stripHiddenDecoys\(doc\)/g) ?? []).length).toBe(1);
    // 从**方法定义**切（头注释的映射表里也提到 parseDetailPage，不能拿它当边界）
    const tsDetail = ts.slice(ts.indexOf('  parseDetailPage(html: string'));
    expect(tsDetail.length).toBeGreaterThan(100);
    expect(tsDetail).not.toContain('stripHiddenDecoys');
  });

  it('L69-76 `fakeResponse()` 三个值：200 / HTTP_1_1 / "OK"', () => {
    expect(src).toContain('.protocol(okhttp3.Protocol.HTTP_1_1)');
    expect(src).toContain('.code(200)');
    expect(src).toContain('.message("OK")');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ GuestNovelCheckpoint.kt L12-28 身份文件与已完章数
   ══════════════════════════════════════════════════════════════════════════════ */

interface MemoryFs extends FileSystemApi {
  readonly files: Map<string, Uint8Array>;
  readonly dirs: Set<string>;
}

function memoryFs(): MemoryFs {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(['files']);
  return {
    files,
    dirs,
    async readFile(p: string) {
      const value = files.get(p);
      if (value === undefined) throw new Error(`ENOENT ${p}`);
      return value;
    },
    async writeFile(p: string, data: Uint8Array) {
      files.set(p, data);
    },
    async exists(p: string) {
      return files.has(p) || dirs.has(p);
    },
    async delete(p: string) {
      dirs.delete(p);
      files.delete(p);
    },
    async list(p: string) {
      const prefix = `${p}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest.includes('/')) names.add(rest);
      }
      return [...names];
    },
  };
}

const chapter = (id: string, title: string): ComicChapter => ({
  id,
  title,
  volume: null,
  order: 0,
  external: false,
  externalUrl: null,
});

const TOC = [chapter('c1', '第一章'), chapter('c2', '第二章')];
const TARGET = 'files/downloads/book.epub';

describe('GuestNovelCheckpoint.kt L12-28 目标目录与身份文件', () => {
  const src = kt(CHECKPOINT_KT);

  it('L12 注释「Durable chapter boundaries, separate from the incomplete EPUB which is never imported.」', () => {
    expect(src).toContain(
      '/** Durable chapter boundaries, separate from the incomplete EPUB which is never imported. */',
    );
  });

  it('L73 `File(target.parentFile, "${target.nameWithoutExtension}.chapters")` —— 同目录、去扩展名', () => {
    expect(src).toContain('private fun directory(target: File) = File(target.parentFile, "${target.nameWithoutExtension}.chapters")');
    const fs = memoryFs();
    const checkpoint = new GuestNovelCheckpoint(fs, TARGET);
    return checkpoint.initialize(TARGET, 'src-1', 'https://x/book', TOC).then(() => {
      // `book.epub` → `book.chapters`
      expect([...fs.files.keys()].every((p) => p.startsWith('files/downloads/book.chapters/'))).toBe(true);
      expect([...fs.files.keys()]).toContain('files/downloads/book.chapters/identity');
    });
  });

  it('L17-18 身份 JSON 四个键且 toc 是 `[[id, title], …]`', async () => {
    expect(src).toContain('val identity = JSONObject().put("version", 1).put("sourceId", sourceId).put("url", downloadUrl)');
    expect(src).toContain('.put("toc", JSONArray().apply { toc.forEach { put(JSONArray().put(it.id).put(it.title)) } }).toString()');
    const fs = memoryFs();
    const checkpoint = new GuestNovelCheckpoint(fs, TARGET);
    await checkpoint.initialize(TARGET, 'src-1', 'https://x/book', TOC);
    const identity = new TextDecoder().decode(fs.files.get('files/downloads/book.chapters/identity')!);
    expect(identity).toBe(
      JSON.stringify({
        version: 1,
        sourceId: 'src-1',
        url: 'https://x/book',
        toc: [
          ['c1', '第一章'],
          ['c2', '第二章'],
        ],
      }),
    );
  });

  it('L20-24 身份不一致 → 清空重建；一致 → 保留已完章数', async () => {
    expect(src).toContain('if (read(manifest)?.toString(Charsets.UTF_8) != identity) {');
    expect(src).toContain('clear(target)');
    expect(src).toContain('check(directory.mkdirs() || directory.isDirectory) { "无法创建小说下载断点" }');
    expect(src).toContain('write(manifest, identity.toByteArray(Charsets.UTF_8))');

    const fs = memoryFs();
    const first = new GuestNovelCheckpoint(fs, TARGET);
    expect(await first.initialize(TARGET, 'src-1', 'https://x/book', TOC)).toBe(0);
    await first.saveChapter(0, [{ kind: 'text', value: '正文' }]);
    await first.saveChapter(1, [{ kind: 'text', value: '正文二' }]);

    // 同一身份 → 恢复出 2 章
    const again = new GuestNovelCheckpoint(fs, TARGET);
    expect(await again.initialize(TARGET, 'src-1', 'https://x/book', TOC)).toBe(2);

    // 目录变了 → 清空重来（旧章文件不该残留）
    const changed = new GuestNovelCheckpoint(fs, TARGET);
    expect(await changed.initialize(TARGET, 'src-1', 'https://x/book', [chapter('c9', '新章')])).toBe(0);
    expect([...fs.files.keys()].filter((p) => /chapter\d+\.json$/.test(p))).toEqual([]);
  });

  it('§L28 `chapter[0-9]+\\.json` 是「已完章」的判据（`listFiles().count { matches }`）', () => {
    expect(src).toContain('get() = directory.listFiles()?.count { it.name.matches(Regex("chapter[0-9]+\\\\.json")) } ?: 0');
    // 端口：`initialize` 返回的计数用同一个正则
    const ts = repoText('src/core/download/guestNovelCheckpoint.ts');
    expect(ts).toContain('/^chapter\\d+\\.json$/');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ GuestNovelCheckpoint.kt L30-53 章节正文的存取与校验
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GuestNovelCheckpoint.kt L30-53 chapter / saveChapter', () => {
  const src = kt(CHECKPOINT_KT);

  it('L34 `require(record.getString("sha256") == hash(payload))` —— 摘要不符整章作废', () => {
    expect(src).toContain('require(record.getString("sha256") == hash(payload.toByteArray(Charsets.UTF_8)))');
  });

  it('L38-42 三种 `type`：`text` / `image` / 其它 `error("断点格式无效")`', () => {
    expect(src).toContain('"text" -> NovelPart.Text(row.getString("value"))');
    expect(src).toContain('"image" -> NovelPart.Image(row.getString("value"))');
    expect(src).toContain('else -> error("断点格式无效")');
  });

  it('L43 `.also(::validateParts)` —— 读出来之后仍要过一遍 parts 校验', () => {
    expect(src).toContain('}.also(::validateParts)');
    expect(src).toContain('fun chapter(index: Int): List<NovelPart>? = runCatching {');
  });

  it('往返：text / image 混合保序，`payload` 是**字符串化的 JSON 数组**', async () => {
    const fs = memoryFs();
    const checkpoint = new GuestNovelCheckpoint(fs, TARGET);
    await checkpoint.initialize(TARGET, 'src-1', 'https://x/book', TOC);
    const parts: NovelPart[] = [
      { kind: 'text', value: '第一段' },
      { kind: 'image', url: 'https://img/1.png' },
      { kind: 'text', value: '第二段' },
    ];
    await checkpoint.saveChapter(0, parts);
    const record = JSON.parse(
      new TextDecoder().decode(fs.files.get('files/downloads/book.chapters/chapter0.json')!),
    ) as { payload: string; sha256: string };
    expect(typeof record.payload).toBe('string');
    expect(JSON.parse(record.payload)).toEqual([
      { type: 'text', value: '第一段' },
      { type: 'image', value: 'https://img/1.png' },
      { type: 'text', value: '第二段' },
    ]);
    expect(record.sha256).toBe(await digestHex(new TextEncoder().encode(record.payload)));
    expect(await checkpoint.chapter(0)).toEqual(parts);
  });

  it('摘要被改坏 → `chapter()` 返回 null（不抛）', async () => {
    const fs = memoryFs();
    const checkpoint = new GuestNovelCheckpoint(fs, TARGET);
    await checkpoint.initialize(TARGET, 'src-1', 'https://x/book', TOC);
    await checkpoint.saveChapter(0, [{ kind: 'text', value: '正文' }]);
    const key = 'files/downloads/book.chapters/chapter0.json';
    const record = JSON.parse(new TextDecoder().decode(fs.files.get(key)!)) as Record<string, unknown>;
    fs.files.set(key, new TextEncoder().encode(JSON.stringify({ ...record, sha256: 'f'.repeat(64) })));
    expect(await checkpoint.chapter(0)).toBeNull();
  });

  it('未知 `type` → null；缺 `sha256` → null；文件不存在 → null', async () => {
    const fs = memoryFs();
    const checkpoint = new GuestNovelCheckpoint(fs, TARGET);
    await checkpoint.initialize(TARGET, 'src-1', 'https://x/book', TOC);
    const key = 'files/downloads/book.chapters/chapter0.json';
    const badPayload = JSON.stringify([{ type: 'video', value: 'x' }]);
    fs.files.set(
      key,
      new TextEncoder().encode(
        JSON.stringify({ payload: badPayload, sha256: await digestHex(new TextEncoder().encode(badPayload)) }),
      ),
    );
    expect(await checkpoint.chapter(0)).toBeNull();
    fs.files.set(key, new TextEncoder().encode(JSON.stringify({ payload: '[]' })));
    expect(await checkpoint.chapter(0)).toBeNull();
    // 空 parts 会让 validateParts 抛 → null
    const emptyPayload = '[]';
    fs.files.set(
      key,
      new TextEncoder().encode(
        JSON.stringify({ payload: emptyPayload, sha256: await digestHex(new TextEncoder().encode(emptyPayload)) }),
      ),
    );
    expect(await checkpoint.chapter(0)).toBeNull();
    expect(await checkpoint.chapter(7)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ GuestNovelCheckpoint.kt L55-70 插图缓存
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GuestNovelCheckpoint.kt L55-70 image / saveImage', () => {
  const src = kt(CHECKPOINT_KT);

  it('L58 / L66 键是 `hash(url)`，两个文件名 `<key>.json` 与 `<key>.image`', () => {
    expect(src).toContain('val key = hash(url.toByteArray(Charsets.UTF_8))');
    expect(src).toContain('JSONObject(requireNotNull(read(File(directory, "$key.json"))).toString(Charsets.UTF_8))');
    expect(src).toContain('val bytes = requireNotNull(read(File(directory, "$key.image")))');
  });

  it('L68-69 先写 `.image` 再写 `.json`（元数据最后落盘 ⇒ 半成品永远读不出来）', () => {
    expect(src).toContain('write(File(directory, "$key.image"), image.bytes)');
    expect(src).toContain('write(File(directory, "$key.json"), JSONObject().put("sha256", hash(image.bytes))');
    const imageAt = src.indexOf('write(File(directory, "$key.image"), image.bytes)');
    const jsonAt = src.indexOf('write(File(directory, "$key.json")');
    expect(jsonAt).toBeGreaterThan(imageAt);
  });

  it('往返：mime / extension / bytes 都能取回，文件名是 64 位十六进制', async () => {
    const fs = memoryFs();
    const checkpoint = new GuestNovelCheckpoint(fs, TARGET);
    await checkpoint.initialize(TARGET, 'src-1', 'https://x/book', TOC);
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const url = 'https://img/cover.png';
    const key = await digestHex(new TextEncoder().encode(url));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    await checkpoint.saveImage(url, { bytes, mime: 'image/png', extension: 'png', sha256: await digestHex(bytes) });
    const keys = [...fs.files.keys()];
    expect(keys).toHaveLength(3);
    // 文件名是键（不是 URL），且 `.image` / `.json` 成对
    expect(keys).toContain('files/downloads/book.chapters/identity');
    expect(keys).toContain(`files/downloads/book.chapters/${key}.image`);
    expect(keys).toContain(`files/downloads/book.chapters/${key}.json`);
    const restored = await checkpoint.image(url);
    expect(restored?.bytes).toEqual(bytes);
    expect(restored?.mime).toBe('image/png');
    expect(restored?.extension).toBe('png');
    expect(restored?.sha256).toBe(await digestHex(bytes));
  });

  it('字节被改坏 → `image()` 返回 null（L61 的 sha256 比对）', async () => {
    const fs = memoryFs();
    const checkpoint = new GuestNovelCheckpoint(fs, TARGET);
    await checkpoint.initialize(TARGET, 'src-1', 'https://x/book', TOC);
    const bytes = new Uint8Array([1, 2, 3]);
    const url = 'https://img/a.png';
    const key = await digestHex(new TextEncoder().encode(url));
    await checkpoint.saveImage(url, { bytes, mime: 'image/png', extension: 'png', sha256: await digestHex(bytes) });
    fs.files.set(`files/downloads/book.chapters/${key}.image`, new Uint8Array([9, 9, 9]));
    expect(await checkpoint.image(url)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ GuestNovelCheckpoint.kt L72-84 companion：hash / read / write / clear
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GuestNovelCheckpoint.kt L72-84 companion 三个工具', () => {
  const src = kt(CHECKPOINT_KT);

  it('L75-76 `MessageDigest.getInstance("SHA-256")` + `"%02x".format(it)` ⇒ 64 位小写', () => {
    expect(src).toContain('private fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)');
    expect(src).toContain('.joinToString("") { "%02x".format(it) }');
  });

  it('`digestHex` 与标准 SHA-256 向量逐字一致（空串 / "abc"）', async () => {
    expect(await digestHex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await digestHex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await digestHex(new TextEncoder().encode('三体'))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('L77 `read` 用 `AtomicFile(file).openRead()`，失败返回 null', () => {
    expect(src).toContain('private fun read(file: File): ByteArray? = runCatching { AtomicFile(file).openRead().use { it.readBytes() } }.getOrNull()');
  });

  it('L78-83 `write` 三段：startWrite / finishWrite / failWrite+rethrow', () => {
    expect(src).toContain('val atomic = AtomicFile(file)');
    expect(src).toContain('val stream = atomic.startWrite()');
    expect(src).toContain('try { stream.write(bytes); atomic.finishWrite(stream) }');
    expect(src).toContain('catch (e: Exception) { atomic.failWrite(stream); throw e }');
  });

  it('L74 `clear(target) = directory(target).deleteRecursively()`', () => {
    expect(src).toContain('fun clear(target: File) { directory(target).deleteRecursively() }');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ 有意偏差（钉成「Kotlin → 端口」的对，不假装等价）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('GuestNovelCheckpoint 的五处有意偏差（E213 逐条登记）', () => {
  const src = kt(CHECKPOINT_KT);
  const ts = repoText('src/core/download/guestNovelCheckpoint.ts');

  it('① `clear`：Kotlin 整目录递归删；端口只删白名单文件名', async () => {
    expect(src).toContain('directory(target).deleteRecursively()');
    expect(ts).toContain('const safeName = /^(?:identity|chapter\\d+\\.json|[0-9a-f]{64}\\.(?:image|json))$/');
    const fs = memoryFs();
    const checkpoint = new GuestNovelCheckpoint(fs, TARGET);
    await checkpoint.initialize(TARGET, 'src-1', 'https://x/book', TOC);
    // 不在白名单里的文件：Kotlin 会一并删掉，端口留着
    fs.files.set('files/downloads/book.chapters/notes.txt', new TextEncoder().encode('x'));
    await clearGuestNovelCheckpoint(fs, TARGET);
    expect(await fs.exists('files/downloads/book.chapters/identity')).toBe(false);
    expect(await fs.exists('files/downloads/book.chapters/notes.txt')).toBe(true);
  });

  it('② `read`：Kotlin 无上限；端口 16 MiB（避免坏文件把内存打爆）', () => {
    expect(src).toContain('it.readBytes() } }.getOrNull()');
    expect(src).not.toContain('16 * 1024 * 1024');
    expect(ts).toContain('private async read(name: string, maximum = 16 * 1024 * 1024)');
  });

  it('③ `saveChapter`：Kotlin 无条件写；端口超 16 MiB 直接跳过（该章每次都重下）', () => {
    expect(src).toContain('write(File(directory, "chapter$index.json")');
    expect(src).not.toContain('if (data.length');
    expect(ts).toContain('if (data.length <= 16 * 1024 * 1024)');
  });

  it('④ `image()`：Kotlin 不看 mime↔扩展名；端口要求 `imageTypes[mime] === extension`', async () => {
    expect(src).toContain('Image(bytes, metadata.getString("mime"), metadata.getString("extension"))');
    expect(ts).toContain('if (!mime || !extension || !sha256 || imageTypes[mime] !== extension) return null;');
    const fs = memoryFs();
    const checkpoint = new GuestNovelCheckpoint(fs, TARGET);
    await checkpoint.initialize(TARGET, 'src-1', 'https://x/book', TOC);
    const bytes = new Uint8Array([7]);
    const url = 'https://img/b.jpg';
    const key = await digestHex(new TextEncoder().encode(url));
    // mime 说 png、扩展名说 jpg → 端口拒；Kotlin 会照样返回
    await checkpoint.saveImage(url, { bytes, mime: 'image/png', extension: 'jpg', sha256: await digestHex(bytes) });
    expect(await checkpoint.image(url)).toBeNull();
    expect(await fs.exists(`files/downloads/book.chapters/${key}.image`)).toBe(true);
  });

  it('⑤ `initialize`：Kotlin 的 `completedChapters` 是裸计数；端口钳到 `toc.length`', () => {
    expect(src).toContain('get() = directory.listFiles()?.count { it.name.matches(Regex("chapter[0-9]+\\\\.json")) } ?: 0');
    expect(ts).toContain('Math.min(toc.length, (await this.fs.list(this.root)).filter((name) => /^chapter\\d+\\.json$/.test(name)).length)');
  });

  it('六、构造形态：Kotlin 在构造函数里做 init；端口拆成 `initialize()` 显式调用', () => {
    expect(src).toContain('internal class GuestNovelCheckpoint(target: File, sourceId: String, downloadUrl: String, toc: List<ComicChapter>) {');
    expect(src).toContain('init {');
    expect(ts).toContain('constructor(private readonly fs: FileSystemApi, target: string)');
    expect(ts).toContain('async initialize(target: string, sourceId: string, url: string, toc: readonly ComicChapter[])');
  });
});
