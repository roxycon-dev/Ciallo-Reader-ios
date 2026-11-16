/**
 * Support module (no Android counterpart in `source/js/`).
 *
 * `org.json` (the JVM JSON model used by every file in this module) ported to
 * TypeScript. Kotlin code leans on org.json's *lenient* accessor semantics:
 * `optString` returns the literal text `"null"` for an explicit JSON null,
 * `optBoolean` coerces the strings `"true"`/`"false"`, and `opt(name)` never
 * returns `undefined` — it returns the `JSONObject.NULL` sentinel. Those
 * quirks are load-bearing in `JsComicSource`/`JsComicMetadata`
 * (`cover = c.optString("cover", "").ifBlank { null }` would otherwise yield
 * `"null"` for absent fields), so they are reproduced exactly here.
 *
 * Key order: JS objects preserve insertion order for non-integer keys, which
 * matches `LinkedHashMap` ordering in `JSONObject`, so `toString()` output
 * (and therefore the JSON handed back to the JS source scripts) is identical.
 */

export const JSON_NULL = null as unknown;

/** org.json `JSONObject.NULL` sentinel — distinguishable from JS `null` returns. */
function isNullSentinel(value: unknown): boolean {
  return value === JSON_NULL;
}

/**
 * org.json `JSON.toString(Object)`:
 * String → itself, non-null → `String.valueOf`, null → `null` (Java null).
 */
function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return null;
  if (isNullSentinel(value)) return 'null';
  return String(value);
}

/** org.json `JSON.toBoolean(Object)`. */
function toBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class JSONArray {
  private readonly items: unknown[];

  constructor(source?: string | unknown[] | null) {
    if (source === undefined || source === null) {
      this.items = [];
    } else if (typeof source === 'string') {
      const parsed: unknown = JSON.parse(source);
      if (!Array.isArray(parsed)) {
        throw new Error(`Value ${source} of type java.lang.String cannot be converted to JSONArray`);
      }
      this.items = parsed;
    } else {
      this.items = source;
    }
  }

  length(): number {
    return this.items.length;
  }

  /** org.json `opt(index)` — `JSONObject.NULL` for out-of-range / JSON null. */
  opt(index: number): unknown {
    if (index < 0 || index >= this.items.length) return JSON_NULL;
    const value = this.items[index];
    return value === null ? JSON_NULL : value;
  }

  optJSONObject(index: number): JSONObject | null {
    const value = this.opt(index);
    return isPlainObject(value) ? new JSONObject(value) : null;
  }

  optJSONArray(index: number): JSONArray | null {
    const value = this.opt(index);
    if (Array.isArray(value)) return new JSONArray(value);
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? new JSONArray(parsed) : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  optString(index: number): string;
  optString(index: number, fallback: string): string;
  optString(index: number, fallback = ''): string {
    return toStringOrNull(this.opt(index)) ?? fallback;
  }

  put(value: unknown): JSONArray {
    this.items.push(value === undefined ? JSON_NULL : value);
    return this;
  }

  /**
   * org.json serialises nested wrappers through their own `toString()`, not
   * through their object shape — without this a nested `JSONArray` would leak
   * its private `items` field into the output.
   */
  toJSON(): unknown[] {
    return this.items.map((item) => unwrapJson(item));
  }

  toString(): string {
    return JSON.stringify(this.toJSON());
  }
}

function unwrapJson(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof JSONArray) return value.toJSON();
  if (value instanceof JSONObject) return value.toJSON();
  if (isNullSentinel(value)) return null;
  if (value === null) return null;
  return value;
}

export class JSONObject {
  private readonly entries: Map<string, unknown>;

  constructor(source?: string | Map<string, unknown> | Record<string, unknown> | null) {
    this.entries = new Map();
    if (source === undefined || source === null) return;
    if (typeof source === 'string') {
      const parsed: unknown = JSON.parse(source);
      if (!isPlainObject(parsed)) {
        throw new Error(
          `Value ${source} of type java.lang.String cannot be converted to JSONObject`,
        );
      }
      for (const [key, value] of Object.entries(parsed)) this.entries.set(key, value);
      return;
    }
    if (source instanceof Map) {
      for (const [key, value] of source) this.entries.set(key, value);
      return;
    }
    for (const [key, value] of Object.entries(source)) this.entries.set(key, value);
  }

  /** org.json `keys()` iterator, in insertion (LinkedHashMap) order. */
  keys(): IterableIterator<string> {
    return this.entries.keys();
  }

  /** org.json `opt(name)` — `JSONObject.NULL` for absent / explicit null. */
  opt(name: string): unknown {
    if (!this.entries.has(name)) return JSON_NULL;
    const value = this.entries.get(name);
    return value === undefined ? JSON_NULL : value;
  }

  /** org.json `has(name)` — true when the key is present, even if its value is null. */
  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** org.json `isNull(name)` — true when the key is absent or explicitly null. */
  isNull(name: string): boolean {
    return this.opt(name) === JSON_NULL;
  }

  optJSONObject(name: string): JSONObject | null {
    const value = this.opt(name);
    return isPlainObject(value) ? new JSONObject(value) : null;
  }

  optJSONArray(name: string): JSONArray | null {
    const value = this.opt(name);
    if (Array.isArray(value)) return new JSONArray(value);
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? new JSONArray(parsed) : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  optString(name: string): string;
  optString(name: string, fallback: string): string;
  optString(name: string, fallback = ''): string {
    return toStringOrNull(this.opt(name)) ?? fallback;
  }

  optBoolean(name: string): boolean;
  optBoolean(name: string, fallback: boolean): boolean;
  optBoolean(name: string, fallback = false): boolean {
    return toBooleanOrNull(this.opt(name)) ?? fallback;
  }

  optLong(name: string, fallback: number): number {
    const value = this.opt(name);
    if (typeof value === 'number') return Math.trunc(value);
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (value.trim() !== '' && Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return fallback;
  }

  optDouble(name: string, fallback: number): number {
    const value = this.opt(name);
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (value.trim() !== '' && Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  remove(name: string): unknown {
    const value = this.opt(name);
    this.entries.delete(name);
    return value;
  }

  put(name: string, value: unknown): JSONObject {
    this.entries.set(name, value === undefined ? JSON_NULL : value);
    return this;
  }

  /** org.json serialises nested wrappers via their own `toString()`. */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of this.entries) {
      out[key] = unwrapJson(value);
    }
    return out;
  }

  toString(): string {
    return JSON.stringify(this.toJSON());
  }
}

/** org.json `JSONObject.quote(String)` — a JSON string literal, quotes included. */
export function jsonQuote(value: string): string {
  return JSON.stringify(value);
}

/**
 * org.json `JSONObject.wrap(Object)`:
 * null → NULL, Map → JSONObject, Collection/array → JSONArray,
 * String/Boolean/Number pass through.
 */
export function jsonWrap(value: unknown): unknown {
  if (value === undefined || value === null) return JSON_NULL;
  if (value instanceof JSONObject || value instanceof JSONArray) return value;
  if (isNullSentinel(value)) return value;
  if (Array.isArray(value)) return new JSONArray(value);
  if (isPlainObject(value)) return new JSONObject(value);
  if (
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  return String(value);
}

/** org.json `JSONObject.NULL` — exported for call sites that compare against it. */
export const JSONObjectNULL = JSON_NULL;
