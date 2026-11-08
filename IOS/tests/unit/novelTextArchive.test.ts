import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  crc32,
  prepareNovelTextArchive,
  readZipCentralDirectory,
} from '../../src/core/download/novelTextArchive';
import type { FileSystemApi } from '../../src/platform/interfaces';

function memFs(): FileSystemApi & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async readFile(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async writeFile(p, d) {
      files.set(p, d);
    },
    async exists(p) {
      return files.has(p);
    },
    async delete(p) {
      files.delete(p);
    },
    async list() {
      return [...files.keys()];
    },
  };
}

const TXT = '/downloads/book_abc123.tmp';

function packZip(name: string, text: string, pad = 0): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files[name] = strToU8(text);
  if (pad > 0) files['__pad.bin'] = new Uint8Array(pad).fill(9);
  return zipSync(files, { level: 0 });
}

describe('novelTextArchive', () => {
  it('crc32 matches the reference implementation', () => {
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('reads the central directory with uncompressed sizes', () => {
    const zip = packZip('book.txt', 'hello');
    const central = readZipCentralDirectory(zip);
    expect(central).not.toBeNull();
    expect(central?.map((e) => e.name)).toEqual(['book.txt']);
    expect(central?.[0]?.size).toBe(5);
    expect(central?.[0]?.isDirectory).toBe(false);
    expect(crc32(strToU8('hello'))).toBe(central?.[0]?.crc);
  });

  it('returns null when the payload is not a ZIP', async () => {
    const fs = memFs();
    fs.files.set(TXT, strToU8('plain text, no zip magic here'));
    expect(await prepareNovelTextArchive(TXT, { fs })).toBeNull();
  });

  it('extracts a UTF-8 TXT verbatim and leaves no temp files', async () => {
    const fs = memFs();
    const text = '第一章 开端\n正文一。\n\n第二章 收束\n正文二。\n';
    fs.files.set(TXT, packZip('novel.txt', text));
    const out = await prepareNovelTextArchive(TXT, { fs });
    expect(out).not.toBeNull();
    expect(new TextDecoder().decode(fs.files.get(out as string))).toBe(text);
    // Kotlin: raw/ordered/utf8 intermediates are deleted in the finally block.
    expect([...fs.files.keys()].filter((k) => k !== TXT && k !== out)).toEqual([]);
  });

  it('sorts out-of-order numbered chapters and inserts the missing newline', async () => {
    const fs = memFs();
    // Kotlin comment: "Some site packages put the last two numbered chapters in
    // reverse order." Chapter 2 is last and has no trailing newline.
    const text = '第1章 一\nAAA\n第3章 三\nCCC\n第2章 二\nBBB';
    fs.files.set(TXT, packZip('b.txt', text));
    const out = (await prepareNovelTextArchive(TXT, { fs })) as string;
    expect(new TextDecoder().decode(fs.files.get(out))).toBe(
      '第1章 一\nAAA\n第2章 二\nBBB\r\n第3章 三\nCCC\n',
    );
  });

  it('leaves an in-order book untouched', async () => {
    const fs = memFs();
    const text = '第一章 一\nAAA\n第二章 二\nBBB\n';
    fs.files.set(TXT, packZip('b.txt', text));
    const out = (await prepareNovelTextArchive(TXT, { fs })) as string;
    expect(new TextDecoder().decode(fs.files.get(out))).toBe(text);
  });

  it('rejects an archive that does not hold exactly one TXT', async () => {
    const fs = memFs();
    fs.files.set(TXT, zipSync({ 'a.txt': strToU8('x'), 'b.txt': strToU8('y') }, { level: 0 }));
    await expect(prepareNovelTextArchive(TXT, { fs })).rejects.toThrow('本源的压缩包未包含唯一的 TXT 小说');
  });

  it('rejects an archive with more than eight entries', async () => {
    const fs = memFs();
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 9; i += 1) files[`p${i}.txt`] = strToU8('x');
    fs.files.set(TXT, zipSync(files, { level: 0 }));
    await expect(prepareNovelTextArchive(TXT, { fs })).rejects.toThrow('小说压缩包条目异常');
  });

  it('rejects a zip-slip entry name', async () => {
    const fs = memFs();
    const zip = zipSync(
      { '../evil.txt': strToU8('x'), 'dir/': new Uint8Array(0) },
      { level: 0 },
    );
    fs.files.set(TXT, zip);
    await expect(prepareNovelTextArchive(TXT, { fs })).rejects.toThrow('压缩包包含越界路径');
  });

  it('rejects a CRC mismatch between the entry and its bytes', async () => {
    const fs = memFs();
    const zip = packZip('b.txt', '正文内容');
    const central = readZipCentralDirectory(zip);
    expect(central?.[0]?.size).toBeGreaterThan(0);
    fs.files.set(TXT, patchCentralCrc(zip, 0, (central?.[0]?.crc ?? 0) ^ 0xffff));
    await expect(prepareNovelTextArchive(TXT, { fs })).rejects.toThrow('小说压缩包不完整，请重新下载');
  });

  it('rejects a truncated archive', async () => {
    const fs = memFs();
    const zip = packZip('b.txt', '第一章 一\n正文\n');
    fs.files.set(TXT, zip.subarray(0, zip.length - 12));
    await expect(prepareNovelTextArchive(TXT, { fs })).rejects.toThrow('小说压缩包无法解析');
  });

  it('reports the free-space requirement like Android', async () => {
    const fs = memFs();
    fs.files.set(TXT, packZip('b.txt', '第一章 一\n正文\n'));
    await expect(
      prepareNovelTextArchive(TXT, { fs, getUsableSpace: () => 16 * 1024 * 1024 }),
    ).rejects.toThrow('存储空间不足，请清理后重试');
  });

  it('honours the abort signal before writing the output', async () => {
    const fs = memFs();
    fs.files.set(TXT, packZip('b.txt', '第一章 一\n正文\n'));
    const controller = new AbortController();
    controller.abort();
    await expect(prepareNovelTextArchive(TXT, { fs, signal: controller.signal })).rejects.toThrow(
      'download cancelled',
    );
  });
});

/** Overwrite the 4-byte CRC field of the n-th central-directory record. */
function patchCentralCrc(data: Uint8Array, index: number, crc: number): Uint8Array {
  const out = data.slice();
  let eocd = -1;
  for (let i = out.length - 22; i >= 0; i -= 1) {
    if (
      ((out[i] as number) | ((out[i + 1] as number) << 8) | ((out[i + 2] as number) << 16) | ((out[i + 3] as number) << 24)) >>>
      0 ===
      0x06054b50
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no eocd');
  const readU16 = (o: number): number => ((out[o] as number) | ((out[o + 1] as number) << 8)) >>> 0;
  const readU32 = (o: number): number =>
    (((out[o] as number) |
      ((out[o + 1] as number) << 8) |
      ((out[o + 2] as number) << 16) |
      ((out[o + 3] as number) << 24)) >>>
      0);
  let cursor = readU32(eocd + 16);
  for (let i = 0; i < index; i += 1) {
    const nameLen = readU16(cursor + 28);
    const extraLen = readU16(cursor + 30);
    const commentLen = readU16(cursor + 32);
    cursor = cursor + 46 + nameLen + extraLen + commentLen;
  }
  out[cursor + 16] = crc & 0xff;
  out[cursor + 17] = (crc >>> 8) & 0xff;
  out[cursor + 18] = (crc >>> 16) & 0xff;
  out[cursor + 19] = (crc >>> 24) & 0xff;
  return out;
}