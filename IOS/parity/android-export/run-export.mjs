#!/usr/bin/env node
/**
 * Node fallback fixture exporter — mirrors parity/android-export Kotlin Exporter.
 *
 * Same three fixtures, same algorithms (PBKDF2 via node:crypto, chapter merger
 * and natural order as direct ports of the Android Kotlin sources).
 *
 * Usage: node parity/android-export/run-export.mjs
 * Output: IOS/parity/fixtures/*.generated.json
 */

import { createHash, pbkdf2Sync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../fixtures');
mkdirSync(fixturesDir, { recursive: true });

// ---------------------------------------------------------------------------
// Pin KDF — PrivacyManager.kt port
// ---------------------------------------------------------------------------

const PIN_KDF_ITERATIONS = 120_000;
const PIN_KDF_BITS = 256;
const PIN_SALT_BYTES = 16;

function hexToBytes(hex) {
  const out = Buffer.alloc(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** SHA-256(saltBytes + pinBytes) hex — Android legacy path (`hashPin`). */
function hashPinLegacy(pin, saltHex) {
  const digest = createHash('sha256');
  digest.update(hexToBytes(saltHex));
  digest.update(Buffer.from(pin, 'utf8'));
  return digest.digest('hex');
}

/** PBKDF2WithHmacSHA1, 120_000 iterations, 256 bits — Android modern path (`derivePin`). */
function derivePin(pin, saltHex) {
  const salt = hexToBytes(saltHex);
  return pbkdf2Sync(pin, salt, PIN_KDF_ITERATIONS, PIN_KDF_BITS / 8, 'sha1').toString('hex');
}

function newSaltHex() {
  const bytes = Buffer.alloc(PIN_SALT_BYTES);
  // eslint-disable-next-line no-undef
  crypto.getRandomValues(bytes);
  return bytes.toString('hex');
}

// ---------------------------------------------------------------------------
// Chapter merger — ChapterMerger.kt port
// ---------------------------------------------------------------------------

const CONTINUATION_TITLE = /^(.+?)\s*\((?:续|续[0-9]+)\)\s*$/;

function cleanSplitTitle(title) {
  const m = title.trim().match(CONTINUATION_TITLE);
  return m ? m[1] : title;
}

/**
 * @param {Array<{bookId:number,chapterOrder:number,title:string,content:string,startCharIndex?:number,endCharIndex?:number}>} physical
 */
function buildLogicalChapters(physical) {
  const byOrder = new Map();
  let maxOrder = -1;
  for (const ch of physical) {
    byOrder.set(ch.chapterOrder, ch);
    if (ch.chapterOrder > maxOrder) maxOrder = ch.chapterOrder;
  }

  const physToLog = Array.from({ length: maxOrder + 1 }, (_, i) => i);
  const physOffset = Array.from({ length: maxOrder + 1 }, () => 0);
  const logToPhys = [];
  const logical = [];

  let parts = [];
  let baseTitle = null;
  let buffer = '';

  function flush() {
    if (parts.length === 0) return;
    const first = byOrder.get(parts[0]);
    const last = byOrder.get(parts[parts.length - 1]);
    logical.push({
      bookId: first.bookId,
      chapterOrder: logical.length,
      title: baseTitle ?? first.title,
      content: buffer,
      startCharIndex: first.startCharIndex ?? 0,
      endCharIndex: last.endCharIndex ?? 0,
    });
    logToPhys.push([...parts]);
    parts = [];
    buffer = '';
    baseTitle = null;
  }

  for (const ch of physical) {
    const order = ch.chapterOrder;
    const m = ch.title.trim().match(CONTINUATION_TITLE);
    const isContinuation =
      m != null && baseTitle === m[1] && parts.length > 0 && parts.length < 4;
    if (isContinuation) {
      physOffset[order] = buffer.length;
      buffer += ch.content;
      parts.push(order);
      physToLog[order] = logical.length;
    } else {
      flush();
      baseTitle = cleanSplitTitle(ch.title.trim());
      buffer += ch.content;
      parts.push(order);
      physOffset[order] = 0;
      physToLog[order] = logical.length;
    }
  }
  flush();

  return {
    chapters: logical,
    physicalToLogical: physToLog,
    physicalToLogicalOffset: physOffset,
    logicalToPhysicalOrders: logToPhys,
  };
}

// ---------------------------------------------------------------------------
// Natural order — ComicParser.kt naturalOrderCompare port
// ---------------------------------------------------------------------------

function lowerCode(code) {
  if (code >= 0x41 && code <= 0x5a) return code + 0x20;
  return code;
}

function naturalOrderCompare(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ac = a.charCodeAt(i);
    const bc = b.charCodeAt(j);
    const aDigit = ac >= 0x30 && ac <= 0x39;
    const bDigit = bc >= 0x30 && bc <= 0x39;
    if (aDigit && bDigit) {
      const aStart = i;
      const bStart = j;
      while (i < a.length) {
        const c = a.charCodeAt(i);
        if (c < 0x30 || c > 0x39) break;
        i += 1;
      }
      while (j < b.length) {
        const c = b.charCodeAt(j);
        if (c < 0x30 || c > 0x39) break;
        j += 1;
      }
      let ai = aStart;
      let bj = bStart;
      while (ai < i && a.charCodeAt(ai) === 0x30) ai += 1;
      while (bj < j && b.charCodeAt(bj) === 0x30) bj += 1;
      const lengthOrder = Math.sign(i - ai - (j - bj));
      if (lengthOrder !== 0) return lengthOrder;
      while (ai < i) {
        const digitOrder = Math.sign(a.charCodeAt(ai) - b.charCodeAt(bj));
        ai += 1;
        bj += 1;
        if (digitOrder !== 0) return digitOrder;
      }
    } else {
      const order = Math.sign(lowerCode(ac) - lowerCode(bc));
      i += 1;
      j += 1;
      if (order !== 0) return order;
    }
  }
  const remain = Math.sign(a.length - i - (b.length - j));
  if (remain !== 0) return remain;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

function writeJson(fileName, value) {
  const out = path.join(fixturesDir, fileName);
  writeFileSync(out, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log(`  ${fileName}`);
}

function writePinKdfFixtures() {
  const pinCases = [
    { pin: '123456', saltHex: '11111111111111111111111111111111' },
    { pin: '000000', saltHex: '22222222222222222222222222222222' },
    { pin: '999999', saltHex: '00112233445566778899aabbccddeeff' },
    { pin: '654321', saltHex: 'abababababababababababababababab' },
  ];
  const cases = pinCases.map(({ pin, saltHex }) => ({
    pin,
    saltHex,
    legacySha256: hashPinLegacy(pin, saltHex),
    pbkdf2: derivePin(pin, saltHex),
  }));
  writeJson('pinKdf.generated.json', { cases });
}

function writeChapterMergerFixtures() {
  const chapterCases = [
    {
      name: 'single-chapter',
      input: [
        { bookId: 1, chapterOrder: 0, title: '第一章', content: 'Hello', startCharIndex: 0, endCharIndex: 5 },
      ],
    },
    {
      name: 'merge-continuation',
      input: [
        { bookId: 1, chapterOrder: 0, title: '第一章', content: 'A', startCharIndex: 0, endCharIndex: 1 },
        { bookId: 1, chapterOrder: 1, title: '第一章 (续)', content: 'B', startCharIndex: 1, endCharIndex: 2 },
      ],
    },
    {
      name: 'max-4-parts-then-new',
      input: [
        { bookId: 1, chapterOrder: 0, title: '第二章', content: 'A', startCharIndex: 0, endCharIndex: 1 },
        { bookId: 1, chapterOrder: 1, title: '第二章 (续)', content: 'B', startCharIndex: 1, endCharIndex: 2 },
        { bookId: 1, chapterOrder: 2, title: '第二章 (续)', content: 'C', startCharIndex: 2, endCharIndex: 3 },
        { bookId: 1, chapterOrder: 3, title: '第二章 (续)', content: 'D', startCharIndex: 3, endCharIndex: 4 },
        { bookId: 1, chapterOrder: 4, title: '第二章 (续)', content: 'E', startCharIndex: 4, endCharIndex: 5 },
      ],
    },
    {
      name: 'title-cleanup-xu2',
      input: [
        { bookId: 2, chapterOrder: 0, title: '第三章', content: 'X', startCharIndex: 0, endCharIndex: 1 },
        { bookId: 2, chapterOrder: 1, title: '第三章 (续2)', content: 'Y', startCharIndex: 1, endCharIndex: 2 },
      ],
    },
    {
      name: 'no-merge-different-titles',
      input: [
        { bookId: 1, chapterOrder: 0, title: '第一章', content: 'A', startCharIndex: 0, endCharIndex: 1 },
        { bookId: 1, chapterOrder: 1, title: '第二章', content: 'B', startCharIndex: 1, endCharIndex: 2 },
      ],
    },
    {
      name: 'continuation-break-by-title-change',
      input: [
        { bookId: 1, chapterOrder: 0, title: '第一章', content: 'A', startCharIndex: 0, endCharIndex: 1 },
        { bookId: 1, chapterOrder: 1, title: '第一章 (续)', content: 'B', startCharIndex: 1, endCharIndex: 2 },
        { bookId: 1, chapterOrder: 2, title: '第二章', content: 'C', startCharIndex: 2, endCharIndex: 3 },
        { bookId: 1, chapterOrder: 3, title: '第二章 (续)', content: 'D', startCharIndex: 3, endCharIndex: 4 },
      ],
    },
  ];

  const cases = chapterCases.map(({ name, input }) => {
    const book = buildLogicalChapters(input);
    return {
      name,
      input,
      logical: book.chapters,
      physicalToLogical: book.physicalToLogical,
      physicalToLogicalOffset: book.physicalToLogicalOffset,
      logicalToPhysicalOrders: book.logicalToPhysicalOrders,
    };
  });

  writeJson('chapterMerger.generated.json', { cases });
}

function writeNaturalOrderFixtures() {
  const rawPairs = [
    ['page1', 'page2'],
    ['page2', 'page10'],
    ['page02', 'page2'],
    ['page', 'page'],
    ['ABC', 'abc'],
    ['a10', 'a9'],
    ['a9', 'a10'],
    ['第1章', '第2章'],
    ['第10章', '第2章'],
    ['', 'a'],
    ['01', '1'],
    ['1', '01'],
    ['page1a', 'page1b'],
    ['chapter_10', 'chapter_9'],
    ['chapter_9', 'chapter_10'],
    ['file2.txt', 'file10.txt'],
    ['100', '99'],
    ['a', 'B'],
    ['book_002', 'book_010'],
    ['IMG_0001.jpg', 'IMG_0010.jpg'],
  ];
  const pairs = rawPairs.map(([a, b]) => ({ a, b, cmp: naturalOrderCompare(a, b) }));
  writeJson('naturalOrder.generated.json', { pairs });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`Fixtures -> ${fixturesDir}`);
writePinKdfFixtures();
writeChapterMergerFixtures();
writeNaturalOrderFixtures();
console.log('Done.');
