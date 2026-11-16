/**
 * Novel TXT archive prepare — port of Android `NovelTextArchive.kt`.
 *
 * Extracts the single .txt entry from a source ZIP, verifies size/CRC,
 * detects UTF-8 vs GB18030 on a bounded sample, records chapter-heading
 * byte offsets while streaming, rewrites out-of-order numbered chapters
 * (byte ranges preserved; only complete ranges are sorted), and returns
 * a UTF-8 file path.
 *
 * Adaptations: ZipFile/RandomAccessFile/InputStreamReader → fflate + TextDecoder.
 * raw/ordered intermediates stay in memory (same observable contract: only the
 * UTF-8 file is returned; Android temp files are never kept on success either).
 */

import { unzipSync } from 'fflate';
import type { FileSystemApi } from '@platform/interfaces';
import { zipSlipSafeDestination } from '../data/archiveBudget';
import { readZipCentralDirectory, type ZipCentralEntry } from '../data/downloadFileValidator';

const MAX_BYTES = 64 * 1024 * 1024;
const HEADING = /^第([0-9]{1,7})[章回].{0,150}$/;
const LINE_BUFFER_BYTES = 512;
const CHUNK = 64 * 1024;

interface Section {
  number: number;
  offset: number;
}

/** `ZipEntryInfo` kept as the local name for the shared central-directory row. */
type ZipEntryInfo = ZipCentralEntry;

// The central-directory reader now lives in core/data/downloadFileValidator so
// that `DownloadFileValidator` can inspect ZIPs exactly the way Kotlin's
// `ZipFile` does (central directory only, unreadable ⇒ not a usable archive).
// Re-exported here: it is the ZIP parsing seam of this module.
export { readZipCentralDirectory, type ZipCentralEntry } from '../data/downloadFileValidator';

/** Standard CRC-32 (java.util.zip.CRC32 equivalent). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    const b = data[i] as number;
    crc ^= b;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Java CharsetDecoder(endOfInput=false) tolerates a truncated tail sequence.
 * Try full sample; on failure trim 1..4 bytes (charsetSniffer.decodeStrict pattern).
 */
function decodeStrictSample(sample: Uint8Array, complete: boolean): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(sample);
  } catch {
    if (complete) return null;
    for (let trim = 1; trim <= 4 && trim < sample.length; trim += 1) {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(
          sample.subarray(0, sample.length - trim),
        );
      } catch {
        // try shorter tail
      }
    }
    return null;
  }
}

function matchHeading(line: string): number | null {
  const trimmed = line.trim().replace(/^\uFEFF/, '').trim();
  const match = HEADING.exec(trimmed);
  if (match == null) return null;
  const num = Number.parseInt(match[1] as string, 10);
  return Number.isFinite(num) ? num : null;
}

export interface NovelTextArchiveDeps {
  fs: FileSystemApi;
  now?: () => number;
  /**
   * WorkManager cancellation. Android calls
   * `currentCoroutineContext().ensureActive()` while streaming the entry,
   * reordering ranges and transcoding to UTF-8.
   */
  signal?: AbortSignal | undefined;
  /**
   * Android `parent.usableSpace >= entry.size * 4 + 16MB` before extraction —
   * platform free-space probe (optional, same as the worker's own check).
   */
  getUsableSpace?: (() => Promise<number> | number) | undefined;
}

/** Android `currentCoroutineContext().ensureActive()` — throws AbortError when cancelled. */
function ensureActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    const err = new Error('download cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Android `NovelTextArchive.prepare(file): File?`
 * Returns the UTF-8 text file path, or null when the payload is not a ZIP.
 */
export async function prepareNovelTextArchive(
  filePath: string,
  deps: NovelTextArchiveDeps,
): Promise<string | null> {
  const { fs, signal } = deps;
  const now = deps.now ?? Date.now;
  const head = await readHeadBytes(fs, filePath, 4);
  if (head == null || head.length < 2) return null;
  if (head[0] !== 0x50 || head[1] !== 0x4b) return null; // 'P''K'

  const rawPath = `${filePath}.text-${String(now())}`;
  const orderedPath = `${filePath}.ordered-${String(now())}`;
  const utf8Path = `${filePath}.utf8-${String(now())}`;

  let result: string | null = null;
  try {
    const archive = await fs.readFile(filePath);
    ensureActive(signal); // Android: first currentCoroutineContext().ensureActive()
    const central = readZipCentralDirectory(archive);
    if (central == null) {
      throw new Error('小说压缩包无法解析');
    }
    // Android: entries = zip.entries().asSequence().take(9); require(entries.size <= 8)
    const entries = central.slice(0, 9);
    if (entries.length > 8) {
      throw new Error('小说压缩包条目异常');
    }
    const parentDir = parentDirectoryOf(filePath);
    for (const entry of entries) {
      // ArchiveBudget.destination(parent.canonicalFile, it.name) — zip-slip reject.
      // The root must be the real parent directory: `ArchiveBudget.destination`
      // canonicalises `File(root, name)`, so `../` only escapes when root is the
      // actual directory. Passing '/' would silently accept `../evil.txt`.
      zipSlipSafeDestination(parentDir, entry.name);
    }
    const books = entries.filter((e) => !e.isDirectory);
    if (books.length !== 1 || !(books[0] as ZipEntryInfo).name.toLowerCase().endsWith('.txt')) {
      throw new Error('本源的压缩包未包含唯一的 TXT 小说');
    }
    const entry = books[0] as ZipEntryInfo;
    if (!(entry.size >= 1 && entry.size <= MAX_BYTES)) {
      throw new Error('小说文本体积超出限制');
    }
    // Android: require(parent.usableSpace >= entry.size * 4 + 16L * 1024 * 1024)
    if (deps.getUsableSpace !== undefined) {
      const usable = await deps.getUsableSpace();
      if (usable < entry.size * 4 + 16 * 1024 * 1024) {
        throw new Error('存储空间不足，请清理后重试');
      }
    }

    const files = unzipSync(archive);
    const entryBytes = files[entry.name];
    if (entryBytes == null || entryBytes.length === 0) {
      throw new Error('小说压缩包不完整，请重新下载');
    }

    // Charset detection on the first 64KB (Android ZipFile sample).
    const sampleSize = Math.min(CHUNK, entryBytes.length);
    const sample = entryBytes.subarray(0, sampleSize);
    const complete = entry.size <= sample.length;
    const utf8Result = decodeStrictSample(sample, complete);
    const charsetLabel: 'utf-8' | 'gb18030' = utf8Result !== null ? 'utf-8' : 'gb18030';
    // Android decodes heading lines with `String(line, charset)` — the *lenient*
    // platform decoder (malformed bytes become U+FFFD). Only the final
    // transcode below uses onMalformedInput(REPORT), so this one must not be
    // fatal: a single bad byte in a heading line must not abort the extraction.
    const lineDecoder = new TextDecoder(charsetLabel);

    // Stream-scan: byte offsets recorded like RandomAccessFile; heading text
    // decoded per line with the detected charset (Android String(line, charset)).
    const sections: Section[] = [];
    let lineStart = 0;
    let lineBytes = 0;
    let tooLong = false;
    for (let i = 0; i < entryBytes.length; i += 1) {
      // Android checks cancellation once per 64KB read chunk.
      if ((i & 0xffff) === 0) ensureActive(signal);
      if (entryBytes[i] === 0x0a) {
        if (!tooLong) {
          // Android decodes `String(line, 0, lineSize, charset)` out of the
          // 512-byte line buffer — never more than LINE_BUFFER_BYTES bytes.
          const end = Math.min(i, lineStart + LINE_BUFFER_BYTES);
          const num = matchHeading(lineDecoder.decode(entryBytes.subarray(lineStart, end)));
          if (num != null) {
            sections.push({ number: num, offset: lineStart });
          }
        }
        lineBytes = 0;
        tooLong = false;
        lineStart = i + 1;
      } else if (!tooLong) {
        lineBytes += 1;
        // Kotlin: `else if (lineSize < line.size) line[lineSize++] = b else tooLong = true`
        // — `tooLong` fires on the byte *past* the 512-byte buffer, i.e. line > 512.
        if (lineBytes > LINE_BUFFER_BYTES) tooLong = true;
      }
    }
    if (lineBytes > 0 || tooLong) {
      if (!tooLong) {
        const num = matchHeading(lineDecoder.decode(entryBytes.subarray(lineStart)));
        if (num != null) {
          sections.push({ number: num, offset: lineStart });
        }
      }
    }

    const computedCrc = crc32(entryBytes);
    if (entryBytes.length !== entry.size || computedCrc !== (entry.crc >>> 0)) {
      throw new Error('小说压缩包不完整，请重新下载');
    }

    let bytes = entryBytes;
    // Reorder out-of-order numbered chapter ranges (Android RandomAccessFile rewrite).
    let outOfOrder = false;
    for (let i = 0; i + 1 < sections.length; i += 1) {
      const a = sections[i] as Section;
      const b = sections[i + 1] as Section;
      if (a.number > b.number) {
        outOfOrder = true;
        break;
      }
    }
    if (outOfOrder && sections.length > 0) {
      const order = sections
        .map((section, index) => ({ section, index }))
        .sort((x, y) => x.section.number - y.section.number);
      let separators = 0;
      const parts: Uint8Array[] = [];
      const firstOffset = (sections[0] as Section).offset;
      if (firstOffset > 0) {
        parts.push(bytes.subarray(0, firstOffset));
      }
      for (const { index, section } of order) {
        ensureActive(signal); // Android: inside RandomAccessFile copy() loop
        // end uses the ORIGINAL next-section offset (Android getOrNull(index + 1)).
        const next = sections[index + 1];
        const end = next != null ? next.offset : bytes.length;
        parts.push(bytes.subarray(section.offset, end));
        // A package's final chapter may lack a trailing newline. After moving
        // it earlier, its footer must not swallow the following chapter heading.
        if (end > 0 && (bytes[end - 1] as number) !== 0x0a) {
          parts.push(Uint8Array.of(0x0d, 0x0a));
          separators += 2;
        }
      }
      let totalLen = 0;
      for (const p of parts) totalLen += p.length;
      if (totalLen !== bytes.length + separators) {
        throw new Error('小说章节整理失败');
      }
      const merged = new Uint8Array(totalLen);
      let pos = 0;
      for (const p of parts) {
        merged.set(p, pos);
        pos += p.length;
      }
      bytes = merged;
    }

    // Charset → UTF-8 rewrite (Android InputStreamReader + OutputStreamWriter UTF-8).
    // Preserve every decoded character, including line endings and notes.
    ensureActive(signal); // Android: inside the transcoding read loop
    const finalText = new TextDecoder(charsetLabel, { fatal: true }).decode(bytes);
    const utf8Bytes = new TextEncoder().encode(finalText);
    await fs.writeFile(utf8Path, utf8Bytes);
    result = utf8Path;
    return result;
  } finally {
    // Kotlin: `if (result != raw) raw.delete(); if (result != ordered) ordered.delete();
    // if (result != utf8) utf8.delete()` — on the failure path result is null, so
    // every intermediate is removed, including a partially written UTF-8 file.
    await deleteQuietly(fs, rawPath);
    await deleteQuietly(fs, orderedPath);
    if (result !== utf8Path) {
      await deleteQuietly(fs, result ?? utf8Path);
    }
  }
}

/** `File(file).parentFile` — the directory that owns `path`. */
function parentDirectoryOf(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  if (idx < 0) return '.';
  if (idx === 0) return '/';
  return norm.slice(0, idx);
}

async function readHeadBytes(
  fs: FileSystemApi,
  path: string,
  n: number,
): Promise<Uint8Array | null> {
  try {
    if (!(await fs.exists(path))) return null;
    const data = await fs.readFile(path);
    return data.subarray(0, n);
  } catch {
    return null;
  }
}

async function deleteQuietly(fs: FileSystemApi, path: string): Promise<void> {
  try {
    if (await fs.exists(path)) {
      await fs.delete(path);
    }
  } catch {
    // temp cleanup is best-effort
  }
}
