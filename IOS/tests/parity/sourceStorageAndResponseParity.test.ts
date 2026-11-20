/**
 * sourceStorageAndResponseParity.test.ts
 *   ├ `source/storage/SourceStorage.kt`（11 行，7 个 suspend 方法）→ `@core/source/storage/sourceStorage`
 *   └ `source/SourceResponse.kt`（77 行）→ `@core/source/sourceText`
 *
 * `SourceStorage.kt` 是纯接口 —— 要钉的是「七个方法一个不多一个不少」，
 * 以及端口多出来的 `knownIds?` 必须是**可选**（Kotlin 调用方无参调用要能编过）。
 *
 * `SourceResponse.kt` 则相反：端口的 `sourceResponseText` 原来只是「看 content-type 的 charset，
 * 否则 UTF-8」，把 Kotlin 的**六个分支**压成了两个 ——
 * UTF-16 两个 BOM、HTML `<meta charset=gbk>` 嗅探、认不出的编码名回落、
 * 严格解码失败后整体按 GB18030 再解、以及解码后再 `removePrefix("\uFEFF")`。
 * `problem` / `jsonRoot` / `jsonObject` 三件更是一行都没有（E202）。
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ParseError } from '@core/source/sourceException';
import {
  CHARSET_SNIFF_PREFIX_BYTES,
  PROBLEM_SAMPLE_CHARS,
  SOURCE_CHALLENGE_MESSAGE,
  SOURCE_EMPTY_RESPONSE_MESSAGE,
  SOURCE_HTML_NOT_JSON_MESSAGE,
  SOURCE_JSON_MALFORMED,
  SOURCE_JSON_OBJECT_INVALID,
  SOURCE_JSON_ROOT_INVALID,
  SOURCE_MAX_BYTES,
  readSourceText,
  sourceCharsetOf,
  sourceExpectsJson,
  sourceJsonObject,
  sourceJsonRoot,
  sourceProblem,
  sourceResponseText,
} from '@core/source/sourceText';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(rel, 'utf8');
}

const STORAGE_KT = 'source/storage/SourceStorage.kt';
const RESPONSE_KT = 'source/SourceResponse.kt';

/* ══════════════════════════════════════════════════════════════════════════════
   ① SourceStorage.kt —— 七个方法，一个不多一个不少
   ══════════════════════════════════════════════════════════════════════════════ */

describe('SourceStorage.kt L3-11 七个方法', () => {
  const src = kt(STORAGE_KT);

  it('L4-10 七个 `suspend fun`，名字与参数逐个一致', () => {
    const methods = [...src.matchAll(/suspend fun (\w+)\(([^)]*)\)/g)].map((m) => [m[1], m[2]]);
    expect(methods).toEqual([
      ['saveSourceState', 'sourceId: String, enabled: Boolean'],
      ['getSourceStates', ''],
      ['saveActiveSourceId', 'sourceId: String'],
      ['getActiveSourceId', ''],
      ['saveCustomSourceJson', 'sourceId: String, jsonContent: String'],
      ['getCustomSourceJsons', ''],
      ['removeCustomSourceJson', 'sourceId: String'],
    ]);
  });

  it('端口同名同顺序；`getSourceStates` 多出的 `knownIds?` 必须**可选**', () => {
    const ts = repoText('src/core/source/storage/sourceStorage.ts');
    // 只取 `export interface SourceStorage { … }` 这一段（同文件还有 SourcePrefsPort 等其它端口）
    const start = ts.indexOf('export interface SourceStorage {');
    const end = ts.indexOf('\n}', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = ts.slice(start, end);
    const decls = [...block.matchAll(/^ {2}(\w+)\(([^)]*)\): Promise</gm)].map((m) => [m[1], m[2]]);
    expect(decls.map((d) => d[0])).toEqual([
      'saveSourceState',
      'getSourceStates',
      'saveActiveSourceId',
      'getActiveSourceId',
      'saveCustomSourceJson',
      'getCustomSourceJsons',
      'removeCustomSourceJson',
    ]);
    // Kotlin 的 `getSourceStates()` 无参 —— 端口的扩展参数必须是 `?`
    expect(decls[1]?.[1]).toBe('knownIds?: readonly string[]');
  });

  it('L7 `getActiveSourceId(): String?` → `Promise<string | null>`', () => {
    expect(src).toContain('suspend fun getActiveSourceId(): String?');
    expect(repoText('src/core/source/storage/sourceStorage.ts')).toContain(
      'getActiveSourceId(): Promise<string | null>;',
    );
  });

  it('L5/L9 两个 `Map` 返回 → `Record`', () => {
    expect(src).toContain('suspend fun getSourceStates(): Map<String, Boolean>');
    expect(src).toContain('suspend fun getCustomSourceJsons(): Map<String, String>');
    const ts = repoText('src/core/source/storage/sourceStorage.ts');
    expect(ts).toContain('getSourceStates(knownIds?: readonly string[]): Promise<Record<string, boolean>>;');
    expect(ts).toContain('getCustomSourceJsons(): Promise<Record<string, string>>;');
  });

  it('`suspend` → `Promise`，且与 `sourceManager` 已声明的那份**结构等价**（双向可赋值）', () => {
    const ts = repoText('src/core/source/storage/sourceStorage.ts');
    expect(ts).toContain("import type { SourceStorage as SourceManagerStoragePort } from '../sourceManager';");
    expect(ts).toContain('export type SourceStorageAsPort = SourceManagerStoragePort;');
    expect(ts).toContain('export type _SourceStorageMatchesSourceManager = SourceStorage extends SourceStorageAsPort');
  });

  it('这个文件里**没有**任何键名常量（那是 impl 的事）', () => {
    // Kotlin 原文只有 interface 与七个签名 —— 键名都在 SharedPreferencesSourceStorage.kt 里
    expect(src).not.toContain('const val');
    expect(src).not.toContain('book_sources_config');
    expect(src).not.toContain('custom_source_ids');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② SourceResponse.kt L12-23 两个入口
   ══════════════════════════════════════════════════════════════════════════════ */

describe('SourceResponse.kt L12-23 readSourceText / expectsJson', () => {
  const src = kt(RESPONSE_KT);

  it('L12 `maxBytes: Int = 2 * 1024 * 1024` 且超限截断', () => {
    expect(src).toContain('internal fun Response.readSourceText(maxBytes: Int = 2 * 1024 * 1024, fallback: String? = null): String {');
    expect(SOURCE_MAX_BYTES).toBe(2 * 1024 * 1024);
    const bytes = new TextEncoder().encode('abcdef');
    expect(readSourceText(bytes, {}, 3)).toBe('abc');
    expect(readSourceText(bytes, {})).toBe('abcdef');
  });

  it('L22 `accept.contains("json", true) && !text/html && !application/xhtml`', () => {
    expect(src).toContain('return accept.contains("json", true) && !accept.contains("text/html", true) && !accept.contains("application/xhtml", true)');
    expect(sourceExpectsJson({ Accept: 'application/json' })).toBe(true);
    expect(sourceExpectsJson({ accept: 'APPLICATION/JSON' })).toBe(true);
    expect(sourceExpectsJson({ 'Accept': 'application/json, text/html' })).toBe(false);
    expect(sourceExpectsJson({ Accept: 'application/xhtml+xml' })).toBe(false);
    expect(sourceExpectsJson({ Accept: 'text/plain' })).toBe(false);
    expect(sourceExpectsJson({})).toBe(false);
    // 头名大小写不敏感（`equals("Accept", true)`）
    expect(sourceExpectsJson({ ACCEPT: 'application/json' })).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ SourceResponse.kt L24-48 编码判定（六个分支）
   ══════════════════════════════════════════════════════════════════════════════ */

describe('SourceResponse.kt L24-48 text 的编码判定', () => {
  const src = kt(RESPONSE_KT);
  const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

  it('L33 UTF-8 BOM 优先（且最终不残留 `\\uFEFF`）', () => {
    expect(src).toContain('bytes.size >= 3 && bytes[0] == 0xef.toByte() && bytes[1] == 0xbb.toByte() && bytes[2] == 0xbf.toByte() -> Charsets.UTF_8');
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('三体')]);
    expect(sourceCharsetOf(bytes, {})).toBe('utf-8');
    expect(sourceResponseText(bytes, {})).toBe('三体');
    expect(sourceResponseText(bytes, {})).not.toContain('\uFEFF');
  });

  it('L34-35 UTF-16LE / UTF-16BE 两个 BOM', () => {
    expect(src).toContain('bytes[0] == 0xff.toByte() && bytes[1] == 0xfe.toByte() -> Charsets.UTF_16LE');
    expect(src).toContain('bytes[0] == 0xfe.toByte() && bytes[1] == 0xff.toByte() -> Charsets.UTF_16BE');
    const le = new Uint8Array([0xff, 0xfe, 0x09, 0x4e]); // 三
    expect(sourceCharsetOf(le, {})).toBe('utf-16le');
    expect(sourceResponseText(le, {})).toBe('三');
    const be = new Uint8Array([0xfe, 0xff, 0x4e, 0x09]);
    expect(sourceCharsetOf(be, {})).toBe('utf-16be');
    expect(sourceResponseText(be, {})).toBe('三');
  });

  it('L27 头里的 `charset=` 大小写/引号/空格都不敏感', () => {
    expect(src).toContain('Regex("charset\\\\s*=\\\\s*[\\"\']?\\\\s*([A-Za-z0-9_-]+)", RegexOption.IGNORE_CASE)');
    const bytes = utf8('abc');
    expect(sourceCharsetOf(bytes, { 'Content-Type': 'text/html; charset=GBK' })).toBe('GBK');
    expect(sourceCharsetOf(bytes, { 'content-type': "text/html;CHARSET = 'gb2312'" })).toBe('gb2312');
    expect(sourceCharsetOf(bytes, { 'CONTENT-TYPE': 'text/html;charset="  utf-8"' })).toBe('utf-8');
  });

  it('L29 只有 HTML（前缀以 `<` 开头）才从 meta 里嗅探 gbk/gb2312/gb18030', () => {
    expect(src).toContain('(if (prefix.trimStart().startsWith(\'<\')) Regex("charset\\\\s*=\\\\s*[\\"\']?\\\\s*(gbk|gb2312|gb18030)", RegexOption.IGNORE_CASE)');
    const html = utf8('<html><head><meta charset="gbk"></head></html>');
    expect(sourceCharsetOf(html, {})).toBe('gbk');
    // 不是 HTML（不以 `<` 开头）→ 不做 meta 嗅探
    const json = utf8('{"meta":"charset=gbk"}');
    expect(sourceCharsetOf(json, {})).toBe('utf-8');
    // 头部已经给了 charset 时优先用头部
    expect(sourceCharsetOf(html, { 'Content-Type': 'text/html; charset=utf-8' })).toBe('utf-8');
  });

  it('L30 只有 utf-8/utf-16 之外的 HTML meta 才看；`charset=big5` 不会被 meta 分支接走', () => {
    const html = utf8('<meta charset="big5">');
    // 正则只列了 gbk/gb2312/gb18030，big5 落回 utf-8
    expect(sourceCharsetOf(html, {})).toBe('utf-8');
  });

  it('L36 认不出的编码名回落 UTF-8（`getOrDefault`，不是抛错）', () => {
    expect(src).toContain('runCatching { Charset.forName(charsetName) }.getOrDefault(Charsets.UTF_8)');
    const bytes = utf8('hello');
    expect(sourceCharsetOf(bytes, { 'Content-Type': 'text/plain; charset=x-invented' })).toBe('x-invented');
    // 解码时认不出 → 回落 UTF-8，**不抛**
    expect(sourceResponseText(bytes, { 'Content-Type': 'text/plain; charset=x-invented' })).toBe('hello');
  });

  it('L39-46 无声明编码时严格解 UTF-8；解不动就整体按 GB18030', () => {
    expect(src).toContain('Charsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)');
    expect(src).toContain('String(bytes, Charset.forName("GB18030"))');
    // GBK 的「三体」= C8 FD CC E5，不是合法 UTF-8
    const gbk = new Uint8Array([0xc8, 0xfd, 0xcc, 0xe5]);
    expect(sourceResponseText(gbk, {})).toBe('三体');
    // 合法 UTF-8 走严格解码，结果不变
    expect(sourceResponseText(utf8('三体'), {})).toBe('三体');
  });

  it('L47 解码后再 `removePrefix("\\uFEFF")`（UTF-16 解码会留下它）', () => {
    expect(src).toContain('return text.removePrefix("\\uFEFF")');
    const le = new Uint8Array([0xff, 0xfe, 0x09, 0x4e]);
    expect(sourceResponseText(le, {}).startsWith('\uFEFF')).toBe(false);
  });

  it('L26 只嗅探前 4096 **字节**', () => {
    expect(src).toContain('val prefix = String(bytes, 0, minOf(bytes.size, 4096), Charsets.ISO_8859_1)');
    expect(CHARSET_SNIFF_PREFIX_BYTES).toBe(4096);
    const pad = ' '.repeat(5000);
    const html = utf8(`<html><meta charset="gbk">${pad}`);
    // meta 在 4096 字节内 —— 命中
    expect(sourceCharsetOf(html, {})).toBe('gbk');
    const late = utf8(`<!--${pad}--><meta charset="gbk">`);
    // meta 被推到 4096 之外 —— 不命中（trimStart 后仍以 `<` 开头，但 prefix 里没有 charset=）
    expect(sourceCharsetOf(late, {})).toBe('utf-8');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ SourceResponse.kt L50-60 problem
   ══════════════════════════════════════════════════════════════════════════════ */

describe('SourceResponse.kt L50-60 problem 的三个分支', () => {
  const src = kt(RESPONSE_KT);

  it('L52 空响应（去空白与 BOM 后为空）', () => {
    expect(src).toContain('if (body.isEmpty()) return "源站返回空响应，请稍后重试"');
    expect(SOURCE_EMPTY_RESPONSE_MESSAGE).toBe('源站返回空响应，请稍后重试');
    expect(sourceProblem('')).toBe(SOURCE_EMPTY_RESPONSE_MESSAGE);
    expect(sourceProblem('   \n\t')).toBe(SOURCE_EMPTY_RESPONSE_MESSAGE);
    expect(sourceProblem('\uFEFF  ')).toBe(SOURCE_EMPTY_RESPONSE_MESSAGE);
  });

  it('L53 不以 `<` 开头一律 null —— 所以 JSON / 正文里的关键词不误报', () => {
    expect(src).toContain('if (!body.startsWith(\'<\')) return null');
    expect(sourceProblem('{"title":"Access denied"}')).toBeNull();
    expect(sourceProblem('Forbidden!')).toBeNull();
    expect(sourceProblem('{"title":"Access denied"}', true)).toBeNull();
  });

  it('L56 Cloudflare 的五个 `<title>` 关键词（忽略大小写）', () => {
    expect(src).toContain('Regex("<title[^>]*>\\\\s*(Just a moment|Attention Required|Access denied|Forbidden|Service Unavailable)", RegexOption.IGNORE_CASE)');
    for (const title of ['Just a moment', 'Attention Required', 'Access denied', 'Forbidden', 'Service Unavailable']) {
      expect(sourceProblem(`<html><title>${title}</title></html>`)).toBe(SOURCE_CHALLENGE_MESSAGE);
      expect(sourceProblem(`<html><title>${title.toLowerCase()}</title></html>`)).toBe(SOURCE_CHALLENGE_MESSAGE);
    }
  });

  it('L57 `/cdn-cgi/challenge-platform/`（忽略大小写）也算拦截页', () => {
    expect(src).toContain('sample.contains("/cdn-cgi/challenge-platform/", true)');
    expect(sourceProblem('<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>')).toBe(
      SOURCE_CHALLENGE_MESSAGE,
    );
    expect(sourceProblem('<script src="/CDN-CGI/CHALLENGE-PLATFORM/x"></script>')).toBe(SOURCE_CHALLENGE_MESSAGE);
    expect(SOURCE_CHALLENGE_MESSAGE).toBe('源站返回验证或拦截页面，请在书源管理完成站点验证或稍后重试');
  });

  it('L59 普通 HTML：`expectJson` 为真才报「返回网页而非接口数据」', () => {
    expect(src).toContain('return if (expectJson) tr("源站返回网页而非接口数据，请稍后重试或切换该源线路") else null');
    expect(sourceProblem('<html><body>hello</body></html>')).toBeNull();
    expect(sourceProblem('<html><body>hello</body></html>', true)).toBe(SOURCE_HTML_NOT_JSON_MESSAGE);
    expect(SOURCE_HTML_NOT_JSON_MESSAGE).toBe('源站返回网页而非接口数据，请稍后重试或切换该源线路');
  });

  it('L55 只检查前 32K 字符 —— 关键词在第 32768 字符之后不报', () => {
    expect(src).toContain('val sample = body.take(32_768)');
    expect(PROBLEM_SAMPLE_CHARS).toBe(32768);
    const head = `<html>${'a'.repeat(PROBLEM_SAMPLE_CHARS)}`;
    expect(sourceProblem(`${head}<title>Just a moment</title>`)).toBeNull();
    // 关键词在窗口内（哪怕很靠后）→ 报
    const nearTail = `<html>${'a'.repeat(PROBLEM_SAMPLE_CHARS - 40)}<title>Just a moment</title>`;
    expect(sourceProblem(nearTail)).toBe(SOURCE_CHALLENGE_MESSAGE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ SourceResponse.kt L62-77 jsonRoot / jsonObject
   ══════════════════════════════════════════════════════════════════════════════ */

describe('SourceResponse.kt L62-77 jsonRoot / jsonObject', () => {
  const src = kt(RESPONSE_KT);

  it('L63 先过 `problem(text, expectJson = true)` 并把文案原样抛成 ParseError', () => {
    expect(src).toContain('problem(text, expectJson = true)?.let { throw SourceException.ParseError(it) }');
    const html = '<html><title>Just a moment</title></html>';
    expect(() => sourceJsonRoot(html)).toThrow(ParseError);
    expect(() => sourceJsonRoot(html)).toThrow(SOURCE_CHALLENGE_MESSAGE);
    expect(() => sourceJsonRoot(' <html></html> ')).toThrow(SOURCE_HTML_NOT_JSON_MESSAGE);
    expect(() => sourceJsonRoot('   ')).toThrow(SOURCE_EMPTY_RESPONSE_MESSAGE);
  });

  it('L68 根必须是对象或数组；标量一律「预期为 JSON 对象或数组」', () => {
    expect(src).toContain('if ((root !is JSONObject && root !is JSONArray) || tokener.nextClean() != \'\\u0000\')');
    expect(SOURCE_JSON_ROOT_INVALID).toBe('接口数据结构异常，预期为 JSON 对象或数组');
    for (const scalar of ['1', '"x"', 'true', 'null']) {
      expect(() => sourceJsonRoot(scalar)).toThrow(SOURCE_JSON_ROOT_INVALID);
    }
    expect(sourceJsonRoot('{"a":1}')).toEqual({ a: 1 });
    expect(sourceJsonRoot('[1,2]')).toEqual([1, 2]);
  });

  it('L68 根之后不许有多余内容（`nextClean() != \\u0000`）', () => {
    expect(src).toContain('tokener.nextClean()');
    expect(() => sourceJsonRoot('{"a":1} trailing')).toThrow(SOURCE_JSON_MALFORMED);
    expect(() => sourceJsonRoot('{"a":1}{"b":2}')).toThrow(SOURCE_JSON_MALFORMED);
  });

  it('L72 解析失败 → 「接口数据不完整或 JSON 格式异常，请稍后重试」', () => {
    expect(src).toContain('catch (_: Exception) { throw SourceException.ParseError(tr("接口数据不完整或 JSON 格式异常，请稍后重试")) }');
    expect(SOURCE_JSON_MALFORMED).toBe('接口数据不完整或 JSON 格式异常，请稍后重试');
    expect(() => sourceJsonRoot('{"a":')).toThrow(SOURCE_JSON_MALFORMED);
    expect(() => sourceJsonRoot('{a:1}')).toThrow(SOURCE_JSON_MALFORMED);
  });

  it('L75-76 `jsonObject`：数组也拒，文案是「预期为 JSON 对象」', () => {
    expect(src).toContain('fun jsonObject(text: String): JSONObject = jsonRoot(text) as? JSONObject');
    expect(src).toContain('?: throw SourceException.ParseError(tr("接口数据结构异常，预期为 JSON 对象"))');
    expect(SOURCE_JSON_OBJECT_INVALID).toBe('接口数据结构异常，预期为 JSON 对象');
    expect(sourceJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(() => sourceJsonObject('[1]')).toThrow(SOURCE_JSON_OBJECT_INVALID);
    expect(() => sourceJsonObject('1')).toThrow(SOURCE_JSON_ROOT_INVALID);
  });

  it('L64 `trim { it.isWhitespace() || it == \\uFEFF }` —— 前后都能容忍 BOM', () => {
    expect(src).toContain('val normalized = text.trim { it.isWhitespace() || it == \'\\uFEFF\' }');
    expect(sourceJsonRoot('  \uFEFF{"a":1}\uFEFF ')).toEqual({ a: 1 });
  });
});
