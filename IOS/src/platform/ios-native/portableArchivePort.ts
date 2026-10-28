import { registerPlugin } from '@capacitor/core';
import { nonThenablePlugin } from './pluginProxy';
import {
  parsePortableManifest, parsePortableRow, parsePortableRowsHeader, PortableRowsInspector,
  PORTABLE_METADATA_MAX_BYTES, portableObject, TRANSFER_CATEGORIES,
  type PortableArchivePreview, type PortableEnvelope, type PortableEntry, type PortableManifest,
} from '@core/transfer/portableFormat';
import { isTransferHash, isTransferSessionId, requireTransfer, TRANSFER_MAX_BYTES, transferHash } from '@core/transfer/transferWire';
import { portableNovelKey, validatePortableSettings, type PortableSettings } from '@core/transfer/portableSettings';

interface ExtractedNative { stageId: string; settings: string; manifest: string | null; entries: PortableEntry[]; }
export interface PortableArchiveNative {
  prepare(): Promise<{ stageId: string }>;
  write(options: { stageId: string; entry: 'database.rows' | 'settings.json'; text: string; reset: boolean }): Promise<void>;
  pack(options: { stageId: string; sessionId: string; resources: { path: string; sourcePath: string }[]; metadata: Record<string, unknown> }): Promise<{ path: string; manifest: string }>;
  extract(options: { path: string }): Promise<ExtractedNative>;
  rows(options: { stageId: string; cursor: number }): Promise<{ lines: string[]; cursor: number; done: boolean }>;
  discard(options: { stageId: string }): Promise<void>;
  cancel(): Promise<void>;
}
export interface InspectedPortableArchive {
  stageId: string;
  preview: PortableArchivePreview;
  manifest: PortableManifest | null;
  settings: PortableSettings;
}

/** File contents stay native. Only small metadata and bounded row batches cross
 * the bridge; inspection finishes before any library mutation is allowed. */
export class NativePortableArchivePort {
  constructor(private readonly native: PortableArchiveNative = nonThenablePlugin(registerPlugin<PortableArchiveNative>('ReaderTransferArchive'))) {}
  async prepare(): Promise<string> {
    const result = await this.native.prepare(); requireTransfer(isTransferSessionId(result.stageId), '原生暂存身份无效'); return result.stageId;
  }
  async write(stageId: string, entry: 'database.rows' | 'settings.json', text: string, reset: boolean): Promise<void> {
    requireTransfer(isTransferSessionId(stageId), '归档暂存身份无效');
    if (!text.length) { await this.native.write({ stageId, entry, text, reset }); return; }
    let offset = 0;
    while (offset < text.length) {
      let end = Math.min(text.length, offset + 256 * 1024);
      const code = text.charCodeAt(end - 1);
      if (end < text.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
      await this.native.write({ stageId, entry, text: text.slice(offset, end), reset: reset && offset === 0 }); offset = end;
    }
  }
  async pack(stageId: string, sessionId: string, resources: { path: string; sourcePath: string }[], metadata: Record<string, unknown>): Promise<{ path: string; manifest: PortableManifest }> {
    requireTransfer(isTransferSessionId(stageId) && isTransferSessionId(sessionId), '归档身份无效');
    const result = await this.native.pack({ stageId, sessionId, resources, metadata });
    requireTransfer(result.path === `transfer/${sessionId}.outgoing`, '原生导出路径错误');
    return { path: result.path, manifest: parsePortableManifest(result.manifest) };
  }
  async *rows(stageId: string): AsyncGenerator<PortableEnvelope> {
    requireTransfer(isTransferSessionId(stageId), '归档暂存身份无效');
    let cursor = 0, header = false, count = 0;
    while (true) {
      const batch = await this.native.rows({ stageId, cursor });
      requireTransfer(Array.isArray(batch.lines) && batch.lines.length <= 128 && batch.lines.every((line) => typeof line === 'string') && Number.isSafeInteger(batch.cursor) && batch.cursor >= cursor && batch.cursor <= 512 * 1024 * 1024 && typeof batch.done === 'boolean', '原生数据行分批结果无效');
      requireTransfer(batch.done || batch.cursor > cursor, '原生归档读取没有前进');
      for (const line of batch.lines) {
        requireTransfer(line.length <= 512 * 1024, '数据行过大');
        if (!header) { parsePortableRowsHeader(line); header = true; }
        else { requireTransfer(++count <= 1_000_000, '数据条目过多'); yield parsePortableRow(line); }
      }
      cursor = batch.cursor;
      if (batch.done) break;
    }
    requireTransfer(header, '缺少数据头');
  }
  async inspect(path: string, archiveHash: string): Promise<InspectedPortableArchive> {
    requireTransfer(isTransferHash(archiveHash), '归档完整性摘要无效');
    const extracted = await this.native.extract({ path });
    requireTransfer(isTransferSessionId(extracted.stageId), '归档暂存身份无效');
    try {
      requireTransfer(typeof extracted.settings === 'string' && new TextEncoder().encode(extracted.settings).length <= PORTABLE_METADATA_MAX_BYTES, '设置文件过大');
      const manifest = extracted.manifest === null ? null : parsePortableManifest(extracted.manifest);
      requireTransfer(Array.isArray(extracted.entries) && extracted.entries.length > 0 && extracted.entries.length <= 50000, '归档文件清单无效');
      const actual = new Map<string, PortableEntry>();
      let expandedBytes = 0;
      for (const entry of extracted.entries) {
        requireTransfer(entry !== null && typeof entry === 'object' && typeof entry.path === 'string' && !actual.has(entry.path) && Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= 512 * 1024 * 1024 && isTransferHash(entry.sha256), '原生文件校验结果无效');
        actual.set(entry.path, entry); if (entry.path !== 'manifest.json') expandedBytes += entry.size;
      }
      requireTransfer(expandedBytes <= TRANSFER_MAX_BYTES && actual.has('database.rows') && actual.has('settings.json'), '归档数据文件缺失或过大');
      requireTransfer(actual.get('settings.json')!.sha256 === transferHash(new TextEncoder().encode(extracted.settings)), '设置文件读取时发生变化');
      if (manifest) {
        requireTransfer(actual.has('manifest.json') && manifest.entries.length === actual.size - 1 && manifest.expandedBytes === expandedBytes, '数据包清单不完整');
        for (const entry of manifest.entries) {
          const file = actual.get(entry.path); requireTransfer(file && file.size === entry.size && file.sha256 === entry.sha256, `数据包校验失败：${entry.path}`);
        }
      }
      const rawSettings = portableObject(JSON.parse(extracted.settings));
      const protectedFavorites = manifest?.protectedFavorites ?? (portableObject(rawSettings.favorites_protected ?? {}).value === true);
      const settings = validatePortableSettings(manifest ? rawSettings : { novel_reader_prefs: Object.fromEntries(Object.entries(rawSettings).filter(([key]) => portableNovelKey(key))) });
      const inspector = new PortableRowsInspector();
      for await (const row of this.rows(extracted.stageId)) inspector.add(row);
      inspector.finish(manifest ?? undefined);
      // Legacy package identity is the hash of the input archive, supplied by
      // the receiver's already-verified file metadata before import.
      return { stageId: extracted.stageId, manifest, settings, preview: {
        packageId: manifest?.packageId ?? archiveHash, version: manifest ? 2 : 1, counts: inspector.counts, expandedBytes,
        categories: manifest?.categories ?? [...TRANSFER_CATEGORIES], warnings: manifest?.warnings ?? ['旧版 ZIP：缺少完整性清单，将按兼容方式导入'],
        containsProtected: (manifest?.containsProtected ?? false) || protectedFavorites || inspector.containsProtected, protectedFavorites,
      } };
    } catch (error) { await this.discard(extracted.stageId).catch(() => {}); throw error; }
  }
  async discard(stageId: string): Promise<void> { requireTransfer(isTransferSessionId(stageId), '归档暂存身份无效'); await this.native.discard({ stageId }); }
  async cancel(): Promise<void> { await this.native.cancel(); }
}
