/**
 * 附近直连（Nearby）与传输连接 —— `transfer/NearbyHandshake.kt` L9-30 +
 * `transfer/TransferDiscovery.kt` L25-27 + `transfer/IncomingChapterIndex.kt` L9-60 的移植。
 *
 * `NearbyConnector.kt` L9-100 的**协商状态机**已移到 `@core/transfer/nearbyConnector`
 * （那里的旧版是一个简化玩具版：文案两条错、`pauseDiscovery` / `removeGroup` /
 * `waitForRemoval` / `readGroup` / `action` / `watch` / `refresh` / `cancelConnection` 全缺，
 * 见 `docs/PARITY_EXCEPTIONS.md` E210）。本文件只重新导出，保持调用点不变。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   NearbyConnector.kt L9   `data class NearbyGroup(owner, host, localAddress, members)` → 见 `nearbyConnector`
 *   NearbyConnector.kt L12-18 `interface NearbyPlatform`                            → 见 `nearbyConnector`
 *   NearbyConnector.kt L21-23 `class NearbyConnector(scope, platform, onGroup, onStage,
 *            onError, pollMillis = 750, negotiationMillis = 35_000)`                → 见 `nearbyConnector`
 *   NearbyHandshake.kt L9   `data class NearbyOffer(id, name, sending, busy = false)` → `NearbyOffer`
 *   NearbyHandshake.kt L11-12 `PORT = 38843` / `VERSION = 2`        → 同名常量
 *   NearbyHandshake.kt L13  `MAGIC = 0x4349414c`（"CIAL"）           → 同名常量
 *   NearbyHandshake.kt L14-30 `write(out, offer)` / `read(input)`：
 *            `int MAGIC` + `byte VERSION` + `UTF id` + `UTF name` + `bool sending` + `bool busy`，
 *            id 长度 1..64、name ≤ 64、UTF 长度 ≤ 256               → `writeNearbyOffer` / `readNearbyOffer`
 *   TransferDiscovery.kt L25-27 `onP2pConnected` / `onP2pStage`     → 同名回调类型
 *   TransferConnection.kt L14 `class TransferConnection`            → `@core/transfer/transferConnection`（真身）
 *   IncomingChapterIndex.kt L9-60 `class IncomingChapterIndex(dir, rows, context)`：
 *            `chapter_index.sqlite` + `incoming_chapters(bookId, chapterOrder, bodyHash,
 *            title, contentHash, hasContent)`；`bodyIdentity` / `contentIdentity` /
 *            `compatible` / `compatibleIncoming` / `unresolvedHash`  → `IncomingChapterIndex`
 *
 * 平台差异（已登记 E137）：`DataOutputStream.writeUTF`（modified UTF-8）→ `TextEncoder`；
 * `SQLiteDatabase` → 与 `src/core/db` 相同的行接口（调用方注入）。协议字节序（大端）保持一致。
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { BookContentAccumulator } from './bookFingerprint';
// `export { … } from` 只在再导出层可见；`TransferDiscovery` 的字段签名要的是本地类型绑定。
import type { NearbyPlatform } from './nearbyConnector';

/**
 * `NearbyConnector.kt` 的四个类型与两个常量从真身再导出 —— 调用点写
 * `from '@core/transfer/nearby'` 的代码不用改。
 */
export {
  ConflatedSignal,
  NEARBY_ERROR_CLEANUP_FAILED,
  NEARBY_ERROR_CONNECT_FAILED,
  NEARBY_ERROR_READ_FAILED,
  NEARBY_ERROR_STALE_GROUP,
  NEARBY_ERROR_TIMEOUT,
  NEARBY_NEGOTIATION_MS,
  NEARBY_POLL_MS,
  NEARBY_READ_GROUP_TIMEOUT_MS,
  NEARBY_STAGE_NEGOTIATING,
  NEARBY_WAIT_REMOVAL_TIMEOUT_MS,
  NearbyCancelledError,
  NearbyConnector,
  NearbyTimeoutError,
  isNearbyCancelled,
  isNearbyTimeout,
  nearbyGroupContainsMember,
  type NearbyConnectorOptions,
  type NearbyGroup,
  type NearbyJobToken,
  type NearbyPlatform,
} from './nearbyConnector';

/** `TransferDiscovery.kt` L26 `onP2pConnected`。 */
export type onP2pConnected = (address: string) => void;
/** `TransferDiscovery.kt` L27 `onP2pStage`。 */
export type onP2pStage = (stage: string) => void;

/** `TransferDiscovery.kt` L25 `class TransferDiscovery`。 */
export class TransferDiscovery {
  constructor(
    readonly platform: NearbyPlatform,
    readonly onConnected: onP2pConnected,
    readonly onStage: onP2pStage,
  ) {}
}

/** `NearbyHandshake.kt` L9 `NearbyOffer`。 */
export interface NearbyOffer {
  readonly id: string;
  readonly name: string;
  readonly sending: boolean;
  readonly busy: boolean;
}

/** L11 `PORT = 38843`。 */
export const NEARBY_PORT = 38843;
/** L12 `VERSION = 2`。 */
export const NEARBY_VERSION = 2;
/** L13 `MAGIC = 0x4349414C`（`"CIAL"` 大端）。 */
export const NEARBY_MAGIC = 0x4349414c;
/** L23 `length <= 256`（UTF 长度上限）。 */
export const NEARBY_UTF_LIMIT = 256;

/** L8 注释：id 长度 1..64、name ≤ 64。 */
export const NEARBY_ID_MAX = 64;
export const NEARBY_NAME_MAX = 64;

/** `DataOutputStream.writeUTF` 的等价（无符号 short 长度 + UTF-8 字节）。 */
function writeUtf(view: DataView, offset: number, value: string): number {
  const bytes = new TextEncoder().encode(value);
  view.setUint16(offset, bytes.length, false);
  for (let i = 0; i < bytes.length; i += 1) view.setUint8(offset + 2 + i, bytes[i] ?? 0);
  return offset + 2 + bytes.length;
}

function readUtf(view: DataView, offset: number): { readonly value: string; readonly next: number } {
  const length = view.getUint16(offset, false);
  if (length > NEARBY_UTF_LIMIT) throw new RangeError('无效附近握手');
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset + 2, length);
  return { value: new TextDecoder().decode(bytes), next: offset + 2 + length };
}

/** L14-18 `NearbyHandshake.write(out, offer)`。 */
export function writeNearbyOffer(offer: NearbyOffer): Uint8Array {
  if (!(offer.id.length >= 1 && offer.id.length <= NEARBY_ID_MAX)) {
    throw new RangeError('nearby offer id out of range');
  }
  if (offer.name.length > NEARBY_NAME_MAX) throw new RangeError('nearby offer name too long');
  const buffer = new ArrayBuffer(1 + 1 + 2 + offer.id.length * 4 + 2 + offer.name.length * 4 + 2);
  const view = new DataView(buffer);
  let offset = 0;
  view.setInt32(offset, NEARBY_MAGIC, false);
  offset += 4;
  view.setUint8(offset, NEARBY_VERSION);
  offset += 1;
  offset = writeUtf(view, offset, offer.id);
  offset = writeUtf(view, offset, offer.name);
  view.setUint8(offset, offer.sending ? 1 : 0);
  offset += 1;
  view.setUint8(offset, offer.busy ? 1 : 0);
  offset += 1;
  return new Uint8Array(buffer, 0, offset);
}

/** L19-30 `NearbyHandshake.read(input)`：魔数与版本不匹配直接抛（文案同 Kotlin）。 */
export function readNearbyOffer(bytes: Uint8Array): NearbyOffer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const magic = view.getInt32(offset, false);
  offset += 4;
  const version = view.getUint8(offset);
  offset += 1;
  if (magic !== NEARBY_MAGIC || version !== NEARBY_VERSION) {
    throw new Error('附近互传协议不兼容，请更新双方应用');
  }
  const id = readUtf(view, offset);
  offset = id.next;
  const name = readUtf(view, offset);
  offset = name.next;
  if (!(id.value.length >= 1 && id.value.length <= NEARBY_ID_MAX) || name.value.length > NEARBY_NAME_MAX) {
    throw new Error('无效附近设备信息');
  }
  const sending = view.getUint8(offset) !== 0;
  offset += 1;
  const busy = view.getUint8(offset) !== 0;
  return { id: id.value, name: name.value, sending, busy };
}

/** WebSocket 包装（**不是** `TransferConnection.kt`；真名已交还 `@core/transfer/transferConnection`）。 */
export class NearbySocketChannel {
  private closed = false;

  constructor(
    readonly address: string,
    readonly port: number,
    private readonly socket: {
      close: () => void;
      send: (data: Uint8Array) => void;
      onData: (handler: (data: Uint8Array) => void) => void;
      onClose: (handler: () => void) => void;
    },
  ) {
    socket.onClose(() => {
      this.closed = true;
    });
  }

  send(data: Uint8Array): void {
    if (this.closed) return;
    this.socket.send(data);
  }

  onData(handler: (data: Uint8Array) => void): void {
    this.socket.onData(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.close();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/** `IncomingChapterIndex.kt` L58 `unresolvedHash(body)` —— **真** SHA-256（不是自造摘要）。 */
export function unresolvedChapterHash(body: string): string {
  return `unresolved:${bodyHash(body)}`;
}

/**
 * Kotlin `MessageDigest.getInstance("SHA-256")` 的 `digest().hex()`：小写、64 位十六进制。
 * 与 `transfer/bookFingerprint.ts` 用同一个 `@noble/hashes` 实现 —— 两处必须是**同一种**摘要，
 * 否则 `IncomingChapterIndex` 落盘的 `bodyHash` 与 `BookContentFingerprint.chapterHash()` 的
 * 结果不可比。
 */
function bodyHash(body: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(body)));
}

export interface IncomingChapterRow {
  readonly bookId: number;
  readonly chapterOrder: number;
  readonly bodyHash: string;
  readonly title: string;
  readonly contentHash: string | null;
  readonly hasContent: boolean;
}

/**
 * L9-60 `IncomingChapterIndex`：磁盘版章节指纹索引（避免为每本书重扫整个归档）。
 * Web 侧保持同一张表结构与同一组判定方法，存储由调用方注入（内存 / SQLite）。
 */
export class IncomingChapterIndex {
  readonly rows: IncomingChapterRow[] = [];
  private readonly comicBooks = new Set<number>();
  /** Kotlin `private val bodyDigests`：逐章累积所需的原件（order / title / content）。 */
  private readonly chapterBodies = new Map<
    number,
    { chapterOrder: number; title: string; content: string }[]
  >();

  constructor(
    private readonly chapterHash: (content: string, contentType: string) => string | null,
    books: readonly { readonly id: number; readonly contentType: string }[] = [],
    chapters: readonly {
      readonly bookId: number;
      readonly chapterOrder: number;
      readonly title: string;
      readonly content: string;
    }[] = [],
  ) {
    for (const book of books) if (book.contentType === 'COMIC') this.comicBooks.add(book.id);
    for (const chapter of chapters) {
      const bucket = this.chapterBodies.get(chapter.bookId) ?? [];
      bucket.push(chapter);
      this.chapterBodies.set(chapter.bookId, bucket);
      const hash = this.chapterHash(chapter.content, this.comicBooks.has(chapter.bookId) ? 'COMIC' : 'NOVEL');
      this.rows.push({
        bookId: chapter.bookId,
        chapterOrder: chapter.chapterOrder,
        bodyHash: hash ?? unresolvedChapterHash(chapter.content),
        title: chapter.title,
        contentHash: hash,
        hasContent: chapter.content.trim() !== '',
      });
    }
  }

  /**
   * L35-38 `bodyIdentity(bookId, contentType)`。
   *
   * Kotlin 在 init 里**逐章**累积 `for (key in listOf("chapterOrder","title","content"))`,
   * 每段后 update 一个 0 字节；`bodyIdentity` 取该 digest 的 clone、再 update `contentType`、
   * 最后 `"body:" + digest().hex()`。所以拿不到原始 content 就无法复现 —— 端口因此保留原件。
   */
  bodyIdentity(bookId: number, contentType: string): string {
    const digest = sha256.create();
    for (const chapter of this.chapterBodies.get(bookId) ?? []) {
      for (const part of [String(chapter.chapterOrder), chapter.title, chapter.content]) {
        digest.update(new TextEncoder().encode(part));
        digest.update(new Uint8Array([0]));
      }
    }
    digest.update(new TextEncoder().encode(contentType));
    return `body:${bytesToHex(digest.digest())}`;
  }

  /**
   * L39-45 `contentIdentity(bookId, contentType)`：
   * `BookBodyFingerprint.Accumulator().add(…)…finish(contentType)`。
   *
   * ⚠️ `finish` 在「有章节摘要缺失」或「全书没有可读内容」时返回 **null** —— 端口此前
   * 写死 `content:<hash>` 且永不返回 null（E177）。
   */
  contentIdentity(bookId: number, contentType: string): string | null {
    const accumulator = new BookContentAccumulator();
    const rows = this.rows
      .filter((r) => r.bookId === bookId)
      .sort((a, b) => a.chapterOrder - b.chapterOrder);
    for (const row of rows) {
      accumulator.add(row.chapterOrder, row.title, row.contentHash, row.hasContent);
    }
    return accumulator.finish(contentType);
  }

  /** L46-54 `compatible(localRows, incomingId, localId)`：任一章节指纹冲突即不兼容。 */
  compatible(
    localRows: readonly { readonly chapterOrder: number; readonly content: string }[],
    incomingId: number,
    localId: number,
  ): boolean {
    void localId;
    const locals = new Map<number, string>();
    for (const row of localRows) {
      if (row.content.trim() === '') continue;
      const hash =
        this.chapterHash(row.content, this.comicBooks.has(incomingId) ? 'COMIC' : 'NOVEL') ??
        unresolvedChapterHash(row.content);
      locals.set(row.chapterOrder, hash);
    }
    for (const row of this.rows) {
      if (row.bookId !== incomingId || !row.hasContent) continue;
      const old = locals.get(row.chapterOrder);
      if (old !== undefined && old !== row.bodyHash) return false;
    }
    return true;
  }

  /** L55-57 `compatibleIncoming(first, second)`。 */
  compatibleIncoming(first: number, second: number): boolean {
    const byOrder = new Map<number, string>();
    for (const row of this.rows) {
      if (row.bookId !== first || !row.hasContent) continue;
      byOrder.set(row.chapterOrder, row.bodyHash);
    }
    for (const row of this.rows) {
      if (row.bookId !== second || !row.hasContent) continue;
      const other = byOrder.get(row.chapterOrder);
      if (other !== undefined && other !== row.bodyHash) return false;
    }
    return true;
  }
}

/** `ByteArray.hex()`（`TransferModels.kt` L68）：小写、两位十六进制。 */
export function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
