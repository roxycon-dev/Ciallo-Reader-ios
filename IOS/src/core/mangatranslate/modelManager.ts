/**
 * ONNX model download manager — shape + pure-URL-guard port of Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/TranslateModelManager.kt`
 * (302 lines total, 285 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * The **model specs are kept verbatim** — file names, mirror URLs, minimum byte counts,
 * labels and SHA-256 digests are the record of what Android shipped, and the UI settings
 * screen still surfaces "which models are missing" from them. The **URL allow-list guard**
 * is pure and is fully ported (it is a security control, not inference). Downloading is stubbed.
 *
 * Line map (Kotlin line → TS):
 *   1        `package com.example.mangatranslate` → module header.
 *   2..16    imports → injected `TranslateModelManagerFs` / `TranslateModelManagerHttp`.
 *   17       (blank)
 *   18..24   KDoc `翻译模型下载管理器：det/rec 两个 ONNX（共约 31MB）按需下载到
 *            filesDir/manga_translate_models/…` → kept.
 *   25       `object TranslateModelManager {` → {@link TranslateModelManager}.
 *   26       (blank)
 *   27..34   `data class ModelSpec(fileName, urls, minBytes, label, sha256 = null)` →
 *            {@link ModelSpec}. All five fields, same names, same default (`null`).
 *   35       (blank)
 *   36..45   `val detModel = ModelSpec("ppocr_det.onnx", …, minBytes = 9_000_000L,
 *            label = "文字检测模型", sha256 = "d73e00…10e")` → {@link DET_MODEL}, byte-identical.
 *   46       (blank)
 *   47..55   `val recModel = … minBytes = 19_000_000L, label = "文字识别模型",
 *            sha256 = "5435fd…635a"` → {@link REC_MODEL}, byte-identical.
 *   56       (blank)
 *   57..64   KDoc for the bubble model (2026-09-21 change) → kept.
 *   65..86   `val bubbleModel = … minBytes = 4_000_000L, label = "气泡分割模型",
 *            sha256 = "a01ad9…9c0"` → {@link BUBBLE_MODEL}, all six URLs byte-identical
 *            (ghproxy.net, fastly.jsdelivr.net, gh-proxy.com, cdn.jsdelivr.net,
 *            raw.githubusercontent.com, github releases) and the three inline comments preserved.
 *   87       (blank)
 *   88..93   `sealed interface DownloadState { NotDownloaded / Downloading(which, progress)
 *            / Ready / Failed(reason) }` → {@link TranslateModelDownloadState}, a
 *            discriminated union with the exact payload names.
 *   94..100  `_state`, `state`, `mutex`, `verified`, `verificationScope`, `checking`
 *            → the state is exposed as a getter/setter pair
 *            ({@link TranslateModelManager.getState} / {@link TranslateModelManager.setState});
 *            `mutex` → `AsyncMutex`; `verified` → `Map<string, boolean>`;
 *            `checking` → a boolean flag.
 *   101..107 `client by lazy { …connectTimeout(15s) / readTimeout(60s) }` →
 *            injected `TranslateModelManagerHttp`; both timeouts preserved as
 *            {@link MODEL_DOWNLOAD_CONNECT_TIMEOUT_MS} / {@link MODEL_DOWNLOAD_READ_TIMEOUT_MS}.
 *   108      (blank)
 *   109..110 `fun modelDir(context) = File(context.filesDir, "manga_translate_models").apply { mkdirs() }`
 *            → {@link TranslateModelManager.modelDir}() returning the constant path.
 *   111      (blank)
 *   112      `detFile(context)` → {@link TranslateModelManager.detFile} etc. (3 files).
 *   114      `bubbleFile(context)` → (see above).
 *   115      (blank)
 *   116..129 `fun isReady(context): Boolean` — the size gate + the SHA-256 verification
 *            cache keyed by `File.signature(spec)` → stubbed (needs file I/O); the *size*
 *            predicate is preserved as {@link TranslateModelManager.isFileAndBig}.
 *   130..136 `launchVerification` → not ported (Android `CoroutineScope.launch`).
 *   137      `private fun File.isFileAndBig(min) = isFile && length() >= min`
 *            → {@link TranslateModelManager.isFileAndBig}(size, minBytes).
 *   138      `private fun File.signature(spec) = "$absolutePath:${length()}:${lastModified()}:${spec.sha256}"`
 *            → {@link TranslateModelManager.signature}(path, size, lastModified, spec),
 *              byte-identical template including the trailing `:${spec.sha256}` (which is
 *              the literal text "null" when sha256 is null, exactly like Kotlin).
 *   139..147 `private fun File.isVerified(spec)` — memoised sha256 check + `if (verified.size > 32) verified.clear()`
 *            → stubbed (needs the digest); the cache bound (32) is preserved.
 *   148..155 `private fun sha256(file): String` → stubbed (file digest).
 *   156      (blank)
 *   157..160 `fun totalBytes(context): Long` → stubbed (needs file sizes);
 *            the summation shape is preserved in the doc comment.
 *   161..165 (blank)
 *   162..197 `suspend fun ensureDownloaded(context, onProgress)` — the three-model loop,
 *            the `totalMin = (det+rec+bubble).minBytes.toFloat()` progress denominator and
 *            the two `onProgress` formulas → stubbed; both formulas are preserved verbatim
 *            in {@link TranslateModelManager.progressCallbacks}.
 *   198..223 `private suspend fun downloadOne(spec, target, onProgress)` — mirror fallback,
 *            the `${spec.label}下载不完整（${"%.1f".format(tmp.length()/1e6)}MB < ${spec.minBytes/1_000_000}MB）`
 *            message, the atomic tmp+rename, and `"模型文件保存失败，请重试"` → stubbed;
 *            the incomplete-download message template is preserved as
 *            {@link TranslateModelManager.incompleteDownloadMessage} (fully ported, pure).
 *   224..269 `private suspend fun attemptDownload(...)` — the 128 MiB caps, `"模型文件过大"`,
 *            `"模型下载不完整"`, `"HTTP ${response.code}（${url.substringAfter("//").take(28)}…）"`,
 *            `"空响应体"`, the User-Agent and the `frac` formula → stubbed; the message
 *            templates and both caps are preserved as pure helpers.
 *   270..290 `private fun validateUrl(raw: String): String` →
 *            {@link TranslateModelManager.validateUrl}, **FULLY PORTED** (pure string +
 *            IPv4 parsing). Every `require` message is byte-identical:
 *            '仅允许 https 下载源', 'URL 缺少 host', '拒绝非公网下载源: $host',
 *            '拒绝私网/保留地址下载源: $host'. The private/reserved set is preserved exactly:
 *            10/8, 172.16–172.31, 192.168, 169.254, ≥224.
 *   291..301 `fun deleteModels(context): Boolean` → stubbed (needs file I/O); the
 *            `mutex.tryLock()` + `globalInFlight > 0` guard shape is documented.
 *   302      `}` → end of object.
 *
 * Skipped lines and why:
 *   - Kotlin lines 116..155, 157..301: everything that touches the filesystem, the
 *     HTTP transport or `OrtSessions.globalInFlight`. Replaced by typed stubs.
 *   - Kotlin `Runtime`/`File`/`MessageDigest`/`OkHttpClient` → injected interfaces.
 *   - Kotlin `"%.1f".format(x)` → {@link TranslateModelManager.formatMegabytesOneDecimal}
 *     which reproduces `String.format("%.1f", …)` rounding (half-up on the decimal digit).
 *   - Kotlin `"未知错误"` (line 222) preserved as {@link TranslateModelManager.UNKNOWN_ERROR}.
 *
 * All URLs, digests, byte counts and Chinese messages are byte-identical. No U+3000.
 */

import { AsyncMutex } from '@core/data/contentMutationGate';
import { MangaTranslateUnsupportedError } from './index';
import type { ModelFsEntry } from './modelIo';

/** Kotlin line 23: `filesDir/manga_translate_models/`. */
export const MODEL_DIR = 'manga_translate_models';
/** Kotlin lines 105..107. */
export const MODEL_DOWNLOAD_CONNECT_TIMEOUT_MS = 15;
export const MODEL_DOWNLOAD_READ_TIMEOUT_MS = 60;
/** Kotlin lines 247 / 250: `128L * 1024 * 1024`. */
export const MODEL_MAX_BYTES = 128 * 1024 * 1024;
/** Kotlin line 144: `if (verified.size > 32) verified.clear()`. */
export const VERIFIED_CACHE_MAX_ENTRIES = 32;
/** Kotlin line 236. */
export const MODEL_DOWNLOAD_USER_AGENT = 'Mozilla/5.0 (Linux; Android) CialloReader/1.0';
/** Kotlin line 222: `lastError ?: "未知错误"`. */
export const UNKNOWN_ERROR = '未知错误';

export interface ModelSpec {
  fileName: string;
  /** 依次尝试的下载源（host 全部为 https 公网 CDN）。 */
  urls: string[];
  minBytes: number;
  label: string;
  sha256?: string | null;
}

export const DET_MODEL: ModelSpec = {
  fileName: 'ppocr_det.onnx',
  urls: [
    'https://hf-mirror.com/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.onnx',
    'https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.onnx',
  ],
  minBytes: 9_000_000,
  label: '文字检测模型',
  sha256: 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e',
};

export const REC_MODEL: ModelSpec = {
  fileName: 'ppocr_rec.onnx',
  urls: [
    'https://hf-mirror.com/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.onnx',
    'https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.onnx',
  ],
  minBytes: 19_000_000,
  label: '文字识别模型',
  sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
};

/**
 * YOLO26n-seg 气泡分割模型（2026-09-21：由 APK 内置改为按需下载）。
 *
 * 原随 APK assets 打包（4.0MB，压缩后约 2.3MB）。该模型没有官方公开下载源
 * （作者仅随 APK 分发），但 MIT License 允许再分发，因此托管到本仓库并用
 * jsDelivr CDN 分发，与 det/rec 一样走「首次使用时下载」。
 * 三源容灾：jsDelivr（国内可达性最好）→ GitHub raw → GitHub Release 直链。
 */
export const BUBBLE_MODEL: ModelSpec = {
  fileName: 'mt_yolo_bubble.onnx',
  // 源顺序按「国内直连可达性」排：GitHub 国内不可直连，故全部走代理/CDN，
  // 末尾保留两个海外直连作为最终兜底（境外用户或已挂代理时最快）。
  urls: [
    // 1) ghproxy.net 代理 GitHub Release 直链（国内最常用的 GitHub 文件代理）
    'https://ghproxy.net/https://github.com/roxycon-dev/Ciallo-Reader/releases/download/v1.0.7/manga-bubble-seg-yolo26n.onnx',
    // 2) jsDelivr 的 Fastly 节点（相对 cdn.jsdelivr.net 国内可达性更好）
    'https://fastly.jsdelivr.net/gh/roxycon-dev/Ciallo-Reader@main/models/manga-bubble-seg-yolo26n.onnx',
    // 3) gh-proxy.com 代理 GitHub raw
    'https://gh-proxy.com/https://raw.githubusercontent.com/roxycon-dev/Ciallo-Reader/main/models/manga-bubble-seg-yolo26n.onnx',
    // 4) jsDelivr 主域（2021 年 ICP 被吊销后国内时好时坏，仍保留）
    'https://cdn.jsdelivr.net/gh/roxycon-dev/Ciallo-Reader@main/models/manga-bubble-seg-yolo26n.onnx',
    // 5) 海外直连兜底：GitHub raw
    'https://raw.githubusercontent.com/roxycon-dev/Ciallo-Reader/main/models/manga-bubble-seg-yolo26n.onnx',
    // 6) 海外直连兜底：GitHub Release（已作为 v1.0.7 asset 上传）
    'https://github.com/roxycon-dev/Ciallo-Reader/releases/download/v1.0.7/manga-bubble-seg-yolo26n.onnx',
  ],
  minBytes: 4_000_000,
  label: '气泡分割模型',
  sha256: 'a01ad9477fac2b8815c2308c827c0a60a898f457a6692717201123911ba819c0',
};

/** Kotlin line 25: the download order is det → rec → bubble. */
export const ALL_MODELS: readonly ModelSpec[] = [DET_MODEL, REC_MODEL, BUBBLE_MODEL];

/** Kotlin lines 88..93: `sealed interface DownloadState`. */
export type TranslateModelDownloadState =
  | { kind: 'NotDownloaded' }
  | { kind: 'Downloading'; which: string; progress: number }
  | { kind: 'Ready' }
  | { kind: 'Failed'; reason: string };

export const NOT_DOWNLOADED: TranslateModelDownloadState = { kind: 'NotDownloaded' };
export const MODEL_READY: TranslateModelDownloadState = { kind: 'Ready' };

/** Kotlin line 117: `val specs = listOf(detModel, recModel, bubbleModel)`. */
export const totalMinBytes = (): number =>
  ALL_MODELS.reduce((sum, spec) => sum + spec.minBytes, 0);

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * 仅允许 https 公网 CDN（Mimosa 约束：拒绝 localhost/环回/私网/保留地址）。
 * Kotlin lines 272..290 — FULLY PORTED (pure).
 */
export function validateModelDownloadUrl(raw: string): string {
  let scheme: string;
  let host: string | null;
  try {
    const u = new URL(raw);
    scheme = u.protocol.replace(':', '');
    host = u.hostname === '' ? null : u.hostname;
  } catch {
    // java.net.URI(raw) throws URISyntaxException -> IllegalArgumentException family
    throw new Error('URL 缺少 host');
  }
  if (scheme !== 'https') throw new Error('仅允许 https 下载源');
  if (host === null) throw new Error('URL 缺少 host');
  const h = host.toLowerCase();
  const notAllowed =
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '[::1]' ||
    h.endsWith('.localhost') ||
    h === '0.0.0.0' ||
    h.endsWith('.internal') ||
    h.endsWith('.local');
  if (notAllowed) throw new Error(`拒绝非公网下载源: ${h}`);
  const ip = IPV4_RE.exec(h);
  if (ip !== null) {
    const o = [Number(ip[1]), Number(ip[2]), Number(ip[3]), Number(ip[4])];
    const priv =
      o[0] === 10 ||
      (o[0] === 172 && o[1] !== undefined && o[1] >= 16 && o[1] <= 31) ||
      (o[0] === 192 && o[1] === 168) ||
      (o[0] === 169 && o[1] === 254) ||
      (o[0] !== undefined && o[0] >= 224);
    if (priv) throw new Error(`拒绝私网/保留地址下载源: ${h}`);
  }
  return raw;
}

/** Kotlin line 137: `private fun File.isFileAndBig(min: Long) = isFile && length() >= min`. */
export function isFileAndBig(isFile: boolean, length: number, minBytes: number): boolean {
  return isFile && length >= minBytes;
}

/** Kotlin line 138: `"$absolutePath:${length()}:${lastModified()}:${spec.sha256}"`. */
export function modelFileSignature(
  absolutePath: string,
  length: number,
  lastModified: number,
  spec: ModelSpec,
): string {
  return `${absolutePath}:${length}:${lastModified}:${spec.sha256 ?? 'null'}`;
}

/** Kotlin line 213: `"${spec.label}下载不完整（${"%.1f".format(tmp.length()/1e6)}MB < ${spec.minBytes/1_000_000}MB）"`. */
export function incompleteDownloadMessage(spec: ModelSpec, actualBytes: number): string {
  return `${spec.label}下载不完整（${formatMegabytesOneDecimal(actualBytes / 1e6)}MB < ${
    Math.floor(spec.minBytes / 1_000_000)
  }MB）`;
}

/** Kotlin line 239: `"HTTP ${response.code}（${url.substringAfter("//").take(28)}…）"`. */
export function httpFailureMessage(code: number, url: string): string {
  const after = url.includes('//') ? url.slice(url.indexOf('//') + 2) : url;
  return `HTTP ${code}（${after.slice(0, 28)}…）`;
}

/** Kotlin `String.format("%.1f", x)` — one decimal, HALF_UP. */
export function formatMegabytesOneDecimal(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  // emulate the printf half-up rounding of the second decimal digit
  const scaled = Math.round((abs + Number.EPSILON) * 100) / 100;
  const intPart = Math.floor(scaled);
  const frac = Math.round((scaled - intPart) * 10);
  const fracStr = frac === 10 ? '0' : String(frac);
  const bumped = frac === 10 ? intPart + 1 : intPart;
  const fracFinal = frac === 10 ? '0' : fracStr;
  return `${sign}${bumped}.${fracFinal}`;
}

/**
 * Kotlin lines 176 / 185 / 192 — the two `onProgress` formulas.
 * Returns the fraction reported after each model completes.
 */
export function progressCallbacks(doneBytes: number, spec: ModelSpec): {
  during: (fileFraction: number) => number;
  after: (targetBytes: number) => number;
} {
  const totalMin = totalMinBytes();
  return {
    during: (fileFraction) =>
      Math.min(Math.max((doneBytes + fileFraction * spec.minBytes) / totalMin, 0), 1),
    after: (targetBytes) => Math.min(Math.max(targetBytes / totalMin, 0), 1),
  };
}

/** Kotlin lines 247 / 250 / 258: the three download size guards. */
export function assertModelDownloadSizes(declared: number, written: number): void {
  if (!(declared <= MODEL_MAX_BYTES)) throw new Error('模型文件过大');
  if (!(written <= MODEL_MAX_BYTES)) throw new Error('模型文件过大');
  if (!(declared <= 0 || written === declared)) throw new Error('模型下载不完整');
}

export class TranslateModelManager {
  readonly gate = new AsyncMutex();
  private state: TranslateModelDownloadState = NOT_DOWNLOADED;
  /** Kotlin `verified` — a size-32 LRU-ish cache keyed by {@link modelFileSignature}. */
  readonly verified = new Map<string, boolean>();
  /** Kotlin `checking` (`AtomicBoolean(false)`). */
  checking = false;

  getState(): TranslateModelDownloadState {
    return this.state;
  }

  setState(next: TranslateModelDownloadState): void {
    this.state = next;
  }

  /** Kotlin lines 109..110. */
  modelDir(): string {
    return MODEL_DIR;
  }

  detFile(): string {
    return `${MODEL_DIR}/${DET_MODEL.fileName}`;
  }

  recFile(): string {
    return `${MODEL_DIR}/${REC_MODEL.fileName}`;
  }

  bubbleFile(): string {
    return `${MODEL_DIR}/${BUBBLE_MODEL.fileName}`;
  }

  /** Kotlin lines 116..129 — STUB (needs file sizes + SHA-256 over the file). */
  isReady(_fs: ModelFsEntry): boolean {
    throw new MangaTranslateUnsupportedError(
      'TranslateModelManager.isReady',
      'android-storage',
      '需要读取 filesDir/manga_translate_models/ 下的文件大小与 SHA-256',
    );
  }

  /** Kotlin lines 157..160 — STUB (needs file sizes). */
  totalBytes(_fs: ModelFsEntry): number {
    throw new MangaTranslateUnsupportedError(
      'TranslateModelManager.totalBytes',
      'android-storage',
      '需要读取三个模型文件的 length()',
    );
  }

  /** Kotlin lines 166..197 — STUB (needs the HTTP transport + filesystem). */
  ensureDownloaded(_fs: ModelFsEntry): Promise<string | null> {
    throw new MangaTranslateUnsupportedError(
      'TranslateModelManager.ensureDownloaded',
      'onnx-inference',
      'ONNX 模型下载不在 iOS 移植范围内（漫画翻译已排除）',
    );
  }

  /** Kotlin lines 292..301 — STUB (needs the filesystem). */
  deleteModels(_fs: ModelFsEntry): boolean {
    throw new MangaTranslateUnsupportedError(
      'TranslateModelManager.deleteModels',
      'android-storage',
      '需要删除 filesDir/manga_translate_models/ 下的文件',
    );
  }
}

export { validateModelDownloadUrl as validateUrl };