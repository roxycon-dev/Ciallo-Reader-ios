/**
 * Kotlin → TS: `source/zlibrary/network/SystemProxyResolver.kt` (49 lines, 44 non-blank)
 *             → `src/core/source/zlibrary/network/systemProxyResolver.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.network                  → SKIPPED (TS has no packages)
 *   L3-9      import android.content.Context / android.net.ConnectivityManager /
 *             android.os.Build / java.net.{InetSocketAddress,Proxy,ProxySelector,URI}
 *                                                          → REPLACED by the injected
 *                                                            `SystemProxyProvider` interface below
 *   L11-17    KDoc Resolves the system HTTP proxy…        → preserved verbatim on `SystemProxyResolver`
 *   L18       object SystemProxyResolver                 → `export const SystemProxyResolver`
 *   L20-22    fun resolve(context)                       → `resolve(provider: SystemProxyProvider | null)`
 *   L24-36    resolveInternal — Android path             → verbatim structure: provider.defaultProxy(),
 *                                                          blank-host / port<=0 guard, try/catch fallthrough
 *   L38-47    resolveInternal — JVM ProxySelector path   → verbatim structure: provider.selectDefaultProxy("https://zlib.invalid")
 *   L48-49    closing braces                             → n/a
 *
 * ADAPTATION (documented, no equivalent exists):
 *   Neither the browser nor the iOS WKWebView/URLSession JS surface exposes a *synchronous*
 *   system HTTP proxy setting — `fetch()` always follows the OS/network configuration
 *   implicitly and JS has no `ProxySelector` equivalent. The Android behaviour therefore
 *   becomes a DECLARED interface, `SystemProxyProvider`, with two methods that mirror the
 *   two Kotlin branches 1:1. The platform layer implements it from Capacitor/URLSession
 *   configuration; `resolve(null)` (no platform wiring) returns null exactly like the
 *   Kotlin `context == null` case.
 *
 *   Kotlin `Build.VERSION.SDK_INT >= 23` gate: dropped — the injected provider only exists
 *   when the platform layer could actually read the setting, so the API-level branch is
 *   unrepresentable. Kotlin `info.port > 0` is kept verbatim (a 0/-1 port is rejected).
 *
 *   Kotlin `ProxySelector.getDefault()?.select(URI(...))?.firstOrNull { it.type() == HTTP }`
 *   collapses to "the first HTTP proxy entry for that URI" — which is precisely the
 *   contract of `selectDefaultProxy(uri)`, so no filtering is lost here.
 */

export interface SystemProxyInfo {
  readonly host: string;
  readonly port: number;
}

/** Injected seam for the two Kotlin resolution branches. */
export interface SystemProxyProvider {
  /**
   * Kotlin branch 1: `ConnectivityManager.defaultProxy`
   * (the real system proxy used by browsers/WebView), `Build.VERSION.SDK_INT >= 23`.
   */
  defaultProxy(): SystemProxyInfo | null;
  /**
   * Kotlin branch 2: `ProxySelector.getDefault()?.select(URI(uri))`
   * reduced to its first `Proxy.Type.HTTP` entry. On the JVM this honours the OS proxy
   * only when "java.net.useSystemProxies" is enabled.
   */
  selectDefaultProxy(uri: string): SystemProxyInfo | null;
}

export const SystemProxyResolver = {
  /**
   * Resolves the system HTTP proxy (the same one browsers/WebView use).
   *
   * In CN networks with a proxy tool (Clash etc.), WebView can reach Z-Library while a plain
   * OkHttp client cannot, because OkHttp's JVM/Android default does not reliably pick up the
   * system proxy. Explicitly applying it makes the app's HTTP path behave like the WebView.
   */
  resolve(provider: SystemProxyProvider | null): SystemProxyInfo | null {
    return resolveInternal(provider);
  },
};

/** Kotlin `private fun resolveInternal(context: Context?)`. */
function resolveInternal(provider: SystemProxyProvider | null): SystemProxyInfo | null {
  // Android: the real system proxy used by browsers/WebView
  if (provider !== null) {
    try {
      const info = provider.defaultProxy();
      if (info !== null && info.host.trim() !== '' && info.port > 0) {
        return { host: info.host, port: info.port };
      }
    } catch {
      // fall through to the java default selector
    }
  }

  // Fallback (JVM tests / older Android): java default proxy selector.
  // Note: on the JVM this honors the OS proxy only when
  // "java.net.useSystemProxies" is enabled.
  try {
    return provider?.selectDefaultProxy('https://zlib.invalid') ?? null;
  } catch {
    return null;
  }
}
