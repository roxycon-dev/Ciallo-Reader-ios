import { ArchiveResources } from '@core/transfer/archiveResources';
import type { PortableRow } from '@core/transfer/portableFormat';
import { requireTransfer, TRANSFER_MAX_BYTES } from '@core/transfer/transferWire';
import { NativePortableArchivePort, type PortableResourceDescriptor } from './portableArchivePort';

/** Native hashes never load book/image bytes into WKWebView. This catalog is
 * scoped to one gated export/import, so cached hashes cannot outlive mutations. */
export class NativeLocalArchiveResources {
  private readonly pending = new Map<string, Promise<PortableResourceDescriptor>>();
  private readonly outgoing = new Map<string, { path: string; sourcePath: string; size: number; sha256: string }>();
  private total = 0;
  readonly warnings: string[] = [];
  constructor(private readonly port: Pick<NativePortableArchivePort, 'resource'> = new NativePortableArchivePort()) {}
  private describe(path: string): Promise<PortableResourceDescriptor> {
    if (!path) return Promise.resolve({ kind: 'missing', files: [] });
    let result = this.pending.get(path); if (!result) { result = this.port.resource(path); this.pending.set(path, result); } return result;
  }
  async hash(path: string): Promise<string | null> { const result = await this.describe(path); return result.kind === 'file' ? result.files[0]!.sha256 : null; }
  async original(book: PortableRow): Promise<string | null> { const hash = await this.hash(book.filePath as string); return hash === null ? null : `file:${hash}`; }
  async directoryIdentity(book: PortableRow): Promise<string | null> {
    const result = await this.describe(book.filePath as string); if (result.kind !== 'directory') return null;
    const entries = result.files.map((file) => ({ ...file, path: `files/${file.path}` }));
    return new ArchiveResources(new Map(entries.map((file) => [file.path, file])), 'unused').directoryIdentity(result.path!, book);
  }
  async exportPath(path: string): Promise<string> {
    if (!path || /^https?:\/\//.test(path)) return path;
    const descriptor = await this.describe(path);
    if (descriptor.kind === 'missing') { if (this.warnings.length < 50000) this.warnings.push(`本地资源不可用，已跳过：${path.slice(0, 1024)}`); return ''; }
    for (const file of descriptor.files) {
      const previous = this.outgoing.get(file.path);
      if (previous) { requireTransfer(previous.size === file.size && previous.sha256 === file.sha256, '导出期间资源内容发生变化'); continue; }
      this.total += file.size; requireTransfer(this.total <= TRANSFER_MAX_BYTES && this.outgoing.size < 49997, '导出资源超过大小或文件数量限制');
      this.outgoing.set(file.path, { path: `files/${file.path}`, sourcePath: file.path, size: file.size, sha256: file.sha256 });
    }
    return descriptor.files.length ? `@FILES@/${descriptor.path}` : '';
  }
  async exportBody(content: string, contentType: string): Promise<string> {
    if (contentType === 'COMIC' && content.trim() && !content.includes('[IMG:')) return this.exportPath(content.trim());
    const parts: string[] = []; let position = 0;
    for (const match of content.matchAll(/\[IMG:([^\]]+)]/g)) {
      parts.push(content.slice(position, match.index)); const path = await this.exportPath(match[1]!);
      if (path) parts.push(`[IMG:${path}]`); position = match.index + match[0].length;
    }
    parts.push(content.slice(position)); return parts.join('');
  }
  async exportRow(row: PortableRow): Promise<PortableRow> {
    const result = { ...row };
    for (const key of ['filePath', 'coverUri', 'localThumbPath', 'coverPath']) if (typeof result[key] === 'string') result[key] = await this.exportPath(result[key]);
    return result;
  }
  resources(): { path: string; sourcePath: string }[] { return [...this.outgoing.values()].map(({ path, sourcePath }) => ({ path, sourcePath })); }
}
