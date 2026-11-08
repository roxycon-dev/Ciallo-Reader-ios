/**
 * Android source: `com.example.source.js.SourceDns.kt` (48 lines, 42 non-blank)
 * Ported: 42 / 42 non-blank lines. Skipped: none.
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

/** Kotlin `SourceDns.dns(base: Dns = Dns.SYSTEM): Dns`. */
export function dns(base: DnsResolver, now: () => number = Date.now): DnsResolver {
  return {
    async lookup(hostname: string): Promise<string[]> {
      // Kotlin `trimEnd('.')` removes *every* trailing dot, not just one.
      const host = hostname.toLowerCase().trim().replace(/[.]+$/, '');
      const extra = PINNED_CANDIDATES.find(([zone]) => host === zone || host.endsWith(`.${zone}`))?.[1] ?? [];
      if (extra.length === 0) return base.lookup(hostname);
      const cached = cache.get(host);
      if (cached !== undefined && now() - cached.at < CACHE_TTL_MS) {
        return cached.addresses;
      }
      // Kotlin `runCatching { base.lookup(host) }.getOrElse { emptyList() }`.
      const system = await base.lookup(host).catch(() => [] as string[]);
      const merged = system.concat(extra.filter((pinned) => !system.some((it) => it === pinned)));
      // Kotlin `throw UnknownHostException(host)` — no message formatting.
      if (merged.length === 0) throw new UnknownHostError(host);
      cache.set(host, { at: now(), addresses: merged });
      return merged;
    },
  };
}

/** Test seam — Kotlin keeps `cache` private and process-lifetime. */
export function clearSourceDnsCache(): void {
  cache.clear();
}

export const SourceDns = { dns, clearCache: clearSourceDnsCache, PINNED_CANDIDATES, CACHE_TTL_MS };
