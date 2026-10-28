/**
 * manga TRANSLATION is a **deliberate scope exclusion**, not an oversight.
 *
 * The Android package `com.example.mangatranslate/` (12 Kotlin files, ~202 KB) performs
 * **ONNX inference** (PP-OCRv6 text detection + CTC recognition, YOLO26n-seg bubble
 * segmentation) followed by machine translation. The owner of the iOS port ruled the
 * whole manga-TRANSLATION feature out of scope: no ONNX runtime is bundled, no model
 * download manager is wired, and no OCR/translation pipeline ships in this app.
 *
 * What this directory therefore provides, and why it is still useful:
 *
 *   1. **Data shapes, enums, keys and public interfaces** that the rest of the app
 *      (reader, cache keys, backup, UI settings surfaces, parity tests) needs in order to
 *      *refer* to translation state without crashing. Removing them would break
 *      `import` statements across `src/ui` and would delete the record of the Android
 *      wire format (cache JSON keys `l/t/r/b/o/c/lang/v/ct/lr`, model file names, model
 *      SHA-256 digests, HTTP endpoints, the LLM prompt).
 *   2. **Every pure algorithm that does not require inference**, ported faithfully and
 *      unit-tested: language-script detection, the model-download URL allow-listing,
 *      LLM response parsing, endpoint sanitisation, request-body construction, the
 *      telemetry key scheme, and the whole `PageRegionTiling` geometry/threshold set.
 *   3. **A clearly documented stub** for every entry point that would need ONNX runtime or
 *      a bitmap. Those throw {@link MangaTranslateUnsupportedError} — a typed error — so
 *      a caller that reaches one gets an unambiguous "this is out of scope on iOS"
 *      instead of a silent no-op or a `NaN` leaking into a render path.
 *
 * Nothing in this directory imports React, the DOM, or Capacitor. Model files, bitmaps,
 * `Bitmap`/`Canvas`/`Paint` rendering and the HTTP transport are all injected or absent.
 *
 * Per-file map (Kotlin → TS, with non-blank line counts):
 *
 *   TextTranslator.kt              (148) → scriptDetector.ts     (full pure port + stub)
 *   TranslateModelManager.kt        (285) → modelManager.ts      (specs + validateUrl + stub)
 *   LlmBubbleTranslator.kt          (244) → llmTranslator.ts     (parsers/builders + stub)
 *   TranslationPrivacy.kt             (6) → translationPrivacy.ts (full pure port)
 *   PageMemoryBudget.kt             (28) → pageMemoryBudget.ts  (check ported, fingerprint stub)
 *   PageRegionTiling.kt            (748) → pageRegionTiling.ts  (pure geometry ported in full)
 *   MangaTranslationCore.kt        (825) → translationCore.ts   (types + pure parts + stubs)
 *   BubbleDetector.kt              (369) → bubbleDetector.ts    (constants + NMS + stub)
 *   BubblePipeline.kt              (416) → bubblePipeline.ts    (pure parts + bake stub)
 *   TextBlockMerger.kt             (451) → textBlockMerger.ts   (full pure port — no inference)
 *   MangaOcr.kt                    (454) → mangaOcr.ts         (constants + DB postprocess + stub)
 *   PageRegionDetector.kt          (254) → pageRegionDetector.ts (result shape + stub)
 *
 * ── 2026-10-06 line-by-line audit (E1 boundary re-drawn) ─────────────────────────
 * E1 covers **only** the ONNX Runtime itself: `OrtEnvironment` / `OrtSession` /
 * `OnnxTensor` / `TensorInfo` / `FloatBuffer`, the `*.onnx` model files, and the
 * `session.run(...)` calls. Everything that merely *consumes* an injected tensor,
 * bitmap, layout engine or HTTP transport is **not** E1 and is now ported.
 *
 * That audit closed 11 gaps that were previously mis-filed as "E1":
 *
 *   | Kotlin | member | was | now |
 *   |---|---|---|---|
 *   | PageMemoryBudget.kt 17..27 | `fingerprint` sampling walk + BE RGBA packing | stub | `planFingerprintRows`, `packFingerprintRows`, `fingerprintBitmap` |
 *   | MangaOcr.kt 204..217 | `preprocess` CHW tensor build | stub | `buildDetInputTensor` |
 *   | MangaOcr.kt 375..391 | `recognize` tensor build + `targetW` | stub | `recognizerTargetWidth`, `buildRecInputTensor` |
 *   | BubbleDetector.kt 182..197 | `bitmapToRgbChw` | stub | `packRgbChw` |
 *   | BubbleDetector.kt 216..278 | `computeMaskContour` | stub | implemented (injected `MaskPrototypes`) |
 *   | BubblePipeline.kt 213..256 | `insetTextBounds` rasterisation | stub | `insetTextBoundsFromContour`, `rasterizeContourMask`, `contourPageBounds`, `insetFallbackPad`, `insetMaskSize` |
 *   | BubblePipeline.kt 371..390 | horizontal font binary search | stub | `binarySearchHorizontalFontSize`, `appliedTextSize` |
 *   | BubblePipeline.kt 418..433 | vertical column/glyph plan | stub | `layoutVerticalColumns` |
 *   | MangaTranslationCore.kt 67..181 | cache key / cap / total / clear / LRU trim | stub | `translationCacheKey`, `planTranslationCacheTrim`, … |
 *   | MangaTranslationCore.kt 313..392 | overlay horizontal shrink + vertical glyph plan | stub | `shrinkLoopHorizontalTextSize`, `layoutVerticalGlyphs` |
 *   | PageRegionDetector.kt 88..223 | the whole long-image orchestration | stub | implemented (injected `PageRegionTileDetectors`) |
 *
 * It also fixed 4 real behaviour bugs — see the per-file line maps in
 * `bubblePipeline.ts` (`insetFromLargestRect` scale factor, `packRgb` channel order),
 * `translationCore.ts` (`getDouble` / `optInt` / `optString` org.json semantics) and the
 * shared `optString` helpers in `scriptDetector.ts` / `llmTranslator.ts`.
 *
 * **What is still out of scope (E1), and why each one is unavoidable:**
 *   - `OrtSessions.env/getOrCreate/createSession/track/closeAll` — an ONNX session cache.
 *   - `session.run(...)` + `TensorInfo` shape reads — inference.
 *   - `*.onnx` model files and `TranslateModelManager.ensureDownloaded`/`downloadOne`/
 *     `attemptDownload` — the bytes a session needs; `validateUrl` (the security control)
 *     and all `ModelSpec` data are ported.
 *   - `BubbleDetector.detect/detectTiled/detectWhole`, `PaddleDetector.detectLines`,
 *     `PaddleRecognizer.recognize` — thin wrappers that exist only to run a session.
 *   - `Bitmap`/`Canvas`/`Paint`/`StaticLayout` **drawing**: `BubblePipeline.bake`,
 *     `OverlayRenderer.bake`. Their geometry, colour, wrap-search and glyph-placement
 *     arithmetic is ported; the rasterisation call itself is not.
 *   - `PageRegionDetector.cropRegion`/`compressTile` — they produce the pixels the
 *     detectors read; their *size* arithmetic is ported (`planCropRegion`,
 *     `compressedTileSize`, `needsTileCompression`).
 *   - `MangaPageTranslator.ocrRegions`'s `Bitmap` crops / `rotateCcw`, and the
 *     `TranslationCoordinator.schedule` Bitmap publish loop.
 * No stub fabricates inference: every one throws `MangaTranslateUnsupportedError`, so an
 * unwired caller fails loudly instead of silently returning no translation.
 */

export const MANGA_TRANSLATE_SCOPE_EXCLUSION = true;

/**
 * Scope of E1 (`docs/PARITY_EXCEPTIONS.md`): **ONNX Runtime only** — the runtime, the
 * `*.onnx` files, session creation and `session.run`. Every non-ONNX algorithm in
 * `com.example.mangatranslate` (text detection geometry, OCR result assembly, translation
 * layout / wrapping / font scaling, bubble rendering geometry, cache read-write-clear,
 * failure fallbacks, settings switches, progress reporting) is ported and tested; only the
 * platform calls they sit on top of are injected or stubbed with a typed error.
 * See the audit table in the module header.
 */
export const MANGA_TRANSLATE_EXCLUSION_SCOPE = 'onnx-runtime-only';

/**
 * Typed error thrown by every stubbed manga-translation entry point.
 * `reason` names the exact Kotlin symbol that would have run on Android.
 */
export class MangaTranslateUnsupportedError extends Error {
  /** The Kotlin `com.example.mangatranslate` symbol that would have executed. */
  readonly androidSymbol: string;
  /** Machine-readable bucket. */
  readonly reason: MangaTranslateUnsupportedReason;

  constructor(androidSymbol: string, reason: MangaTranslateUnsupportedReason, detail: string) {
    super(
      `${androidSymbol}: ${detail}（漫画翻译（ONNX OCR + MT）已被明确排除在 iOS 移植范围之外）`,
    );
    this.name = 'MangaTranslateUnsupportedError';
    this.androidSymbol = androidSymbol;
    this.reason = reason;
  }
}

export type MangaTranslateUnsupportedReason =
  /** Would require an ONNX Runtime session + a downloaded `.onnx` model. */
  | 'onnx-inference'
  /** Would require an `android.graphics.Bitmap` pixel buffer. */
  | 'bitmap-input'
  /** Would require `android.graphics.Canvas` / `Paint` / `StaticLayout` rendering. */
  | 'canvas-rendering'
  /** Would require the HTTP transport + a live translation endpoint. */
  | 'network-translation'
  /** Would require `android.content.Context` / private app storage. */
  | 'android-storage';

const UNSUPPORTED = (
  androidSymbol: string,
  reason: MangaTranslateUnsupportedReason,
  detail: string,
): never => {
  throw new MangaTranslateUnsupportedError(androidSymbol, reason, detail);
};

/**
 * `android.graphics.RectF` — the single geometric primitive shared by all 12 files.
 * Modelled as an immutable plain object; every Kotlin call site is a pure read
 * (`left/top/right/bottom`) or a construction.
 */
export interface RectF {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rectF(left: number, top: number, right: number, bottom: number): RectF {
  return { left, top, right, bottom };
}

/** Kotlin `RectF.width()`. */
export function rectWidth(r: RectF): number {
  return r.right - r.left;
}

/** Kotlin `RectF.height()`. */
export function rectHeight(r: RectF): number {
  return r.bottom - r.top;
}

/** Kotlin `RectF.centerX()`. */
export function rectCenterX(r: RectF): number {
  return (r.left + r.right) / 2;
}

/** Kotlin `RectF.centerY()`. */
export function rectCenterY(r: RectF): number {
  return (r.top + r.bottom) / 2;
}

/** Kotlin `RectF(candidate)` copy constructor. */
export function copyRect(r: RectF): RectF {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** Kotlin `RectF.union(other)` — in place. */
export function unionRect(r: RectF, other: RectF): RectF {
  if (other.left < r.left) r.left = other.left;
  if (other.top < r.top) r.top = other.top;
  if (other.right > r.right) r.right = other.right;
  if (other.bottom > r.bottom) r.bottom = other.bottom;
  return r;
}

/** Kotlin `RectF.inset(dx, dy)` — shrinks on all four sides. */
export function insetRect(r: RectF, dx: number, dy: number): RectF {
  r.left += dx;
  r.top += dy;
  r.right -= dx;
  r.bottom -= dy;
  return r;
}

/** Shared stub factory for the modules that need it. */
export const unsupported = UNSUPPORTED;