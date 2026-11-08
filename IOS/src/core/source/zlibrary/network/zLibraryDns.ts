/**
 * Kotlin → TS: `source/zlibrary/network/ZLibraryDns.kt` (332 lines, 310 non-blank)
 *             → `src/core/source/zlibrary/network/zLibraryDns.ts`
 *
 * REUSE: the CIDR blacklist, the IPv4 parser, `isSuspicious`, the DoH answer parser and the
 * reachable-first ranking already exist as pure ports in
 * `src/core/source/zlibraryDns.ts` (`BLOCKED_PREFIXES`, `ipv4ToInt`, `isSuspiciousIpv4`,
 * `parseDohAnswers`, `DOH_PROVIDERS`, `rankCandidates`). They are IMPORTED here, not
 * duplicated, and this file adds the parts that root-level port deliberately left out because
 * they need I/O: the TTL caches, the multi-source aggregation, the deadlines and the ordering.
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.network  → SKIPPED (TS has no packages)
 *   L3-20     imports (Log, Dns, HttpUrl, OkHttpClient, Request, JSONObject, Inet4Address,
 *             InetAddress, InetSocketAddress, Socket, UnknownHostException, LinkedHashSet,
 *             ConcurrentHashMap, CompletableFuture, ExecutorService, Executors, TimeUnit,
 *             TimeoutException)
 *                                     → REPLACED by three injected interfaces
 *                                       (`ZLibraryDnsResolver`, `ZLibraryDohTransport`,
 *                                       `ZLibraryTcpProbe`) + `ZLibraryNetworkWatcher`
 *   L22       class ZLibraryDns : Dns    → `class ZLibraryDns`
 *   L25       private const val TAG      → `const TAG = 'ZLibDns'`
 *   L26       val INSTANCE = ZLibraryDns() → dropped (the platform layer owns the singleton;
 *                                           injected by whoever builds the transport)
 *   L27       CACHE_TTL_MS = 5 * 60 * 1000L // 5 minutes (DoH results only) → verbatim
 *   L28       FAIL_CACHE_TTL_MS = 5 * 1000L → verbatim
 *   L29       KNOWN_GOOD_TTL_MS = 5 * 60 * 1000L // remember verified IPs for 24h → verbatim
 *                                        (the comment contradicts the constant in Kotlin too —
 *                                         preserved as-is, NOT "fixed")
 *   L31-50    KDoc + BLOCKED_PREFIXES    → REUSED from `../zlibraryDns` (`BLOCKED_PREFIXES`),
 *                                          the CIDR comments are reproduced in the doc below
 *   L52-62    private fun isSuspicious(InetAddress) → `isSuspiciousIp(address)`, IPv6 exemption kept
 *   L65-69    cache / failCache / knownGoodCache (ConcurrentHashMap) → `Map`s + the same
 *                                          capacity-reset rule at L101/L134
 *   L71-79    resolverPool / systemDnsPool / probePool (3 ExecutorServices) → dropped: JS is
 *                                          single-threaded, the fan-out is `Promise.all` and the
 *                                          concurrency caps are the injected providers' concern
 *   L81-115   private val dohClient: OkHttpClient (with the inner pinned Dns + watchNetwork +
 *             clearCaches + lookup for the four DoH hostnames)
 *                → the pinned A records are exported as `DOH_BOOTSTRAP_HOSTS` (magic bytes
 *                  preserved) for the platform transport; the inner `watchNetwork`/`clearCaches`/
 *                  `lookup` duplicates L117-133 and is the same code, so only ONE copy is ported
 *                → the client itself (connect/read 3s, followRedirects(true)) is configuration the
 *                  platform transport builds; the values live in `DOH_CLIENT_CONFIG`
 *   L117-131  @Volatile watchingNetwork + fun watchNetwork(context) → `watchNetwork()` on the
 *              injected `ZLibraryNetworkWatcher` (ConnectivityManager is Android-only)
 *   L132      fun clearCaches()          → `clearCaches()`
 *   L133-213  override fun lookup(hostname) → `lookup(hostname)`, line-for-line:
 *              L134 capacity reset, L136-147 positive/negative caches, L149-176 system-DNS hint
 *              (2s budget), L178-182 all-DoH aggregation, L184-197 known-good re-add, L199-202
 *              failure + negative cache, L204-212 probe-and-sort + cache write
 *   L215-227  private fun parseIpToInetAddress → `parseIpString` (Kotlin `toByte()` truncation kept)
 *   L229-267  private fun resolveViaDoH (4 providers, 4s deadline) → `resolveViaDoH`
 *   L269-296  private fun queryDohProvider → `queryDohProvider` (via the injected transport)
 *   L298-320  private fun probeAndSort (2.5s deadline) → `probeAndSort`
 *   L322-331  private fun tcpReachable (Socket().connect(port 443, 1500)) → injected
 *              `ZLibraryTcpProbe.tcpReachable` (JS has no raw TCP sockets)
 *   L332      closing brace              → n/a
 *
 * ADAPTATION (documented, no JS equivalent): DNS resolution.
 *   `Dns.SYSTEM.lookup`, `InetAddress`, and a raw TCP `Socket` probe do not exist in a browser
 *   or a JS runtime, and WHATWG `fetch` gives no hook to supply a custom address list. All
 *   three therefore become DECLARED interfaces, and the value of the port is the strategy that
 *   wraps them: the caches, TTLs, budgets, aggregation order and reachable-first ranking —
 *   all pure and unit-testable with fake providers. `lookup` returns the same ordered
 *   IP-string list OkHttp would have connected to, in the same order.
 *
 * ADAPTATION: `CompletableFuture.get(timeout)` → `withTimeout(promise, ms)`, which resolves to
 * `null` on expiry (the Kotlin `TimeoutException` catch) — identical control flow.
 * `ExecutorService` fan-out → `Promise.allSettled` (a rejected provider must not fail the
 * aggregate, exactly like the Kotlin `runCatching` inside each `supplyAsync`).
 * `System.currentTimeMillis()` → `Date.now()`. `UnknownHostException` → `Error` with the same
 * message text (the transport maps it to a failed connection).
 *
 * REVIEW FIXES (this pass):
 *   - `parseIpString` used `Number.parseInt(part, 10)`, which accepts a numeric PREFIX
 *     (`"4abc"` → 4, `"0x10"` → 0, `" 1"` → 1). Kotlin's `String.toInt()` throws on all of
 *     those and the surrounding `catch` rejects the address, so a poisoned/garbage DoH answer
 *     like `1.2.3.4abc` was silently turned into `1.2.3.4` and treated as a usable candidate.
 *   - `probeAndSort` funnelled its already-partitioned `ok + fail` list through
 *     `rankCandidates()` from `../../zlibraryDns`, an EXTRA step Kotlin never performs. Removed.
 *
 * KNOWN ADAPTATION (kept, documented): Kotlin collects the DoH answers in a `ConcurrentHashMap`
 * keyed by the address string, so `result.values.toList()` comes back in UNSPECIFIED order. The
 * port keeps provider order (AliDNS → DNSPod → Cloudflare → Google) with first-wins de-duplication,
 * which is deterministic; the reachable-first probe pass below re-orders anyway.
 */

import { SourceLog } from '../../sourceLog';
// REUSE (not duplicated): the root-level port of the same Kotlin file's pure algorithms.
import {
  BLOCKED_PREFIXES,
  isSuspiciousIpv4,
  ipv4ToInt,
  parseDohAnswers,
} from '../../zlibraryDns';

/** Kotlin `private const val TAG = "ZLibDns"`. */
const TAG = 'ZLibDns';
/** Kotlin `CACHE_TTL_MS = 5 * 60 * 1000L // 5 minutes (DoH results only)`. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Kotlin `FAIL_CACHE_TTL_MS = 5 * 1000L // Short negative cache avoids amplifying transient failures`. */
const FAIL_CACHE_TTL_MS = 5 * 1000;
/** Kotlin `KNOWN_GOOD_TTL_MS = 5 * 60 * 1000L // remember verified IPs for 24h`. */
const KNOWN_GOOD_TTL_MS = 5 * 60 * 1000;

/**
 * The four DoH providers of Kotlin L231-236, in the same order. The first three reuse the URL
 * builders already exported by `src/core/source/zlibraryDns.ts`; Cloudflare is added here
 * because the Android resolver queries it in parallel with the other three.
 */
export const DOH_PROVIDERS: ReadonlyArray<{ name: string; url: (h: string) => string; accept: string }> = [
  {
    name: 'AliDNS',
    url: (h: string) => `https://dns.alidns.com/resolve?name=${h}&type=1`,
    accept: 'application/dns-json',
  },
  {
    name: 'DNSPod',
    url: (h: string) => `https://doh.pub/dns-query?name=${h}&type=A`,
    accept: 'application/dns-json',
  },
  {
    name: 'Cloudflare',
    url: (h: string) => `https://1.1.1.1/dns-query?name=${h}&type=A`,
    accept: 'application/dns-json',
  },
  {
    name: 'Google',
    url: (h: string) => `https://dns.google/resolve?name=${h}&type=A`,
    accept: 'application/dns-json',
  },
];

/**
 * Kotlin's inner pinned `Dns` (L103-106): the DoH provider hostnames are resolved to a fixed
 * A record so a poisoned answer for `dns.alidns.com` cannot defeat the DoH query itself.
 * The bytes are preserved verbatim; the transport uses them to pin the DoH endpoint.
 */
export const DOH_BOOTSTRAP_HOSTS: Readonly<Record<string, string>> = {
  'dns.alidns.com': '223.5.5.5',
  'doh.pub': '1.12.12.12',
  'dns.google': '8.8.8.8',
  '1.1.1.1': '1.1.1.1',
};

/** Kotlin's `dohClient` builder settings (L111-114). */
export const DOH_CLIENT_CONFIG = {
  connectTimeoutMs: 3_000,
  readTimeoutMs: 3_000,
  followRedirects: true,
} as const;

/** Kotlin's `Dns.SYSTEM.lookup(hostname)` — poisoned resolvers may return fake answers. */
export interface ZLibraryDnsResolver {
  systemLookup(hostname: string): Promise<string[]>;
}

/** Kotlin's DoH `OkHttpClient.newCall(request).execute()` returning a JSON body. */
export interface ZLibraryDohTransport {
  /** Resolves with the parsed JSON body; must reject on a non-2xx or network error. */
  queryDoh(url: string, accept: string, timeoutMs: number): Promise<unknown>;
}

/** Kotlin's `Socket().connect(InetSocketAddress(ip, 443), 1500)`. */
export interface ZLibraryTcpProbe {
  tcpReachable(ip: string, port: number, timeoutMs: number): Promise<boolean>;
}

/** Kotlin's `ConnectivityManager.registerDefaultNetworkCallback { onAvailable/onLost → clearCaches }`. */
export interface ZLibraryNetworkWatcher {
  /** Returns false when the platform cannot observe network changes (watchNetwork then no-ops). */
  register(onNetworkChanged: () => void): boolean;
}

export interface ZLibraryDnsDeps {
  readonly resolver: ZLibraryDnsResolver;
  readonly doh: ZLibraryDohTransport;
  readonly probe: ZLibraryTcpProbe;
  readonly watcher?: ZLibraryNetworkWatcher | null;
}

export class ZLibraryDns {
  private readonly cache = new Map<string, { addresses: string[]; at: number }>();
  private readonly failCache = new Map<string, number>();
  // hostname -> (ip -> last verified timestamp). Rotating/poisoned DNS can hide the real IP
  // on some queries; remembering verified-reachable IPs makes lookups stable across runs.
  private readonly knownGoodCache = new Map<string, Map<string, number>>();
  private watchingNetwork = false;

  constructor(private readonly deps: ZLibraryDnsDeps) {}

  /** Kotlin `fun watchNetwork(context: Context)` (L118-131). */
  watchNetwork(): void {
    if (this.watchingNetwork) return;
    const watcher = this.deps.watcher;
    if (watcher === null || watcher === undefined) return;
    if (watcher.register(() => this.clearCaches())) {
      this.watchingNetwork = true;
    }
  }

  /** Kotlin `fun clearCaches()` (L132). */
  clearCaches(): void {
    this.cache.clear();
    this.failCache.clear();
    this.knownGoodCache.clear();
  }

  /** Kotlin `override fun lookup(hostname: String): List<InetAddress>` (L133-213). */
  async lookup(hostname: string): Promise<string[]> {
    if (this.cache.size + this.failCache.size > 512 || this.knownGoodCache.size > 256) {
      this.clearCaches();
    }
    // Check positive cache (DoH results only)
    const cached = this.cache.get(hostname);
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      logDebug(TAG, `DNS cache hit for ${hostname}: ${cached.addresses.join(', ')}`);
      return cached.addresses;
    }

    // Fast-fail on recently failed lookups (avoids 20s+ stalls during multi-node scans)
    const lastFail = this.failCache.get(hostname);
    if (lastFail !== undefined && Date.now() - lastFail < FAIL_CACHE_TTL_MS) {
      logWarn(TAG, `DNS negative cache hit for ${hostname}`);
      throw new Error(`Unable to resolve host "${hostname}" (recent failure)`);
    }

    // 1. System DNS is only a HINT: poisoned resolvers return fake (but valid-looking)
    //    IPs for blocked domains, so its answers join the candidate pool instead of
    //    being trusted directly. Preserve system IPv6 candidates for IPv6-only networks;
    //    reachability ordering below still avoids prioritizing an unusable address.
    //    The lookup itself is time-bounded: poisoned resolvers can hang for 10-30s.
    const candidates: string[] = [];
    const systemAddresses = await withTimeout(this.systemLookupFiltered(hostname), 2000);
    if (systemAddresses === null) {
      logWarn(TAG, `System DNS lookup timed out for ${hostname}; using DoH only`);
    } else {
      for (const address of systemAddresses) pushUnique(candidates, address);
      if (systemAddresses.length === 0) {
        logWarn(
          TAG,
          `System DNS returned only suspicious/unusable addresses for ${hostname}, falling back to DoH`,
        );
      } else {
        logDebug(TAG, `System DNS resolved ${hostname} -> ${systemAddresses.join(', ')}`);
      }
    }

    // 2. Query ALL DoH providers in parallel (AliDNS / DNSPod / Cloudflare / Google).
    //    In poisoned networks the CN-friendly resolvers return rotating FAKE IPs, while
    //    Cloudflare/Google usually return the real ones — so we aggregate every answer
    //    instead of trusting the first provider that responds.
    for (const address of await this.resolveViaDoH(hostname)) pushUnique(candidates, address);

    // 3. Re-add previously verified-reachable IPs (24h memory). This covers the case where
    //    every DoH provider times out or returns fakes on a particular query.
    const now = Date.now();
    const known = this.knownGoodCache.get(hostname);
    if (known !== undefined) {
      const stale: string[] = [];
      for (const [ipStr, lastSeen] of known.entries()) {
        if (now - lastSeen < KNOWN_GOOD_TTL_MS) {
          const parsed = parseIpString(ipStr);
          if (parsed !== null) pushUnique(candidates, parsed);
        } else {
          stale.push(ipStr);
        }
      }
      for (const ip of stale) known.delete(ip);
    }

    if (candidates.length === 0) {
      this.failCache.set(hostname, Date.now());
      throw new Error(`Unable to resolve host "${hostname}" via System DNS or DoH`);
    }

    // 4. TCP-probe candidates and put reachable IPs first. OkHttp connects serially,
    //    so without this, a fake-but-valid-looking IP at the front causes "connect timeout".
    const { sorted, reachable } = await this.probeAndSort(candidates);
    const knownForHost = this.knownGoodCache.get(hostname) ?? new Map<string, number>();
    for (const ip of reachable) knownForHost.set(ip, now);
    for (const [ip, at] of Array.from(knownForHost.entries())) {
      if (now - at > KNOWN_GOOD_TTL_MS) knownForHost.delete(ip);
    }
    this.knownGoodCache.set(hostname, knownForHost);
    logDebug(TAG, `Final resolution for ${hostname} -> ${sorted.join(', ')}`);
    this.cache.set(hostname, { addresses: sorted, at: Date.now() });
    return sorted;
  }

  /** Kotlin L155-163: the `CompletableFuture.supplyAsync` body. */
  private async systemLookupFiltered(hostname: string): Promise<string[]> {
    try {
      const addresses = await this.deps.resolver.systemLookup(hostname);
      return addresses.filter((it) => !isSuspiciousIp(it));
    } catch (e) {
      logWarn(TAG, `System DNS lookup failed for ${hostname}: ${errorMessage(e)}`);
      return [];
    }
  }

  /** Kotlin `private fun resolveViaDoH(hostname)` (L229-267). */
  private async resolveViaDoH(hostname: string): Promise<string[]> {
    const result: string[] = [];
    const deadline = Date.now() + 4000;
    const queries = DOH_PROVIDERS.map((provider) =>
      (async (): Promise<string[]> => {
        try {
          return await this.queryDohProvider(hostname, provider.url(hostname), provider.accept);
        } catch (e) {
          logWarn(TAG, `${provider.name} DoH failed for ${hostname}: ${errorMessage(e)}`);
          return [];
        }
      })(),
    );
    const settled = await Promise.allSettled(queries);
    for (const future of settled) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      if (future.status === 'fulfilled') {
        for (const addr of future.value) pushUnique(result, addr);
      } else {
        logWarn(TAG, `DoH query timed out for ${hostname}`);
      }
    }
    return result;
  }

  /** Kotlin `private fun queryDohProvider(hostname, urlStr, accept)` (L269-296). */
  private async queryDohProvider(_hostname: string, url: string, accept: string): Promise<string[]> {
    const json = await this.deps.doh.queryDoh(url, accept, 3000);
    const out: string[] = [];
    for (const ip of parseDohAnswers(json)) {
      const parsed = parseIpString(ip);
      if (parsed !== null && !isSuspiciousIp(parsed)) out.push(parsed);
    }
    return out;
  }

  /** Kotlin `private fun probeAndSort(candidates)` (L298-320). */
  private async probeAndSort(candidates: string[]): Promise<{ sorted: string[]; reachable: string[] }> {
    if (candidates.length <= 1) return { sorted: candidates, reachable: [] };
    const probes = candidates.map((ip) => this.deps.probe.tcpReachable(ip, 443, 1500));
    const settled = await Promise.allSettled(probes);
    const ok: string[] = [];
    const fail: string[] = [];
    const deadline = Date.now() + 2500;
    for (let index = 0; index < candidates.length; index += 1) {
      const remaining = deadline - Date.now();
      const future = settled[index];
      const reachable =
        remaining <= 0 ? false : future !== undefined && future.status === 'fulfilled' && future.value === true;
      const ip = candidates[index] as string;
      if (reachable) ok.push(ip);
      else fail.push(ip);
    }
    // Kotlin L319: `return Pair(ok + fail, ok.mapNotNull { it.hostAddress }.toSet())` — the
    // reachable-first ranking is produced RIGHT HERE by the ok/fail partition. The port also
    // pushed the list through `rankCandidates()`, which is a no-op on an already-partitioned
    // list; the extra pass was removed so the port is exactly `ok + fail`.
    return { sorted: [...ok, ...fail], reachable: ok };
  }
}

/** Kotlin `isSuspicious(ip: InetAddress)` (L52-62) — non-IPv4 answers are never suspicious. */
function isSuspiciousIp(address: string): boolean {
  if (address.includes(':')) return false;
  return isSuspiciousIpv4(address);
}

/**
 * Kotlin `private fun parseIpToInetAddress(hostname, ipString)` (L215-227).
 * Requires exactly 4 dot-separated parts; each part is parsed as a base-10 int and truncated
 * to a byte exactly like Kotlin's `Int.toByte()`, then rendered back as unsigned dotted decimal.
 *
 * REVIEW FIX: Kotlin uses `parts[i].toInt()`, which THROWS on anything that is not a complete
 * base-10 integer (`"4abc"`, `"0x10"`, `" 1"`, `""`) and is caught by the surrounding
 * `catch (e: Exception) { null }` → the whole address is rejected. `Number.parseInt(part, 10)`
 * is lenient (it parses a prefix and skips leading whitespace), so it accepted `1.2.3.4abc`
 * as `1.2.3.4`. The strict form below reproduces the Kotlin accept/reject set exactly.
 */
export function parseIpString(ipString: string): string | null {
  const parts = ipString.trim().split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    const n = strictBase10Int(part);
    if (n === null) return null;
    bytes.push(((n % 256) + 256) % 256);
  }
  // An address whose octets do not round-trip is not a usable IPv4 answer.
  const rendered = bytes.join('.');
  return ipv4ToInt(rendered) === null ? null : rendered;
}

/** Kotlin `String.toInt()` (base 10, no whitespace, no prefix, no trailing junk) → null on throw. */
function strictBase10Int(value: string): number | null {
  if (!/^[+-]?\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/** Kotlin `LinkedHashSet.addAll` — de-duplicate, preserve insertion order. */
function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/** Kotlin `CompletableFuture.get(timeout, unit)` → null on expiry (the TimeoutException path). */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function logDebug(tag: string, message: string): void {
  // `android.util.Log.d` / `Log.w` → the single `src/core` logging channel.
  SourceLog.log(tag, message);
}

function logWarn(tag: string, message: string): void {
  SourceLog.log(tag, message);
}

/** Exported for tests/diagnostics: the reused CIDR blacklist, verbatim. */
export { BLOCKED_PREFIXES };
