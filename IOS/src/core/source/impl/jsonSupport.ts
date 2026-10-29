/**
 * `org.json` (JSONObject / JSONArray) surface used by the Android sources in
 * `com.example.source.impl` — Kotlin counterpart: NONE (new adaptation module).
 *
 * WHY THIS FILE EXISTS: the Kotlin sources rely on `org.json`'s *fallback*
 * semantics, which differ from raw `JSON.parse` output in three ways that matter
 * for rule evaluation:
 *   1. `optString(name, default)` returns the default only when the key is
 *      ABSENT; an explicit JSON `null` becomes the literal string `"null"`.
 *      `AniListClient`/`MangaDexSource` explicitly test for that `"null"` string.
 *   2. `optInt`/`optLong`/`optDouble` coerce strings and fall back when the
 *      value cannot be parsed.
 *   3. `optJSONObject`/`optJSONArray` return `null` (not a throw) on a type
 *      mismatch, which is what every `?: continue` / `?: return emptyList()` in
 *      the Kotlin sources relies on.
 * All of that is reproduced verbatim below; JS `undefined` = absent key,
 * JS `null` = explicit JSON null (the `JSONObject.NULL` sentinel).
 *
 * No Kotlin lines are skipped here because there is no Kotlin counterpart; the
 * behavioural rules above are transcribed 1:1 from the `org.json` semantics the
 * Kotlin code depends on.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type JsonArray = JsonValue[];

/** Kotlin `value is JSONObject` / `value is JSONArray`. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: unknown): value is JsonArray {
  return Array.isArray(value);
}

/**
 * Kotlin `org.json.JSON.toString(value)`: `null` (the NULL sentinel) stringifies
 * to `"null"`, which is why callers filter on the literal.
 */
export function jsonToString(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Kotlin `JSONObject.opt(name)` — `null` when the key is absent. */
export function opt(obj: JsonObject | null | undefined, key: string): JsonValue | undefined {
  if (obj == null) return undefined;
  return obj[key];
}

export function optJsonObject(obj: JsonObject | null | undefined, key: string): JsonObject | null {
  const value = opt(obj, key);
  return isJsonObject(value) ? value : null;
}

export function optJsonArray(obj: JsonObject | null | undefined, key: string): JsonArray | null {
  const value = opt(obj, key);
  return isJsonArray(value) ? value : null;
}

/** Kotlin `JSONObject.has(name)` — an explicit JSON null still counts as present. */
export function has(obj: JsonObject | null | undefined, key: string): boolean {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}

/** Kotlin `JSONObject.isNull(name)` — true when absent OR the NULL sentinel. */
export function isNull(obj: JsonObject | null | undefined, key: string): boolean {
  const value = opt(obj, key);
  return value === undefined || value === null;
}

export function optString(
  obj: JsonObject | null | undefined,
  key: string,
  fallback: string | null = '',
): string | null {
  const value = opt(obj, key);
  if (value === undefined) return fallback;
  return jsonToString(value);
}

/** Kotlin `optString(name)` with the Android default of `""`. */
export function optStringOrEmpty(obj: JsonObject | null | undefined, key: string): string {
  return optString(obj, key, '') ?? '';
}

export function optInt(obj: JsonObject | null | undefined, key: string, fallback = 0): number {
  return optNumber(obj, key, fallback, true);
}

export function optLong(obj: JsonObject | null | undefined, key: string, fallback = 0): number {
  return optNumber(obj, key, fallback, true);
}

/** Kotlin `optDouble(name, fallback)` — NaN is a legal fallback (used for "no chapter"). */
export function optDouble(
  obj: JsonObject | null | undefined,
  key: string,
  fallback = Number.NaN,
): number {
  return optNumber(obj, key, fallback, false);
}

function optNumber(
  obj: JsonObject | null | undefined,
  key: string,
  fallback: number,
  truncate: boolean,
): number {
  const value = opt(obj, key);
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return fallback;
  return truncate ? Math.trunc(parsed) : parsed;
}

export function optBoolean(
  obj: JsonObject | null | undefined,
  key: string,
  fallback = false,
): boolean {
  const value = opt(obj, key);
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const lower = String(value).toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  return fallback;
}

/** Kotlin `JSONArray.optJSONObject(i)` / `optJSONArray(i)`. */
export function arrayOptJsonObject(arr: JsonArray | null | undefined, index: number): JsonObject | null {
  const value = arr?.[index];
  return isJsonObject(value) ? value : null;
}

export function arrayOptJsonArray(arr: JsonArray | null | undefined, index: number): JsonArray | null {
  const value = arr?.[index];
  return isJsonArray(value) ? value : null;
}

/**
 * Kotlin `optString(i, fallback)` on a JSONArray — returns `fallback` for the
 * NULL sentinel as well as for out-of-range indexes.
 */
export function arrayOptString(
  arr: JsonArray | null | undefined,
  index: number,
  fallback: string | null = '',
): string | null {
  const value = arr?.[index];
  if (value === undefined || value === null) return fallback;
  return jsonToString(value);
}

/** Kotlin `JSONArray.opt(i)` (any type). */
export function arrayOpt(arr: JsonArray | null | undefined, index: number): JsonValue | undefined {
  return arr?.[index];
}

/** Kotlin `JSONArray.optInt(i, fallback)`. */
export function arrayOptInt(arr: JsonArray | null | undefined, index: number, fallback = 0): number {
  const value = arr?.[index];
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Kotlin `JSONArray.optDouble(i, fallback)`. */
export function arrayOptDouble(
  arr: JsonArray | null | undefined,
  index: number,
  fallback = Number.NaN,
): number {
  const value = arr?.[index];
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function arrayOptBoolean(
  arr: JsonArray | null | undefined,
  index: number,
  fallback = false,
): boolean {
  const value = arr?.[index];
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

/** Kotlin `JSONObject.keys()` — insertion order, as `LinkedHashMap` does. */
export function keys(obj: JsonObject | null | undefined): string[] {
  return obj == null ? [] : Object.keys(obj);
}

/** Kotlin `org.json.JSONObject(text)` — returns `null` instead of throwing. */
export function parseJsonObject(text: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Kotlin `org.json.JSONObject(text)` — the throwing constructor. Android's
 * `JSONException` becomes a JS `SyntaxError`; every ported `catch` block maps
 * both to `SourceException.ParseError` with the same message.
 */
export function parseJsonObjectOrThrow(text: string): JsonObject {
  const parsed: unknown = JSON.parse(text);
  if (!isJsonObject(parsed)) throw new SyntaxError('Expected a JSON object');
  return parsed;
}

/** Kotlin `org.json.JSONArray(text)` — the throwing constructor. */
export function parseJsonArrayOrThrow(text: string): JsonArray {
  const parsed: unknown = JSON.parse(text);
  if (!isJsonArray(parsed)) throw new SyntaxError('Expected a JSON array');
  return parsed;
}

/** Kotlin `org.json.JSONArray(text)` — returns `null` instead of throwing. */
export function parseJsonArray(text: string): JsonArray | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Kotlin `Iterable.firstNotNullOfOrNull { ... }`. */
export function firstNotNullOfOrNull<T>(items: readonly T[], transform: (item: T) => T | null): T | null {
  for (const item of items) {
    const mapped = transform(item);
    if (mapped !== null) return mapped;
  }
  return null;
}

/** Kotlin `Iterable.distinct()` / `distinctBy { }`. */
export function distinct<T>(items: Iterable<T>, keyOf?: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  let auto = 0;
  for (const item of items) {
    const key = keyOf !== undefined ? keyOf(item) : `${String(auto++)}${safeKey(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function safeKey(item: unknown): string {
  return typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item);
}

/**
 * Kotlin `String?.isNullOrBlank()` / `String?.isNullOr_empty()` — the local
 * helper `private fun String?.isNull_blank()` in `SourceImporter.kt` and the
 * `isNullOrEmpty() || it == "null"` filters in `AniListClient.kt`.
 */
export function isNullOrBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

/** Kotlin `String?.isNullOrEmpty()`. */
export function isNullOrEmpty(value: string | null | undefined): boolean {
  return value == null || value.length === 0;
}