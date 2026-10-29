import { TransferWire, isTransferHash, isTransferSessionId, requireTransfer, TRANSFER_RETENTION_MS, type TransferStream } from '@core/transfer/transferWire';
import { authenticateTransfer, sendTransferPayload, receiveTransferPayload, type OutgoingTransfer, type TransferCheckpoint, type TransferImportMode, type TransferImportResult, type TransferPeer, type TransferProgress } from '@core/transfer/transferSession';
import type { ArchiveExportSelection } from '@core/transfer/archiveExporter';
import type { PortableArchivePreview } from '@core/transfer/portableFormat';
import type { NativeTransferPort } from './transferPort';
import type { PreparedNativeArchive } from './archiveExportRuntime';
import type { InspectedPortableArchive } from './portableArchivePort';
import type { NativeArchiveImportResult } from './archiveImportRuntime';
import type { ArchiveFilePort, PickedTransferArchive } from './archiveFilePort';
import { ImportRecoveryPendingError } from '@core/transfer/importJournal';

type Phase = 'IDLE' | 'DISCOVERING' | 'PREPARING' | 'PICKING_FILE' | 'SHARING_FILE' | 'CONNECTING' | 'AWAITING_CONFIRMATION' | 'AWAITING_IMPORT' | 'FAILED' | TransferProgress['phase'];
type PendingOutgoing = OutgoingTransfer & { protected?: boolean };
export interface DeviceTransferState {
  localImport?: boolean;
  importMode: TransferImportMode;
  phase: Phase; peers: readonly TransferPeer[]; progress: TransferProgress | null; error: string;
  prepared: { size: number; counts: Record<string, number>; warnings: readonly string[]; resumed: boolean; requiresPin: boolean } | null;
  pairing: { code: string; peer: TransferPeer; incoming: boolean } | null;
  preview: PortableArchivePreview | null; result: TransferImportResult | null; warnings: readonly string[]; requiresReload: boolean;
}
export interface DeviceTransferDependencies {
  local: TransferPeer;
  port: Pick<NativeTransferPort, 'start' | 'stop' | 'connect' | 'file' | 'loadCheckpoint' | 'saveCheckpoint' | 'removeCheckpoint'>;
  randomHex(bytes: number): string;
  verifyProtected?(pin: string): Promise<boolean>;
  files?: ArchiveFilePort;
  prepare(selection: ArchiveExportSelection, options: { pin?: string; signal: AbortSignal }): Promise<PreparedNativeArchive>;
  inspect(path: string, hash: string): Promise<InspectedPortableArchive>;
  importArchive(archive: InspectedPortableArchive, mode: TransferImportMode, signal: AbortSignal, progress: (completed: number, total: number) => void): Promise<NativeArchiveImportResult>;
  discard(stageId: string): Promise<void>;
  cancelArchive(): Promise<void>;
}
/** One visible controller owns discovery, human consent, resumable transport and
 * the import receipt. Stopping also awaits the underlying library operation,
 * even if the network deadline has already rejected its wrapper promise. */
export class DeviceTransferController {
  private state: DeviceTransferState = { importMode: 'MERGE', phase: 'IDLE', peers: [], progress: null, error: '', prepared: null, pairing: null, preview: null, result: null, warnings: [], requiresReload: false };
  private readonly listeners = new Set<() => void>();
  private readonly seen = new WeakSet<TransferStream>();
  private running = false;
  private revision = 0;
  private starting: Promise<void> | null = null;
  private stopping: Promise<boolean> | null = null;
  private connecting: Promise<TransferStream> | null = null;
  private outgoing: PendingOutgoing | null = null;
  private outgoingAuthorized = false;
  private abort = new AbortController();
  private active: Promise<void> | null = null;
  private fileWork: Promise<void> | null = null;
  private exportWork: Promise<PreparedNativeArchive> | null = null;
  private importWork: Promise<NativeArchiveImportResult> | null = null;
  private inspectWork: Promise<InspectedPortableArchive> | null = null;
  private confirmPairing: ((value: { accepted: boolean; mode: TransferImportMode }) => void) | null = null;
  private confirmImport: ((accepted: boolean) => void) | null = null;
  constructor(private readonly deps: DeviceTransferDependencies) {}
  readonly getSnapshot = (): DeviceTransferState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private update(values: Partial<DeviceTransferState>): void { this.state = { ...this.state, ...values }; for (const listener of [...this.listeners]) listener(); }
  private failure(error: unknown): void {
    if (error instanceof ImportRecoveryPendingError) this.update({ requiresReload: true });
    if (this.running) this.update({ phase: 'FAILED', error: error instanceof Error ? error.message.slice(0, 1000) : '设备互传失败', pairing: null });
  }
  async start(): Promise<void> {
    if (this.stopping) await this.stopping;
    if (this.starting) return this.starting;
    const task = this.startNow(); this.starting = task;
    try { await task; } finally { if (this.starting === task) this.starting = null; }
  }
  private async startNow(): Promise<void> {
    if (this.running) return; this.running = true;
    try {
      const saved = await this.deps.port.loadCheckpoint(false);
      if (saved && !saved.result && isTransferSessionId(saved.sessionId) && isTransferHash(saved.token) && typeof saved.size === 'number' && saved.size > 0 && isTransferHash(saved.sha256) && typeof (saved as OutgoingTransfer).peerId === 'string' && saved.createdAt <= Date.now() + 60_000 && Date.now() - saved.createdAt < TRANSFER_RETENTION_MS) {
        const file = this.deps.port.file(saved.sessionId, false);
        if (await file.size() === saved.size) { this.outgoing = saved as PendingOutgoing; this.outgoingAuthorized = false; this.update({ prepared: { size: saved.size, counts: {}, warnings: ['可继续上次未完成的发送'], resumed: true, requiresPin: this.outgoing.protected !== false } }); }
      }
      if (!this.running) return;
      await this.deps.port.start(this.deps.local, { peers: (peers) => this.update({ peers }), connection: (stream) => { void this.accept(stream); }, error: (message) => this.failure(new Error(message)) });
      if (this.running && !this.active) this.update({ phase: 'DISCOVERING', error: '' });
    } catch (error) { this.failure(error); }
  }
  async prepare(selection: ArchiveExportSelection, pin?: string): Promise<void> {
    if (!this.running || this.state.requiresReload || this.active || this.fileWork || this.exportWork || this.connecting) return;
    const revision = this.revision, previous = this.outgoing;
    this.abort = new AbortController(); this.update({ phase: 'PREPARING', error: '', progress: null, result: null });
    try {
      if (!this.running || revision !== this.revision) return;
      const work = this.deps.prepare(selection, { signal: this.abort.signal, ...(pin === undefined ? {} : { pin }) }); this.exportWork = work;
      const archive = await work;
      if (!this.running || this.abort.signal.aborted) { await this.deps.port.file(archive.sessionId, false).remove(); return; }
      const next: PendingOutgoing = { sessionId: archive.sessionId, token: this.deps.randomHex(32), createdAt: Date.now(), peerId: '', size: archive.size, sha256: archive.sha256, protected: archive.manifest.containsProtected };
      try { await this.deps.port.saveCheckpoint(next, false); }
      catch (error) {
        // If persistence failed after an atomic rename, keep the new archive
        // that its on-disk checkpoint may already reference.
        await this.deps.port.loadCheckpoint(false).then(async (stored) => { if (stored?.sessionId !== next.sessionId) await this.deps.port.file(next.sessionId, false).remove(); }).catch(() => {});
        throw error;
      }
      this.outgoing = next; this.outgoingAuthorized = this.running && revision === this.revision;
      const warnings = [...archive.manifest.warnings];
      if (previous && previous.sessionId !== next.sessionId) await this.deps.port.file(previous.sessionId, false).remove().catch(() => { warnings.push('旧发送缓存尚未清理'); });
      if (!this.running || revision !== this.revision) return;
      this.update({ phase: 'DISCOVERING', prepared: { size: archive.size, counts: archive.manifest.counts, warnings, resumed: false, requiresPin: false } });
    } catch (error) { if (revision === this.revision) this.failure(error); }
    finally { this.exportWork = null; }
  }
  async sendTo(peerId: string, pin?: string): Promise<void> {
    if (!this.running || this.state.requiresReload || this.active || this.fileWork || this.connecting || this.exportWork || this.state.phase === 'PREPARING') return;
    const revision = this.revision;
    try {
      requireTransfer(this.outgoing, '请先选择数据并准备发送');
      if (this.outgoing.protected !== false && !this.outgoingAuthorized) {
        requireTransfer(pin && await this.deps.verifyProtected?.(pin), '请验证本机隐私 PIN 后继续发送');
        this.outgoingAuthorized = true; if (this.state.prepared) this.update({ prepared: { ...this.state.prepared, requiresPin: false } });
      }
      requireTransfer(!this.outgoing.peerId || this.outgoing.peerId === peerId, '续传必须选择原设备；发送给其他设备请重新准备数据');
      this.outgoing = { ...this.outgoing, peerId }; await this.deps.port.saveCheckpoint(this.outgoing, false);
      if (!this.running || revision !== this.revision) return;
      this.update({ phase: 'CONNECTING', error: '', result: null });
      this.connecting = this.deps.port.connect(peerId); const stream = await this.connecting;
      if (!this.running || revision !== this.revision) { stream.close(); return; }
      await this.accept(stream);
    } catch (error) { if (revision === this.revision) this.failure(error); }
    finally { this.connecting = null; }
  }
  pair(accepted: boolean, mode: TransferImportMode): void { this.confirmPairing?.({ accepted, mode }); this.confirmPairing = null; this.update({ pairing: null }); }
  import(accepted: boolean): void { this.confirmImport?.(accepted); this.confirmImport = null; }
  chooseImportMode(mode: TransferImportMode): void { if (this.state.localImport && this.state.phase === 'AWAITING_IMPORT' && (mode === 'MERGE' || mode === 'REPLACE')) this.update({ importMode: mode }); }
  lockAuthorization(): void { this.outgoingAuthorized = false; if (this.state.prepared && this.outgoing?.protected !== false) this.update({ prepared: { ...this.state.prepared, requiresPin: true } }); }
  /** iOS sheets legitimately background the app. Keep only that operation alive;
   * later sends still require fresh protected-data authorization. */
  get systemFileSheetOpen(): boolean { return this.state.phase === 'PICKING_FILE' || this.state.phase === 'SHARING_FILE'; }
  async openFile(pending = false): Promise<void> {
    if (!this.running || this.state.requiresReload || !this.deps.files || this.active || this.fileWork || this.exportWork || this.connecting) return;
    this.abort = new AbortController(); const signal = this.abort.signal, before = this.state;
    const work = this.openFileNow(signal, pending).catch((error: unknown) => this.failure(error)).finally(() => { this.fileWork = null; if (this.state !== before) this.update({}); }); this.fileWork = work; await work;
  }
  private async openFileNow(signal: AbortSignal, pending: boolean): Promise<void> {
    let file: PickedTransferArchive | null = null, archive: InspectedPortableArchive | null = null;
    try {
      // An empty system inbox must not change phase: the page checks again only
      // when a real operation finishes or a new OS notification arrives.
      if (pending) { file = await this.deps.files!.takeOpened?.() ?? null; if (!file) return; }
      this.update({ phase: 'PICKING_FILE', localImport: true, error: '', progress: null, preview: null, result: null, warnings: [], importMode: 'MERGE' });
      if (!pending) file = await this.deps.files!.pick();
      if (!file || signal.aborted) { if (!signal.aborted) this.update({ phase: 'DISCOVERING' }); return; }
      this.update({ phase: 'VERIFYING' }); archive = await this.deps.inspect(file.path, file.sha256);
      requireTransfer(!signal.aborted, '已取消导入');
      this.update({ phase: 'AWAITING_IMPORT', preview: archive.preview });
      const accepted = await new Promise<boolean>((resolve) => { this.confirmImport = resolve; }); this.confirmImport = null;
      if (!accepted || signal.aborted) { if (!signal.aborted) this.update({ phase: 'DISCOVERING', preview: null }); return; }
      this.update({ phase: 'IMPORTING' });
      const imported = await this.deps.importArchive(archive, this.state.importMode, signal, (completed, total) => this.update({ progress: { phase: 'IMPORTING', completed, total } }));
      this.update({ phase: 'COMPLETED', result: imported.result, requiresReload: this.state.requiresReload || imported.requiresReload,
        warnings: [...imported.result.warnings, ...(imported.finalizationPending ? ['导入已提交，重新载入后将继续整理恢复日志'] : [])] });
    } finally {
      this.confirmImport = null;
      if (archive) await this.deps.discard(archive.stageId).catch(() => {});
      if (file) await this.deps.port.file(file.sessionId, true).remove().catch(() => {});
      if (this.state.localImport) this.update({ localImport: false });
    }
  }
  async sharePrepared(pin?: string): Promise<void> {
    if (!this.running || this.state.requiresReload || !this.deps.files || this.active || this.fileWork || this.exportWork || this.connecting) return;
    const revision = this.revision;
    const work = (async () => {
      requireTransfer(this.outgoing, '请先选择数据并准备迁移包');
      this.update({ phase: 'SHARING_FILE', error: '' });
      if (this.outgoing.protected !== false && !this.outgoingAuthorized) requireTransfer(pin && await this.deps.verifyProtected?.(pin), '请验证本机隐私 PIN 后分享迁移包');
      requireTransfer(this.running && revision === this.revision, '已取消分享');
      await this.deps.files!.share(`transfer/${this.outgoing.sessionId}.outgoing`, `Ciallo-${new Date().toISOString().slice(0, 10)}.ciallo`);
      if (this.running && revision === this.revision) this.update({ phase: 'DISCOVERING' });
    })().catch((error: unknown) => { if (revision === this.revision) this.failure(error); }).finally(() => { this.fileWork = null; this.update({}); });
    this.fileWork = work; await work;
  }
  private accept(stream: TransferStream): Promise<void> {
    if (this.seen.has(stream)) return this.active ?? Promise.resolve();
    if (!this.running || this.active || this.fileWork || this.exportWork || this.state.phase === 'PREPARING') { stream.close(); return Promise.resolve(); }
    this.seen.add(stream); this.abort = new AbortController();
    const task = this.run(stream).catch((error: unknown) => this.failure(error)).finally(() => { this.active = null; }); this.active = task; return task;
  }
  private async run(stream: TransferStream): Promise<void> {
    const { port } = this.deps, signal = this.abort.signal, wire = new TransferWire(stream, signal);
    let inspected: InspectedPortableArchive | null = null;
    const cancelConfirmation = () => { this.abort.abort(); this.confirmPairing?.({ accepted: false, mode: 'MERGE' }); this.confirmImport?.(false); };
    signal.addEventListener('abort', cancelConfirmation, { once: true }); stream.closed?.addEventListener('abort', cancelConfirmation, { once: true });
    try {
      this.update({ error: '', preview: null, progress: null, result: null, warnings: [], localImport: false });
      requireTransfer(!this.outgoing?.peerId || this.outgoing.protected === false || this.outgoingAuthorized, '请先验证本机隐私 PIN 后继续发送');
      const authenticated = await authenticateTransfer(wire, {
        local: this.deps.local, nonce: this.deps.randomHex(24), ...(this.outgoing?.peerId ? { outgoing: this.outgoing } : {}),
        loadIncoming: () => port.loadCheckpoint(true), saveCheckpoint: (checkpoint, incoming) => port.saveCheckpoint(checkpoint, incoming),
        confirm: async (pairing) => {
          requireTransfer(!this.state.requiresReload, '请先重新载入已更新的书库');
          this.update({ phase: 'AWAITING_CONFIRMATION', pairing });
          return new Promise((resolve) => { this.confirmPairing = resolve; });
        },
      });
      this.confirmPairing = null; this.update({ pairing: null });
      requireTransfer(!this.state.requiresReload || authenticated.incoming && authenticated.checkpoint.result, '请先重新载入已更新的书库');
      if (authenticated.incoming) this.update({ importMode: authenticated.checkpoint.mode ?? 'MERGE' });
      if (!authenticated.incoming && this.outgoing) this.outgoing = { ...this.outgoing, ...authenticated.checkpoint };
      const incoming = authenticated.incoming, file = port.file(authenticated.checkpoint.sessionId, incoming);
      const progress = (value: TransferProgress) => this.update({ phase: value.phase, progress: value });
      let result: TransferImportResult;
      if (!incoming) result = await sendTransferPayload(wire, authenticated, { file, saveCheckpoint: (checkpoint) => port.saveCheckpoint(checkpoint, false), progress });
      else result = await receiveTransferPayload(wire, authenticated, {
        file, availableSpace: () => file.availableSpace(), saveCheckpoint: (checkpoint) => port.saveCheckpoint(checkpoint, true), progress,
        inspect: async () => { this.inspectWork = this.deps.inspect(file.path, authenticated.checkpoint.sha256!); inspected = await this.inspectWork; this.update({ preview: inspected.preview }); return inspected; },
        importArchive: async (_file, archive, mode) => {
          this.update({ phase: 'AWAITING_IMPORT', preview: archive.preview });
          const accepted = await new Promise<boolean>((resolve) => { this.confirmImport = resolve; }); this.confirmImport = null;
          requireTransfer(accepted && !signal.aborted, '已取消导入，接收的数据可在续传时重新导入');
          this.update({ phase: 'IMPORTING' });
          const work = this.deps.importArchive(archive, mode, signal, (completed, total) => progress({ phase: 'IMPORTING', completed, total })); this.importWork = work;
          const imported = await work; this.update({ requiresReload: this.state.requiresReload || imported.requiresReload, warnings: [...imported.result.warnings, ...(imported.finalizationPending ? ['导入已提交，重新载入后将继续整理恢复日志'] : [])] });
          return imported.result;
        },
      });
      this.update({ phase: 'COMPLETED', result, pairing: null });
      if (!incoming) {
        await Promise.all([port.removeCheckpoint(false), file.remove()]).catch(() => this.update({ warnings: [...this.state.warnings, '发送已完成，暂存清理将在下次整理时重试'] }));
        this.outgoing = null; this.update({ prepared: null });
      }
    } finally {
      wire.close(); this.confirmPairing?.({ accepted: false, mode: 'MERGE' }); this.confirmPairing = null; this.confirmImport?.(false); this.confirmImport = null;
      signal.removeEventListener('abort', cancelConfirmation); stream.closed?.removeEventListener('abort', cancelConfirmation);
      await this.deps.cancelArchive().catch(() => {});
      if (this.inspectWork) await this.inspectWork.catch(() => {}); this.inspectWork = null;
      if (this.importWork) await this.importWork.catch(() => {}); this.importWork = null;
      if (inspected !== null) await this.deps.discard((inspected as InspectedPortableArchive).stageId).catch(() => {});
      this.update({ pairing: null });
    }
  }
  async stop(): Promise<boolean> {
    this.revision++;
    if (this.stopping) return this.stopping;
    const task = this.stopNow(); this.stopping = task;
    try { return await task; } finally { if (this.stopping === task) this.stopping = null; }
  }
  private async stopNow(): Promise<boolean> {
    this.running = false; this.outgoingAuthorized = false; this.abort.abort(); this.confirmPairing?.({ accepted: false, mode: 'MERGE' }); this.confirmImport?.(false);
    await Promise.allSettled([this.deps.port.stop(), this.deps.cancelArchive(), this.deps.files?.cancel()]);
    await Promise.allSettled([this.active, this.fileWork, this.exportWork, this.importWork].filter((work): work is Promise<void> | Promise<PreparedNativeArchive> | Promise<NativeArchiveImportResult> => work !== null));
    await this.starting?.catch(() => {}); await this.connecting?.catch(() => {});
    this.confirmPairing = null; this.confirmImport = null; this.update({ phase: 'IDLE', pairing: null }); return this.state.requiresReload;
  }
  async forgetResume(): Promise<void> {
    if (this.state.requiresReload || this.active || this.fileWork || this.exportWork || this.connecting) return;
    const restart = this.running, expectedRevision = this.revision + 1; await this.stop();
    for (const incoming of [false, true]) {
      const checkpoint: TransferCheckpoint | null = await this.deps.port.loadCheckpoint(incoming).catch(() => null);
      if (checkpoint && isTransferSessionId(checkpoint.sessionId)) await this.deps.port.file(checkpoint.sessionId, incoming).remove();
      await this.deps.port.removeCheckpoint(incoming);
    }
    await this.deps.files?.clearOpened?.();
    this.outgoing = null; this.update({ prepared: null, error: '', preview: null, result: null, phase: this.running ? 'DISCOVERING' : 'IDLE' });
    if (restart && this.revision === expectedRevision) await this.start();
  }
  async restart(): Promise<void> { await this.stop(); await this.start(); }
}
