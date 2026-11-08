import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const TRANSFER_CHUNK_BYTES = 1024 * 1024;
export const TRANSFER_MAX_BYTES = 4 * 1024 * 1024 * 1024;
export const TRANSFER_RETENTION_MS = 24 * 60 * 60 * 1000;
export const TRANSFER_SERVICE = '_ciallo-xfer._tcp';
const MAX_CONTROL_BYTES = 64 * 1024;
export type TransferControl = Record<string, unknown>;

/** A mutually authenticated TLS stream. read must provide backpressure and never
 * return more than maxBytes; null means EOF. Implementations own their buffers. */
export interface TransferStream {
  readonly localFingerprint: string;
  readonly peerFingerprint: string;
  readonly closed?: AbortSignal;
  read(maxBytes: number): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
  close(): void;
}

export class TransferProtocolError extends Error {
  constructor(message: string) { super(message); this.name = 'TransferProtocolError'; }
}

export function requireTransfer(value: unknown, message: string): asserts value {
  if (!value) throw new TransferProtocolError(message);
}
export const transferHash = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));
export const isTransferHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isTransferNonce = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{48}$/.test(value);
export const isTransferSessionId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const isTransferOffset = (value: unknown, total: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= total && (value % TRANSFER_CHUNK_BYTES === 0 || value === total);

/** Byte-for-byte equivalent to TransferTls.code (unsigned, big endian prefix). */
export function transferPairingCode(localCertificateHash: string, peerCertificateHash: string, localNonce: string, peerNonce: string): string {
  requireTransfer(isTransferHash(localCertificateHash) && isTransferHash(peerCertificateHash) && isTransferNonce(localNonce) && isTransferNonce(peerNonce), '无效的设备配对身份');
  const transcript = [...[localCertificateHash, peerCertificateHash].sort(), ...[localNonce, peerNonce].sort()].join('|');
  const digest = sha256(new TextEncoder().encode(transcript));
  const prefix = new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(0, false);
  return String(prefix % 1_000_000).padStart(6, '0');
}

export function encodeTransferControl(value: TransferControl): Uint8Array {
  requireTransfer(value !== null && typeof value === 'object' && !Array.isArray(value), '无效传输消息');
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  requireTransfer(bytes.length >= 2 && bytes.length <= MAX_CONTROL_BYTES, '控制消息过大');
  const frame = new Uint8Array(bytes.length + 4);
  new DataView(frame.buffer).setInt32(0, bytes.length, false);
  frame.set(bytes, 4);
  return frame;
}

/** Exactly one reader and one writer per connection. Deadlines close the native
 * connection as well, so a timed-out receive cannot consume a later frame. */
export class TransferWire {
  private closed = false;
  private reading = false;
  private writing = false;
  private timeoutMs = 30_000;
  private readonly pending = new Set<(reason: Error) => void>();
  private readonly abort: () => void;
  constructor(readonly stream: TransferStream, private readonly signal?: AbortSignal) {
    requireTransfer(isTransferHash(stream.localFingerprint) && isTransferHash(stream.peerFingerprint), 'TLS 设备证书缺失');
    this.abort = () => this.close();
    signal?.addEventListener('abort', this.abort, { once: true });
    stream.closed?.addEventListener('abort', this.abort, { once: true });
    if (signal?.aborted || stream.closed?.aborted) this.close();
  }
  setTimeout(milliseconds: number): void {
    requireTransfer(Number.isFinite(milliseconds) && milliseconds > 0, '无效传输超时');
    this.timeoutMs = milliseconds;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.signal?.removeEventListener('abort', this.abort);
    this.stream.closed?.removeEventListener('abort', this.abort);
    for (const reject of this.pending) reject(new TransferProtocolError('传输已取消'));
    this.stream.close();
  }
  async withDeadline<T>(operation: () => Promise<T>): Promise<T> {
    requireTransfer(!this.closed && !this.signal?.aborted, '传输已取消');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAborted: ((reason: Error) => void) | undefined;
    try {
      const expired = new Promise<never>((_, reject) => {
        rejectAborted = reject;
        this.pending.add(reject);
        timer = setTimeout(() => { reject(new TransferProtocolError('传输连接超时')); this.close(); }, this.timeoutMs);
      });
      return await Promise.race([operation(), expired]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (rejectAborted) this.pending.delete(rejectAborted);
    }
  }
  async readBytes(length: number): Promise<Uint8Array> {
    requireTransfer(!this.reading && Number.isSafeInteger(length) && length > 0 && length <= TRANSFER_CHUNK_BYTES, '无效或重叠的读取');
    this.reading = true;
    try {
      return await this.withDeadline(async () => {
        const bytes = new Uint8Array(length);
        let offset = 0;
        while (offset < length) {
          const maximum = Math.min(64 * 1024, length - offset);
          const part = await this.stream.read(maximum);
          requireTransfer(!this.closed, '传输已取消');
          requireTransfer(part !== null && part.length > 0 && part.length <= maximum, '传输流已中断或读取越界');
          bytes.set(part, offset); offset += part.length;
        }
        return bytes;
      });
    } finally { this.reading = false; }
  }
  async writeBytes(bytes: Uint8Array): Promise<void> {
    requireTransfer(!this.writing && bytes.length > 0 && bytes.length <= TRANSFER_CHUNK_BYTES, '无效或重叠的写入');
    this.writing = true;
    try { await this.withDeadline(() => this.stream.write(bytes)); }
    finally { this.writing = false; }
  }
  async send(value: TransferControl): Promise<void> { await this.writeBytes(encodeTransferControl(value)); }
  async read(): Promise<TransferControl> {
    const prefix = await this.readBytes(4);
    const size = new DataView(prefix.buffer, prefix.byteOffset, 4).getInt32(0, false);
    requireTransfer(size >= 2 && size <= MAX_CONTROL_BYTES, '无效传输消息长度');
    const bytes = await this.readBytes(size);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new TransferProtocolError('传输消息不是有效 UTF-8 JSON'); }
    requireTransfer(value !== null && typeof value === 'object' && !Array.isArray(value), '传输消息必须是对象');
    const control = value as TransferControl;
    if (control.type === 'error') throw new TransferProtocolError(typeof control.message === 'string' ? control.message.slice(0, 512) : '对方终止了传输');
    return control;
  }
}

export function verifyTransferChunk(header: TransferControl, offset: number, total: number, bytes: Uint8Array): void {
  requireTransfer(header.type === 'chunk' && header.offset === offset && isTransferOffset(offset, total), '分块次序不正确');
  requireTransfer(bytes.length > 0 && bytes.length === header.length && bytes.length === Math.min(TRANSFER_CHUNK_BYTES, total - offset), '分块长度不正确');
  requireTransfer(isTransferHash(header.sha256) && transferHash(bytes) === header.sha256, '传输分块校验失败');
}
