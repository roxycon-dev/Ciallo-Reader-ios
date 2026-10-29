import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { portableEntryPath, type PortableEntry, type PortableRow } from './portableFormat';
import { requireTransfer } from './transferWire';

/** Incoming paths can resolve only to files in the inspected archive. A sender
 * cannot point an imported book at an existing receiver document or key store. */
export class ArchiveResources {
  private readonly files = new Map<string, PortableEntry>();
  private readonly directories = new Set<string>();
  constructor(entries: ReadonlyMap<string, PortableEntry>, private readonly filesRoot: string) {
    portableEntryPath(`files/${filesRoot}`);
    for (const [path, entry] of entries) {
      if (!path.startsWith('files/')) continue;
      portableEntryPath(path); requireTransfer(entry.path === path, '资源清单键不一致');
      const relative = path.slice(6); this.files.set(relative, entry);
      let parent = relative.lastIndexOf('/');
      while (parent > 0) { this.directories.add(relative.slice(0, parent)); parent = relative.lastIndexOf('/', parent - 1); }
    }
  }
  private relative(path: string): string | null {
    const value = path.startsWith('file://') ? path.slice(7) : path;
    const relative = value.startsWith('@FILES@/') ? value.slice(8) : value;
    try { portableEntryPath(`files/${relative}`); return relative; } catch { return null; }
  }
  hash(path: string): string | null { const relative = this.relative(path); return relative === null ? null : this.files.get(relative)?.sha256 ?? null; }
  originalIdentity(path: string): string | null {
    const relative = this.relative(path); if (relative === null) return null;
    const file = this.files.get(relative); return file ? `file:${file.sha256}` : null;
  }
  directoryIdentity(path: string, book: PortableRow): string | null {
    const relative = this.relative(path); if (relative === null) return null;
    if (!this.directories.has(relative)) return null;
    const hash = sha256.create(), encoder = new TextEncoder(), prefix = `${relative}/`;
    const files = [...this.files.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [key, entry] of files) hash.update(encoder.encode(`${key.slice(prefix.length)}${entry.sha256}`));
    hash.update(encoder.encode(book.contentType as string));
    if (book.totalChapters === 0) hash.update(encoder.encode(`${book.title}\0${book.author}\0${String(book.filePath).replace(/^file:\/\//, '')}`));
    return `body:${bytesToHex(hash.digest())}`;
  }
  relocate(path: string, allowRemote = true): string {
    if (allowRemote && /^https?:\/\//.test(path)) return path;
    const relative = this.relative(path);
    return relative !== null && (this.files.has(relative) || this.directories.has(relative)) ? `${this.filesRoot}/${relative}` : '';
  }
  body(content: string, contentType: string): string {
    if (contentType === 'COMIC' && content.trim() && !content.includes('[IMG:')) return this.relocate(content.trim());
    return content.replace(/\[IMG:([^\]]+)]/g, (_match, path: string) => { const relocated = this.relocate(path); return relocated ? `[IMG:${relocated}]` : ''; });
  }
  row(row: PortableRow): PortableRow {
    const output = { ...row };
    for (const key of ['filePath', 'coverUri', 'localThumbPath', 'coverPath']) if (typeof output[key] === 'string') output[key] = this.relocate(output[key], key !== 'filePath');
    return output;
  }
}
