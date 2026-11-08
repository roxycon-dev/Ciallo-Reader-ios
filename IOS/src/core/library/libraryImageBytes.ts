/**
 * Port of Android `com.example.library.ImageBytes.kt` (144 lines, 112 non-blank)
 * and `com.example.library.MhttuImageDecryptor.kt` (47 lines, 34 non-blank).
 *
 * Ported: 146 / 146 non-blank lines.
 *
 * Skipped lines (each with reason):
 * - ImageBytes.kt:3-11   `android.graphics.Bitmap`, `BitmapFactory`, `android.os.Build`,
 *   `android.util.Log`, `java.io.*`, `java.nio.ByteBuffer`, `java.util.zip.GZIPInputStream`
 *   — Android/Java APIs. `BitmapFactory` bounds decoding is replaced by the shared
 *   pure-TS header probe `probeImageSize()` from `@core/parser/imageBytes` (which is
 *   itself the port of `BitmapFactory.Options(inJustDecodeBounds)`); `Log` becomes an
 *   injected sink; gzip becomes the platform `DecompressionStream`; brotli and AVIF
 *   re-encoding have no built-in decoder and are kept as injected hooks.
 * - ImageBytes.kt:57-68 the `Build.VERSION.SDK_INT >= 28` `ImageDecoder` → PNG branch —
 *   there is no platform AVIF decoder in the web/iOS WebView runtime. It is preserved
 *   as the injected `avifToPng` hook (a host app may wire `sharp`/`@jsquash/avif`);
 *   when no hook is supplied the original bytes are returned, exactly like the
 *   `catch (e) { Log.w(...); result }` fallback at line 72-75.
 * - ImageBytes.kt:81-97 `Build.VERSION.SDK_INT >= 30` `BrotliInputStream` branch — same
 *   reason; preserved as the injected `brotliDecompress` hook (default: `null`, which is
 *   the Android SDK < 30 behaviour the branch already returns).
 * - ImageBytes.kt:18 `private val normalizationLock = Any()` and line 48
 *   `= synchronized(normalizationLock)` — the lock serialises BitmapFactory work on the
 *   JVM; JS is single-threaded and every step is synchronous, so no lock is required.
 * - ImageBytes.kt:19 `expandedLimit = minOf(32MB, Runtime.maxMemory()/12)` — no heap
 *   introspection in the browser; the JVM-relative term is dropped and the 32 MB cap
 *   (which is the binding limit on any realistic device) is kept verbatim.
 * - MhttuImageDecryptor.kt:3-4 `javax.crypto.*` — the decrypt primitive is the injected
 *   `CryptoPort` from `@platform/interfaces` (`decryptAesCbc`), implemented once in
 *   `platform/web/webCrypto.ts` on WebCrypto (WKWebView ships `crypto.subtle` natively,
 *   so **one implementation covers both web and iOS** — no Capacitor plugin needed).
 *   NOTE: an earlier revision of this comment claimed WebCrypto cannot do this. That is
 *   **wrong** — `crypto.subtle` supports `{name:'AES-CBC'}` with a 16/24/32 byte key (this
 *   one is 32) and applies PKCS#7 un-padding on decrypt, which is exactly Android's
 *   `AES/CBC/PKCS5Padding`. The only real difference is that `subtle.decrypt` is
 *   **asynchronous** while `javax.crypto.Cipher.doFinal` is synchronous, so
 *   `decryptIfNeeded` is `async` and its callers await it (E83, closed 2026-10-07).
 * - MhttuImageDecryptor.kt:46 `private fun isImageBytes(data)` — hoisted into
 *   `imageExtension(data) !== null` at the call site (Kotlin inlined it already).
 *
 * Platform adaptations:
 * - `ByteArray` → `Uint8Array`.
 * - `GZIPInputStream` → `DecompressionStream('gzip')` with a manual read loop.
 * - `Object.synchronized` / `Any()` → no-op (see above).
 * - `Log.i(TAG, …)` / `Log.w(TAG, …, e)` → `log(tag, message)` / `logWarn(tag, message, e)`
 *   sink (default `console.warn`-free no-op so core stays silent in tests).
 * - `Regex("""//(a|w)(\d*)\.(gold-usergeneratedcontent\.net|hitomi\.la)/""")` —
 *   verbatim regex, JS-compatible syntax.
 * - Kotlin `0xFF.toByte()` (signed byte) → the unsigned 0xFF/0xD8… comparisons.
 */

import { probeImageSize } from '@core/parser/imageBytes';
import type { AsyncCryptoPort } from '@platform/interfaces';

/** Android `private const val TAG = "ComicDownload"` / `"ImageBytes"`. */
export const IMAGE_BYTES_TAG = 'ImageBytes';

export interface ImageBytesHooks {
  /** Kotlin `brotliDecompress(bytes)` → `ByteArray?`. */
  brotliDecompress?: (bytes: Uint8Array) => Promise<Uint8Array | null>;
  /** Kotlin `ImageDecoder.decodeBitmap` → PNG. Absent ⇒ behave like SDK < 28. */
  avifToPng?: (bytes: Uint8Array, expandedLimit: number) => Promise<Uint8Array | null>;
  /** Android `Log.i` / `Log.w`. */
  log?: (tag: string, message: string) => void;
  logWarn?: (tag: string, message: string, error: unknown) => void;
  /** Kotlin `Runtime.getRuntime().maxMemory()` override for the expanded-size cap. */
  maxMemory?: number;
}

const GZIP_MAGIC: readonly number[] = [0x1f, 0x8b];

/** Kotlin `private val expandedLimit: Long get() = minOf(32L*1024*1024, Runtime.maxMemory()/12)`. */
function expandedLimitOf(hooks: ImageBytesHooks): number {
  const maxMemory = hooks.maxMemory ?? Number.POSITIVE_INFINITY;
  return Math.min(32 * 1024 * 1024, Math.floor(maxMemory / 12));
}

/**
 * 部分图源（禁漫天堂等）脚本自带 Accept-Encoding: gzip，
 * OkHttp 不再透明解压，图片字节实际是 gzip 流，解码前必须先解压。
 */
export async function gunzipIfNeeded(
  bytes: Uint8Array,
  hooks: ImageBytesHooks = {},
): Promise<Uint8Array> {
  if (
    bytes.length < 2 ||
    bytes[0] !== GZIP_MAGIC[0] ||
    bytes[1] !== GZIP_MAGIC[1]
  ) {
    return bytes;
  }
  const limit = expandedLimitOf(hooks);
  try {
    const stream = new DecompressionStream('gzip');
    // `writer.write` is typed against a `BufferSource`; the Uint8Array view is
    // already one, so the cast only silences the DOM lib's ArrayBufferView overload.
    const writer = stream.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
    void writer.write(bytes);
    void writer.close();
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      // Kotlin `while (true) { val read = input.read(buffer); if (read < 0) break; … }`
      const { done, value } = await reader.read();
      if (done || value === undefined) break;
      total += value.length;
      if (total > limit) throw new Error('图片解压体积过大');
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  } catch {
    return bytes;
  }
}

/** 图片字节统一归一化：gzip 解压 + AVIF 转 PNG（BitmapFactory 在部分设备不支持 AVIF）。 */
export async function normalizeImage(
  bytes: Uint8Array,
  contentEncoding: string | null = null,
  hooks: ImageBytesHooks = {},
): Promise<Uint8Array> {
  if (bytes.length > 32 * 1024 * 1024) throw new Error('图片文件过大');
  let result: Uint8Array;
  if (contentEncoding !== null && contentEncoding.toLowerCase().includes('br')) {
    result = (await brotliDecompress(bytes, hooks)) ?? bytes;
  } else {
    result = await gunzipIfNeeded(bytes, hooks);
  }
  if (isAvif(result)) {
    try {
      // Kotlin ImageBytes.kt:60 `minOf(32L*1024*1024, Runtime.maxMemory()/8) / 4`
      // — the `/4` divides the RESULT of `minOf`, it is not part of the second argument.
      const limit =
        Math.min(
          32 * 1024 * 1024,
          Math.floor((hooks.maxMemory ?? Number.POSITIVE_INFINITY) / 8),
        ) / 4;
      const decoded =
        hooks.avifToPng !== undefined ? await hooks.avifToPng(result, limit) : null;
      // Kotlin `ImageDecoder` → `bmp.compress(PNG)`; the `catch` arm keeps `result`.
      if (decoded !== null) result = decoded;
    } catch (e) {
      (hooks.logWarn ?? (() => {}))('ImageBytes', 'avif decode failed', e);
    }
  }
  return result;
}

/** Kotlin `private fun brotliDecompress(bytes): ByteArray?`. */
async function brotliDecompress(
  bytes: Uint8Array,
  hooks: ImageBytesHooks,
): Promise<Uint8Array | null> {
  try {
    if (hooks.brotliDecompress !== undefined) {
      return await hooks.brotliDecompress(bytes);
    }
    return null;
  } catch {
    return null;
  }
}

export function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ftyp =
    bytes[4] === 0x66 /* f */ &&
    bytes[5] === 0x74 /* t */ &&
    bytes[6] === 0x79 /* y */ &&
    bytes[7] === 0x70 /* p */;
  if (!ftyp) return false;
  let brand = '';
  for (let i = 8; i < 12; i += 1) {
    brand += String.fromCharCode(bytes[i] as number);
  }
  return brand === 'avif' || brand === 'avis';
}

/** 尝试用 BitmapFactory 解码，判断图片字节是否可用。 */
export function decodeOk(bytes: Uint8Array): boolean {
  return probeImageSize(bytes) !== null;
}

/**
 * hitomi 类图源会返回平台解不了的 AVIF；
 * 按 hitomi 域名规则生成 webp 变体候选（w 子域 + .webp 后缀）。
 */
export function webpVariants(url: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const hostPattern = /\/\/(a|w)(\d*)\.(gold-usergeneratedcontent\.net|hitomi\.la)\//;
  const m = hostPattern.exec(url);
  if (m === null) return [];
  // Kotlin keeps `val suffix = m.groupValues[1]` (the "a"/"w" lane) but never reads
  // it, so the local is dropped here rather than carried as a dead variable.
  const digits = m[2] as string;
  const domain = m[3] as string;
  const rest = url.slice(m.index + m[0].length);
  let baseNoExt = rest;
  if (baseNoExt.endsWith('.avif')) baseNoExt = baseNoExt.slice(0, -5);
  if (baseNoExt.endsWith('.webp')) baseNoExt = baseNoExt.slice(0, -5);
  // 原域名换扩展
  out.push(`https://a${digits}.${domain}/${baseNoExt}.webp`);
  // w 子域 + 无扩展 / 带 .webp
  out.push(`https://w${digits}.${domain}/${baseNoExt}`);
  out.push(`https://w${digits}.${domain}/${baseNoExt}.webp`);
  // 无数字的 w 子域
  out.push(`https://w.${domain}/${baseNoExt}`);
  out.push(`https://w.${domain}/${baseNoExt}.webp`);
  // Kotlin `LinkedHashSet` → insertion-ordered dedupe.
  return out.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

/* ───────────── MhttuImageDecryptor.kt ───────────── */

/**
 * 漫蛙吧图床（tu.mhttu.cc）图片解密。
 * 站点前端逻辑：AES-256-CBC，密钥 = "0B6666A0-BB59-1381-B746-a0E4C9AC" 前 32 字节，
 * IV = 文件前 16 字节，密文 = 文件第 17 字节起；已解出的为 WebP/JPEG 图片。
 */

/** Kotlin `private val keyBytes = "0B6666A0-BB59-1381-B746-a0E4C9AC".toByteArray(UTF_8).copyOf(32)`. */
export const MHTTU_KEY_SOURCE = '0B6666A0-BB59-1381-B746-a0E4C9AC';

export function mhttuKeyBytes(): Uint8Array {
  const raw = new TextEncoder().encode(MHTTU_KEY_SOURCE);
  return raw.slice(0, 32);
}

export function isEncryptedHost(host: string): boolean {
  return host === 'tu.mhttu.cc' || host === 'mhttu.cc' || host.endsWith('.mhttu.cc');
}

/**
 * Android `library/MhttuImageDecryptor.kt:20-33`
 *
 * ```kotlin
 * fun decryptIfNeeded(data: ByteArray): ByteArray {
 *     if (data.size <= 16 || isImageBytes(data)) return data
 *     return try {
 *         val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
 *         cipher.init(DECRYPT_MODE, SecretKeySpec(keyBytes, "AES"), IvParameterSpec(data.copyOfRange(0, 16)))
 *         cipher.doFinal(data.copyOfRange(16, data.size))
 *     } catch (e: Exception) { data }
 * }
 * ```
 *
 * **async 是唯一的平台差异**：Java 的 `Cipher.doFinal` 同步，WebCrypto 的 `subtle.decrypt`
 * 返回 Promise。分支顺序、IV/密文切分、`catch → 原样返回` 与 Kotlin 逐行一致。
 *
 * @param crypto Android `javax.crypto.Cipher`。**必须提供** —— 没有它就等于
 *   「从未尝试解密」，那不是 Kotlin 的 `catch` 回落语义（Kotlin 是尝试后失败才回落）。
 *   调用方（`libraryComicLocalImporter` / `ComicReaderOnlinePage`）从宿主注入。
 */
export async function decryptIfNeeded(
  data: Uint8Array,
  crypto: AsyncCryptoPort,
): Promise<Uint8Array> {
  // Kotlin L21 `if (data.size <= 16 || isImageBytes(data)) return data`
  if (data.length <= 16 || isImageBytes(data)) return data;
  try {
    // Kotlin L27 `IvParameterSpec(data.copyOfRange(0, 16))`
    const iv = data.slice(0, 16);
    // Kotlin L29 `cipher.doFinal(data.copyOfRange(16, data.size))`
    const ciphertext = data.slice(16, data.length);
    return await crypto.decryptAesCbc(mhttuKeyBytes(), iv, ciphertext);
  } catch {
    // Kotlin L30-31 `catch (e: Exception) { data }`
    return data;
  }
}

export function imageExtension(data: Uint8Array): string | null {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) return 'jpg';
  if (
    data.length >= 4 &&
    data[0] === 0x52 /* R */ &&
    data[1] === 0x49 /* I */ &&
    data[2] === 0x46 /* F */ &&
    data[3] === 0x46 /* F */
  ) {
    return 'webp';
  }
  if (
    data.length >= 4 &&
    data[0] === 0x89 /* ‰ */ &&
    data[1] === 0x50 /* P */ &&
    data[2] === 0x4e /* N */ &&
    data[3] === 0x47 /* G */
  ) {
    return 'png';
  }
  return null;
}

function isImageBytes(data: Uint8Array): boolean {
  return imageExtension(data) !== null;
}

/** Kotlin `object ImageBytes` call-site namespace. */
export const ImageBytes = {
  gunzipIfNeeded,
  normalizeImage,
  isAvif,
  decodeOk,
  webpVariants,
};

/** Kotlin `object MhttuImageDecryptor` call-site namespace. */
export const MhttuImageDecryptor = {
  isEncryptedHost,
  decryptIfNeeded,
  imageExtension,
};
