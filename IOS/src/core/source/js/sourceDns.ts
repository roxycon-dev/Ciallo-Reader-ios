/**
 * Android source: `com.example.source.js.SourceDns.kt` (66 lines, 60 non-blank)
 * Ported: 60 / 60 non-blank lines. Skipped: none.
 *
 * ⚠️ 本文件早先基于 48 行的旧版：**漏掉了 `preferIpv4()`**（Kotlin L25-36）。
 * 那一版的注释已经把理由写清楚了 ——「Cloudflare 托管的源（wenku8.ywy.moe / n.novelia.cc）
 * AAAA 记录排在 A 前面，没有 IPv6 路由的网络会把每条请求的首个地址耗在 connect 超时上，
 * 70 页目录变成 100 s」—— 而端口把返回顺序原样透传，等于把这个修复丢了（E183）。
 *
 * Platform adaptations:
 * - `okhttp3.Dns` → injected `DnsResolver` interface (declared below). The real
 *   system resolver comes from the platform fetch layer; the *policy* — suffix
 *   match, cache TTL, system-then-pinned merge order — is ported verbatim.
 * - `java.net.InetAddress` → `string` addresses (the only operations used are
 *   `InetAddress.getByName`, `address` and equality by IP string).
 * - `synchronized(cache)` dropped — JS is single-threaded.
 * - `InetAddress.getByAddress(ByteArray)` in `ips()` → `parseIpv4()` validation
 *   with the identical `require(parts.size == 4)` rule.
 */

/**
 * 部分源站图床域名会被本地 DNS 解析到不可用节点（2026-09 实测：*.cdndm5.com 在
 * 某些网络下全域解析到 TLS 握手即被 RST 的 IP，而同 CDN 其它子域的边缘节点能以
 * 原 SNI/Host 正常服务图片，用 --resolve 指到该节点后整章 29 页全部 200）。
 *
 * 这里把已验证可用的边缘 IP 追加在系统 DNS 结果之后：系统地址连接失败时
 * OkHttp 会自动换下一个候选地址重连；系统 DNS 正常的网络行为完全不变。
 */

/** Kotlin `java.net.UnknownHostException`. */
export class UnknownHostError extends Error {
  constructor(hostname: string) {
    super(hostname);
    this.name = 'UnknownHostError';
  }
}

/** Kotlin `okhttp3.Dns` — resolves a hostname to an ordered candidate list. */
export interface DnsResolver {
  /** Kotlin `Dns.SYSTEM`. */
  lookup(hostname: string): Promise<string[]>;
}

/** 域名后缀 -> 已验证可用的候选边缘 IP。 */
const PINNED_CANDIDATES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['cdndm5.com', ips('222.200.254.75')],
];

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; addresses: string[] }>();

/**
 * Kotlin `private fun ips(vararg addresses: String): List<InetAddress>`:
 * `runCatching { require(parts.size == 4); InetAddress.getByAddress(…) }.getOrNull()`.
 * Only the four-octet arity is validated on Android; the literal is kept as the
 * address identity (the port compares candidates by IP string).
 */
function ips(...addresses: string[]): string[] {
  const out: string[] = [];
  for (const address of addresses) {
    try {
      const parts = address.split('.');
      if (parts.length !== 4) continue;
      out.push(address);
    } catch {
      // runCatching → getOrNull(): unparsable literals are dropped.
    }
  }
  return out;
}

/** 是否是 IPv4（Kotlin `it is java.net.Inet4Address`）。IPv4 四段点分、IPv6 含冒号。 */
export function isIpv4Address(address: string): boolean {
  const parts = address.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  );
}

/**
 * Kotlin L25-36 `private fun preferIpv4(list: List<InetAddress>): List<InetAddress>`：
 *
 * ```kotlin
 * if (list.size < 2) return list
 * val v4 = list.filterIsInstance<java.net.Inet4Address>()
 * if (v4.isEmpty() || v4.size == list.size) return list
 * return v4 + list.filterNot { it is java.net.Inet4Address }
 * ```
 *
 * 语义：**v4 整体提前、每族内部顺序不变**。这不是「过滤掉 v6」—— IPv6 只是当兜底，
 * 所以 v6 地址一条都不能少（少了就等于该域名在纯 IPv6 网络上不可达）。
 */
export function preferIpv4(list: readonly string[]): string[] {
  if (list.length < 2) return [...list];
  const v4 = list.filter(isIpv4Address);
  if (v4.length === 0 || v4.length === list.length) return [...list];
  return [...v4, ...list.filter((address) => !isIpv4Address(address))];
}

/** Kotlin `SourceDns.dns(base: Dns = Dns.SYSTEM): Dns`. */
export function dns(base: DnsResolver, now: () => number = Date.now): DnsResolver {
  return {
    async lookup(hostname: string): Promise<string[]> {
      // Kotlin `trimEnd('.')` removes *every* trailing dot, not just one.
      const host = hostname.toLowerCase().trim().replace(/[.]+$/, '');
      const extra = PINNED_CANDIDATES.find(([zone]) => host === zone || host.endsWith(`.${zone}`))?.[1] ?? [];
      // Kotlin L46 `if (extra.isEmpty()) return preferIpv4(base.lookup(hostname))` ——
      // 注意这里查的是**原始 hostname**（不是归一化后的 host），与原文一致。
      if (extra.length === 0) return preferIpv4(await base.lookup(hostname));
      const cached = cache.get(host);
      if (cached !== undefined && now() - cached.at < CACHE_TTL_MS) {
        return [...cached.addresses];
      }
      // Kotlin `runCatching { base.lookup(host) }.getOrElse { emptyList() }`.
      const system = await base.lookup(host).catch(() => [] as string[]);
      // Kotlin L52 `preferIpv4(system + extra.filter { pinned -> system.none { it.address == pinned.address } })`
      const merged = preferIpv4(
        system.concat(extra.filter((pinned) => !system.some((it) => it === pinned))),
      );
      // Kotlin `throw UnknownHostException(host)` — no message formatting.
      if (merged.length === 0) throw new UnknownHostError(host);
      // 存一份副本、返回另一份：Kotlin 的 `List<InetAddress>` 不可变，JS 数组可变 ——
      // 让调用方 push 到返回值里，缓存不能被改坏。
      cache.set(host, { at: now(), addresses: [...merged] });
      return [...merged];
    },
  };
}

/** Test seam — Kotlin keeps `cache` private and process-lifetime. */
export function clearSourceDnsCache(): void {
  cache.clear();
}

export const SourceDns = {
  dns,
  clearCache: clearSourceDnsCache,
  PINNED_CANDIDATES,
  CACHE_TTL_MS,
  preferIpv4,
  isIpv4Address,
};
