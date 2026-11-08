/**
 * Android `com.example.source.importer.SourceImporter.kt` (654 lines, 596 non-blank)
 * → `src/core/source/importer/sourceImporter.ts`.
 *
 * Kotlin class KDoc (lines 21-35), verbatim:
 * ```
 * 书源导入器。
 *
 * 支持三种输入：
 * 1. 本项目原生 JSON 格式（search / htmlSearch / htmlChapters / htmlContent）
 * 2. Legado（开源阅读）书源格式：bookSourceName / bookSourceUrl / searchUrl /
 *    ruleSearch / ruleToc / ruleContent（社区「阅读」书源通用格式）
 * 3. 书源合集 JSON 数组（批量导入，跳过不兼容源）
 *
 * Legado 规则转换说明：
 * - {{key}} -> {keyword}，{{page}} -> {page}，支持 {{java.base64Encode(key)}} 与简单
 *   {{(page-1)*20}} 页面运算；POST 搜索源（,{ "method":"POST","body":... }）会透传 method/body
 * - ruleSearch.bookList 以 $ 或 @json: 开头时按 JSONPath 解析，否则按 HTML 规则解析
 * - 需要 @js: / webView / 嗅探 sourceRegex 的书源暂不支持，会明确跳过
 * ```
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-20     package/imports                            → header + imports
 *   21-35    object KDoc                               → header block (verbatim)
 *   38-43    PRESET_SOURCE_URLS                        → same const list
 *   45-51    data class BatchImportResult               → interface + count helpers
 *   53-57    urlClient                                 → injected HttpClient (per call)
 *   59-68    importFromJsonString()                    → importFromJsonString()
 *   70-71    importBatchFromJsonString()               → importBatchFromJsonString()
 *   73-95    importFromUri()                           → importFromUri()
 *   97-110   importBatchFromUri()                      → importBatchFromUri()
 *   112-139  importBatchFromUrl()                      → importBatchFromUrl()
 *   141-143  核心解析 banner                            → header comment (kept)
 *   145-185  parseBatch()                              → parseBatch()
 *   187-201  convertOne()                              → convertOne()
 *   203-348  parseNativeSource()                       → parseNativeSource()
 *   350-455  convertLegadoSource()                     → convertLegadoSource()
 *   457-468  parseRuleObject()                         → parseRuleObject()
 *   470-512  convertLegadoUrl()                        → convertLegadoUrl()
 *   514-519  data class LegadoUrl                      → LegadoUrl interface
 *   521-538  postUrl()                                 → postUrl()
 *   540-553  evalPageExpression()                      → evalPageExpression()
 *   555-622  private class SimpleArithmetic             → SimpleArithmetic
 *   624-632  parseHeaderString()                       → parseHeaderString()
 *   634      String?.isNull_blank()                    → isNullOrBlank (jsonSupport)
 *   636-646  parseHeaders()                             → parseHeaders()
 *   648-653  data class ConvertedSource                → ConvertedSource interface
 *
 * Skipped lines / adaptations:
 *   - `android.content.Context` + `android.net.Uri` + `contentResolver
 *     .openInputStream(uri)` → an injected `readUriText(uri): Promise<string>`
 *     (2 MiB bounded read kept at the call site with `readBounded`).
 *   - `okhttp3.OkHttpClient` + `Request.Builder` → the injected `HttpClient`; the
 *     `urlClient` timeouts/redirect flag are the platform client's concern.
 *   - `withContext(Dispatchers.IO)` dropped.
 *   - `UUID.randomUUID().toString().substring(0, 8)` →
 *     `crypto.randomUUID().slice(0, 8)` (same 8 hex chars, same shape).
 *   - `org.json.JSONObject/JSONArray` → the `org.json` subset in
 *     `../impl/jsonSupport`. `optString(key, null)` → `optString(…, null)`;
 *     `obj.optString("type", null)?.ifBlank { null }` keeps the round-3 NPE fix
 *     comment (lines 336-338) verbatim.
 *   - `String.toLongOrNull` in `SimpleArithmetic` → the same literal check with
 *     `BigInt`, so the accepted range is Kotlin's `Long` range and not the
 *     2^53 safe-integer range. `Math.multiplyExact/addExact/subtractExact`
 *     overflow guards keep their meaning: they throw (here a `RangeError`), which
 *     the same `catch { null }` path in `evalPageExpression` swallows exactly like
 *     Kotlin's `ArithmeticException` → `null`. Division stays truncating
 *     (BigInt `/` truncates toward zero, like Kotlin's `Long` division).
 *   - `Math.multiplyExact(value, null)` — Kotlin's platform-type `Long?` slipped
 *     through `?:` in the original; the port makes the null case explicit
 *     (`return null`), which is the only reachable behaviour anyway because
 *     `factor()` returning null immediately aborts the term.
 *   - 2026-10-06 review fix: `SimpleArithmetic.term()` division now applies
 *     `Math.trunc` — Kotlin `value /= divisor` is a truncating Long division,
 *     the plain JS `/=` returned fractions (e.g. `7/2` → `3.5` vs Android `3`).
 *   - `SourceResult.Success/Error` → the `SourceResult` const namespace.
 *   - `JsonBookSource(config)` → the ported `../impl/jsonBookSource`.
 */

import { validateJson } from '../../parser/ruleBudget';
import { SourceResult } from '../sourceResult';
import type { SourceResult as SourceResultType } from '../sourceResult';
import { ParseError, SourceException } from '../sourceException';
import { createBookFieldRule, createDetailRule, createDownloadRule, createHtmlChapterRule, createHtmlContentRule, createHtmlSearchRule, createSearchRule, createSourceConfig } from '../sourceConfig';
import type { SourceConfig } from '../sourceConfig';
import { JsonBookSource } from '../impl/jsonBookSource';
import { readBounded, MAX_SOURCE_BODY_BYTES, decodeUtf8, executeSourceRequest, isSuccessful, resolveHttpClient } from '../impl/sourceHttp';
import type { HttpClient } from '../impl/sourceHttp';
import {
  isJsonObject,
  isNullOrBlank,
  keys,
  optJsonObject,
  optString,
  parseJsonArrayOrThrow,
  parseJsonObjectOrThrow,
} from '../impl/jsonSupport';
import type { JsonObject } from '../impl/jsonSupport';

/** 社区书源网络导入预设（用户可自行替换为任意 shuyuan 文件地址）。 */
export const PRESET_SOURCE_URLS: ReadonlyArray<readonly [string, string]> = [
  ['https://raw.ixnic.net/XIU2/Yuedu/master/shuyuan', 'XIU2 精品书源（镜像）'],
  ['https://cdn.jsdelivr.net/gh/XIU2/Yuedu@master/shuyuan', 'XIU2 精品书源（CDN）'],
  ['https://raw.githubusercontent.com/XIU2/Yuedu/master/shuyuan', 'XIU2 精品书源（GitHub 直连）'],
];

/** Kotlin `data class BatchImportResult(imported, skipped)`. */
export interface BatchImportResult {
  /** Kotlin `Pair<JsonBookSource, String>` → a named tuple. */
  readonly imported: ReadonlyArray<{ source: JsonBookSource; rawJson: string }>;
  readonly skipped: ReadonlyArray<{ id: string; reason: string }>;
}

/** Kotlin `val BatchImportResult.importedCount` / `skippedCount`. */
export function importedCount(result: BatchImportResult): number {
  return result.imported.length;
}

/** Kotlin `val BatchImportResult.skippedCount`. */
export function skippedCount(result: BatchImportResult): number {
  return result.skipped.length;
}

/**
 * Kotlin `private fun buildImportStatus(result: BatchImportResult): String`
 * (SourceViewModel.kt lines 114-122) — shared so the view model and any other
 * caller produce the identical string.
 */
export function buildImportStatusText(result: {
  imported: ReadonlyArray<{ source: unknown; rawJson: string }>;
  skipped: ReadonlyArray<{ id: string; reason: string }>;
}): string {
  const base = `成功导入 ${result.imported.length} 个书源`;
  if (result.skipped.length > 0) {
    const firstSkipped = (result.skipped[0] as { reason: string }).reason;
    return `${base}，跳过 ${result.skipped.length} 个（${firstSkipped}）`;
  }
  return base;
}

/** Kotlin `private data class ConvertedSource(source, rawJson, name, reason)`. */
interface ConvertedSource {
  readonly source: JsonBookSource | null;
  readonly rawJson: string;
  readonly name: string;
  readonly reason: string | null;
}

/** Kotlin `private data class LegadoUrl(url, charset, method, body)`. */
interface LegadoUrl {
  readonly url: string;
  readonly charset: string | null;
  readonly method: string;
  readonly body: string | null;
}

/** Kotlin `Context.contentResolver.openInputStream(uri)` + `readImportBytes(2MiB)`. */
export type UriTextReader = (uri: string) => Promise<Uint8Array>;

export interface SourceImporterOptions {
  /** Kotlin `context` — used only by the two `…FromUri` entry points. */
  readonly readUriText?: UriTextReader;
  /** Kotlin `urlClient`. */
  readonly client?: HttpClient | null;
}

/** Kotlin `importFromJsonString(jsonStr)` (lines 59-68). */
export function importFromJsonString(jsonStr: string): SourceResultType<JsonBookSource> {
  const batch = parseBatch(jsonStr);
  const first = batch.imported[0];
  if (first !== undefined) return SourceResult.Success(first.source);
  const reason = batch.skipped[0]?.reason ?? '未找到可导入的书源';
  return SourceResult.Error(new ParseError(`导入失败：${reason}`));
}

/** 批量导入（支持单源或 JSON 数组），返回导入成功与跳过的明细。 */
export function importBatchFromJsonString(jsonStr: string): BatchImportResult {
  return parseBatch(jsonStr);
}

/** Kotlin `importFromUri(context, uri)` (lines 73-95). */
export async function importFromUri(
  uri: string,
  options: SourceImporterOptions = {},
): Promise<SourceResultType<{ source: JsonBookSource; rawJson: string }>> {
  const read = options.readUriText;
  if (read == null) {
    return SourceResult.Error(new ParseError('无法打开选择的文件'));
  }
  try {
    const bytes = readBounded(await read(uri), MAX_SOURCE_BODY_BYTES);
    const jsonStr = decodeUtf8(bytes);
    const batch = parseBatch(jsonStr);
    const first = batch.imported[0];
    return first !== undefined
      ? SourceResult.Success(first)
      : SourceResult.Error(
          new ParseError(batch.skipped[0]?.reason ?? '未找到可导入的书源'),
        );
  } catch (e) {
    if (e instanceof SourceException) return SourceResult.Error(e);
    return SourceResult.Error(new ParseError(`读取文件失败: ${messageOf(e)}`));
  }
}

/** Kotlin `importBatchFromUri(context, uri)` (lines 97-110). */
export async function importBatchFromUri(
  uri: string,
  options: SourceImporterOptions = {},
): Promise<BatchImportResult> {
  const read = options.readUriText;
  if (read == null) {
    return { imported: [], skipped: [{ id: '文件', reason: '无法打开选择的文件' }] };
  }
  try {
    const bytes = readBounded(await read(uri), MAX_SOURCE_BODY_BYTES);
    return parseBatch(decodeUtf8(bytes));
  } catch (e) {
    if (e instanceof SourceException) return { imported: [], skipped: [{ id: '文件', reason: `读取失败: ${messageOf(e)}` }] };
    return {
      imported: [],
      skipped: [{ id: '文件', reason: `读取失败: ${messageOf(e)}` }],
    };
  }
}

/** 从网络地址导入书源（支持单源 JSON 与合集数组）。 */
export async function importBatchFromUrl(
  url: string,
  options: SourceImporterOptions = {},
): Promise<BatchImportResult> {
  try {
    const client = resolveHttpClient(options.client ?? null);
    const response = await executeSourceRequest(client, url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    });
    if (!isSuccessful(response)) {
      return { imported: [], skipped: [{ id: url, reason: `网络请求失败 HTTP ${response.status}` }] };
    }
    const body = response.body.byteLength === 0 ? '' : decodeUtf8(response.body);
    if (body.trim() === '') {
      return { imported: [], skipped: [{ id: url, reason: '返回内容为空' }] };
    }
    return parseBatch(body);
  } catch (e) {
    if (e instanceof SourceException) {
      return { imported: [], skipped: [{ id: url, reason: `网络导入失败: ${messageOf(e)}` }] };
    }
    return { imported: [], skipped: [{ id: url, reason: `网络导入失败: ${messageOf(e)}` }] };
  }
}

// ---------------------------------------------------------------------------
// 核心解析
// ---------------------------------------------------------------------------

/** Kotlin `private fun parseBatch(jsonStr: String): BatchImportResult` (lines 145-185). */
export function parseBatch(jsonStr: string): BatchImportResult {
  if (jsonStr.trim() === '') {
    return { imported: [], skipped: [{ id: '输入', reason: 'JSON内容为空' }] };
  }
  const trimmed = jsonStr.trim();
  const imported: Array<{ source: JsonBookSource; rawJson: string }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  try {
    validateJson(jsonStr);
    if (trimmed.startsWith('[')) {
      const array = parseJsonArrayOrThrow(trimmed);
      if (array.length > 1000) throw new Error('一次最多导入 1000 个书源');
      for (let i = 0; i < array.length; i += 1) {
        const obj = array[i];
        if (!isJsonObject(obj)) continue;
        const converted = convertOne(obj);
        if (converted === null) continue;
        if (converted.source !== null) {
          imported.push({ source: converted.source, rawJson: converted.rawJson });
        } else {
          skipped.push({
            id: converted.name,
            reason: converted.reason ?? '未知原因',
          });
        }
      }
    } else {
      const obj = parseJsonObjectOrThrow(trimmed);
      const converted = convertOne(obj);
      if (converted !== null) {
        if (converted.source !== null) {
          imported.push({ source: converted.source, rawJson: converted.rawJson });
        } else {
          skipped.push({ id: converted.name, reason: converted.reason ?? '未知原因' });
        }
      }
    }
  } catch (e) {
    if (e instanceof SourceException) {
      return { imported: [], skipped: [{ id: '输入', reason: `解析失败: ${messageOf(e)}` }] };
    }
    if (e instanceof SyntaxError) {
      return { imported: [], skipped: [{ id: '输入', reason: `JSON 语法错误: ${e.message}` }] };
    }
    return { imported: [], skipped: [{ id: '输入', reason: `解析失败: ${messageOf(e)}` }] };
  }
  return { imported, skipped };
}

/** Kotlin `private fun convertOne(obj: JSONObject): ConvertedSource?` (lines 187-201). */
function convertOne(obj: JsonObject): ConvertedSource | null {
  const rawJson = JSON.stringify(obj);
  // 优先按本项目原生格式解析
  if (obj['htmlSearch'] !== undefined || obj['search'] !== undefined) {
    const result = parseNativeSource(obj, rawJson);
    if (result.kind === 'success') return { source: result.data, rawJson, name: '未知书源', reason: null };
    return {
      source: null,
      rawJson,
      name: optString(obj, 'name', '书源') ?? '书源',
      reason: result.exception.message,
    };
  }
  // Legado 格式
  if (
    obj['bookSourceName'] !== undefined ||
    obj['bookSourceUrl'] !== undefined ||
    obj['ruleSearch'] !== undefined
  ) {
    return convertLegadoSource(obj, rawJson);
  }
  return {
    source: null,
    rawJson,
    name:
      optString(obj, 'name', null) ??
      optString(obj, 'bookSourceName', '未知书源') ??
      '未知书源',
    reason: '既不是本项目 JSON 格式，也不是 Legado 书源格式',
  };
}

/** Kotlin `private fun parseNativeSource(obj, rawJson)` (lines 203-348). */
/**
 * Kotlin `private fun parseNativeSource(obj: JSONObject, rawJson: String)`
 * (lines 203-348). `rawJson` is unused in the Kotlin body too, so the
 * parameter is kept but underscore-prefixed for the linter.
 */
function parseNativeSource(
  obj: JsonObject,
  _rawJson: string,
): SourceResultType<JsonBookSource> {
  try {
    const nameOrBlank = optString(obj, 'name', '') ?? '';
    const name = nameOrBlank.trim() === '' ? '未命名书源' : nameOrBlank;
    const idOrBlank = optString(obj, 'id', '') ?? '';
    const id = idOrBlank.trim() === '' ? `custom_${crypto.randomUUID().slice(0, 8)}` : idOrBlank;
    const baseUrl = optString(obj, 'baseUrl', '') ?? '';

    const searchObj = optJsonObject(obj, 'search');
    const htmlSearchObj = optJsonObject(obj, 'htmlSearch');
    if (searchObj === null && htmlSearchObj === null) {
      return SourceResult.Error(new ParseError('缺少 search 或 htmlSearch 节点规则'));
    }

    const searchUrlFromSearch = searchObj === null ? null : optString(searchObj, 'url', '');
    const searchUrl =
      searchUrlFromSearch != null && searchUrlFromSearch.trim() !== ''
        ? searchUrlFromSearch
        : (htmlSearchObj === null ? '' : (optString(htmlSearchObj, 'url', '') ?? ''));
    if (searchUrl.trim() === '') {
      return SourceResult.Error(new ParseError('search/htmlSearch 规则中缺少 url 字段'));
    }

    // Kotlin `searchObj?.optString("method", "GET") ?: "GET"`
    const searchMethod = searchObj === null ? 'GET' : (optString(searchObj, 'method', 'GET') ?? 'GET');
    const searchListPath =
      searchObj === null ? 'books' : (optString(searchObj, 'listPath', 'books') ?? 'books');

    // Kotlin `searchObj?.optJSONObject("fields") ?: searchObj`
    const searchFieldsObj =
      searchObj === null ? null : (optJsonObject(searchObj, 'fields') ?? searchObj);
    const searchFields = createBookFieldRule({
      id: field(searchFieldsObj, 'id', 'id') ?? 'id',
      title: field(searchFieldsObj, 'title', 'title') ?? 'title',
      author: field(searchFieldsObj, 'author', 'author'),
      cover: field(searchFieldsObj, 'cover', 'cover'),
      description: field(searchFieldsObj, 'description', 'description'),
      format: field(searchFieldsObj, 'format', 'format'),
      downloadUrl: field(searchFieldsObj, 'downloadUrl', 'downloadUrl'),
    });

    const searchHeaders = parseHeaders(optJsonObject(searchObj, 'headers'));
    const searchBodyRaw = searchObj === null ? '' : (optString(searchObj, 'body', '') ?? '');
    const searchBody = searchBodyRaw.trim() === '' ? null : searchBodyRaw;

    const searchRule = createSearchRule({
      url: searchUrl,
      method: searchMethod,
      listPath: searchListPath,
      fields: searchFields,
      headers: searchHeaders,
      body: searchBody,
    });

    let detailRule = null;
    const detailObj = optJsonObject(obj, 'detail');
    if (detailObj !== null) {
      const detailUrl = optString(detailObj, 'url', '') ?? '';
      if (detailUrl.trim() !== '') {
        const detailMethod = optString(detailObj, 'method', 'GET') ?? 'GET';
        const detailFieldsObj = optJsonObject(detailObj, 'fields') ?? detailObj;
        const detailFields = createBookFieldRule({
          id: field(detailFieldsObj, 'id', 'id') ?? 'id',
          title: field(detailFieldsObj, 'title', 'title') ?? 'title',
          author: field(detailFieldsObj, 'author', 'author'),
          cover: field(detailFieldsObj, 'cover', 'cover'),
          description: field(detailFieldsObj, 'description', 'description'),
          format: field(detailFieldsObj, 'format', 'format'),
          downloadUrl: field(detailFieldsObj, 'downloadUrl', 'downloadUrl'),
        });
        const detailHeaders = parseHeaders(optJsonObject(detailObj, 'headers'));
        const detailBodyRaw = optString(detailObj, 'body', '') ?? '';
        detailRule = createDetailRule({
          url: detailUrl,
          method: detailMethod,
          fields: detailFields,
          headers: detailHeaders,
          body: detailBodyRaw.trim() === '' ? null : detailBodyRaw,
        });
      }
    }

    let downloadRule = createDownloadRule();
    const downloadObj = optJsonObject(obj, 'download');
    if (downloadObj !== null) {
      const dlUrl = optString(downloadObj, 'url', null);
      const dlUrlField = optString(downloadObj, 'urlField', 'downloadUrl');
      const dlFormatRaw = optString(downloadObj, 'format', 'epub') ?? 'epub';
      const dlHeaders = parseHeaders(optJsonObject(downloadObj, 'headers'));
      downloadRule = createDownloadRule({
        url: isNullOrBlank(dlUrl) ? null : dlUrl,
        urlField: isNullOrBlank(dlUrlField) ? null : dlUrlField,
        defaultFormat: dlFormatRaw.trim() === '' ? 'epub' : dlFormatRaw,
        headers: dlHeaders,
      });
    }

    const htmlSearch = (() => {
      if (htmlSearchObj === null) return null;
      const h = htmlSearchObj;
      const charsetRaw = optString(h, 'charset', '') ?? '';
      const methodRaw = optString(h, 'method', 'GET') ?? 'GET';
      const bodyRaw = optString(h, 'body', '') ?? '';
      const rule = createHtmlSearchRule({
        url: optString(h, 'url', '') ?? '',
        listSelector: optString(h, 'listSelector', '') ?? '',
        titleSelector: optString(h, 'title', '') ?? '',
        authorSelector: optString(h, 'author', '') ?? '',
        coverSelector: optString(h, 'cover', '') ?? '',
        detailUrlSelector: optString(h, 'detailUrl', '') ?? '',
        introSelector: optString(h, 'intro', '') ?? '',
        charset: charsetRaw.trim() === '' ? null : charsetRaw,
        method: methodRaw.trim() === '' ? 'GET' : methodRaw.toUpperCase(),
        body: bodyRaw.trim() === '' ? null : bodyRaw,
      });
      return rule.url.trim() !== '' && rule.listSelector.trim() !== '' ? rule : null;
    })();

    const htmlChapters = (() => {
      const h = optJsonObject(obj, 'htmlChapters');
      if (h === null) return null;
      const rule = createHtmlChapterRule({
        url: optString(h, 'url', '') ?? '',
        listSelector: optString(h, 'listSelector', '') ?? '',
        nameSelector: optString(h, 'name', 'text') ?? 'text',
        hrefSelector: optString(h, 'href', 'href') ?? 'href',
      });
      return rule.url.trim() !== '' && rule.listSelector.trim() !== '' ? rule : null;
    })();

    const htmlContent = (() => {
      const h = optJsonObject(obj, 'htmlContent');
      if (h === null) return null;
      const rule = createHtmlContentRule({
        url: optString(h, 'url', '') ?? '',
        imageSelector: optString(h, 'imageSelector', '') ?? '',
      });
      return rule.url.trim() !== '' && rule.imageSelector.trim() !== '' ? rule : null;
    })();

    const config: SourceConfig = createSourceConfig({
      id,
      name,
      baseUrl,
      search: searchRule,
      detail: detailRule,
      download: downloadRule,
      htmlSearch,
      htmlChapters,
      htmlContent,
      enabled: true,
      isCustom: true,
      insecureTls: optBoolean(obj, 'insecureTls', false),
      // 第三轮记录的遗留 NPE 修复：type 键缺失时 optString 返回 null，
      // 直接 .ifBlank 会抛空安全异常——任何不带 type 字段的书源导入必失败
      type: (() => {
        const type = optString(obj, 'type', null);
        if (type === null) return null;
        return type.trim() === '' ? null : type;
      })(),
    });

    return SourceResult.Success(new JsonBookSource(config));
  } catch (e) {
    if (e instanceof SourceException) return SourceResult.Error(e);
    if (e instanceof SyntaxError) {
      return SourceResult.Error(new ParseError(`JSON解析语法错误: ${e.message}`));
    }
    return SourceResult.Error(new ParseError(`解析书源失败: ${messageOf(e)}`));
  }
}

/** Kotlin `optString(key, default)` on a possibly-null JSONObject, as `searchFieldsObj?.optString(...)`. */
function field(obj: JsonObject | null, key: string, fallback: string): string | null {
  if (obj === null) return fallback;
  return optString(obj, key, fallback);
}

/** Kotlin `optBoolean(key, false)`. */
function optBoolean(obj: JsonObject, key: string, fallback: boolean): boolean {
  const value = obj[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const lower = String(value).toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  return fallback;
}

/** Kotlin `private fun convertLegadoSource(obj, rawJson)` (lines 350-455). */
function convertLegadoSource(obj: JsonObject, rawJson: string): ConvertedSource {
  const nameOrBlank = optString(obj, 'bookSourceName', '') ?? '';
  const name = nameOrBlank.trim() === '' ? '未命名书源' : nameOrBlank;
  const baseUrl = (optString(obj, 'bookSourceUrl', '') ?? '').trim();
  if (baseUrl === '') return { source: null, rawJson, name, reason: '缺少 bookSourceUrl' };
  const searchUrlRaw = (optString(obj, 'searchUrl', '') ?? '').trim();
  if (searchUrlRaw === '') return { source: null, rawJson, name, reason: '缺少 searchUrl' };

  const ruleSearch = parseRuleObject(obj, 'ruleSearch');
  if (ruleSearch === null) return { source: null, rawJson, name, reason: '缺少 ruleSearch' };
  const ruleToc = parseRuleObject(obj, 'ruleToc') ?? {};
  const ruleContent = parseRuleObject(obj, 'ruleContent') ?? {};

  const allRules = [
    searchUrlRaw,
    JSON.stringify(ruleSearch),
    JSON.stringify(ruleToc),
    JSON.stringify(ruleContent),
  ].join('\n');
  if (
    allRules.includes('@js:') ||
    allRules.includes('{{java.') ||
    allRules.includes('webView') ||
    allRules.includes('@js') ||
    allRules.includes('webJs') ||
    (optString(ruleContent, 'sourceRegex', '') ?? '').trim() !== ''
  ) {
    return { source: null, rawJson, name, reason: '包含 JS 脚本/WebView 嗅探，暂不支持' };
  }
  if (optInt(obj, 'bookSourceType', 0) === 1) {
    return { source: null, rawJson, name, reason: '有声书源（bookSourceType=1）暂不支持' };
  }

  const bookList = (optString(ruleSearch, 'bookList', '') ?? '').trim();
  if (bookList === '') return { source: null, rawJson, name, reason: '缺少 ruleSearch.bookList' };
  const chapterList = (optString(ruleToc, 'chapterList', '') ?? '').trim();
  if (chapterList === '') {
    return { source: null, rawJson, name, reason: '缺少 ruleToc.chapterList（无目录规则）' };
  }
  const content = (optString(ruleContent, 'content', '') ?? '').trim();
  if (content === '') {
    return { source: null, rawJson, name, reason: '缺少 ruleContent.content（无正文/图片规则）' };
  }
  if (content === 'result') {
    return { source: null, rawJson, name, reason: '正文依赖媒体嗅探（sourceRegex），暂不支持' };
  }

  const converted = convertLegadoUrl(searchUrlRaw);
  if (converted === null) {
    return { source: null, rawJson, name, reason: '搜索 URL 含无法转换的 JS 表达式' };
  }

  const headers = parseHeaderString(optString(obj, 'header', '') ?? '');
  const charset =
    converted.charset != null && converted.charset.trim() === '' ? null : converted.charset;
  const idDerived = `legado_${baseUrl
    .replace('https://', '')
    .replace('http://', '')
    .replace(/\/+$/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const id = idDerived === 'legado_' ? `legado_${crypto.randomUUID().slice(0, 8)}` : idDerived;

  const htmlSearch = createHtmlSearchRule({
    url: converted.url,
    listSelector: bookList,
    titleSelector: optString(ruleSearch, 'name', '') ?? '',
    authorSelector: optString(ruleSearch, 'author', '') ?? '',
    coverSelector: optString(ruleSearch, 'coverUrl', '') ?? '',
    detailUrlSelector: optString(ruleSearch, 'bookUrl', '') ?? '',
    introSelector: optString(ruleSearch, 'intro', '') ?? '',
    charset,
    method: converted.method,
    body: converted.body,
  });

  const ruleBookInfo = parseRuleObject(obj, 'ruleBookInfo') ?? {};
  const chapterNameRaw = optString(ruleToc, 'chapterName', 'text') ?? 'text';
  const chapterName = chapterNameRaw.trim() === '' ? 'text' : chapterNameRaw;
  const chapterUrlRaw = optString(ruleToc, 'chapterUrl', 'href') ?? 'href';
  const chapterUrl = chapterUrlRaw.trim() === '' ? 'href' : chapterUrlRaw;
  const tocUrlRaw = (optString(ruleBookInfo, 'tocUrl', '') ?? '').trim();
  const htmlChapters = createHtmlChapterRule({
    url: '{id}',
    listSelector: chapterList,
    nameSelector: chapterName,
    hrefSelector: chapterUrl,
    tocUrlSelector: tocUrlRaw === '' ? null : tocUrlRaw,
  });
  const htmlContent = createHtmlContentRule({ url: '{chapterUrl}', imageSelector: content });

  const searchRule = createSearchRule({
    url: converted.url,
    method: 'GET',
    listPath: 'books',
    fields: createBookFieldRule(),
    headers,
  });

  const config: SourceConfig = createSourceConfig({
    id,
    name,
    baseUrl,
    search: searchRule,
    detail: null,
    download: createDownloadRule(),
    htmlSearch,
    htmlChapters,
    htmlContent,
    enabled: true,
    isCustom: true,
  });
  return { source: new JsonBookSource(config), rawJson, name, reason: null };
}

/** Kotlin `private fun parseRuleObject(obj, key): JSONObject?` (lines 457-468). */
function parseRuleObject(obj: JsonObject, key: string): JsonObject | null {
  const direct = optJsonObject(obj, key);
  if (direct !== null) return direct;
  const str = optString(obj, key, '') ?? '';
  if (str.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(str);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 转换 Legado URL：去掉 ,{...} 选项后缀，{{key}} -> {keyword}，{{page}} -> {page}，支持简单运算。POST 源透传 method/body。
 */
function convertLegadoUrl(raw: string): LegadoUrl | null {
  let url = raw.trim();
  let charset: string | null = null;
  // 去掉请求选项后缀 ,{ "charset": ... , "method": ... , "body": ... }
  const commaIdx = url.indexOf(',{');
  if (commaIdx > 0) {
    const candidate = url.slice(commaIdx + 1);
    if (candidate.trimStart().startsWith('{')) {
      let opt: JsonObject | null = null;
      try {
        const parsed: unknown = JSON.parse(candidate);
        opt = isJsonObject(parsed) ? parsed : null;
      } catch {
        opt = null;
      }
      if (opt !== null) {
        url = url.slice(0, commaIdx).trim();
        const charsetRaw = optString(opt, 'charset', '') ?? '';
        charset = charsetRaw.trim() === '' ? null : charsetRaw;
        const optMethodRaw = optString(opt, 'method', 'GET') ?? 'GET';
        const optMethod = optMethodRaw.trim() === '' ? 'GET' : optMethodRaw;
        if (optMethod.toUpperCase() === 'POST') {
          // POST 搜索源：透传 method/body，不再跳过
          return postUrl(url, opt);
        }
      }
    }
  }
  if (url.includes('@js:') || url.includes('webView')) return null;

  url = url
    .replace(/\{\{key\}\}/g, '{keyword}')
    .replace(/\{\{page\}\}/g, '{page}')
    .replace(/\{\{java\.base64Encode\(key\)\}\}/g, '{keyword_b64}');

  // 简单页面运算：{{(page-1)*20}}、{{page*10}}、{{(page-1)*50}} 等
  url = url.replace(/\{\{([^{}]+)\}\}/g, (match: string, group: string) => {
    const expr = group.trim();
    return evalPageExpression(expr) ?? match;
  });
  return url.includes('{{') ? null : { url, charset, method: 'GET', body: null };
}

/** POST 搜索源：处理 URL 与 body 模板中的 {{key}}/{{page}} 占位符，不再直接跳过。 */
function postUrl(url: string, opt: JsonObject): LegadoUrl | null {
  let u = url;
  if (u.includes('@js:') || u.includes('webView')) return null;
  u = u
    .replace(/\{\{key\}\}/g, '{keyword}')
    .replace(/\{\{page\}\}/g, '{page}')
    .replace(/\{\{java\.base64Encode\(key\)\}\}/g, '{keyword_b64}');
  const bodyRaw = optString(opt, 'body', '') ?? '';
  let body: string | null = bodyRaw.trim() === '' ? null : bodyRaw;
  body = body?.replace(/\{\{key\}\}/g, '{keyword}').replace(/\{\{page\}\}/g, '{page}') ?? null;
  const charsetRaw = optString(opt, 'charset', '') ?? '';
  const charset = charsetRaw.trim() === '' ? null : charsetRaw;
  return u.includes('{{') ? null : { url: u, charset, method: 'POST', body };
}

/** Kotlin `private fun evalPageExpression(expr: String): String?` (lines 540-553).
 *  导出是为了能直接对拍 `SimpleArithmetic` 的边界行为（E87）。 */
export function evalPageExpression(expr: string): string | null {
  const normalized = expr.replace(/ /g, '');
  if (normalized.includes('?')) return null;
  // 仅支持 page 与数字的四则运算（页面首次加载固定为 page=1）
  const tokens = normalized.replace(/page/g, '1');
  if (!/^[0-9+\-*/()]+$/.test(tokens)) return null;
  let result: bigint | null = null;
  try {
    result = new SimpleArithmetic(tokens).evaluate();
  } catch {
    result = null;
  }
  return result === null ? null : result.toString();
}

/**
 * Kotlin `Char.isDigit()` — `Character.isDigit(ch)`, 即 Unicode 类别 Nd。
 *
 * 注意：入口正则（`SourceImporter.kt:545` 的 `^[0-9+…]+$`）已经只放行 **ASCII**
 * 数字，所以这条路径上实际只可能收到 `'0'`–`'9'`。仍按 Kotlin 的 `Char.isDigit()`
 * 语义实现（含 Nd 类），以便 `SimpleArithmetic` 单独使用时行为一致。
 */
function peekIsDigit(ch: string | null): boolean {
  if (ch === null || ch === '') return false;
  const code = ch.codePointAt(0) ?? 0;
  // Nd：十进制数字。ASCII '0'-'9' 是其中最常见的一小段，其余按 Unicode Nd 判定。
  if (code >= 0x30 && code <= 0x39) return true;
  return /\p{Nd}/u.test(ch);
}

/**
 * 极简四则运算求值器（仅数字、+ - * / 与括号）。
 *
 * 2026-10-09 复核：改为 **BigInt** 逐位复刻 Kotlin `Long`（64 位有符号）语义。
 * `Math.multiplyExact / addExact / subtractExact`（SourceImporter.kt:593/612/616）
 * 只在结果越过 `[-2^63, 2^63-1]` 时抛 `ArithmeticException`，被
 * `evalPageExpression` 的 `catch { null }` 接住变成「算不出来」。
 * 旧实现用 `Number.isSafeInteger`（2^53）近似，会把
 * `3037000500*3037000500`（= 9223372036854775807，Long 内合法）误判成溢出，
 * Android 算得出、iOS 算不出。
 */
class SimpleArithmetic {
  private pos = 0;

  /** Kotlin `Long.MAX_VALUE` / `Long.MIN_VALUE` — `Math.*Exact` 的合法区间。 */
  private static readonly LONG_MAX = 9223372036854775807n;
  private static readonly LONG_MIN = -9223372036854775808n;

  constructor(private readonly expr: string) {}

  evaluate(): bigint | null {
    if (this.expr.length > 256 || countChar(this.expr, '(') > 32) return null;
    const value = this.expression();
    if (value === null) return null;
    return this.pos === this.expr.length ? value : null;
  }

  /** Kotlin `private fun peek(): Char?`. */
  private peek(): string | null {
    return this.pos < this.expr.length ? (this.expr[this.pos] as string) : null;
  }

  /** Kotlin `private fun number(): Long?` (SourceImporter.kt:567-574). */
  private number(): bigint | null {
    let sb = '';
    // Kotlin L569 `while (peek()?.isDigit() == true)` —— `Char.isDigit()` 对
    // **Unicode Nd 类**数字为真（`Character.isDigit`），所以全角 `１２３`、阿拉伯-印度
    // 数字等也会被吃掉。JS 的 `'0'..'9'` 字符比较只认ASCII（E87）。
    while (peekIsDigit(this.peek())) {
      sb += this.peek();
      this.pos += 1;
    }
    // Kotlin L573 `sb.toString().toLongOrNull()` —— `toLongOrNull` 接受一个可选的
    // 前导 `+`/`-`，且拒绝超出 Long 范围的值。前导符号在这里到不了（`expression()`
    // 先消费了运算符），但 Kotlin 的守卫确实允许 `-`；保留以逐字对齐。
    if (!/^[+-]?\d+$/.test(sb)) return null;
    const parsed = BigInt(sb);
    // Kotlin 的 `Long` 是 64 位；`toLongOrNull()` 对超出 `[Long.MIN_VALUE,
    // Long.MAX_VALUE]` 的字面量返回 null。
    if (parsed > SimpleArithmetic.LONG_MAX || parsed < SimpleArithmetic.LONG_MIN) return null;
    return parsed;
  }

  /** Kotlin `private fun factor(): Long?`. */
  private factor(): bigint | null {
    if (this.peek() === '(') {
      this.pos += 1;
      const v = this.expression();
      if (v === null) return null;
      if (this.peek() !== ')') return null;
      this.pos += 1;
      return v;
    }
    return this.number();
  }

  /** Kotlin `private fun term(): Long?`. */
  private term(): bigint | null {
    let value = this.factor();
    if (value === null) return null;
    for (;;) {
      const op = this.peek();
      if (op === '*') {
        this.pos += 1;
        const factor = this.factor();
        if (factor === null) return null;
        // Kotlin `Math.multiplyExact(value, factor)`
        const product: bigint = value * factor;
        if (product > SimpleArithmetic.LONG_MAX || product < SimpleArithmetic.LONG_MIN) {
          throw new RangeError('Math.multiplyExact overflow');
        }
        value = product;
      } else if (op === '/') {
        this.pos += 1;
        const divisor = this.factor();
        if (divisor === null) return null;
        if (divisor === 0n) return null;
        // Kotlin `value /= divisor` 是向零取整的 Long 除法；BigInt `/` 同样向零取整。
        value = value / divisor;
      } else {
        return value;
      }
    }
  }

  /** Kotlin `private fun expression(): Long?`. */
  private expression(): bigint | null {
    let value = this.term();
    if (value === null) return null;
    for (;;) {
      const op = this.peek();
      if (op === '+') {
        this.pos += 1;
        const term = this.term();
        if (term === null) return null;
        // Kotlin `Math.addExact(value, term)`
        const sum: bigint = value + term;
        if (sum > SimpleArithmetic.LONG_MAX || sum < SimpleArithmetic.LONG_MIN) {
          throw new RangeError('Math.addExact overflow');
        }
        value = sum;
      } else if (op === '-') {
        this.pos += 1;
        const term = this.term();
        if (term === null) return null;
        // Kotlin `Math.subtractExact(value, term)`
        const diff: bigint = value - term;
        if (diff > SimpleArithmetic.LONG_MAX || diff < SimpleArithmetic.LONG_MIN) {
          throw new RangeError('Math.subtractExact overflow');
        }
        value = diff;
      } else {
        return value;
      }
    }
  }
}

/** Kotlin `String.count { it == '(' }`. */
function countChar(value: string, ch: string): number {
  let count = 0;
  for (const c of value) if (c === ch) count += 1;
  return count;
}

/** Kotlin `private fun parseHeaderString(headerJson: String): Map<String, String>` (lines 624-632). */
function parseHeaderString(headerJson: string): Record<string, string> {
  if (headerJson.trim() === '') return {};
  try {
    const parsed: unknown = JSON.parse(headerJson);
    return parseHeaders(isJsonObject(parsed) ? parsed : null);
  } catch {
    return {};
  }
}

/** Kotlin `private fun parseHeaders(headersObj: JSONObject?): Map<String, String>` (lines 636-646). */
function parseHeaders(headersObj: JsonObject | null): Record<string, string> {
  if (headersObj === null) return {};
  const result: Record<string, string> = {};
  for (const key of keys(headersObj)) {
    const value = (optString(headersObj, key, '') ?? '').trim();
    if (value !== '') result[key] = value;
  }
  return result;
}

/** Kotlin `obj.optInt(key, fallback)`. */
function optInt(obj: JsonObject, key: string, fallback: number): number {
  const value = obj[key];
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Kotlin `${e.message}`. */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return e == null ? 'null' : String(e);
}