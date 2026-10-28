/**
 * Download file integrity validator — port of Android `DownloadFileValidator.kt`.
 *
 * Rejects HTML error pages first, then identifies real format from content magic.
 *
 * Kotlin inspects ZIP archives with `java.util.zip.ZipFile`, which reads only the
 * central directory (and throws when it is unreadable). `unzipSync` would both
 * decompress every entry (a downloaded book is routinely tens of megabytes) and
 * mask an unreadable directory, so the central directory is parsed directly here
 * to keep `ZipFile`'s accept/reject boundary: unparseable ⇒ treated as "not a
 * usable archive", exactly like Kotlin's `catch (e: Exception) { false }`.
 *
 * 2026-10-06 fix pass (see the report): `readZipCentralDirectory` let the two
 * EOCD fields (`totalEntries`, the central-directory offset) stay
 * `number | undefined` and re-checked them inside the walk. They are now
 * resolved before the loop, because a `ZipFile` either yields a complete EOCD or
 * throws before the first `ZipEntry` — that is the invariant the walk relies on.
 *
 * Residual difference from Android, kept deliberately: entry names are decoded
 * byte-per-byte (latin1) instead of `ZipEntry.getName()`'s UTF-8/CP437 switch.
 * Every predicate here (`META-INF/container.xml`, `word/document.xml`, the `.opf`
 * / `META-INF/` prefix tests, the image-extension set and the trailing `/`
 * directory test) matches on ASCII, and a latin1 reading of a UTF-8 name keeps
 * its ASCII bytes, so no classification can change.
 */

export interface IntegrityResult {
  valid: boolean;
  actualFormat: string | null;
  isHtmlErrorPage: boolean;
  htmlErrorHint: string | null;
}

/** One central-directory record — `java.util.zip.ZipEntry` subset used here. */
export interface ZipCentralEntry {
  name: string;
  crc: number;
  /** Uncompressed size, with the Zip64 extra field resolved. */
  size: number;
  /** Kotlin `ZipEntry.isDirectory()` is exactly `name.endsWith("/")`. */
  isDirectory: boolean;
}

const HEAD_BYTES = 4096;
const TEXT_SAMPLE_BYTES = 64 * 1024;
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
const KNOWN_ERROR_MARKERS = [
  'diamwall',
  'checking your browser',
  'verifying your browser',
  'daily limit',
  'page not found',
  'solve this captcha',
] as const;

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const ZIP64_EXTRA_ID = 0x0001;

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

function utf8LowerCase(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes).toLowerCase();
}

function isZipMagic(head: Uint8Array): boolean {
  return (
    head.length >= 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    head[2] === 0x03 &&
    head[3] === 0x04
  );
}

function readU16(data: Uint8Array, offset: number): number | undefined {
  if (offset + 2 > data.length) return undefined;
  return ((data[offset] as number) | ((data[offset + 1] as number) << 8)) >>> 0;
}

function readU32(data: Uint8Array, offset: number): number | undefined {
  if (offset + 4 > data.length) return undefined;
  return (
    ((data[offset] as number) |
      ((data[offset + 1] as number) << 8) |
      ((data[offset + 2] as number) << 16) |
      ((data[offset + 3] as number) << 24)) >>>
    0
  );
}

function readU64(data: Uint8Array, offset: number): number | undefined {
  if (offset + 8 > data.length) return undefined;
  let value = 0;
  for (let i = 7; i >= 0; i -= 1) {
    value = value * 256 + (data[offset + i] as number);
  }
  return value;
}

/** Zip64 extended-information extra field (0x0001) → uncompressed size override. */
function zip64UncompressedSize(extra: Uint8Array, size: number): number {
  if (size !== 0xffffffff) return size;
  let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = ((extra[cursor] as number) | ((extra[cursor + 1] as number) << 8)) >>> 0;
    const len =
      ((extra[cursor + 2] as number) | ((extra[cursor + 3] as number) << 8)) >>> 0;
    const body = cursor + 4;
    if (id === ZIP64_EXTRA_ID) {
      const value = readU64(extra, body);
      if (value !== undefined) return value;
    }
    cursor = body + len;
  }
  return size;
}

/**
 * Parse the ZIP central directory. Returns null when the archive is unreadable,
 * mirroring `ZipFile(file)` throwing an IOException (which Kotlin catches).
 */
export function readZipCentralDirectory(data: Uint8Array): ZipCentralEntry[] | null {
  let eocd = -1;
  const floor = Math.max(0, data.length - 22 - 0xffff);
  for (let i = data.length - 22; i >= floor; i -= 1) {
    if (readU32(data, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  // Kotlin opens the whole `File` with `ZipFile`, which reads a *complete* EOCD
  // record or throws. A truncated tail therefore means "unusable archive", which
  // is the `null` this function returns — so resolve the two EOCD fields before
  // the walk instead of letting them stay possibly-undefined inside it.
  const entryCount = readU16(data, eocd + 10);
  const directoryOffset = readU32(data, eocd + 16);
  if (entryCount === undefined || directoryOffset === undefined) return null;
  let totalEntries = entryCount;
  let offset = directoryOffset;

  // Zip64 end-of-central-directory locator sits immediately before the EOCD.
  if (totalEntries === 0xffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && readU32(data, locator) === EOCD64_LOCATOR_SIG) {
      const zip64 = readU64(data, locator + 8);
      if (zip64 !== undefined && readU32(data, zip64) === EOCD64_SIG) {
        const count = readU64(data, zip64 + 32);
        const start = readU64(data, zip64 + 48);
        if (count !== undefined) totalEntries = count;
        if (start !== undefined) offset = start;
      }
    }
  }

  const out: ZipCentralEntry[] = [];
  let cursor = offset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > data.length || readU32(data, cursor) !== CENTRAL_SIG) return null;
    const crc = readU32(data, cursor + 16);
    const rawSize = readU32(data, cursor + 24);
    const nameLen = readU16(data, cursor + 28);
    const extraLen = readU16(data, cursor + 30);
    const commentLen = readU16(data, cursor + 32);
    if (crc === undefined || rawSize === undefined) return null;
    if (nameLen === undefined || extraLen === undefined || commentLen === undefined) return null;
    const nameStart = cursor + 46;
    const extraStart = nameStart + nameLen;
    if (extraStart + extraLen > data.length) return null;
    let name = '';
    for (let j = 0; j < nameLen; j += 1) {
      name += String.fromCharCode(data[nameStart + j] as number);
    }
    out.push({
      name,
      crc,
      size: zip64UncompressedSize(data.subarray(extraStart, extraStart + extraLen), rawSize),
      isDirectory: name.endsWith('/'),
    });
    cursor = extraStart + extraLen + commentLen;
  }
  return out;
}

function entryExt(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

function zipEntryNames(data: Uint8Array): string[] | null {
  const central = readZipCentralDirectory(data);
  return central === null ? null : central.map((e) => e.name);
}

function namesIndicateEpub(names: string[]): boolean {
  if (names.includes('META-INF/container.xml') || names.includes('mimetype')) return true;
  return names.some(
    (n) => !n.endsWith('/') && (n.toLowerCase().endsWith('.opf') || n.toUpperCase().startsWith('META-INF/')),
  );
}

function namesIndicateDocx(names: string[]): boolean {
  return names.includes('word/document.xml');
}

function namesIndicateCbz(names: string[]): boolean {
  return names.some((n) => !n.endsWith('/') && IMAGE_EXTS.has(entryExt(n)));
}

function inspectZip(data: Uint8Array): string | null {
  const names = zipEntryNames(data);
  if (names === null) return null;
  if (namesIndicateDocx(names)) return 'docx';
  if (namesIndicateEpub(names)) return 'epub';
  if (namesIndicateCbz(names)) return 'cbz';
  return null;
}

function zipHasEpubStructure(data: Uint8Array): boolean {
  const names = zipEntryNames(data);
  return names !== null && namesIndicateEpub(names);
}

/** From an HTML error page, find a user-facing reason. */
function extractHtmlErrorHint(data: Uint8Array): string | null {
  const sample = utf8LowerCase(data.subarray(0, TEXT_SAMPLE_BYTES));
  if (
    sample.includes('daily limit') ||
    sample.includes('downloads_today') ||
    sample.includes('downloads_limit') ||
    sample.includes('already reached')
  ) {
    return '今日下载次数已达上限（每日额度用尽，等待重置或提升额度）';
  }
  if (sample.includes('page not found') || sample.includes('not found, try again')) {
    return '页面不存在或下载链接已失效';
  }
  if (
    sample.includes('checking your browser') ||
    sample.includes('diamwall') ||
    sample.includes('verifying your browser')
  ) {
    return '站点返回了浏览器验证页（DiamWall 验证未通过）';
  }
  if (sample.includes('downloading') && sample.includes('z-library')) {
    return '站点下载页是 HTML 中转页（新站 /dl/ 不再直接返回文件，请重试或稍后再试）';
  }
  return null;
}

export function validateFileIntegrity(data: Uint8Array, format: string): IntegrityResult {
  if (data.length === 0) {
    return { valid: false, actualFormat: null, isHtmlErrorPage: false, htmlErrorHint: null };
  }

  const head = data.subarray(0, HEAD_BYTES);
  const isZip = isZipMagic(head);

  if (!isZip) {
    const headStr = utf8LowerCase(head);
    const trimmed = headStr.replace(/^\s+/, '');
    const html =
      trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || trimmed.startsWith('<head>');
    const knownError = KNOWN_ERROR_MARKERS.some((it) => headStr.includes(it));
    if (html && (format.toLowerCase() !== 'txt' || knownError)) {
      return {
        valid: false,
        actualFormat: null,
        isHtmlErrorPage: true,
        htmlErrorHint: extractHtmlErrorHint(data),
      };
    }
  }

  const declared = format.toLowerCase().trim();
  const detected = detectRealFormat(head, data);

  if (declared === 'epub' && detected !== null && detected !== 'epub') {
    return { valid: true, actualFormat: detected, isHtmlErrorPage: false, htmlErrorHint: null };
  }

  if (declared === 'epub' || detected === 'epub') {
    if (zipHasEpubStructure(data)) {
      return { valid: true, actualFormat: 'epub', isHtmlErrorPage: false, htmlErrorHint: null };
    }
    if (isProbablyText(data.subarray(0, TEXT_SAMPLE_BYTES))) {
      return { valid: true, actualFormat: 'txt', isHtmlErrorPage: false, htmlErrorHint: null };
    }
    return { valid: false, actualFormat: detected, isHtmlErrorPage: false, htmlErrorHint: null };
  }

  return { valid: true, actualFormat: detected, isHtmlErrorPage: false, htmlErrorHint: null };
}

/**
 * Identify real format from magic / structure. Returns null when unknown.
 *
 * `full` mirrors Kotlin's `detectRealFormat(file, head)`: the ZIP branch opens the
 * whole `File` with `ZipFile` (the central directory lives at the end), so the
 * caller must pass the complete payload — not just the 4 KB head. When omitted
 * the head is used, which is enough for every non-ZIP branch.
 */
export function detectRealFormat(head: Uint8Array, full?: Uint8Array): string | null {
  if (head.length < 4) return null;

  if (head.length >= 5) {
    const window = Math.min(head.length, 1024);
    for (let i = 0; i + 5 <= window; i += 1) {
      if (
        head[i] === 0x25 && // %
        head[i + 1] === 0x50 && // P
        head[i + 2] === 0x44 && // D
        head[i + 3] === 0x46 && // F
        head[i + 4] === 0x2d // -
      ) {
        return 'pdf';
      }
    }
  }

  if (head.length >= 64) {
    const sample = utf8LowerCase(head.subarray(0, Math.min(head.length, 4096)));
    if (sample.includes('<?xml') && sample.includes('<fictionbook')) {
      return 'fb2';
    }
  }

  if (head[0] === 0x50 && head[1] === 0x4b) {
    return inspectZip(full ?? head);
  }

  if (
    head.length >= 68 &&
    head[60] === 0x42 && // B
    head[61] === 0x4f && // O
    head[62] === 0x4f && // O
    head[63] === 0x4b && // K
    head[64] === 0x4d && // M
    head[65] === 0x4f && // O
    head[66] === 0x42 && // B
    head[67] === 0x49 // I
  ) {
    return 'mobi';
  }

  if (isProbablyText(head)) {
    return 'txt';
  }
  return null;
}

/** Heuristic: does this byte sample look like text (UTF-8 / UTF-16 / ASCII)? */
export function isProbablyText(head: Uint8Array): boolean {
  if (head.length === 0) return false;

  if (
    head.length >= 2 &&
    ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))
  ) {
    return true;
  }

  if (head.length >= 4) {
    const isLe = head[0] !== 0 && head[1] === 0;
    const isBe = head[0] === 0 && head[1] !== 0;
    if (isLe || isBe) {
      let textUnits = 0;
      let bad = 0;
      const units = Math.min(Math.floor(head.length / 2), 2048);
      for (let i = 0; i < units; i += 1) {
        const lo = head[i * 2] as number;
        const hi = head[i * 2 + 1] as number;
        const c = isLe ? lo : hi;
        const z = isLe ? hi : lo;
        if (z === 0 && ((c >= 0x09 && c <= 0x0d) || (c >= 0x20 && c <= 0x7e) || c >= 0x80)) {
          textUnits += 1;
        } else if (z === 0) {
          bad += 1;
        } else {
          bad += 2;
        }
      }
      if (textUnits > 0 && bad < textUnits) return true;
    }
  }

  let nul = 0;
  let ctrl = 0;
  let textLike = 0;
  const n = head.length;
  for (let i = 0; i < n; i += 1) {
    const b = head[i] as number;
    if (b === 0) {
      nul += 1;
    } else if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
      ctrl += 1;
    } else if (b >= 0x20 && b <= 0x7e) {
      textLike += 1;
    } else if (b >= 0x80 || b === 0x09 || b === 0x0a || b === 0x0d) {
      textLike += 1;
    }
  }
  return (nul * 100) / n < 35 && (ctrl * 100) / n < 5 && (textLike * 100) / n >= 60;
}
