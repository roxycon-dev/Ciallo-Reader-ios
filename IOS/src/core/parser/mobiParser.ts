/**
 * MOBI / AZW3 / AZW / PRC parser — port of Android `MobiParser.kt` to pure TS.
 *
 * PDB container + MOBI header + EXTH metadata.
 * Decompression: 1=none, 2=PalmDOC LZ77, 17480=HUFF/CDIC.
 * KF8 hybrid containers are detected via the BOUNDARY record.
 */

import { MAX_CHAPTER_LENGTH, splitChapterText } from '@core/data/splitChapterText';
import { CONTENT_TYPE_NOVEL, DEFAULT_CATEGORY, type BookRow, type ChapterRow } from '@core/library/bookTypes';
import type { FileSystemApi } from '@platform/interfaces';
import { probeImageSize } from './imageBytes';

export function isMobiFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.mobi') || lower.endsWith('.azw3') || lower.endsWith('.azw') || lower.endsWith('.prc')
  );
}

export interface ParsedMobi {
  title: string | null;
  author: string | null;
  html: string | null;
  encrypted: boolean;
  /**
   * Android `ParsedMobi.failureReason` — set when text decompression throws, so the
   * caller can surface `MOBI 正文解压失败：…` instead of "未找到有效正文内容".
   */
  failureReason: string | null;
  /** Android `ParsedMobi.coverBytes` — first decodable image record, if any. */
  coverBytes: Uint8Array | null;
  /**
   * Android `ParsedMobi.records` — PDB record payloads, needed to turn
   * `<img recindex="N">` into on-disk image tokens.
   */
  records: Uint8Array[];
  /** Android `ParsedMobi.firstImageIndex` — MOBI header offset 108. */
  firstImageIndex: number;
}

// ---------------------------------------------------------------------------
// Binary readers
// ---------------------------------------------------------------------------

function readU16(data: Uint8Array, offset: number): number {
  if (offset + 2 > data.length) return 0;
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
}

function readU32(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) return 0;
  return (
    (((data[offset] ?? 0) << 24) |
      ((data[offset + 1] ?? 0) << 16) |
      ((data[offset + 2] ?? 0) << 8) |
      (data[offset + 3] ?? 0)) >>>
    0
  );
}

// ---------------------------------------------------------------------------
// Header structures
// ---------------------------------------------------------------------------

interface ExthRecord {
  type: number;
  data: Uint8Array;
}

interface MobiHeader {
  recordIndex: number;
  compression: number;
  textLength: number;
  recordCount: number;
  encryptionType: number;
  textEncoding: number;
  firstImageIndex: number;
  huffmanRecordOffset: number;
  huffmanRecordCount: number;
  exthFlags: number;
  firstContentRecordIndex: number;
  lastContentRecordIndex: number;
  fullName: string;
  exth: ExthRecord[];
  multibyte: boolean;
  trailers: number;
}

function decodeMobiText(bytes: Uint8Array, textEncoding: number): string {
  if (bytes.length === 0) return '';
  let raw: string;
  if (textEncoding === 1252) {
    raw = new TextDecoder('windows-1252').decode(bytes);
  } else if (textEncoding === 65001) {
    raw = new TextDecoder('utf-8').decode(bytes);
  } else if (textEncoding === 65002) {
    const be = new TextDecoder('utf-16be').decode(bytes);
    raw = be.includes('\uFFFD') ? new TextDecoder('utf-16le').decode(bytes) : be;
  } else {
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    if (!utf8.includes('\uFFFD')) {
      raw = utf8;
    } else {
      try {
        raw = new TextDecoder('gb18030').decode(bytes);
      } catch {
        raw = utf8;
      }
    }
  }
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charAt(i);
    const code = raw.charCodeAt(i);
    if (ch === '\n' || ch === '\r' || ch === '\t' || (code >= 0x20 && code !== 0x7f)) {
      out += ch;
    }
  }
  return out;
}

function parseExth(record: Uint8Array, headerLength: number, exthFlags: number): ExthRecord[] {
  if ((exthFlags & 0x40) === 0) return [];
  const start = 16 + headerLength;
  if (start + 12 > record.length) return [];
  if (readU32(record, start) !== 0x45585448) return [];
  const count = readU32(record, start + 8);
  if (count <= 0 || count > 10_000) return [];
  const out: ExthRecord[] = [];
  let p = start + 12;
  for (let i = 0; i < count; i += 1) {
    if (p + 8 > record.length) break;
    const type = readU32(record, p);
    const len = readU32(record, p + 4);
    if (len < 8) break;
    const payloadLen = len - 8;
    if (p + 8 + payloadLen > record.length) break;
    out.push({ type, data: record.slice(p + 8, p + 8 + payloadLen) });
    p += len;
  }
  return out;
}

function parseMobiHeader(record: Uint8Array, recordIndex: number): MobiHeader | null {
  if (record.length < 132) return null;
  const magic = String.fromCharCode(record[16] ?? 0, record[17] ?? 0, record[18] ?? 0, record[19] ?? 0);
  if (magic !== 'MOBI') return null;

  const compression = readU16(record, 0);
  const textLength = readU32(record, 4);
  const recordCount = readU16(record, 8);
  const encryptionType = readU16(record, 12);
  const headerLength = readU32(record, 20);
  const textEncoding = readU32(record, 28);
  const fullNameOffset = readU32(record, 84);
  const fullNameLength = readU32(record, 88);
  const minVersion = readU32(record, 104);
  const firstImageIndex = readU32(record, 108);
  const huffmanRecordOffset = readU32(record, 112);
  const huffmanRecordCount = readU32(record, 116);
  const exthFlags = readU32(record, 128);

  let firstContentRecordIndex = 1;
  let lastContentRecordIndex = -1;
  if (headerLength >= 194 && record.length >= 196) {
    firstContentRecordIndex = readU16(record, 192);
  }
  if (headerLength >= 196 && record.length >= 198) {
    lastContentRecordIndex = readU16(record, 194);
  }

  let multibyte = false;
  let trailers = 0;
  if (minVersion >= 5 && headerLength >= 228 && record.length >= 244) {
    let mbhFlags = readU32(record, 240);
    multibyte = (mbhFlags & 1) !== 0;
    mbhFlags = mbhFlags >>> 1;
    while (mbhFlags > 0) {
      if ((mbhFlags & 1) !== 0) trailers += 1;
      mbhFlags = mbhFlags >>> 1;
    }
  }

  let fullName = '';
  // Kotlin L288-290 checks `fullNameOffset >= 0`, which readU32 always satisfies —
  // reproduced verbatim rather than tightened to `> 0`.
  if (fullNameLength > 0 && fullNameOffset >= 0 && fullNameOffset + fullNameLength <= record.length) {
    fullName = decodeMobiText(record.slice(fullNameOffset, fullNameOffset + fullNameLength), textEncoding);
  }

  const exth = parseExth(record, headerLength, exthFlags);
  return {
    recordIndex,
    compression,
    textLength,
    recordCount,
    encryptionType,
    textEncoding,
    firstImageIndex,
    huffmanRecordOffset,
    huffmanRecordCount,
    exthFlags,
    firstContentRecordIndex,
    lastContentRecordIndex,
    fullName,
    exth,
    multibyte,
    trailers,
  };
}

// ---------------------------------------------------------------------------
// PalmDOC LZ77
// ---------------------------------------------------------------------------

function decodePalmDoc(data: Uint8Array): Uint8Array {
  let out = new Uint8Array(Math.max(4096, data.length * 4));
  let o = 0;
  let i = 0;
  const ensure = (extra: number): void => {
    if (o + extra > out.length) {
      const next = new Uint8Array(Math.max(out.length * 2, o + extra));
      next.set(out.subarray(0, o));
      out = next;
    }
  };
  while (i < data.length) {
    const c = data[i] ?? 0;
    i += 1;
    if (c >= 1 && c <= 8) {
      ensure(c);
      const end = Math.min(i + c, data.length);
      while (i < end) {
        out[o] = data[i] ?? 0;
        o += 1;
        i += 1;
      }
    } else if (c < 0x80) {
      ensure(1);
      out[o] = c;
      o += 1;
    } else if (c >= 0xc0) {
      ensure(2);
      out[o] = 0x20;
      o += 1;
      out[o] = (c ^ 0x80) & 0xff;
      o += 1;
    } else if (i < data.length) {
      const c2 = (c << 8) | (data[i] ?? 0);
      i += 1;
      const length = (c2 & 0x07) + 3;
      const location = (c2 >>> 3) & 0x7ff;
      if (location >= 1 && location <= o) {
        ensure(length);
        for (let k = 0; k < length; k += 1) {
          out[o] = out[o - location] ?? 0;
          o += 1;
        }
      }
    }
  }
  return out.slice(0, o);
}

function scoreTextBytes(bytes: Uint8Array): number {
  let score = 0;
  const n = Math.min(bytes.length, 300);
  for (let i = 0; i < n; i += 1) {
    const b = bytes[i] ?? 0;
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) score += 1;
  }
  return score;
}

function trailingEntrySize(data: Uint8Array): number {
  let num = 0;
  for (let i = data.length - 4; i < data.length; i += 1) {
    if (i < 0) continue;
    const b = data[i] ?? 0;
    if ((b & 0x80) !== 0) num = 0;
    num = ((num << 7) | (b & 0x7f)) >>> 0;
  }
  return num;
}

function trimTrailing(data: Uint8Array, header: MobiHeader): Uint8Array {
  let result = data;
  for (let t = 0; t < header.trailers; t += 1) {
    const num = trailingEntrySize(result);
    if (num >= 1 && num < result.length) {
      result = result.slice(0, result.length - num);
    }
  }
  if (header.multibyte && result.length > 0) {
    const num = ((result[result.length - 1] ?? 0) & 0x03) + 1;
    if (num >= 1 && num < result.length) {
      result = result.slice(0, result.length - num);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// HUFF/CDIC
// ---------------------------------------------------------------------------

interface HuffDictRecord {
  codeLen: number;
  term: bigint;
  maxCode: bigint;
}

interface HuffSlice {
  data: Uint8Array;
  flag: number;
}

function dictUnpack(v: number): HuffDictRecord {
  const codeLen = v & 0x1f;
  const term = BigInt(v & 0x80);
  if (codeLen === 0) throw new Error('无效的 HUFF codelen');
  if (codeLen <= 8 && term === 0n) throw new Error('无效的 HUFF term');
  const base = BigInt((v >>> 8) + 1);
  const maxCode = (base << BigInt(32 - codeLen)) - 1n;
  return { codeLen, term, maxCode };
}

class HuffCdic {
  private readonly dict1: HuffDictRecord[] = [];
  private readonly dict2: number[] = [];
  private readonly mincode: bigint[] = [];
  private readonly maxcode: bigint[] = [];
  private readonly dictionary: HuffSlice[] = [];
  private readonly expanding = new Set<number>();
  private cachedBytes = 0;

  constructor(
    private readonly records: Uint8Array[],
    private readonly header: MobiHeader,
  ) {
    this.initialize();
  }

  private initialize(): void {
    const huffOff = this.header.huffmanRecordOffset;
    if (huffOff < 0 || huffOff >= this.records.length) {
      throw new Error(`HUFF 记录索引越界: ${huffOff}`);
    }
    const huffRec = this.records[huffOff];
    if (!huffRec) throw new Error(`HUFF 记录缺失: ${huffOff}`);
    this.loadHuff(huffRec);
    const recCount = this.header.huffmanRecordCount;
    if (recCount <= 0) throw new Error(`HUFF 记录数量无效: ${recCount}`);
    for (let i = 1; i < recCount; i += 1) {
      const idx = huffOff + i;
      if (idx >= this.records.length) break;
      const rec = this.records[idx];
      if (rec) this.loadCdic(rec);
    }
  }

  private loadHuff(data: Uint8Array): void {
    if (data.length < 16 || readU32(data, 0) !== 0x48554646 || readU32(data, 4) !== 24) {
      throw new Error('无效的 HUFF 头');
    }
    const off1 = readU32(data, 8);
    const off2 = readU32(data, 12);
    if (off1 + 256 * 4 > data.length || off2 + 64 * 4 > data.length) {
      throw new Error('HUFF 表偏移越界');
    }
    for (let i = 0; i < 256; i += 1) {
      this.dict1.push(dictUnpack(readU32(data, off1 + i * 4)));
    }
    for (let i = 0; i < 64; i += 1) {
      this.dict2.push(readU32(data, off2 + i * 4));
    }

    let count = 1;
    this.mincode.push(0n);
    this.maxcode.push(0n);
    let i = 0;
    while (i < this.dict2.length) {
      const item = BigInt(this.dict2[i] ?? 0);
      this.mincode.push(item << BigInt(32 - count));
      count += 1;
      i += 2;
    }
    count = 1;
    i = 1;
    while (i < this.dict2.length) {
      const item = BigInt(this.dict2[i] ?? 0);
      this.maxcode.push(((item + 1n) << BigInt(32 - count)) - 1n);
      count += 1;
      i += 2;
    }
  }

  private loadCdic(data: Uint8Array): void {
    if (data.length < 16 || readU32(data, 0) !== 0x43444943 || readU32(data, 4) !== 16) {
      throw new Error('无效的 CDIC 头');
    }
    const phrases = readU32(data, 8);
    const bits = readU32(data, 12);
    if (bits > 16) throw new Error(`无效的 CDIC bits: ${bits}`);
    const n = Math.min(1 << bits, phrases - this.dictionary.length);
    for (let i = 0; i < n; i += 1) {
      const offset = readU16(data, 16 + i * 2);
      if (16 + offset + 2 > data.length) break;
      this.dictionary.push(this.getSlice(data, offset));
    }
  }

  private getSlice(data: Uint8Array, offset: number): HuffSlice {
    const blen = readU16(data, 16 + offset);
    const len = blen & 0x7fff;
    if (18 + offset + len > data.length) throw new Error('CDIC 切片越界');
    return {
      data: data.slice(18 + offset, 18 + offset + len),
      flag: (blen & 0x8000) !== 0 ? 1 : 0,
    };
  }

  unpack(input: Uint8Array, depth = 0): Uint8Array {
    if (depth > 64) throw new Error('HUFF短语递归过深');
    let out = new Uint8Array(4096);
    let op = 0;
    let bitsleft = input.length * 8;
    const data = new Uint8Array(input.length + 8);
    data.set(input, 0);
    let pos = 0;
    let xHi = readU32(data, pos);
    let xLo = readU32(data, pos + 4);
    let n = 32;
    const emit = (slice: HuffSlice): void => {
      const d = slice.data;
      if (op + d.length > 8 * 1024 * 1024) throw new Error('HUFF记录膨胀过大');
      if (op + d.length > out.length) {
        const next = new Uint8Array(Math.max(out.length * 2, op + d.length));
        next.set(out.subarray(0, op));
        out = next;
      }
      out.set(d, op);
      op += d.length;
    };
    for (;;) {
      if (n <= 0) {
        pos += 4;
        if (pos + 8 > data.length) break;
        xHi = readU32(data, pos);
        xLo = readU32(data, pos + 4);
        n += 32;
      }
      let code: number;
      if (n === 0) {
        code = xLo >>> 0;
      } else if (n >= 32) {
        code = (xHi >>> (n - 32)) >>> 0;
      } else {
        code = (((xHi >>> n) | (xLo << (32 - n))) >>> 0);
      }
      const firstRec = this.dict1[(code >>> 24) & 0xff];
      if (!firstRec) break;
      let codelen = firstRec.codeLen;
      let max: bigint = firstRec.maxCode;
      if (firstRec.term === 0n) {
        while (codelen <= 32 && BigInt(code) < (this.mincode[codelen] ?? 0n)) codelen += 1;
        if (codelen > 32) break;
        max = this.maxcode[codelen] ?? 0n;
      }
      n -= codelen;
      bitsleft -= codelen;
      if (bitsleft < 0) break;
      const rBig = (max - BigInt(code)) >> BigInt(32 - codelen);
      const r = Number(rBig);
      if (!Number.isInteger(r) || r < 0 || r >= this.dictionary.length) break;
      let slice = this.dictionary[r];
      if (!slice) break;
      if (slice.flag === 0) {
        if (this.expanding.has(r)) throw new Error('HUFF短语循环引用');
        this.expanding.add(r);
        let newData: Uint8Array;
        try {
          newData = this.unpack(slice.data, depth + 1);
        } finally {
          this.expanding.delete(r);
        }
        this.cachedBytes += newData.length;
        if (this.cachedBytes > 32 * 1024 * 1024) throw new Error('HUFF字典膨胀过大');
        slice = { data: newData, flag: 1 };
        this.dictionary[r] = slice;
      }
      emit(slice);
    }
    return out.slice(0, op);
  }
}

// ---------------------------------------------------------------------------
// Decompression
// ---------------------------------------------------------------------------

function decompressText(
  records: Uint8Array[],
  header: MobiHeader,
  startRecord: number,
): Uint8Array {
  let endRecord = startRecord + header.recordCount - 1;
  if (header.lastContentRecordIndex > 0 && header.lastContentRecordIndex < records.length) {
    endRecord = Math.min(endRecord, header.lastContentRecordIndex);
  }
  if (endRecord >= records.length) endRecord = records.length - 1;
  if (startRecord > endRecord) return new Uint8Array(0);

  if (header.compression === 1) {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let i = startRecord; i <= endRecord; i += 1) {
      const rec = records[i];
      if (!rec) continue;
      const trimmed = trimTrailing(rec, header);
      parts.push(trimmed);
      total += trimmed.length;
      if (total > 64 * 1024 * 1024) throw new Error('MOBI正文过大');
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
  if (header.compression === 2) {
    const first = records[startRecord];
    if (!first) return new Uint8Array(0);
    // Kotlin L368-375 measures `first.size` (the **untrimmed** record) and slices the
    // **untrimmed** record, then trims the slice. Trimming first (as an earlier port
    // did) changes both the `> 2` probe and the slice whenever MbhFlags trailers /
    // multibyte actually trim this record, which flips `useSkip2` on records whose
    // first two bytes are part of the text.
    const decode0 = decodePalmDoc(trimTrailing(first, header));
    const decode2 =
      first.length > 2 ? decodePalmDoc(trimTrailing(first.slice(2), header)) : decode0;
    const useSkip2 = scoreTextBytes(decode2) > scoreTextBytes(decode0);
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let i = startRecord; i <= endRecord; i += 1) {
      const rec = records[i];
      if (!rec) continue;
      let r = trimTrailing(rec, header);
      if (useSkip2 && r.length > 2) r = r.slice(2);
      const decoded = decodePalmDoc(r);
      parts.push(decoded);
      total += decoded.length;
      if (total > 64 * 1024 * 1024) throw new Error('MOBI正文过大');
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
  if (header.compression === 17480) {
    const huff = new HuffCdic(records, header);
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let i = startRecord; i <= endRecord; i += 1) {
      const rec = records[i];
      if (!rec) continue;
      const decoded = huff.unpack(trimTrailing(rec, header));
      parts.push(decoded);
      total += decoded.length;
      if (total > 64 * 1024 * 1024) throw new Error('MOBI正文过大');
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
  throw new Error(`不支持的压缩格式: ${header.compression}`);
}

// ---------------------------------------------------------------------------
// parseMobi
// ---------------------------------------------------------------------------

export function parseMobi(bytes: Uint8Array): ParsedMobi | null {
  // Kotlin L166-183 — `bytes.size < 80` → null, record table parse, MOBI magic.
  if (bytes.length < 80) return null;
  const recordCount = readU16(bytes, 76);
  if (recordCount <= 0 || recordCount > 100_000) return null;

  const records: Uint8Array[] = [];
  for (let i = 0; i < recordCount; i += 1) {
    const off = readU32(bytes, 78 + i * 8);
    if (off > bytes.length) break;
    const end =
      i + 1 < recordCount ? readU32(bytes, 78 + (i + 1) * 8) : bytes.length;
    const endInt = Math.min(end, bytes.length);
    if (off >= endInt) break;
    records.push(bytes.slice(off, endInt));
  }
  if (records.length === 0) return null;

  const firstRecord = records[0];
  if (!firstRecord) return null;
  const firstHeader = parseMobiHeader(firstRecord, 0);
  if (!firstHeader) return null;

  let active = firstHeader;
  let startRecord = firstHeader.firstContentRecordIndex > 0 ? firstHeader.firstContentRecordIndex : 1;
  if (startRecord >= records.length) startRecord = 1;

  // KF8 (AZW3) hybrid container: BOUNDARY record switches to the KF8 section
  let boundaryIndex = -1;
  const firstSectionEnd = firstHeader.recordCount;
  for (let i = firstSectionEnd; i < records.length; i += 1) {
    const rec = records[i];
    if (!rec) continue;
    if (
      rec.length >= 8 &&
      readU32(rec, 0) === 0x424f554e &&
      String.fromCharCode(...rec.subarray(0, 8)) === 'BOUNDARY'
    ) {
      boundaryIndex = i;
      break;
    }
  }
  if (boundaryIndex >= 0 && boundaryIndex + 1 < records.length) {
    const kf8Rec = records[boundaryIndex + 1];
    if (kf8Rec) {
      const kf8 = parseMobiHeader(kf8Rec, boundaryIndex + 1);
      if (kf8) {
        active = kf8;
        startRecord = boundaryIndex + 2;
      }
    }
  }

  const exthTitle = active.exth.find((r) => r.type === 503)?.data;
  const fullName = active.fullName;
  let title = '';
  if (fullName.trim().length > 0) {
    title = fullName;
  } else if (exthTitle) {
    title = decodeMobiText(exthTitle, active.textEncoding);
  }
  const authorRec = active.exth.find((r) => r.type === 100)?.data;
  const author = authorRec ? decodeMobiText(authorRec, active.textEncoding) : '';

  // Kotlin L223-225 — DRM: ParsedMobi(title, author, encryptionType, null, null, null).
  // The 7th/8th constructor arguments keep their Kotlin defaults, so `records` is
  // empty and `firstImageIndex` is 0 (NOT `active.firstImageIndex`).
  if (active.encryptionType !== 0) {
    return {
      title: title.length > 0 ? title : null,
      author: author.length > 0 ? author : null,
      html: null,
      encrypted: true,
      failureReason: null,
      coverBytes: null,
      records: [],
      firstImageIndex: 0,
    };
  }

  let decompressed: Uint8Array;
  try {
    decompressed = decompressText(records, active, startRecord);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      title: title.length > 0 ? title : null,
      author: author.length > 0 ? author : null,
      html: null,
      encrypted: false,
      failureReason: `MOBI 正文解压失败：${msg || '不支持的压缩格式'}`,
      coverBytes: null,
      // Kotlin L232-239 — the 7th/8th arguments default to emptyList()/0 here too.
      records: [],
      firstImageIndex: 0,
    };
  }

  const html = decodeMobiText(decompressed, active.textEncoding);
  return {
    title: title.length > 0 ? title : null,
    author: author.length > 0 ? author : null,
    html: html.length > 0 ? html : null,
    encrypted: false,
    failureReason: null,
    coverBytes: extractCover(records, active, startRecord),
    records,
    firstImageIndex: active.firstImageIndex,
  };
}

// ---------------------------------------------------------------------------
// Cover extraction — Kotlin L679-775
// ---------------------------------------------------------------------------

function readI32(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) return 0;
  return (
    (((data[offset] ?? 0) << 24) |
      ((data[offset + 1] ?? 0) << 16) |
      ((data[offset + 2] ?? 0) << 8) |
      (data[offset + 3] ?? 0)) >>>
    0
  );
}

/** Kotlin L709-729 `looksLikeImage`. */
function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const b0 = bytes[0] as number;
  const b1 = bytes[1] as number;
  const b2 = bytes[2] as number;
  const b3 = bytes[3] as number;
  if (b0 === 0xff && b1 === 0xd8) return true; // JPEG
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return true; // PNG
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return true; // GIF
  if (b0 === 0x42 && b1 === 0x4d) return true; // BMP
  // 带 6 字节偏移头的 JPEG（JFIF / Exif）
  if (bytes.length >= 10 && b0 === 0 && b1 === 0 && b2 === 0 && b3 === 0) {
    const b6 = bytes[6] as number;
    const b7 = bytes[7] as number;
    const b8 = bytes[8] as number;
    const b9 = bytes[9] as number;
    if (b6 === 0x4a && b7 === 0x46 && b8 === 0x49 && b9 === 0x46) return true; // JFIF
    if (b6 === 0x45 && b7 === 0x78 && b8 === 0x69 && b9 === 0x66) return true; // Exif
  }
  return false;
}

function indexOfBytes(data: Uint8Array, pattern: Uint8Array): number {
  if (pattern.length === 0 || data.length < pattern.length) return -1;
  outer: for (let i = 0; i <= data.length - pattern.length; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) {
      if (data[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Kotlin L731-751 `normalizeImage`. Android validates with a full
 * `BitmapFactory.decodeByteArray`; the equivalent core-side check is the header
 * probe, which returns null for bytes no decoder would accept.
 */
function normalizeImage(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length === 0) return null;
  if (probeImageSize(bytes) !== null) return bytes;
  const candidates: Uint8Array[] = [];
  if (bytes.length > 6) {
    const tail = bytes.slice(6);
    if (probeImageSize(tail) !== null) candidates.push(tail);
  }
  const markers = [
    new Uint8Array([0xff, 0xd8]),
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    new Uint8Array([0x47, 0x49, 0x46]),
  ];
  for (const marker of markers) {
    const idx = indexOfBytes(bytes, marker);
    if (idx > 0) {
      const sub = bytes.slice(idx);
      if (probeImageSize(sub) !== null) candidates.push(sub);
    }
  }
  return candidates[0] ?? null;
}

/** Kotlin L764-775 `detectImageExt` (JPEG includes the 6-byte-offset JFIF form). */
function mobiDetectImageExt(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (
    bytes.length >= 10 &&
    bytes[6] === 0x4a &&
    bytes[7] === 0x46 &&
    bytes[8] === 0x49 &&
    bytes[9] === 0x46
  ) {
    return 'jpg';
  }
  return null;
}

/** Kotlin L679-707 `extractCover`. */
function extractCover(
  records: Uint8Array[],
  header: MobiHeader,
  startRecord: number,
): Uint8Array | null {
  const coverRec = header.exth.find((r) => r.type === 201);
  const coverOffset =
    coverRec !== undefined && coverRec.data.length >= 4 ? readI32(coverRec.data, 0) : -1;

  const candidates: number[] = [];
  if (coverOffset >= 0) {
    const idx1 = header.firstImageIndex + coverOffset;
    if (idx1 >= 0 && idx1 < records.length) candidates.push(idx1);
    const idx2 = startRecord + header.firstImageIndex + coverOffset;
    if (idx2 >= 0 && idx2 < records.length && idx2 !== idx1) candidates.push(idx2);
    const idx3 = startRecord + coverOffset;
    if (idx3 >= 0 && idx3 < records.length && idx3 !== idx1 && idx3 !== idx2) candidates.push(idx3);
  }

  // 暴力兜底：扫描所有疑似图片记录，按体积从大到小验证
  const scanned: number[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const rec = records[i];
    if (rec !== undefined && looksLikeImage(rec)) scanned.push(i);
  }
  scanned.sort((a, b) => (records[b]?.length ?? 0) - (records[a]?.length ?? 0));

  for (const idx of candidates.concat(scanned)) {
    const rec = records[idx];
    if (rec === undefined) continue;
    const normalized = normalizeImage(rec);
    if (normalized !== null) return normalized;
  }
  return null;
}

/**
 * Kotlin L792-828 `embedMobiImages` — `<img recindex="N">` → `[IMG:<path>|<w>|<h>]`.
 * `writeImage(name, bytes)` stores the record and returns the path it wrote to;
 * returning null makes the caller fall back to the original `<img>` tag, exactly
 * like an unwritable file does on Android.
 */
export function embedMobiImages(
  html: string,
  records: Uint8Array[],
  firstImageIndex: number,
  writeImage: (name: string, bytes: Uint8Array) => string | null,
): string {
  if (!/recindex/i.test(html)) return html; // Kotlin L799
  // Kotlin L803 — `<img[^>]*recindex="?(\d+)"?[^>]*>`, IGNORE_CASE only (no DOTALL).
  return html.replace(/<img[^>]*recindex="?(\d+)"?[^>]*>/gi, (m: string, raw: string) => {
    if (!/^\d+$/.test(raw)) return m;
    const rec = Number.parseInt(raw, 10);
    // Kotlin L807-812 — `startRecordFallback` is Kotlin's `= -1`, so it never
    // contributes a candidate; reproduced (not "fixed") to keep candidate order.
    const indices = [firstImageIndex + rec, firstImageIndex + rec - 1, -1, rec].filter(
      (v, i, arr) => v >= 0 && v < records.length && arr.indexOf(v) === i,
    );
    let found: Uint8Array | null = null;
    for (const idx of indices) {
      const bytes = records[idx];
      if (bytes !== undefined && looksLikeImage(bytes)) {
        found = bytes;
        break;
      }
    }
    if (found === null) return m;
    const normalized = normalizeImage(found);
    if (normalized === null) return m;
    const ext = mobiDetectImageExt(normalized) ?? 'jpg';
    const path = writeImage(`img_${rec}.${ext}`, normalized);
    if (path === null) return m;
    const size = probeImageSize(normalized);
    // Kotlin L824 — `outWidth.coerceAtLeast(1)` (BitmapFactory already decoded it).
    const w = size && size.width > 0 ? size.width : 1;
    const h = size && size.height > 0 ? size.height : 1;
    return `[IMG:${path}|${w}|${h}]`;
  });
}

// ---------------------------------------------------------------------------
// Chapter splitting
// ---------------------------------------------------------------------------

const FALLBACK_SPLIT_LENGTH = 5_000;

/** Kotlin L781-783 — `(?i)<(?:mbp:pagebreak|pagebreak|hr)[^>]*>`; note no word boundary. */
const PAGE_BREAK_RE = /<(?:mbp:pagebreak|pagebreak|hr)[^>]*>/gi;
/** Kotlin L784-786 — `(?is)<(h[1-6])([^>]*)>(.*?)</\1>`. */
const HEADING_RE = /<(h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi;

/**
 * Kotlin L955-972. The named replacements run **sequentially**, so
 * `&amp;nbsp;` collapses all the way to a space (L843 turns it into `&nbsp;`,
 * then nothing re-decodes it — matching Kotlin's `&amp;nbsp;` → `&` + `nbsp;`).
 */
function unescapeHtml(input: string): string {
  let text = input
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  // Kotlin L958-961 — decimal first; `toIntOrNull()` is null above Int.MAX_VALUE,
  // in which case the source text is kept verbatim.
  text = text.replace(/&#(\d+);/g, (whole: string, digits: string) => {
    const code = Number.parseInt(digits, 10);
    if (!Number.isFinite(code) || code > 0x7fffffff) return whole;
    return String.fromCharCode(code);
  });
  // Kotlin L964-967 — hex. `toChar()` is a UTF-16 code unit, hence fromCharCode.
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (whole: string, digits: string) => {
    const code = Number.parseInt(digits, 16);
    if (!Number.isFinite(code) || code > 0x7fffffff) return whole;
    return String.fromCharCode(code);
  });
  return text;
}

/**
 * Kotlin L937-953 `cleanHtmlText`. Replace order is load-bearing: `<head>` goes
 * first so a `<style>` nested inside it never needs its own pass.
 */
function cleanHtmlText(html: string): string {
  if (html.trim() === '') return '';
  let text = html
    .replace(/<head[\s\S]*?<\/head>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  // Kotlin L945-946 — open and close tags are separate passes, both to "\n".
  text = text.replace(/<(?:p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n');
  text = text.replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = unescapeHtml(text);
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n\n');
}

/** Kotlin L932-934 — first non-blank line of the cleaned heading. */
function cleanHeadingText(raw: string): string {
  const text = cleanHtmlText(raw);
  return text.split('\n').find((l) => l.length > 0) ?? '';
}

export function splitHtmlIntoChapters(html: string): Array<{ title: string; content: string }> {
  if (!html || !html.trim()) return [];

  // 1. Coarse split on pagebreak / hr
  const sections: string[] = [];
  let pos = 0;
  for (const m of html.matchAll(PAGE_BREAK_RE)) {
    const start = m.index ?? 0;
    sections.push(html.slice(pos, start));
    pos = start + m[0].length;
  }
  sections.push(html.slice(pos));

  // 2. Kotlin L842-861. A heading is its OWN segment (`m.value`, the tag alone)
  //    carrying the title hint; the body that follows becomes a separate
  //    hint-less segment titled 第 N 章. This is why one `<h1>+<p>` pair yields
  //    two chapters on Android — reproduced here rather than "improved".
  const rawSegments: Array<{ hint: string; segment: string }> = [];
  for (const section of sections) {
    const matches = [...section.matchAll(HEADING_RE)];
    if (matches.length === 0) {
      rawSegments.push({ hint: '', segment: section });
      continue;
    }
    let p = 0;
    for (const m of matches) {
      const start = m.index ?? 0;
      if (start > p) {
        rawSegments.push({ hint: '', segment: section.slice(p, start) });
      }
      rawSegments.push({ hint: cleanHeadingText(m[3] ?? ''), segment: m[0] });
      p = start + m[0].length;
    }
    if (p < section.length) {
      rawSegments.push({ hint: '', segment: section.slice(p) });
    }
  }

  const chapters: Array<{ title: string; content: string }> = [];
  for (const { hint, segment } of rawSegments) {
    const text = cleanHtmlText(segment);
    if (!text.trim()) continue;
    const title = hint.length > 0 ? hint : `第 ${chapters.length + 1} 章`;
    // Kotlin L919-929 — `splitChapterText`, not a naive fixed-width slice.
    if (text.length <= MAX_CHAPTER_LENGTH) {
      chapters.push({ title, content: text });
    } else {
      const parts = splitChapterText(text);
      parts.forEach((part, index) => {
        chapters.push({
          title: index === 0 ? title : `${title} (续${index + 1})`,
          content: part,
        });
      });
    }
  }

  if (chapters.length === 0) return [];

  // 3. Structureless book: fixed-length fallback split
  if (chapters.length === 1 && rawSegments.length === 1) {
    const only = chapters[0];
    if (only && only.content.length > FALLBACK_SPLIT_LENGTH) {
      const fullText = only.content;
      const fallback: Array<{ title: string; content: string }> = [];
      let idx = 0;
      let chunkNo = 1;
      while (idx < fullText.length) {
        const end = Math.min(idx + FALLBACK_SPLIT_LENGTH, fullText.length);
        fallback.push({
          title: `第 ${chunkNo} 部分`,
          content: fullText.slice(idx, end),
        });
        chunkNo += 1;
        idx = end;
      }
      return fallback;
    }
  }

  return chapters;
}

// ---------------------------------------------------------------------------
// importMobi — Kotlin L38-128
// ---------------------------------------------------------------------------

/** Kotlin L30 — the placeholder chapter title a DRM-protected book is stored with. */
export const DRM_CHAPTER_TITLE = '该文件受版权保护，暂不支持阅读';

/** Narrow slice of Android BookDao used by MOBI import. */
export interface MobiBookDao {
  insertBook(book: Omit<BookRow, 'id'>): Promise<number>;
  insertChapters(chapters: Array<Omit<ChapterRow, 'id'>>): Promise<void>;
  updateBook(book: BookRow): Promise<void>;
  deleteBook(book: BookRow): Promise<void>;
}

export interface MobiImportDeps {
  fs: FileSystemApi;
  /** App files root (Android `context.filesDir`). */
  filesDir: string;
  bookDao: MobiBookDao;
  /** Kotlin `System.currentTimeMillis()` for the generated cover file name. */
  now?: () => number;
}

function mobiJoinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

/**
 * Android `MobiParser.importMobi` orchestration.
 * targetBookId 非空 = 老书补图片迁移：不新建书、失败不删书。
 */
export async function importMobi(
  bytes: Uint8Array,
  fileName: string,
  filePath: string,
  deps: MobiImportDeps,
  targetBookId: number | null = null,
): Promise<BookRow> {
  const now = deps.now ?? Date.now;
  try {
    const parsed = parseMobi(bytes);
    if (!parsed) throw new Error('不是有效的 MOBI/AZW3 文件');
    if (parsed.failureReason !== null) throw new Error(parsed.failureReason);

    // Kotlin L58 — `parsed.title.ifBlank { fileName.substringBeforeLast('.').ifBlank { fileName } }`
    const stemIdx = fileName.lastIndexOf('.');
    const stem = stemIdx >= 0 ? fileName.slice(0, stemIdx) : fileName;
    const parsedTitle = (parsed.title ?? '').trim();
    const parsedAuthor = (parsed.author ?? '').trim();
    const title =
      parsedTitle !== '' ? parsedTitle : stem.trim() !== '' ? stem : fileName;
    const author = parsedAuthor !== '' ? parsedAuthor : '未知作者';

    const addedTime = now();
    const initialBook: BookRow = {
      title,
      author,
      filePath,
      coverUri: null,
      category: DEFAULT_CATEGORY,
      currentChapterIndex: 0,
      scrollOffset: 0,
      isFinished: 0,
      totalChapters: 0,
      contentType: CONTENT_TYPE_NOVEL,
      addedTime,
      lastReadTime: addedTime,
      sourceId: null,
      comicId: null,
    };
    const bookId = targetBookId ?? (await deps.bookDao.insertBook(initialBook));

    // DRM 保护：占位入库，章节标题给出明确提示，不尝试解析
    if (parsed.encrypted) {
      await deps.bookDao.insertChapters([
        {
          bookId,
          chapterOrder: 0,
          title: DRM_CHAPTER_TITLE,
          content: '',
          startCharIndex: 0,
          endCharIndex: 0,
        },
      ]);
      const drmBook: BookRow = { ...initialBook, id: bookId, totalChapters: 1 };
      await deps.bookDao.updateBook(drmBook);
      return drmBook;
    }

    const html = parsed.html ?? '';
    // Kotlin L90 — `embedMobiImages` writes `mobi_images/<bookId>/img_<rec>.<ext>`.
    // `embedMobiImages` is synchronous, so the writes are collected here and awaited
    // right after; Kotlin's `f.writeBytes` throws inline (Kotlin L821), which the
    // outer catch turns into `MOBI 解析失败`, so a rejected write must not be swallowed.
    const imageDir = mobiJoinPath(deps.filesDir, `mobi_images/${bookId}`);
    const writes: Array<Promise<void>> = [];
    const htmlWithImages = embedMobiImages(
      html,
      parsed.records,
      parsed.firstImageIndex,
      (name, data) => {
        const path = mobiJoinPath(imageDir, name);
        writes.push(deps.fs.writeFile(path, data));
        return path;
      },
    );
    await Promise.all(writes);

    const chapters = splitHtmlIntoChapters(htmlWithImages);
    if (chapters.length === 0) {
      if (targetBookId === null) await deps.bookDao.deleteBook({ ...initialBook, id: bookId });
      throw new Error('MOBI 文件中未找到有效正文内容');
    }

    let coverUri: string | null = null;
    const coverBytes = parsed.coverBytes;
    if (coverBytes !== null && probeImageSize(coverBytes) !== null) {
      try {
        // Kotlin L104-107
        const ext = mobiDetectImageExt(coverBytes) ?? 'jpg';
        const destCover = mobiJoinPath(
          mobiJoinPath(deps.filesDir, 'mobi_covers'),
          `cover_${bookId}_${now()}.${ext}`,
        );
        await deps.fs.writeFile(destCover, coverBytes);
        coverUri = destCover;
      } catch {
        // Kotlin L108-110 — cover write failure is logged and ignored.
      }
    }

    await deps.bookDao.insertChapters(
      chapters.map((ch, i) => ({
        bookId,
        chapterOrder: i,
        title: ch.title,
        content: ch.content,
        startCharIndex: 0,
        endCharIndex: 0,
      })),
    );
    const finalBook: BookRow = {
      ...initialBook,
      id: bookId,
      coverUri,
      totalChapters: chapters.length,
    };
    await deps.bookDao.updateBook(finalBook);
    return finalBook;
  } catch (t) {
    throw new Error(t instanceof Error && t.message ? t.message : 'MOBI 解析失败');
  }
}
