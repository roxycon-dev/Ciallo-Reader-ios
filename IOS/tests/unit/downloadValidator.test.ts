import { describe, expect, it } from 'vitest';
import {
  validateFileIntegrity,
  detectRealFormat,
  isProbablyText,
  readZipCentralDirectory,
} from '../../src/core/data/downloadFileValidator';

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * A ZIP payload carrying only the central directory + EOCD, which is all the
 * validator reads (Kotlin reaches the same names through `ZipFile`). The local
 * file headers are deliberately absent — `ZipFile` needs them, the port does not,
 * and the accept/reject boundary being pinned here is the central directory's.
 */
function zipOf(names: string[]): Uint8Array {
  const records: Uint8Array[] = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = utf8(name);
    const record = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true); // central directory header signature
    view.setUint16(28, nameBytes.length, true); // file name length
    view.setUint32(16, 0, true); // crc
    view.setUint32(20, 0, true); // compressed size
    view.setUint32(24, 0, true); // uncompressed size
    view.setUint32(42, offset, true); // relative offset of local header
    record.set(nameBytes, 46);
    records.push(record);
    offset += record.length;
  }
  const directorySize = offset;
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
  eocdView.setUint16(8, names.length, true); // entries on this disk
  eocdView.setUint16(10, names.length, true); // total entries
  eocdView.setUint32(12, directorySize, true);
  eocdView.setUint32(16, 0, true); // offset of the central directory
  const out = new Uint8Array(directorySize + 22);
  let cursor = 0;
  for (const record of records) {
    out.set(record, cursor);
    cursor += record.length;
  }
  out.set(eocd, cursor);
  return out;
}

describe('downloadFileValidator', () => {
  it('flags HTML error pages as invalid', () => {
    const html = utf8('<!DOCTYPE html><html><head><title>err</title></head><body>Checking your browser - diamwall</body></html>');
    const result = validateFileIntegrity(html, 'epub');
    expect(result.valid).toBe(false);
    expect(result.isHtmlErrorPage).toBe(true);
  });

  it('accepts literal HTML inside a txt download', () => {
    const html = utf8('<html>本书介绍 HTML 标记写法</html>');
    const result = validateFileIntegrity(html, 'txt');
    expect(result.valid).toBe(true);
  });

  it('rejects known challenge pages even when declared txt', () => {
    const html = utf8('<html>Checking your browser - diamwall</html>');
    const result = validateFileIntegrity(html, 'txt');
    expect(result.valid).toBe(false);
    expect(result.isHtmlErrorPage).toBe(true);
  });

  it('treats empty payload as invalid', () => {
    const result = validateFileIntegrity(new Uint8Array(0), 'txt');
    expect(result.valid).toBe(false);
    expect(result.actualFormat).toBeNull();
  });

  it('detects plain text via heuristic', () => {
    const txt = utf8('这是正文内容，hello world 123');
    expect(isProbablyText(txt)).toBe(true);
    expect(detectRealFormat(txt)).toBe('txt');
    const ok = validateFileIntegrity(txt, 'txt');
    expect(ok.valid).toBe(true);
    expect(ok.actualFormat).toBe('txt');
  });

  it('detects PDF magic in the first 1KB window', () => {
    const padded = new Uint8Array(200);
    padded.set(utf8('%PDF-1.7\n'), 10);
    expect(detectRealFormat(padded)).toBe('pdf');
  });

  it('detects MOBI via BOOKMOBI at offset 60', () => {
    const mobi = new Uint8Array(80);
    mobi.set(utf8('BOOKMOBI'), 60);
    expect(detectRealFormat(mobi)).toBe('mobi');
  });

  it('detects FB2 only from the XML root, never from the bare word', () => {
    const fb2 = new Uint8Array(4096);
    fb2.set(utf8('<?xml version="1.0"?><FictionBook><body/></FictionBook>'), 0);
    expect(detectRealFormat(fb2)).toBe('fb2');
    // `<?xml` alone is not enough — both markers are required (Kotlin L163).
    const onlyXml = new Uint8Array(4096);
    onlyXml.set(utf8('<?xml version="1.0"?><html><body>not a book</body></html>'), 0);
    expect(detectRealFormat(onlyXml)).not.toBe('fb2');
  });

  it('orders the magic chain: PDF wins over FB2 which wins over ZIP', () => {
    // A payload that starts with the PDF marker is a PDF even if the later
    // format checks would also match — Kotlin returns on the first hit (L148-166).
    const pdf = new Uint8Array(1024);
    pdf.set(utf8('%PDF-1.7\n<?xml <FictionBook>'), 0);
    expect(detectRealFormat(pdf)).toBe('pdf');
    // The 1KB window is inclusive: `%PDF-` at offset 1019 is the last hit.
    const edge = new Uint8Array(1024);
    edge.set(utf8('%PDF-'), 1019);
    expect(detectRealFormat(edge)).toBe('pdf');
    // …and offset 1020 is outside the window, so it falls through to text.
    const past = new Uint8Array(1028);
    past.set(utf8('%PDF-'), 1020);
    expect(detectRealFormat(past)).not.toBe('pdf');
  });

  it('reads a ZIP central directory and classifies docx / epub / cbz', () => {
    const docx = zipOf(['word/document.xml', 'word/_rels/.rels']);
    expect(detectRealFormat(docx, docx)).toBe('docx');
    const container = zipOf(['META-INF/container.xml', 'OEBPS/x.xhtml']);
    expect(detectRealFormat(container, container)).toBe('epub');
    const mimetype = zipOf(['mimetype']);
    expect(detectRealFormat(mimetype, mimetype)).toBe('epub');
    // `.opf` anywhere (case-insensitive) or any `META-INF/` file counts as epub.
    const opf = zipOf(['OEBPS/content.opf']);
    expect(detectRealFormat(opf, opf)).toBe('epub');
    const metaInf = zipOf(['META-INF/anything']);
    expect(detectRealFormat(metaInf, metaInf)).toBe('epub');
    // Only image-bearing archives are cbz; a text-only zip has no format.
    const cbz = zipOf(['001.jpg', '002.png']);
    expect(detectRealFormat(cbz, cbz)).toBe('cbz');
    const textZip = zipOf(['notes.txt']);
    expect(detectRealFormat(textZip, textZip)).toBeNull();
    // A directory entry never counts as an image (Kotlin `!entry.isDirectory`).
    const dirOnly = zipOf(['pages/', 'pages/01.jpg/']);
    expect(detectRealFormat(dirOnly, dirOnly)).toBeNull();
  });

  it('treats an unreadable archive as "no format", like ZipFile throwing', () => {
    // PK magic but no EOCD record at all.
    const broken = new Uint8Array(64);
    broken.set([0x50, 0x4b, 0x03, 0x04], 0);
    expect(readZipCentralDirectory(broken)).toBeNull();
    expect(detectRealFormat(broken, broken)).toBeNull();
    // An EOCD whose entry count / directory offset cannot be read is equally
    // unusable — Kotlin's ZipFile would throw before yielding a single entry.
    const truncated = zipOf(['a.txt']).subarray(0, zipOf(['a.txt']).length - 6);
    expect(readZipCentralDirectory(truncated)).toBeNull();
    // A central directory that starts outside the payload is unreadable too.
    expect(readZipCentralDirectory(new Uint8Array(22))).toBeNull();
  });

  it('lets the ZIP magic win over any HTML in the same 4 KB window', () => {
    // Kotlin L37-40 checks `isZip` before sniffing for HTML, because a legal EPUB
    // can hold an uncompressed `nav.xhtml` inside its first 4 KB. The result is
    // *not* an HTML error page — it falls through to the format chain, and here
    // the (deliberately broken) archive plus the non-text bytes make it invalid.
    const both = new Uint8Array(utf8('<html><body>x</body></html>'));
    both.set([0x50, 0x4b, 0x03, 0x04], 0);
    expect(validateFileIntegrity(both, 'epub')).toEqual({
      valid: false,
      actualFormat: null,
      isHtmlErrorPage: false,
      htmlErrorHint: null,
    });
  });

  it('exempts only the exact "txt" declaration from the HTML rule (Kotlin L45)', () => {
    const html = utf8('<html><body>hi</body></html>');
    for (const format of ['epub', 'mobi', 'pdf', 'cbz', 'TXT', 'txt', 'Txt']) {
      expect(validateFileIntegrity(html, format).isHtmlErrorPage, format).toBe(
        format.toLowerCase() !== 'txt',
      );
    }
    // `declared` is trimmed (L51) but the txt exemption compares the raw string,
    // so `"TXT "` is NOT exempt even though its trimmed form is.
    expect(validateFileIntegrity(html, 'TXT ').isHtmlErrorPage).toBe(true);
  });

  it('accepts a structurally valid epub and passes a text payload off as txt', () => {
    const epub = zipOf(['mimetype', 'META-INF/container.xml', 'OEBPS/1.xhtml']);
    expect(validateFileIntegrity(epub, 'epub')).toEqual({
      valid: true,
      actualFormat: 'epub',
      isHtmlErrorPage: false,
      htmlErrorHint: null,
    });
    // Declared epub but the payload is plain text (zlib's old pages): fall back
    // to txt instead of failing, exactly as Kotlin L78-83 does.
    const text = utf8('第一章 这是正文，不是压缩包。'.repeat(8));
    const fallback = validateFileIntegrity(text, 'epub');
    expect(fallback.valid).toBe(true);
    expect(fallback.actualFormat).toBe('txt');
  });

  it('returns the detected format verbatim when a non-epub declaration mismatches', () => {
    const mobi = new Uint8Array(80);
    mobi.set(utf8('BOOKMOBI'), 60);
    expect(validateFileIntegrity(mobi, 'epub')).toEqual({
      valid: true,
      actualFormat: 'mobi',
      isHtmlErrorPage: false,
      htmlErrorHint: null,
    });
  });
});
