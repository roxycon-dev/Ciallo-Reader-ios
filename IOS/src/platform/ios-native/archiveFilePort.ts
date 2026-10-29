import { registerPlugin } from '@capacitor/core';
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
  constructor(private readonly native: ArchiveFileNative = nonThenablePlugin(registerPlugin<ArchiveFileNative>('ReaderDocuments'))) {}
  async pick(): Promise<PickedTransferArchive | null> { const { file } = await this.native.pickTransfer(); return file === null ? null : parsePickedTransferArchive(file); }
  async share(path: string, name: string): Promise<void> {
    const sessionId = path.replace(/^transfer\//, '').replace(/\.outgoing$/, '');
    requireTransfer(isTransferSessionId(sessionId) && path === `transfer/${sessionId}.outgoing` && name.endsWith('.ciallo') && new TextEncoder().encode(name).length <= 255 && !/[\0/\\]/.test(name), '迁移包分享参数无效');
    await this.native.shareTransfer({ path, name });
  }
  async cancel(): Promise<void> { await this.native.cancelTransfer(); }
}
