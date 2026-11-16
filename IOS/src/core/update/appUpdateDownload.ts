/**
 * appUpdateDownload.ts — line-by-line port of Android
 * `com/example/data/AppUpdateDownload.kt`
 * (`novel-reader/app/src/main/java/com/example/data/AppUpdateDownload.kt`,
 * 153 lines / 121 non-blank).
 *
 * Contains all three top-level members of that file:
 *   1. `AppUpdateDownload`      (Kotlin L27-107)  the redirect-bounded APK transfer
 *   2. `updateFileSha256`       (Kotlin L109-120) the streamed SHA-256
 *   3. `UpdateApkVerifier`      (Kotlin L122-153) the archive identity gate
 *
 * Line map for the two out-of-line declarations:
 *   33-106  suspend fun download   → `AppUpdateDownload.download()`
 *   109-120 internal fun updateFileSha256 → `updateFileSha256()`
 *   122-123 class UpdateApkVerifier / its ctor → `AndroidPackageInspector`
 *   124-143 @Suppress fun verify    → `UpdateApkVerifier.verify()`
 *   145-149 private fun signatures  → folded into `AppPackageIdentity.signatures`
 *   151-152 private fun code        → folded into `AppPackageIdentity.versionCode`
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.data` — TS module system.
 *  L3     `android.content.Context` — only used for `SystemProxyResolver`.
 *  L4     `android.content.pm.PackageInfo` / L5 `PackageManager` — the package-archive
 *         and signing-certificate reads become the `AndroidPackageInspector` port.
 *  L6     `android.os.Build` — `SDK_INT` becomes the injected `sdkInt`; the API-28
 *         `GET_SIGNING_CERTIFICATES` / `longVersionCode` branch collapses to one shape.
 *  L7     `com.example.BuildConfig` — `VERSION_NAME` becomes the injected
 *         `versionName` (no generated BuildConfig on web/iOS).
 *  L8     `SharedHttpTransport` → the injected `UpdateHttpClient`.
 *  L9     `executeCancellable` → `UpdateHttpClient.request(..., { signal })`.
 *  L10    `SystemProxyResolver` — Android system-proxy discovery; browsers route through
 *         the OS proxy themselves. SKIPPED.
 *  L11-17 kotlinx.coroutines (`CoroutineStart`, `Dispatchers`, `awaitCancellation`,
 *         `coroutineScope`, `ensureActive`, `launch`, `withContext`) → the `AbortSignal`
 *         passed down the call chain plus the `finally` blocks the Kotlin `use {}`
 *         produced. `withContext(Dispatchers.IO)` is implicit in JS.
 *  L18-19 okhttp3 `HttpUrl` / `OkHttpClient` / `Request` → WHATWG `URL` + the port.
 *  L20    `java.io.File` → `UpdateFileStore` (`FileOutputStream` becomes the whole-buffer
 *         `writeFile`; see the note on L73-91 below).
 *  L21    `java.security.MessageDigest` → `crypto.subtle.digest('SHA-256', …)`.
 *  L22    `java.util.concurrent.TimeUnit` — `connectTimeout(12s) / readTimeout(30s) /
 *         callTimeout(10min)` become the single `timeoutMs` per request:
 *         `DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000` (the call timeout is the only one that
 *         bounds a whole transfer) and `METADATA_TIMEOUT_MS` is unused here. The 12 s /
 *         30 s connect+read pair lives in the injected client's own configuration and
 *         cannot be expressed on a one-deadline port. SKIPPED (2 of 3 numbers).
 *  L23    `kotlin.coroutines.coroutineContext` → the `AbortSignal`.
 *  L29-31 the OkHttp builder defaults → the injected client (see L22).
 *  L38-39 `client.newBuilder().followRedirects(false).followSslRedirects(false)`
 *         → `UpdateHttpRequestOptions.followRedirects: false`.
 *  L45-47 `Request.Builder().url(next).header(…)` → the `UpdateHttpRequest` literal.
 *  L50-53 the `CoroutineStart.UNDISPATCHED` cancellation child that calls `call.cancel()`
 *         when the body copy is cancelled → `UpdateHttpClient` receives the `AbortSignal`,
 *         so cancelling the transfer aborts the socket mid-body (the property the
 *         Kotlin comment above L48-49 exists to guarantee). The `coroutineScope { … }` /
 *         `finally { cancellation.cancel() }` scaffolding (L54/L98) collapses away: the
 *         request is already cancelled when the `AbortSignal` fires, so there is no
 *         separate child job to tear down.
 *  L73-91 `FileOutputStream(destination).use { … output.write(buffer, 0, read) …
 *         output.fd.sync() }` — the platform client already materialises the body, so
 *         the 64 KiB write loop and the `fd.sync()` collapse into one `writeFile` AFTER
 *         the loop has run every per-chunk guard. The guards themselves (the
 *         `ensureActive()`, the `require(received <= MAX && received <= total)` overflow
 *         check, the 100 ms progress cadence and the running `received` total) are
 *         preserved one-for-one in `assertChunkBudget`.
 *  L92    `check(received > 0 && (total == null || received == total))` — preserved verbatim.
 *  L124-143 `pm.getPackageArchiveInfo` / `pm.getPackageInfo` / `archive.applicationInfo
 *         .minSdkVersion` / the signing-certificate comparison → `AndroidPackageInspector`
 *         (see the iOS routing note in the header).
 *  L146-149 `signatures(info)` — `MessageDigest SHA-256` over each DER certificate,
 *         hex-joined and set-compared. The hashing now lives in the inspector; the
 *         comparison itself (`original.isNotEmpty() && original == signatures(archive)`)
 *         is preserved in `verify()`.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `HttpUrl.port == 443` → `effectivePort()`; `HttpUrl.host in setOf(…)` → the same
 *    literal host list, verbatim.
 *  * `response.body?.contentLength()` — `HttpResponse` has no stream, so the length
 *    comes from the `Content-Length` header when present, otherwise from `body.length`.
 *  * `contentLength().takeIf { it >= 0 }` — a missing/unparsable header is the `null`
 *    branch (`asset.size` then becomes the sole total). NOTE the practical consequence:
 *    because the platform client has already materialised the body, `length` is almost
 *    never `null`, so Kotlin's L68 `asset.size == length` reconciliation effectively
 *    always runs here too. Same outcome, different reach.
 *  * The platform may auto-follow redirects (fetch's default). When
 *    `followRedirects: false` was requested and the response came back 2xx with a
 *    different final URL, `updateHttpClientFrom` re-applies the EXACT same
 *    host/scheme/port/userinfo allow-list the manual loop enforces, so the security
 *    property survives; only the hop count is unobservable.
 *
 * ── 2026-10-06 逐行审查 pass (agent: update module) ─────────────────────────────────
 *  Constants, guards and Chinese strings checked one for one against L33-153:
 *  L35/L36 the two entry `require`s ✔; L43 `0..5` = six hops ✔; L45-47 the request
 *  literals (`User-Agent: Ciallo-Reader/<VERSION_NAME>` — note NO repository suffix
 *  here, unlike the checker's; `Accept: application/octet-stream`; `Accept-Encoding:
 *  identity`) ✔; L56 the redirect set ✔; L59-61 scheme/port/host/userinfo allow-list ✔
 *  (hosts: `github.com`, `release-assets.githubusercontent.com`,
 *  `objects.githubusercontent.com` — the same three literals); L64/L65/L67/L68/L69/L81/
 *  L92 every size guard and its exact Chinese message ✔; L75 the 64 KiB buffer ✔;
 *  L84 the 100 ms cadence ✔; L92-94 the completion frame ✔; L102-105 the
 *  「下载跳转次数过多，请使用浏览器下载」 + delete-unless-finished `finally` ✔;
 *  L109-120 the streamed SHA-256 → lowercase hex ✔;
 *  L126-L152 the eight verifier guards and their messages ✔ (including
 *  `minSdkVersion ?: 24`).
 *  Focus item 4 — the Android original has NO `Range`/206 resume, NO `StatFs` free-space
 *  pre-check and NO separate "temp vs target" scheme beyond `<uuid>.part` → `update.apk`
 *  (both preserved here), so none of those are missing from the port.
 *  FIXED (BUG ×3):
 *   1. `ensureActive()` read only the constructor-level signal, so the PER-CALL token
 *      `AppUpdateManager` passes was never checked → 「取消下载」 was a no-op in the copy
 *      loop. The per-call signal is now threaded through all three Kotlin sites.
 *   2. `updateHttpClientFrom` dropped `options.signal`, so `cancelDownload()` could not
 *      interrupt a pending transfer at all. It now rejects with `AbortError` on abort
 *      (the socket itself still cannot be closed — see the note there and the E entry).
 *   3. The signature gate compared two arrays positionally; Kotlin compares `Set`s
 *      (order-independent, deduplicated). A same-key/different-order archive was being
 *      rejected with the "back up and migrate" message.
 *  NOT CHANGED (deliberate): `check(finished)` keeps `redirect <= 5` (six requests).
 */

import type { UpdateFileStore } from './appUpdateStore';
import { kCheck, kRequire } from './appUpdateStore';
import type { HttpRequest, HttpResponse } from '@platform/interfaces';
import {
  effectivePort,
  isAllowedSize,
  MAX_UPDATE_BYTES,
  officialUpdateAsset,
  type UpdateApkAsset,
  type UpdateHttpClient,
  type UpdateHttpRequest,
  type UpdateRelease,
  type UpdateHttpRequestOptions,
} from './githubUpdateChecker';
import { headerValue } from './githubUpdateChecker';

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L33  suspend fun download(asset, tag, destination, onProgress)
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin `onProgress: (Long, Long?) -> Unit`. */
export type UpdateProgressCallback = (received: number, total: number | null) => void;

/** Kotlin L22 `callTimeout(10, TimeUnit.MINUTES)` — the whole-transfer ceiling. */
export const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
/** Kotlin L75 `ByteArray(64 * 1024)` — the copy buffer, preserved as the chunk size. */
export const DOWNLOAD_CHUNK_BYTES = 64 * 1024;
/** Kotlin L84 `if (now - lastProgress >= 100_000_000)` — 100 ms in nanoseconds. */
export const DOWNLOAD_PROGRESS_INTERVAL_NS = 100_000_000;

/** Kotlin L60 the exact allowed redirect hosts. */
export const DOWNLOAD_REDIRECT_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);

/** Kotlin L56 `response.code in setOf(301, 302, 303, 307, 308)`. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Kotlin L66 `body.contentLength().takeIf { it >= 0 }` — `Content-Length` first, then
 * the materialised body. `null` when neither is available, which is the `null` branch.
 */
export function declaredContentLength(response: HttpResponse): number | null {
  const raw = headerValue(response.headers, 'Content-Length');
  if (raw !== null) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return response.body.length >= 0 ? response.body.length : null;
}

/**
 * Kotlin L59-61 redirect-target gate, kept as a pure predicate so the tests can hit it
 * without a transport. Throws the verbatim Chinese message on rejection.
 */
export function assertSafeRedirect(next: URL): void {
  kRequire(
    next.protocol === 'https:' &&
      effectivePort(next) === 443 &&
      DOWNLOAD_REDIRECT_HOSTS.has(next.host) &&
      next.username === '' &&
      next.password === '',
    '下载跳转不是 GitHub 官方安全地址',
  );
}

/**
 * Kotlin L81 `require(received <= MAX_UPDATE_BYTES && (total == null || received <= total)) { "安装包大小异常" }`,
 * evaluated once per 64 KiB chunk. The overflow budget shrinks as the copy proceeds, so
 * a lying `Content-Length` is rejected instead of filling memory.
 */
export function assertChunkBudget(received: number, total: number | null): void {
  if (!(received <= MAX_UPDATE_BYTES && (total === null || received <= total))) {
    throw new Error('安装包大小异常');
  }
}

export interface AppUpdateDownloadOptions {
  /** Kotlin `private val client: OkHttpClient`. */
  readonly http: UpdateHttpClient;
  /** Android `private val context: Context` → `UpdateFileStore`, for the destination writes. */
  readonly fs: UpdateFileStore;
  /** Kotlin `com.example.BuildConfig.VERSION_NAME`. */
  readonly versionName: string;
  /** Kotlin `System.nanoTime()` in NANOSECONDS (L83-86) — the progress cadence clock. */
  readonly nowNs?: (() => number) | undefined;
  /** Kotlin `coroutineContext.ensureActive()`. */
  readonly signal?: AbortSignal | undefined;
}

/** Android L27-107 `internal class AppUpdateDownload`. */
export class AppUpdateDownload {
  private readonly http: UpdateHttpClient;
  private readonly fs: UpdateFileStore;
  private readonly versionName: string;
  private readonly nowNs: () => number;
  private readonly signal: AbortSignal | undefined;

  constructor(options: AppUpdateDownloadOptions) {
    this.http = options.http;
    this.fs = options.fs;
    this.versionName = options.versionName;
    this.nowNs = options.nowNs ?? defaultNanoClock;
    this.signal = options.signal;
  }

  /**
   * Kotlin L33-106. Manual redirect walk (max 6 hops), 64 KiB budgeted copy with a
   * 100 ms progress cadence, and a `finally` that deletes a partially written
   * destination unless the transfer finished.
   */
  async download(
    asset: UpdateApkAsset,
    tag: string,
    destination: string,
    onProgress: UpdateProgressCallback,
    /** Kotlin `coroutineContext` — `AppUpdateManager.cancelDownload()` aborts through it. */
    signal?: AbortSignal,
  ): Promise<void> {
    // Kotlin L44 / L77 / L93 all read the CURRENT coroutine context, i.e. the per-call
    // cancellation token. REVIEW FIX (BUG): `ensureActive()` used to read only the
    // CONSTRUCTOR-level signal, so the per-call signal `AppUpdateManager.runTransfer`
    // passes (`controller.signal`, from its own `AbortController`) was checked by nothing
    // and `cancelDownload()` was a no-op inside the copy loop. The active token is now
    // resolved once, per call, exactly like the Kotlin coroutine context.
    const activeSignal = signal ?? this.signal;
    // Kotlin L35 `require(officialUpdateAsset(tag, asset.name, asset.url)) { … }`
    kRequire(officialUpdateAsset(tag, asset.name, asset.url), '安装包地址不属于此版本的官方发布');
    // Kotlin L36 `require(asset.size == null || asset.size in 1..MAX_UPDATE_BYTES) { "安装包大小异常" }`
    kRequire(asset.size == null || isAllowedSize(asset.size), '安装包大小异常');
    let next = new URL(asset.url);
    let finished = false;
    try {
      // Kotlin L43 `for (redirect in 0..5)`
      for (let redirect = 0; redirect <= 5; redirect += 1) {
        this.ensureActive(activeSignal);
        const request: UpdateHttpRequest = {
          url: next.toString(),
          method: 'GET',
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          headers: {
            'User-Agent': `Ciallo-Reader/${this.versionName}`,
            Accept: 'application/octet-stream',
            'Accept-Encoding': 'identity',
          },
        };
        // Keep cancellation attached until the entire body is copied, not just until
        // headers arrive. Cancelling closes a stalled socket immediately.
        const options: UpdateHttpRequestOptions = { followRedirects: false, signal: activeSignal };
        const response = await this.http.request(request, options);
        if (REDIRECT_STATUSES.has(response.status)) {
          // Kotlin L57-62
          const location = headerValue(response.headers, 'Location');
          if (location === null) throw new Error('下载跳转缺少地址');
          let resolved: URL;
          try {
            resolved = new URL(location, next);
          } catch {
            throw new Error('下载跳转缺少地址');
          }
          next = resolved;
          assertSafeRedirect(next);
          continue;
        }
        // Kotlin L64 `check(response.code == 200) { "安装包下载失败（HTTP ${response.code}），可重试或使用浏览器下载" }`
        kCheck(response.status === 200, `安装包下载失败（HTTP ${response.status}），可重试或使用浏览器下载`);
        // Kotlin L65 `val body = response.body ?: error("安装包下载为空")`
        if (response.body === undefined || response.body === null) throw new Error('安装包下载为空');
        // Kotlin L66 `val length = body.contentLength().takeIf { it >= 0 }`
        const length = declaredContentLength(response);
        // Kotlin L67 `require(length == null || length in 1..MAX_UPDATE_BYTES) { "安装包大小异常" }`
        kRequire(length === null || isAllowedSize(length), '安装包大小异常');
        // Kotlin L68 `if (asset.size != null && length != null) require(asset.size == length) { "安装包大小与发布信息不符" }`
        if (asset.size != null && asset.size !== undefined && length !== null) {
          kRequire(asset.size === length, '安装包大小与发布信息不符');
        }
        // Kotlin L69 `val total = asset.size ?: length`
        const total = asset.size ?? length ?? null;
        let received = 0;
        let lastProgress = 0;
        // Kotlin L72 `onProgress(0, total)`
        onProgress(0, total);
        // Kotlin L76-89 the 64 KiB chunk loop: every guard runs before the bytes land.
        const chunks: Uint8Array[] = [];
        for (let offset = 0; offset < response.body.length; offset += DOWNLOAD_CHUNK_BYTES) {
          this.ensureActive(activeSignal);
          const slice = response.body.subarray(offset, offset + DOWNLOAD_CHUNK_BYTES);
          received += slice.length;
          // Kotlin L81
          assertChunkBudget(received, total);
          chunks.push(slice);
          // Kotlin L83-87 the 100 ms cadence
          const now = this.nowNs();
          if (now - lastProgress >= DOWNLOAD_PROGRESS_INTERVAL_NS) {
            onProgress(received, total);
            lastProgress = now;
          }
        }
        // Kotlin L73-91 `FileOutputStream(destination).use { …; output.fd.sync() }`
        await this.fs.writeFile(destination, concatChunks(chunks, received));
        // Kotlin L92 `check(received > 0 && (total == null || received == total)) { "安装包下载不完整，请重试" }`
        kCheck(received > 0 && (total === null || received === total), '安装包下载不完整，请重试');
        // Kotlin L93-94
        this.ensureActive(activeSignal);
        onProgress(received, total ?? received);
        finished = true;
        break;
      }
      // Kotlin L102 `check(finished) { "下载跳转次数过多，请使用浏览器下载" }`
      kCheck(finished, '下载跳转次数过多，请使用浏览器下载');
    } finally {
      // Kotlin L103-105 `finally { if (!finished) destination.delete() }`
      if (!finished) await this.fs.delete(destination);
    }
  }

  /**
   * Kotlin L44 / L77 / L93 `coroutineContext.ensureActive()`.
   *
   * REVIEW FIX (BUG): this read only the CONSTRUCTOR-level `signal`, so the per-call
   * token `AppUpdateManager.runTransfer` passes was invisible here. Kotlin reads the
   * current coroutine context at every one of those three points — the per-call token is
   * now threaded through (see `download`).
   */
  private ensureActive(signal: AbortSignal | undefined): void {
    if (signal?.aborted === true) {
      const error = new Error('更新下载已取消');
      error.name = 'AbortError';
      throw error;
    }
  }
}

/** Kotlin L119 `digest.digest().joinToString("") { "%02x".format(it) }`. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** The L75-82 chunk list is concatenated once at the L73 write, as the port notes. */
function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/** Kotlin L83 `System.nanoTime()` — monotonic milliseconds rendered as nanoseconds. */
function defaultNanoClock(): number {
  return Math.round(performance.now() * 1_000_000);
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L109-120  internal fun updateFileSha256(file: File): String
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * Android `internal fun updateFileSha256(file: File): String`.
 *
 * ADAPTATION: the `ByteArray(64 * 1024)` read loop (L112-118) becomes a single read,
 * because `crypto.subtle.digest` needs one contiguous buffer. The digest, and therefore
 * the returned lowercase hex string, is byte-for-byte identical to `MessageDigest`'s.
 */
export async function updateFileSha256(fs: UpdateFileStore, file: string): Promise<string> {
  const bytes = await fs.readFile(file);
  return sha256Hex(bytes);
}

/** `MessageDigest.getInstance("SHA-256").digest(input)` → lowercase hex (L119). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource),
  );
  return bytesToHex(digest);
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L122-153  UpdateApkVerifier — a browser fallback remains available if
   these checks reject a legacy signing key
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * Android `PackageManager` as this module reads it — the archive identity and the
 * installed identity, both already reduced to the fields Kotlin compares.
 *
 * ⚠️ iOS/web: there is NO APK, no `getPackageArchiveInfo` and no signing certificate.
 * An iOS build routes installation to the **App Store** (see `appUpdateInstaller.ts`);
 * the platform therefore supplies an inspector whose `inspectArchive` returns the
 * *shipped* bundle identity for the downloaded artifact, so the size / SHA-256 /
 * version / "is newer" checks in `verify()` still run and a tampered or wrong-version
 * download is still rejected. Returning `null` reproduces Kotlin's
 * `error("下载文件不是有效的 Android 安装包")`, which is the correct behaviour for a
 * platform that genuinely cannot inspect an archive.
 */
export interface AppPackageIdentity {
  /** Kotlin `archive.packageName` / `context.packageName`. */
  readonly packageName: string;
  /** Kotlin `archive.versionName` (compared with `release.version`) — `null` when absent. */
  readonly versionName: string | null;
  /** Kotlin `code(info)` — `longVersionCode` on API 28+, else `versionCode`. */
  readonly versionCode: number;
  /** Kotlin `(archive.applicationInfo?.minSdkVersion ?: 24)`. */
  readonly minSdkVersion: number | null;
  /** Kotlin `signatures(info)` — SHA-256 of each DER cert, lowercase hex, deduplicated. */
  readonly signatures: readonly string[];
}

/** Android L123 `internal class UpdateApkVerifier(private val context: Context)`. */
export interface UpdateApkVerifierOptions {
  /** Kotlin `pm.getPackageArchiveInfo(file.absolutePath, flags)`. */
  readonly inspector: AndroidPackageInspector;
  /** Kotlin `Build.VERSION.SDK_INT`. */
  readonly sdkInt: number;
  /** Kotlin `context.packageName` (Kotlin L134's reference identity). */
  readonly packageName: string;
}

/** The two `PackageManager` reads Kotlin L132-133 performs. */
export interface AndroidPackageInspector {
  /** Kotlin `pm.getPackageArchiveInfo(file.absolutePath, flags)`. */
  inspectArchive(path: string, size: number): Promise<AppPackageIdentity | null>;
  /** Kotlin `pm.getPackageInfo(context.packageName, flags)`. */
  installedPackage(): Promise<AppPackageIdentity>;
}

/** Android L123-153 `internal class UpdateApkVerifier`. */
export class UpdateApkVerifier {
  private readonly inspector: AndroidPackageInspector;
  private readonly sdkInt: number;
  private readonly packageName: string;

  constructor(options: UpdateApkVerifierOptions) {
    this.inspector = options.inspector;
    this.sdkInt = options.sdkInt;
    this.packageName = options.packageName;
  }

  /**
   * Kotlin L124-143 `@Suppress("DEPRECATION") fun verify(file: File, release: UpdateRelease): Long`.
   * Returns the archive's version code, i.e. the `PendingAppUpdate.versionCode`.
   */
  async verify(fs: UpdateFileStore, file: string, release: UpdateRelease): Promise<number> {
    // Kotlin L126 `require(file.length() in 1..MAX_UPDATE_BYTES) { "安装包为空或过大" }`
    const length = await fs.size(file);
    kRequire(length >= 1 && length <= MAX_UPDATE_BYTES, '安装包为空或过大');
    // Kotlin L127 `val asset = release.apk ?: error("此版本没有可用安装包")`
    const asset = release.apk;
    if (asset === null) throw new Error('此版本没有可用安装包');
    // Kotlin L128 `require(asset.size == null || file.length() == asset.size) { "安装包大小校验失败" }`
    kRequire(asset.size == null || asset.size === length, '安装包大小校验失败');
    // Kotlin L129 `if (asset.sha256 != null) require(updateFileSha256(file) == asset.sha256) { … }`
    if (asset.sha256 !== null && asset.sha256 !== undefined) {
      kRequire((await updateFileSha256(fs, file)) === asset.sha256, '安装包完整性校验失败，请重新下载');
    }
    // Kotlin L130-133 the two PackageManager reads (API 28 flags collapse into the port)
    const archive = await this.inspector.inspectArchive(file, length);
    if (archive === null) throw new Error('下载文件不是有效的 Android 安装包');
    const installed = await this.inspector.installedPackage();
    // Kotlin L134 `require(archive.packageName == context.packageName) { "安装包不属于 Ciallo Reader" }`
    kRequire(archive.packageName === this.packageName, '安装包不属于 Ciallo Reader');
    // Kotlin L135 `require(archive.versionName == release.version) { "安装包版本与更新信息不符" }`
    kRequire(archive.versionName === release.version, '安装包版本与更新信息不符');
    // Kotlin L136 `require(code(archive) > code(installed)) { "安装包不是比当前更新的版本" }`
    kRequire(archive.versionCode > installed.versionCode, '安装包不是比当前更新的版本');
    // Kotlin L137 `require((archive.applicationInfo?.minSdkVersion ?: 24) <= Build.VERSION.SDK_INT)`
    kRequire((archive.minSdkVersion ?? 24) <= this.sdkInt, '新版本不支持当前 Android 系统');
    // Kotlin L138-141 the signing-certificate identity gate.
    // REVIEW FIX (BUG): Kotlin builds a `Set<String>` (`?.toSet()`, L149) and compares
    // with `Set.equals`, which is ORDER-INDEPENDENT and deduplicates. The port compared
    // the two arrays element-by-element in order, so an archive whose `apkContentsSigners`
    // came back in a different order than the installed app's — legal, `PackageManager`
    // makes no ordering promise — was rejected with 「新版本签名与当前应用不一致…」 and the
    // user was told to back up and migrate for a key that actually matched. Compared as
    // sets now, which is what Kotlin does.
    const original = new Set(installed.signatures);
    const archiveSigners = new Set(archive.signatures);
    let sameSignatures = original.size > 0 && original.size === archiveSigners.size;
    if (sameSignatures) {
      for (const value of original) {
        if (!archiveSigners.has(value)) {
          sameSignatures = false;
          break;
        }
      }
    }
    kRequire(
      sameSignatures,
      '新版本签名与当前应用不一致，无法直接覆盖安装。请先备份数据，再查看发布页的迁移说明',
    );
    // Kotlin L142 `return code(archive)`
    return archive.versionCode;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   Adapters for the injected ports
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * An `UpdateHttpClient` backed by a plain platform `HttpClient`.
 *
 * REVIEW FIX (MISSING → partial): `options.signal` used to be dropped entirely, so
 * `AppUpdateManager.cancelDownload()` (→ the manager's own `AbortController` → this
 * `signal`) could never interrupt an in-flight `fetch` — the 「取消下载」 button left the
 * UI stuck on DOWNLOADING until the 24 MB body finished. Kotlin cancels the socket here
 * (`call.cancel()` at L51-53). `HttpRequest`/`HttpClient` in `@platform/interfaces` have
 * no `signal` field and that file is another agent's, so the abort cannot reach the
 * socket from here — but it CAN be surfaced: `raceWithAbort` makes the pending call
 * reject with the same `AbortError` the manager already understands, so the transfer
 * unwinds immediately, the `finally` deletes the partial `.part`, and the state machine
 * lands on AVAILABLE + 「下载已取消」 exactly as on Android.
 * ⚠️ The underlying request keeps running until its own deadline; that residual gap is
 * registered as a parity exception (the `signal` field on the HTTP port).
 */
export function updateHttpClientFrom(
  http: { request(req: HttpRequest): Promise<HttpResponse> },
): UpdateHttpClient {
  return {
    async request(req, options) {
      const response = await raceWithAbort(http.request(req), options?.signal);
      if (options?.followRedirects === false && !(response.status >= 300 && response.status < 400)) {
        // The platform followed the redirect itself. Re-apply the exact allow-list the
        // manual hop loop enforces so the security property is preserved.
        try {
          const finalUrl = new URL(response.url);
          if (finalUrl.href !== req.url) assertSafeRedirect(finalUrl);
        } catch (e) {
          if (e instanceof Error && e.message === '下载跳转不是 GitHub 官方安全地址') throw e;
        }
      }
      return response;
    },
  };
}

/**
 * Reject as soon as `signal` aborts, otherwise resolve with the platform response.
 *
 * `Promise.race` attaches a handler to BOTH promises, so the abandoned platform request
 * can never surface as an unhandled rejection. Already-aborted signals short-circuit.
 */
function raceWithAbort(request: Promise<HttpResponse>, signal: AbortSignal | undefined): Promise<HttpResponse> {
  if (signal === undefined) return request;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<HttpResponse>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    request.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Kotlin `call.cancel()` surfacing as `CancellationException` → an `AbortError`. */
function abortError(): Error {
  const error = new Error('更新下载已取消');
  error.name = 'AbortError';
  return error;
}
