/**
 * Kotlin → TS: `source/zlibrary/network/ZLibrarySessionManager.kt` (50 lines, 43 non-blank)
 *             → `src/core/source/zlibrary/network/zLibrarySessionManager.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        package …zlibrary.network          → SKIPPED (TS has no packages)
 *   L3        import android.util.Log           → `import { SourceLog } from '../../sourceLog'`
 *   L4        import …ZLibraryCredentialStorage → type import (kept in the constructor, L9-11)
 *   L5-6      import kotlinx.coroutines.Dispatchers / withContext → dropped (see below)
 *   L8-11     class ZLibrarySessionManager(httpClient, credentialStorage) → same shape
 *   L12       private var isSessionInitialized   → `private isSessionInitialized = false`
 *   L13       private var activeDomain = "z-library.sk" → verbatim literal
 *   L15       suspend fun ensureSessionInitialized(domain, forceRefresh = false) → `async ensureSessionInitialized(...)`
 *   L16       activeDomain = domain              → verbatim
 *   L17-19    early return when already initialised → verbatim
 *   L21       return@withContext try             → `async` + try/catch returning bool
 *   L22-28    homepageUrl + Log.d + the 4.5s pre-warm comment (全部注释保留) → verbatim
 *   L29-32    200 / 517 / 307 → isSessionInitialized = true → verbatim
 *   L33-36    non-OK → Log.w, false              → verbatim
 *   L37-40    catch → Log.w, false               → verbatim
 *   L43       fun isInitialized()                → `isInitialized()`
 *   L45       fun getActiveDomain()              → `getActiveDomain()`
 *   L47-49    fun invalidateSession()            → `invalidateSession()`
 *   L50       closing brace                      → n/a
 *
 * Adaptations:
 *   - `withContext(Dispatchers.IO)` dropped (no dispatcher in JS); the method is a Promise.
 *   - `Log.d` / `Log.w` → `SourceLog.log` (the only logging channel available in `src/core`).
 *   - `httpClient.get(homepageUrl, callTimeoutMs = 4500L)` keeps the 4500 ms deadline, which the
 *     comment at L24-27 explains must be a real socket-read bound (an outer cancellation cannot
 *     unblock a read). In the TS port the deadline is passed through
 *     `ZLibraryHttpRequestSpec.callTimeoutMs`, and the optional `AbortSignal` is forwarded so a
 *     cancelled caller still aborts the fetch.
 *   - Kotlin's `kotlinx.coroutines.CancellationException` is a plain `Error` here; the `catch`
 *     below deliberately mirrors the Kotlin `catch (e: Exception)`, which also swallows
 *     cancellation on Android. Documented, not changed.
 */

import { SourceLog } from '../../sourceLog';
import type { ZLibraryHttpClient } from './zLibraryHttpClient';
import type { ZLibraryCredentialStorage } from '../zLibraryCredentialStorage';

/** Kotlin `Log.d("ZLibSession", …)` / `Log.w("ZLibSession", …)` tag. */
const TAG = 'ZLibSession';

export class ZLibrarySessionManager {
  private isSessionInitialized = false;
  private activeDomain: string = 'z-library.sk';

  constructor(
    readonly httpClient: ZLibraryHttpClient,
    readonly credentialStorage: ZLibraryCredentialStorage,
  ) {}

  /**
   * 预热限时 4.5s（搜索修复）：首页 GET 只是提前解 DiamWall PoW 攒 Cookie，
   * 失败/超时不阻塞搜索——搜索请求里 DiamWall 拦截器会内联再解。注意必须用
   * OkHttp callTimeout：外层协程超时取消不了阻塞中的 socket read（实测 12s
   * read timeout 照样吃掉聚合搜索 20s 预算，表现为"卡在搜索"）。
   */
  async ensureSessionInitialized(
    domain: string,
    forceRefresh = false,
    signal?: AbortSignal | null,
  ): Promise<boolean> {
    this.activeDomain = domain;
    if (this.isSessionInitialized && !forceRefresh) {
      return true;
    }

    try {
      const homepageUrl = `https://${domain}/`;
      SourceLog.log(TAG, `Initializing session at ${homepageUrl}`);
      const response = await this.httpClient.get(homepageUrl, null, {}, 4500, signal ?? null);
      if (response.isSuccessful || response.code === 517 || response.code === 307) {
        this.isSessionInitialized = true;
        SourceLog.log(TAG, `Session initialized successfully for ${domain}`);
        return true;
      }
      SourceLog.log(TAG, `Session init got HTTP ${response.code} for ${domain}`);
      return false;
    } catch (e) {
      SourceLog.log(
        TAG,
        `Session init unavailable for ${domain}: ${errorMessage(e)} (PoW will be solved inline during search)`,
      );
      return false;
    }
  }

  isInitialized(): boolean {
    return this.isSessionInitialized;
  }

  getActiveDomain(): string {
    return this.activeDomain;
  }

  invalidateSession(): void {
    this.isSessionInitialized = false;
  }
}

/** Kotlin `e.message` in a template — `null` renders as the literal "null". */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
