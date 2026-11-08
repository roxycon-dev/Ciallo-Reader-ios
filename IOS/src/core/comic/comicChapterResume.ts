/**
 * comicChapterResume.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/ComicChapterResume.kt
 *
 * Kotlin source: 27 lines / 22 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1-3     package + `import org.json.JSONObject` — org.json import               │
 * │ L6-10    data class ComicChapterResume           — ported verbatim              │
 * │ L11      `toJson()`                             — JSONObject → plain object    │
 * │ L13-17   `startPage(...)`                       — ported verbatim              │
 * │ L19-25   `companion object.fromJson`            — `optInt` → nullish fallbacks │
 * └────────────────────────────────────────────────────────────────────────────────┘
 *
 * Doc comment kept verbatim: "Per-chapter resume survives changed image URLs,
 * chapter visits and process restarts."
 *
 * ADAPTATIONS
 * - `JSONObject.put(...)` chain → a plain readonly record; `JSON.stringify` is the
 *   caller's job (the Kotlin caller passes the JSONObject to a writer).
 * - `json.optInt(key, default).coerceAtLeast(0)` → `Math.max(0, Number(?? default))`.
 *   `optInt` returns the default for a *missing* key and for a non-numeric value;
 *   `Number(...)` yields `NaN` for those, which the `Number.isFinite` guard below
 *   turns back into the default. Behaviour is identical for every input the Kotlin
 *   `JSONObject` can hold.
 * - `Int.MAX_VALUE` sentinel (`requested == Int.MAX_VALUE` → "last page") is kept as
 *   the same numeric literal `2147483647`, because `Int.MAX_VALUE` is exactly that
 *   on the JVM.
 */

/** Kotlin `Int.MAX_VALUE` — the "jump to the last page" sentinel. */
export const LAST_PAGE_REQUEST = 2147483647;

export interface ComicChapterResume {
  /** Last committed page index. */
  readonly page: number;
  /** Scroll-mode page index, or `-1` when never recorded. */
  readonly scrollPage: number;
  /** Scroll offset inside `scrollPage`. */
  readonly scrollOffset: number;
}

export function createComicChapterResume(
  page = 0,
  scrollPage = -1,
  scrollOffset = 0,
): ComicChapterResume {
  return { page, scrollPage, scrollOffset };
}

/** Kotlin L11 `fun toJson(): JSONObject`. */
export function comicChapterResumeToJson(resume: ComicChapterResume): {
  page: number;
  scrollPage: number;
  scrollOffset: number;
} {
  return {
    page: resume.page,
    scrollPage: resume.scrollPage,
    scrollOffset: resume.scrollOffset,
  };
}

/**
 * Kotlin L13-17 `fun startPage(requested, count, vertical): Int`.
 *
 * Resolution order, verbatim:
 *   1. `requested == Int.MAX_VALUE` → last page,
 *   2. `requested > 0 && requested != page` → the explicit request,
 *   3. vertical → `scrollPage` when it is recorded (`>= 0`),
 *   4. `requested > 0` → the request again,
 *   5. otherwise → the stored `page`.
 * The result is then `coerceIn(0, max(0, count - 1))`.
 */
export function comicChapterStartPage(
  resume: ComicChapterResume,
  requested: number,
  count: number,
  vertical: boolean,
): number {
  const last = count - 1;
  let chosen: number;
  if (requested === LAST_PAGE_REQUEST) chosen = last;
  else if (requested > 0 && requested !== resume.page) chosen = requested;
  else if (vertical && resume.scrollPage >= 0) chosen = resume.scrollPage;
  else if (requested > 0) chosen = requested;
  else chosen = resume.page;
  const hi = Math.max(0, last);
  return Math.min(Math.max(chosen, 0), hi);
}

/**
 * Kotlin L20-24 `companion object.fromJson(json: JSONObject)`.
 *
 * `optInt(key, default).coerceAtLeast(floor)` — the floor differs per field
 * (`0` / `-1` / `0`), which is why the three reads cannot share a helper.
 */
export function comicChapterResumeFromJson(json: unknown): ComicChapterResume {
  const obj = (json ?? {}) as Record<string, unknown>;
  return {
    page: Math.max(0, optInt(obj, 'page', 0)),
    scrollPage: Math.max(-1, optInt(obj, 'scrollPage', -1)),
    scrollOffset: Math.max(0, optInt(obj, 'scrollOffset', 0)),
  };
}

/** Kotlin `JSONObject.optInt(key, fallback)` — missing/non-numeric → fallback. */
function optInt(obj: Record<string, unknown>, key: string, fallback: number): number {
  const raw = obj[key];
  if (raw === undefined || raw === null) return fallback;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
