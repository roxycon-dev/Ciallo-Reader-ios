/**
 * 设备互传的数据模型 —— `transfer/TransferModels.kt` L10-76 的逐字段移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L10-15  `enum class TransferCategory(rawLabel)` 7 项（BOOKS/FAVORITES/ANNOTATIONS/HISTORY/
 *           SETTINGS/RESOURCES/SOURCES）+ `label = tr(rawLabel)`
 *   L16     `enum class ImportMode { MERGE, REPLACE }`
 *   L17-20  `data class ExportSelection(categories, protectedAuthorized)`
 *   L21-25  `data class ArchivePreview(packageId, version, counts, expandedBytes, categories,
 *           warnings, containsProtected, protectedFavorites)`
 *   L26     `data class ImportResult(added, merged, skipped, warnings)`
 *   L27     `data class TransferEstimate(books, favorites, approximateBytes, warnings)`
 *   L28-32  `data class TransferProgress(phase, completedBytes, totalBytes, bytesPerSecond, message)`
 *           + `fraction` / `remainingSeconds`
 *   L33-40  `enum class TransferPhase(rawLabel)` 13 项 + `label = tr(rawLabel)`
 *   L41     `enum class TransferError` 11 项
 *   L42     `data class TransferRoute(host, port, networkHandle, localAddress, nearby)`
 *   L43-46  `data class TransferPeer(...)` + `routeLabel`
 *   L47-56  `data class TransferSessionState(...)` + `busy`
 *   L58-61  `@Entity transfer_identities` / `transfer_receipts`
 *   L63-66  `TRANSFER_MIME` / `MAX_ARCHIVE_BYTES` / `TRANSFER_RETENTION` / `CHUNK_SIZE`
 *   L69-75  `fileHash(file)`（SHA-256，64 KiB 分块读）
 *   L76     `JSONObject.stringOrNull(key)`
 *
 * 与既有模块的关系
 * ───────────────
 *  `src/core/transfer/portableFormat.ts` 已有 `TransferCategory` 与 `ArchivePreview` 的**线格式**投影；
 *  `src/core/transfer/transferSession.ts` 的 `TransferPhase` 只是线上用到的 6 个阶段子集。
 *  本文件是 Kotlin 全量模型：13 个阶段、11 个错误码、全部字段。两者不冲突（TS 无全局命名空间），
 *  但账本以本文件为准 —— 少一个阶段就是少一个阶段。
 */
import { tr } from '../i18n/locale';

/** L10 `enum class TransferCategory` 的 7 个值与 `rawLabel`。 */
export const TRANSFER_CATEGORIES = [
  'BOOKS',
  'FAVORITES',
  'ANNOTATIONS',
  'HISTORY',
  'SETTINGS',
  'RESOURCES',
  'SOURCES',
] as const;

export type TransferCategory = (typeof TRANSFER_CATEGORIES)[number];

/** L11-12 的 `rawLabel`（`tr()` 前的原文）。 */
export const TRANSFER_CATEGORY_LABELS: Record<TransferCategory, string> = {
  BOOKS: '书籍与离线原文件',
  FAVORITES: '收藏与分类',
  ANNOTATIONS: '书签、标注与神回',
  HISTORY: '阅读进度与记录',
  SETTINGS: '阅读设置与预设',
  RESOURCES: '自定义背景与字体',
  SOURCES: '书源',
};

export function transferCategoryLabel(category: TransferCategory): string {
  return tr(TRANSFER_CATEGORY_LABELS[category]);
}

/** L16 `enum class ImportMode { MERGE, REPLACE }`。 */
export const ImportMode = ['MERGE', 'REPLACE'] as const;
export type ImportMode = (typeof ImportMode)[number];

/** L17-20 `ExportSelection`。 */
export interface ExportSelection {
  readonly categories: ReadonlySet<TransferCategory>;
  readonly protectedAuthorized: boolean;
}

/** L18 默认值：`TransferCategory.entries.toSet()`。 */
export function defaultExportSelection(): ExportSelection {
  return { categories: new Set(TRANSFER_CATEGORIES), protectedAuthorized: false };
}

/** L21-25 `ArchivePreview`。 */
export interface ArchivePreview {
  readonly packageId: string;
  readonly version: number;
  readonly counts: ReadonlyMap<string, number>;
  readonly expandedBytes: number;
  readonly categories: ReadonlySet<TransferCategory>;
  readonly warnings: readonly string[];
  readonly containsProtected: boolean;
  readonly protectedFavorites: boolean;
}

/** L26 `ImportResult(added, merged, skipped, warnings = emptyList())`。 */
export interface ImportResult {
  readonly added: number;
  readonly merged: number;
  readonly skipped: number;
  readonly warnings: readonly string[];
}

/** L27 `TransferEstimate`。 */
export interface TransferEstimate {
  readonly books: number;
  readonly favorites: number;
  readonly approximateBytes: number;
  readonly warnings: readonly string[];
}

/** L33-40 `enum class TransferPhase` 的 13 个值与 `rawLabel`。 */
export const TRANSFER_PHASES = [
  'IDLE',
  'PREPARING',
  'DISCOVERING',
  'CONNECTING',
  'AWAITING_CONFIRMATION',
  'TRANSFERRING',
  'WAITING_TO_RESUME',
  'VERIFYING',
  'RECEIVED',
  'IMPORTING',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;

export type TransferPhase = (typeof TRANSFER_PHASES)[number];

/** L34-37 的 `rawLabel`。 */
export const TRANSFER_PHASE_LABELS: Record<TransferPhase, string> = {
  IDLE: '准备互传',
  PREPARING: '正在准备数据',
  DISCOVERING: '正在发现设备',
  CONNECTING: '正在连接',
  AWAITING_CONFIRMATION: '等待确认',
  TRANSFERRING: '正在传输',
  WAITING_TO_RESUME: '等待继续传输',
  VERIFYING: '正在校验',
  RECEIVED: '数据已收到',
  IMPORTING: '正在导入',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  FAILED: '传输未完成',
};

export function transferPhaseLabel(phase: TransferPhase): string {
  return tr(TRANSFER_PHASE_LABELS[phase]);
}

/** L28-32 `TransferProgress` + `fraction` / `remainingSeconds`。 */
export interface TransferProgress {
  readonly phase: TransferPhase;
  readonly completedBytes: number;
  readonly totalBytes: number;
  readonly bytesPerSecond: number;
  readonly message: string;
}

/** L30 `fraction`。 */
export function transferFraction(progress: TransferProgress): number {
  if (progress.totalBytes <= 0) return 0;
  return Math.min(Math.max(progress.completedBytes / progress.totalBytes, 0), 1);
}

/** L31 `remainingSeconds`。 */
export function transferRemainingSeconds(progress: TransferProgress): number | null {
  if (progress.bytesPerSecond <= 0) return null;
  return Math.trunc(Math.max(progress.totalBytes - progress.completedBytes, 0) / progress.bytesPerSecond);
}

/** L41 `enum class TransferError` 的 11 个值。 */
export const TRANSFER_ERRORS = [
  'PERMISSION',
  'WIFI_DISABLED',
  'UNSUPPORTED',
  'BUSY',
  'CONNECTION',
  'REJECTED',
  'SPACE',
  'CORRUPT',
  'VERSION',
  'IMPORT',
  'UNKNOWN',
] as const;

export type TransferError = (typeof TRANSFER_ERRORS)[number];

/** L42 `TransferRoute`。 */
export interface TransferRoute {
  readonly host: string;
  readonly port: number;
  readonly networkHandle: number | null;
  readonly localAddress: string | null;
  readonly nearby: boolean;
}

/** L43-46 `TransferPeer` + `routeLabel`。 */
export interface TransferPeer {
  readonly id: string;
  readonly name: string;
  readonly host: string | null;
  readonly port: number;
  readonly p2pAddress: string | null;
  readonly protocol: number;
  readonly routes: readonly TransferRoute[];
  readonly directPort: number | null;
  readonly nearbyProtocol: number;
}

/** L45 `routeLabel`。 */
export function transferPeerRouteLabel(peer: TransferPeer): string {
  if (peer.host !== null && peer.routes.every((r) => !r.nearby)) return tr('同 Wi-Fi · 加密连接');
  return tr('附近直连 · 无需网络');
}

/** L47-56 `TransferSessionState`。 */
export interface TransferSessionState {
  readonly phase: TransferPhase;
  readonly peer: TransferPeer | null;
  readonly progress: TransferProgress;
  readonly verificationCode: string | null;
  readonly incoming: boolean;
  readonly preview: ArchivePreview | null;
  readonly result: ImportResult | null;
  readonly error: TransferError | null;
  readonly message: string;
  readonly peerReceived: boolean;
  readonly peerImported: boolean;
}

/** L54-55 `busy`。 */
export const TRANSFER_BUSY_PHASES: readonly TransferPhase[] = [
  'PREPARING',
  'CONNECTING',
  'AWAITING_CONFIRMATION',
  'TRANSFERRING',
  'VERIFYING',
  'IMPORTING',
];

export function transferBusy(state: TransferSessionState): boolean {
  return TRANSFER_BUSY_PHASES.includes(state.phase);
}

/** L58-59 `@Entity(tableName = "transfer_identities", primaryKeys = ["localKey"])`。 */
export interface TransferIdentityEntity {
  readonly localKey: string;
  readonly stableId: string;
}

/** L60-61 `@Entity(tableName = "transfer_receipts", primaryKeys = ["packageId"])`。 */
export interface TransferReceiptEntity {
  readonly packageId: string;
  readonly importedAt: number;
}

/** L63 `TRANSFER_MIME`。 */
export const TRANSFER_MIME = 'application/vnd.ciallo.backup';
/** L64 `MAX_ARCHIVE_BYTES = 4L * 1024 * 1024 * 1024`。 */
export const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;
/** L65 `TRANSFER_RETENTION = 24L * 60 * 60 * 1000`。 */
export const TRANSFER_RETENTION = 24 * 60 * 60 * 1000;
/** L66 `CHUNK_SIZE = 1024 * 1024`。 */
export const CHUNK_SIZE = 1024 * 1024;

/** L69-75 `fileHash(file)`：SHA-256，64 KiB 分块读（Web 用 WebCrypto 的增量不可用，故整块喂）。 */
export async function fileHash(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** L76 `JSONObject.stringOrNull(key)`。 */
export function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  return value === '' ? null : value;
}
