/**
 * Android source: `com.example.source.NetworkCalls.kt`
 *
 * OkHttp Call/ConnectionPool/Dispatcher → fetch + AbortController:
 * - `Call.executeCancellable` / `executeWithCancellation(job)` — parent
 *   cancellation aborts the in-flight request (including mid-body reads);
 *   body stream close/cancel disposes the cancellation hook.
 * - `SharedHttpTransport` — fetch reuses per-origin sockets automatically;
 *   per-source TLS/cookies stay in the platform network layer.
 * - `SourceNetworkPolicy` — SSRF guards, ported with IP-string parsing
 *   (no synchronous DNS in JS; IPv6 literals checked directly).
 */

export interface SharedHttpTransportLimits {
  /** OkHttp Dispatcher.maxRequests */
  readonly maxRequests: number;
  /** OkHttp Dispatcher.maxRequestsPerHost */
  readonly maxRequestsPerHost: number;
  /** OkHttp ConnectionPool maxIdleConnections */
  readonly connectionPoolSize: number;
  /** OkHttp ConnectionPool keepAliveDuration (minutes) */
  readonly keepAliveMinutes: number;
}

const TRANSPORT_LIMITS: SharedHttpTransportLimits = {
  maxRequests: 32,
  maxRequestsPerHost: 4,
  connectionPoolSize: 8,
  keepAliveMinutes: 5,
};

/**
 * Share pool and dispatcher, keep per-source TLS, cookies and proxy configuration.
 * Kotlin `builder(): OkHttpClient.Builder` → limits bag consumed by the platform layer.
 */
export const SharedHttpTransport = {
  limits: TRANSPORT_LIMITS,
  builder(): SharedHttpTransportLimits {
    return TRANSPORT_LIMITS;
  },
};

/**
 * Parent cancellation closes blocked socket reads; response close removes the hook.
 * Kotlin `Call.executeCancellable()`.
 */
export async function executeCancellable(
  input: RequestInfo | URL,
  init: RequestInit = {},
  parentSignal?: AbortSignal | null,
): Promise<Response> {
  return executeFetchWithCancellation(input, init, parentSignal);
}

/**
 * Kotlin L24 `if (body == null) { handle?.dispose(); return response }` has to be split in
 * two for the web: `fetch` already reports a missing body as `response.body === null`, but the
 * WHATWG `Response` constructor *additionally* rejects a stream for the statuses RFC 9110
 * defines as carrying no body (`new Response(stream, {status: 204})` throws a `TypeError`).
 * OkHttp has no such rule, so Kotlin keeps wrapping those and the caller simply reads 0 bytes —
 * the equivalent here is to hand back the original response, whose body is likewise empty.
 */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Kotlin `Call.executeWithCancellation(job: Job?)`.
 * Maps OkHttp call.cancel() → AbortController.abort(); hook dispose →
 * abort-listener removal when the response body stream ends or is cancelled.
 */
export async function executeFetchWithCancellation(
  input: RequestInfo | URL,
  init: RequestInit = {},
  parentSignal?: AbortSignal | null,
): Promise<Response> {
  const controller = new AbortController();
  const onParentAbort = (): void => {
    controller.abort();
  };
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort);
    }
  }
  const dispose = (): void => {
    parentSignal?.removeEventListener('abort', onParentAbort);
  };
  // Kotlin L15 `job?.ensureActive()` runs BEFORE `execute()`, so an already-cancelled parent
  // throws without ever touching the network. `fetch` would also reject an aborted signal,
  // but it would still be called — short-circuit here to match.
  if (controller.signal.aborted) {
    dispose();
    throw new Error('request cancelled');
  }
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    // Kotlin: `job?.ensureActive()` after execute — cancelled after headers → close + throw.
    if (controller.signal.aborted) {
      dispose();
      try {
        await response.body?.cancel();
      } catch {
        // body already gone
      }
      throw new Error('request cancelled');
    }
    const originalBody = response.body;
    if (originalBody === null) {
      dispose();
      return response;
    }
    if (NULL_BODY_STATUSES.has(response.status)) {
      dispose();
      return response;
    }
    // Kotlin: ForwardingSource.close() { super.close(); handle.dispose() } —
    // reader end/cancel disposes the parent-abort hook.
    const reader = originalBody.getReader();
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            dispose();
            streamController.close();
            return;
          }
          if (value !== undefined) {
            streamController.enqueue(value);
          }
        } catch (err) {
          dispose();
          streamController.error(err);
        }
      },
      cancel(reason) {
        dispose();
        return reader.cancel(reason);
      },
    });
    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    // Kotlin: `handle?.dispose(); call.cancel(); job?.ensureActive(); throw e`
    dispose();
    throw err;
  }
}

/**
 * Expand an IPv6 literal into its eight 16-bit hextets, or `null` when it is not a literal.
 * Handles `::` compression and a trailing dotted-quad, which is what Java's
 * `IPAddressUtil.textToNumericFormatV6` accepts.
 */
function expandIpv6(bare: string): number[] | null {
  let text = bare;
  // A trailing dotted quad (e.g. `::ffff:1.2.3.4`) becomes two hextets first.
  const quad = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (quad) {
    const octets = [1, 2, 3, 4].map((i) => Number(quad[i]));
    if (octets.some((n) => !Number.isInteger(n) || n > 255)) return null;
    const hi = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const lo = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    text = `${text.slice(0, quad.index)}${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const chunk of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      out.push(Number.parseInt(chunk, 16));
    }
    return out;
  };
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (head === null || tail === null) return null;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    return [...head, ...new Array<number>(fill).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

/** True for any-local / loopback / link-local / site-local / multicast / IPv6 ULA addresses. */
export function isPrivateAddress(ip: string): boolean {
  const lower = ip.toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a > 255 || b > 255) return false;
    if (a === 0) return true; // isAnyLocalAddress
    if (a === 127) return true; // isLoopbackAddress
    if (a === 169 && b === 254) return true; // isLinkLocalAddress
    if (a === 10) return true; // isSiteLocalAddress
    if (a === 172 && b >= 16 && b <= 31) return true; // isSiteLocalAddress
    if (a === 192 && b === 168) return true; // isSiteLocalAddress
    if (a >= 224 && a <= 239) return true; // isMulticastAddress
    return false;
  }
  // IPv6 literal (WHATWG URL keeps brackets in hostname — caller strips them).
  const bare = lower.replace(/^\[|\]$/g, '');
  if (!bare.includes(':')) return false;
  const hextets = expandIpv6(bare);
  if (hextets === null) return false;
  // Kotlin `InetAddress.getByName("::ffff:1.2.3.4")` hands back an **Inet4Address**, so an
  // IPv4-mapped literal (Java `InetAddress.isIPv4MappedAddress`: bytes 0-9 zero, bytes 10-11
  // 0xff) is classified by its embedded IPv4 address instead.
  const mapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
  if (mapped) {
    const hi = hextets[6] ?? 0;
    const lo = hextets[7] ?? 0;
    return isPrivateAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 0) return true; // :: isAnyLocalAddress
  if (hextets.slice(0, 7).every((h) => h === 0) && hextets[7] === 1) return true; // ::1 isLoopbackAddress
  if ((hextets[0] ?? 0) >= 0xfe80 && (hextets[0] ?? 0) <= 0xfebf) return true; // fe80::/10 isLinkLocalAddress
  if ((hextets[0] ?? 0) >= 0xfec0 && (hextets[0] ?? 0) <= 0xfeff) return true; // fec0::/10 isSiteLocalAddress
  if ((hextets[0] ?? 0) >= 0xff00 && (hextets[0] ?? 0) <= 0xffff) return true; // ff00::/8 isMulticastAddress
  // ULA fc00::/7: raw[0] & 0xfe == 0xfc
  if ((((hextets[0] ?? 0) >> 8) & 0xfe) === 0xfc) return true;
  return false;
}

/** Kotlin `SourceNetworkPolicy.checkAddress(host, address, allowedPrivateHost)`. */
export function checkAddress(
  host: string,
  address: string,
  allowedPrivateHost: string | null,
): void {
  // Kotlin: `host.lowercase() == allowedPrivateHost` — null never equals, so a
  // null allow-list entry must not accept a (possibly empty) host string.
  const allowed = allowedPrivateHost !== null && host.toLowerCase() === allowedPrivateHost;
  if (!isPrivateAddress(address) || allowed) return;
  throw new Error('书源跳转或 DNS 指向未配置的内网地址');
}

/** Kotlin `SourceNetworkPolicy.check(url: HttpUrl, allowedPrivateHost)`. */
export function checkSourceUrl(url: string, allowedPrivateHost?: string | null): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('仅支持 HTTP/HTTPS 书源');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('仅支持 HTTP/HTTPS 书源');
  }
  // OkHttp host keeps IPv6 brackets; strip so Kotlin's `::1` comparison works under WHATWG URL.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const local =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
  // Kotlin: runCatching { privateAddress(InetAddress.getByName(host)) } — JS checks the literal directly.
  const ipv6Private = host.includes(':') ? isPrivateAddress(host) : false;
  // Kotlin `require(!(local || ipv6Private) || host == allowedPrivateHost)`.
  const allowed = allowedPrivateHost != null && host === allowedPrivateHost;
  if ((local || ipv6Private) && !allowed) {
    throw new Error('书源规则尝试访问未配置的内网地址');
  }
}
