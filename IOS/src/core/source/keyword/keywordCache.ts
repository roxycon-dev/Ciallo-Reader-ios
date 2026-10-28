/**
 * Android `com.example.source.keyword.KeywordCache.kt` (82 lines, 76 non-blank)
 * → `src/core/source/keyword/keywordCache.ts`.
 *
 * Kotlin class KDoc (line 9), verbatim:
 * `Rebuildable metadata only; no migration of the user's books database is needed.`
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-7     package/imports                          → header + imports
 *   9       class KDoc                               → header comment (verbatim)
 *   10      class + directory + now()                → KeywordCache ctor
 *   11-12   data class Entry                         → KeywordCacheEntry interface
 *   14-19   file(input) — SHA-256 of "v1:" + query   → cacheFile()
 *   21-44   read()                                   → read()
 *   46-68   write()                                  → write()
 *   71-81   writeAliases()                           → writeAliases()
 *
 * Skipped lines / adaptations:
 *   - `android.util.AtomicFile` (tmp-file + fsync + rename) → `writeFileAtomic()`:
 *     write to `"<digest>.json.tmp"`, then delete-then-rename. The platform
 *     `FileSystemApi` has no `rename`, so the rename is expressed as
 *     delete-then-write; the crash-atomicity guarantee is weaker and is called
 *     out here rather than silently dropped.
 *   - `java.io.File.isFile / length() / listFiles() / lastModified() / delete()` →
 *     `FileSystemApi.exists / readFile / list / delete`. `lastModified()` has no
 *     counterpart in the platform interface, so the LRU prune at lines 66-67
 *     falls back to the lexicographic order of the file names (the digest), which
 *     is stable and still bounds the directory at 512 files. The prune bound
 *     itself (512) is preserved.
 *   - `MessageDigest.getInstance("SHA-256")` + `"%02x".format(it)` →
 *     `crypto.subtle.digest('SHA-256', …)`; `read()`/`write()`/`writeAliases()`
 *     are therefore `async`.
 *   - `@Synchronized` → dropped; JS is single-threaded and these methods are
 *     already atomic per await point in practice. Ordering is unchanged.
 *   - `runCatching { … }.getOrNull()` → `try { … } catch { return null }`.
 *   - `JSONObject`/`JSONArray` → the `org.json` subset in `../impl/jsonSupport`
 *     (`getString` → strict `requireString` because Kotlin's `getString` throws).
 *   - `optInt("version")` / `getLong("expires")` coercions preserved.
 */

import type { FileSystemApi } from '@platform/interfaces';
import {
  isJsonObject,
  optInt,
  optJsonArray,
  optString,
  parseJsonObjectOrThrow,
} from '../impl/jsonSupport';
import type { JsonObject } from '../impl/jsonSupport';
import { AsyncMutex } from '../impl/sourceHttp';
import type { KeywordConcept, KeywordName, KeywordProviderState } from './keywordModels';
import { query } from './keywordModels';

/** Rebuildable metadata only; no migration of the user's books database is needed. */

/** Kotlin `data class Entry(concepts, fresh, states)`. */
export interface KeywordCacheEntry {
  readonly concepts: KeywordConcept[];
  readonly fresh: boolean;
  readonly states: KeywordProviderState[];
}

/** Kotlin `private fun file(input: String): File` — SHA-256 of `"v1:" + query`. */
export async function cacheFileName(input: string): Promise<string> {
  const digest = await sha256Hex(`v1:${query(input)}`);
  return `${digest}.json`;
}

/** Kotlin `MessageDigest("SHA-256")` hex encoding (lowercase, 2 digits per byte). */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let out = '';
  for (const byte of digest) out += byte.toString(16).padStart(2, '0');
  return out;
}

export class KeywordCache {
  private readonly mutex = new AsyncMutex();

  constructor(
    private readonly fs: FileSystemApi,
    private readonly directory: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Kotlin `@Synchronized fun read(input: String): Entry?` (lines 21-44). */
  async read(input: string): Promise<KeywordCacheEntry | null> {
    return this.mutex.withLock(async () => {
      try {
        const target = `${this.directory}/${await cacheFileName(input)}`;
        if (!(await this.fs.exists(target))) return null;
        const bytes = await this.fs.readFile(target);
        if (bytes.byteLength > 128 * 1024) return null;
        const text = new TextDecoder('utf-8').decode(bytes);
        const obj = parseJsonObjectOrThrow(text);
        const version = optInt(obj, 'version');
        if (version < 1 || version > 3) return null;
        const rows = optJsonArray(obj, 'concepts');
        if (rows == null) return null;
        if (rows.length > 16) throw new Error('keyword cache: too many concepts');
        const concepts: KeywordConcept[] = [];
        for (let i = 0; i < rows.length; i += 1) {
          const row = rows[i];
          if (!isJsonObject(row)) throw new Error('keyword cache: bad row');
          const names = optJsonArray(row, 'names');
          if (names == null) throw new Error('keyword cache: bad names');
          if (names.length > 64) throw new Error('keyword cache: too many names');
          const parsed: KeywordName[] = [];
          for (let j = 0; j < names.length; j += 1) {
            const n = names[j];
            if (!isJsonObject(n)) throw new Error('keyword cache: bad name');
            parsed.push({
              text: requireString(n, 'text').slice(0, 160),
              language: requireString(n, 'lang'),
            });
          }
          concepts.push({
            id: requireString(row, 'id'),
            names: parsed,
            source: requireString(row, 'source'),
          });
        }
        const attempts = optJsonArray(obj, 'providers');
        const states: KeywordProviderState[] = [];
        if (attempts != null && version >= 3) {
          const limit = Math.min(attempts.length, 12);
          for (let i = 0; i < limit; i += 1) {
            const row = attempts[i];
            if (!isJsonObject(row)) throw new Error('keyword cache: bad provider row');
            states.push({
              provider: requireString(row, 'id'),
              outcome: requireString(row, 'outcome'),
              // Kotlin L41 `row.getLong("retryAt")` — 缺失即抛（E89）。
              retryAt: requireLong(row, 'retryAt'),
              detail: optString(row, 'detail', '') ?? '',
            });
          }
        }
        return {
          concepts,
          // Kotlin L43 `version >= 3 && obj.getLong("expires") > now()` — 缺失即抛（E89）。
          fresh: version >= 3 && requireLong(obj, 'expires') > this.now(),
          states,
        };
      } catch {
        return null;
      }
    });
  }

  /**
   * Kotlin `@Synchronized fun write(input, concepts, ttlMs, states)` (lines 46-68).
   */
  async write(
    input: string,
    concepts: KeywordConcept[],
    ttlMs: number,
    states: KeywordProviderState[] = [],
  ): Promise<void> {
    await this.mutex.withLock(async () => {
      const rows: JsonObject[] = [];
      for (const concept of concepts.slice(0, 16)) {
        const names: JsonObject[] = [];
        for (const name of concept.names.slice(0, 64)) {
          names.push({ text: name.text.slice(0, 160), lang: name.language });
        }
        rows.push({ id: concept.id, source: concept.source, names });
      }
      const providers: JsonObject[] = [];
      for (const state of states.slice(0, 12)) {
        providers.push({
          id: state.provider,
          outcome: state.outcome,
          retryAt: state.retryAt,
          detail: state.detail,
        });
      }
      const payload: JsonObject = {
        version: 3,
        expires: this.now() + ttlMs,
        concepts: rows,
        providers,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      const name = await cacheFileName(input);
      await this.writeFileAtomic(`${this.directory}/${name}`, bytes);
      // Fixed bound, including stale entries; no growing archive of searched words.
      const listed = (await this.fs.list(this.directory)).filter((it) => it.endsWith('.json'));
      for (const stale of listed.sort().slice(512)) {
        await this.fs.delete(`${this.directory}/${stale}`);
      }
    });
  }

  /** A few canonical aliases reuse the same entity after process restarts. */
  async writeAliases(
    input: string,
    concepts: KeywordConcept[],
    ttlMs: number,
  ): Promise<void> {
    if (concepts.length !== 1) return;
    const concept = concepts[0] as KeywordConcept;
    const allowed = new Set(['en', 'ja', 'native', 'romaji', 'latin']);
    const seenLanguages = new Set<string>();
    const candidates: KeywordName[] = [];
    for (const name of concept.names) {
      if (!allowed.has(name.language) || name.text.length < 4) continue;
      if (seenLanguages.has(name.language)) continue;
      seenLanguages.add(name.language);
      candidates.push(name);
    }
    for (const alias of candidates.slice(0, 5)) {
      if (query(alias.text) === query(input)) continue;
      const existing = await this.read(alias.text);
      if (
        existing === null ||
        existing.concepts.every((it) => it.id === concept.id)
      ) {
        await this.write(alias.text, concepts, ttlMs);
      }
    }
  }

  /**
   * `AtomicFile.startWrite / finishWrite / failWrite` — the platform filesystem
   * has no rename, so the swap is delete-then-write. `failWrite` semantics (keep
   * the previous file) degrade to "previous file untouched when the encode
   * throws", which is the only failure mode reachable from this module.
   */
  private async writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
    if (await this.fs.exists(path)) {
      await this.fs.delete(path);
    }
    await this.fs.writeFile(path, bytes);
  }
}

/** Kotlin `JSONObject.getString(name)` — throws when absent. */
function requireString(obj: JsonObject, key: string): string {
  const value = obj[key];
  if (typeof value === 'string') return value;
  throw new Error(`keyword cache: missing string field "${key}"`);
}

/**
 * Kotlin `JSONObject.getLong(key)` (L41/L43) — **缺失即抛**。
 *
 * E89：这两处原先用 `optLong(…, 0)`，缺失字段被当成 0，于是「坏条目」被解读成
 * 「存在但已过期 / retryAt=0」。Kotlin 的 `getLong` 缺失会抛 JSONException，被
 * `read` 外层的 `runCatching { … }.getOrNull()` 吞掉 —— 整条缓存当作**不存在**。
 * 两者对「陈旧缓存」的一次性行为差就在这里。
 */
function requireLong(obj: JsonObject, key: string): number {
  const value = obj[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`keyword cache: missing numeric field "${key}"`);
}

/** Kotlin `org.json.JSONObject(text)` is `parseJsonObjectOrThrow` in `../impl/jsonSupport`. */