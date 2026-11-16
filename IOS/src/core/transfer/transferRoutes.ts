/**
 * `transfer/TransferRoutes.kt`（17 行）→ `src/core/transfer/transferRoutes.ts`
 *
 * 逐行对照：
 *   L3-12  `mergePeer(old, fresh): TransferPeer`   → `mergePeer`
 *   L14-17 `connectionRoutes(peer): List<TransferRoute>` → `connectionRoutes`
 *
 * 依赖的两个数据类来自 `transfer/TransferModels.kt` L42-43（不在本文件的行映射内，
 * 但字段与默认值必须逐个对齐，否则 copy 语义会漂）：
 *   ```kotlin
 *   data class TransferRoute(val host:String, val port:Int, val networkHandle:Long?=null,
 *                            val localAddress:String?=null, val nearby:Boolean=false)
 *   data class TransferPeer(val id: String, val name: String, val host: String? = null,
 *       val port: Int = 0, val p2pAddress: String? = null, val protocol: Int = 1,
 *       val routes: List<TransferRoute> = emptyList(), val directPort: Int? = null,
 *       val nearbyProtocol: Int = 0)
 *   ```
 *
 * 命名说明：`transferSession.ts` 已有一个**传输线协议层**的 `TransferPeer { id, name }`
 * （只用于配对/续传身份校验）。本文件声明的 `TransferPeer` 是**发现层**的完整形状，
 * 结构上是它的超集，因此可以直接喂给 `transferSession` 的入参（结构化子类型），
 * 而不需要任何转换。
 */

import type { TransferPeer as WireTransferPeer } from './transferSession';

/** Kotlin `data class TransferRoute`（TransferModels.kt L42）。 */
export interface TransferRoute {
  readonly host: string;
  readonly port: number;
  /** Kotlin `networkHandle: Long?` —— Android `Network.networkHandle`，Web 侧为 null。 */
  readonly networkHandle: number | null;
  /** Kotlin `localAddress: String?` —— 该路由上本机的局域网地址。 */
  readonly localAddress: string | null;
  /** Kotlin `nearby: Boolean` —— 是否「附近直连」通道（非同一 Wi-Fi）。 */
  readonly nearby: boolean;
}

/** Kotlin 默认参数构造 `TransferRoute(host, port)`。 */
export function createTransferRoute(
  host: string,
  port: number,
  networkHandle: number | null = null,
  localAddress: string | null = null,
  nearby = false,
): TransferRoute {
  return { host, port, networkHandle, localAddress, nearby };
}

/** Kotlin `data class TransferPeer`（TransferModels.kt L43-44）。 */
export interface TransferPeer extends WireTransferPeer {
  readonly host: string | null;
  readonly port: number;
  readonly p2pAddress: string | null;
  readonly protocol: number;
  readonly routes: TransferRoute[];
  readonly directPort: number | null;
  readonly nearbyProtocol: number;
}

/** Kotlin data-class 默认值（`host = null, port = 0, p2pAddress = null, protocol = 1, …`）。 */
export function createTransferPeer(
  partial: Partial<TransferPeer> & Pick<TransferPeer, 'id' | 'name'>,
): TransferPeer {
  return {
    id: partial.id,
    name: partial.name,
    host: partial.host ?? null,
    port: partial.port ?? 0,
    p2pAddress: partial.p2pAddress ?? null,
    protocol: partial.protocol ?? 1,
    routes: partial.routes ?? [],
    directPort: partial.directPort ?? null,
    nearbyProtocol: partial.nearbyProtocol ?? 0,
  };
}

/** Kotlin `.take(8)` —— 一个 peer 最多记 8 条路由。 */
export const MAX_PEER_ROUTES = 8;

/** Kotlin `.take(4)` —— 一次连接最多试 4 条路由。 */
export const MAX_CONNECTION_ROUTES = 4;

/** Kotlin data-class `equals`（5 个字段全参与），替代 `distinct()` 的判等。 */
function sameRoute(a: TransferRoute, b: TransferRoute): boolean {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.networkHandle === b.networkHandle &&
    a.localAddress === b.localAddress &&
    a.nearby === b.nearby
  );
}

/**
 * Kotlin `mergePeer`（L3-12）：把一次新发现合并进旧记录。
 *
 * ```
 * val networks = fresh.routes.map { it.networkHandle }.toSet()
 * val routes = (fresh.routes + old?.routes.orEmpty().filterNot { it.networkHandle in networks })
 *     .distinct().take(8)
 * return fresh.copy(host = fresh.host ?: old?.host,
 *     port = if (fresh.host != null) fresh.port else old?.takeIf { it.host != null }?.port ?: fresh.port,
 *     p2pAddress = fresh.p2pAddress ?: old?.p2pAddress,
 *     directPort = fresh.directPort ?: old?.directPort, routes = routes,
 *     nearbyProtocol = if (fresh.p2pAddress != null) fresh.nearbyProtocol
 *                      else old?.nearbyProtocol ?: fresh.nearbyProtocol)
 * ```
 *
 * 语义：**新发现优先**；旧路由里凡是「同一网络（其实是同一 networkHandle）」的都丢掉，
 * 因为同一张网卡的老地址必然已经过期；最后按插入序去重、截断到 8 条。
 */
export function mergePeer(old: TransferPeer | null, fresh: TransferPeer): TransferPeer {
  const networks = new Set<number | null>(fresh.routes.map((it) => it.networkHandle));
  const carried = (old?.routes ?? []).filter((it) => !networks.has(it.networkHandle));

  const routes: TransferRoute[] = [];
  for (const route of [...fresh.routes, ...carried]) {
    if (!routes.some((existing) => sameRoute(existing, route))) routes.push(route);
  }

  const host = fresh.host ?? old?.host ?? null;
  const port = fresh.host !== null ? fresh.port : old !== null && old.host !== null ? old.port : fresh.port;

  return {
    id: fresh.id,
    name: fresh.name,
    host,
    port,
    p2pAddress: fresh.p2pAddress ?? old?.p2pAddress ?? null,
    protocol: fresh.protocol,
    routes: routes.slice(0, MAX_PEER_ROUTES),
    directPort: fresh.directPort ?? old?.directPort ?? null,
    nearbyProtocol:
      fresh.p2pAddress !== null ? fresh.nearbyProtocol : (old?.nearbyProtocol ?? fresh.nearbyProtocol),
  };
}

/**
 * Kotlin `connectionRoutes`（L14-17）：
 * ```
 * (peer.routes + listOfNotNull(peer.host?.let { TransferRoute(it, peer.port) }))
 *     .filter { it.port in 1..65535 }
 *     .distinctBy { it.host to it.port }
 *     .sortedBy { if (it.host.contains(':')) 1 else 0 }
 *     .take(4)
 * ```
 *
 * 先按 `(host, port)` 去重（与 `listOfNotNull` 补进来的那条主路由合并），再把
 * **IPv6 字面量排到后面**（`contains(':')`；v4 与域名在前，因为 v6 更容易不可达），
 * 最后截到 4 条。`sortedBy` 是稳定排序，`Array#sort` 在现代引擎里同样是稳定的。
 */
export function connectionRoutes(peer: TransferPeer): TransferRoute[] {
  const all: TransferRoute[] = [...peer.routes];
  if (peer.host !== null) all.push(createTransferRoute(peer.host, peer.port));

  const unique: TransferRoute[] = [];
  for (const route of all) {
    if (route.port < 1 || route.port > 65535) continue;
    if (unique.some((it) => it.host === route.host && it.port === route.port)) continue;
    unique.push(route);
  }

  const rank = (route: TransferRoute): number => (route.host.includes(':') ? 1 : 0);
  unique.sort((a, b) => rank(a) - rank(b));
  return unique.slice(0, MAX_CONNECTION_ROUTES);
}
