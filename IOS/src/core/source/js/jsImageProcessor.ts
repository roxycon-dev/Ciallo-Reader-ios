/**
 * Android source: `com.example.source.js.JsImageProcessor.kt` (49 lines, 40 non-blank)
 * Ported: 40 / 40 non-blank lines. Skipped: none.
 *
 * Platform adaptations:
 * - `java.util.concurrent.ConcurrentHashMap` → `Map` (JS is single-threaded; the
 *   `object JsImageProcessor` singleton becomes a module-level namespace).
 * - `suspend fun engine.transformImageBlocking` → `Promise<Uint8Array | null>`;
 *   `transform` becomes async because the engine is async in TS.
 * - `android.util.Log` → `JsLog` (`jsPlatform.ts`).
 * - `ByteArray` → `Uint8Array`.
 * - `runtime` type: Kotlin refers to `JsSourceEngine`; the port uses the minimal
 *   structural port `{ transformImageBlocking }` to avoid a circular import.
 */

import { JsLog } from './jsPlatform';

/** The one method `JsImageProcessor` needs from `JsSourceEngine`. */
export interface ImageTransformEngine {
  transformImageBlocking(code: string, input: Uint8Array): Promise<Uint8Array | null>;
}

interface Entry {
  readonly engine: ImageTransformEngine;
  readonly code: string;
}

const entries = new Map<string, Entry>();

/** Kotlin `fun register(url: String, engine: JsSourceEngine, code: String?)`. */
export function register(url: string, engine: ImageTransformEngine, code: string | null | undefined): void {
  if (code === null || code === undefined || code.trim() === '') {
    entries.delete(url);
  } else {
    entries.set(url, { engine, code });
  }
}

/** Kotlin `fun unregister(url: String)`. */
export function unregister(url: string): void {
  entries.delete(url);
}

/** Scrambled pages must never be displayed before their complete-image transform. */
export function hasTransform(url: string): boolean {
  return entries.has(url);
}

/** 同步执行（拦截器/下载器都在 IO 线程），失败时返回 null 表示保持原图。 */
export async function transform(url: string, bytes: Uint8Array): Promise<Uint8Array | null> {
  const entry = entries.get(url);
  if (entry === undefined) return null;
  JsLog.i('JsImageProcessor', `transform found for ${url.slice(0, 80)}`);
  try {
    return await entry.engine.transformImageBlocking(entry.code, bytes);
  } catch (e) {
    JsLog.w('JsImageProcessor', `transform failed: ${url}`, e);
    return null;
  }
}

/** Kotlin `fun clear()`. */
export function clear(): void {
  entries.clear();
}

/** Kotlin `object JsImageProcessor` call-site namespace. */
export const JsImageProcessor = { register, unregister, hasTransform, transform, clear };
