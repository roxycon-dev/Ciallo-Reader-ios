/**
 * Android `JsonPathResolver.kt` → `src/core/parser/jsonPathResolver.ts`.
 *
 * 2026-10-06 review note: no behavior change. The `"$.."` segments quirk
 * ("$." prefix strip eats one dot of "..", so no recursive descent) was
 * already ported; the unit tests were corrected to assert the Android
 * behavior plus the explicit `**` spelling that does descend.
 */
import { validateJson, validateRule } from './ruleBudget';

export const MAX_RESULTS_PER_STEP = 10000;
export const MAX_JSON_DEPTH = 64;

type JsonObject = Record<string, unknown>;

function valueToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIndex(s: string): number | null {
  // Kotlin `indexStr.toIntOrNull() ?: -1`（L183）同样接受前导 `+`，与 `getLong`
  // 的 `toLongOrNull()` 一致（E88）。
  if (!/^[+-]?\d+$/.test(s)) return null;
  return Number.parseInt(s, 10);
}

function distinct(list: string[]): string[] {
  return Array.from(new Set(list));
}

export function resolveArray(jsonStr: string, path: string): Array<Record<string, unknown>> {
  if (jsonStr.trim() === '') return [];
  const root = parseRoot(jsonStr);
  if (root === undefined) return [];
  const targets = resolveAll([root], parseSegments(path));
  const resultList: Array<Record<string, unknown>> = [];
  for (const target of targets) {
    if (Array.isArray(target)) {
      for (const item of target) {
        if (isPlainObject(item)) resultList.push(item);
      }
    } else if (isPlainObject(target)) {
      resultList.push(target);
    }
  }
  return resultList;
}

export function getString(obj: JsonObject, path: string | null | undefined): string | null {
  if (path == null || path === '') return null;
  const targets = resolveAll([obj], parseSegments(path));
  for (const target of targets) {
    if (target === null || target === undefined) continue;
    return valueToString(target);
  }
  return null;
}

export function getLong(obj: JsonObject, path: string | null | undefined): number | null {
  const str = getString(obj, path);
  if (str == null) return null;
  // Kotlin `String.toLongOrNull()`（L53）接受一个可选的**前导正号**：`+42` → 42。
  // JS 的 `/^-?\d+$/` 会拒绝它，所以这里显式允许 `+`（E88）。
  if (!/^[+-]?\d+$/.test(str)) return null;
  return Number.parseInt(str, 10);
}

export function resolveStringArray(jsonStr: string, path: string): string[] {
  if (jsonStr.trim() === '' || path.trim() === '') return [];
  const root = parseRoot(jsonStr);
  if (root === undefined) return [];
  const targets = resolveAll([root], parseSegments(path));
  const result: string[] = [];
  for (const target of targets) {
    if (Array.isArray(target)) {
      for (const v of target) {
        if (v !== null && v !== undefined) result.push(valueToString(v));
      }
    } else if (target !== null && target !== undefined) {
      result.push(valueToString(target));
    }
  }
  return distinct(result);
}

function parseRoot(jsonStr: string): unknown {
  validateJson(jsonStr);
  const trimmed = jsonStr.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function parseSegments(path: string): string[] {
  validateRule(path);
  let p = path.trim();
  if (p === '' || p === '$') return [];
  if (p.startsWith('@json:')) p = p.slice('@json:'.length).trim();
  // Kotlin JsonPathResolver.parseSegments has TWO branches, in this order:
  //   if (p.startsWith("$.")) p = p.removePrefix("$.")
  //   else if (p.startsWith("$")) p = p.removePrefix("$")
  // The `$.` branch wins for "$..books", leaving ".books" — the `..` → `**.`
  // rewrite below therefore does NOT fire and no recursive descent happens
  // (verified against the compiled Android resolver: `$..books` → []).
  if (p.startsWith('$.')) p = p.slice(2);
  else if (p.startsWith('$')) p = p.slice(1);
  p = p.replace(/\.\./g, '**.');
  p = p.replace(/\[\*\]/g, '[]');
  const segments = p.split('.').filter((s) => s !== '');
  return mergeRecursiveMarkers(segments);
}

function mergeRecursiveMarkers(segments: string[]): string[] {
  const merged: string[] = [];
  for (const seg of segments) {
    if (seg === '**' && merged[merged.length - 1] === '**') continue;
    merged.push(seg);
  }
  return merged;
}

function resolveAll(inputs: unknown[], segments: string[]): unknown[] {
  let current = inputs;
  for (const segment of segments) {
    current = resolveSegmentAll(current, segment);
    if (current.length > MAX_RESULTS_PER_STEP) {
      throw new Error('JSONPath 结果过多');
    }
    if (current.length === 0) return [];
  }
  return current;
}

function resolveSegmentAll(inputs: unknown[], segment: string): unknown[] {
  const out: unknown[] = [];

  if (segment === '**') {
    const pending: Array<{ value: unknown; depth: number }> = [];
    for (const value of inputs) pending.push({ value, depth: 0 });
    let head = 0;
    while (head < pending.length) {
      if (out.length >= MAX_RESULTS_PER_STEP) throw new Error('JSONPath 遍历节点过多');
      const entry = pending[head];
      if (entry === undefined) break;
      head += 1;
      if (entry.depth > MAX_JSON_DEPTH) throw new Error('JSONPath 嵌套过深');
      out.push(entry.value);
      if (entry.value !== null && typeof entry.value === 'object') {
        if (Array.isArray(entry.value)) {
          for (const item of entry.value) {
            if (item !== null && item !== undefined) {
              pending.push({ value: item, depth: entry.depth + 1 });
            }
          }
        } else {
          for (const key of Object.keys(entry.value as JsonObject)) {
            const v = (entry.value as JsonObject)[key];
            if (v !== null && v !== undefined) {
              pending.push({ value: v, depth: entry.depth + 1 });
            }
          }
        }
      }
      if (pending.length - head > MAX_RESULTS_PER_STEP) throw new Error('JSONPath 遍历节点过多');
    }
    return out;
  }

  if (segment === '[]') {
    for (const item of inputs) {
      if (Array.isArray(item)) {
        for (const value of item) {
          if (value !== null && value !== undefined) out.push(value);
        }
      }
    }
    return out;
  }

  const bracketIdx = segment.indexOf('[');
  if (bracketIdx !== -1 && segment.endsWith(']')) {
    const key = segment.slice(0, bracketIdx);
    const indexStr = segment.slice(bracketIdx + 1, segment.length - 1);

    if (indexStr.trim() === '') {
      for (const item of inputs) {
        const arr =
          key !== '' && isPlainObject(item)
            ? item[key]
            : item;
        if (Array.isArray(arr)) {
          for (const value of arr) {
            if (value !== null && value !== undefined) out.push(value);
          }
        }
      }
      return out;
    }

    const index = parseIndex(indexStr);
    for (const item of inputs) {
      const arr =
        key !== '' && isPlainObject(item)
          ? item[key]
          : item;
      if (Array.isArray(arr) && index !== null && index >= 0 && index < arr.length) {
        const value = arr[index];
        if (value !== null && value !== undefined) out.push(value);
      }
    }
    return out;
  }

  for (const item of inputs) {
    if (isPlainObject(item)) {
      const value = item[segment];
      if (value !== null && value !== undefined) out.push(value);
    }
  }
  return out;
}
