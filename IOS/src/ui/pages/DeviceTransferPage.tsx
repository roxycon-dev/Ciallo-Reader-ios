import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getPlatform, getPlatformKind } from '@platform/index';
import { getPrivacyService } from '@platform/privacyRuntime';
import { getDeviceTransferController } from '@platform/ios-native/deviceTransferRuntime';
import { getNativeUndoInfo, undoNativeArchive, NativeUndoPendingError, type NativeUndoInfo } from '@platform/ios-native/archiveUndoRuntime';
import type { DeviceTransferController, DeviceTransferState } from '@platform/ios-native/deviceTransferController';
import { TRANSFER_CATEGORIES, TRANSFER_CATEGORY_LABELS, type TransferCategory } from '@core/transfer/portableFormat';
import type { TransferImportMode } from '@core/transfer/transferSession';
import { formatByteSize } from '@core/download/downloadQueue';
import { TabScreenHeader } from '@ui/components/TabScreenHeader';
import { GlassCard } from '@ui/components/GlassCard';
import { AppButton } from '@ui/components/AppButton';
import { useAppStore } from '@ui/state/appStore';
import '../../styles/device-transfer.css';

const empty: DeviceTransferState = { importMode: 'MERGE', phase: 'IDLE', peers: [], progress: null, error: '', prepared: null, pairing: null, preview: null, result: null, warnings: [], requiresReload: false };
const noSubscribe = () => () => {}, emptySnapshot = () => empty;
const goBack = () => useAppStore.getState().setRoute('main'), reloadApp = () => window.location.reload();
const labels: Record<DeviceTransferState['phase'], string> = { IDLE: '互传已暂停', DISCOVERING: '等待附近设备', PREPARING: '正在整理所选数据', PICKING_FILE: '正在选择并读取迁移包', SHARING_FILE: '正在分享迁移包', CONNECTING: '正在连接设备', AWAITING_CONFIRMATION: '请核对两台设备的配对码', AWAITING_IMPORT: '数据已收到，请确认导入', TRANSFERRING: '正在传输', VERIFYING: '正在校验完整数据', RECEIVED: '对方已收到，等待导入', IMPORTING: '正在导入，请稍候', COMPLETED: '迁移完成', FAILED: '互传未完成' };
export interface TransferUndoUi { info(): Promise<NativeUndoInfo | null>; restore(snapshotId: string, pin?: string): Promise<{ finalizationPending: boolean }>; }
const nativeUndo: TransferUndoUi = { info: getNativeUndoInfo, restore: undoNativeArchive };
export interface DeviceTransferPageProps { controller?: DeviceTransferController; nativeAvailable?: boolean; onBack?: () => void; reload?: () => void; undoIO?: TransferUndoUi; }
export function DeviceTransferPage({ controller: injected, nativeAvailable = getPlatformKind() === 'ios-native', onBack = goBack, reload = reloadApp, undoIO }: DeviceTransferPageProps) {
  const [controller, setController] = useState(injected ?? null), [error, setError] = useState(''), [leaving, setLeaving] = useState(false);
  const [categories, setCategories] = useState<TransferCategory[]>([...TRANSFER_CATEGORIES]), [includeProtected, setIncludeProtected] = useState(false), [pin, setPin] = useState('');
  const [mode, setMode] = useState<TransferImportMode>('MERGE'), [privacyEnabled, setPrivacyEnabled] = useState(false), [setupPin, setSetupPin] = useState(''), [setupConfirm, setSetupConfirm] = useState('');
  const [undoInfo, setUndoInfo] = useState<NativeUndoInfo | null>(null), [undoConfirm, setUndoConfirm] = useState(false), [undoBusy, setUndoBusy] = useState(false), [undoPin, setUndoPin] = useState('');
  const state = useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.getSnapshot ?? emptySnapshot), dialog = useRef<HTMLDivElement>(null);
  const available = nativeAvailable || injected !== undefined;
  const undo = undoIO ?? nativeUndo;
  const busy = !['IDLE', 'DISCOVERING', 'FAILED', 'COMPLETED'].includes(state.phase), pendingImport = state.phase === 'AWAITING_IMPORT', modal = state.pairing !== null || pendingImport || undoConfirm;
  const run = (work: Promise<unknown>) => { void work.catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '操作未完成')); };
  useEffect(() => {
    if (!available) return;
    let mounted = true, current: DeviceTransferController | null = injected ?? null;
    void (async () => {
      current ??= await getDeviceTransferController(); if (!mounted) return;
      setController(current); await current.start();
    })().catch((reason: unknown) => { if (mounted) setError(reason instanceof Error ? reason.message : '无法开启设备互传'); });
    return () => { mounted = false; if (current) void current.stop().then((needsReload) => { if (needsReload) reload(); }); };
  }, [available, injected, reload]);
  useEffect(() => { const service = getPrivacyService(); void service.ready().then((value) => setPrivacyEnabled(value.enabled)).catch(() => {}); return service.subscribe(() => setPrivacyEnabled(service.getSnapshot().enabled)); }, []);
  useEffect(() => {
    if (!nativeAvailable || injected && !undoIO) return;
    let mounted = true; void undo.info().then((info) => { if (mounted) setUndoInfo(info); }).catch((reason: unknown) => { if (mounted) setError(reason instanceof Error ? reason.message : '无法读取恢复快照'); });
    return () => { mounted = false; };
  }, [nativeAvailable, injected, undoIO, undo, state.result]);
  useEffect(() => {
    if (!controller || !nativeAvailable || injected) return;
    let paused = false;
    return getPlatform().appLifecycle.subscribe((foreground) => {
      if (!foreground) { controller.lockAuthorization(); if (controller.systemFileSheetOpen) return; paused = true; void controller.stop().catch(() => {}); }
      else if (paused) { paused = false; void (async () => { if (await controller.stop()) reload(); else await controller.start(); })().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '恢复互传失败')); }
    });
  }, [controller, nativeAvailable, injected, reload]);
  useEffect(() => { if (modal) dialog.current?.focus({ preventScroll: true }); }, [modal]);
  const back = async () => { setLeaving(true); try { if (await controller?.stop()) reload(); else onBack(); } catch (reason) { setError(reason instanceof Error ? reason.message : '暂时无法退出'); setLeaving(false); } };
  const toggle = (category: TransferCategory) => setCategories((current) => current.includes(category) ? current.filter((value) => value !== category) : [...current, category]);
  const setup = async () => {
    if (!/^\d{6}$/.test(setupPin) || setupPin !== setupConfirm) { setError('请输入两次一致的六位数字 PIN'); return; }
    if (!await getPrivacyService().enable(setupPin)) throw new Error('隐私 PIN 设置未完成');
    setSetupPin(''); setSetupConfirm(''); setError('');
  };
  const restoreSnapshot = async () => {
    if (!undoInfo || undoBusy) return; setUndoBusy(true); setError('');
    try { await controller?.stop(); await undo.restore(undoInfo.snapshotId, undoPin); setUndoPin(''); reload(); }
    catch (reason) { setUndoPin(''); setUndoBusy(false); if (reason instanceof NativeUndoPendingError) reload(); else setError(reason instanceof Error ? reason.message : '恢复快照失败'); }
  };
  const percent = state.progress && state.progress.total > 0 ? Math.min(100, Math.round(state.progress.completed / state.progress.total * 100)) : 0;
  return <section className="device-transfer-page" aria-label="设备互传">
    <TabScreenHeader title="设备互传" subtitle="Ciallo · 附近设备迁移" leading={<button type="button" className="transfer-back" aria-label="返回设置" disabled={leaving || undoBusy} onClick={() => run(back())}>‹</button>} />
    <main className="transfer-content" inert={modal}>
      <GlassCard><h2>面对面迁移</h2><p>让两台设备连接同一局域网，并打开设备互传。接收端保持此页，发送端选择数据后点击对方设备。</p><p>书籍、原文件、收藏、标注和设置可分开选择，登录凭据与本机 PIN 保留在各自设备。</p></GlassCard>
      {!available ? <GlassCard><p role="status">附近设备互传需要安装后的 iOS 应用和本地网络权限。</p></GlassCard> : <>
        <GlassCard><h2>选择发送数据</h2><fieldset className="transfer-categories" disabled={busy || leaving || !controller}><legend className="sr-only">迁移类别</legend>
          {TRANSFER_CATEGORIES.map((category) => <label key={category}><input type="checkbox" checked={categories.includes(category)} onChange={() => toggle(category)} /><span>{TRANSFER_CATEGORY_LABELS[category]}</span></label>)}
        </fieldset>
          <label className="transfer-check"><input type="checkbox" checked={includeProtected} disabled={busy || !privacyEnabled} onChange={(event) => setIncludeProtected(event.currentTarget.checked)} />包含受保护内容</label>
          {(includeProtected || state.prepared?.requiresPin) && <label className="transfer-field">{state.prepared?.requiresPin ? '发送或分享前验证本机隐私 PIN' : '本机隐私 PIN'}<input aria-label="发送受保护内容的 PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(event) => setPin(event.currentTarget.value)} disabled={busy} /></label>}
          <div className="transfer-actions"><AppButton disabled={!controller || busy || !categories.length || leaving} onClick={() => { if (controller) { run(controller.prepare({ categories, protectedAuthorized: includeProtected }, includeProtected ? pin : undefined)); setPin(''); } }}>准备发送</AppButton>
            <AppButton variant="secondary" disabled={!controller || busy || leaving} onClick={() => { if (controller) run(controller.forgetResume()); }}>清除续传</AppButton></div>
          {state.prepared && <div className="transfer-summary"><strong>{state.prepared.resumed ? '上次发送可继续' : '数据已准备好'} · {formatByteSize(state.prepared.size)}</strong><p>{Object.entries(state.prepared.counts).map(([table, count]) => `${tableLabel(table)} ${count}`).join(' · ')}</p><Warnings values={state.prepared.warnings} /></div>}
        </GlassCard>
        <GlassCard><h2>通过文件迁移</h2><p>可从“文件”打开 Ciallo 迁移包，也可将准备好的数据保存到文件或通过系统分享发送。导入前会展示类别与数量，供你确认。</p>
          <div className="transfer-actions"><AppButton variant="secondary" disabled={!controller || busy || leaving} onClick={() => { if (controller) run(controller.openFile()); }}>打开迁移包</AppButton>
            <AppButton variant="secondary" disabled={!controller || !state.prepared || busy || leaving} onClick={() => { if (controller) { run(controller.sharePrepared(pin)); setPin(''); } }}>保存或分享迁移包</AppButton></div>
          {state.prepared && includeProtected && <p>包含受保护内容的迁移包应保存在你信任的位置。</p>}
        </GlassCard>
        <GlassCard><h2>附近设备</h2>{!state.peers.length ? <p>正在寻找附近设备，请在另一台设备打开互传并允许本地网络访问。</p> : <ul className="transfer-peers">{state.peers.map((peer) => <li key={peer.id}><span>{peer.name}</span><AppButton size="sm" disabled={!state.prepared || busy || leaving} onClick={() => { if (controller) { run(controller.sendTo(peer.id, pin)); setPin(''); } }}>发送到此设备</AppButton></li>)}</ul>}</GlassCard>
        <GlassCard><h2 role="status" aria-live="polite">{leaving ? '正在结束当前操作' : labels[state.phase]}</h2>{state.progress && <><progress aria-label="迁移进度" max={100} value={percent} /><p>{percent}% · {state.progress.phase === 'IMPORTING' ? `${state.progress.completed} / ${state.progress.total} 项` : `${formatByteSize(state.progress.completed)} / ${formatByteSize(state.progress.total)}`}</p></>}
          {state.result && <p>新增 {state.result.added} 项 · 合并 {state.result.merged} 项 · 跳过 {state.result.skipped} 项</p>}<Warnings values={state.warnings} />
          {(state.phase === 'IDLE' || state.phase === 'FAILED') && <AppButton variant="secondary" disabled={!controller || leaving} onClick={() => { if (controller) run(controller.restart()); }}>重新开启互传</AppButton>}
          {state.requiresReload && <AppButton onClick={() => run(back())} disabled={leaving}>完成并重新载入</AppButton>}
          {busy && <AppButton variant="tertiary" onClick={() => run(back())} disabled={leaving}>取消并返回</AppButton>}
        </GlassCard>
        {undoInfo && <GlassCard><h2>上次替换的恢复快照</h2><p>{new Date(undoInfo.createdAt).toLocaleString()}</p><p>可恢复到替换导入之前。快照之后的书库、标注、设置和书源修改也会回退。</p><AppButton variant="secondary" disabled={busy || leaving} onClick={() => { setUndoConfirm(true); setError(''); }}>撤回上次替换</AppButton></GlassCard>}
      </>}
      {(error || state.error) && <p className="transfer-error" role="alert">{error || state.error}</p>}
    </main>
    {modal && <div className="transfer-modal"><div className="transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-dialog-title" tabIndex={-1} ref={dialog} onKeyDown={(event) => {
      if (event.key === 'Escape') { if (undoConfirm) { if (!undoBusy) { setUndoConfirm(false); setUndoPin(''); } } else if (state.pairing) controller?.pair(false, mode); else controller?.import(false); }
      if (event.key === 'Tab') { const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')], first = controls[0], last = controls.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }}>
      {undoConfirm ? <><h2 id="transfer-dialog-title">恢复替换前的快照</h2><p>将恢复 {undoInfo ? new Date(undoInfo.createdAt).toLocaleString() : ''} 保存的书库、标注、设置和书源。之后的修改会回退，登录账户与本机 PIN 保留。</p>{undoInfo?.needsPin && <label className="transfer-field">本机隐私 PIN<input aria-label="撤回替换的隐私 PIN" type="password" inputMode="numeric" maxLength={6} autoComplete="off" value={undoPin} onChange={(event) => setUndoPin(event.currentTarget.value)} disabled={undoBusy} /></label>}<div className="transfer-actions"><AppButton variant="secondary" disabled={undoBusy} onClick={() => { setUndoConfirm(false); setUndoPin(''); if (controller) run(controller.start()); }}>取消</AppButton><AppButton disabled={undoBusy} onClick={() => run(restoreSnapshot())}>{undoBusy ? '正在恢复快照' : '恢复并重新载入'}</AppButton></div></> : state.pairing ? <><h2 id="transfer-dialog-title">核对配对码</h2><p>对方设备：{state.pairing.peer.name}</p><strong className="transfer-code">{state.pairing.code}</strong><p>两台设备显示的六位数字一致后，再确认连接。</p>
        {state.pairing.incoming && <fieldset className="transfer-mode"><legend>导入方式</legend><label><input type="radio" name="transfer-mode" checked={mode === 'MERGE'} onChange={() => setMode('MERGE')} />合并到本机</label><label><input type="radio" name="transfer-mode" checked={mode === 'REPLACE'} onChange={() => setMode('REPLACE')} />替换所选类别</label></fieldset>}
        <div className="transfer-actions"><AppButton variant="secondary" onClick={() => controller?.pair(false, mode)}>拒绝</AppButton><AppButton onClick={() => controller?.pair(true, mode)}>配对码一致</AppButton></div>
      </> : <><h2 id="transfer-dialog-title">确认导入数据</h2><p>{state.importMode === 'REPLACE' ? '将替换本机对应类别，导入前会保存恢复快照。' : '将合并到本机，保留现有内容并匹配书籍版本。'}</p><p>{state.preview?.categories.map((category) => TRANSFER_CATEGORY_LABELS[category]).join('、')}</p><p>{Object.entries(state.preview?.counts ?? {}).map(([table, count]) => `${tableLabel(table)} ${count}`).join(' · ')}</p><Warnings values={state.preview?.warnings ?? []} />
        {state.localImport && <fieldset className="transfer-mode"><legend>导入方式</legend><label><input type="radio" name="file-import-mode" checked={state.importMode === 'MERGE'} onChange={() => controller?.chooseImportMode('MERGE')} />合并到本机</label><label><input type="radio" name="file-import-mode" checked={state.importMode === 'REPLACE'} onChange={() => controller?.chooseImportMode('REPLACE')} />替换所选类别</label></fieldset>}
        {state.preview?.containsProtected && !privacyEnabled && <fieldset className="transfer-pin"><legend>先为本机设置隐私 PIN</legend><p>这份数据包含受保护内容。</p><input aria-label="新隐私 PIN" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={setupPin} onChange={(event) => setSetupPin(event.currentTarget.value)} /><input aria-label="再次输入隐私 PIN" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={setupConfirm} onChange={(event) => setSetupConfirm(event.currentTarget.value)} /><AppButton size="sm" onClick={() => run(setup())}>设置本机 PIN</AppButton></fieldset>}
        <div className="transfer-actions"><AppButton variant="secondary" onClick={() => controller?.import(false)}>暂不导入</AppButton><AppButton disabled={!!state.preview?.containsProtected && !privacyEnabled} onClick={() => controller?.import(true)}>{state.importMode === 'REPLACE' ? '确认替换并导入' : '确认合并并导入'}</AppButton></div>
      </>}
      {error && <p role="alert" className="transfer-error">{error}</p>}
    </div></div>}
  </section>;
}
const tableNames: Record<string, string> = { books: '书籍', chapters: '章节', categories: '书籍分类', favorites: '收藏', favorite_categories: '收藏分类', bookmarks: '书签', highlights: '标注', god_moments: '神回', reading_records: '日记录', reading_sessions: '阅读会话', comic_progress: '漫画进度', comic_chapter_read: '已读章节' };
function tableLabel(table: string): string { return tableNames[table] ?? '条目'; }
function Warnings({ values }: { values: readonly string[] }) { return <>{values.slice(0, 20).map((warning, index) => <p key={index}>{warning}</p>)}{values.length > 20 && <p>另有 {values.length - 20} 条提示。</p>}</>; }
