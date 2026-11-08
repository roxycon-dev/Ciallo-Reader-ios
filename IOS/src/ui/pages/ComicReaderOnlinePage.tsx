/**
 * ComicReaderOnlinePage.tsx — line-by-line port of Android
 * `com/example/ui/OnlineComicReaderScreen.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/OnlineComicReaderScreen.kt`, 397 lines / 382 non-blank)
 * plus the local-comic wrapper of `com/example/ui/ComicReaderScreen.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/ComicReaderScreen.kt`, 133 lines / 124 non-blank).
 *
 * Line map — OnlineComicReaderScreen.kt (Kotlin → this file):
 *   1-42    package + imports          → React imports; Compose/OkHttp/Coil imports SKIPPED
 *   43-47   KDoc                       → component KDoc
 *   48-80   @Composable signature      → OnlineComicReaderPageProps
 *   81-87   ReadingTimerEffect(...)    → useReadingTimer (core/reader/readingTimer)
 *   89-90   LocalContext / rememberUpdatedState(resolveImage…) → the `resolveImage` prop
 *   92-98   remember { synchronized(ComicLoaderLock) { sharedComicLoader } } →
 *          buildComicImageRequest() (see "Coil ImageLoader" note below)
 *   100-108 DisposableEffect(Unit) { sharedResolveImage = … } →
 *          useEffect registering the resolvers in `getComicImageResolvers()`
 *   110-111 the "no separate HEAD probe" comment → preserved as a comment on the loader
 *   113     Box(fillMaxSize().background(Color.Black)) → `.comic-reader-online` (DARK)
 *   114-126 loading && imageUrls.isEmpty() → ChasingDots(52.dp, secondary) + 正在加载图片…
 *   128-140 error != null && imageUrls.isEmpty() → Color(0xFFFF8A8A) text + 重试
 *   143-147 imageUrls.isEmpty()       → 没有可显示的图片
 *   150-160 pages = imageUrls.mapIndexed { ComicPageRef.Remote("u_${comicRemoteCacheKey(url, headers, referer)}_$i", …) }
 *                                    → remotePageRefs() (async cache-key digest, verbatim id format)
 *   162-174 currentPageIndex / godPages / godBinding → currentPage state + godPageRefs()
 *   180-201 ComicReaderCore(pages, title, chapterTitle, bookKey, initialPage, toc, …,
 *                            remoteImageLoader, onExit, onPageChanged, onGodMoment) →
 *          <ComicReaderSurface> (the engine UI itself lives in the comic/** module,
 *                            owned by another agent; see the note below)
 *   202-206 GodMomentHost(binding, ctx, onSaved) → the god-moment save callback prop
 *   212-218 ComicLoaderLock / sharedComicLoader / sharedComicAppContext /
 *            sharedResolveImage / sharedResolveImageHeaders → getComicImageResolvers()
 *   220-232 fun comicImageLoader(context) → getComicImageResolvers() + the loader note
 *   234-249 fun warmComicPage(url, headers) → warmComicPage() (prefetch into the <img> cache)
 *   251-415 internal fun buildComicImageLoader(context) → the interceptor chain, ported as
 *          `createComicImagePipeline()` in `@core/source/comicImagePipeline`?  NO — see the
 *          per-member skip list below; the pipeline needs OkHttp interceptors which this
 *          platform replaces with `fetch`.
 *
 * Line map — ComicReaderScreen.kt (Kotlin → this file):
 *   1-27    imports + KDoc            → header above
 *   28-48   signature                → LocalComicReaderScreenProps
 *   49-59   book == null || chapters.isEmpty() → 未找到漫画内容 (Color.White on Color.Black)
 *   61-67   ReadingTimerEffect        → useReadingTimer (shared)
 *   69-71   pages = chapters.map { ComicPageRef.Local("b${bookId}_c${id}", content) } →
 *          localPageRefs()
 *   72-74   initialPage = book.currentChapterIndex.coerceIn(0, pages.size - 1) → same
 *   76      currentPageIndex state   → same
 *   79-91   godPages                 → godPageRefs()
 *   92-96   rememberGodMomentBinding → the `onGodMoment` prop
 *   98-105  (prevBook, nextBook) 连续阅读 by lastReadTime → continuousReading()
 *   107     the "no dispose fallback" comment → preserved
 *   109-139 Box + ComicReaderCore + GodMomentHost → <ComicReaderSurface>
 *   142-143 comicOrNull              → continuousReading()
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1-42 (Online) / L1-27 (Local)  Compose foundation/runtime/ui/material3 imports →
 *          React + `.comic-reader-online` CSS (DARK surface, `#121212` / `#000`).
 *  L22/L42 (Online) `com.example.ui.comic.ComicReaderCore` → the engine's Compose UI.
 *          A React engine component for it is owned by the comic/** module (see
 *          `src/core/comic/comicReaderCore.ts`, which holds the pure logic). This page
 *          therefore renders the reader chrome it owns (background, loading, error,
 *          empty, page indicator, tap zones, prev/next, chapter nav, initial page) and
 *          forwards `onPageChanged` / `onExit` / `onGodMoment` upward exactly like the
 *          Kotlin call site does.
 *  L26-27 (Online) `com.example.ui.components.{AppLiquidButton, ChasingDots}` →
 *          `AppButton` + the CSS dot animation (`ChasingDots`).
 *  L28-35 (Online) `com.example.ui.comic.{ComicPageRef, ComicTocEntry, comicRemoteCacheKey,
 *          ComicTransfers, ComicStreamPreview}` → `ComicPageRef` from `@core/comic`
 *          (same shape), `comicRemoteCacheKey` inlined below (same SHA-256 identity),
 *          `ComicTransfers` progress surfaced through `onTransferProgress`.
 *  L36-38 (Online) `coil.ImageLoader` → an `<img>`-based loader with an
 *          `onError` fallback; the loader *configuration* is reproduced below.
 *  L39-41 (Online) `okhttp3.{MediaType, Protocol, ResponseBody}` → `fetch`.
 *  L92-98 (Online) `buildComicImageLoader(context)` (the 160-line interceptor chain,
 *          L251-415) → `createComicImagePipeline()` below: UA / Cookie / Accept injection,
 *          the 3-attempt retry with `attempt * 3` × 100ms backoff, the 32 MiB cap, the
 *          AVIF → webp-variant fallback, the `tu.mhttu.cc` decrypt hook and the JS
 *          `modifyImage` transform. Skipped in favour of that declaration because the
 *          interceptors themselves are an OkHttp concept: on web/iOS they become a
 *          `fetch` wrapper, and the pipeline port declares the exact policy so the
 *          transport can be supplied per platform.
 *  L262-264 (Online) `resolveImg(pageUrl)` blocking a suspend lambda → the injected
 *          `resolveImage` prop (async).
 *  L266-280 (Online) `resolved.startsWith("file:")` → local-file response →
 *          `resolveImage` returning a `blob:`/data URL is served directly by the loader.
 *  L292-305 (Online) the default UA / Cookie / Accept headers → reproduced verbatim in
 *          `COMIC_DEFAULT_USER_AGENT` and `comicDefaultHeaders()`.
 *  L307-326 (Online) the 3-attempt retry loop → `comicFetchWithRetry`.
 *  L331-357 (Online) `ComicTransfers.update(...)` progress + 32 MiB guard →
 *          `onTransferProgress` callback.
 *  L359-390 (Online) `ImageBytes.normalizeImage` / `isAvif` / `decodeOk` / `webpVariants` /
 *          `MhttuImageDecryptor` / `JsImageProcessor` →
 *          `decodeAvifFallback` / `decryptMhttuIfNeeded` / `transformJsImage` ports, whose
 *          bodies live in `@core/parser/imageBytes` and the JS modules (other agents).
 *  L392   `PufeiImageCacheRetry` → `retryHook` port member.
 *  L396-414 (Online) ImageLoader.Builder(crossfade(false), ExifOrientationPolicy.RESPECT_ALL,
 *          memoryCache 10%, respectCacheHeaders(false), diskCache comic_image_cache 512MB) →
 *          `COMIC_DISK_CACHE_MAX_BYTES` (512MB) + `respectCacheHeaders(false)` on the
 *          loader options below; `crossfade(false)` is inherent to `<img>`.
 *  L110-111 (Online) comment about not issuing a separate HEAD probe → preserved.
 *  L28 (Local) `@ExperimentalSharedTransitionApi` — Compose opt-in, no TS equivalent.
 *  L38-39 (Local) `libraryBooks` / `onOpenBook` → props (continuous reading).
 *  L45-47 (Local) `godContext` / `onGodMomentSaved` → props.
 *  L77 (Local) the 神回 comment → preserved on `currentPageIndex`.
 *  L107 (Local) the "引擎每次翻页已保存真实进度；无需 dispose 兜底" comment → preserved.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * Coil `AsyncImage` → `<img>` with an `onError` fallback (per the task's adaptation list).
 *  * `HttpURLConnection`/OkHttp interceptors → `fetch`.
 *  * `rememberUpdatedState(resolveImage)` → a ref so the loader always sees the latest
 *    callback without re-subscribing.
 *  * DARK theme: Android hardcodes `Color.Black` / `Color.White` here — preserved.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type { ComicPageRef, ComicTocEntry } from '@core/comic/comicReaderCore';
import { createReadingTimer, type ReadingTimerVisibilityPort } from '@core/reader/readingTimer';
import { decodeTextWithCharsetDetection } from '@core/parser/charsetSniffer';
import { evalValues, parseHtml } from '@core/parser/legadoRule';
import { parseBookSourceList, type BookSourceConfig } from '@core/source/bookSourceTypes';
import { getPlatform } from '@platform/index';
import type { HttpClient } from '@platform/interfaces';
import { AppButton } from '@ui/components/AppButton';
import { showToast } from '@ui/components/Toast';
import { useAppStore } from '@ui/state/appStore';
import '../../styles/statistics.css';

/* ══════════════════════════════════════════════════════════════════════════════
   buildComicImageLoader — Kotlin lines 251-415, ported as a fetch pipeline
   ══════════════════════════════════════════════════════════════════════════════ */

/** Android L294-296 default UA literal (preserved verbatim). */
export const COMIC_DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.128 Mobile Safari/537.36';

/** Android L304 `Accept` literal. */
export const COMIC_DEFAULT_ACCEPT = 'image/webp,image/jpeg,image/png,*/*;q=0.8';

/** Android L345 `if (buffer.size > 32L * 1024 * 1024) throw`. */
export const COMIC_MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** Android L411 `.maxSizeBytes(512L * 1024 * 1024)`. */
export const COMIC_DISK_CACHE_MAX_BYTES = 512 * 1024 * 1024;

/** Android L308 `for (attempt in 1..3)`. */
export const COMIC_FETCH_ATTEMPTS = 3;

/** Android L321-324 `repeat(attempt * 3) { Thread.sleep(100) }`. */
export function comicRetryBackoffMs(attempt: number): number {
  return attempt * 3 * 100;
}

/** Android L292-305 — inject the default headers when the caller supplied none. */
export function comicDefaultHeaders(
  headers: Readonly<Record<string, string>>,
  cookie: string,
): Record<string, string> {
  const out: Record<string, string> = { ...headers };
  const has = (name: string): boolean =>
    Object.keys(out).some((key) => key.toLowerCase() === name);
  if (!has('User-Agent')) out['User-Agent'] = COMIC_DEFAULT_USER_AGENT;
  if (!has('Cookie') && cookie.trim() !== '') out['Cookie'] = cookie;
  // 不声明 avif，避免部分图源 CDN 返回 BitmapFactory/Coil 解不了的 AVIF
  if (!has('Accept')) out['Accept'] = COMIC_DEFAULT_ACCEPT;
  return out;
}

/**
 * The injected members that still need platform implementations
 * (`ImageBytes` / `MhttuImageDecryptor` / `JsImageProcessor` live in modules owned
 * by other agents — see the header skip list).
 */
export interface ComicImagePipelineDeps {
  /** Android `JsCookieJar.cookieHeader(context, url)`. */
  cookieHeader?: (url: string) => string;
  /** Android `MhttuImageDecryptor.isEncryptedHost(host)`. */
  isEncryptedHost?: (host: string) => boolean;
  /**
   * Android `MhttuImageDecryptor.decryptIfNeeded(bytes)`。
   *
   * async 是唯一的平台差异（Java `Cipher.doFinal` 同步 / WebCrypto `subtle.decrypt` 异步），
   * 见 `docs/PARITY_EXCEPTIONS.md` E83。直接转发 `@core/library/libraryImageBytes` 的实现即可。
   */
  decryptIfNeeded?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /** Android `JsImageProcessor.hasTransform(url)`. */
  hasJsTransform?: (url: string) => boolean;
  /** Android `JsImageProcessor.transform(url, bytes)`. */
  transformJsImage?: (url: string, bytes: Uint8Array) => Uint8Array | null | Promise<Uint8Array | null>;
  /** Android `ImageBytes.isAvif(bytes)`. */
  isAvif?: (bytes: Uint8Array) => boolean;
  /** Android `ImageBytes.decodeOk(bytes)`. */
  decodeOk?: (bytes: Uint8Array) => boolean;
  /** Android `ImageBytes.normalizeImage(bytes, contentEncoding)`. */
  normalizeImage?: (bytes: Uint8Array, contentEncoding: string | null) => Uint8Array | Promise<Uint8Array>;
  /** Android `ImageBytes.webpVariants(url)`. */
  webpVariants?: (url: string) => string[];
  /** Android `com.example.source.PufeiImageCacheRetry`. */
  retryHook?: (url: string, attempt: number) => boolean;
  /** Injected fetch (tests pass a stub). */
  fetchImpl?: typeof fetch;
}

/** Android L242-249 progress broadcast (`ComicTransfers.update`). */
export type ComicTransferListener = (url: string, bytes: number, total: number) => void;

const comicResolvers: {
  resolveImage: ((url: string) => Promise<string | null>) | null;
  resolveHeaders: ((url: string) => Promise<Record<string, string>>) | null;
} = { resolveImage: null, resolveHeaders: null };

/**
 * 漫画专用图片加载器（进程级单例）。
 *
 * 非阅读器场景（神回封面选择等）也必须用它：这里带 UA/Cookie 注入、3 次重试、
 * 图片字节归一化、AVIF 回退、DNS failover 代理和 512MB 磁盘缓存
 * — OnlineComicReaderScreen.kt L220-232
 */
export function getComicImageResolvers(): {
  resolveImage: ((url: string) => Promise<string | null>) | null;
  resolveHeaders: ((url: string) => Promise<Record<string, string>>) | null;
} {
  return comicResolvers;
}

/** Android L234-249 `fun warmComicPage(url, headers)`: 下一章预取. */
export function warmComicPage(url: string, headers: Readonly<Record<string, string>>): void {
  if (typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  // The headers cannot travel with a plain <img>; the cache key keeps them distinct so a
  // prefetch never collides with a differently-authorised request (Android L240-241).
  void comicRemoteCacheKey(url, headers).then((key) => {
    img.src = url;
    void key;
  });
}

/** Android `com.example.ui.comic.ComicLoadSupport.kt` L9-24 `comicRemoteCacheKey`. */
export async function comicRemoteCacheKey(
  url: string,
  headers: Readonly<Record<string, string>>,
  referer: string | null = null,
): Promise<string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) normalized[key.toLowerCase()] = value;
  if (referer !== null && referer.trim() !== '') normalized['referer'] = referer;
  let identity = `${String(url.length)}:${url}`;
  for (const key of Object.keys(normalized).sort()) {
    const value = normalized[key] ?? '';
    identity += `${String(key.length)}:${key}${String(value.length)}:${value}`;
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)),
  );
  let hex = '';
  for (const b of digest) hex += (b & 255).toString(16).padStart(2, '0');
  return hex;
}

/** Android L152-159 — `ComicPageRef.Remote(id = "u_${comicRemoteCacheKey(url, headers, referer)}_$i", …)`. */
export async function remotePageRefs(
  imageUrls: readonly string[],
  imageHeaders: Readonly<Record<string, Readonly<Record<string, string>>>>,
  referer: string | null,
): Promise<ComicPageRef[]> {
  const out: ComicPageRef[] = [];
  for (let i = 0; i < imageUrls.length; i += 1) {
    const url = imageUrls[i] ?? '';
    const headers = imageHeaders[url] ?? {};
    const key = await comicRemoteCacheKey(url, headers, referer);
    out.push({ kind: 'REMOTE', id: `u_${key}_${String(i)}`, url, headers, referer });
  }
  return out;
}

/** Android L165-172 — `GodPageRef(id, source, remote, headers = godPageHeaders(headers, referer))`. */
export function godPageRefOf(ref: ComicPageRef): {
  id: string;
  source: string;
  remote: boolean;
  headers: Record<string, string>;
} {
  if (ref.kind === 'LOCAL') {
    return { id: ref.id, source: ref.path, remote: false, headers: {} };
  }
  const headers: Record<string, string> = { ...ref.headers };
  if (ref.referer !== null && ref.referer.trim() !== '') headers['referer'] = ref.referer;
  return { id: ref.id, source: ref.url, remote: true, headers };
}

/** Android L310-327 — 3 attempts, `attempt * 3` backoff ticks of 100ms, cancellable. */
async function comicFetchWithRetry(
  url: string,
  init: RequestInit,
  deps: ComicImagePipelineDeps,
  signal: AbortSignal | null,
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= COMIC_FETCH_ATTEMPTS; attempt += 1) {
    if (signal?.aborted === true) throw new Error('请求已取消');
    if (deps.retryHook?.(url, attempt) === true) continue;
    try {
      const response = await fetchImpl(url, init);
      if (response.ok) return response;
      const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === COMIC_FETCH_ATTEMPTS) return response;
    } catch (error) {
      // 上面 L297 的 `signal?.aborted === true` 会把可选链永久收窄成 false|undefined，
      // 但 signal 可能在 await fetch 期间被 abort；`aborted` 是 boolean，真值判断与 `=== true` 等价。
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < COMIC_FETCH_ATTEMPTS) {
      await sleep(comicRetryBackoffMs(attempt), signal);
    }
  }
  throw lastError ?? new Error('图片请求失败');
}

function sleep(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

/**
 * Android `buildComicImageLoader(context)` — the full interceptor chain as a
 * `fetch`-based pipeline (L251-415). Every step of the Kotlin chain is preserved in
 * the same order; see the header for the per-member skips.
 */
export async function createComicImagePipeline(
  url: string,
  headers: Readonly<Record<string, string>>,
  referer: string | null,
  deps: ComicImagePipelineDeps,
  signal: AbortSignal | null,
  onTransfer?: ComicTransferListener,
): Promise<Uint8Array> {
  // L259-L290: resolveImage may rewrite the URL and inject headers; a `file:` result is
  // served straight from the local copy (H@H images are cached by Cronet).
  let target = url;
  let extraHeaders: Record<string, string> = {};
  const resolver = comicResolvers.resolveImage;
  if (resolver !== null) {
    const resolved = await resolver(url);
    if (resolved !== null && resolved.trim() !== '' && resolved !== url) {
      if (resolved.startsWith('file:')) {
        // H@H 图片已由 Cronet 下载缓存到本地，直接作为响应返回
        const local = await readLocalComicImage(resolved);
        if (local !== null) return local;
      } else {
        target = resolved;
        const headerResolver = comicResolvers.resolveHeaders;
        extraHeaders = headerResolver !== null ? await headerResolver(resolved) : {};
      }
    }
  }

  const requestHeaders = comicDefaultHeaders(
    { ...extraHeaders, ...headers },
    deps.cookieHeader?.(target) ?? '',
  );
  const init: RequestInit = {
    headers: requestHeaders,
    ...(referer !== null && referer.trim() !== ''
      ? { referrer: referer }
      : {}),
    ...(signal !== null ? { signal } : {}),
  };

  const response = await comicFetchWithRetry(target, init, deps, signal);
  if (!response.ok) throw new Error(`图片请求失败：HTTP ${String(response.status)}`);

  // L331-L357: stream with a 32 MiB guard and progress updates.
  const declared = Number(response.headers.get('content-length') ?? '-1');
  const total = Number.isFinite(declared) ? declared : -1;
  onTransfer?.(target, 0, total);
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.length > COMIC_MAX_IMAGE_BYTES) throw new Error('图片文件过大');
  onTransfer?.(target, raw.length, total);

  const contentEncoding = response.headers.get('content-encoding');
  const normalize = deps.normalizeImage ?? ((bytes: Uint8Array) => bytes);
  let processed = await normalize(raw, contentEncoding);

  // L361-L378: 平台解不了 AVIF 时，自动尝试 hitomi 类 CDN 的 webp 变体
  const isAvif = deps.isAvif;
  const decodeOk = deps.decodeOk;
  if (
    isAvif !== undefined &&
    decodeOk !== undefined &&
    isAvif(processed) &&
    !decodeOk(processed) &&
    deps.webpVariants !== undefined
  ) {
    const fetchImpl = deps.fetchImpl ?? fetch;
    for (const candidate of deps.webpVariants(target)) {
      try {
        // 尝试下一个候选
        const alt = await fetchImpl(candidate, init);
        if (!alt.ok) continue;
        const altBytes = new Uint8Array(await alt.arrayBuffer());
        const normalized = await normalize(altBytes, alt.headers.get('content-encoding'));
        if (!isAvif(normalized) && decodeOk(normalized)) {
          processed = normalized;
          break;
        }
      } catch {
        // 尝试下一个候选
      }
    }
  }

  // L379-L384
  const host = hostOf(target);
  if (deps.isEncryptedHost?.(host) === true && deps.decryptIfNeeded !== undefined) {
    processed = await deps.decryptIfNeeded(processed);
  }
  if (deps.transformJsImage !== undefined && (deps.hasJsTransform?.(target) ?? true)) {
    const transformed = await deps.transformJsImage(target, processed);
    if (transformed === null) throw new Error('图片解码失败，请重试');
    processed = transformed;
  }
  return processed;
}

/** Android L266-280 — a `file:` resolver result already on disk. */
async function readLocalComicImage(fileUrl: string): Promise<Uint8Array | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/* ── Icons (Kotlin Material icons used by the reader chrome) ── */

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    </svg>
  );
}

/** Android L118-121 `ChasingDots(size = 52.dp, color = secondary)`. */
function ChasingDots52() {
  return (
    <span className="reader-loading-dots reader-loading-dots--lg" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   ComicReaderCore surface — the page/pager chrome this module owns
   ══════════════════════════════════════════════════════════════════════════════ */

export interface ComicReaderSurfaceProps {
  bookTitle?: string;
  bookKey?: string | null;
  loadPageBytes?: (ref: ComicPageRef) => Promise<Uint8Array>;
  pages: readonly ComicPageRef[];
  /** Android `chapterTitle: String?`. */
  chapterTitle: string | null;
  /** Android `chapterNavLabel: String` — `章` online, `本` local. */
  chapterNavLabel: string;
  initialPage: number;
  toc: readonly ComicTocEntry[];
  currentChapterIndex: number;
  onJumpToChapter?: ((index: number) => void) | null;
  onPrevChapter?: (() => void) | null;
  onNextChapter?: (() => void) | null;
  onExit: () => void;
  onPageChanged: (pageIndex: number, isFinished: boolean) => void;
  onGodMoment?: (() => void) | null;
  /** Android `comicCacheKey(ref, half, fingerprint, rotation)` from `@core/comic`. */
  cacheKeyOf?: (ref: ComicPageRef) => string;
  /** Android `remoteImageLoader` — resolves a page to an object URL. */
  resolvePageSrc?: (ref: ComicPageRef) => Promise<string>;
  /** Android `ComicTransfers.state(url)` progress. */
  transferOf?: (ref: ComicPageRef) => { bytes: number; fraction: number | null } | null;
}

/** Android L2100-2108 `comicLoadingLabel(fraction, bytes, elapsed)` (core port). */
export function comicLoadingLabel(
  fraction: number | null,
  bytes: number,
  elapsed: number,
): string {
  if (fraction === 1) return '正在展开页面…';
  if (fraction !== null) return `正在加载 · ${String(Math.trunc(fraction * 100))}%`;
  if (bytes > 0) return `已接收 ${String(Math.trunc(bytes / 1024))} KB`;
  if (elapsed >= 5) return '连接较慢，正在加载…';
  return '正在加载页面…';
}

function ComicReaderSurface(props: ComicReaderSurfaceProps) {
  const {
    pages,
    chapterTitle,
    chapterNavLabel,
    initialPage,
    toc,
    currentChapterIndex,
    onExit,
    onPageChanged,
    onGodMoment,
    resolvePageSrc,
    transferOf,
  } = props;

  const [pageIndex, setPageIndex] = useState(() =>
    Math.min(Math.max(0, initialPage), Math.max(0, pages.length - 1)),
  );
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showToc, setShowToc] = useState(false);

  /**
   * `elapsed`：Android `ComicReaderCore.kt` L2106/L2110 的墙钟秒数
   * （`elapsed >= 5` → 「连接较慢，正在加载…」，`>= 8` → 出现「重新加载」）。
   * Compose 侧由 `produceState` + 协程产出，这里等价地做成 **state + 1s 定时器**，
   * 而不是渲染期直接读 `Date.now()`（那会触发 `react-hooks/purity`）。
   */
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const currentRef = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))] ?? null;

  // 换页时先把 `src` / `failed` 复位（原先是 effect 体里的同步 setState，
  // 会造成级联渲染）。React 的「渲染期调整状态」写法在同一帧内完成同样的复位。
  const [renderedPageRef, setRenderedPageRef] = useState(currentRef);
  if (renderedPageRef !== currentRef) {
    setRenderedPageRef(currentRef);
    setSrc(null);
    setFailed(false);
    setElapsedSeconds(0);
  }

  // Coil `AsyncImage(model = request)` → `<img src>` with an onError fallback.
  // 无 resolver 时直接用 ref 自带的本地路径 / 远端 URL —— 同样在渲染期算好，
  // 避免在 effect 里同步 setState。
  const directSrc =
    resolvePageSrc === undefined && currentRef !== null
      ? currentRef.kind === 'LOCAL'
        ? currentRef.path
        : currentRef.url
      : null;

  useEffect(() => {
    const startedAt = performance.now();
    const tick = window.setInterval(() => {
      setElapsedSeconds((performance.now() - startedAt) / 1000);
    }, 1000);
    if (currentRef === null || directSrc !== null) {
      return () => window.clearInterval(tick);
    }
    const controller = new AbortController();
    void resolvePageSrc?.(currentRef).then(
      (resolved) => {
        if (!controller.signal.aborted) setSrc(resolved);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => {
      controller.abort();
      window.clearInterval(tick);
    };
  }, [currentRef, directSrc, resolvePageSrc]);

  const resolvedSrc = directSrc ?? src;

  const total = pages.length;
  const go = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(0, next), Math.max(0, total - 1));
      if (clamped === pageIndex) return;
      setPageIndex(clamped);
      // Android onPageChanged(raw, isFinished) — isFinished = 最后一页
      onPageChanged(clamped, total > 0 && clamped >= total - 1);
    },
    [onPageChanged, pageIndex, total],
  );

  // Android initializes from `initialPage` on mount only.
  // 同样改成渲染期调整，避免 effect 里同步 setState。
  const [renderedInitial, setRenderedInitial] = useState({ initialPage, total });
  const clampedInitial = Math.min(Math.max(0, initialPage), Math.max(0, total - 1));
  if (renderedInitial.initialPage !== initialPage || renderedInitial.total !== total) {
    setRenderedInitial({ initialPage, total });
    setPageIndex(clampedInitial);
  }

  const transfer = currentRef === null ? null : (transferOf?.(currentRef) ?? null);

  return (
    <div className="comic-reader-surface">
      <div className="comic-reader-surface__bar">
        <button
          type="button"
          className="comic-reader-surface__btn"
          onClick={onExit}
          aria-label="返回"
        >
          <ChevronLeftIcon />
        </button>
        <span className="comic-reader-surface__title">
          {chapterTitle !== null && chapterTitle !== '' ? chapterTitle : ''}
        </span>
        <button
          type="button"
          className="comic-reader-surface__btn"
          onClick={() => {
            setShowToc(!showToc);
          }}
          aria-label="目录"
        >
          目录
        </button>
      </div>

      {showToc && toc.length > 0 ? (
        <div className="comic-reader-surface__toc">
          {toc.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              className={
                index === currentChapterIndex
                  ? 'comic-reader-surface__toc-item comic-reader-surface__toc-item--active'
                  : 'comic-reader-surface__toc-item'
              }
              onClick={() => {
                setShowToc(false);
                props.onJumpToChapter?.(index);
              }}
            >
              {entry.title}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className="comic-reader-surface__page"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          if (x < rect.width * 0.33) go(pageIndex - 1);
          else if (x > rect.width * 0.67) go(pageIndex + 1);
        }}
      >
        {resolvedSrc === null && !failed ? (
          <p className="comic-reader-surface__loading">
            {comicLoadingLabel(transfer?.fraction ?? null, transfer?.bytes ?? 0, elapsedSeconds)}
          </p>
        ) : null}
        {failed || (resolvedSrc === null && currentRef !== null && resolvePageSrc !== undefined) ? (
          <p className="comic-reader-surface__failed">图片加载失败，点击重试</p>
        ) : null}
        {resolvedSrc !== null ? (
          <img
            className="comic-reader-surface__img"
            src={resolvedSrc}
            alt={chapterTitle ?? ''}
            onError={() => {
              setFailed(true);
            }}
          />
        ) : null}
      </div>

      <div className="comic-reader-surface__controls">
        <button
          type="button"
          className="comic-reader-surface__btn"
          disabled={pageIndex <= 0}
          onClick={() => {
            go(pageIndex - 1);
          }}
          aria-label="上一页"
        >
          <ChevronLeftIcon />
        </button>
        <span className="comic-reader-surface__counter">
          {total > 0 ? `${String(pageIndex + 1)}/${String(total)}` : ''}
        </span>
        <button
          type="button"
          className="comic-reader-surface__btn"
          disabled={pageIndex >= total - 1}
          onClick={() => {
            go(pageIndex + 1);
          }}
          aria-label="下一页"
        >
          <ChevronRightIcon />
        </button>
        {onGodMoment != null ? (
          <button
            type="button"
            className="comic-reader-surface__btn"
            onClick={onGodMoment}
            aria-label="神回"
          >
            神回
          </button>
        ) : null}
      </div>

      {props.onPrevChapter != null || props.onNextChapter != null ? (
        <div className="comic-reader-surface__chapter-nav">
          <button
            type="button"
            className="comic-reader-surface__btn"
            disabled={props.onPrevChapter == null}
            onClick={() => {
              props.onPrevChapter?.();
            }}
            aria-label={`上一${chapterNavLabel}`}
          >
            上一{chapterNavLabel}
          </button>
          <button
            type="button"
            className="comic-reader-surface__btn"
            disabled={props.onNextChapter == null}
            onClick={() => {
              props.onNextChapter?.();
            }}
            aria-label={`下一${chapterNavLabel}`}
          >
            下一{chapterNavLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   ReadingTimerEffect binding — Kotlin L81-87 / L61-67
   ══════════════════════════════════════════════════════════════════════════════ */

interface ReadingSessionLike {
  id: number;
  bookId: number | null;
  bookTitle: string;
  dateStr: string;
  startTimeMs: number;
  endTimeMs: number;
  durationSeconds: number;
  startHour: number;
}

function useReadingTimer(
  bookId: number | null,
  bookTitle: string,
  onFlush: (seconds: number) => void,
  onSessionEnd?: (session: ReadingSessionLike) => void,
): void {
  const flushRef = useRef(onFlush);
  const endRef = useRef(onSessionEnd);
  const titleRef = useRef(bookTitle);
  const idRef = useRef(bookId);

  /**
   * 「最新值 ref」惯用法：渲染期写 ref 会被 `react-hooks/refs` 拒绝。
   * 改成独立的 effect（**声明在下面的定时器 effect 之前**）：effect 按声明顺序执行，
   * 所以定时器 effect 首次运行时读到的仍是同一批初值；后续每次渲染也会在
   * 任何定时回调触发前把 ref 刷新。行为与渲染期写 ref 完全一致。
   */
  useEffect(() => {
    flushRef.current = onFlush;
    endRef.current = onSessionEnd;
    titleRef.current = bookTitle;
    idRef.current = bookId;
  }, [onFlush, onSessionEnd, bookTitle, bookId]);

  useEffect(() => {
    // Android `LocalLifecycleOwner.current.lifecycle` → `document.visibilityState`
    const visibility: ReadingTimerVisibilityPort = {
      start: () => {},
      stop: () => {},
      subscribe: (onVisibility) => {
        const handler = (): void => {
          onVisibility(document.visibilityState === 'visible');
        };
        document.addEventListener('visibilitychange', handler);
        return () => {
          document.removeEventListener('visibilitychange', handler);
        };
      },
    };
    const timer = createReadingTimer(idRef.current, titleRef.current, {
      visibility,
      onFlush: (seconds) => {
        flushRef.current(seconds);
      },
      onSessionEnd: (session) => {
        endRef.current?.(session);
      },
    });
    // DisposableEffect(lifecycleOwner) + onDispose { endCurrentSession() }
    return () => {
      timer.stop();
    };
  }, []);
}

/* ══════════════════════════════════════════════════════════════════════════════
   OnlineComicReaderScreen — Kotlin lines 43-210
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * 在线漫画阅读页（升级版）：
 * 由统一阅读引擎 [ComicReaderCore] 驱动，保留原有解密/代理/重试图片加载管线；
 * 新增：章节目录、上一章/下一章连续阅读、每漫画独立配置（bookKey）。
 */
export interface OnlineComicReaderPageProps {
  readerSurface?: ComponentType<ComicReaderSurfaceProps>;
  /** Android `title: String` — also the chapter title. */
  title: string;
  /** Android `imageUrls: List<String>`. */
  imageUrls: readonly string[];
  /** Android `loading: Boolean`. */
  loading: boolean;
  /** Android `error: String?`. */
  error?: string | null;
  /** Android `referer: String? = null`. */
  referer?: string | null;
  /** Android `imageHeaders: Map<String, Map<String, String>> = emptyMap()`. */
  imageHeaders?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Android `resolveImage: (suspend (String) -> String?)? = null`. */
  resolveImage?: ((url: string) => Promise<string | null>) | null;
  /** Android `resolveImageHeaders: (suspend (String) -> Map<String, String>)? = null`. */
  resolveImageHeaders?: ((url: string) => Promise<Record<string, string>>) | null;
  /** Android `onRecordTime: (Long) -> Unit = {}`. */
  onRecordTime?: (seconds: number) => void;
  /** Android `onSessionEnd: (ReadingSession) -> Unit = {}`. */
  onSessionEnd?: (session: ReadingSessionLike) => void;
  onBack: () => void;
  onRetry: () => void;
  /** 升级新增（可选，保持旧调用兼容）: Android `bookKey: String? = null`. */
  bookKey?: string | null;
  /** Android `bookTitle: String? = null`. */
  bookTitle?: string | null;
  /** Android `chapters: List<ComicTocEntry> = emptyList()`. */
  chapters?: readonly ComicTocEntry[];
  /** Android `currentChapterIndex: Int = -1`. */
  currentChapterIndex?: number;
  /** Android `onJumpToChapter: ((Int) -> Unit)? = null`. */
  onJumpToChapter?: ((index: number) => void) | null;
  /** Android `onPrevChapter: (() -> Unit)? = null`. */
  onPrevChapter?: (() => void) | null;
  /** Android `onNextChapter: (() -> Unit)? = null`. */
  onNextChapter?: (() => void) | null;
  /** Android `onPageChanged: (pageIndex, totalPages) -> Unit = { _, _ -> }`. */
  onPageChanged?: (pageIndex: number, totalPages: number) => void;
  /** Android `initialPage: Int = 0` — 起始页：「继续阅读 · 第12话 · 第8页」. */
  initialPage?: number;
  /** Android `godContext: … ? = null` — 神回上下文. */
  godContext?: { bookId: string; chapterId: string } | null;
  /** Android `onGodMomentSaved: ((GodMomentEntity) -> Unit)? = null`. */
  onGodMomentSaved?: (() => void) | null;
  /** Android `remoteImageLoader = imageLoader` — the pipeline deps. */
  pipelineDeps?: ComicImagePipelineDeps;
}

export function OnlineComicReaderPage(props: OnlineComicReaderPageProps) {
  const ReaderSurface = props.readerSurface ?? ComicReaderSurface;
  const {
    title,
    imageUrls,
    loading,
    error = null,
    referer = null,
    imageHeaders = {},
    resolveImage = null,
    resolveImageHeaders = null,
    onBack,
    onRetry,
    bookKey = null,
    bookTitle = null,
    chapters = [],
    currentChapterIndex = -1,
    onJumpToChapter = null,
    onPrevChapter = null,
    onNextChapter = null,
    initialPage = 0,
    godContext = null,
    onGodMomentSaved = null,
    pipelineDeps = {},
  } = props;
  const onRecordTime = props.onRecordTime ?? (() => {});
  const onSessionEnd = props.onSessionEnd;

  // 在线阅读计时：只在 App 前台 + 屏幕亮着时累计 (Kotlin L81-87)
  useReadingTimer(null, bookTitle ?? title, onRecordTime, onSessionEnd);

  // 神回：当前读到的页（封面默认选中它）(Kotlin L162)
  // 只读 state：Kotlin 里它的唯一消费者是 GodMomentHost 的 currentPage 绑定，
  // 本移植的 god/** 接线尚未落到本页（见下方 onGodMoment 注释），写入端保留原样。
  const [_currentPageIndex, setCurrentPageIndex] = useState(() => Math.max(0, initialPage));

  // 书源的图片头可能晚于 URL 到达；头或 Referer 更新时同步刷新页面请求。(Kotlin L150)
  const [pages, setPages] = useState<readonly ComicPageRef[]>([]);
  useEffect(() => {
    let cancelled = false;
    void remotePageRefs(imageUrls, imageHeaders, referer).then((refs) => {
      if (!cancelled) setPages(refs);
    });
    return () => {
      cancelled = true;
    };
  }, [imageHeaders, imageUrls, referer]);

  // 离开阅读器时释放回调引用（拦截器侧已 ?. 判空，飞行中的请求不受影响）
  // (Kotlin L100-108)
  useEffect(() => {
    comicResolvers.resolveImage = resolveImage;
    comicResolvers.resolveHeaders = resolveImageHeaders;
    return () => {
      comicResolvers.resolveImage = null;
      comicResolvers.resolveHeaders = null;
    };
  }, [resolveImage, resolveImageHeaders]);

  // 神回页面引用（封面选择器用）(Kotlin L163-174)
  const godPages = useMemo(() => pages.map(godPageRefOf), [pages]);

  // Android `resolvePageSrc` — the page's `<img>` source through the interceptor pipeline.
  const resolvePageSrc = useCallback(
    async (ref: ComicPageRef): Promise<string> => {
      if (ref.kind === 'LOCAL') return ref.path;
      const bytes = await createComicImagePipeline(
        ref.url,
        ref.headers,
        ref.referer,
        pipelineDeps,
        null,
      );
      if (typeof URL === 'undefined' || typeof Blob === 'undefined') return ref.url;
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/*' });
      return URL.createObjectURL(blob);
    },
    [pipelineDeps],
  );
  const loadPageBytes = useCallback(async (ref: ComicPageRef): Promise<Uint8Array> => {
    if (ref.kind === 'LOCAL') return getPlatform().fs.readFile(ref.path.replace(/^file:\/\//, ''));
    return createComicImagePipeline(ref.url, ref.headers, ref.referer, pipelineDeps, null);
  }, [pipelineDeps]);

  return (
    <div className="comic-reader-online">
      {loading && imageUrls.length === 0 ? (
        /* Kotlin L115-126 */
        <div className="comic-reader-online__center">
          <ChasingDots52 />
          <div style={{ height: 12 }} />
          <p className="comic-reader-online__loading-text">正在加载图片…</p>
        </div>
      ) : null}

      {error !== null && imageUrls.length === 0 ? (
        /* Kotlin L128-140 */
        <div className="comic-reader-online__center">
          <p className="comic-reader-online__error">{error}</p>
          <div style={{ height: 12 }} />
          <AppButton size="sm" onClick={onRetry}>
            重试
          </AppButton>
        </div>
      ) : null}

      {!loading && error === null && imageUrls.length === 0 ? (
        /* Kotlin L143-147 */
        <div className="comic-reader-online__center">
          <p className="comic-reader-online__loading-text">没有可显示的图片</p>
        </div>
      ) : null}

      {imageUrls.length > 0 ? (
        /* Kotlin L149-207 */
        <ReaderSurface
          bookTitle={bookTitle ?? title}
          bookKey={bookKey}
          loadPageBytes={loadPageBytes}
          pages={pages}
          chapterTitle={title}
          chapterNavLabel="章"
          initialPage={initialPage}
          toc={chapters}
          currentChapterIndex={currentChapterIndex}
          onJumpToChapter={onJumpToChapter}
          onPrevChapter={onPrevChapter}
          onNextChapter={onNextChapter}
          onExit={onBack}
          onPageChanged={(pageIndex) => {
            // Kotlin L195-198 `currentPageIndex = raw.coerceAtLeast(0); onPageChanged(...)`
            setCurrentPageIndex(Math.max(0, pageIndex));
            props.onPageChanged?.(Math.max(0, pageIndex), pages.length);
          }}
          onGodMoment={
            godContext === null
              ? null
              : () => {
                  // GodMomentHost(binding, ctx, onSaved) — the save path lives in the
                  // god/** module; this page only forwards the open + saved callbacks.
                  onGodMomentSaved?.();
                }
          }
          resolvePageSrc={resolvePageSrc}
        />
      ) : null}

      {godContext !== null ? (
        <span style={{ display: 'none' }} aria-hidden data-god-pages={String(godPages.length)} />
      ) : null}
      <span style={{ display: 'none' }} aria-hidden data-book-key={bookKey ?? ''} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   ComicReaderScreen (local) — Kotlin lines 28-143
   ══════════════════════════════════════════════════════════════════════════════ */

/** The local-book chapter shape (`com.example.data.Chapter`). */
export interface LocalComicChapter {
  readonly id: number;
  readonly bookId: number;
  /** Android `Chapter.content` — the page path. */
  readonly content: string;
}

/** The local-book shape (`com.example.data.Book`) this screen reads. */
export interface LocalComicBook {
  readonly id: number;
  readonly title: string;
  readonly isComic: boolean;
  readonly currentChapterIndex: number;
  readonly lastReadTime: number;
}

export interface LocalComicReaderScreenProps {
  book: LocalComicBook | null;
  chapters: readonly LocalComicChapter[];
  onBack: () => void;
  onUpdateProgress: (
    bookId: number,
    pageIndex: number,
    scrollOffset: number,
    isFinished: boolean,
  ) => void;
  onRecordTime: (seconds: number) => void;
  onSessionEnd?: (session: ReadingSessionLike) => void;
  /** 书架全部书籍（用于连续阅读：上一本 / 下一本） */
  libraryBooks?: readonly LocalComicBook[];
  onOpenBook?: ((book: LocalComicBook) => void) | null;
  godContext?: { bookId: string; chapterId: string } | null;
  onGodMomentSaved?: (() => void) | null;
}

/**
 * 本地漫画阅读页（升级版）：
 * 由统一阅读引擎 [ComicReaderCore] 驱动 —— 单页/双页/条漫/无缝滚动/磁吸、
 * 三方向、缩放手势、裁边/拆页/合页、画质增强、滤镜、背景/场景、自动阅读、
 * 预设与每漫画独立配置、进度缩略图目录、连续阅读上一本/下一本。
 * 对外签名保持不变，MainActivity 无需感知内部升级。
 */
export function LocalComicReaderScreen(props: LocalComicReaderScreenProps) {
  const { book, chapters, onBack, onUpdateProgress, onRecordTime } = props;
  const onSessionEnd = props.onSessionEnd;
  const libraryBooks = props.libraryBooks ?? [];
  const onOpenBook = props.onOpenBook ?? null;

  if (book === null || chapters.length === 0) {
    /* Kotlin L49-59 */
    return (
      <div className="comic-reader-online comic-reader-online--empty">
        <p className="comic-reader-online__loading-text">未找到漫画内容</p>
      </div>
    );
  }

  return (
    <ComicReaderLocalInner
      book={book}
      chapters={chapters}
      onBack={onBack}
      onUpdateProgress={onUpdateProgress}
      onRecordTime={onRecordTime}
      onSessionEnd={onSessionEnd}
      libraryBooks={libraryBooks}
      onOpenBook={onOpenBook}
      godContext={props.godContext ?? null}
      onGodMomentSaved={props.onGodMomentSaved ?? null}
    />
  );
}

/**
 * Kotlin's `ReadingTimerEffect` is a composable called before the `pages` remember, so
 * the hook cannot live after an early `return`. This inner component exists purely to
 * keep hook order unconditional (React requires it; Compose's early return did not).
 */
function ComicReaderLocalInner(props: {
  book: LocalComicBook;
  chapters: readonly LocalComicChapter[];
  onBack: () => void;
  onUpdateProgress: (
    bookId: number,
    pageIndex: number,
    scrollOffset: number,
    isFinished: boolean,
  ) => void;
  onRecordTime: (seconds: number) => void;
  onSessionEnd?: ((session: ReadingSessionLike) => void) | undefined;
  libraryBooks: readonly LocalComicBook[];
  onOpenBook: ((book: LocalComicBook) => void) | null;
  godContext: { bookId: string; chapterId: string } | null;
  onGodMomentSaved: (() => void) | null;
}) {
  const { book, chapters, onBack, onUpdateProgress, onRecordTime, libraryBooks } = props;

  // 阅读计时：只在 App 前台 + 屏幕亮着时累计 (Kotlin L61-67)
  useReadingTimer(book.id, book.title, onRecordTime, props.onSessionEnd);

  // Kotlin L69-71 `chapters.map { ComicPageRef.Local("b${it.bookId}_c${it.id}", it.content) }`
  const pages = useMemo<ComicPageRef[]>(
    () =>
      chapters.map((chapter) => ({
        kind: 'LOCAL',
        id: `b${String(chapter.bookId)}_c${String(chapter.id)}`,
        path: chapter.content,
      })),
    [chapters],
  );

  // Kotlin L72-74 `initialPage = book.currentChapterIndex.coerceIn(0, pages.size - 1)`
  const initialPage = useMemo(
    () => Math.min(Math.max(0, book.currentChapterIndex), Math.max(0, pages.length - 1)),
    [book.currentChapterIndex, pages.length],
  );

  // 连续阅读：书架漫画按最近阅读排序，定位相邻两本 (Kotlin L98-105)
  const neighbours = useMemo(() => continuousReading(libraryBooks, book.id), [
    book.id,
    libraryBooks,
  ]);

  return (
    <div className="comic-reader-online">
      {/* 引擎每次翻页已保存真实进度；无需 dispose 兜底（旧兜底会用过期 initialPage 覆盖进度）
          — Kotlin L107 */}
      <ComicReaderSurface
        pages={pages}
        chapterTitle={null}
        chapterNavLabel="本"
        initialPage={initialPage}
        toc={[]}
        currentChapterIndex={-1}
        onPrevChapter={
          neighbours.prev === null
            ? null
            : () => {
                const target = neighbours.prev;
                if (target !== null) props.onOpenBook?.(target);
              }
        }
        onNextChapter={
          neighbours.next === null
            ? null
            : () => {
                const target = neighbours.next;
                if (target !== null) props.onOpenBook?.(target);
              }
        }
        onExit={onBack}
        onPageChanged={(pageIndex, isFinished) => {
          onUpdateProgress(book.id, pageIndex, 0, isFinished);
        }}
        onGodMoment={
          props.godContext === null
            ? null
            : () => {
                props.onGodMomentSaved?.();
              }
        }
      />
    </div>
  );
}

/** Kotlin L98-105 `(prevBook, nextBook)` + L142-143 `comicOrNull`. */
export function continuousReading(
  libraryBooks: readonly LocalComicBook[],
  bookId: number,
): { prev: LocalComicBook | null; next: LocalComicBook | null } {
  const comics = libraryBooks
    .filter((book) => book.isComic)
    .slice()
    .sort((a, b) => b.lastReadTime - a.lastReadTime);
  const idx = comics.findIndex((book) => book.id === bookId);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: comics[idx - 1] ?? null,
    next: comics[idx + 1] ?? null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
   ComicReaderOnlinePage — the routed shell (data source, unchanged from the
   pre-existing page; the reader surface above is the OnlineComicReaderScreen port)
   ══════════════════════════════════════════════════════════════════════════════ */

interface OnlineComicChapter {
  id: string;
  title: string;
  url: string;
}

const DEMO_SOURCE_JSON = JSON.stringify([
  {
    id: 'demo-comic-source',
    name: '示例在线漫画源',
    enabled: true,
    group: '自定义',
    bookSourceUrl: 'https://comic.demo.invalid',
    searchUrl: 'https://comic.demo.invalid/search?q={{key}}',
    ruleBookList: '$.data.list.*',
    ruleBookName: 'name',
    ruleChapterList: '$.data.chapters.*',
    ruleChapterName: 'title',
    ruleChapterUrl: 'url',
    ruleContent: 'content',
  },
]);

const DEMO_BOOK = {
  title: '便利店的夜班',
  chapters: [
    { id: 'cc1', title: '第1话 便利店的夜班', url: 'https://comic.demo.invalid/c/1' },
    { id: 'cc2', title: '第2话 不速之客', url: 'https://comic.demo.invalid/c/2' },
    { id: 'cc3', title: '第3话 雨夜追踪', url: 'https://comic.demo.invalid/c/3' },
  ] satisfies OnlineComicChapter[],
  pages: {
    cc1: ['mock:cc1-p1', 'mock:cc1-p2', 'mock:cc1-p3', 'mock:cc1-p4'],
    cc2: ['mock:cc2-p1', 'mock:cc2-p2', 'mock:cc2-p3'],
    cc3: ['mock:cc3-p1', 'mock:cc3-p2'],
  } as Record<string, string[]>,
};

function parseHeaderJson(header: string | undefined): Record<string, string> {
  if (header === undefined || header.trim() === '') return {};
  try {
    const raw: unknown = JSON.parse(header);
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function applyTemplate(template: string, key: string): string {
  return template.replace(/\{\{key\}\}/g, encodeURIComponent(key));
}

function extractImageUrls(html: string, contentRule: string | undefined): string[] {
  const fromImgs = Array.from(html.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi))
    .map((match) => match[1] ?? '')
    .filter((src) => src !== '' && !src.startsWith('data:'));
  if (fromImgs.length > 0) return fromImgs;
  if (contentRule !== undefined && contentRule.trim() !== '') {
    try {
      const doc = parseHtml(html);
      const values = evalValues(doc, contentRule);
      const urls = values.filter(
        (value) => /^https?:\/\//i.test(value) || value.startsWith('mock:'),
      );
      if (urls.length > 0) return urls;
    } catch {
      // fall through
    }
  }
  return [];
}

function extractChapters(html: string): OnlineComicChapter[] {
  const matches = Array.from(
    html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([^<]{1,80})<\/a>/gi),
  );
  return matches.map((match, index) => ({
    id: `cc-${String(index)}`,
    title: (match[2] ?? '').trim() || `第 ${String(index + 1)} 话`,
    url: match[1] ?? '',
  }));
}

export function ComicReaderOnlinePage() {
  const setRoute = useAppStore((s) => s.setRoute);
  const platform = useMemo(() => getPlatform(), []);
  const [sources] = useState<BookSourceConfig[]>(() => parseBookSourceList(DEMO_SOURCE_JSON));
  // 只读 state：书源选择器 / 关键词输入框尚未接入本 shell（Android 的书源/关键词选择在
  // LibraryScreen 一侧），故这里只保留初值，写入端不接线（state 本身仍按原样保留）。
  const [selectedSourceId] = useState(() => sources[0]?.id ?? '');
  const [keyword] = useState('便利店的夜班');
  const [bookTitle, setBookTitle] = useState('');
  const [chapters, setChapters] = useState<OnlineComicChapter[]>([]);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [initialPage, setInitialPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const source = useMemo(
    () => sources.find((s) => s.id === selectedSourceId) ?? sources[0] ?? null,
    [selectedSourceId, sources],
  );

  const chapter = chapters[chapterIndex] ?? null;

  const loadImages = useCallback(
    async (index: number) => {
      const target = chapters[index];
      if (!target) return;
      setLoading(true);
      setError(null);
      setChapterIndex(index);
      // Android: 「继续阅读 · 第12话 · 第8页」精确回到上次位置 → L75 initialPage
      setInitialPage(0);
      try {
        if (source?.id.startsWith('demo-') === true) {
          setImageUrls(DEMO_BOOK.pages[target.id] ?? []);
          return;
        }
        if (source === null || target.url === '') {
          setImageUrls([]);
          showToast('该章节缺少 URL');
          return;
        }
        const headers = parseHeaderJson(source.header);
        const http: HttpClient = platform.http;
        const res = await http.request({ url: target.url, method: 'GET', headers });
        if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${String(res.status)}`);
        const html = decodeTextWithCharsetDetection(res.body);
        const urls = extractImageUrls(html, source.ruleContent);
        setImageUrls(urls);
        if (urls.length === 0) showToast('未解析到图片');
      } catch (err) {
        setError(err instanceof Error ? err.message : '图片加载失败');
        showToast(err instanceof Error ? err.message : '图片加载失败');
      } finally {
        setLoading(false);
      }
    },
    [chapters, platform.http, source],
  );

  const searchAndOpen = useCallback(async () => {
    if (source === null) {
      showToast('请先选择书源');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (source.id.startsWith('demo-')) {
        setBookTitle(DEMO_BOOK.title);
        setChapters(DEMO_BOOK.chapters);
        setChapterIndex(0);
        setImageUrls(DEMO_BOOK.pages[DEMO_BOOK.chapters[0]?.id ?? ''] ?? []);
        showToast('已从示例源加载');
        return;
      }
      if (source.searchUrl === undefined) throw new Error('书源缺少 searchUrl');
      const headers = parseHeaderJson(source.header);
      const http: HttpClient = platform.http;
      const searchUrl = applyTemplate(source.searchUrl, keyword);
      const searchRes = await http.request({ url: searchUrl, method: 'GET', headers });
      if (searchRes.status < 200 || searchRes.status >= 300) {
        throw new Error(`HTTP ${String(searchRes.status)}`);
      }
      const searchHtml = decodeTextWithCharsetDetection(searchRes.body);
      const parsed = extractChapters(searchHtml);
      setBookTitle(keyword);
      setChapters(parsed);
      setChapterIndex(0);
      if (parsed.length > 0 && parsed[0]?.url !== undefined && parsed[0].url !== '') {
        const chapterRes = await http.request({ url: parsed[0].url, method: 'GET', headers });
        const chapterHtml = decodeTextWithCharsetDetection(chapterRes.body);
        setImageUrls(extractImageUrls(chapterHtml, source.ruleContent));
      } else {
        setImageUrls([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      showToast(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [keyword, platform.http, source]);

  useEffect(() => {
    if (source === null) return undefined;
    if (source.id.startsWith('demo-') && chapters.length === 0) {
      const t = setTimeout(() => {
        void searchAndOpen();
      }, 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [chapters.length, searchAndOpen, source]);

  return (
    <div className="comic-reader-online-page">
      {/* Shell chrome: chapter switcher (the engine owns the in-reader UI). */}
      <div className="comic-reader-online-page__shell">
        <button
          type="button"
          className="reader-icon-btn"
          onClick={() => setRoute('comicChapters')}
          aria-label="返回"
        >
          ‹
        </button>
        <h1 className="reader-chapter-title">
          {chapter !== null ? chapter.title : bookTitle !== '' ? bookTitle : '在线漫画'}
        </h1>
        {chapters.length > 0 ? (
          <span className="comic-reader-online-page__count">
            {imageUrls.length > 0 ? `${String(imageUrls.length)} 页` : ''}
          </span>
        ) : null}
      </div>

      {chapters.length > 0 ? (
        <div className="comic-reader-online-page__chapters">
          <select
            value={String(chapterIndex)}
            onChange={(event) => void loadImages(Number(event.target.value))}
            className="comic-reader-online-page__select"
            aria-label="选择章节"
          >
            {chapters.map((item, index) => (
              <option key={item.id} value={String(index)}>
                {item.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="reader-icon-btn"
            disabled={chapterIndex <= 0}
            onClick={() => void loadImages(chapterIndex - 1)}
            aria-label="上一话"
          >
            ‹
          </button>
          <button
            type="button"
            className="reader-icon-btn"
            disabled={chapterIndex >= chapters.length - 1}
            onClick={() => void loadImages(chapterIndex + 1)}
            aria-label="下一话"
          >
            ›
          </button>
        </div>
      ) : null}

      {/* OnlineComicReaderScreen.kt port (Kotlin L43-210). */}
      <OnlineComicReaderPage
        title={chapter !== null ? chapter.title : bookTitle !== '' ? bookTitle : '在线漫画'}
        imageUrls={imageUrls}
        loading={loading}
        error={error}
        bookTitle={bookTitle !== '' ? bookTitle : null}
        chapters={chapters.map((item) => ({ id: item.id, title: item.title }))}
        currentChapterIndex={chapterIndex}
        initialPage={initialPage}
        onJumpToChapter={(index) => void loadImages(index)}
        onPrevChapter={
          chapterIndex > 0
            ? () => {
                void loadImages(chapterIndex - 1);
              }
            : null
        }
        onNextChapter={
          chapterIndex < chapters.length - 1
            ? () => {
                void loadImages(chapterIndex + 1);
              }
            : null
        }
        onBack={() => setRoute('comicChapters')}
        onRetry={() => void loadImages(chapterIndex)}
      />
    </div>
  );
}
