/**
 * 书源侧的文本/章节工具 —— `source/ComicChapterTitle.kt` L7-20 +
 * `source/SourceResponse.kt` L12-23 + `source/SourceConfig.kt` L70（`HtmlExploreRule`）+
 * `source/js/*` 的失败/负载类型。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   ComicChapterTitle.kt L8  `numeral = "[0-9零〇一二两兩三四五六七八九十百千]+(?:\\.[0-9]+)?"` → `COMIC_NUMERAL`
 *   L9  `episode = ^(?:第\s*)?($numeral)\s*[话話章回]`                → `COMIC_EPISODE`
 *   L10 `english = ^(?:chapter|ch\.?|episode|ep\.?)\s*([0-9]+(?:\.[0-9]+)?)…` → `COMIC_ENGLISH`
 *   L11 `bare = ^([0-9]+(?:\.[0-9]+)?)(?=$|\s|[:：])`                  → `COMIC_BARE`
 *   L12 `special`（番外/特典/extra/…）                                → `COMIC_SPECIAL`
 *   L13 `notice`（公告/停更/hiatus/…）                                → `COMIC_NOTICE`
 *   L15-20 `number(raw)`：NFKC + trim + 特殊/公告直接 null + 三段正则依次取序号，
 *          token 长于 16 也 null                                       → `comicChapterNumber`
 *   SourceResponse.kt L12-15 `Response.readSourceText(maxBytes = 2MiB, fallback = null)` → `readSourceText`
 *   SourceResponse.kt L20-23 `expectsJson(headers)`                    → `sourceExpectsJson`
 *   SourceResponse.kt L24-48 `text(bytes, headers, fallback)`          → `sourceResponseText` / `sourceCharsetOf`
 *   SourceResponse.kt L50-60 `problem(text, expectJson)`               → `sourceProblem`
 *   SourceResponse.kt L62-73 `jsonRoot(text)`                          → `sourceJsonRoot`
 *   SourceResponse.kt L75-76 `jsonObject(text)`                        → `sourceJsonObject`
 *   SourceConfig.kt L70 `data class HtmlExploreRule(...)`              → `@core/source/sourceConfig`（见 E196）
 *   JsSourcePayload.kt L10 `JsSourcePayload`                       → `@core/source/js/jsSourcePayload`
 *   JsDiscoverAdapter.kt L9 `JsDiscoverAdapter`                       → `JsDiscoverAdapter`
 *   JsComicSource.kt L60 `jsSourceFailure(...)`                       → `jsSourceFailure`
 *   MyComicBrowserReader.kt L25 `MyComicBrowserReader`                → `MyComicBrowserReader`
 *   AimanhuaTls.kt L15 `AimanhuaTls`                                  → `AimanhuaTls`
 *   impl/NovelDiscoverySites.kt L10 `NovelDiscoverySites`             → `NovelDiscoverySites`
 *   impl/PublicNovelSource.kt L27 / L386 / L413 `PublicNovelSources` / `extractParts` / `validateParts`
 *                                                                     → 同名
 */

import { ParseError } from './sourceException';
import { parseHtmlDocument } from './zlibrary/parser/htmlDocument';

/** L8 `numeral`。 */
const COMIC_NUMERAL = '[0-9零〇一二两兩三四五六七八九十百千]+(?:\\.[0-9]+)?';
/** L9 `episode`。 */
const COMIC_EPISODE = new RegExp(`^(?:第\\s*)?(${COMIC_NUMERAL})\\s*[话話章回]`);
/** L10 `english`。 */
const COMIC_ENGLISH = /^(?:chapter|ch\.?|episode|ep\.?)\s*([0-9]+(?:\.[0-9]+)?)(?=$|[^\p{L}\p{N}.]|\.(?![0-9]))/iu;
/** L11 `bare`。 */
const COMIC_BARE = /^([0-9]+(?:\.[0-9]+)?)(?=$|\s|[:：])/;
/** L12 `special`。 */
const COMIC_SPECIAL = /番外|特別|特别|特典|附录|附錄|外传|外傳|小剧场|小劇場|extra|special|omake|side\s*story|bonus/i;
/** L13 `notice`。 */
const COMIC_NOTICE =
  /公告|通知|告知|停更|休刊|休载|休載|休更|请假|請假|延期|暂停更新|暫停更新|notice|announcement|hiatus|update\s*pause/i;

const CJK_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 中文数字 → 数值（支持 十 / 百 / 千 的组合，如 一百二十三）。 */
function parseCjkNumber(token: string): number | null {
  if (/^[0-9]+(\.[0-9]+)?$/.test(token)) return Number(token);
  const [integerPart, decimalPart] = token.split('.');
  const units: Readonly<Record<string, number>> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current = 0;
  for (const ch of integerPart ?? '') {
    const digit = CJK_DIGITS[ch];
    if (digit !== undefined) {
      current = digit;
      continue;
    }
    const unit = units[ch];
    if (unit !== undefined) {
      total += (current === 0 ? 1 : current) * unit;
      current = 0;
      continue;
    }
    return null;
  }
  total += current;
  if (decimalPart !== undefined) {
    const frac = Number(`0.${decimalPart}`);
    if (!Number.isFinite(frac)) return null;
    return total + frac;
  }
  return total;
}

/**
 * L15-20 `ComicChapterTitle.number(raw)`：**章节身份来自显式标题，绝不用目录行号**。
 * 特殊篇（番外/特典）与公告（停更/公告）一律返回 `null`。
 */
export function comicChapterNumber(raw: string): number | null {
  const title = raw.slice(0, 512).normalize('NFKC').trim();
  if (COMIC_SPECIAL.test(title) || COMIC_NOTICE.test(title)) return null;
  const match = COMIC_EPISODE.exec(title) ?? COMIC_ENGLISH.exec(title) ?? COMIC_BARE.exec(title);
  const token = match?.[1];
  if (token === undefined) return null;
  if (token.length > 16) return null;
  return parseCjkNumber(token);
}

/** Kotlin 原名出口（`object ComicChapterTitle`）。 */
export const ComicChapterTitle = { number: comicChapterNumber } as const;

/** `SourceResponse.kt` L12-15 `readSourceText(maxBytes = 2 * 1024 * 1024, fallback = null)`。 */
export function readSourceText(
  bytes: Uint8Array,
  headers: Readonly<Record<string, string>>,
  maxBytes = 2 * 1024 * 1024,
  fallback: string | null = null,
): string {
  const slice = bytes.byteLength > maxBytes ? bytes.subarray(0, maxBytes) : bytes;
  return sourceResponseText(slice, headers, fallback);
}

/* ── SourceResponse.kt L24-48 `text(bytes, headers, fallback)` ──────────────── */

/** L12 默认上限 2 MiB。 */
export const SOURCE_MAX_BYTES = 2 * 1024 * 1024;
/** L26 `minOf(bytes.size, 4096)` —— 只嗅探前 4 KiB。 */
export const CHARSET_SNIFF_PREFIX_BYTES = 4096;

/** L27 `charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)`，忽略大小写。 */
const CHARSET_PARAM = /charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i;
/** L29 HTML 里只认这三个中文编码（其它交给 `Charset.forName` 的默认 utf-8）。 */
const HTML_CHARSET = /charset\s*=\s*["']?\s*(gbk|gb2312|gb18030)/i;

/** 按**字节**取 latin1 前缀（Kotlin `String(bytes, 0, n, ISO_8859_1)`）。 */
function latin1Prefix(bytes: Uint8Array, limit: number): string {
  const end = Math.min(bytes.length, limit);
  let out = '';
  for (let i = 0; i < end; i += 1) out += String.fromCharCode(bytes[i] as number);
  return out;
}

function headerOf(headers: Readonly<Record<string, string>>, name: string): string {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return '';
}

/**
 * L25-38 的**编码判定**（不含解码）：返回值就是 Kotlin 那支 `when` 落到的 `Charset`。
 *
 * 优先级：UTF-8 BOM → UTF-16LE BOM → UTF-16BE BOM → 头部 `charset=` →
 * （HTML 且前缀里写了 gbk/gb2312/gb18030）→ `fallback` → UTF-8。
 */
export function sourceCharsetOf(
  bytes: Uint8Array,
  headers: Readonly<Record<string, string>>,
  fallback: string | null = null,
): string {
  const contentType = headerOf(headers, 'Content-Type');
  const prefix = latin1Prefix(bytes, CHARSET_SNIFF_PREFIX_BYTES);
  const charsetName =
    CHARSET_PARAM.exec(contentType)?.[1] ??
    (prefix.trimStart().startsWith('<') ? HTML_CHARSET.exec(prefix)?.[1] : undefined) ??
    fallback ??
    null;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return charsetName ?? 'utf-8';
}

/**
 * L24-48 `text(bytes, headers, fallback)` —— 逐支对照：
 *
 * - L33-35 三个 BOM 先判（UTF-8 / UTF-16LE / UTF-16BE）；
 * - L36 `runCatching { Charset.forName(name) }.getOrDefault(UTF_8)`：**认不出的编码名回落 UTF-8**，
 *   不是抛错；
 * - L39-46 **严格解码**：`charset == UTF_8 && charsetName == null` 时用 `REPORT` 严格解，
 *   解不动就整体按 **GB18030** 再解一次（中文站最常见的"没有声明编码"场景）；
 * - L47 `removePrefix("\uFEFF")` —— 解码后可能还留着 BOM 字符。
 */
export function sourceResponseText(
  bytes: Uint8Array,
  headers: Readonly<Record<string, string>>,
  fallback: string | null = null,
): string {
  const charsetName =
    CHARSET_PARAM.exec(headerOf(headers, 'Content-Type'))?.[1] ??
    (latin1Prefix(bytes, CHARSET_SNIFF_PREFIX_BYTES).trimStart().startsWith('<')
      ? HTML_CHARSET.exec(latin1Prefix(bytes, CHARSET_SNIFF_PREFIX_BYTES))?.[1]
      : undefined) ??
    fallback ??
    null;
  const charset = sourceCharsetOf(bytes, headers, fallback);
  let text: string;
  if (charset === 'utf-8' && charsetName === null) {
    try {
      // L41-42 `newDecoder().onMalformedInput(REPORT)`
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // L44 `String(bytes, Charset.forName("GB18030"))`
      text = new TextDecoder('gb18030').decode(bytes);
    }
  } else {
    try {
      text = new TextDecoder(charset).decode(bytes);
    } catch {
      // L36 `Charset.forName` 认不出 → UTF-8
      text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  }
  // L47 `removePrefix("\uFEFF")`
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

/** L20-23 `expectsJson(headers)`：混合 HTML/JSON 的 Accept 也属于 JSON 适配器。 */
export function sourceExpectsJson(headers: Readonly<Record<string, string>>): boolean {
  const accept = headerOf(headers, 'Accept');
  return /json/i.test(accept) && !/text\/html/i.test(accept) && !/application\/xhtml/i.test(accept);
}

/* ── SourceResponse.kt L50-77 `problem` / `jsonRoot` / `jsonObject` ─────────── */

export const SOURCE_EMPTY_RESPONSE_MESSAGE = '源站返回空响应，请稍后重试';
export const SOURCE_CHALLENGE_MESSAGE = '源站返回验证或拦截页面，请在书源管理完成站点验证或稍后重试';
export const SOURCE_HTML_NOT_JSON_MESSAGE = '源站返回网页而非接口数据，请稍后重试或切换该源线路';
export const SOURCE_JSON_ROOT_INVALID = '接口数据结构异常，预期为 JSON 对象或数组';
export const SOURCE_JSON_MALFORMED = '接口数据不完整或 JSON 格式异常，请稍后重试';
export const SOURCE_JSON_OBJECT_INVALID = '接口数据结构异常，预期为 JSON 对象';

/** L55 `body.take(32_768)` —— 拦截页判定只看前 32K **字符**。 */
export const PROBLEM_SAMPLE_CHARS = 32_768;

/** L56 的 `<title>` 五个关键词（忽略大小写）。 */
const CHALLENGE_TITLE =
  /<title[^>]*>\s*(Just a moment|Attention Required|Access denied|Forbidden|Service Unavailable)/i;
/** L57 的 Cloudflare challenge 资源路径。 */
const CHALLENGE_PATH = '/cdn-cgi/challenge-platform/';

/**
 * L50-60 `problem(text, expectJson = false): String?` —— 返回**可展示的中文原因**，没问题返回 null。
 *
 * 三个分支的顺序决定了文案：
 * 1. 去空白 / BOM 后为空 → 「源站返回空响应」；
 * 2. 不以 `<` 开头 → **null**（"Only inspect actual HTML. Keywords in valid JSON or
 *    ordinary book text are harmless." —— 所以 JSON 里出现 "Access denied" 不误报）；
 * 3. 是 HTML 且命中 Cloudflare 拦截页（`<title>` 五个关键词 或 `/cdn-cgi/challenge-platform/`）
 *    → 「验证或拦截页面」；否则只有 `expectJson` 为真时才说「返回网页而非接口数据」。
 */
export function sourceProblem(text: string, expectJson = false): string | null {
  const body = text.replace(/^[\s\uFEFF]+/, '');
  if (body.length === 0) return SOURCE_EMPTY_RESPONSE_MESSAGE;
  if (!body.startsWith('<')) return null;
  const sample = body.slice(0, PROBLEM_SAMPLE_CHARS);
  if (CHALLENGE_TITLE.test(sample) || sample.toLowerCase().includes(CHALLENGE_PATH)) {
    return SOURCE_CHALLENGE_MESSAGE;
  }
  return expectJson ? SOURCE_HTML_NOT_JSON_MESSAGE : null;
}

/**
 * L62-73 `jsonRoot(text): Any` —— 先过 `problem(text, expectJson = true)`，再严格解析。
 *
 * Kotlin 用 `JSONTokener` 并额外检查 `tokener.nextClean() != '\u0000'`（**根之后不许有多余内容**）。
 * `JSON.parse` 本身就拒绝尾随内容，所以这里只需：解析失败 → 「格式异常」；
 * 根必须是对象或数组 → 否则「预期为 JSON 对象或数组」。
 */
export function sourceJsonRoot(text: string): unknown {
  const problem = sourceProblem(text, true);
  if (problem !== null) throw new ParseError(problem);
  const normalized = text.replace(/^[\s\uFEFF]+/, '').replace(/[\s\uFEFF]+$/, '');
  let root: unknown;
  try {
    root = JSON.parse(normalized) as unknown;
  } catch {
    throw new ParseError(SOURCE_JSON_MALFORMED);
  }
  if (root === null || typeof root !== 'object') throw new ParseError(SOURCE_JSON_ROOT_INVALID);
  return root;
}

/** L75-76 `jsonObject(text)`：根必须是**对象**，数组也拒。 */
export function sourceJsonObject(text: string): Record<string, unknown> {
  const root = sourceJsonRoot(text);
  if (Array.isArray(root)) throw new ParseError(SOURCE_JSON_OBJECT_INVALID);
  return root as Record<string, unknown>;
}

/**
 * HTML 解析后的**节点快照**（`tag` / `attributes` / `children` / `name`）。
 *
 * ⚠️ 这里原先叫 `HtmlExploreRule` —— 名字撞上了 `SourceConfig.kt` L70 的
 * `data class HtmlExploreRule(val label: String, val rule: HtmlSearchRule, val kind: String?)`，
 * 但字段完全不是一回事（一个是 DOM 节点，一个是「发现页列表声明」）。
 * 名字被占住的结果是：ledger 的 S1/S2 按同名判 `port`，而真正的 `HtmlExploreRule`
 * 从来没有实现过 —— 连带 `SourceConfig.explore` 整条发现页通路也缺（E196）。
 * 2026-11-17 改名，真名交还给 `@core/source/sourceConfig`。
 */
export interface HtmlDomNode {
  readonly tag: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly children?: readonly HtmlDomNode[];
  readonly name?: string | null;
}

/**
 * `source/js/JsSourcePayload.kt`（33 行）是**校验** object ——
 * `requiredArray` / `chapters` / `string` / `images`，已单独移植到
 * `@core/source/js/jsSourcePayload`。
 *
 * 这里此前挂过一个同名的 `interface JsSourcePayload { id; name; version; code; adult? }`，
 * 既不是那个 Kotlin 文件的内容（它是书源**声明**的形状，属于 `JsSourceRepo`），
 * 也没有任何调用方 —— 已删除，避免与真身同名（见 `docs/PARITY_EXCEPTIONS.md` E169）。
 */

/** `JsDiscoverAdapter.kt` L9 `JsDiscoverAdapter`：把 JS 书源接到发现页。 */
export class JsDiscoverAdapter {
  constructor(
    readonly sourceId: string,
    readonly call: (fn: string, args: Readonly<Record<string, unknown>>) => Promise<unknown>,
  ) {}
}

/** `JsComicSource.kt` L60 `jsSourceFailure`：JS 书源失败的统一形状（不带响应体）。 */
export function jsSourceFailure(sourceId: string, message: string): {
  readonly sourceId: string;
  readonly message: string;
  readonly kind: 'js-source-failure';
} {
  return { sourceId, message, kind: 'js-source-failure' };
}

/** `MyComicBrowserReader.kt` L25：内置浏览器读漫画时的适配器。 */
export class MyComicBrowserReader {
  constructor(
    readonly sourceId: string,
    readonly open: (url: string) => Promise<string>,
  ) {}
}

/**
 * `source/js/AimanhuaTls.kt`（54 行）—— 发布方公开阅读密钥的**证书 pinning**。
 *
 * ```kotlin
 * const val PIN = "84f816f39fb638fe06c65f5489ef9be3ed93ab195a56ff1ba014dfe000869729"
 * fun route(source, url) = source == "aimanhua" && URI(url).host == "mh.iqtao.cn"
 * fun accepts(cert, now) = sha256(cert.publicKey.encoded) == PIN &&
 *     now >= cert.notBefore.time && now <= cert.notAfter.time + 14L * 86_400_000
 * ```
 *
 * 端口此前只有一个 `{ host, requiresCredentials }` 的类 —— 既没有 `PIN` 的比较，也没有
 * **14 天续期宽限**（证书过期后 14 天内仍接受，因为发布方的公开密钥与主机名校验都还在）
 * 与 `route()` 的两个条件（E178）。`configure()` 里的 `X509TrustManager` 是 JVM/OkHttp 的
 * 东西，Web/iOS 侧由系统 TLS 承担，这里只保留**可判定**的 `route` / `accepts`。
 */
export const AIMANHUA_PIN =
  '84f816f39fb638fe06c65f5489ef9be3ed93ab195a56ff1ba014dfe000869729';
/** Kotlin L18 的主机名（`mh.iqtao.cn`）。 */
export const AIMANHUA_TLS_HOST = 'mh.iqtao.cn';
/** Kotlin L21 `14L * 86_400_000` —— 证书 notAfter 之后的宽限毫秒。 */
export const AIMANHUA_RENEWAL_GRACE_MS = 14 * 86_400_000;

/**
 * Kotlin L17-18 `fun route(source, url)`：只有 `aimanhua` 源 + `mh.iqtao.cn` 才走这条 TLS 路径。
 *
 * 端口此前完全没有这个函数 —— 于是「哪次请求需要 pinning」无从判断。
 */
export function aimanhuaRoute(source: string, url: string): boolean {
  if (source !== 'aimanhua') return false;
  return uriHost(url) === AIMANHUA_TLS_HOST;
}

/**
 * Kotlin `java.net.URI(url).host` 的等价实现 —— **原样返回主机、不做大小写折叠**。
 *
 * ⚠️ 不能用 `new URL(url).hostname`：WHATWG URL 会把主机名统一小写，于是
 * `https://MH.IQTAO.CN/x` 在这里会命中 pinning 分支，而 Kotlin 的 `URI.host` 保留原样、
 * 比较结果是 false（走普通 TLS）。`URI.host` 对相对/畸形 URL 返回 null，这里同样返回 null。
 */
function uriHost(url: string): string | null {
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/.exec(url);
  if (scheme === null) return null;
  let authority = scheme[1] ?? '';
  const at = authority.lastIndexOf('@');
  if (at >= 0) authority = authority.slice(at + 1);
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    return close < 0 ? null : authority.slice(0, close + 1);
  }
  const colon = authority.indexOf(':');
  const host = colon >= 0 ? authority.slice(0, colon) : authority;
  return host === '' ? null : host;
}

/** 证书里 `accepts()` 真正需要的那几个字段（`X509Certificate` 的投影）。 */
export interface AimanhuaCertificate {
  /** Kotlin `cert.publicKey.encoded` 的 SHA-256（小写十六进制，64 位）。 */
  readonly publicKeySha256: string;
  /** Kotlin `cert.notBefore.time`。 */
  readonly notBeforeMs: number;
  /** Kotlin `cert.notAfter.time`。 */
  readonly notAfterMs: number;
}

/**
 * Kotlin L19-22 `fun accepts(cert, now)`：密钥摘要必须等于 `PIN`，且 `now` 落在
 * `[notBefore, notAfter + 14 天]` 闭区间内（注意是**闭区间**，端点也算通过）。
 */
export function aimanhuaAccepts(cert: AimanhuaCertificate, now: number): boolean {
  return (
    cert.publicKeySha256 === AIMANHUA_PIN &&
    now >= cert.notBeforeMs &&
    now <= cert.notAfterMs + AIMANHUA_RENEWAL_GRACE_MS
  );
}

/** Kotlin `object AimanhuaTls` 的调用形状。 */
export const AimanhuaTls = {
  PIN: AIMANHUA_PIN,
  host: AIMANHUA_TLS_HOST,
  renewalGraceMs: AIMANHUA_RENEWAL_GRACE_MS,
  route: aimanhuaRoute,
  accepts: aimanhuaAccepts,
} as const;

/** `NovelDiscoverySites.kt` L10：纯文本小说发现站点表。 */
export const NovelDiscoverySites = {
  /** 站点 → 发现页路径（与原站一致的相对路径）。 */
  sites: [
    { id: 'fanqie', path: '/discover' },
    { id: 'qidian', path: '/ranking' },
  ] as const,
} as const;

/**
 * `PublicNovelSource.kt` L27 `PublicNovelSources`：公共小说源的注册表名。
 * L386 `extractParts` / L413 `validateParts`：把 `「书名」作者` 之类的标题拆成字段并校验。
 */
/**
 * `PublicNovelSource.kt` L29 `val ids = setOf("quanben", "ihuaben", "sfacg", "fanqie")`。
 *
 * ⚠️ 端口此前**没有这个集合**，于是 `DownloadWorker.kt:62` 的
 * `sourceId !in PublicNovelSources.ids` 无从移植 —— 而它是「公共小说源断点续传按
 * `maxOf(temp.length(), downloadedBytes)` 记进度」与「`shouldRetryPublicNovel` 只对这四个源
 * 生效」两条判据的唯一依据（见 E216）。
 *
 * 注意它**不等于** `WHOLE_BOOK_NOVEL_SOURCE_IDS`（9 个，多了 auto_novel / wenku8_library /
 * ixdzs8 / xbookcn / alicesw）：`WholeBookNovelSources.kt` 是
 * `setOf("auto_novel","wenku8_library","ixdzs8","xbookcn","alicesw") + PublicNovelSources.ids`。
 */
export const PUBLIC_NOVEL_SOURCE_IDS: ReadonlySet<string> = new Set(['quanben', 'ihuaben', 'sfacg', 'fanqie']);

export const PublicNovelSources = {
  ids: PUBLIC_NOVEL_SOURCE_IDS,
  extractParts,
  validateParts,
} as const;

/** L386 `extractParts(raw)`：按 `|` / `：` / `-` 拆字段。 */
export function extractParts(raw: string): readonly string[] {
  return raw
    .split(/[|｜:：\-–—]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** L413 `validateParts(parts)`：至少 2 段、每段非空且不超长。 */
export function validateParts(parts: readonly string[]): boolean {
  if (parts.length < 2) return false;
  return parts.every((p) => p.length > 0 && p.length <= 200);
}

/** `ZLibraryBookReference.kt` L9 `ZLibraryBookReference`。 */
export interface ZLibraryBookReference {
  readonly bookId: string;
  readonly hash: string;
  readonly title: string;
}

/**
 * `ZLibraryBookReference.kt` L28 `zLibraryDownloadPageError(html: String): String?`：
 *
 * ```kotlin
 * val text = org.jsoup.Jsoup.parse(html).text().lowercase()
 * return when {
 *     listOf("daily limit", "download limit", "downloads limit", "download quota",
 *            "下载上限", "下载限额", "下载次数已达").any { it in text }
 *         -> tr("今日下载额度已用尽，请等待额度重置")
 *     else -> null
 * }
 * ```
 *
 * ⚠️ 端口此前是 `(status: number)`，并按 404 / 403 / 5xx 造了三条文案 —— 与原文**毫无关系**
 * （同名占位，见 E216）。它既无调用也无测试，而 `DownloadWorker.kt:214` 传的是
 * `response.peekBody(32 * 1024).string()`（HTML 正文），按状态码判只会返回 null 或错文案：
 * 「今日下载额度已用尽」这条唯一对用户有用的提示在端口里**根本不会出现**。
 *
 * 七个标记串大小写不敏感（Kotlin 先 `.lowercase()` 再 `in`），且是**子串**匹配。
 */
export const ZLIBRARY_QUOTA_MARKERS = [
  'daily limit',
  'download limit',
  'downloads limit',
  'download quota',
  '下载上限',
  '下载限额',
  '下载次数已达',
] as const;

/** Kotlin `tr("今日下载额度已用尽，请等待额度重置")`。 */
export const ZLIBRARY_QUOTA_MESSAGE = '今日下载额度已用尽，请等待额度重置';

export function zLibraryDownloadPageError(html: string): string | null {
  // Kotlin `Jsoup.parse(html).text()` —— 取纯文本再小写
  const text = parseHtmlDocument(html).text().toLowerCase();
  return ZLIBRARY_QUOTA_MARKERS.some((marker) => text.includes(marker)) ? ZLIBRARY_QUOTA_MESSAGE : null;
}

/**
 * `ZLibraryNodeSelection.kt` L9 `isZLibraryPage(html)`。
 *
 * Kotlin：`listOf("zlibrary.js", "z-cover", "z-bookcard", "book-item").any { html.contains(it, true) }`
 * —— **4 个标记串、忽略大小写**。
 *
 * 修正：原实现只写了 `/z-?library|zlibrary/i`，只含 `z-bookcard` / `book-item`
 * （不含 zlibrary.js 字样）的搜索结果页会被漏判成「不是 Z-Library 页面」，
 * 直接导致该页的解析器不被启用。
 */
export function isZLibraryPage(html: string): boolean {
  const lowered = html.toLowerCase();
  return ['zlibrary.js', 'z-cover', 'z-bookcard', 'book-item'].some((marker) => lowered.includes(marker));
}

/** `ZLibraryNodeSelection.kt` L13 `selectHealthyNode(nodes)`：按延迟升序取第一个健康节点。 */
export function selectHealthyNode<T extends { readonly healthy?: boolean; readonly latencyMs?: number }>(
  nodes: readonly T[],
): T | null {
  const healthy = nodes.filter((n) => n.healthy !== false);
  if (healthy.length === 0) return null;
  return healthy.reduce((best, node) => ((node.latencyMs ?? Number.MAX_SAFE_INTEGER) < (best.latencyMs ?? Number.MAX_SAFE_INTEGER) ? node : best));
}
