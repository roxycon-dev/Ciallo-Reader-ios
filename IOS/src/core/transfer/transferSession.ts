import {
  isTransferHash, isTransferNonce, isTransferOffset, isTransferSessionId, requireTransfer,
  TRANSFER_CHUNK_BYTES, TRANSFER_MAX_BYTES, TRANSFER_RETENTION_MS, transferHash,
  transferPairingCode, TransferProtocolError, verifyTransferChunk,
  type TransferControl, type TransferWire,
} from './transferWire';

export type TransferImportMode = 'MERGE' | 'REPLACE';
export type TransferPhase = 'AWAITING_CONFIRMATION' | 'TRANSFERRING' | 'VERIFYING' | 'RECEIVED' | 'IMPORTING' | 'COMPLETED';
export interface TransferPeer { id: string; name: string; }
export interface TransferImportResult { added: number; merged: number; skipped: number; }
export interface TransferCheckpoint {
  sessionId: string;
  token: string;
  createdAt: number;
  peerFingerprint?: string;
  mode?: TransferImportMode;
  size?: number;
  sha256?: string;
  offset?: number;
  result?: TransferImportResult;
}
export interface OutgoingTransfer extends TransferCheckpoint {
  peerId: string;
  size: number;
  sha256: string;
}
export interface TransferHandshakeOptions {
  local: TransferPeer;
  nonce: string;
  outgoing?: OutgoingTransfer;
  /** Persisted local data is untrusted too; validators run before it is used. */
  loadIncoming(): Promise<TransferCheckpoint | null>;
  saveCheckpoint(checkpoint: TransferCheckpoint, incoming: boolean): Promise<void>;
  confirm(pairing: { code: string; peer: TransferPeer; incoming: boolean }): Promise<{ accepted: boolean; mode: TransferImportMode }>;
  now?: () => number;
}
export interface AuthenticatedTransfer {
  incoming: boolean;
  peer: TransferPeer;
  checkpoint: TransferCheckpoint;
}

function validPeer(value: { id?: unknown; name?: unknown }): TransferPeer {
  requireTransfer(typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128 && typeof value.name === 'string', '设备信息无效');
  return { id: value.id, name: value.name.slice(0, 64) };
}
function validCheckpoint(value: TransferCheckpoint, now: number): void {
  requireTransfer(isTransferSessionId(value.sessionId) && isTransferHash(value.token), '续传会话无效');
  requireTransfer(Number.isSafeInteger(value.createdAt) && value.createdAt >= 0 && value.createdAt <= now + 60_000, '续传时间无效');
  requireTransfer(value.peerFingerprint === undefined || isTransferHash(value.peerFingerprint), '续传证书无效');
  requireTransfer(value.mode === undefined || value.mode === 'MERGE' || value.mode === 'REPLACE', '导入方式无效');
}
function validOffer(size: unknown, hash: unknown): asserts size is number {
  requireTransfer(typeof size === 'number' && Number.isSafeInteger(size) && size > 0 && size <= TRANSFER_MAX_BYTES && isTransferHash(hash), '传输数据大小或摘要无效');
}
function importResult(value: TransferControl): TransferImportResult {
  requireTransfer(value.type === 'imported', '未收到导入成功回执');
  for (const key of ['added', 'merged', 'skipped'] as const) requireTransfer(typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 0, '导入回执无效');
  return { added: value.added as number, merged: value.merged as number, skipped: value.skipped as number };
}

/** Mirrors Android TransferManager.runSocket. No offer, manifest, or file bytes
 * are sent until both users confirm, or both peers prove a pinned resume. */
export async function authenticateTransfer(wire: TransferWire, options: TransferHandshakeOptions): Promise<AuthenticatedTransfer> {
  const now = (options.now ?? Date.now)();
  const sending = options.outgoing !== undefined;
  const outgoing = options.outgoing;
  requireTransfer(isTransferNonce(options.nonce), '配对随机数无效');
  validPeer(options.local);
  if (outgoing) { validCheckpoint(outgoing, now); validOffer(outgoing.size, outgoing.sha256); }
  const hello: TransferControl = { type: 'hello', v: 1, ...options.local, name: options.local.name.slice(0, 64), nonce: options.nonce, sending };
  if (outgoing) { hello.sessionId = outgoing.sessionId; hello.token = outgoing.token; }
  wire.setTimeout(8_000);
  await wire.send(hello);
  const remote = await wire.read();
  requireTransfer(remote.type === 'hello' && remote.v === 1 && isTransferNonce(remote.nonce) && typeof remote.sending === 'boolean', '对方使用了不兼容的互传协议');
  requireTransfer(remote.sending !== sending, '双方都在发送或都在等待，请让一台设备选择发送');
  const peer = validPeer(remote);
  requireTransfer(peer.id !== options.local.id, '不能向本机传输');
  if (outgoing && !outgoing.peerFingerprint) requireTransfer(outgoing.peerId === peer.id, '连接的设备与所选设备不一致，请重新发现');
  let checkpoint: TransferCheckpoint;
  if (outgoing) checkpoint = { ...outgoing };
  else {
    requireTransfer(isTransferSessionId(remote.sessionId) && isTransferHash(remote.token), '对方的续传会话无效');
    const persisted = await options.loadIncoming();
    if (persisted) validCheckpoint(persisted, now);
    if (persisted && !persisted.result && persisted.sessionId !== remote.sessionId && now - persisted.createdAt < TRANSFER_RETENTION_MS) throw new TransferProtocolError('接收设备有未完成任务，请先继续或取消该任务');
    if (persisted?.sessionId === remote.sessionId) {
      requireTransfer(persisted.token === remote.token && persisted.peerFingerprint === wire.stream.peerFingerprint, '续传身份不匹配');
      checkpoint = { ...persisted };
    } else checkpoint = { sessionId: remote.sessionId, token: remote.token, createdAt: now };
  }
  const locallyResuming = checkpoint.peerFingerprint !== undefined;
  if (locallyResuming) requireTransfer(checkpoint.peerFingerprint === wire.stream.peerFingerprint, '设备身份已改变，请取消后重新发送');
  await wire.send({ type: 'pairing_state', resume: locallyResuming });
  const remotePairing = await wire.read();
  requireTransfer(remotePairing.type === 'pairing_state' && typeof remotePairing.resume === 'boolean', '配对状态无效');
  if (locallyResuming && remotePairing.resume) {
    await wire.send({ type: 'resume', token: checkpoint.token });
    const response = await wire.read();
    requireTransfer(response.type === 'resume' && response.token === checkpoint.token, '续传口令不匹配');
  } else {
    wire.setTimeout(125_000);
    const code = transferPairingCode(wire.stream.localFingerprint, wire.stream.peerFingerprint, options.nonce, remote.nonce);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consent: { accepted: boolean; mode: TransferImportMode };
    try {
      consent = await wire.withDeadline(() => Promise.race([
        options.confirm({ code, peer, incoming: !sending }),
        new Promise<{ accepted: boolean; mode: TransferImportMode }>((resolve) => { timer = setTimeout(() => resolve({ accepted: false, mode: 'MERGE' }), 120_000); }),
      ]));
    } finally { if (timer !== undefined) clearTimeout(timer); }
    requireTransfer(consent.mode === 'MERGE' || consent.mode === 'REPLACE', '导入方式无效');
    await wire.send({ type: 'confirm', accepted: consent.accepted === true });
    const response = await wire.read();
    requireTransfer(consent.accepted === true && response.type === 'confirm' && response.accepted === true, '对方拒绝或确认已超时');
    checkpoint.peerFingerprint = wire.stream.peerFingerprint;
    if (!sending) checkpoint.mode = consent.mode;
    await options.saveCheckpoint(checkpoint, !sending);
  }
  wire.setTimeout(30_000);
  return { incoming: !sending, peer, checkpoint };
}

/** Native implementations stream from disk. appendDurable must fsync before
 * resolving; checkpoint persistence must use atomic replacement. */
export interface TransferFile {
  size(): Promise<number>;
  hash(): Promise<string>;
  readAt(offset: number, length: number): Promise<Uint8Array>;
  truncate(length: number): Promise<void>;
  appendDurable(bytes: Uint8Array): Promise<void>;
  remove(): Promise<void>;
}
export interface TransferProgress { phase: TransferPhase; completed: number; total: number; }
export interface TransferPayloadOptions {
  file: TransferFile;
  saveCheckpoint(checkpoint: TransferCheckpoint): Promise<void>;
  progress?(progress: TransferProgress): void;
}
function progress(options: TransferPayloadOptions, phase: TransferPhase, completed: number, total: number): void {
  options.progress?.({ phase, completed, total });
}
async function awaitImported(wire: TransferWire): Promise<TransferImportResult> {
  wire.setTimeout(15 * 60 * 1000);
  const result = await wire.read();
  if (result.type === 'import_failed') throw new TransferProtocolError(`对方已收到，但导入未完成：${typeof result.message === 'string' ? result.message.slice(0, 512) : '未知错误'}`);
  return importResult(result);
}

export async function sendTransferPayload(wire: TransferWire, authenticated: AuthenticatedTransfer, options: TransferPayloadOptions): Promise<TransferImportResult> {
  requireTransfer(!authenticated.incoming, '当前会话不是发送任务');
  const session = authenticated.checkpoint;
  validOffer(session.size, session.sha256);
  const size = session.size;
  requireTransfer(await options.file.size() === size && await options.file.hash() === session.sha256, '发送数据已改变，请重新准备');
  await wire.send({ type: 'offer', size, sha256: session.sha256 });
  const ready = await wire.read();
  let result: TransferImportResult;
  if (ready.type === 'imported') result = importResult(ready);
  else {
    if (ready.type !== 'received') {
      requireTransfer(ready.type === 'ready' && isTransferOffset(ready.offset, size), '续传位置无效');
      let offset = ready.offset;
      progress(options, 'TRANSFERRING', offset, size);
      while (offset < size) {
        const length = Math.min(TRANSFER_CHUNK_BYTES, size - offset);
        const bytes = await options.file.readAt(offset, length);
        requireTransfer(bytes.length === length, '发送原文件已缩短');
        await wire.send({ type: 'chunk', offset, length, sha256: transferHash(bytes) });
        await wire.writeBytes(bytes);
        const ack = await wire.read();
        requireTransfer(ack.type === 'ack' && ack.offset === offset + length, '传输确认异常');
        offset += length;
        progress(options, 'TRANSFERRING', offset, size);
      }
      await wire.send({ type: 'end' });
      progress(options, 'VERIFYING', size, size);
      wire.setTimeout(15 * 60 * 1000);
      requireTransfer((await wire.read()).type === 'received', '对方尚未校验完整数据');
    }
    progress(options, 'RECEIVED', size, size);
    result = await awaitImported(wire);
  }
  // A lost final notification must not turn success into a failed transfer.
  await options.saveCheckpoint({ ...session, result });
  progress(options, 'COMPLETED', size, size);
  return result;
}

export interface ReceivePayloadOptions<Preview> extends TransferPayloadOptions {
  availableSpace(): Promise<number>;
  inspect(file: TransferFile): Promise<Preview>;
  importArchive(file: TransferFile, preview: Preview, mode: TransferImportMode): Promise<TransferImportResult>;
}
export async function receiveTransferPayload<Preview>(wire: TransferWire, authenticated: AuthenticatedTransfer, options: ReceivePayloadOptions<Preview>): Promise<TransferImportResult> {
  requireTransfer(authenticated.incoming, '当前会话不是接收任务');
  const session = authenticated.checkpoint;
  const offer = await wire.read();
  requireTransfer(offer.type === 'offer', '没有收到数据描述');
  validOffer(offer.size, offer.sha256);
  const size = offer.size;
  if (session.size !== undefined) requireTransfer(session.size === size && session.sha256 === offer.sha256, '续传数据已改变');
  session.size = size; session.sha256 = offer.sha256 as string;
  if (session.result) {
    const result = importResult({ type: 'imported', ...session.result });
    await wire.send({ type: 'imported', ...result });
    progress(options, 'COMPLETED', size, size);
    return result;
  }
  const offset = session.offset ?? 0;
  requireTransfer(isTransferOffset(offset, size), '续传位置无效');
  if (offset > 0) requireTransfer(await options.file.size() >= offset, '续传缓存缺失，请重新发送');
  requireTransfer(await options.availableSpace() > size - offset + 16 * 1024 * 1024, '接收设备存储空间不足');
  await options.file.truncate(offset);
  await options.saveCheckpoint({ ...session });
  await wire.send({ type: 'ready', offset });
  let received = offset;
  progress(options, 'TRANSFERRING', received, size);
  while (received < size) {
    const header = await wire.read();
    const length = Math.min(TRANSFER_CHUNK_BYTES, size - received);
    // Reject malicious lengths before allocating or reading their payload.
    requireTransfer(header.type === 'chunk' && header.offset === received && header.length === length && isTransferHash(header.sha256), '分块描述无效');
    const bytes = await wire.readBytes(length);
    verifyTransferChunk(header, received, size, bytes);
    await options.file.appendDurable(bytes);
    received += length;
    session.offset = received;
    await options.saveCheckpoint({ ...session });
    await wire.send({ type: 'ack', offset: received });
    progress(options, 'TRANSFERRING', received, size);
  }
  requireTransfer((await wire.read()).type === 'end', '未收到传输结束消息');
  progress(options, 'VERIFYING', size, size);
  requireTransfer(await options.file.size() === size && await options.file.hash() === session.sha256, '完整文件校验失败，请重新发送');
  try {
    const preview = await options.inspect(options.file);
    await wire.send({ type: 'received' });
    progress(options, 'RECEIVED', size, size);
    progress(options, 'IMPORTING', size, size);
    const result = importResult({ type: 'imported', ...await options.importArchive(options.file, preview, session.mode ?? 'MERGE') });
    // Persist the receipt before notifying the peer; retries replay it without
    // importing twice, even when the final socket write is lost.
    await options.saveCheckpoint({ ...session, result });
    session.result = result;
    progress(options, 'COMPLETED', size, size);
    try { await wire.send({ type: 'imported', ...result }); }
    catch { /* Durable success is replayed when the sender reconnects. */ }
    return result;
  } catch (error) {
    if (!session.result) {
      try { await wire.send({ type: 'import_failed', message: error instanceof Error ? error.message.slice(0, 512) : '导入失败' }); }
      catch { /* The durable archive remains available for reconnect. */ }
    }
    throw error;
  }
}
