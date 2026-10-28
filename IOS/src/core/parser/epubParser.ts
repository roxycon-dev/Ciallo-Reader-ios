/**
 * EPUB parser — port of Android `EpubParser.kt` to pure TS.
 *
 * Kotlin unzips to a temp dir and reads from disk; this port keeps the archive
 * in memory (`ZipIndex`) and substitutes `File` lookups with `zipLookup`.
 * The mimetype/STORED rule needs no special handling on either side: Android's
 * `ZipInputStream` walks the central/local headers and never inspects
 * `mimetype`, and `fflate.unzipSync` does not either.
 *
 * Line references in comments are `novel-reader/app/src/main/java/com/example/data/EpubParser.kt`.
 */

import { unzipSync } from 'fflate';
import { decodeTextWithCharsetDetection } from './charsetSniffer';
import {
  EPUB_SUPPORTED_IMAGE_EXTENSIONS,
  buildImageToken,
  createImageSourceSet,
  embedImageTokens,
  type EpubImageSource,
  type EpubImageTokenOptions,
} from './epubImageTokens';
import { extractCleanTextFromHtml } from './htmlToText';
import { probeImageMime, probeImageSize } from './imageBytes';
import { MAX_CHAPTER_LENGTH, splitChapterText } from '@core/data/splitChapterText';

export function isEpubFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.epub');
}

export interface ParsedEpub {
  title: string | null;
  author: string | null;
  coverHref: string | null;
  chapters: Array<{ title: string; content: string }>;
}

/** Kotlin L57 — allowed (non-DRM) `EncryptionMethod/@Algorithm` values. */
const DRM_ALLOWED = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC',
]);

/** Kotlin L199 — violent-fallback cover scan extensions (no gif, no bmp). */
const COVER_SCAN_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

// ---------------------------------------------------------------------------
// Zip helpers
// ---------------------------------------------------------------------------

function u16(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) return 0;
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

/**
 * Kotlin L872-878 `decodeUrl` = `URLDecoder.decode(path, "UTF-8")`.
 * `URLDecoder` (form decoding) maps `+` to a space; `decodeURIComponent` does not,
 * so an href like `chap+1.xhtml` resolves to a different file on the two platforms.
 * Kotlin returns the raw string when percent-decoding throws (L875-877).
 */
function decodeUrl(path: string): string {
  try {
    return decodeURIComponent(path.replace(/\+/g, '%20'));
  } catch {
    return path;
  }
}

function normalizeZipPath(path: string): string {
  let p = decodeUrl(path);
  const hash = p.indexOf('#');
  if (hash >= 0) p = p.slice(0, hash);
  const q = p.indexOf('?');
  if (q >= 0) p = p.slice(0, q);
  p = p.replace(/\\/g, '/');
  while (p.startsWith('/')) p = p.slice(1);
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function joinZipPath(dir: string, rel: string): string {
  return normalizeZipPath(dir ? `${dir}/${rel}` : rel);
}

function dirnameZip(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

function basenameZip(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** Kotlin `File(name).extension` — substring after the last '.', "" when none. */
function imageExtOf(path: string): string {
  const name = basenameZip(path);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Kotlin `File(name).nameWithoutExtension`. */
function stemZip(path: string): string {
  const name = basenameZip(path);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(0, dot) : name;
}

/** Express `path` relative to `dir` — Kotlin `File.relativeTo(dir).invariantSeparatorsPath`. */
function relativeToZip(dir: string, path: string): string {
  if (dir === '') return path;
  if (path === dir) return '';
  if (path.startsWith(`${dir}/`)) return path.slice(dir.length + 1);
  return path;
}

interface ZipIndex {
  entries: Record<string, Uint8Array>;
  lower: Map<string, string>;
}

function buildZipIndex(entries: Record<string, Uint8Array>): ZipIndex {
  const lower = new Map<string, string>();
  for (const key of Object.keys(entries)) {
    const l = key.toLowerCase();
    if (!lower.has(l)) lower.set(l, key);
  }
  return { entries, lower };
}

function zipLookup(index: ZipIndex, path: string): Uint8Array | null {
  const clean = normalizeZipPath(path);
  if (!clean) return null;
  const direct = index.entries[clean];
  if (direct) return direct;
  // Kotlin `findMatchingCoverFile` L419-436 also walks the tree case-insensitively
  // (L422: `relPath == cleanLower || file.name.lowercase() == cleanNameLower`).
  const byLower = index.lower.get(clean.toLowerCase());
  if (byLower !== undefined) {
    const found = index.entries[byLower];
    if (found) return found;
  }
  return null;
}

/**
 * Charset fallback for zip entry names: when the central-directory UTF-8 flag
 * is not set, re-decode raw name bytes as GB18030 and remap keys.
 */
function remapEntryNames(
  zipBytes: Uint8Array,
  entries: Record<string, Uint8Array>,
): Record<string, Uint8Array> {
  const maxScan = Math.min(zipBytes.length, 66_000);
  let eocd = -1;
  for (let i = zipBytes.length - 22; i >= Math.max(0, zipBytes.length - maxScan); i -= 1) {
    if (u32(zipBytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return entries;
  const totalEntries = u16(zipBytes, eocd + 10);
  const cdOffset = u32(zipBytes, eocd + 16);
  if (totalEntries <= 0 || totalEntries > 100_000) return entries;

  const remapped: Record<string, Uint8Array> = { ...entries };
  let pos = cdOffset;
  for (let e = 0; e < totalEntries; e += 1) {
    if (u32(zipBytes, pos) !== 0x02014b50) break;
    const flags = u16(zipBytes, pos + 8);
    const nameLen = u16(zipBytes, pos + 28);
    const nameStart = pos + 46;
    if (nameStart + nameLen > zipBytes.length) break;
    const rawName = zipBytes.subarray(nameStart, nameStart + nameLen);
    const utf8Flag = (flags & 0x800) !== 0;
    if (!utf8Flag && rawName.length > 0) {
      const utf8Name = new TextDecoder('utf-8').decode(rawName);
      const gbkName = new TextDecoder('gb18030').decode(rawName);
      if (gbkName !== utf8Name) {
        const payload = entries[utf8Name];
        if (payload) remapped[gbkName] = payload;
      }
    }
    pos = nameStart + nameLen + u16(zipBytes, pos + 30) + u16(zipBytes, pos + 32);
  }
  return remapped;
}

function unzipEpub(zipBytes: Uint8Array): ZipIndex {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    throw new Error('无法解压 EPUB 文件');
  }
  const remapped = remapEntryNames(zipBytes, entries);
  return buildZipIndex(remapped);
}

// ---------------------------------------------------------------------------
// Charset-declared text reading — Kotlin L605-633 `readTextWithCharsetDetection`
// ---------------------------------------------------------------------------

/** Kotlin L618 — `(?:xml.*encoding|charset)\s*=\s*["']?([a-zA-Z0-9_-]+)["']?` (IGNORE_CASE, no DOTALL, greedy `.*`). */
const DECLARED_ENCODING_RE = /(?:xml.*encoding|charset)\s*=\s*["']?([a-zA-Z0-9_-]+)["']?/i;

/** Kotlin `Charset.forName(name)` aliases → WHATWG TextDecoder labels. */
const JAVA_CHARSET_LABELS: Record<string, string> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  'unicode-1-1-utf-8': 'utf-8',
  'utf-16': 'utf-16',
  'utf-16le': 'utf-16le',
  'utf-16be': 'utf-16be',
  'x-utf-16le': 'utf-16le',
  'x-utf-16be': 'utf-16be',
  gbk: 'gbk',
  cp936: 'gbk',
  'windows-936': 'gbk',
  gb2312: 'gbk',
  'euc-cn': 'gbk',
  'x-euc-cn': 'gbk',
  'iso-ir-58': 'gbk',
  gb18030: 'gb18030',
  'gb18030-2000': 'gb18030',
  big5: 'big5',
  'big5-hkscs': 'big5',
  'cn-big5': 'big5',
  csbig5: 'big5',
  shift_jis: 'shift_jis',
  sjis: 'shift_jis',
  ms_kanji: 'shift_jis',
  'ms-kanji': 'shift_jis',
  'windows-31j': 'shift_jis',
  csshiftjis: 'shift_jis',
  'x-sjis': 'shift_jis',
  'euc-jp': 'euc-jp',
  'euc-kr': 'euc-kr',
  euc_kr: 'euc-kr',
  korean: 'euc-kr',
  ks_c_5601_1987: 'euc-kr',
  'ks_c_5601-1987': 'euc-kr',
  'windows-949': 'euc-kr',
  'x-euc-kr': 'euc-kr',
  ibm949: 'euc-kr',
};

/** null when Java would throw `UnsupportedCharsetException` → Kotlin falls back to the sniffer. */
function javaCharsetLabel(name: string): string | null {
  const key = name.toLowerCase().replace(/_/g, '-');
  const mapped = JAVA_CHARSET_LABELS[key];
  if (mapped) return mapped;
  try {
    // WhatWG Encoding Standard labels (iso-8859-*, windows-125x, koi8-*, ...).
    new TextDecoder(name);
    return name;
  } catch {
    return null;
  }
}

/**
 * Kotlin L605-633. Order is load-bearing: UTF-8 BOM → declared encoding →
 * `CharsetSniffer.detect`. Any failure raises `EPUB 文本编码无法识别：<basename>`.
 */
function decodeEntryBytes(bytes: Uint8Array, name: string): string {
  try {
    if (bytes.length === 0) return '';
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    const sampleSize = Math.min(bytes.length, 2048);
    const header = new TextDecoder('iso-8859-1').decode(bytes.subarray(0, sampleSize));
    const declared = DECLARED_ENCODING_RE.exec(header)?.[1];
    if (declared !== undefined && declared.trim() !== '') {
      const label = javaCharsetLabel(declared);
      if (label) return new TextDecoder(label).decode(bytes);
      // Kotlin L626: `catch (_: Exception) {}` → fall through to the sniffer.
    }
    return decodeTextWithCharsetDetection(bytes);
  } catch {
    throw new Error(`EPUB 文本编码无法识别：${name}`);
  }
}

function readEntryText(index: ZipIndex, path: string): string | null {
  const bytes = zipLookup(index, path);
  if (!bytes) return null;
  return decodeEntryBytes(bytes, basenameZip(path));
}

// ---------------------------------------------------------------------------
// XML helpers (regex-based)
// ---------------------------------------------------------------------------

/** Kotlin `parser.getAttributeName(i).lowercase()` + `== name || endsWith(":$name")`. */
function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)(?:[^\\s:]*:)?${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  return re.exec(tag)?.[1] ?? null;
}

/**
 * jsoup `Element.attr(name)` — the XML parser keeps attribute case, so the lookup
 * is exact. Only used where Kotlin calls `node.attr(...)`/`getAttributeValue(...)`
 * instead of the namespace-unaware pull parser's lowercased name scan.
 */
function getAttrCaseSensitive(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`);
  return re.exec(tag)?.[1] ?? null;
}

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: '\u00A0',
  iexcl: '¡',
  cent: '¢',
  pound: '£',
  curren: '¤',
  yen: '¥',
  brvbar: '¦',
  sect: '§',
  uml: '¨',
  copy: '©',
  ordf: 'ª',
  laquo: '«',
  not: '¬',
  shy: '­',
  reg: '®',
  macr: '¯',
  deg: '°',
  plusmn: '±',
  sup2: '²',
  sup3: '³',
  acute: '´',
  micro: 'µ',
  para: '¶',
  middot: '·',
  cedil: '¸',
  sup1: '¹',
  ordm: 'º',
  raquo: '»',
  frac14: '¼',
  frac12: '½',
  frac34: '¾',
  iquest: '¿',
  hellip: '…',
  Agrave: 'À',
  Aacute: 'Á',
  Acirc: 'Â',
  Atilde: 'Ã',
  Auml: 'Ä',
  Aring: 'Å',
  AElig: 'Æ',
  Ccedil: 'Ç',
  Egrave: 'È',
  Eacute: 'É',
  Ecirc: 'Ê',
  Euml: 'Ë',
  Igrave: 'Ì',
  Iacute: 'Í',
  Icirc: 'Î',
  Iuml: 'Ï',
  ETH: 'Ð',
  Ntilde: 'Ñ',
  Ograve: 'Ò',
  Oacute: 'Ó',
  Ocirc: 'Ô',
  Otilde: 'Õ',
  Ouml: 'Ö',
  times: '×',
  Oslash: 'Ø',
  Ugrave: 'Ù',
  Uacute: 'Ú',
  Ucirc: 'Û',
  Uuml: 'Ü',
  Yacute: 'Ý',
  THORN: 'Þ',
  szlig: 'ß',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  eth: 'ð',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  divide: '÷',
  oslash: 'ø',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  thorn: 'þ',
  yuml: 'ÿ',
  OElig: 'Œ',
  oelig: 'œ',
  Scaron: 'Š',
  scaron: 'š',
  Yuml: 'Ÿ',
  fnof: 'ƒ',
  circ: 'ˆ',
  tilde: '˜',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '‌',
  zwj: '‍',
  lrm: '‎',
  rlm: '‏',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  dagger: '†',
  Dagger: '‡',
  bull: '•',
  permil: '‰',
  prime: '′',
  Prime: '″',
  lsaquo: '‹',
  rsaquo: '›',
  oline: '‾',
  frasl: '⁄',
  euro: '€',
  trade: '™',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  crarr: '↵',
  lceil: '⌈',
  rceil: '⌉',
  lfloor: '⌊',
  rfloor: '⌋',
  loz: '◊',
  spades: '♠',
  clubs: '♣',
  hearts: '♥',
  diams: '♦',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  omega: 'ω',
  Alpha: 'Α',
  Beta: 'Β',
  Gamma: 'Γ',
  Delta: 'Δ',
  Epsilon: 'Ε',
  Zeta: 'Ζ',
  Eta: 'Η',
  Theta: 'Θ',
  Lambda: 'Λ',
  Pi: 'Π',
  Sigma: 'Σ',
  Omega: 'Ω',
};

/**
 * jsoup decodes the whole HTML5 named-entity set while parsing, so a chapter body
 * never carries a literal `&mdash;`. Kotlin's own `unescapeHtml` (L842-870) is
 * never reached on that path — it exists for other call sites. This decoder is
 * therefore single-pass: `&amp;lt;` must stay `&lt;`, matching jsoup.
 */
export function unescapeHtml(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole: string, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

/**
 * `true` for the code points jsoup's `StringUtil.isWhitespace` treats as breaks:
 * ASCII whitespace plus `Character.isSpaceChar` (the Zs category). Deliberately
 * excludes U+FEFF and U+0085/U+008A, which `String.prototype.trim()` folds but jsoup
 * does not.
 */
function isJsoupSpace(code: number): boolean {
  if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) return true;
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/**
 * jsoup `Element.text()` for a TOC label (Kotlin L649 `link.text()` /
 * `selectFirst("navLabel")?.text()`): `StringUtil.normaliseWhitespace`, which folds
 * runs of jsoup whitespace to one space and trims the ends with the same predicate.
 */
function cleanInline(raw: string): string {
  const text = unescapeHtml(stripTags(raw));
  let out = '';
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (isJsoupSpace(c)) {
      if (!lastWasSpace) out += ' ';
      lastWasSpace = true;
    } else {
      out += text.charAt(i);
      lastWasSpace = false;
    }
  }
  let start = 0;
  let end = out.length;
  while (start < end && isJsoupSpace(out.charCodeAt(start))) start += 1;
  while (end > start && isJsoupSpace(out.charCodeAt(end - 1))) end -= 1;
  return out.slice(start, end);
}

/**
 * Kotlin L823-840 `extractCleanTextFromHtml` — jsoup parse, drop
 * `script, style, head, rt, rp`, then newline around every block element
 * (`node.isBlock`) and around `<br>`, and finally blank-line join trimmed lines.
 * `htmlToText.ts` reproduces exactly that (it shares jsoup's `Tags.isBlock`
 * list via `legadoRule.BLOCK_TAGS`), so the regex version that used to live
 * here is dropped rather than maintained in two places.
 */
export function extractCleanTextFromHtmlLocal(html: string): string {
  return extractCleanTextFromHtml(html);
}

// ---------------------------------------------------------------------------
// Chapter title — Kotlin L691-713
// ---------------------------------------------------------------------------

function extractChapterTitle(rawHtml: string, tocTitle: string | null): string {
  // Kotlin L692 returns `tocTitle` verbatim; `readTocTitles` already `.trim()`ed it.
  if (tocTitle !== null && tocTitle.trim().length > 0) return tocTitle;
  const heading = /<(?:h1|h2|h3|title)[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|title)>/i.exec(rawHtml);
  if (heading?.[1]) {
    const clean = extractCleanTextFromHtmlLocal(heading[1]).trim();
    if (clean.length > 0 && clean.length < 50) return clean;
  }
  const cleanText = extractCleanTextFromHtmlLocal(rawHtml);
  const firstLine = cleanText.split('\n').find((l) => l.length > 0) ?? '';
  if (firstLine.length > 0) {
    return firstLine.length > 30 ? `${firstLine.slice(0, 30)}...` : firstLine;
  }
  return '未命名章节';
}

// ---------------------------------------------------------------------------
// container.xml / OPF / TOC
// ---------------------------------------------------------------------------

/** Kotlin L362-383 — first `<rootfile>` with a non-blank `full-path`. */
function parseContainerXml(text: string): string | null {
  // Kotlin L365-372: `factory.isNamespaceAware = false` + `parser.name == "rootfile"`,
  // so the pull parser matches the literal (unprefixed) tag name, and
  // `getAttributeValue(null, "full-path")` matches the literal unprefixed attribute.
  for (const m of text.matchAll(/<rootfile\b[^>]*>/g)) {
    const raw = getAttrCaseSensitive(m[0], 'full-path');
    if (raw === null) continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/** Which declaration produced `coverHref` — Kotlin L560-589 resolves priority in this order. */
type CoverSource = 'epub3' | 'epub2' | 'guide';

interface OpfData {
  title: string;
  author: string;
  coverHref: string | null;
  coverSource: CoverSource | null;
  epubVersion: '2' | '3';
  manifest: Map<string, string>;
  spine: string[];
}

function parseOpfXml(xml: string): OpfData {
  let epub3CoverHref: string | null = null;
  let epub2CoverId: string | null = null;
  let guideCoverHref: string | null = null;
  let epubVersion: '2' | '3' = '2';
  const manifest = new Map<string, string>();
  const spine: string[] = [];

  // Kotlin L468-477: only `<package>` (namespace-unaware pull parser sees `dc:foo`
  // verbatim, which is why every attribute check also accepts a `prefix:name`).
  const pkg = /<package\b[^>]*>/i.exec(xml)?.[0];
  if (pkg) {
    const ver = getAttr(pkg, 'version');
    if (ver !== null && ver.startsWith('3')) epubVersion = '3';
  }

  // Kotlin L479-497
  for (const m of xml.matchAll(/<item\b[^>]*>/gi)) {
    const tag = m[0];
    const id = getAttr(tag, 'id');
    const href = getAttr(tag, 'href');
    if (id === null || href === null) continue;
    if (id.trim() === '' || href.trim() === '') continue;
    manifest.set(id, href);
    // Kotlin L492 `properties?.contains("cover-image")` — a *substring* test, not a token test.
    const props = getAttr(tag, 'properties');
    if (props !== null && props.includes('cover-image')) {
      epub3CoverHref = href;
    }
  }

  // Kotlin L498-507
  for (const m of xml.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = getAttr(m[0], 'idref');
    if (idref !== null && idref.trim() !== '') spine.push(idref);
  }

  // Kotlin L508-524
  for (const m of xml.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = getAttr(tag, 'name');
    const content = getAttr(tag, 'content');
    const property = getAttr(tag, 'property');
    if (name !== null && name.toLowerCase() === 'cover' && content !== null && content !== '') {
      epub2CoverId = content;
    } else if (
      property !== null &&
      property.toLowerCase() === 'cover-image' &&
      content !== null &&
      content !== ''
    ) {
      epub3CoverHref = content;
    }
  }

  // Kotlin L525-537 (guide `<reference type="cover">`)
  for (const m of xml.matchAll(/<reference\b[^>]*>/gi)) {
    const tag = m[0];
    const type = getAttr(tag, 'type');
    const href = getAttr(tag, 'href');
    if (type !== null && type.toLowerCase() === 'cover' && href !== null && href !== '') {
      guideCoverHref = href;
    }
  }

  // Kotlin L540-548 — pull-parser TEXT events, not an element-inner-HTML scrape.
  // `currentTag` holds the most recent START_TAG name and is only overwritten by the
  // next START_TAG, so the captured text is only the run directly after the opening
  // tag: `<dc:title>A<em>b</em>C</dc:title>` yields "A" on Android, not "A b C"
  // (the inner `<em>` replaced `currentTag`, so "b" and the trailing "C" are ignored).
  // Each is taken once — `if (title.isBlank())` / `if (author.isBlank())`.
  const title = firstPullText(xml, 'dc:title', 'title');
  const author = firstPullText(xml, 'dc:creator', 'creator');

  // Kotlin L553-555 + L560-589 priority resolution.
  let coverHref: string | null = null;
  let coverSource: CoverSource | null = null;
  if (epub3CoverHref !== null && epub3CoverHref !== '') {
    coverHref = epub3CoverHref;
    coverSource = 'epub3';
  } else if (epub2CoverId !== null && epub2CoverId !== '') {
    const href = manifest.get(epub2CoverId);
    if (href !== undefined && href !== '') {
      coverHref = href;
      coverSource = 'epub2';
    }
  }
  if (coverHref === null && guideCoverHref !== null && guideCoverHref !== '') {
    coverHref = guideCoverHref;
    coverSource = 'guide';
  }

  return { title, author, coverHref, coverSource, epubVersion, manifest, spine };
}

/** Byte ranges of every `<nav>…</nav>` element, honouring nesting. */
function collectNavRanges(xml: string): Array<[number, number]> {
  const re = /<(\/?)nav\b[^>]*>/gi;
  const stack: number[] = [];
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] === '/') {
      const start = stack.pop();
      if (start !== undefined) out.push([start, m.index + m[0].length]);
    } else if (!m[0].endsWith('/>')) {
      stack.push(m.index);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Kotlin L635-658 `readTocTitles`.
 * TOC files = every manifest item whose `properties` contains the `nav` token or
 * whose `media-type` is `application/x-dtbncx+xml`, in manifest order. NCX files
 * yield `navPoint` entries; everything else yields `<a href>` inside `<nav>`
 * (Kotlin's selector union `nav[epub:type=toc] a[href], nav a[href]` collapses
 * to "all `<a href>` in any `<nav>`", so all navs are merged, first key wins).
 *
 * Keys are the target path **relative to the OPF's own directory**
 * (Kotlin L653 `target.relativeTo(opf.parentFile)`) — not relative to the TOC
 * file, which is in a different directory in many EPUBs.
 */
function readTocTitles(index: ZipIndex, opfDir: string, opfXml: string): Map<string, string> {
  const result = new Map<string, string>();
  const tocHrefs: string[] = [];
  for (const m of opfXml.matchAll(/<item\b[^>]*>/gi)) {
    const tag = m[0];
    const href = getAttr(tag, 'href');
    if (!href) continue;
    const props = getAttr(tag, 'properties') ?? '';
    const media = getAttr(tag, 'media-type') ?? '';
    if (props.split(/\s+/).includes('nav') || media === 'application/x-dtbncx+xml') {
      tocHrefs.push(href);
    }
  }

  for (const href of tocHrefs) {
    const tocPath = joinZipPath(opfDir, href);
    const text = readEntryText(index, tocPath);
    if (text === null) continue;
    const tocDir = dirnameZip(tocPath);
    if (imageExtOf(tocPath) === 'ncx') {
      // Kotlin L646 `doc.select("navPoint")`, L648-649 `selectFirst("content")/@src`
      // and `selectFirst("navLabel").text()`.
      const re =
        /<navLabel\b[^>]*>([\s\S]*?)<\/navLabel>\s*<content\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi;
      for (const m of text.matchAll(re)) {
        const title = cleanInline(m[1] ?? '');
        const src = m[2] ?? '';
        if (!title || !src) continue;
        const target = joinZipPath(tocDir, src.split('#')[0] ?? '');
        const key = relativeToZip(opfDir, target);
        if (key && !result.has(key)) result.set(key, title);
      }
    } else {
      const linkRe = /<a\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      for (const range of collectNavRanges(text)) {
        const navHtml = text.slice(range[0], range[1]);
        for (const m of navHtml.matchAll(linkRe)) {
          const href2 = m[1] ?? '';
          const title = cleanInline(m[2] ?? '');
          if (!href2 || !title) continue;
          const target = joinZipPath(tocDir, href2.split('#')[0] ?? '');
          const key = relativeToZip(opfDir, target);
          if (key && !result.has(key)) result.set(key, title);
        }
      }
    }
  }
  return result;
}

/**
 * Kotlin L399-439 `findMatchingCoverFile`.
 *
 * Four ordered probes over the unzipped tree; the first hit wins. Note step 3/4 also
 * compare the **bare file name** case-insensitively against the whole subtree, which
 * is why `zipLookup`'s whole-path lowercase map is not sufficient on its own — a
 * cover at `OEBPS/img/front.jpg` referenced from the OPF as `front.jpg` still
 * matches, because the walk does not require the directory prefix to line up.
 *
 * `cleanHref` normalisation order is Kotlin's: trim leading `/`, drop `?…`, then
 * drop `#…`, then percent-decode. (Dropping the query before the fragment means a
 * href shaped `a#b?c` keeps `a#b?c`'s `a` plus `?c` — matching L401 exactly.)
 */
function findMatchingCoverFile(
  index: ZipIndex,
  opfDir: string,
  rawCoverHref: string,
): string | null {
  const trimmed = rawCoverHref.replace(/^\/+/, '');
  const cleanHref = decodeUrl(trimmed.split('?')[0]?.split('#')[0] ?? '');
  if (cleanHref === '') return null;

  // 1. direct match under the OPF directory
  const inOpf = joinZipPath(opfDir, cleanHref);
  if (index.entries[inOpf] !== undefined) return inOpf;
  // 2. direct match at the archive root
  const atRoot = normalizeZipPath(cleanHref);
  if (atRoot !== '' && index.entries[atRoot] !== undefined) return atRoot;

  const cleanLower = cleanHref.toLowerCase();
  const cleanNameLower = basenameZip(cleanHref).toLowerCase();
  const under = (dir: string, entry: string): boolean => {
    if (dir === '') return true;
    return entry === dir || entry.startsWith(`${dir}/`);
  };

  // 3. case-insensitive walk of opfDir  4. case-insensitive walk of the root.
  // `Object.keys` preserves zip order, which is the same order `walkTopDown` sees
  // on Android for a tree extracted entry-by-entry.
  for (const scope of [opfDir, '']) {
    for (const key of Object.keys(index.entries)) {
      if (key.endsWith('/') || !under(scope, key)) continue;
      if (key.toLowerCase() === cleanLower || basenameZip(key).toLowerCase() === cleanNameLower) {
        return key;
      }
    }
  }
  return null;
}

/** Kotlin L234 / L574 / L440 — first `<img>`/`<image>` `src`/`href` in a document. */
function firstImageSrc(html: string): string | null {
  const m = /<(?:img|image)[^>]+(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(html);
  const src = m?.[1]?.trim();
  return src && src.length > 0 ? src : null;
}

/**
 * Reproduce the namespace-unaware XmlPullParser scan of Kotlin L463-548 for the two
 * TEXT-mapped tags. `currentTag` is *only* reassigned by START_TAG, so the text run
 * considered for a start tag is the one between that tag and the next `<`.
 * A CDATA section counts as one text run (the parser reports `TEXT` with
 * `getText()`), and a self-closing `<dc:title/>` produces no run at all.
 */
function firstPullText(xml: string, qualified: string, bare: string): string {
  const tagRe = new RegExp(`<(${qualified}|${bare})(\\s[^>]*)?(/?)>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    if (m[3] === '/') continue; // self-closing: no TEXT event
    let pos = m.index + m[0].length;
    // XML entity references and character data form a single TEXT run.
    if (xml.startsWith('<![CDATA[', pos)) {
      const end = xml.indexOf(']]>', pos);
      if (end < 0) return '';
      return decodeXmlText(xml.slice(pos + 9, end)).trim();
    }
    let text = '';
    while (pos < xml.length && xml[pos] !== '<') {
      text += xml[pos];
      pos += 1;
    }
    const value = decodeXmlText(text).trim();
    if (value.length > 0) return value;
  }
  return '';
}

/**
 * `XmlPullParser.getText()` returns the entity-decoded text. Only the five XML
 * predefined entities plus numeric character references exist in an OPF, and the
 * pull parser errors out on an undefined entity, which Kotlin's `catch (e:
 * Exception)` (L556) swallows and leaves `title`/`author` empty — so an unknown
 * `&name;` must stay literal here rather than being dropped.
 */
function decodeXmlText(raw: string): string {
  return raw.replace(/&#x([0-9a-fA-F]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/g, (_whole, hex, dec, named) => {
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (dec !== undefined) return String.fromCodePoint(Number.parseInt(dec, 10));
    switch (named) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      default:
        return "'";
    }
  });
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface EpubParseOptions {
  /**
   * Kotlin L799 `bookUri.startsWith("file:")` gate for the zero-copy
   * `epzip:<uri>!<entry>` token reference. Omit for a pure in-memory parse.
   */
  bookUri?: string | null;
  /**
   * Kotlin L815-816 side effect (store the bytes, return the path) used by the
   * data-URI branch. Omit to skip such images the way Kotlin skips an
   * undecodable one.
   */
  writeImage?: ((name: string, bytes: Uint8Array) => string | null) | null;
  /** Kotlin `System.currentTimeMillis()` in the generated file name. */
  now?: number;
}

/** Kotlin L30 `TAG` / L815 — `File(imageDir, "img_${seq}_${millis}.$ext")`. */
export const EPUB_IMAGE_MIME_EXT = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;

export function parseEpubFromZip(zipBytes: Uint8Array, options: EpubParseOptions = {}): ParsedEpub {
  const index = unzipEpub(zipBytes);
  const writeImage = options.writeImage ?? null;
  const now = options.now ?? Date.now();
  // Kotlin L738 creates `copied` inside `embedImageTokens`, i.e. once per chapter.
  const tokenOptions = (): EpubImageTokenOptions => ({
    bookUri: options.bookUri ?? null,
    writeImage,
    now,
    seenSources: createImageSourceSet(),
  });

  // Kotlin L53-59 — DRM check runs *before* container.xml is even looked for.
  const encBytes = zipLookup(index, 'META-INF/encryption.xml');
  if (encBytes) {
    // Kotlin L55 uses `encryption.readText()` (platform default = UTF-8).
    const encText = new TextDecoder('utf-8').decode(encBytes);
    // jsoup's xmlParser() preserves tag AND attribute case, so `select("EncryptionMethod")`
    // and `attr("Algorithm")` are case-sensitive on Android — case-insensitive
    // matching here would reject books Android happily imports.
    for (const m of encText.matchAll(/<EncryptionMethod\b[^>]*>/g)) {
      // jsoup `node.attr("Algorithm")` is "" when the attribute is absent, and
      // "" is not in the allowed set → DRM error (Kotlin L56-58).
      const algo = getAttrCaseSensitive(m[0], 'Algorithm') ?? '';
      if (!DRM_ALLOWED.has(algo)) {
        throw new Error('EPUB 正文受 DRM 加密，无法导入');
      }
    }
  }

  const containerText = readEntryText(index, 'META-INF/container.xml');
  if (containerText === null) {
    throw new Error('EPUB 缺少 META-INF/container.xml');
  }
  const opfRelativePath = parseContainerXml(containerText);
  if (opfRelativePath === null) {
    throw new Error('无法解析 EPUB container.xml 中的 OPF 路径');
  }

  // Kotlin L73-77 runs the OPF path through ArchiveBudget.destination (rejects
  // `..` escapes) then requires it to exist.
  const opfPath = normalizeZipPath(opfRelativePath);
  const opfText = readEntryText(index, opfPath);
  if (opfText === null) {
    throw new Error(`找不到 OPF 文件: ${opfRelativePath}`);
  }
  const opfDir = dirnameZip(opfPath);
  const opf = parseOpfXml(opfText);
  const tocTitles = readTocTitles(index, opfDir, opfText);

  const title = opf.title.trim().length > 0 ? opf.title.trim() : null;
  const author = opf.author.trim().length > 0 ? opf.author.trim() : '未知作者';

  // Kotlin L725-819 `embedImageTokens` — the token has to exist *before*
  // `extractCleanTextFromHtml` strips the `<img>` tags away.
  const resolveImage = (src: string, xhtmlPath: string): string | null => {
    let source: EpubImageSource | null;
    if (src.startsWith('data:')) {
      // Kotlin L773-777: data URIs must carry `base64,`; epzipEntry stays null.
      const marker = src.indexOf('base64,');
      if (marker < 0) return null;
      const payload = src.slice(marker + 'base64,'.length);
      let bytes: Uint8Array | null = null;
      try {
        const bin = atob(payload.replace(/\s/g, ''));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      } catch {
        return null;
      }
      const size = probeImageSize(bytes);
      source = {
        entryPath: null,
        bytes,
        width: size?.width ?? 0,
        height: size?.height ?? 0,
        // Kotlin L809 reads `opts.outMimeType`, which BitmapFactory fills in from the
        // decoded ImageFormat; it drives the on-disk extension of the copied file.
        mime: probeImageMime(bytes),
      };
    } else {
      // Kotlin L778-790: `File(xhtmlDir, decodeUrl(src.substringBefore('#')))`,
      // must exist, extension must be supported, entry = path relative to the
      // unzipped root (which is the archive-internal path).
      const cleanSrc = decodeUrl(src.split('#')[0] ?? '');
      const entryPath = joinZipPath(dirnameZip(xhtmlPath), cleanSrc);
      const bytes = zipLookup(index, entryPath);
      if (!bytes) return null;
      if (!EPUB_SUPPORTED_IMAGE_EXTENSIONS.has(imageExtOf(entryPath))) return null;
      const size = probeImageSize(bytes);
      source = {
        entryPath,
        bytes,
        width: size?.width ?? 0,
        height: size?.height ?? 0,
        mime: probeImageMime(bytes),
      };
    }
    return buildImageToken(src, source, tokenOptions());
  };

  const chapters: Array<{ title: string; content: string }> = [];
  for (const idref of opf.spine) {
    const href = opf.manifest.get(idref);
    if (!href) continue;
    const chapterPath = joinZipPath(opfDir, href);
    const raw = readEntryText(index, chapterPath);
    if (raw === null || raw.trim().length === 0) continue;
    const withImages = embedImageTokens(raw, (src) => resolveImage(src, chapterPath));
    const content = extractCleanTextFromHtmlLocal(withImages);
    if (content.trim().length === 0) continue;
    // Kotlin L121 — the TOC key is `decodeUrl(href.substringBefore('#'))`.
    const tocKey = relativeToZip(opfDir, joinZipPath(opfDir, href.split('#')[0] ?? ''));
    const tocTitle = tocTitles.get(tocKey) ?? null;
    chapters.push({ title: extractChapterTitle(raw, tocTitle), content });
  }

  // Kotlin L136-157 — split chapters longer than MAX_CHAPTER_LENGTH.
  const splitChapters: Array<{ title: string; content: string }> = [];
  for (const ch of chapters) {
    if (ch.content.length <= MAX_CHAPTER_LENGTH) {
      splitChapters.push(ch);
      continue;
    }
    const parts = splitChapterText(ch.content);
    parts.forEach((part, index) => {
      splitChapters.push({
        title: index === 0 ? ch.title : `${ch.title} (续${index + 1})`,
        content: part,
      });
    });
  }

  const coverHref = resolveCoverHref(index, opfDir, opf, opf.spine);
  return { title, author, coverHref, chapters: splitChapters };
}

/**
 * Kotlin L166-297 cover resolution: the declared href (EPUB3 → EPUB2 → guide,
 * already collapsed by `parseOpfXml`), then the three-layer violent fallback.
 * `imageBounds(...)` validation maps onto `probeImageSize` (outWidth/outHeight > 0).
 */
function resolveCoverHref(
  index: ZipIndex,
  opfDir: string,
  opf: OpfData,
  spine: string[],
): string | null {
  let declared: string | null = null;
  if (opf.coverHref !== null && opf.coverHref !== '') {
    if (opf.coverSource === 'guide' && /\.(xhtml|html)$/i.test(opf.coverHref)) {
      // Kotlin L568-583 — guide reference pointing at an XHTML wrapper.
      const guidePath = joinZipPath(opfDir, opf.coverHref);
      const guideHtml = readEntryText(index, guidePath);
      if (guideHtml !== null) {
        const img = firstImageSrc(guideHtml);
        if (img) {
          // Kotlin L578 — `guideCoverHref.substringBeforeLast('/', "")`, i.e. "" when the
          // href has no slash at all.
          const slash = opf.coverHref.lastIndexOf('/');
          const guideDirRel = slash >= 0 ? opf.coverHref.slice(0, slash) : '';
          const rawCover = guideDirRel !== '' ? `${guideDirRel}/${img}` : img;
          const found = findMatchingCoverFile(index, opfDir, rawCover);
          if (found !== null) declared = found;
        }
      }
    } else {
      // Kotlin L181-193 — `findMatchingCoverFile(opfDir, tempDir, coverHref)`:
      //   1. direct hit under opfDir
      //   2. direct hit under the archive root
      //   3. case-insensitive walk of opfDir (relPath or bare file name)
      //   4. case-insensitive walk of the archive root
      // then the winner must still decode.
      const found = findMatchingCoverFile(index, opfDir, opf.coverHref);
      if (found !== null) {
        const bytes = zipLookup(index, found);
        // Kotlin L186-193 — a declared cover that will not decode goes to the fallback.
        if (bytes !== null && probeImageSize(bytes) !== null) declared = found;
      }
    }
  }
  if (declared !== null) return declared;

  // Kotlin L196-280 violent fallback.
  const imageEntries: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const [key, value] of Object.entries(index.entries)) {
    if (!key.endsWith('/') && COVER_SCAN_EXT.has(imageExtOf(key))) {
      imageEntries.push({ path: key, bytes: value });
    }
  }
  if (imageEntries.length === 0) return null;

  const decodable = (entry: { path: string; bytes: Uint8Array }): boolean =>
    probeImageSize(entry.bytes) !== null;

  // Priority 1 — file name (without extension) contains "cover".
  const byName = imageEntries.find((e) => stemZip(e.path).toLowerCase().includes('cover'));
  if (byName !== undefined && decodable(byName)) return byName.path;

  // Priority 2 — every <img>/<image> src in the first spine document, in document
  // order (Kotlin L236-256 is a `while (matcher.find())` loop that only breaks on a
  // *decodable* hit, so an undecodable first image falls through to the second).
  const firstSpineHref = spine[0] !== undefined ? opf.manifest.get(spine[0]) : undefined;
  if (firstSpineHref && firstSpineHref.trim() !== '') {
    const xhtmlPath = joinZipPath(opfDir, decodeUrl(firstSpineHref));
    const xhtml = readEntryText(index, xhtmlPath);
    if (xhtml !== null) {
      const spineDir = dirnameZip(xhtmlPath);
      for (const m of xhtml.matchAll(/<(?:img|image)[^>]+(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
        const relSrc = (m[1] ?? '').trim();
        if (relSrc === '') continue;
        // Kotlin L239 — `substringBefore('#')` then `substringBefore('?')`, in that order.
        const cleanSrc = decodeUrl(relSrc.split('#')[0]?.split('?')[0] ?? '');
        const candidate = joinZipPath(spineDir, cleanSrc);
        // Kotlin L243 — `it.name.lowercase() == File(cleanSrc).name.lowercase()`:
        // the **full** file name including its extension, not the extension-less stem.
        const nameLower = basenameZip(cleanSrc).toLowerCase();
        const hit = imageEntries.find(
          (e) => e.path === candidate || basenameZip(e.path).toLowerCase() === nameLower,
        );
        if (hit !== undefined && decodable(hit)) return hit.path;
      }
    }
  }

  // Priority 3 — largest by size (Kotlin `maxByOrNull` keeps the first maximum).
  let largest: { path: string; bytes: Uint8Array } | null = null;
  for (const e of imageEntries) {
    if (largest === null || e.bytes.length > largest.bytes.length) largest = e;
  }
  if (largest !== null && decodable(largest)) return largest.path;
  return null;
}