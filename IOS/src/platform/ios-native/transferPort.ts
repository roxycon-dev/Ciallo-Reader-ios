import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { nonThenablePlugin } from './pluginProxy';
import { base64ToBytes, bytesToBase64 } from './capacitorHttpClient';
import {
  isTransferHash, isTransferSessionId, requireTransfer, TRANSFER_CHUNK_BYTES,
  type TransferStream,
} from '@core/transfer/transferWire';
import type { TransferCheckpoint, TransferFile, TransferPeer } from '@core/transfer/transferSession';

interface ConnectionMetadata { connectionId: string; localFingerprint: string; peerFingerprint: string; }
interface FileResult { size?: number; exists?: boolean; availableBytes?: number; sha256?: string; data?: string; }
export interface ReaderTransferNative {
  start(options: TransferPeer): Promise<{ port: number; fingerprint: string }>;
  stop(): Promise<void>;
  connect(options: { peerId: string }): Promise<ConnectionMetadata>;
  read(options: { connectionId: string; maxBytes: number }): Promise<{ data?: string; eof: boolean }>;
  write(options: { connectionId: string; data: string }): Promise<void>;
  close(options: { connectionId: string }): Promise<void>;
  file(options: { action: 'stat' | 'hash' | 'read' | 'truncate' | 'append' | 'delete'; path: string; offset?: number; length?: number; data?: string }): Promise<FileResult>;
  checkpoint(options: { direction: 'incoming' | 'outgoing'; value?: string; remove?: boolean }): Promise<{ value?: string | null }>;
  addListener(event: string, handler: (event: Record<string, unknown>) => void): Promise<PluginListenerHandle>;
}
export interface NativeTransferEvents {
  peers(peers: TransferPeer[]): void;
  connection(stream: TransferStream): void;
  error(message: string): void;
}

/** Listener registration precedes advertisement, so an incoming TLS connection
 * cannot disappear between native accept and the JavaScript subscriber. */
export class NativeTransferPort {
  private listeners: PluginListenerHandle[] = [];
  private readonly streams = new Map<string, { stream: TransferStream; abort: AbortController }>();
  private running = false;
  private generation = 0;
  constructor(private readonly native: ReaderTransferNative = nonThenablePlugin(registerPlugin<ReaderTransferNative>('ReaderTransfer'))) {}

  async start(local: TransferPeer, events: NativeTransferEvents): Promise<void> {
    requireTransfer(!this.running && this.listeners.length === 0, '互传已开启');
    this.running = true;
    const generation = ++this.generation;
    const registered: PluginListenerHandle[] = [];
    const listen = async (event: string, handler: (event: Record<string, unknown>) => void): Promise<void> => {
      const listener = await this.native.addListener(event, (value) => { if (this.generation === generation && this.running) handler(value); });
      if (this.generation !== generation || !this.running) { await listener.remove(); throw new Error('互传已关闭'); }
      registered.push(listener); this.listeners.push(listener);
    };
    try {
      await listen('peers', (event) => {
        if (!this.running || !Array.isArray(event.peers)) return;
        const peers: TransferPeer[] = [];
        for (const peer of event.peers.slice(0, 128)) {
          if (peer && typeof peer === 'object' && typeof peer.id === 'string' && peer.id.length <= 128 && typeof peer.name === 'string') peers.push({ id: peer.id, name: peer.name.slice(0, 64) });
        }
        events.peers(peers);
      });
      await listen('connection', (event) => {
        if (!this.running) return;
        try { events.connection(this.stream(event as unknown as ConnectionMetadata)); }
        catch (error) { events.error(error instanceof Error ? error.message : '连接信息无效'); }
      });
      await listen('closed', (event) => {
        if (typeof event.connectionId !== 'string') return;
        const item = this.streams.get(event.connectionId); this.streams.delete(event.connectionId); item?.abort.abort();
      });
      await listen('transferError', (event) => {
        if (this.running) events.error(typeof event.message === 'string' ? event.message.slice(0, 512) : '本地网络连接失败');
      });
      requireTransfer(this.generation === generation && this.running, '互传已关闭');
      await this.native.start(local);
      requireTransfer(this.generation === generation && this.running, '互传已关闭');
    } catch (error) {
      if (this.generation === generation) await this.stop();
      else await Promise.allSettled(registered.map((listener) => listener.remove()));
      throw error;
    }
  }
  async stop(): Promise<void> {
    this.running = false;
    this.generation += 1;
    for (const item of this.streams.values()) item.abort.abort(); this.streams.clear();
    try { await this.native.stop(); }
    finally { const listeners = this.listeners.splice(0); await Promise.allSettled(listeners.map((listener) => listener.remove())); }
  }
  async connect(peerId: string): Promise<TransferStream> {
    requireTransfer(this.running && peerId.length > 0 && peerId.length <= 128, '请先开启互传并选择设备');
    const metadata = await this.native.connect({ peerId });
    if (!this.running) { await this.native.close({ connectionId: metadata.connectionId }); throw new Error('互传已关闭'); }
    return this.stream(metadata);
  }
  private stream(metadata: ConnectionMetadata): TransferStream {
    requireTransfer(typeof metadata.connectionId === 'string' && metadata.connectionId.length > 0 && metadata.connectionId.length <= 128 && isTransferHash(metadata.localFingerprint) && isTransferHash(metadata.peerFingerprint), 'TLS 设备身份无效');
    const existing = this.streams.get(metadata.connectionId); if (existing) return existing.stream;
    const abort = new AbortController(), connectionId = metadata.connectionId;
    const stream: TransferStream = {
      localFingerprint: metadata.localFingerprint, peerFingerprint: metadata.peerFingerprint, closed: abort.signal,
      read: async (maxBytes) => {
        requireTransfer(!abort.signal.aborted && Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= 65536, '无效读取范围');
        const result = await this.native.read({ connectionId, maxBytes });
        requireTransfer(!abort.signal.aborted, '连接已关闭');
        if (result.eof) return null;
        requireTransfer(typeof result.data === 'string' && result.data.length <= Math.ceil(maxBytes / 3) * 4, '原生读取超出分块范围');
        const bytes = base64ToBytes(result.data);
        requireTransfer(bytes.length > 0 && bytes.length <= maxBytes, '原生读取长度无效'); return bytes;
      },
      write: async (bytes) => {
        requireTransfer(!abort.signal.aborted && bytes.length > 0 && bytes.length <= TRANSFER_CHUNK_BYTES, '无效写入范围');
        await this.native.write({ connectionId, data: bytesToBase64(bytes) });
      },
      close: () => {
        if (abort.signal.aborted) return;
        this.streams.delete(connectionId); abort.abort(); void this.native.close({ connectionId }).catch(() => {});
      },
    };
    this.streams.set(connectionId, { stream, abort }); return stream;
  }

  file(sessionId: string, incoming: boolean): TransferFile & { path: string; availableSpace(): Promise<number> } {
    requireTransfer(isTransferSessionId(sessionId), '无效归档身份');
    const path = `transfer/${sessionId}.${incoming ? 'incoming' : 'outgoing'}`;
    return {
      path,
      size: async () => { const value = (await this.native.file({ action: 'stat', path })).size; requireTransfer(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, '文件大小无效'); return value; },
      hash: async () => { const value = (await this.native.file({ action: 'hash', path })).sha256; requireTransfer(isTransferHash(value), '原生文件摘要无效'); return value; },
      readAt: async (offset, length) => {
        requireTransfer(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length > 0 && length <= TRANSFER_CHUNK_BYTES, '文件读取范围无效');
        const value = (await this.native.file({ action: 'read', path, offset, length })).data;
        requireTransfer(typeof value === 'string' && value.length <= Math.ceil(length / 3) * 4, '文件分块过大');
        const bytes = base64ToBytes(value); requireTransfer(bytes.length <= length, '文件分块越界'); return bytes;
      },
      truncate: async (length) => { await this.native.file({ action: 'truncate', path, length }); },
      appendDurable: async (bytes) => { requireTransfer(bytes.length > 0 && bytes.length <= TRANSFER_CHUNK_BYTES, '文件分块过大'); await this.native.file({ action: 'append', path, data: bytesToBase64(bytes) }); },
      remove: async () => { await this.native.file({ action: 'delete', path }); },
      availableSpace: async () => { const value = (await this.native.file({ action: 'stat', path })).availableBytes; requireTransfer(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, '可用空间无效'); return value; },
    };
  }
  async loadCheckpoint(incoming: boolean): Promise<TransferCheckpoint | null> {
    const result = await this.native.checkpoint({ direction: incoming ? 'incoming' : 'outgoing' });
    if (result.value === null || result.value === undefined) return null;
    requireTransfer(typeof result.value === 'string' && result.value.length <= 65536, '续传记录过大');
    const checkpoint: unknown = JSON.parse(result.value);
    requireTransfer(checkpoint !== null && typeof checkpoint === 'object' && !Array.isArray(checkpoint), '续传记录损坏');
    return checkpoint as TransferCheckpoint;
  }
  async saveCheckpoint(checkpoint: TransferCheckpoint, incoming: boolean): Promise<void> {
    await this.native.checkpoint({ direction: incoming ? 'incoming' : 'outgoing', value: JSON.stringify(checkpoint) });
  }
  async removeCheckpoint(incoming: boolean): Promise<void> {
    await this.native.checkpoint({ direction: incoming ? 'incoming' : 'outgoing', remove: true });
  }
}
