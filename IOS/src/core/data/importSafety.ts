/**
 * Import safety — line-by-line port of Android `ImportSafety.kt`
 * (`novel-reader/app/src/main/java/com/example/data/ImportSafety.kt`).
 *
 * Contains the three members of that file:
 *   1. ArchiveBudget           — expanded-byte / entry-count limits + zip-slip destination check
 *   2. readImportBytes         — bounded whole-file read (Android `InputStream.readImportBytes`)
 *   3. splitChapterText        — surrogate-pair / `[IMG:...]`-safe chapter splitting
 *
 * Android deps replaced:
 *   java.io.InputStream / OutputStream → minimal ImportInputStream / ImportOutputStream contracts
 *                                      (any byte source/sink can adapt them)
 *   java.io.ByteArrayOutputStream      → local ByteArraySink (grow-by-doubling, same semantics)
 *   File.canonicalFile / canonicalPath → lexical canonicalization (core has no fs access; symlinks
 *                                        are not resolved — the zip-slip guard itself is unchanged)
 *   require(cond) { msg }              → throw new Error(msg) with the same Chinese messages
 *
 * Note: `ArchiveBudget` / `splitChapterText` also exist in the already-split modules
 * `archiveBudget.ts` / `splitChapterText.ts` (same algorithms, byte-array shaped API).
 * This file is the self-contained Android-faithful variant; both are side-effect free.
 */

/** From Android `Book.kt`: `const val MAX_CHAPTER_LENGTH = 30_000`. */
export const MAX_CHAPTER_LENGTH = 30_000;

// ---------------------------------------------------------------------------
// Stream contracts (minimal ports of java.io.InputStream / java.io.OutputStream)
// ---------------------------------------------------------------------------

/** Port of `java.io.InputStream` — blocking read of up to `buffer.byteLength` bytes. */
export interface ImportInputStream {
  /** Copies bytes into `buffer`; returns the count, or `-1` at end of stream. */
  read(buffer: Uint8Array): number;
}

/** Port of `java.io.OutputStream`. */
export interface ImportOutputStream {
  /** Writes `length` bytes starting at `offset`. */
  write(buffer: Uint8Array, offset: number, length: number): void;
}

/**
 * Byte-array view over a `Uint8Array` (Android callers wrap an open InputStream).
 * Included so `readImportBytes` has a usable source without touching the DOM/fs.
 */
export function bytesInputStream(data: Uint8Array): ImportInputStream {
  let pos = 0;
  return {
    read(buffer: Uint8Array): number {
      if (pos >= data.length) return -1;
      const count = Math.min(buffer.byteLength, data.length - pos);
      buffer.set(data.subarray(pos, pos + count));
      pos += count;
      return count;
    },
  };
}

/** Port of `java.io.ByteArrayOutputStream` (write + toByteArray). */
class ByteArraySink implements ImportOutputStream {
  private buf = new Uint8Array(0);
  private len = 0;

  write(buffer: Uint8Array, offset: number, length: number): void {
    if (length <= 0) return;
    const required = this.len + length;
    if (required > this.buf.length) {
      let cap = Math.max(this.buf.length * 2, 32);
      while (cap < required) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    this.buf.set(buffer.subarray(offset, offset + length), this.len);
    this.len = required;
  }

  toByteArray(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

// ---------------------------------------------------------------------------
// ArchiveBudget
// ---------------------------------------------------------------------------

/** Lexical equivalent of `File.canonicalPath` (no symlink resolution in core). */
function canonicalize(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0) {
        out.pop();
      } else if (!absolute) {
        out.push('..');
      }
      continue;
    }
    out.push(part);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined;
}

/**
 * Limits apply to actual expanded bytes, including entries the parser ignores.
 * Android `internal class ArchiveBudget(...)` + `companion object { fun destination(...) }`.
 */
export class ArchiveBudget {
  private total = 0;
  private entries = 0;

  constructor(
    private readonly maxEntryBytes: number = 64 * 1024 * 1024,
    private readonly maxTotalBytes: number = 512 * 1024 * 1024,
    private readonly maxEntries: number = 10_000,
  ) {}

  copyEntry(input: ImportInputStream, output?: ImportOutputStream | null): void {
    this.entries += 1;
    if (!(this.entries <= this.maxEntries)) {
      throw new Error('压缩包条目过多');
    }
    const buffer = new Uint8Array(64 * 1024);
    let size = 0;
    for (;;) {
      const read = input.read(buffer);
      if (read < 0) break;
      size += read;
      this.total += read;
      if (!(size <= this.maxEntryBytes && this.total <= this.maxTotalBytes)) {
        throw new Error('压缩包解压体积超过安全上限');
      }
      output?.write(buffer, 0, read);
    }
  }

  /**
   * Android `ArchiveBudget.destination(root, entryName)`:
   * normalize `\`, reject absolute paths, resolve under `root`, reject escapes.
   * Returns the resolved destination path (Android returns the canonical File).
   */
  static destination(root: string, entryName: string): string {
    const normalized = entryName.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
      throw new Error('压缩包包含绝对路径');
    }
    const rootCanonical = canonicalize(root.replace(/\\/g, '/')).replace(/\/+$/, '');
    const target = canonicalize(`${rootCanonical}/${normalized}`);
    if (!target.startsWith(`${rootCanonical}/`)) {
      throw new Error('压缩包包含越界路径');
    }
    return target;
  }
}

// ---------------------------------------------------------------------------
// readImportBytes
// ---------------------------------------------------------------------------

/** Android `internal fun InputStream.readImportBytes(maxBytes = 64 * 1024 * 1024)`. */
export function readImportBytes(input: ImportInputStream, maxBytes = 64 * 1024 * 1024): Uint8Array {
  const output = new ByteArraySink();
  new ArchiveBudget(maxBytes, maxBytes, 1).copyEntry(input, output);
  return output.toByteArray();
}

// ---------------------------------------------------------------------------
// splitChapterText
// ---------------------------------------------------------------------------

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Keep UTF-16 pairs and inline image references intact when storing chapter rows. */
export function splitChapterText(text: string, limit: number = MAX_CHAPTER_LENGTH): string[] {
  if (!Number.isInteger(limit) || limit < 2) {
    throw new Error('章节长度上限必须 >= 2');
  }
  if (text.length === 0) return [];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      if (isHighSurrogate(text.charCodeAt(end - 1)) && isLowSurrogate(text.charCodeAt(end))) {
        end -= 1;
      }
      const tokenStart = text.lastIndexOf('[IMG:', end - 1);
      if (tokenStart >= start && text.indexOf(']', tokenStart) >= end) {
        if (!(tokenStart > start)) {
          throw new Error('内嵌图片引用超过章节长度上限');
        }
        end = tokenStart;
      }
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}
