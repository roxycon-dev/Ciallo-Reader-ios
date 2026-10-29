import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { nonThenablePlugin } from './pluginProxy';
import { isTransferHash, isTransferSessionId, requireTransfer, TRANSFER_MAX_BYTES } from '@core/transfer/transferWire';

export interface PickedTransferArchive { sessionId: string; path: string; name: string; size: number; sha256: string; }
export interface ArchiveFileNative {
  pickTransfer(): Promise<{ file: unknown }>;
  shareTransfer(options: { path: string; name: string }): Promise<{ completed: boolean }>;
  cancelTransfer(): Promise<void>;
}
export interface ArchiveFilePort {
  pick(): Promise<PickedTransferArchive | null>;
  share(path: string, name: string): Promise<void>;
  cancel(): Promise<void>;
  takeOpened?(): Promise<PickedTransferArchive | null>;
  clearOpened?(): Promise<void>;
}
interface OpenedArchiveNative {
  openedTransfer(options: { take: boolean; discard?: boolean }): Promise<{ file: unknown }>;
  addListener(event: 'transferFileOpened', handler: (event: { error?: string }) => void): Promise<PluginListenerHandle>;
}
export async function listenForOpenedTransfer(onOpened: () => void, onError: (message: string) => void,
  native: OpenedArchiveNative = nonThenablePlugin(registerPlugin<OpenedArchiveNative>('ReaderDocuments'))): Promise<() => void> {
  let disposed = false;
  const listener = await native.addListener('transferFileOpened', (event) => { if (!disposed) { if (typeof event.error === 'string') onError(event.error.slice(0, 1000)); else onOpened(); } });
  try { const pending = await native.openedTransfer({ take: false }); if (pending.file !== null && !disposed) { parsePickedTransferArchive(pending.file); onOpened(); } }
  catch (error) { if (!disposed) onError(error instanceof Error ? error.message : '无法读取待打开的迁移文件'); }
  return () => { disposed = true; void listener.remove(); };
}
export function parsePickedTransferArchive(value: unknown): PickedTransferArchive {
  requireTransfer(value !== null && typeof value === 'object', '迁移文件信息无效');
  const file = value as Record<string, unknown>;
  requireTransfer(isTransferSessionId(file.sessionId) && file.path === `transfer/${file.sessionId}.incoming` && isTransferHash(file.sha256), '迁移文件路径或摘要无效');
  requireTransfer(typeof file.size === 'number' && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= TRANSFER_MAX_BYTES, '迁移文件大小无效');
  requireTransfer(typeof file.name === 'string' && file.name.length > 0 && file.name.length <= 255 && !/[\0/\\]/.test(file.name), '迁移文件名无效');
  return { sessionId: file.sessionId, path: file.path as string, name: file.name, size: file.size, sha256: file.sha256 };
}
export class NativeArchiveFilePort implements ArchiveFilePort {
  constructor(private readonly native: ArchiveFileNative & Partial<OpenedArchiveNative> = nonThenablePlugin(registerPlugin<ArchiveFileNative & OpenedArchiveNative>('ReaderDocuments'))) {}
  async pick(): Promise<PickedTransferArchive | null> { const { file } = await this.native.pickTransfer(); return file === null ? null : parsePickedTransferArchive(file); }
  async share(path: string, name: string): Promise<void> {
    const sessionId = path.replace(/^transfer\//, '').replace(/\.outgoing$/, '');
    requireTransfer(isTransferSessionId(sessionId) && path === `transfer/${sessionId}.outgoing` && name.endsWith('.ciallo') && new TextEncoder().encode(name).length <= 255 && !/[\0/\\]/.test(name), '迁移包分享参数无效');
    await this.native.shareTransfer({ path, name });
  }
  async cancel(): Promise<void> { await this.native.cancelTransfer(); }
  async takeOpened(): Promise<PickedTransferArchive | null> {
    requireTransfer(this.native.openedTransfer, '系统文件入口不可用'); const { file } = await this.native.openedTransfer({ take: true }); return file === null ? null : parsePickedTransferArchive(file);
  }
  async clearOpened(): Promise<void> { requireTransfer(this.native.openedTransfer, '系统文件入口不可用'); await this.native.openedTransfer({ take: false, discard: true }); }
}
