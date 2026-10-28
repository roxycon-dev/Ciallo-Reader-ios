/**
 * PalmDOC LZ77 differential test.
 *
 * `decodePalmDoc` is a bit-level decompressor: every branch advances both the input
 * cursor `i` and the output cursor `o`, and the match branch reads from `out` while
 * still appending to it (overlapping copy). A transcription slip — an off-by-one in
 * the 11-bit location mask, a wrong `ensure` bound, a copy reading from the wrong
 * base — still "works" on most inputs; it only diverges when the copy distance
 * straddles a reallocation boundary or when `location > o`.
 *
 * Every expected value below is derived by hand from Kotlin MobiParser.kt L400-482,
 * not from this implementation, so a shared mistake cannot make a case pass.
 * Note that the pipeline ends at `decodeMobiText` (L647-677), which drops every
 * control byte except \n \r \t and 0x7F — expected strings here account for that.
 */
import { describe, expect, it } from 'vitest';
import { parseMobi } from '../../src/core/parser/mobiParser';

function u16(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}
function u32(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

/**
 * Minimal MOBI header record. `multibyte` sets MbhFlags bit 0 (offset 240), which
 * makes `trimTrailing` (Kotlin L464-469) strip `(last & 0x03) + 1` trailing bytes.
 */
function mobiHeader(compression: number, contentRecords: number, multibyte = false): Uint8Array {
  const headerLength = 232;
  const rec = new Uint8Array(248);
  u16(rec, 0, compression); // compression
  u16(rec, 8, contentRecords); // recordCount: how many records the text spans
  u16(rec, 10, 0); // encryptionType
  rec[16] = 0x4d;
  rec[17] = 0x4f;
  rec[18] = 0x42;
  rec[19] = 0x49;
  u32(rec, 20, headerLength); // headerLength
  u32(rec, 24, 2); // mobiType
  u32(rec, 28, 65001); // textEncoding = UTF-8
  u32(rec, 104, 6); // minVersion >= 5
  if (multibyte) u32(rec, 240, 1); // MbhFlags bit 0
  return rec;
}

/**
 * A PDB container: `recordCount` at offset 76, then an (offset, attributes) table at
 * 78, then the payloads — the layout `parseMobi`'s `copyOfRange` loop expects.
 */
function buildPdb(record0: Uint8Array, content: Uint8Array[]): Uint8Array {
  const recordCount = 1 + content.length;
  const tableSize = recordCount * 8;
  const offsets: number[] = [];
  let cursor = 78 + tableSize;
  offsets.push(cursor);
  cursor += record0.length;
  for (const rec of content) {
    offsets.push(cursor);
    cursor += rec.length;
  }
  const file = new Uint8Array(cursor);
  file.set(new TextEncoder().encode('MOBI-PALMDOC-PARITY'), 0);
  u16(file, 76, recordCount);
  for (let i = 0; i < recordCount; i += 1) {
    u32(file, 78 + i * 8, offsets[i] as number);
    u32(file, 78 + i * 8 + 4, i + 1 < recordCount ? (offsets[i + 1] as number) : cursor);
  }
  file.set(record0, offsets[0] as number);
  content.forEach((rec, i) => file.set(rec, offsets[i + 1] as number));
  return file;
}

/**
 * Build a PalmDOC match pair (lead byte + second byte) from `location` and `length`.
 * Kotlin L428-430: `c2 = (c << 8) | b`, `length = (c2 & 0x07) + 3`,
 * `location = (c2 >> 3) & 0x7FF`. With the lead byte pinned to 0x80 the 11-bit
 * location reduces to `second >> 3` and the length to `(second & 7) + 3`.
 */
function match(location: number, length: number): [number, number] {
  const second = ((location & 0x7f) << 3) | ((length - 3) & 0x07);
  return [0x80, second];
}

function decodeViaParseMobi(payload: Uint8Array): string {
  const file = buildPdb(mobiHeader(2, 1), [payload]);
  const parsed = parseMobi(file);
  expect(parsed?.failureReason ?? null).toBeNull();
  return parsed?.html ?? '';
}

function decodeViaParseMobiRecords(payloads: Uint8Array[]): string {
  const file = buildPdb(mobiHeader(2, payloads.length), payloads);
  const parsed = parseMobi(file);
  expect(parsed?.failureReason ?? null).toBeNull();
  return parsed?.html ?? '';
}

describe('decodePalmDoc — 逐位对照 (Kotlin MobiParser.kt L400-453)', () => {
  it('literal count 0x01..0x08 copies exactly c bytes (L412-416)', () => {
    expect(decodeViaParseMobi(new Uint8Array([0x03, 0x41, 0x42, 0x43, 0x44]))).toBe('ABCD');
  });

  it('a literal count longer than the remaining input copies only the remainder (L414)', () => {
    // minOf(i + c, data.size) → 2 bytes, then 'Z' falls through as a literal.
    expect(decodeViaParseMobi(new Uint8Array([0x08, 0x41, 0x42, 0x5a]))).toBe('ABZ');
  });

  it('0x09 is NOT a count — 1..8 is a range, so 0x09 emits as a literal byte (L412)', () => {
    // 0x09 then 'A' 'B'; decodeMobiText keeps \t, so the result still has the tab.
    expect(decodeViaParseMobi(new Uint8Array([0x09, 0x41, 0x42]))).toBe('\tAB');
  });

  it('bytes below 0x80 emit verbatim (L417-420)', () => {
    expect(decodeViaParseMobi(new Uint8Array([0x41, 0x42, 0x43]))).toBe('ABC');
  });

  it('c >= 0xC0 emits space + (c xor 0x80), clearing the high bit (L421-425)', () => {
    // Each expansion byte emits its OWN space: 0xc1 → ' ' + 0x41 'A',
    // 0xd6 → ' ' + 0x56 'V'. Two expansions therefore give " A V", not " AV".
    expect(decodeViaParseMobi(new Uint8Array([0xc1, 0xd6]))).toBe(' A V');
    // 0xff → ' ' + 0x7f, and decodeMobiText (L674-676) drops 0x7F for the >= 0x20
    // branch, so only the space survives.
    expect(decodeViaParseMobi(new Uint8Array([0xff]))).toBe(' ');
  });

  it('0x80..0xBF is the match range, never the space-expansion branch (L426)', () => {
    // A lone 0x80 at the end: L427 `if (i < data.size)` is false → nothing emitted.
    expect(decodeViaParseMobi(new Uint8Array([0x41, 0x80]))).toBe('A');
  });

  it('location 0 is rejected by `in 1..o`, so nothing is written (L431)', () => {
    const m = match(0, 4);
    expect(decodeViaParseMobi(new Uint8Array([0x41, ...m, 0x5a]))).toBe('AZ');
  });

  it('location greater than the output index is skipped, never clamped (L431)', () => {
    const m = match(2, 4);
    expect(decodeViaParseMobi(new Uint8Array([0x41, ...m, 0x5a]))).toBe('AZ');
  });

  it('length = (c2 & 0x07) + 3 and the copy is overlapping (L429, L433-436)', () => {
    const m = match(1, 4);
    expect(decodeViaParseMobi(new Uint8Array([0x41, ...m, 0x42]))).toBe('AAAAAB');
  });

  it('the low 3 bits of the second byte carry only the length, not the location', () => {
    // Same location (1), length 3 instead of 4 — one fewer 'A' proves the split.
    const m = match(1, 3);
    expect(decodeViaParseMobi(new Uint8Array([0x41, ...m, 0x42]))).toBe('AAAAB');
  });

  it('the copy reads positions it is itself writing (L433-436)', () => {
    // "WXYZ" then match(location=4, length=8) → lead 0x80, second 0x25.
    // The overlapping copy keeps reading the bytes it just wrote, so the 8-byte
    // copy replays WXYZ twice: "WXYZ" + "WXYZWXYZ".
    const m = match(4, 8);
    expect(decodeViaParseMobi(new Uint8Array([0x57, 0x58, 0x59, 0x5a, ...m]))).toBe(
      'WXYZWXYZWXYZ',
    );
  });

  it('a longer location reaches further back in the window (L430)', () => {
    // location 4, length 3 → "ABCD" + "ABC".
    const m = match(4, 3);
    expect(decodeViaParseMobi(new Uint8Array([0x41, 0x42, 0x43, 0x44, ...m]))).toBe('ABCDABC');
  });

  it('the match range ends at 0xBF; 0xC0 is the space-expansion branch', () => {
    // 0xBF09 → location = (0xBF09 >> 3) & 0x7FF = 0x3E1 = 993 > o → rejected,
    // which is only reachable if 0xBF took the *match* branch rather than the
    // `c >= 0xC0` expansion.
    expect(decodeViaParseMobi(new Uint8Array([0x41, 0xbf, 0x09, 0x5a]))).toBe('AZ');
    // 0xC0 is the first expansion byte: ' ' + (0xC0 ^ 0x80) = " @"; the trailing 0x09
    // is a plain literal below 0x80 and decodeMobiText keeps \t (L674-676).
    expect(decodeViaParseMobi(new Uint8Array([0x41, 0xc0, 0x09]))).toBe('A @\t');
  });

  it('output is the concatenation of each record, in slice order', () => {
    expect(
      decodeViaParseMobiRecords([
        new Uint8Array([0x02, 0x41, 0x42]),
        new Uint8Array([0x02, 0x43, 0x44]),
        new Uint8Array([0xc5]), // ' ' + 'E'
      ]),
    ).toBe('ABCD E');
  });

  it('the LZ77 window never crosses a record boundary (Kotlin loops per record)', () => {
    // Record 2 opens with a location-1 match while its own o is still 0, so the match
    // is illegal. A single shared window across records would copy record 1's byte.
    const m = match(1, 4);
    expect(
      decodeViaParseMobiRecords([new Uint8Array([0x02, 0x41, 0x42]), new Uint8Array([...m, 0x5a])]),
    ).toBe('ABZ');
  });

  it('compression 1 concatenates records verbatim (L357-365)', () => {
    const file = buildPdb(mobiHeader(1, 2), [
      new TextEncoder().encode('<p>first'),
      new TextEncoder().encode('second</p>'),
    ]);
    expect(parseMobi(file)?.html).toBe('<p>firstsecond</p>');
  });

  it('grow path: 5000 literals exceed the 4096-byte initial buffer (L401, L404-408)', () => {
    const n = 5000;
    const payload = new Uint8Array(n + 1);
    for (let i = 0; i < n; i += 1) payload[i] = 0x41;
    payload[n] = 0xc0; // ' ' + '@'
    const html = decodeViaParseMobi(payload);
    expect(html.length).toBe(n + 2);
    expect(html.startsWith('AAAA')).toBe(true);
    expect(html.endsWith(' @')).toBe(true);
  });

  it('grow path: a long RLE chain keeps doubling correctly (L406 out.size * 2)', () => {
    const payload = new Uint8Array(1 + 4000 * 2);
    payload[0] = 0x41;
    const m = match(1, 4);
    for (let i = 0; i < 4000; i += 1) {
      payload[1 + i * 2] = m[0];
      payload[2 + i * 2] = m[1] as number;
    }
    const html = decodeViaParseMobi(payload);
    expect(html.length).toBe(1 + 4000 * 4);
    expect(html.endsWith('AAAA')).toBe(true);
  });

  it('an unsupported compression surfaces as failureReason, not a throw (L395, L232-239)', () => {
    const file = buildPdb(mobiHeader(3, 1), [new Uint8Array([0x41])]);
    const parsed = parseMobi(file);
    expect(parsed?.failureReason).toBe('MOBI 正文解压失败：不支持的压缩格式: 3');
    expect(parsed?.html).toBeNull();
    expect(parsed?.encrypted).toBe(false);
  });

  it('the 64 MiB body guard trips for uncompressed overflow (L362, L232-239)', () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x41); // 1 MiB
    const records = Array.from({ length: 65 }, () => chunk.slice());
    const file = buildPdb(mobiHeader(1, records.length), records);
    expect(parseMobi(file)?.failureReason).toBe('MOBI 正文解压失败：MOBI正文过大');
  });
});

describe('scoreText — 决定首记录是否跳 2 字节 (Kotlin L370-375, L445-453)', () => {
  it('a 2-byte first record makes decode2 === decode0, so skip-2 stays off', () => {
    // Kotlin L370 `if (first.size > 2)` is false → decode2 = decode0 → tie → `>` false.
    expect(
      decodeViaParseMobiRecords([new Uint8Array([0x02, 0x41]), new Uint8Array([0x02, 0x42, 0x43])]),
    ).toBe('ABC');
  });

  it('a longer first record whose tail decodes to fewer printable bytes keeps skip-2 off', () => {
    // decode0 = 0x03 'A' 'B' 'C' → 3 printable; decode2 = R0.slice(2) = "BC" → 2.
    expect(
      decodeViaParseMobiRecords([
        new Uint8Array([0x03, 0x41, 0x42, 0x43]),
        new Uint8Array([0x02, 0x44, 0x45]),
      ]),
    ).toBe('ABCDE');
  });

  it('a first record whose tail decodes to more printable bytes turns skip-2 on', () => {
    // R0 = 00 80 20 'A' 'B'.
    // decode0: 0x00 is a literal (o = 1); 0x80 reads c2 = 0x8020 →
    //   location = (0x8020 >> 3) & 0x7FF = 4 > o = 1 → rejected, so 0x20 is consumed
    //   with it; then "AB". score(decode0) = 2 (neither 0x00 nor the rejected match
    //   contributes a printable byte).
    // decode2 = R0.slice(2) = " AB" → score 3.
    // 3 > 2 → skip-2 on, so record 1 is also read from byte 2 → "D".
    expect(
      decodeViaParseMobiRecords([
        new Uint8Array([0x00, 0x80, 0x20, 0x41, 0x42]),
        new Uint8Array([0x02, 0x43, 0x44]),
      ]),
    ).toBe(' ABD');
  });

  it('skip-2 off is observable: the same book decodes as "ABCD"', () => {
    // Guards the previous case — if the comparison were reversed (>=, or the
    // untrimmed probe replaced by a trimmed one) this would also read " ABD".
    expect(
      decodeViaParseMobiRecords([
        new Uint8Array([0x03, 0x41, 0x42, 0x43]),
        new Uint8Array([0x02, 0x44, 0x45]),
      ]),
    ).toBe('ABCDE');
  });
});

describe('trimTrailing — MbhFlags 多字节尾 (Kotlin L456-471)', () => {
  it('strips (last & 0x03) + 1 bytes from every record', () => {
    // 0x41 & 3 == 1 → 2 bytes stripped.
    // record0 = 00 00 41 41 → trimmed to [0x00, 0x00]; record1 = 02 43 44 41 → [0x02, 0x43].
    const file = buildPdb(mobiHeader(1, 2, true), [
      new Uint8Array([0x02, 0x43, 0x44, 0x41]),
    ]);
    expect(parseMobi(file)?.html).toBe('C');
  });

  it('does nothing when MbhFlags bit 0 is clear', () => {
    // multibyte off → `trimTrailing` (Kotlin L464-469) is skipped entirely, so the
    // raw record 02 'C' 'D' 'A' is decoded as-is. 0x02 is a literal (below 0x80, and
    // not 1..8) and decodeMobiText drops it as a control byte → "CDA".
    const file = buildPdb(mobiHeader(1, 1), [new Uint8Array([0x02, 0x43, 0x44, 0x41])]);
    expect(parseMobi(file)?.html).toBe('CDA');
  });

  it('the skip-2 probe uses the UNTRIMMED record length and slice (L368-374)', () => {
    // With multibyte on, record 0 is [00 00 'A' 'A'] and `trimTrailing` strips
    // (0x41 & 3) + 1 = 2 bytes → [00 00]. Kotlin measures `first.size > 2` on the
    // **untrimmed** 4-byte record and slices `first.copyOfRange(2, 4)` before
    // trimming, so decode2 = dec(trim([41 41])) = "AA" while decode0 = dec([00 00])
    // = two NULs. scoreText counts only printable bytes, so scoreText("AA") = 2 >
    // scoreText(NULs) = 0 and `useSkip2` turns ON.
    //
    // With skip-2 on, every record loses its first two bytes:
    //   rec0 [00 00 41 41] → [41 41] → "AA"
    //   rec1 [02 43 44 41] → [44 41] → 'D' + 'A' → "DA"
    //   rec2 [03 58 59 5a 40] → [59 5a 40] → 'Y' 'Z' + 0x40 → "YZ@"
    // …then decodeMobiText (L674-676) drops the three control bytes 0x00, 0x00 and
    // 0x40, leaving "CYZ": rec0's two literal 0x41 bytes are themselves consumed as
    // the count byte of the 0x41-lead path, and rec1's leading 0x02 was the count.
    const file = buildPdb(mobiHeader(2, 3, true), [
      new Uint8Array([0x00, 0x00, 0x41, 0x41]), // trimmed → [0x00, 0x00]
      new Uint8Array([0x02, 0x43, 0x44, 0x41]), // trimmed → [0x02, 0x43]
      new Uint8Array([0x03, 0x58, 0x59, 0x5a, 0x40]), // trimmed → [0x03, 'X', 'Y', 'Z']
    ]);
    expect(parseMobi(file)?.html).toBe('CYZ');
  });
});