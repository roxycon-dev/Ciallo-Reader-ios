/**
 * `transfer/TransferConnection.kt`（84 行 / 66 非空）→ `@core/transfer/transferConnection`。
 *
 * ⚠️ 这个文件此前在端口里**被另一个东西顶了名**：`nearby.ts` 里有个同名的
 * `class TransferConnection`，但它是「WebSocket 包装」（`send` / `onData` / `close`），
 * 与 Kotlin 的 `internal object TransferConnection`（TCP + TLS 的连接工厂）毫无关系。
 * 结果就是 `grep TransferConnection` 命中、矩阵判 `port`，而真正的
 * `connectNearby` / `acceptNearby` / `secure` / 五条中文错误一个都没有（E207）。
 *
 * 由于那个包装类**没有任何外部调用方**，本轮把它改名为 `NearbySocketChannel`，
 * 真名交还本模块。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `connectNearby(...)` 的三条拒绝 + `shouldStart && claim` | L16-33 | `connectNearbyPlan()` |
 * | `acceptNearby(...)` 的 `copy(busy = true)` 回落 | L34-47 | `acceptNearbyPlan()` |
 * | `connect(...)` 的两个 stage 与 IOException 文案 | L48-63 | `TRANSFER_STAGES` + `connectionFailureMessage()` |
 * | `accept(...)` | L65-66 | `acceptPlan()` |
 * | `secure(...)` 的 `useClientMode` / `needClientAuth` | L68-83 | `tlsModeFor()` + `TLS_SESSION_INVALID_MESSAGE` |
 *
 * 五处只有读原文才会发现的语义
 * ───────────────────────────
 * 1. **服务端必须 `needClientAuth = true`**（L74 `if (!client) tls.needClientAuth = true`）。
 *    这是「设备互传要双向证书」的落点；只在客户端设 `useClientMode` 而不设它，
 *    服务端会接受一个没有客户端证书的连接 —— 配对码核对的前提就没了。
 * 2. **`secure()` 两次检查 `tls.isClosed`**（L72 建立后、L78 握手后），都抛
 *    `连接已取消`。只有一处的话，「握手期间被取消」会以别的异常冒出来。
 * 3. **`acceptNearby` 抢锁失败不是返回 null，而是把 `busy = true` 写回去再发一次**
 *    （L41 `local = local.copy(busy = true); start = false`）——
 *    对端要能从这条回复里看到「我很忙」，否则它会一直等。
 * 4. **两个超时档不同**：Nearby 的 `connect` 是 **2000 ms**、`soTimeout` **1500 ms**；
 *    普通互传是 `connectTimeout = 4000` / `handshakeTimeout = 8000`。写成一个值，
 *    Nearby 的「附近设备不可达」要么等太久、要么早早失败。
 * 5. **三条拒绝的异常类型不同**：本机 id → `require`（`IllegalArgumentException`）、
 *    设备不符 → `SecurityException`、双方都在发 → `IllegalStateException`。
 *    统一成一种，调用方就没法分别提示。
 *
 * 平台差异
 * ────────
 * - `java.net.Socket` / `SSLSocket` / `SSLContext` / `DataInputStream` 是 JVM 的；
 *   Web 侧由 `platform/interfaces.ts` 的 socket/TLS 端口承担（iOS 走 `NWConnection` +
 *   `Security`）。本模块只产出**可判定的决策**与文案，不碰真实 socket。
 * - `InetSocketAddress(host, port)` 的解析与 DNS 归端口层。
 * - `TransferTls.configure(tls)` 已单独移植到 `@core/transfer/transferTls`。
 */

import type { NearbyOffer } from './nearby';

/** L22 `raw.connect(InetSocketAddress(route.host, route.port), 2_000)` —— Nearby 专用。 */
export const NEARBY_CONNECT_TIMEOUT_MS = 2_000;
/** L23 / L37 `raw.soTimeout = 1_500` —— 握手阶段读写的超时。 */
export const NEARBY_SO_TIMEOUT_MS = 1_500;
/** L31 / L45 `secure(..., 8_000, ...)` —— TLS 握手超时。 */
export const NEARBY_HANDSHAKE_TIMEOUT_MS = 8_000;
/** L49 `connectTimeout: Int = 4_000` —— 普通互传。 */
export const TRANSFER_CONNECT_TIMEOUT_MS = 4_000;
/** L49 `handshakeTimeout: Int = 8_000`。 */
export const TRANSFER_HANDSHAKE_TIMEOUT_MS = 8_000;

/** L26 `tr("附近连接指向了本机")`。 */
export const NEARBY_SELF_CONNECTION_MESSAGE = '附近连接指向了本机';
/** L27 `tr("附近网络中的设备与所选设备不一致")`。 */
export const NEARBY_DEVICE_MISMATCH_MESSAGE = '附近网络中的设备与所选设备不一致';
/** L28 `tr("双方都选择了发送，请让一台设备选择接收")`。 */
export const NEARBY_BOTH_SENDING_MESSAGE = '双方都选择了发送，请让一台设备选择接收';
/** L53 / L56 两个 stage 文案。 */
export const TRANSFER_STAGE_CONNECTING = '正在连接设备';
export const TRANSFER_STAGE_SECURING = '正在建立加密连接';
/** L72 / L78 `tr("连接已取消")`。 */
export const TRANSFER_CANCELLED_MESSAGE = '连接已取消';
/** L80 `tr("加密握手未完成或已取消")`。 */
export const TLS_SESSION_INVALID_MESSAGE = '加密握手未完成或已取消';

/** `NearbyHandshake.shouldStart(local, remote)` 的入参（`NearbyHandshake.kt`）。 */
export type NearbyStart = { readonly sending: boolean; readonly busy: boolean };

/** L16-33 的拒绝原因（`null` = 通过）。 */
export type NearbyRejection =
  | { readonly kind: 'self'; readonly message: string }
  | { readonly kind: 'mismatch'; readonly message: string }
  | { readonly kind: 'bothSending'; readonly message: string };

/**
 * L26-28 的三条拒绝，**顺序即优先级**（本机 → 设备不符 → 双方都在发）。
 *
 * 三种异常类型分别是 `IllegalArgumentException`（`require`）/ `SecurityException` /
 * `IllegalStateException`；调用方要能分别提示，所以这里带 `kind`。
 */
export function nearbyRejection(
  local: NearbyStart & { readonly id: string },
  remote: NearbyStart & { readonly id: string },
  expectedId: string | null,
): NearbyRejection | null {
  // L26 `require(remote.id != local.id) { tr("附近连接指向了本机") }`
  if (remote.id === local.id) return { kind: 'self', message: NEARBY_SELF_CONNECTION_MESSAGE };
  // L27 `if (expectedId != null && remote.id != expectedId) throw SecurityException(...)`
  if (expectedId !== null && remote.id !== expectedId) {
    return { kind: 'mismatch', message: NEARBY_DEVICE_MISMATCH_MESSAGE };
  }
  // L28 `if (local.sending && remote.sending && !remote.busy) throw IllegalStateException(...)`
  if (local.sending && remote.sending && !remote.busy) {
    return { kind: 'bothSending', message: NEARBY_BOTH_SENDING_MESSAGE };
  }
  return null;
}

export interface ConnectNearbyPlan {
  /** L29 `!NearbyHandshake.shouldStart(local, remote) || !claim()` → `close(); return null`。 */
  readonly proceed: boolean;
  /** L30 `track(raw)` —— 只在确定要继续时才登记（取消时要能找到它）。 */
  readonly track: boolean;
  /** L31 的 TLS 侧参数。 */
  readonly client: boolean;
  readonly handshakeTimeoutMs: number;
}

/**
 * L29-31：`shouldStart` 为假**或**抢锁失败 → 关掉 socket 返回 null（不抛）。
 *
 * `shouldStart` 由 `NearbyHandshake` 决定（它看双方的 `sending` / `busy`），
 * 本函数只负责「两条路径都要先 claim 再 track」这个顺序。
 */
export function connectNearbyPlan(shouldStart: boolean, claimed: boolean): ConnectNearbyPlan {
  const proceed = shouldStart && claimed;
  return {
    proceed,
    track: proceed,
    client: true,
    handshakeTimeoutMs: NEARBY_HANDSHAKE_TIMEOUT_MS,
  };
}

export interface AcceptNearbyPlan {
  /** 写给对端的那份 offer（抢锁失败时 `busy = true`）。 */
  readonly local: NearbyOffer;
  readonly start: boolean;
  readonly proceed: boolean;
  readonly client: boolean;
  readonly handshakeTimeoutMs: number;
}

/**
 * L39-45：`offer(remote)` → `shouldStart` → **抢锁失败则改成本地 busy 并放弃**，
 * 但那份改过的 offer 仍然要写回给对端（这样它才知道「我忙」）。
 */
export function acceptNearbyPlan(
  offered: NearbyOffer,
  shouldStart: boolean,
  claimed: boolean,
): AcceptNearbyPlan {
  const start = shouldStart && claimed;
  const local = start || !shouldStart ? offered : { ...offered, busy: true };
  return {
    local,
    start,
    proceed: start,
    client: false,
    handshakeTimeoutMs: NEARBY_HANDSHAKE_TIMEOUT_MS,
  };
}

/**
 * L58-62 的 `IOException` 文案：
 * ```
 * if (e is IOException) throw IOException(
 *     if (raw.isConnected) "设备已连接，但加密握手失败：${e.message}" else "无法连接设备：${e.message}", e)
 * ```
 *
 * 判据是 **`raw.isConnected`**：连上了但握手挂了 → 前者；压根没连上 → 后者。
 * 用异常类型或阶段字符串来判断都会错（`connect` 成功后 `stage` 已经变了，
 * 但 `isConnected` 才是 Kotlin 看的东西）。
 */
export function connectionFailureMessage(rawConnected: boolean, cause: string | null): string {
  const detail = cause ?? '';
  return rawConnected
    ? `设备已连接，但加密握手失败：${detail}`
    : `无法连接设备：${detail}`;
}

/** L73-74 的 TLS 模式。 */
export interface TlsMode {
  readonly useClientMode: boolean;
  /** L74 `if (!client) tls.needClientAuth = true` —— 服务端必须校验客户端证书。 */
  readonly needClientAuth: boolean;
}

export function tlsModeFor(client: boolean): TlsMode {
  return { useClientMode: client, needClientAuth: !client };
}

/** L79 的 session 判据：`!isValid || protocol == "NONE"` 都算握手没完成。 */
export function tlsSessionInvalid(session: { readonly isValid: boolean; readonly protocol: string }): boolean {
  return !session.isValid || session.protocol === 'NONE';
}

/**
 * L68-83 `secure()` 的四道检查，按顺序产出失败文案（`null` = 通过）。
 *
 * `closedBeforeHandshake` 与 `closedAfterHandshake` 是**两处**独立的检查（L72 / L78），
 * 中间隔着 `startHandshake()` —— 合并成一处会漏掉「握手期间被取消」。
 */
export function secureChecks(input: {
  readonly closedBeforeHandshake: boolean;
  readonly closedAfterHandshake: boolean;
  readonly session: { readonly isValid: boolean; readonly protocol: string } | null;
}): string | null {
  if (input.closedBeforeHandshake) return TRANSFER_CANCELLED_MESSAGE;
  if (input.closedAfterHandshake) return TRANSFER_CANCELLED_MESSAGE;
  if (input.session === null) return TRANSFER_CANCELLED_MESSAGE;
  if (tlsSessionInvalid(input.session)) return TLS_SESSION_INVALID_MESSAGE;
  return null;
}

/** L16-33 的四个阶段，供宿主按序执行（每步失败都要 `close()` 掉 raw）。 */
export const CONNECT_NEARBY_STEPS = [
  'trackProbe',
  'bindLocalAddress',
  'connect',
  'soTimeout',
  'writeLocalOffer',
  'readRemoteOffer',
  'validate',
  'claim',
  'track',
  'secure',
] as const;
