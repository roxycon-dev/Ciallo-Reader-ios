import { describe, expect, it } from 'vitest';
import { isMobiFile, parseMobi } from '../../src/core/parser/mobiParser';

function writeU16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/**
 * Construct a minimal uncompressed PDB + MOBI container:
 *  record0 = MOBI header + EXTH (503 title / 100 author)
 *  record1 = UTF-8 text record
 */
function buildMinimalMobi(): Uint8Array {
  const encoder = new TextEncoder();
  const title = encoder.encode('测试书');
  const author = encoder.encode('测试作者');
  const text = encoder.encode('<p>Hello</p>');

  const headerLength = 232;
  const exthStart = 16 + headerLength; // 248
  const rec503Len = 8 + title.length; // 17
  const rec100Len = 8 + author.length; // 20
  const exthTotal = 12 + rec503Len + rec100Len; // 49
  const fullNameOffset = exthStart + exthTotal; // 297
  const rec0Length = fullNameOffset + title.length; // 306

  const rec0 = new Uint8Array(rec0Length);
  writeU16(rec0, 0, 1); // compression: none
  writeU32(rec0, 4, text.length); // text length
  writeU16(rec0, 8, 2); // record count
  writeU16(rec0, 10, 0); // encryption: none
  rec0[16] = 0x4d; // 'M'
  rec0[17] = 0x4f; // 'O'
  rec0[18] = 0x42; // 'B'
  rec0[19] = 0x49; // 'I'
  writeU32(rec0, 20, headerLength);
  writeU32(rec0, 24, 2); // mobi type
  writeU32(rec0, 28, 65001); // text encoding: UTF-8
  writeU32(rec0, 84, fullNameOffset);
  writeU32(rec0, 88, title.length);
  writeU32(rec0, 104, 6); // min version
  writeU32(rec0, 108, 0); // first image index
  writeU32(rec0, 112, 0); // huffman record offset
  writeU32(rec0, 116, 0); // huffman record count
  writeU32(rec0, 128, 0x40); // exth flags

  rec0.set(encoder.encode('EXTH'), exthStart);
  writeU32(rec0, exthStart + 4, exthTotal);
  writeU32(rec0, exthStart + 8, 2); // exth record count
  let p = exthStart + 12;
  writeU32(rec0, p, 503); // title
  writeU32(rec0, p + 4, rec503Len);
  rec0.set(title, p + 8);
  p += rec503Len;
  writeU32(rec0, p, 100); // author
  writeU32(rec0, p + 4, rec100Len);
  rec0.set(author, p + 8);
  rec0.set(title, fullNameOffset);

  const rec1 = text.slice();
  const recordCount = 2;
  const tableSize = recordCount * 8;
  const rec0Offset = 78 + tableSize;
  const rec1Offset = rec0Offset + rec0.length;
  const file = new Uint8Array(rec1Offset + rec1.length);
  file.set(encoder.encode('TestBook'), 0);
  writeU16(file, 76, recordCount);
  writeU32(file, 78, rec0Offset);
  writeU32(file, 86, rec1Offset);
  file.set(rec0, rec0Offset);
  file.set(rec1, rec1Offset);
  return file;
}

describe('mobiParser', () => {
  it('识别 MOBI 系扩展名', () => {
    expect(isMobiFile('x.azw3')).toBe(true);
    expect(isMobiFile('book.mobi')).toBe(true);
    expect(isMobiFile('a.azw')).toBe(true);
    expect(isMobiFile('b.prc')).toBe(true);
    expect(isMobiFile('c.epub')).toBe(false);
  });

  it('解析最小未压缩 MOBI：EXTH 标题 / 作者 / 正文', () => {
    const parsed = parseMobi(buildMinimalMobi());
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe('测试书');
    expect(parsed?.author).toBe('测试作者');
    expect(parsed?.encrypted).toBe(false);
    expect(parsed?.html).toContain('Hello');
  });

  it('无效字节返回 null', () => {
    expect(parseMobi(new Uint8Array(10))).toBeNull();
    expect(parseMobi(new Uint8Array(200))).toBeNull();
  });
});
