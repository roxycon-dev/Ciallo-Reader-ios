/**
 * AppBackground.tsx — line-by-line port of Android `com/example/ui/AppBackground.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/AppBackground.kt`, 84 lines / 76 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-13    package + Android/Compose imports → plain TS/React; Android imports SKIPPED
 *   15-16   data class AppBackgroundConfig   → AppBackgroundConfig
 *   18-29   object AppBackgroundController   → the subscribe/update store below
 *   31-32   LocalAppBackgroundActive         → useAppBackgroundActive()
 *   34-38   LocalBackgroundTone              → useBackgroundTone()
 *   40-47   @Composable adaptiveTitleColor  → adaptiveTitleColor()
 *   49-91   fun loadBackgroundAvgLuminance  → loadBackgroundAvgLuminance()
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.ui` — TS module system.
 *  L2-4   `android.graphics.BitmapFactory` / `android.net.Uri` / `MaterialTheme` →
 *          a canvas-based sampler + CSS token lookup (see the adaptation notes).
 *  L5-9   `androidx.compose.*` (runtime, staticCompositionLocalOf, graphics.Color) →
 *          `useSyncExternalStore` + plain strings.
 *  L10    `com.example.ui.theme.luminance` → `luminance()` already exists in
 *         `src/ui/theme/tokens.ts` (same WCAG coefficients) — not duplicated here.
 *  L11-12 `MutableStateFlow` / `StateFlow.asStateFlow()` → the tiny observable store
 *         below (subscribe + getSnapshot), which `useSyncExternalStore` consumes.
 *  L53-90 `BitmapFactory.Options().inJustDecodeBounds` / `inSampleSize` downsampling →
 *          an injected `decodeImage` port: the downsampling loop is preserved verbatim,
 *          and the pixel read uses an `OffscreenCanvas`/`ImageBitmap` sampler supplied by
 *          the caller (core/UI never touches the DOM directly).
 *
 * ── Platform adaptations (documented inline) ───────────────────────────────────────
 *  * `Uri.parse(uriString)` + `contentResolver.openInputStream(uri)` → the injected
 *    `decodeImage(uri)` port.
 *  * `BitmapFactory.decodeStream` → `ImageBitmap` from the port.
 *  * `bmp.getPixel(x, y)` / `bmp.recycle()` → `sampler.getPixel(x, y)` / `sampler.release()`.
 *  * `staticCompositionLocalOf { false }` → `useAppBackgroundActive()` returning the
 *    module-level `defaultAppBackgroundActive` flag (set once at bootstrap).
 *  * `staticCompositionLocalOf { 1f }` → `useBackgroundTone()` reading the store.
 */

import { useCallback, useSyncExternalStore } from 'react';

/** 软件背景配置（设置页写入，MainActivity 收集渲染）。 — Kotlin L16-20 */
export interface AppBackgroundConfig {
  /** 0=默认 1=自定义 */
  readonly mode: number;
  readonly uri: string | null;
  /** 0-50，自定义背景深色遮罩强度（%） */
  readonly dim: number;
}

/** Kotlin L23 `AppBackgroundConfig(0, null)`. */
export const DEFAULT_APP_BACKGROUND_CONFIG: AppBackgroundConfig = { mode: 0, uri: null, dim: 0 };

/* ── object AppBackgroundController — Kotlin lines 18-29 ── */

type Listener = () => void;
const listeners = new Set<Listener>();
let config: AppBackgroundConfig = DEFAULT_APP_BACKGROUND_CONFIG;

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AppBackgroundConfig {
  return config;
}

/** 是否启用自定义软件背景；启用时主页面根背景透明，让背景图片透出。 — Kotlin L31-32 */
let appBackgroundActive = false;

/** Compose `LocalAppBackgroundActive.current` default (`staticCompositionLocalOf { false }`). */
export function getAppBackgroundActiveDefault(): boolean {
  return appBackgroundActive;
}

export function setAppBackgroundActive(active: boolean): void {
  appBackgroundActive = active;
}

export function useAppBackgroundActive(): boolean {
  return appBackgroundActive;
}

/** Kotlin L26-28 `fun update(mode: Int, uri: String?, dim: Int = 0)`. */
export function updateAppBackground(
  mode: number,
  uri: string | null,
  dim = 0,
): void {
  config = { mode, uri, dim };
  for (const listener of [...listeners]) listener();
}

/** Subscribe to `AppBackgroundController.config` (the `StateFlow` collector). */
export function useAppBackgroundConfig(): AppBackgroundConfig {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Whether the controller currently holds a custom background. */
export function isAppBackgroundEnabled(current: AppBackgroundConfig): boolean {
  return current.mode !== 0 && current.uri !== null && current.uri.trim() !== '';
}

/* ── LocalBackgroundTone / adaptiveTitleColor — Kotlin lines 34-47 ── */

/**
 * 页面有效背景的“压暗后平均亮度”（0~1）：MainActivity 在背景图变化时实时计算，
 * 已叠加 appBgDim 深色遮罩。1.0=很亮，0.0=纯黑。
 */
export function useBackgroundTone(): number {
  const current = useAppBackgroundConfig();
  return backgroundTone(current);
}

/** Same computation without React (used by the async loader and by tests). */
export function backgroundTone(current: AppBackgroundConfig): number {
  if (!isAppBackgroundEnabled(current) || current.uri === null) return 1;
  return lastTone;
}

let lastTone = 1;

/** Android `com.example.ui.theme.luminance` — `src/ui/theme/tokens.ts` already owns it. */
export { luminance } from '../theme/tokens';

/**
 * 直接浮在页面背景上的标题文字（无卡片托底）自适应色：
 * 按 LocalBackgroundTone 实时取对比色——亮背景深字、暗背景白字，
 * 不再写死任何一种颜色。
 * — Kotlin L45-47
 */
export function adaptiveTitleColor(tone: number): string {
  return tone > 0.4 ? '#1A1A1E' : '#FFFFFF';
}

/* ── loadBackgroundAvgLuminance — Kotlin lines 49-91 ── */

/** The `BitmapFactory` replacement: decode + subsample + read pixels. */
export interface BackgroundImageSampler {
  /** Android `BitmapFactory.Options().inJustDecodeBounds` result. */
  readonly outWidth: number;
  readonly outHeight: number;
  readonly width: number;
  readonly height: number;
  /** Android `bmp.getPixel(x, y)` — 0xAARRGGBB. */
  getPixel(x: number, y: number): number;
  /** Android `bmp.recycle()`. */
  release(): void;
}

/** The `contentResolver.openInputStream` + `BitmapFactory.decodeStream` replacement. */
export type BackgroundImageDecoder = (
  uri: string,
  sample: number,
) => Promise<BackgroundImageSampler | null>;

/**
 * 计算自定义背景图（已含深色遮罩）的平均亮度：降采样解码 → 像素隔行采样求 WCAG 亮度。
 * 失败时返回 1f（按亮背景处理，浅色主题下可读）。
 *
 * The downsample loop and the every-2px scan are transcribed verbatim (Kotlin L61-64,
 * L72-84); the pixel source is the injected `decodeImage` port.
 */
export async function loadBackgroundAvgLuminance(
  uriString: string,
  dim: number,
  decodeImage: BackgroundImageDecoder,
): Promise<number> {
  try {
    // Kotlin L59-60 bounds-only decode pass.
    const bounds = await decodeImage(uriString, 1);
    if (bounds === null) return 1;
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return 1;

    // Kotlin L61-64 `var sample = 1; while (outWidth / (sample*2) >= 64 && outHeight / (sample*2) >= 64) sample *= 2`
    let sample = 1;
    while (
      Math.floor(bounds.outWidth / (sample * 2)) >= 64 &&
      Math.floor(bounds.outHeight / (sample * 2)) >= 64
    ) {
      sample *= 2;
    }

    const bmp = await decodeImage(uriString, sample);
    if (bmp === null) return 1;

    // Kotlin L69-84 stride-2 scan with the same WCAG coefficients.
    let sum = 0;
    let count = 0;
    let y = 0;
    while (y < bmp.height) {
      let x = 0;
      while (x < bmp.width) {
        const c = bmp.getPixel(x, y);
        const r = ((c >> 16) & 0xff) / 255;
        const g = ((c >> 8) & 0xff) / 255;
        const b = (c & 0xff) / 255;
        sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        count += 1;
        x += 2;
      }
      y += 2;
    }
    bmp.release();
    const lum = count > 0 ? sum / count : 1;
    // Kotlin L87 `lum * (1f - dim.coerceIn(0, 50) / 100f)`
    const clampedDim = Math.max(0, Math.min(50, dim));
    const result = lum * (1 - clampedDim / 100);
    lastTone = result;
    return result;
  } catch {
    // Kotlin L88-90 `catch (e: Exception) { 1f }`
    return 1;
  }
}

/** React binding that recomputes the tone whenever the config changes. */
export function useLoadBackgroundTone(
  decodeImage: BackgroundImageDecoder,
): (current: AppBackgroundConfig) => void {
  return useCallback(
    (current: AppBackgroundConfig) => {
      if (!isAppBackgroundEnabled(current) || current.uri === null) {
        lastTone = 1;
        return;
      }
      void loadBackgroundAvgLuminance(current.uri, current.dim, decodeImage).then((tone) => {
        lastTone = tone;
        for (const listener of [...listeners]) listener();
      });
    },
    [decodeImage],
  );
}
