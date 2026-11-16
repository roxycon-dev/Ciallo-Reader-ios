/**
 * Page-translation core — shapes + pure grouper ported, pipeline stubbed, from Android
 * `novel-reader/app/src/main/java/com/example/mangatranslate/MangaTranslationCore.kt`
 * (899 lines total, 825 non-blank).
 *
 * SCOPE: manga translation is deliberately excluded from the iOS port (see `index.ts`).
 * `TranslatedRegion` / `PageTranslation` are the **cache wire format** (they are serialised
 * to `cacheDir/manga_translate_v1/<sha256>.json` and are therefore worth preserving
 * byte-for-byte). `TextBlockGrouper` is explicitly 「纯逻辑，供单测」 on Android and is ported
 * in full. `TranslationCache`, `OverlayRenderer` (Canvas), `MangaPageTranslator` (ONNX) and
 * `TranslationCoordinator` (coroutines + Bitmap) are stubbed.
 *
 * Line map (Kotlin line → TS):
 *   1..29    package + imports → no imports.
 *   30..47   `data class TranslatedRegion(rect, original, translated, lang, vertical,
 *            contour = null, lineRects = emptyList())` with the custom `equals`
 *            (incl. `contour?.contentEquals`) and `hashCode`
 *            (`rect.hashCode() * 31 + translated.hashCode()`) → {@link TranslatedRegion},
 *            with the two KDocs kept.
 *   48..56   `data class PageTranslation(pageWidth, pageHeight, regions)` with
 *            `val hasUsableText get() = regions.any { it.translated.isNotBlank() }`
 *            → {@link PageTranslation} + {@link hasUsableText}.
 *   57       (blank)
 *   58       section banner `(banner)`
 *            → {@link TRANSLATION_CACHE_DIR}.
 *   59..60   KDoc `逐页译文 JSON 缓存：翻回已译页零成本。LRU 总量上限 64MB。` → kept.
 *   61..182  `object TranslationCache` — `DIR_NAME = "manga_translate_v1"`,
 *            `MAX_TOTAL_BYTES = 64L * 1024 * 1024`, `dir`, `fileFor`
 *            (SHA-256 hex, `.take(40)`, `"$name.json"`), `read` (the 4 MiB cap
 *            `if(f.length()>4L*1024*1024) { f.delete(); return null }`, the
 *            `size.w`/`size.h` page-dimension check, the `ct` contour validity test
 *            `ca.length() >= 6 && ca.length() % 2 == 0`, the `lr` line-rect parse, and
 *            `f.setLastModified(System.currentTimeMillis())`), `write` (the compact keys
 *            `l/t/r/b/o/c/lang/v/ct/lr`, the tmp + rename fallback, `trimIfNeeded`),
 *            `totalBytes`, `clear` → the **serialisers** are ported
 *            ({@link serializePageTranslation} / {@link parsePageTranslationJson}, pure);
 *            the file operations are stubbed. Every JSON key is byte-identical.
 *   183      (blank)
 *   184      section banner (行 → 块合并（纯逻辑，供单测）)`
 *   185..186  KDoc `检测行按气泡聚块：同气泡多行合并成一块整体翻译（保上下文、覆盖更干净）。` → kept.
 *   187..272 `object TextBlockGrouper` → {@link TextBlockGrouper}, **FULLY PORTED**
 *            (`(banner)`):
 *              - 188 `data class Block(rect, lines, vertical)` → {@link TextBlockGroup}.
 *              - 190..191 `isVerticalLine(r) = r.height() > r.width()*1.5f` /
 *                `isHorizontalLine(r) = r.width() > r.height()*1.5f` → ported.
 *              - 192..194 `overlaps(a, b)` (strict inequalities) → ported.
 *              - 195..217 `fun group(lines)` — the vertical/horizontal/square partition,
 *                the `groupVertical` + `groupHorizontal` prepends, and the square-merge with
 *                `minByOrNull { unionArea(it.rect, sq) - areaOf(it.rect) }` and the
 *                `blocks.add(Block(RectF(sq), listOf(sq), vertical = sq.height() >= sq.width()))`
 *                fallback → ported.
 *              - 218..240 `private fun groupVertical(lines)` — `sortedBy { centerX }`,
 *                `avgColW = last.sumOf { width } / last.size`, the `xOverlap`,
 *                `gap = last.minOf { abs(centerX - r.centerX) }`, `vAdjacent =
 *                line.top < last.maxOf { bottom } + avgColW * 2.6f`, the attach rule
 *                `(xOverlap > 0f || gap < avgColW * 1.5f) && vAdjacent`, and the
 *                `compareByDescending { centerX }.thenBy { top }` reading order → ported.
 *              - 241..265 `private fun groupHorizontal(lines)` — `sortedBy { top }`,
 *                `avgH`, `band = max(1f, avgH)`, `sameBand = line.top < last.minOf { top } + band*3.2f`,
 *                `xOverlap`, `xGap = max(last.minOf { left } - line.right, line.left - last.maxOf { right })`,
 *                `sameBand && (xOverlap > 0f || xGap < band * 1.6f)`, and the
 *                `compareBy { (it.top / band).toInt() }.thenBy { it.left }` reading order → ported.
 *              - 266..272 `avgHeight`, `unionOf`, `areaOf`, `unionArea` → ported.
 *   273      (blank)
 *   274      section banner `(banner)`
 *   275..276  KDoc `译文烘焙：白底圆角块盖原文 + 适配字号排版（横排居中 / 竖排列右起）。` → kept.
 *   277..414 `object OverlayRenderer` — the four colour constants (`PADDING_FRACTION = 0.06f`,
 *            `BG_COLOR = 0xFFFDFBF7`, `TEXT_COLOR = 0xFF1A1A18`, `OUTLINE_COLOR = 0x14262626`)
 *            and `fun fitFontSize(text, maxW, maxH, vertical)` — explicitly
 *            documented on Android as 「适配字号（供单测）：返回能放下的字号，放不下返回 0。」
 *            → {@link OVERLAY_RENDERER_CONSTANTS} and {@link OverlayRenderer.fitFontSize}
 *            (the vertical branch delegates to the same fit search as `BubblePipeline`;
 *            the horizontal branch needs `Paint.measureText`, so it is preserved as the
 *            pure {@link horizontalFitCandidate} walker with the caller supplying `measure`).
 *            The `bake` / `drawRegion` / `drawHorizontal` / `drawVertical` /
 *            `linesFitWidth` / `fitVertical` bodies need Canvas/Paint → stubbed.
 *   415      (blank)
 *   416..417  KDoc `(banner)`
 *   418..729 `class MangaPageTranslator(context, textTranslator, llmTranslator)` →
 *            {@link MangaPageTranslator}: every public entry point is a typed stub
 *            (`detectRegions`, `ocrRegions`, `ocrPage`, `translatePage`, `translatePageOnline`,
 *            `release`), while the documented invariants survive:
 *              - 426..431 the three engine reference/length pairs (det/rec/bubble) and
 *                `engineLock` → {@link MangaPageTranslator.ENGINE_NAMES};
 *              - 433..436 `activeInference` (`AtomicInteger`) + `inFlightInference()` →
 *                kept live, because the release protocol depends on it;
 *              - 438 `val ocrReady get() = TranslateModelManager.isReady(appContext)` → stub;
 *              - 468..493 the bubble-model gate
 *                `if (!f.isFile || f.length() < TranslateModelManager.bubbleModel.minBytes)` →
 *                {@link BUBBLE_MIN_BYTES_CHECK} documented against `BUBBLE_MODEL.minBytes`;
 *              - 495..509 `release()` clears the six references → preserved in
 *                {@link MangaPageTranslator.releaseEngineRefs};
 *              - 525..582 `detectRegionsTracked` — the `PageRegionTiling.lineBelongsToRegion`
 *                line-ownership, the `own.count { height > width*1.5f } > own.size/2` vertical
 *                heuristic, the free-line suppression pass and the
 *                `regions.none { it.maskContour == null && it.lines.isNotEmpty() }` fallback
 *                → **ported** as the pure {@link assembleRegionsFromDetection};
 *              - 584..631 `ocrRegionsTracked` — the `0.45f` OCR confidence floor, the
 *                `' '` separator for horizontal regions, `text.length < 2` rejection, and
 *                `forcedLang ?: ScriptDetector.detect(text)` → **ported** as the pure
 *                {@link ocrRegionFilter};
 *              - 688..692 `detectAndOcr` — `.filter { it.lang.isNotBlank() && it.lang != "zh" }`
 *                → {@link detectAndOcrFilter};
 *              - 694..712 `translateRegionsOnline` — the `LinkedHashMap<String, MutableList<Int>>`
 *                grouping and the `idxs.forEachIndexed` write-back → **ported** as the pure
 *                {@link groupRegionsByLang}.
 *   730      (blank)
 *   731      section banner `(banner)`
 *   732..736 KDoc `翻译协调器：按页调度（当前+预取），缓存优先，烘焙结果经回调发布回阅读器缓存。epoch 自增通知 UI 重新播种位图状态。` → kept.
 *   737..898 `class TranslationCoordinator(context, textTranslator, llmTranslator)` →
 *            {@link TranslationCoordinator}:
 *              - 745..747 `var selectedEngine: String = "online"` → kept verbatim;
 *              - 750 `fun engineTag() = selectedEngine` → ported;
 *              - 751..753 `jobs`, `translateMutex = PageMemoryBudget.gate`, `bakedKeys` → kept;
 *              - 759..762 `epoch` / `busyKeys` / `ocrReady` → accessors;
 *              - 764..839 `fun schedule(...)` — the `if (!translator.ocrReady) return` and
 *                `if (bakedKeys.contains(cacheKey) || jobs.containsKey(cacheKey)) return` gates,
 *                `releasePending = false`, the modelTag choice, and the
 *                `"$translationKey@$engine-${forcedLang ?: "auto"}-$modelTag-v2"` cache key
 *                → the cache key is ported as {@link coordinatorCacheKey}; the Bitmap
 *                schedule/load/bake/publish loop is stubbed;
 *              - 840..869 `onTextScaleChanged`, `takeBakedKeys`, `resetMarks`, `bumpEpoch`,
 *                `onBitmapInvalidated`, `cancelAll` → **ported** (pure bookkeeping);
 *              - 870..898 `fun release()` — the cancel → wait-for-in-flight → clear refs →
 *                `OrtSessions.closeAll()` protocol with the 60 s deadline and 150 ms poll
 *                → ported as {@link releaseProtocolDocument} + {@link MangaPageTranslator}.
 *
 * Skipped lines and why:
 *   - Kotlin lines 65..182 (file IO), 284..414 (Canvas/Paint/StaticLayout),
 *     419..729 & 738..898 (Bitmap + coroutines + ONNX): all replaced by typed stubs or by
 *     the injected scheduler seam.
 *   - `android.content.Context` → injected; `SharedPreferences` → not used here.
 *   - `android.util.Log` tags (`MTPerf`, `BookImport`) → documented, not emitted (core has
 *     no logging contract).
 *
 * Every JSON key, constant, magic number and Chinese string is byte-identical.
 * No U+3000 in the Android file.
 *
 * ── R20-audit additions (2026-10-06) ────────────────────────────────────────────
 * Line-by-line re-read of MangaTranslationCore.kt classified every member as
 * ONNX/Canvas (E1, out of scope) or pure. Four of the "pure" ones were missing or wrong:
 *   1. **BUG** `parsePageTranslationJson` used `Number(v)` for the rect/dimension fields.
 *      Kotlin uses `o.getDouble("l"|"t"|"r"|"b")` (lines 103..106, 96..98), which THROWS,
 *      so the enclosing `runCatching { … }.getOrNull()` (lines 74..118) turns a corrupt entry
 *      into a whole-page cache MISS. The port silently produced `NaN` rects. Now
 *      `optDouble` returns `NaN` for a missing/garbage value and the parse returns `null`.
 *   2. **BUG** `size.optInt("w"|"h")` (line 80) returns `0` for an absent key; the port's
 *      `Number(undefined)` produced `NaN`, which flipped the 0×0-page case. Now `optInt`.
 *   3. **BUG** `optString` (lines 107..109) returned the literal `'null'` for a JSON null;
 *      `org.json` returns `""`. A cached `{"o":null}` region surfaced the text "null".
 *   4. **MISSING** 翻译缓存的「键构造 / TTL / 容量上限 / 清理」 — Kotlin's
 *      `fileFor` SHA-256+hex+`take(40)` (lines 67..71), the 4 MiB single-file cap
 *      (line 77), `totalBytes` (161..162), `clear` (164..170) and `trimIfNeeded` (172..181)
 *      are pure given a file listing. Added: `translationCacheKey`,
 *      `translationCacheFileName`, `bytesToHex`, `shouldDiscardOversizedCacheFile`,
 *      `translationCacheTotalBytes`, `translationCacheClearPlan`,
 *      `planTranslationCacheTrim`, `translationCacheTouchedAt`.
 *   5. **MISSING** 译文排版/字号自适应 — Kotlin's `drawHorizontal` shrink loop
 *      (313..341) and `drawVertical` column plan (351..392) are arithmetic around an
 *      injected layout engine. Added: `shrinkLoopHorizontalTextSize`,
 *      `layoutVerticalGlyphs`, `OVERLAY_LINE_WIDTH_TOLERANCE`, and `fitVertical` now
 *      returns the full `VerticalFit(size, perCol, step)` (Kotlin line 379).
 * Still stubbed (class 1): `OverlayRenderer.bake` (Canvas/Bitmap) and the whole
 * `MangaPageTranslator` / `TranslationCoordinator` schedule loop (Bitmap + ONNX).
 */

import { MangaTranslateUnsupportedError, type RectF, copyRect, rectF, rectHeight, rectWidth } from './index';
import { BUBBLE_MODEL } from './modelManager';
import { ScriptDetector } from './scriptDetector';

/* ══════════════ 数据形状 ══════════════ */

/**
 * 单个译文区域：矩形（页面位图坐标系）+ 原文 + 译文 + 语言 + 排版方向。
 * Kotlin lines 30..47 — `contour` / `lineRects` KDocs kept.
 */
export interface TranslatedRegion {
  rect: RectF;
  original: string;
  translated: string;
  lang: string;
  vertical: boolean;
  /** 气泡形状轮廓（归一化多边形，第十六轮）；null=矩形块。 */
  contour?: number[] | null;
  /** 原文行矩形（第十八轮）：译文排版锚定原文位置。 */
  lineRects?: RectF[];
}

/** 一页的完整译文（含页面尺寸，用于缓存一致性校验）。 — Kotlin lines 48..56. */
export interface PageTranslation {
  pageWidth: number;
  pageHeight: number;
  regions: TranslatedRegion[];
}

/** Kotlin line 55: `val hasUsableText get() = regions.any { it.translated.isNotBlank() }`. */
export function hasUsableText(translation: PageTranslation): boolean {
  return translation.regions.some((r) => r.translated.trim() !== '');
}

/* ══════════════ 磁盘缓存（cacheDir/manga_translate_v1） ══════════════ */

/** Kotlin line 62. */
export const TRANSLATION_CACHE_DIR = 'manga_translate_v1';
/** Kotlin line 63: `MAX_TOTAL_BYTES = 64L * 1024 * 1024`. */
export const TRANSLATION_CACHE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** Kotlin line 77: `if(f.length()>4L*1024*1024) { f.delete(); return null }`. */
export const TRANSLATION_CACHE_MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Kotlin line 69: `digest.joinToString("") { "%02x".format(it) }.take(40)`. */
export const TRANSLATION_CACHE_KEY_CHARS = 40;

/** Kotlin line 70: `File(dir(context), "$name.json")`. */
export const TRANSLATION_CACHE_FILE_SUFFIX = '.json';

/**
 * R20-audit: 翻译缓存的键构造 / TTL / 容量上限 / 清理 属于「不依赖 ONNX，必须移植」的一类。
 *
 * Kotlin `TranslationCache.fileFor(context, key)`:
 * `MessageDigest.getInstance("SHA-256").digest(key.toByteArray(UTF_8))` → lowercase hex →
 * `.take(40)` → `"$name.json"`.
 *
 * `translationCacheFileName` is the pure tail (hex → name); `translationCacheKey` adds the
 * digest itself. `crypto.subtle.digest` is already the project's core-only hashing
 * convention (`core/comic/comicLoadSupport.ts`, `core/privacy/pinKdf.ts`,
 * `core/download/downloadManager.ts`).
 */
export function translationCacheFileName(digestHex: string): string {
  return `${digestHex.slice(0, TRANSLATION_CACHE_KEY_CHARS)}${TRANSLATION_CACHE_FILE_SUFFIX}`;
}

const HEX_CHARS = '0123456789abcdef';

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += HEX_CHARS[b >> 4];
    out += HEX_CHARS[b & 0x0f];
  }
  return out;
}

/** Kotlin line 68: SHA-256 over the UTF-8 bytes of the cache key. */
export async function translationCacheKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return translationCacheFileName(bytesToHex(new Uint8Array(digest)));
}

/** Kotlin line 77: `if(f.length()>4L*1024*1024) { f.delete(); return null }`. */
export function shouldDiscardOversizedCacheFile(bytes: number): boolean {
  return bytes > TRANSLATION_CACHE_MAX_FILE_BYTES;
}

/** One entry of `cacheDir/manga_translate_v1/`. */
export interface TranslationCacheFile {
  name: string;
  length: number;
  lastModified: number;
}

/** Kotlin lines 161..162: `totalBytes` = the sum of every file's `length()`. */
export function translationCacheTotalBytes(files: readonly TranslationCacheFile[]): number {
  return files.reduce((sum, f) => sum + f.length, 0);
}

/** Kotlin lines 164..170: `clear` frees the summed length of every file. */
export function translationCacheClearPlan(files: readonly TranslationCacheFile[]): {
  names: string[];
  freedBytes: number;
} {
  const names: string[] = [];
  let freedBytes = 0;
  for (const f of files) {
    names.push(f.name);
    freedBytes += f.length;
  }
  return { names, freedBytes };
}

/** Kotlin lines 172..181 — `trimIfNeeded`: LRU eviction until the total fits the cap. */
export function planTranslationCacheTrim(
  files: readonly TranslationCacheFile[],
  canDelete: (name: string) => boolean = () => true,
): { deleteNames: string[]; freedBytes: number; totalBytes: number } {
  let total = translationCacheTotalBytes(files);
  const deleteNames: string[] = [];
  let freedBytes = 0;
  if (total <= TRANSLATION_CACHE_MAX_TOTAL_BYTES) {
    return { deleteNames, freedBytes, totalBytes: total };
  }
  // Kotlin `sortedBy { it.lastModified() }` is a STABLE sort, so equal mtimes keep the
  // directory order they arrived in — the JS sort below is stable for the same reason.
  const oldestFirst = files.slice().sort((a, b) => a.lastModified - b.lastModified);
  for (const f of oldestFirst) {
    if (total <= TRANSLATION_CACHE_MAX_TOTAL_BYTES) break;
    if (!canDelete(f.name)) continue;
    deleteNames.push(f.name);
    freedBytes += f.length;
    total -= f.length;
  }
  return { deleteNames, freedBytes, totalBytes: total };
}

/** Kotlin line 116: `f.setLastModified(System.currentTimeMillis())` — the LRU touch on read. */
export function translationCacheTouchedAt(nowMs: number): number {
  return nowMs;
}

/**
 * Kotlin lines 120..158 — the exact cache JSON. The compact keys are part of the on-disk
 * format and are preserved verbatim: `l`,`t`,`r`,`b`,`o`,`c`,`lang`,`v`,`ct`,`lr`, and the
 * `size` wrapper with `w`/`h`.
 */
export function serializePageTranslation(translation: PageTranslation): string {
  const arr = translation.regions.map((r) => {
    const o: Record<string, unknown> = {
      l: r.rect.left,
      t: r.rect.top,
      r: r.rect.right,
      b: r.rect.bottom,
      o: r.original,
      c: r.translated,
      lang: r.lang,
      v: r.vertical,
    };
    if (r.contour != null) o['ct'] = [...r.contour];
    const lineRects = r.lineRects ?? [];
    if (lineRects.length > 0) {
      o['lr'] = lineRects.map((l) => ({ l: l.left, t: l.top, r: l.right, b: l.bottom }));
    }
    return o;
  });
  return JSON.stringify({
    size: { w: translation.pageWidth, h: translation.pageHeight },
    r: arr,
  });
}

/**
 * Kotlin lines 73..118 — the cache JSON parser. Returns null when the file is unreadable,
 * oversized, dimension-mismatched or malformed; `contour` is null unless the `ct` array has
 * `length >= 6 && length % 2 == 0`; a malformed `lr` degrades to `[]` (Kotlin `runCatching`
 * + `getOrDefault(emptyList())`).
 */
export function parsePageTranslationJson(
  raw: string,
  pageWidth: number,
  pageHeight: number,
): PageTranslation | null {
  try {
    const json = JSON.parse(raw) as unknown;
    if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
    const size = (json as Record<string, unknown>)['size'];
    if (size === null || size === undefined || typeof size !== 'object') return null;
    if (optInt(size as Record<string, unknown>, 'w') !== pageWidth) return null;
    if (optInt(size as Record<string, unknown>, 'h') !== pageHeight) return null;
    const arr = (json as Record<string, unknown>)['r'];
    if (!Array.isArray(arr)) return null;
    const regions: TranslatedRegion[] = [];
    for (const item of arr) {
      if (item === null || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      let contour: number[] | null = null;
      const ca = o['ct'];
      if (Array.isArray(ca) && ca.length >= 6 && ca.length % 2 === 0) {
        contour = ca.map((x) => Number(x));
      }
      const lineRects: RectF[] = [];
      const la = o['lr'];
      if (Array.isArray(la)) {
        for (const li of la) {
          if (li === null || typeof li !== 'object') continue;
          const lo = li as Record<string, unknown>;
          // Kotlin line 96..98: `lo.getDouble(...)` throws for a missing/garbage value and
          // the whole `runCatching { … }` on `read` therefore degrades the whole entry to
          // `emptyList()` (line 91..100).
          const lr = rectF(optDouble(lo, 'l'), optDouble(lo, 't'), optDouble(lo, 'r'), optDouble(lo, 'b'));
          if (!isFiniteRect(lr)) return null;
          lineRects.push(lr);
        }
      }
      // Kotlin lines 103..106: `o.getDouble("l"|"t"|"r"|"b")` throws → `runCatching`
      // on `read` swallows the WHOLE page and returns null (a cache miss).
      const rect = rectF(optDouble(o, 'l'), optDouble(o, 't'), optDouble(o, 'r'), optDouble(o, 'b'));
      if (!isFiniteRect(rect)) return null;
      regions.push({
        rect,
        original: optString(o, 'o'),
        translated: optString(o, 'c'),
        lang: optString(o, 'lang'),
        vertical: o['v'] === true,
        contour,
        lineRects,
      });
    }
    return { pageWidth, pageHeight, regions };
  } catch {
    return null;
  }
}

function isFiniteRect(r: RectF): boolean {
  return Number.isFinite(r.left) && Number.isFinite(r.top) && Number.isFinite(r.right) && Number.isFinite(r.bottom);
}

/**
 * `org.json` `optInt` semantics (Kotlin lines 80: `size.optInt("w")`).
 * Absent → 0; a numeric string is parsed; anything else → 0.
 *
 * R20-audit BUG FIX: this used to be `Number(v)`, which yields `NaN` for an absent key.
 * A page of size 0×0 then behaved differently from Kotlin (Kotlin's `optInt` returns 0,
 * this returned `NaN !== 0` → a spurious cache miss).
 */
function optInt(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

/**
 * `org.json` `getDouble` semantics (Kotlin lines 96..106). Throwing is modelled by
 * returning `NaN`, which the callers turn into the `runCatching`-level `null` that
 * `TranslationCache.read` would have produced.
 */
function optDouble(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

/**
 * `org.json` `optString` semantics (Kotlin lines 107..109): an absent key yields `''`
 * and a JSON `null` also yields `''` (`JSON.toString(null)` returns null → default).
 *
 * R20-audit BUG FIX: this used to return the literal text `'null'` for a JSON null, so a
 * cached `{"o":null}` region surfaced the string "null" as the page's original text.
 */
function optString(o: Record<string, unknown>, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(o, key)) return '';
  const v = o[key];
  if (v === null || v === undefined) return '';
  return String(v);
}

/* ══════════════ 行 → 块合并（纯逻辑，供单测） ══════════════ */

/** 检测行按气泡聚块：同气泡多行合并成一块整体翻译（保上下文、覆盖更干净）。 */
export const TextBlockGrouper = {
  /** Kotlin line 188. */
  group(lines: readonly RectF[]): TextBlockGroup[] {
    if (lines.length === 0) return [];
    const vertical = lines.filter((r) => isVerticalLine(r));
    const horizontal = lines.filter((r) => isHorizontalLine(r));
    const squares = lines.filter((r) => !isVerticalLine(r) && !isHorizontalLine(r));

    const blocks: TextBlockGroup[] = [];
    blocks.push(...groupVertical(vertical));
    blocks.push(...groupHorizontal(horizontal));
    // 近方形行（单字/拟方框）：并入重叠最多且并集面积增量最小的块，否则独立成块
    for (const sq of squares) {
      let host: TextBlockGroup | undefined;
      let hostDelta = Number.POSITIVE_INFINITY;
      for (const block of blocks) {
        if (!overlaps(block.rect, sq)) continue;
        const delta = unionArea(block.rect, sq) - areaOf(block.rect);
        if (delta < hostDelta) {
          hostDelta = delta;
          host = block;
        }
      }
      if (host !== undefined) {
        const merged = copyRect(host.rect);
        if (sq.left < merged.left) merged.left = sq.left;
        if (sq.top < merged.top) merged.top = sq.top;
        if (sq.right > merged.right) merged.right = sq.right;
        if (sq.bottom > merged.bottom) merged.bottom = sq.bottom;
        blocks[blocks.indexOf(host)] = { rect: merged, lines: [...host.lines, sq], vertical: host.vertical };
      } else {
        // Kotlin: `Block(RectF(sq), listOf(sq), vertical = sq.height() >= sq.width())`
        blocks.push({
          rect: copyRect(sq),
          lines: [copyRect(sq)],
          vertical: rectHeight(sq) >= rectWidth(sq),
        });
      }
    }
    return blocks;
  },

  /** Kotlin lines 220..240. */
  groupVertical,
  /** Kotlin lines 243..265. */
  groupHorizontal,
  /** Kotlin lines 190..191. */
  isVerticalLine,
  isHorizontalLine,
  /** Kotlin line 266. */
  avgHeight,
  /** Kotlin line 269. */
  areaOf,
  /** Kotlin lines 270..271. */
  unionArea,
};

/** Kotlin line 188. */
export interface TextBlockGroup {
  rect: RectF;
  lines: RectF[];
  vertical: boolean;
}

/** Kotlin line 190. */
export function isVerticalLine(r: RectF): boolean {
  return rectHeight(r) > rectWidth(r) * 1.5;
}
/** Kotlin line 191. */
export function isHorizontalLine(r: RectF): boolean {
  return rectWidth(r) > rectHeight(r) * 1.5;
}
/** Kotlin lines 192..194. */
function overlaps(a: RectF, b: RectF): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
/** Kotlin line 267. */
export function avgHeight(g: readonly RectF[]): number {
  if (g.length === 0) return 0;
  return g.reduce((sum, r) => sum + rectHeight(r), 0) / g.length;
}
/** Kotlin line 268. */
function unionOf(g: readonly RectF[]): RectF {
  const out = copyRect(g[0] as RectF);
  for (let i = 1; i < g.length; i += 1) {
    const r = g[i] as RectF;
    if (r.left < out.left) out.left = r.left;
    if (r.top < out.top) out.top = r.top;
    if (r.right > out.right) out.right = r.right;
    if (r.bottom > out.bottom) out.bottom = r.bottom;
  }
  return out;
}
/** Kotlin line 269. */
export function areaOf(r: RectF): number {
  return rectWidth(r) * rectHeight(r);
}
/** Kotlin lines 270..271. */
export function unionArea(a: RectF, b: RectF): number {
  return (
    (Math.max(a.right, b.right) - Math.min(a.left, b.left)) *
    (Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top))
  );
}

/** 竖行聚类：按 x 扫描，列 x 范围重叠（或列距 < 1.1 列宽）且纵向相邻（< 2.6 列宽）。 */
function groupVertical(lines: readonly RectF[]): TextBlockGroup[] {
  if (lines.length === 0) return [];
  const groups: RectF[][] = [];
  for (const line of lines.slice().sort((a, b) => (a.left + a.right) / 2 - (b.left + b.right) / 2)) {
    const last = groups[groups.length - 1];
    let attach = false;
    if (last !== undefined) {
      const avgColW = last.reduce((s, r) => s + rectWidth(r), 0) / last.length;
      const xOverlap =
        Math.min(line.right, Math.max(...last.map((r) => r.right))) -
        Math.max(line.left, Math.min(...last.map((r) => r.left)));
      // 最近列中心距（组变宽后平均中心会被稀释，改取组内最近列判定邻接）
      const gap = Math.min(
        ...last.map((r) => Math.abs((line.left + line.right) / 2 - (r.left + r.right) / 2)),
      );
      const vAdjacent =
        line.top < Math.max(...last.map((r) => r.bottom)) + avgColW * 2.6;
      attach = (xOverlap > 0 || gap < avgColW * 1.5) && vAdjacent;
    }
    if (attach && last !== undefined) last.push(line);
    else groups.push([line]);
  }
  return groups.map((g) => {
    // 竖排阅读序：列按 x 降序（右起），列内 y 升序
    const ordered = g
      .slice()
      .sort(
        (a, b) =>
          (b.left + b.right) / 2 - (a.left + a.right) / 2 || a.top - b.top,
      );
    return { rect: unionOf(g), lines: ordered, vertical: true };
  });
}

/** 横行聚类：按 y 扫描，纵向间距 < 3.2 行高 且（水平重叠 或 水平间距 < 1.6 行高）。 */
function groupHorizontal(lines: readonly RectF[]): TextBlockGroup[] {
  if (lines.length === 0) return [];
  const groups: RectF[][] = [];
  for (const line of lines.slice().sort((a, b) => a.top - b.top)) {
    const last = groups[groups.length - 1];
    let attach = false;
    if (last !== undefined) {
      const avgH = last.reduce((s, r) => s + rectHeight(r), 0) / last.length;
      const band = Math.max(1, avgH);
      const sameBand = line.top < Math.min(...last.map((r) => r.top)) + band * 3.2;
      const xOverlap =
        Math.min(line.right, Math.max(...last.map((r) => r.right))) -
        Math.max(line.left, Math.min(...last.map((r) => r.left)));
      const xGap = Math.max(
        Math.min(...last.map((r) => r.left)) - line.right,
        line.left - Math.max(...last.map((r) => r.right)),
      );
      attach = sameBand && (xOverlap > 0 || xGap < band * 1.6);
    }
    if (attach && last !== undefined) last.push(line);
    else groups.push([line]);
  }
  return groups.map((g) => {
    const band = Math.max(1, avgHeight(g));
    const ordered = g
      .slice()
      .sort((a, b) => Math.floor(a.top / band) - Math.floor(b.top / band) || a.left - b.left);
    return { rect: unionOf(g), lines: ordered, vertical: false };
  });
}

/* ══════════════ 覆盖渲染（原文抹除 + 译文排版） ══════════════ */

/** Kotlin lines 279..282. */
export const OVERLAY_RENDERER_CONSTANTS = {
  /** Kotlin line 279. */
  PADDING_FRACTION: 0.06,
  /** Kotlin line 280: `BG_COLOR = 0xFFFDFBF7`. */
  BG_COLOR: 0xfffdfbf7,
  /** Kotlin line 281: `TEXT_COLOR = 0xFF1A1A18`. */
  TEXT_COLOR: 0xff1a1a18,
  /** Kotlin line 282: `OUTLINE_COLOR = 0x14262626`. */
  OUTLINE_COLOR: 0x14262626,
} as const;

const OVERLAY_MIN_SIZE = 7;
const OVERLAY_MAX_SIZE = 64;

/** Kotlin line 401: `var size = (maxH * 0.98f).coerceAtMost(64f)`. */
export const OVERLAY_HORIZONTAL_SIZE_FACTOR = 0.98;

/** 译文烘焙：白底圆角块盖原文 + 适配字号排版（横排居中 / 竖排列右起）。 */
export const OverlayRenderer = {
  /**
   * 适配字号（供单测）：返回能放下的字号，放不下返回 0。
   * Kotlin lines 394..413 — the vertical branch is fully ported; the horizontal branch
   * needs `Paint.measureText`, so the caller injects a `measure` callback and the
   * exact walk (`w <= maxW` → `lines = ceil(w/maxW)`, then `lines * size * 1.05f <= maxH`)
   * is preserved.
   */
  fitFontSize(
    text: string,
    maxW: number,
    maxH: number,
    vertical: boolean,
    measure?: (text: string, size: number) => number,
  ): number {
    if (vertical) {
      const chars = text.replace(/\s+/g, '');
      if (chars === '') return 0;
      return fitVertical(chars.length, maxW, maxH)?.size ?? 0;
    }
    if (measure === undefined) {
      throw new MangaTranslateUnsupportedError(
        'OverlayRenderer.fitFontSize(horizontal)',
        'canvas-rendering',
        '需要 android.graphics.Paint.measureText 来计算横向适配字号',
      );
    }
    return horizontalFit(text, maxW, maxH, measure).size;
  },

  /** Kotlin line 284 — STUB (Canvas/Bitmap). */
  bake(_base: unknown, _translation: PageTranslation, _textScale: number): never {
    throw new MangaTranslateUnsupportedError(
      'OverlayRenderer.bake',
      'canvas-rendering',
      '需要 android.graphics.Canvas / Paint / StaticLayout 烘焙译文',
    );
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * R20-audit: OverlayRenderer 的排版算法（不依赖 ONNX）已补齐。
 *
 * Kotlin lines 313..348 (`drawHorizontal`) and 351..392 (`drawVertical`) only need
 * `StaticLayout` / `Paint` from the platform; the *search and placement* around them is
 * arithmetic. `shrinkLoopHorizontalTextSize` and `layoutVerticalGlyphs` below are the
 * faithful ports; the renderer only has to build/paint what they return.
 * ──────────────────────────────────────────────────────────────────────────── */

/** What `drawHorizontal`'s shrink loop needs back from the platform layout engine. */
export interface OverlayHorizontalLayoutProbe {
  /** Kotlin line 330: `candidate.height`. */
  height: number;
  /** Kotlin line 330 → `linesFitWidth`: any line wider than `maxW + 0.5f`. */
  lineFitsWidth: boolean;
}

/**
 * Kotlin lines 313..341 — the `while (size >= minSize && layout == null)` shrink loop.
 *
 * ```kotlin
 * var size = (maxH * 0.98f).coerceAtMost(64f)
 * while (size >= minSize && layout == null) {
 *     val candidate = StaticLayout … setLineSpacing(0f, 1.05f)
 *     if (candidate.height <= maxH && linesFitWidth(candidate, maxW)) layout = candidate
 *     else size -= max(1f, size * 0.08f)
 * }
 * layout ?: return
 * ```
 *
 * `layoutAt(size, maxW)` is injected (Android: `StaticLayout.Builder.obtain(text, 0,
 * text.length, paint, maxW)`; web: the browser's line breaker — the wrap algorithm
 * itself is a platform adaptation, not something to port). `maxW` is handed back so the
 * builder uses Kotlin's exact `val maxW = inner.width().toInt().coerceAtLeast(1)`.
 * Returns the accepted size, or `null` for Kotlin's `layout ?: return` (nothing is drawn).
 */
export function shrinkLoopHorizontalTextSize(
  inner: RectF,
  textScale: number,
  layoutAt: (size: number, maxW: number) => OverlayHorizontalLayoutProbe,
): number | null {
  const maxW = Math.max(Math.floor(rectWidth(inner)), 1);
  const maxH = rectHeight(inner);
  let size = Math.min(maxH * OVERLAY_HORIZONTAL_SIZE_FACTOR, OVERLAY_MAX_SIZE);
  const minSize = OVERLAY_MIN_SIZE;
  while (size >= minSize) {
    const candidate = layoutAt(size * textScale, maxW);
    if (candidate.height <= maxH && candidate.lineFitsWidth) return size;
    size -= Math.max(1, size * 0.08);
  }
  return null;
}

/** Kotlin line 344..348: `linesFitWidth` — `getLineWidth(i) > maxW + 0.5f`. */
export const OVERLAY_LINE_WIDTH_TOLERANCE = 0.5;

/** Kotlin lines 363..376 — the vertical column plan of `drawVertical`. */
export function layoutVerticalGlyphs(
  text: string,
  inner: RectF,
  textScale: number,
): { size: number; glyphs: { charIndex: number; column: number; x: number; y: number }[] } | null {
  const chars = text.replace(/\s+/g, '').split('');
  if (chars.length === 0) return null;
  const fit = fitVertical(chars.length, rectWidth(inner), rectHeight(inner));
  if (fit === null) return null;
  const startX = inner.right - fit.step / 2;
  const glyphs: { charIndex: number; column: number; x: number; y: number }[] = [];
  let idx = 0;
  let col = 0;
  while (idx < chars.length) {
    const x = startX - col * fit.step;
    let y = inner.top + fit.size;
    let inCol = 0;
    while (idx < chars.length && inCol < fit.perCol) {
      glyphs.push({ charIndex: idx, column: col, x, y });
      y += fit.step;
      idx += 1;
      inCol += 1;
    }
    col += 1;
  }
  return { size: fit.size * textScale, glyphs };
}

/** Kotlin line 379: `private data class VerticalFit(val size: Float, val perCol: Int, val step: Float)`. */
export interface OverlayVerticalFit {
  size: number;
  perCol: number;
  step: number;
}

/** Kotlin lines 381..392 — R20-audit: `perCol`/`step` are now returned too (Kotlin's `VerticalFit`). */
function fitVertical(charCount: number, maxW: number, maxH: number): OverlayVerticalFit | null {
  let size = Math.min(maxW * 0.9, maxH * 0.5);
  const minSize = OVERLAY_MIN_SIZE;
  while (size >= minSize) {
    const step = size * 1.18;
    const perCol = Math.max(1, Math.floor(maxH / step));
    const cols = Math.ceil(charCount / perCol);
    if (cols * step <= maxW) return { size, perCol, step };
    size -= Math.max(1, size * 0.08);
  }
  return null;
}

/** Kotlin lines 401..412 — the horizontal fit walk with an injected `measureText`. */
function horizontalFit(
  text: string,
  maxW: number,
  maxH: number,
  measure: (text: string, size: number) => number,
): { size: number } {
  let size = Math.min(maxH * OVERLAY_HORIZONTAL_SIZE_FACTOR, OVERLAY_MAX_SIZE);
  const minSize = OVERLAY_MIN_SIZE;
  while (size >= minSize) {
    const w = measure(text, size);
    if (w <= maxW) {
      const lines = Math.max(Math.ceil(w / Math.max(maxW, 1)), 1);
      if (lines * size * 1.05 <= maxH) return { size };
    }
    size -= Math.max(1, size * 0.08);
  }
  return { size: 0 };
}

/* ══════════════ 页面翻译器（OCR + 语言检测 + 翻译） ══════════════ */

/** 单页 OCR → 译文。OCR 全离线（ONNX CPU）；气泡级形状检测；翻译走引擎链。 */
export class MangaPageTranslator {
  /** 在飞 native 推理计数：release 关会话前必须等它归零（对运行中的会话 close 会 FORTIFY abort）。 */
  private activeInference = 0;

  /** Kotlin lines 426..431. */
  static readonly ENGINE_NAMES = ['ppocr_det.onnx', 'ppocr_rec.onnx', BUBBLE_MODEL.fileName] as const;

  /** Kotlin line 82: `if (!f.isFile || f.length() < TranslateModelManager.bubbleModel.minBytes)`. */
  static bubbleModelReady(isFile: boolean, length: number): boolean {
    return isFile && length >= BUBBLE_MODEL.minBytes;
  }

  /** Kotlin line 436. */
  inFlightInference(): number {
    return this.activeInference;
  }

  /** Kotlin line 438 — STUB (needs the model files). */
  get ocrReady(): boolean {
    throw new MangaTranslateUnsupportedError(
      'MangaPageTranslator.ocrReady',
      'onnx-inference',
      '需要三个 ONNX 模型文件已下载并通过 SHA-256 校验',
    );
  }

  /** Kotlin lines 530..538 — STUB. */
  detectRegions(_bitmap: unknown): Promise<unknown[]> {
    throw new MangaTranslateUnsupportedError(
      'MangaPageTranslator.detectRegions',
      'onnx-inference',
      '需要 PP-OCR det + YOLO26n-seg ONNX 会话与 android.graphics.Bitmap',
    );
  }

  /** Kotlin lines 585..593 — STUB. */
  ocrRegions(_bitmap: unknown, _regions: readonly unknown[], _forcedLang?: string | null): Promise<TranslatedRegion[]> {
    throw new MangaTranslateUnsupportedError(
      'MangaPageTranslator.ocrRegions',
      'onnx-inference',
      '需要 PP-OCR rec ONNX 会话与 android.graphics.Bitmap',
    );
  }

  /** Kotlin lines 643..651 — STUB. */
  translatePage(_bitmap: unknown, _forcedLang?: string | null): Promise<PageTranslation> {
    throw new MangaTranslateUnsupportedError(
      'MangaPageTranslator.translatePage',
      'network-translation',
      '需要 OCR + LLM / 在线翻译链路',
    );
  }

  /** Kotlin lines 671..679 — STUB. */
  translatePageOnline(_bitmap: unknown, _forcedLang?: string | null): Promise<PageTranslation> {
    throw new MangaTranslateUnsupportedError(
      'MangaPageTranslator.translatePageOnline',
      'network-translation',
      '需要 OCR + 腾讯 transmart 在线翻译链路',
    );
  }

  /** Kotlin lines 500..509 — clears the six engine references (`pageRegionRef` included). */
  releaseEngineRefs(): number {
    this.activeInference = 0;
    return MangaPageTranslator.ENGINE_NAMES.length + 1;
  }
}

/** Kotlin line 610: the OCR confidence floor (低分识别不进译文). */
export const OCR_MIN_SCORE = 0.45;
/** Kotlin line 616: `if (text.length < 2) continue`. */
export const OCR_MIN_TEXT_LENGTH = 2;
/** Kotlin line 594: `own.count { it.height() > it.width() * 1.5f } > own.size / 2`. */
export const OCR_VERTICAL_LINE_ASPECT = 1.5;

/**
 * Kotlin lines 540..582 — the pure assembly step of `detectRegionsTracked`:
 * per-bubble line ownership, the free-line suppression pass, and the
 * 「有游离行但没有任何块覆盖到」 fallback.
 */
export function assembleRegionsFromDetection(
  bubbles: ReadonlyArray<{ rect: RectF; maskContour: number[] | null }>,
  textLines: readonly RectF[],
  blocks: ReadonlyArray<{ rect: RectF; lines: RectF[]; vertical: boolean }>,
  lineBelongsToRegion: (line: RectF, region: RectF) => boolean,
  shouldFilterTextRectByBubble: (line: RectF, bubble: RectF) => boolean,
  orientationIsVertical: (block: { vertical: boolean }) => boolean,
): Array<{ rect: RectF; maskContour: number[] | null; lines: RectF[]; vertical: boolean }> {
  const regions: Array<{ rect: RectF; maskContour: number[] | null; lines: RectF[]; vertical: boolean }> = [];
  for (const bubble of bubbles) {
    const own = textLines.filter((line) => lineBelongsToRegion(line, bubble.rect));
    const verticalCount = own.filter((r) => rectHeight(r) > rectWidth(r) * OCR_VERTICAL_LINE_ASPECT).length;
    const vertical = own.length > 0 && verticalCount > Math.floor(own.length / 2);
    regions.push({ rect: bubble.rect, maskContour: bubble.maskContour, lines: own, vertical });
  }
  const freeLines = textLines.filter(
    (line) => !bubbles.some((b) => shouldFilterTextRectByBubble(line, b.rect)),
  );
  for (const block of blocks) {
    if (block.lines.length === 0) continue;
    regions.push({
      rect: block.rect,
      maskContour: null,
      lines: block.lines,
      vertical: orientationIsVertical(block),
    });
  }
  // 兜底：有游离行但没有任何块覆盖到（合并失败等）→ 直接逐行成块
  if (!regions.some((r) => r.maskContour === null && r.lines.length > 0) && freeLines.length > 0) {
    for (const line of freeLines) {
      regions.push({ rect: copyRect(line), maskContour: null, lines: [copyRect(line)], vertical: false });
    }
  }
  return regions;
}

/**
 * Kotlin lines 595..631 — the pure post-OCR join step: the `0.45f` confidence floor, the
 * `' '` separator for horizontal regions, the `text.length < 2` rejection and
 * `forcedLang ?: ScriptDetector.detect(text)`.
 */
export function ocrRegionFilter(
  region: { rect: RectF; lines: RectF[]; maskContour: number[] | null; vertical: boolean },
  pieces: ReadonlyArray<{ text: string; score: number }>,
  forcedLang?: string | null,
): TranslatedRegion | null {
  let sb = '';
  for (const piece of pieces) {
    const text = piece.text.trim();
    // OCR 置信度过滤：低分识别（画面纹理/拟声词误读）不进译文
    if (text !== '' && piece.score >= OCR_MIN_SCORE) {
      if (sb !== '' && !region.vertical) sb += ' ';
      sb += text;
    }
  }
  const text = sb.trim();
  if (text.length < OCR_MIN_TEXT_LENGTH) return null;
  const lang = forcedLang ?? ScriptDetector.detect(text);
  return {
    rect: region.rect,
    original: text,
    translated: '',
    lang: lang ?? '',
    vertical: region.vertical,
    contour: region.maskContour,
    lineRects: region.lines,
  };
}

/** Kotlin line 691: `.filter { it.lang.isNotBlank() && it.lang != "zh" }`. */
export function detectAndOcrFilter(regions: readonly TranslatedRegion[]): TranslatedRegion[] {
  return regions.filter((r) => r.lang.trim() !== '' && r.lang !== 'zh');
}

/** Kotlin lines 695..701 — the `LinkedHashMap<String, MutableList<Int>>` grouping. */
export function groupRegionsByLang(regions: readonly TranslatedRegion[]): Map<string, number[]> {
  const byLang = new Map<string, number[]>();
  regions.forEach((region, index) => {
    const list = byLang.get(region.lang);
    if (list === undefined) byLang.set(region.lang, [index]);
    else list.push(index);
  });
  return byLang;
}

/* ══════════════ 阅读器协调器（去重/缓存/烘焙发布） ══════════════ */

/**
 * 翻译协调器：按页调度（当前+预取），缓存优先，烘焙结果经回调发布回阅读器缓存。
 * epoch 自增通知 UI 重新播种位图状态。
 *
 * The scheduling loop needs Bitmaps and is stubbed; the bookkeeping around it is live.
 */
export class TranslationCoordinator {
  /** 用户显式选择的引擎（第十八轮二级导航）；调用方随配置更新。 */
  selectedEngine = 'online';

  /** Kotlin line 751. */
  readonly jobs = new Set<string>();
  /** Kotlin line 753: `bakedKeys = ConcurrentHashMap.newKeySet<String>()`. */
  readonly bakedKeys = new Set<string>();
  /** Kotlin line 762: `busyKeys`. */
  busyKeys = new Set<string>();
  /** Kotlin line 760: `epoch = MutableStateFlow(0)`. */
  epoch = 0;
  /** Kotlin line 757. */
  releasePending = false;

  /** 当前引擎标识（进缓存 key）：换引擎后同页自动重译，不读旧引擎结果。 */
  engineTag(): string {
    return this.selectedEngine;
  }

  /**
   * Kotlin lines 770..786 — the guards + cache key of `schedule(...)`.
   * Returns null when Android returns early, otherwise the cache key it would use.
   */
  planSchedule(
    ocrReady: boolean,
    cacheKey: string,
    translationKey: string,
    forcedLang: string | null | undefined,
    modelTag: string,
  ): string | null {
    if (!ocrReady) return null;
    if (this.bakedKeys.has(cacheKey) || this.jobs.has(cacheKey)) return null;
    this.releasePending = false; // 新任务到达：翻译重新启用，作废挂起的会话关闭
    const engine = this.selectedEngine;
    return `${translationKey}@${engine}-${forcedLang ?? 'auto'}-${modelTag}-v2`;
  }

  /** Kotlin lines 842..844. */
  onTextScaleChanged(): void {
    this.bakedKeys.clear();
  }

  /** Kotlin line 847. */
  takeBakedKeys(): Set<string> {
    return new Set(this.bakedKeys);
  }

  /** Kotlin line 852. */
  resetMarks(): void {
    this.bakedKeys.clear();
  }

  /** Kotlin lines 855..857. */
  bumpEpoch(): void {
    this.epoch += 1;
  }

  /** Kotlin lines 860..863. */
  onBitmapInvalidated(cacheKey: string): void {
    this.bakedKeys.delete(cacheKey);
    this.jobs.delete(cacheKey);
  }

  /** Kotlin lines 865..869. */
  cancelAll(): void {
    this.jobs.clear();
    this.busyKeys = new Set();
  }

  /** Kotlin lines 870..898 — STUB (the wait-for-in-flight loop needs the ONNX counter). */
  release(): void {
    this.cancelAll();
    this.releasePending = true;
  }
}

/** Kotlin lines 882..883: the 60 s deadline and 150 ms poll slice. */
export const TRANSLATION_RELEASE_DEADLINE_MS = 60_000;
export const TRANSLATION_RELEASE_POLL_MS = 150;
/** Kotlin line 886..889 — the skip-close log text. */
export const TRANSLATION_RELEASE_INFLIGHT_MESSAGE = 'release: inference still in flight, skip session close';

/** Line 73 / 148 log tags (recorded; core does not emit logs). */
export const TRANSLATION_LOG_TAGS = ['MTPerf'] as const;