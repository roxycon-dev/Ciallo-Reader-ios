import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  encodeTransferControl, TRANSFER_CHUNK_BYTES, TRANSFER_MAX_BYTES, transferHash,
  transferPairingCode, TransferWire, verifyTransferChunk, type TransferStream,
} from '@core/transfer/transferWire';
import {
  authenticateTransfer, receiveTransferPayload, sendTransferPayload,
  type TransferCheckpoint, type TransferFile, type TransferHandshakeOptions, type OutgoingTransfer,
} from '@core/transfer/transferSession';

const hashA = 'a'.repeat(64), hashB = 'b'.repeat(64);
const nonceA = '1'.repeat(48), nonceB = '2'.repeat(48);
const sessionId = '01234567-89ab-cdef-0123-456789abcdef';
const now = 1_800_000_000_000;
const token = '3'.repeat(64);
const wires: TransferWire[] = [];
afterEach(() => { for (const wire of wires.splice(0)) wire.close(); vi.useRealTimers(); });

class ByteQueue {
  private bytes = new Uint8Array(0);
  private ended = false;
  private wake: (() => void) | undefined;
  push(bytes: Uint8Array) { const joined = new Uint8Array(this.bytes.length + bytes.length); joined.set(this.bytes); joined.set(bytes, this.bytes.length); this.bytes = joined; this.wake?.(); }
  close() { this.ended = true; this.wake?.(); }
  async read(maximum: number, fragment: number): Promise<Uint8Array | null> {
    while (this.bytes.length === 0 && !this.ended) await new Promise<void>((resolve) => { this.wake = resolve; });
    if (!this.bytes.length) return null;
    const size = Math.min(maximum, fragment, this.bytes.length), result = this.bytes.slice(0, size);
    this.bytes = this.bytes.slice(size); return result;
  }
}
function duplex(fragment = 64 * 1024) {
  const a = new ByteQueue(), b = new ByteQueue(), controls: [Record<string, unknown>[], Record<string, unknown>[]] = [[], []];
  const stream = (input: ByteQueue, output: ByteQueue, fingerprint: string, peer: string, index: 0 | 1): TransferStream => ({
    localFingerprint: fingerprint, peerFingerprint: peer,
    read: (max) => input.read(max, fragment),
    write: async (bytes) => {
      if (bytes.length > 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getInt32(0, false) === bytes.length - 4) {
        try { controls[index].push(JSON.parse(new TextDecoder().decode(bytes.subarray(4))) as Record<string, unknown>); }
        catch { /* Malformed frames are still delivered to the real decoder. */ }
      }
      output.push(bytes.slice());
    },
    close: () => { input.close(); output.close(); },
  });
  const first = new TransferWire(stream(a, b, hashA, hashB, 0)), second = new TransferWire(stream(b, a, hashB, hashA, 1));
  wires.push(first, second);
  return { first, second, controls };
}
class MemoryTransferFile implements TransferFile {
  bytes: Uint8Array;
  onAppend: ((bytes: Uint8Array) => void) | undefined;
  constructor(bytes = new Uint8Array(0)) { this.bytes = bytes.slice(); }
  async size() { return this.bytes.length; }
  async hash() { return createHash('sha256').update(this.bytes).digest('hex'); }
  async readAt(offset: number, length: number) { return this.bytes.slice(offset, offset + length); }
  async truncate(length: number) { this.bytes = this.bytes.slice(0, length); }
  async appendDurable(bytes: Uint8Array) { const next = new Uint8Array(this.bytes.length + bytes.length); next.set(this.bytes); next.set(bytes, this.bytes.length); this.bytes = next; this.onAppend?.(bytes); }
  async remove() { this.bytes = new Uint8Array(0); }
}
function outgoing(bytes: Uint8Array): OutgoingTransfer {
  return { sessionId, token, createdAt: now, peerId: 'receiver', size: bytes.length, sha256: transferHash(bytes) };
}
function options(localId: string, outgoing?: OutgoingTransfer): TransferHandshakeOptions {
  return { local: { id: localId, name: localId === 'sender' ? '发送设备' : '接收设备' }, nonce: localId === 'sender' ? nonceA : nonceB,
    ...(outgoing ? { outgoing } : {}), loadIncoming: async () => null, saveCheckpoint: async () => {}, now: () => now,
    confirm: async () => ({ accepted: true, mode: 'MERGE' }),
  };
}
const imported = { added: 2, merged: 1, skipped: 0 };
async function together<T, U>(a: Promise<T>, b: Promise<U>, pair: ReturnType<typeof duplex>): Promise<[PromiseSettledResult<T>, PromiseSettledResult<U>]> {
  return Promise.allSettled([a.catch((e: unknown) => { pair.first.close(); throw e; }), b.catch((e: unknown) => { pair.second.close(); throw e; })]);
}

describe('Android-compatible transfer wire', () => {
  it('uses a big endian byte length, not a UTF-16 character count, with fragmented UTF-8 reads', async () => {
    const value = { type: 'hello', name: '书库📚' }, encoded = encodeTransferControl(value);
    expect([...encoded.subarray(0, 4)]).toEqual([0, 0, 0, Buffer.byteLength(JSON.stringify(value), 'utf8')]);
    const pair = duplex(3); await pair.first.send(value); expect(await pair.second.read()).toEqual(value);
  });
  it.each([-1, 0, 1, 65537, 2147483647])('rejects control length %i before reading an attacker body', async (length) => {
    const pair = duplex(), header = new Uint8Array(4); new DataView(header.buffer).setInt32(0, length, false);
    await pair.first.writeBytes(header); await expect(pair.second.read()).rejects.toThrow('消息长度');
  });
  it.each(['[]', 'null', '"a"', '{bad}', '{"a":"\u0000"}'])('rejects non-object or malformed JSON %s', async (text) => {
    const pair = duplex(), bytes = new TextEncoder().encode(text), frame = new Uint8Array(bytes.length + 4); new DataView(frame.buffer).setInt32(0, bytes.length, false); frame.set(bytes, 4);
    await pair.first.writeBytes(frame); await expect(pair.second.read()).rejects.toThrow();
  });
  it('rejects invalid UTF-8 and oversized outgoing messages', async () => {
    const pair = duplex(); await pair.first.writeBytes(new Uint8Array([0, 0, 0, 3, 123, 255, 125]));
    await expect(pair.second.read()).rejects.toThrow('UTF-8'); expect(() => encodeTransferControl({ text: '书'.repeat(24000) })).toThrow('过大');
  });
  it('binds both certificate fingerprints and both nonces independent of endpoint order', () => {
    const digest = createHash('sha256').update([hashA, hashB, nonceA, nonceB].join('|')).digest();
    const expected = String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
    expect(transferPairingCode(hashA, hashB, nonceA, nonceB)).toBe(expected);
    expect(transferPairingCode(hashB, hashA, nonceB, nonceA)).toBe(expected);
    expect(transferPairingCode(hashA, 'c'.repeat(64), nonceA, nonceB)).not.toBe(expected);
  });
  it('settles a native receive that ignores cancellation when the stream is closed', async () => {
    const pair = duplex(), blocked = pair.first.read(); pair.first.close(); await expect(blocked).rejects.toThrow('取消');
  });
  it('closes timed-out reads so they cannot steal later frames', async () => {
    vi.useFakeTimers(); const pair = duplex(); pair.first.setTimeout(50);
    const reading = expect(pair.first.read()).rejects.toThrow('超时'); await vi.advanceTimersByTimeAsync(51); await reading;
    await expect(pair.first.send({ type: 'late' })).rejects.toThrow('取消');
  });
  it('validates exact chunk length, offset, and SHA-256 including a short final block', () => {
    const bytes = new Uint8Array([1, 2, 3]), header = { type: 'chunk', offset: TRANSFER_CHUNK_BYTES, length: 3, sha256: transferHash(bytes) };
    expect(() => verifyTransferChunk(header, TRANSFER_CHUNK_BYTES, TRANSFER_CHUNK_BYTES + 3, bytes)).not.toThrow();
    expect(() => verifyTransferChunk(header, 0, TRANSFER_CHUNK_BYTES + 3, bytes)).toThrow('次序');
    expect(() => verifyTransferChunk(header, TRANSFER_CHUNK_BYTES, TRANSFER_CHUNK_BYTES + 4, bytes)).toThrow('长度');
    expect(() => verifyTransferChunk({ ...header, sha256: hashA }, TRANSFER_CHUNK_BYTES, TRANSFER_CHUNK_BYTES + 3, bytes)).toThrow('校验');
  });
});

describe('authenticated resumable device transfer', () => {
  it('never emits an offer before both users confirm the same six digit code', async () => {
    const pair = duplex(), sender = options('sender', outgoing(new Uint8Array([1]))), receiver = options('receiver');
    let acceptSender: ((value: { accepted: boolean; mode: 'MERGE' }) => void) | undefined;
    let acceptReceiver: ((value: { accepted: boolean; mode: 'MERGE' }) => void) | undefined;
    const codes: string[] = [];
    sender.confirm = async ({ code }) => { codes.push(code); return new Promise((resolve) => { acceptSender = resolve; }); };
    receiver.confirm = async ({ code }) => { codes.push(code); return new Promise((resolve) => { acceptReceiver = resolve; }); };
    const sending = authenticateTransfer(pair.first, sender), receiving = authenticateTransfer(pair.second, receiver);
    await vi.waitFor(() => expect(codes).toHaveLength(2)); expect(codes[0]).toBe(codes[1]);
    expect(pair.controls.flat().map((c) => c.type)).toEqual(['hello', 'pairing_state', 'hello', 'pairing_state']);
    acceptSender!({ accepted: true, mode: 'MERGE' }); await Promise.resolve(); expect(pair.controls.flat().some((c) => c.type === 'offer')).toBe(false);
    acceptReceiver!({ accepted: true, mode: 'MERGE' });
    const [a, b] = await Promise.all([sending, receiving]); expect(a.checkpoint.peerFingerprint).toBe(hashB); expect(b.checkpoint.peerFingerprint).toBe(hashA);
  });
  it('rejects a declined pairing without sending payload', async () => {
    const pair = duplex(), receiver = options('receiver'); receiver.confirm = async () => ({ accepted: false, mode: 'MERGE' });
    const results = await together(authenticateTransfer(pair.first, options('sender', outgoing(new Uint8Array([1])))), authenticateTransfer(pair.second, receiver), pair);
    expect(results.every((r) => r.status === 'rejected')).toBe(true); expect(pair.controls.flat().some((c) => c.type === 'offer')).toBe(false);
  });
  it('rejects two senders and an unexpected discovered device', async () => {
    for (const wrongRole of [true, false]) {
      const pair = duplex(), sender = options('sender', outgoing(new Uint8Array([1]))), receiver = options(wrongRole ? 'receiver' : 'unexpected', wrongRole ? { ...outgoing(new Uint8Array([1])), peerId: 'sender' } : undefined);
      const result = await together(authenticateTransfer(pair.first, sender), authenticateTransfer(pair.second, receiver), pair);
      expect(result[0].status).toBe('rejected'); expect(pair.controls.flat().some((c) => c.type === 'offer')).toBe(false);
    }
  });
  it('copies multiple chunks, verifies the complete archive, and persists its receipt before notifying the sender', async () => {
    const bytes = new Uint8Array(TRANSFER_CHUNK_BYTES + 31).map((_, i) => i % 251), pair = duplex(), incoming = new MemoryTransferFile(), saves: TransferCheckpoint[] = [];
    const [sender, receiver] = await Promise.all([authenticateTransfer(pair.first, options('sender', outgoing(bytes))), authenticateTransfer(pair.second, options('receiver'))]);
    const inspect = vi.fn(async () => ({ count: 3 })), importer = vi.fn(async () => imported);
    const result = await together(sendTransferPayload(pair.first, sender, { file: new MemoryTransferFile(bytes), saveCheckpoint: async () => {} }), receiveTransferPayload(pair.second, receiver, {
      file: incoming, availableSpace: async () => TRANSFER_MAX_BYTES, saveCheckpoint: async (s) => { saves.push(structuredClone(s)); }, inspect, importArchive: importer,
    }), pair);
    expect(result.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']); expect(incoming.bytes).toEqual(bytes); expect(inspect).toHaveBeenCalledOnce(); expect(importer).toHaveBeenCalledOnce();
    expect(saves.map((s) => s.offset ?? 0)).toEqual([0, TRANSFER_CHUNK_BYTES, bytes.length, bytes.length]); expect(saves.at(-1)?.result).toEqual(imported);
    expect(pair.controls[1].filter((c) => c.type === 'ack').map((c) => c.offset)).toEqual([TRANSFER_CHUNK_BYTES, bytes.length]);
  });
  it('resumes only at the durable checkpoint, truncates unacknowledged bytes, and skips renewed consent only with both pinned identities', async () => {
    const bytes = new Uint8Array(TRANSFER_CHUNK_BYTES + 13).fill(7), source = new MemoryTransferFile(bytes), target = new MemoryTransferFile();
    let saved: TransferCheckpoint | null = null, savedOutgoing: TransferCheckpoint | null = null, appendCount = 0;
    target.onAppend = () => { if (++appendCount === 2) throw new Error('connection lost before checkpoint'); };
    const first = duplex(), sendOptions = options('sender', outgoing(bytes)), receiveOptions = options('receiver');
    sendOptions.saveCheckpoint = async (s) => { savedOutgoing = structuredClone(s); }; receiveOptions.saveCheckpoint = async (s) => { saved = structuredClone(s); };
    const [send, receive] = await Promise.all([authenticateTransfer(first.first, sendOptions), authenticateTransfer(first.second, receiveOptions)]);
    const failed = await together(sendTransferPayload(first.first, send, { file: source, saveCheckpoint: async () => {} }), receiveTransferPayload(first.second, receive, {
      file: target, availableSpace: async () => TRANSFER_MAX_BYTES, saveCheckpoint: (s) => receiveOptions.saveCheckpoint(s, true), inspect: async () => ({}), importArchive: async () => imported,
    }), first);
    expect(failed.every((r) => r.status === 'rejected')).toBe(true); expect((saved as TransferCheckpoint | null)?.offset).toBe(TRANSFER_CHUNK_BYTES); expect(target.bytes.length).toBe(bytes.length);
    target.onAppend = undefined;
    const next = duplex(), resumedSender = options('sender', { ...outgoing(bytes), ...savedOutgoing! }), resumedReceiver = options('receiver');
    resumedReceiver.loadIncoming = async () => saved;
    resumedSender.confirm = resumedReceiver.confirm = vi.fn(async () => { throw new Error('must not confirm pinned resume'); });
    const [a, b] = await Promise.all([authenticateTransfer(next.first, resumedSender), authenticateTransfer(next.second, resumedReceiver)]);
    const success = await together(sendTransferPayload(next.first, a, { file: source, saveCheckpoint: async () => {} }), receiveTransferPayload(next.second, b, {
      file: target, availableSpace: async () => TRANSFER_MAX_BYTES, saveCheckpoint: async () => {}, inspect: async () => ({}), importArchive: async () => imported,
    }), next);
    expect(success.every((r) => r.status === 'fulfilled')).toBe(true); expect(target.bytes).toEqual(bytes);
    expect(next.controls[0].filter((c) => c.type === 'chunk').map((c) => c.offset)).toEqual([TRANSFER_CHUNK_BYTES]); expect(resumedSender.confirm).not.toHaveBeenCalled();
  });
  it('replays an imported receipt even after the archive was removed, without invoking import twice', async () => {
    const bytes = new Uint8Array([8, 9]), pair = duplex(), session = { ...outgoing(bytes), peerFingerprint: hashB };
    const receiverOptions = options('receiver'); receiverOptions.loadIncoming = async () => ({ sessionId, token, createdAt: now, peerFingerprint: hashA, size: bytes.length, sha256: transferHash(bytes), offset: bytes.length, result: imported });
    const [sender, receiver] = await Promise.all([authenticateTransfer(pair.first, options('sender', session)), authenticateTransfer(pair.second, receiverOptions)]);
    const importer = vi.fn(async () => imported);
    const result = await together(sendTransferPayload(pair.first, sender, { file: new MemoryTransferFile(bytes), saveCheckpoint: async () => {} }), receiveTransferPayload(pair.second, receiver, {
      file: new MemoryTransferFile(), availableSpace: async () => 0, saveCheckpoint: async () => {}, inspect: async () => ({}), importArchive: importer,
    }), pair);
    expect(result.every((r) => r.status === 'fulfilled')).toBe(true); expect(importer).not.toHaveBeenCalled(); expect(pair.controls[0].some((c) => c.type === 'chunk')).toBe(false);
  });
  it('refuses a changed certificate or token instead of silently starting a fresh transfer', async () => {
    for (const changed of ['certificate', 'token']) {
      const pair = duplex(), receiver = options('receiver'); receiver.loadIncoming = async () => ({ sessionId, token: changed === 'token' ? '4'.repeat(64) : token, createdAt: now, peerFingerprint: changed === 'certificate' ? hashB : hashA });
      const result = await together(authenticateTransfer(pair.first, options('sender', outgoing(new Uint8Array([1])))), authenticateTransfer(pair.second, receiver), pair);
      expect(result[1].status).toBe('rejected'); expect(pair.controls.flat().some((c) => c.type === 'offer')).toBe(false);
    }
  });
  it('does not acknowledge a chunk until both the file and checkpoint are durable', async () => {
    const bytes = new Uint8Array([1, 2]), pair = duplex(), [sender, receiver] = await Promise.all([authenticateTransfer(pair.first, options('sender', outgoing(bytes))), authenticateTransfer(pair.second, options('receiver'))]);
    const result = await together(sendTransferPayload(pair.first, sender, { file: new MemoryTransferFile(bytes), saveCheckpoint: async () => {} }), receiveTransferPayload(pair.second, receiver, {
      file: new MemoryTransferFile(), availableSpace: async () => TRANSFER_MAX_BYTES,
      saveCheckpoint: async (s) => { if (s.offset) throw new Error('disk full'); }, inspect: async () => ({}), importArchive: async () => imported,
    }), pair);
    expect(result.every((r) => r.status === 'rejected')).toBe(true); expect(pair.controls[1].some((c) => c.type === 'ack')).toBe(false);
  });
});
