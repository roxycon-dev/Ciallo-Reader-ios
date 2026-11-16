import type { FileSystemApi } from '@platform/interfaces';
import type { ComicChapter } from '@core/source/comicChapter';
import { validateNovelParts, type NovelPart } from '@core/source/impl/novelParts';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const rootOf = (target: string) => target.replace(/\.[^./\\]+$/, '') + '.chapters';
const safeName = /^(?:identity|chapter\d+\.json|[0-9a-f]{64}\.(?:image|json))$/;
const imageTypes: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
export async function digestHex(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function clearGuestNovelCheckpoint(fs: FileSystemApi, target: string): Promise<void> {
  const root = rootOf(target);
  for (const name of await fs.list(root)) if (safeName.test(name)) await fs.delete(root + '/' + name);
}

interface CheckpointImage { bytes: Uint8Array; mime: string; extension: string; sha256: string }

export class GuestNovelCheckpoint {
  private readonly root: string;
  constructor(private readonly fs: FileSystemApi, target: string) { this.root = rootOf(target); }
  private path(name: string): string { return this.root + '/' + name; }
  private async read(name: string, maximum = 16 * 1024 * 1024): Promise<Uint8Array | null> {
    try {
      const path = this.path(name);
      if (this.fs.size && await this.fs.size(path) > maximum) return null;
      const bytes = await this.fs.readFile(path);
      return bytes.length <= maximum ? bytes : null;
    } catch { return null; }
  }
  private async write(name: string, data: Uint8Array): Promise<void> {
    const path = this.path(name);
    if (this.fs.writeFileAtomic) await this.fs.writeFileAtomic(path, data);
    else await this.fs.writeFile(path, data);
  }
  async initialize(target: string, sourceId: string, url: string, toc: readonly ComicChapter[]): Promise<number> {
    const identity = JSON.stringify({ version: 1, sourceId, url, toc: toc.map((chapter) => [chapter.id, chapter.title]) });
    const current = await this.read('identity');
    if (!current || decoder.decode(current) !== identity) {
      await clearGuestNovelCheckpoint(this.fs, target);
      await this.write('identity', encoder.encode(identity));
      return 0;
    }
    return Math.min(toc.length, (await this.fs.list(this.root)).filter((name) => /^chapter\d+\.json$/.test(name)).length);
  }
  async chapter(index: number): Promise<NovelPart[] | null> {
    try {
      const data = await this.read('chapter' + index + '.json');
      if (!data) return null;
      const record = JSON.parse(decoder.decode(data)) as { payload?: unknown; sha256?: unknown };
      if (typeof record.payload !== 'string' || record.sha256 !== await digestHex(encoder.encode(record.payload))) return null;
      const rows: unknown = JSON.parse(record.payload);
      if (!Array.isArray(rows)) return null;
      const parts = rows.map((row): NovelPart => {
        if (!row || typeof row.value !== 'string') throw new Error('断点格式无效');
        if (row.type === 'text') return { kind: 'text', value: row.value };
        if (row.type === 'image') return { kind: 'image', url: row.value };
        throw new Error('断点格式无效');
      });
      validateNovelParts(parts); return parts;
    } catch { return null; }
  }
  async saveChapter(index: number, parts: NovelPart[]): Promise<void> {
    const payload = JSON.stringify(parts.map((part) => ({ type: part.kind, value: part.kind === 'text' ? part.value : part.url })));
    const data = encoder.encode(JSON.stringify({ payload, sha256: await digestHex(encoder.encode(payload)) }));
    if (data.length <= 16 * 1024 * 1024) await this.write('chapter' + index + '.json', data);
  }
  async image(url: string): Promise<CheckpointImage | null> {
    try {
      const key = await digestHex(encoder.encode(url)), metadata = await this.read(key + '.json', 4096);
      if (!metadata) return null;
      const { mime, extension, sha256 } = JSON.parse(decoder.decode(metadata)) as Partial<CheckpointImage>;
      if (!mime || !extension || !sha256 || imageTypes[mime] !== extension) return null;
      const bytes = await this.read(key + '.image');
      return bytes && await digestHex(bytes) === sha256 ? { bytes, mime, extension, sha256 } : null;
    } catch { return null; }
  }
  async saveImage(url: string, image: CheckpointImage): Promise<void> {
    const key = await digestHex(encoder.encode(url));
    await this.write(key + '.image', image.bytes);
    await this.write(key + '.json', encoder.encode(JSON.stringify({ sha256: image.sha256, mime: image.mime, extension: image.extension })));
  }
}
