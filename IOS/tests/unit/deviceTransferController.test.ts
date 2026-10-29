import { describe, expect, it, vi } from 'vitest';
import { DeviceTransferController, type DeviceTransferDependencies } from '@platform/ios-native/deviceTransferController';
import { ImportRecoveryPendingError } from '@core/transfer/importJournal';
import type { NativeTransferEvents } from '@platform/ios-native/transferPort';
import { transferHash, type TransferStream } from '@core/transfer/transferWire';
import type { TransferCheckpoint, TransferPeer } from '@core/transfer/transferSession';
import type { PortableArchivePreview } from '@core/transfer/portableFormat';

const id = '01234567-89ab-cdef-0123-456789abcdef', stage = '11234567-89ab-cdef-0123-456789abcdef';
function pipe(first: string, second: string, rejectImported: () => boolean): [TransferStream, TransferStream] {
  const queues: Uint8Array[][] = [[], []], waiters: (() => void)[][] = [[], []], aborts = [new AbortController(), new AbortController()];
  const close = () => { for (const abort of aborts) abort.abort(); for (const list of waiters) for (const wake of list.splice(0)) wake(); };
  return [0, 1].map((side): TransferStream => ({
    localFingerprint: side ? second : first, peerFingerprint: side ? first : second, closed: aborts[side]!.signal,
    read: async (maximum) => {
      while (!queues[side]!.length && !aborts[side]!.signal.aborted) await new Promise<void>((resolve) => waiters[side]!.push(resolve));
      const head = queues[side]!.shift(); if (!head) return null;
      if (head.length > maximum) { queues[side]!.unshift(head.slice(maximum)); return head.slice(0, maximum); } return head;
    },
    write: async (bytes) => {
      if (aborts[side]!.signal.aborted) throw new Error('stream closed');
      if (side === 1 && rejectImported() && new TextDecoder().decode(bytes).includes('"type":"imported"')) { close(); throw new Error('lost imported notification'); }
      queues[1 - side]!.push(bytes.slice()); for (const wake of waiters[1 - side]!.splice(0)) wake();
    }, close: () => { aborts[side]!.abort(); for (const wake of waiters[side]!.splice(0)) wake(); setTimeout(() => { aborts[1 - side]!.abort(); for (const wake of waiters[1 - side]!.splice(0)) wake(); }, 0); },
  })) as [TransferStream, TransferStream];
}
async function until(predicate: () => boolean): Promise<void> {
  for (let count = 0; count < 200; count++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 0)); } throw new Error('controller did not reach expected state');
}
function fixture() {
  const preview: PortableArchivePreview = { packageId: id, version: 2, categories: ['BOOKS'], counts: { books: 1 }, expandedBytes: 3, warnings: [], containsProtected: false, protectedFavorites: false };
  const bytes = new Uint8Array([0, 128, 255]), peers = [{ id: 'sender', name: '发送端' }, { id: 'receiver', name: '接收端' }], sides: ReturnType<typeof side>[] = [];
  let failImported = false;
  function side(local: TransferPeer, index: number) {
    const files = new Map<string, Uint8Array>(), checkpoints = new Map<boolean, TransferCheckpoint>(); let events: NativeTransferEvents | null = null;
    const importArchive = vi.fn<DeviceTransferDependencies['importArchive']>(async () => ({ result: { added: 1, merged: 0, skipped: 0, warnings: ['已导入'], duplicate: false, recordedSeconds: null }, finalizationPending: false, requiresReload: true }));
    const deps: DeviceTransferDependencies = {
      local, randomHex: (length) => (index ? 'b' : 'a').repeat(length * 2), importArchive,
      prepare: vi.fn<DeviceTransferDependencies['prepare']>(async () => { files.set(`transfer/${id}.outgoing`, bytes); return { sessionId: id, path: `transfer/${id}.outgoing`, size: bytes.length, sha256: transferHash(bytes), manifest: { format: 'ciallo-transfer', version: 2, schema: 13, packageId: id, createdAt: 1, categories: ['BOOKS'], counts: { books: 1 }, expandedBytes: 3, entries: [], warnings: [], containsProtected: false, protectedFavorites: false } }; }),
      inspect: vi.fn(async () => ({ stageId: stage, preview, manifest: null, settings: {}, entries: new Map() })), discard: vi.fn(async () => {}), cancelArchive: vi.fn(async () => {}),
      port: {
        start: async (_local, callbacks) => { events = callbacks; callbacks.peers(peers.filter((peer) => peer.id !== local.id)); }, stop: async () => {},
        connect: async () => { const streams = pipe('a'.repeat(64), 'b'.repeat(64), () => failImported); sides[1]!.connection(streams[1]); return streams[0]; },
        file: (sessionId, incoming) => {
          const path = `transfer/${sessionId}.${incoming ? 'incoming' : 'outgoing'}`;
          return { path, size: async () => files.get(path)?.length ?? 0, hash: async () => transferHash(files.get(path) ?? new Uint8Array()), readAt: async (offset, length) => files.get(path)!.slice(offset, offset + length), truncate: async (length) => { files.set(path, (files.get(path) ?? new Uint8Array()).slice(0, length)); }, appendDurable: async (value) => { const old = files.get(path) ?? new Uint8Array(), combined = new Uint8Array(old.length + value.length); combined.set(old); combined.set(value, old.length); files.set(path, combined); }, remove: async () => { files.delete(path); }, availableSpace: async () => 1024 * 1024 * 1024 };
        },
        loadCheckpoint: async (incoming) => structuredClone(checkpoints.get(incoming) ?? null), saveCheckpoint: async (value, incoming) => { checkpoints.set(incoming, structuredClone(value)); }, removeCheckpoint: async (incoming) => { checkpoints.delete(incoming); },
      },
    };
    return { controller: new DeviceTransferController(deps), deps, checkpoints, files, importArchive, connection: (stream: TransferStream) => events!.connection(stream) };
  }
  sides.push(side(peers[0]!, 0), side(peers[1]!, 1));
  return { sender: sides[0]!, receiver: sides[1]!, setLostReceipt: (value: boolean) => { failImported = value; } };
}
async function paired(scenario: ReturnType<typeof fixture>) {
  await scenario.sender.controller.start(); await scenario.receiver.controller.start(); await scenario.sender.controller.prepare({ categories: ['BOOKS'], protectedAuthorized: false });
  const sent = scenario.sender.controller.sendTo('receiver');
  await until(() => !!scenario.sender.controller.getSnapshot().pairing && !!scenario.receiver.controller.getSnapshot().pairing);
  expect(scenario.sender.controller.getSnapshot().pairing?.code).toBe(scenario.receiver.controller.getSnapshot().pairing?.code);
  scenario.sender.controller.pair(true, 'MERGE'); scenario.receiver.controller.pair(true, 'REPLACE');
  return { sent };
}
describe('visible device transfer controller and actual streaming protocol', () => {
  it('checks an empty OS inbox without changing the visible snapshot or prompting', async () => {
    const { receiver } = fixture(), pick = vi.fn(async () => null), takeOpened = vi.fn(async () => null);
    receiver.deps.files = { pick, takeOpened, share: async () => {}, cancel: async () => {} }; await receiver.controller.start();
    const before = receiver.controller.getSnapshot(); await receiver.controller.openFile(true); expect(receiver.controller.getSnapshot()).toBe(before); expect(takeOpened).toHaveBeenCalledOnce(); expect(pick).not.toHaveBeenCalled(); await receiver.controller.stop();
  });
  it('requires reload before more mutations if file import external recovery remains pending', async () => {
    const { receiver } = fixture(); receiver.deps.files = { pick: async () => ({ sessionId: id, path: `transfer/${id}.incoming`, name: 'backup.zip', size: 3, sha256: 'a'.repeat(64) }), share: async () => {}, cancel: async () => {} };
    receiver.importArchive.mockRejectedValueOnce(new ImportRecoveryPendingError([new Error('cannot restore files')]));
    await receiver.controller.start(); const importing = receiver.controller.openFile(); await until(() => receiver.controller.getSnapshot().phase === 'AWAITING_IMPORT'); receiver.controller.import(true); await importing;
    expect(receiver.controller.getSnapshot().requiresReload).toBe(true); await receiver.controller.prepare({ categories: ['BOOKS'], protectedAuthorized: false }); expect(receiver.deps.prepare).not.toHaveBeenCalled(); expect(await receiver.controller.stop()).toBe(true);
  });
  it('inspects picked files before consent, supports explicit replace and leaves network resume untouched', async () => {
    const { receiver } = fixture(); receiver.deps.files = { pick: vi.fn(async () => ({ sessionId: id, path: `transfer/${id}.incoming`, name: 'backup.ciallo', size: 3, sha256: transferHash(new Uint8Array([0, 128, 255])) })), share: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };
    await receiver.controller.start(); const importing = receiver.controller.openFile();
    await until(() => receiver.controller.getSnapshot().phase === 'AWAITING_IMPORT'); expect(receiver.importArchive).not.toHaveBeenCalled();
    receiver.controller.chooseImportMode('REPLACE'); receiver.controller.import(true); await importing;
    expect(receiver.importArchive.mock.calls[0]![1]).toBe('REPLACE'); expect(receiver.controller.getSnapshot().requiresReload).toBe(true); expect(receiver.checkpoints.size).toBe(0); expect(receiver.deps.discard).toHaveBeenCalledWith(stage); expect(receiver.files.size).toBe(0); await receiver.controller.stop();
  });
  it('stopping a file import waits for committed work and retains its reload requirement', async () => {
    const { receiver } = fixture(); receiver.deps.files = { pick: async () => ({ sessionId: id, path: `transfer/${id}.incoming`, name: 'backup.zip', size: 3, sha256: 'a'.repeat(64) }), share: async () => {}, cancel: vi.fn(async () => {}) };
    let finish!: (value: Awaited<ReturnType<DeviceTransferDependencies['importArchive']>>) => void;
    receiver.importArchive.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await receiver.controller.start(); const importing = receiver.controller.openFile(); await until(() => receiver.controller.getSnapshot().phase === 'AWAITING_IMPORT'); receiver.controller.import(true); await until(() => receiver.importArchive.mock.calls.length === 1);
    let stopped = false; const stopping = receiver.controller.stop().then((reload) => { stopped = true; return reload; }); await Promise.resolve(); expect(stopped).toBe(false);
    finish({ result: { added: 1, merged: 0, skipped: 0, warnings: [], duplicate: false, recordedSeconds: null }, finalizationPending: false, requiresReload: true }); await importing; expect(await stopping).toBe(true);
  });
  it('refuses file imports on rejection and requires PIN again to share protected caches after backgrounding', async () => {
    const { sender } = fixture(), share = vi.fn(async () => {});
    sender.deps.files = { pick: async () => ({ sessionId: id, path: `transfer/${id}.incoming`, name: 'backup.zip', size: 3, sha256: 'a'.repeat(64) }), share, cancel: async () => {} };
    await sender.controller.start(); const opening = sender.controller.openFile(); await until(() => sender.controller.getSnapshot().phase === 'AWAITING_IMPORT'); sender.controller.import(false); await opening; expect(sender.importArchive).not.toHaveBeenCalled();
    const prepare = vi.mocked(sender.deps.prepare).getMockImplementation()!; vi.mocked(sender.deps.prepare).mockImplementationOnce(async (...args) => { const value = await prepare(...args); return { ...value, manifest: { ...value.manifest, containsProtected: true } }; });
    await sender.controller.prepare({ categories: ['BOOKS'], protectedAuthorized: true }, '123456'); sender.controller.lockAuthorization(); sender.deps.verifyProtected = vi.fn(async (pin) => pin === '123456');
    await sender.controller.sharePrepared('bad'); expect(share).not.toHaveBeenCalled(); await sender.controller.sharePrepared('123456'); expect(share).toHaveBeenCalledOnce(); await sender.controller.stop();
  });
  it('preserves a valid prior sending archive and checkpoint if preparing its replacement fails', async () => {
    const { sender } = fixture(); await sender.controller.start(); await sender.controller.prepare({ categories: ['BOOKS'], protectedAuthorized: false });
    const checkpoint = structuredClone(sender.checkpoints.get(false)), before = sender.files.get(`transfer/${id}.outgoing`)!.slice();
    vi.mocked(sender.deps.prepare).mockRejectedValueOnce(new Error('disk full'));
    await sender.controller.prepare({ categories: ['BOOKS', 'HISTORY'], protectedAuthorized: false });
    expect(sender.controller.getSnapshot().phase).toBe('FAILED'); expect(sender.controller.getSnapshot().prepared?.size).toBe(3); expect(sender.checkpoints.get(false)).toEqual(checkpoint); expect(sender.files.get(`transfer/${id}.outgoing`)).toEqual(before); await sender.controller.stop();
  });
  it('serializes a rapid stop/reopen with an unfinished native discovery start', async () => {
    const { sender } = fixture(), original = sender.deps.port.start; let ready!: () => void;
    const start = vi.spyOn(sender.deps.port, 'start').mockImplementationOnce(async (...args) => { await new Promise<void>((resolve) => { ready = resolve; }); await original(...args); });
    const opening = sender.controller.start(); await until(() => start.mock.calls.length === 1);
    const stopping = sender.controller.stop(), reopening = sender.controller.start(); ready();
    await Promise.all([opening, stopping, reopening]); expect(start).toHaveBeenCalledTimes(2); expect(sender.controller.getSnapshot().phase).toBe('DISCOVERING'); await sender.controller.stop();
  });
  it('clears a corrupt resume record without trusting its paths, then restarts discovery', async () => {
    const { sender } = fixture(), load = sender.deps.port.loadCheckpoint, remove = sender.deps.port.removeCheckpoint; let malformed = true;
    vi.spyOn(sender.deps.port, 'loadCheckpoint').mockImplementation(async (incoming) => { if (!incoming && malformed) throw new Error('corrupt checkpoint'); return load(incoming); });
    vi.spyOn(sender.deps.port, 'removeCheckpoint').mockImplementation(async (incoming) => { if (!incoming) malformed = false; await remove(incoming); });
    await sender.controller.start(); expect(sender.controller.getSnapshot().phase).toBe('FAILED'); await sender.controller.forgetResume(); expect(sender.controller.getSnapshot().phase).toBe('DISCOVERING'); expect(sender.files.size).toBe(0); await sender.controller.stop();
  });
  it('requires fresh local PIN verification before connecting a protected cached outgoing archive', async () => {
    const { sender } = fixture(); sender.files.set(`transfer/${id}.outgoing`, new Uint8Array([0, 128, 255]));
    sender.checkpoints.set(false, { sessionId: id, token: 'a'.repeat(64), createdAt: Date.now(), size: 3, sha256: transferHash(new Uint8Array([0, 128, 255])), peerId: 'receiver', protected: true } as TransferCheckpoint);
    sender.deps.verifyProtected = vi.fn(async (pin) => pin === '123456'); const connect = vi.spyOn(sender.deps.port, 'connect').mockRejectedValue(new Error('after authorization'));
    await sender.controller.start(); expect(sender.controller.getSnapshot().prepared?.requiresPin).toBe(true); await sender.controller.sendTo('receiver', '654321'); expect(connect).not.toHaveBeenCalled();
    await sender.controller.sendTo('receiver', '123456'); expect(connect).toHaveBeenCalledOnce(); expect(sender.controller.getSnapshot().prepared?.requiresPin).toBe(false); await sender.controller.stop();
  });
  it('requires pair and archive-preview consent before importing and reports a durable result to both devices', async () => {
    const state = fixture(); const { sent: sending } = await paired(state);
    await until(() => state.receiver.controller.getSnapshot().phase === 'AWAITING_IMPORT'); expect(state.receiver.importArchive).not.toHaveBeenCalled();
    state.receiver.controller.import(true); await sending; await until(() => state.receiver.controller.getSnapshot().phase === 'COMPLETED');
    expect(state.sender.controller.getSnapshot().result?.added).toBe(1); expect(state.receiver.checkpoints.get(true)?.result?.added).toBe(1); expect(state.receiver.importArchive.mock.calls[0]![1]).toBe('REPLACE');
    expect(await state.receiver.controller.stop()).toBe(true); await state.sender.controller.stop();
  });
  it('replays an imported receipt after a lost socket notification without another import or confirmation', async () => {
    const state = fixture(); state.setLostReceipt(true); const { sent: sending } = await paired(state);
    await until(() => state.receiver.controller.getSnapshot().phase === 'AWAITING_IMPORT'); state.receiver.controller.import(true); await sending;
    await until(() => state.sender.controller.getSnapshot().phase === 'FAILED'); await until(() => state.receiver.controller.getSnapshot().phase === 'COMPLETED');
    state.setLostReceipt(false); await state.sender.controller.sendTo('receiver');
    expect(state.sender.controller.getSnapshot().phase).toBe('COMPLETED'); expect(state.receiver.importArchive).toHaveBeenCalledOnce(); expect(state.sender.controller.getSnapshot().pairing).toBeNull();
    await state.sender.controller.stop(); await state.receiver.controller.stop();
  });
  it('cancels a pending import preview on stop without writing the library', async () => {
    const state = fixture(); const { sent: sending } = await paired(state);
    await until(() => state.receiver.controller.getSnapshot().phase === 'AWAITING_IMPORT');
    expect(await state.receiver.controller.stop()).toBe(false); await sending;
    expect(state.receiver.importArchive).not.toHaveBeenCalled(); expect(state.receiver.deps.discard).toHaveBeenCalledWith(stage); await state.sender.controller.stop();
  });
});
