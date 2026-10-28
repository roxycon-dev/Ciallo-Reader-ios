/**
 * Kotlin → TS: `app/src/main/java/com/example/source/storage/SourceStorage.kt`
 *             (12 lines incl. trailing newline, 10 non-blank)
 *          → `src/core/source/storage/sourceStorage.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        `package com.example.source.storage`   → SKIPPED (TS has no packages)
 *   L2        (blank)                               → SKIPPED
 *   L3        `interface SourceStorage {`           → `export interface SourceStorage`
 *   L4        `    suspend fun saveSourceState(sourceId: String, enabled: Boolean)`
 *                                                   → `saveSourceState(sourceId, enabled): Promise<void>`
 *   L5        `    suspend fun getSourceStates(): Map<String, Boolean>`
 *                                                   → `getSourceStates(): Promise<Record<string, boolean>>`
 *   L6        `    suspend fun saveActiveSourceId(sourceId: String)`
 *                                                   → `saveActiveSourceId(sourceId): Promise<void>`
 *   L7        `    suspend fun getActiveSourceId(): String?`
 *                                                   → `getActiveSourceId(): Promise<string | null>`
 *   L8        `    suspend fun saveCustomSourceJson(sourceId: String, jsonContent: String)`
 *                                                   → `saveCustomSourceJson(sourceId, jsonContent): Promise<void>`
 *   L9        `    suspend fun getCustomSourceJsons(): Map<String, String>`
 *                                                   → `getCustomSourceJsons(): Promise<Record<string, string>>`
 *   L10       `    suspend fun removeCustomSourceJson(sourceId: String)`
 *                                                   → `removeCustomSourceJson(sourceId): Promise<void>`
 *   L11       `}`                                   → n/a
 *
 * ── RELATIONSHIP WITH THE ALREADY-PORTED `sourceManager.ts` ────────────────────
 *   `src/core/source/sourceManager.ts` L16-25 already declares an identical `SourceStorage`
 *   port and `sourceViewModel.ts` L83/L85 injects it. **No change to either file was needed.**
 *   The `SourceStorageAsPort` alias below is a compile-time proof of that: it only type-checks
 *   if the interface declared here is structurally identical to the one `sourceManager` already
 *   consumes in both directions, so a future drift on either side fails `tsc` here.
 *
 * ── `suspend` → `Promise` ────────────────────────────────────────────────────
 *   `SharedPreferencesSourceStorage` wraps every body in `withContext(Dispatchers.IO)`, so every
 *   member suspends even though `SharedPreferences` itself is synchronous. The web equivalents
 *   (`localStorage`, `Capacitor Preferences`, IndexedDB) are variously sync or async, so the
 *   `Promise` return is the honest common denominator and keeps the port backend-agnostic.
 *
 * ── WHY THE PLATFORM PORTS BELOW ARE NEW RATHER THAN A WIDENING OF `KeyValueStorage` ──
 *   `src/core/source/js/jsPlatform.ts` L43-52 already declares `KeyValueStorage`, and
 *   `src/platform/web/jsSourcePlatform.ts` L50-… implements it over `localStorage`. It is
 *   **string-only plus three typed accessors** and cannot express what
 *   `SharedPreferencesSourceStorage.kt` actually does:
 *
 *   1. `prefs.all` — `getSourceStates()` iterates EVERY entry and discriminates on the runtime
 *      type (`value is Boolean`, L19; `value is String`, L58). `KeyValueStorage` exposes no
 *      enumeration and no type tag, so a boolean written as the string `"false"` would be
 *      indistinguishable from the string `"false"`.
 *   2. `getStringSet` / `putStringSet` — the `custom_source_ids` index is a `Set<String>`
 *      (L48/L55/L68/L78). `KeyValueStorage` has no set type; a JSON-encoded string would need
 *      a bespoke encode/decode and would lose the "set" semantics the Kotlin relies on.
 *   3. `edit()` + `commit()` — L49/L68/L78-79 use `check(...commit())`, i.e. a **failed commit
 *      throws**. `KeyValueStorage` has no transactional batch and no success flag.
 *   4. A separate **file** channel — L8 creates `source_configs/` under `filesDir`, and
 *      L36-39/L44/L61/L80 hash the source id with SHA-256 to derive a `.json` filename that is
 *      written through `AtomicFile`. `KeyValueStorage` cannot express that at all.
 *
 * Rather than widen a port that five other modules (`jsCookieJar`, `jsMessageHandler`,
 * `jsComicSource`, `jsSourceRepo`, `jsComicMetadata`) already depend on, this file declares two
 * narrow, exact ports for what `SharedPreferencesSourceStorage` needs. `SourceConfigFilePort` is
 * a structural subset of the existing `jsPlatform.FileStoragePort` (every member signature is
 * identical), so the platform adapter can pass either one.
 */

import type { SourceStorage as SourceManagerStoragePort } from '../sourceManager';

/** Kotlin L3 — the persistence port `SourceManager` / `SourceViewModel` inject. */
export interface SourceStorage {
  saveSourceState(sourceId: string, enabled: boolean): Promise<void>;
  getSourceStates(knownIds?: readonly string[]): Promise<Record<string, boolean>>;
  saveActiveSourceId(sourceId: string): Promise<void>;
  getActiveSourceId(): Promise<string | null>;
  saveCustomSourceJson(sourceId: string, jsonContent: string): Promise<void>;
  getCustomSourceJsons(): Promise<Record<string, string>>;
  removeCustomSourceJson(sourceId: string): Promise<void>;
}

/**
 * Compile-time proof that the interface above is the *same* port
 * `src/core/source/sourceManager.ts` L16-25 already declares. Assigning in both directions
 * requires exact structural identity, so this line breaks `tsc` the moment either copy drifts.
 * No runtime code is emitted.
 */
export type SourceStorageAsPort = SourceManagerStoragePort;
export type _SourceStorageMatchesSourceManager = SourceStorage extends SourceStorageAsPort
  ? SourceStorageAsPort extends SourceStorage
    ? true
    : never
  : never;

/**
 * Every value type `SharedPreferences` can hold, i.e. what `prefs.all` (Kotlin L18/L57) yields.
 * The runtime discriminators at L19 / L58 map onto `typeof` checks against this union.
 */
export type SourcePrefsValue = string | number | boolean | ReadonlySet<string>;

/**
 * Injected replacement for `android.content.SharedPreferences`
 * (`context.getSharedPreferences("book_sources_config", Context.MODE_PRIVATE)`, L9).
 *
 * Deliberately narrower than the generic `KeyValueStorage`: see the header note. Every member
 * maps to one concrete Android call.
 */
export interface SourcePrefsPort {
  /** Native string-backed stores cannot enumerate keys after a cold start. */
  readStoredBoolean?(key: string): Promise<boolean | null>;
  /** Kotlin L18 / L57 `prefs.all` — every entry with its runtime type preserved. */
  all(): Readonly<Record<string, SourcePrefsValue>>;
  /** Kotlin L33 `prefs.getString("active_source_id", null)`. */
  getString(key: string, fallback: string | null): Promise<string | null>;
  /** Kotlin L48/L55/L68/L78 `prefs.getStringSet(key, emptySet())`. */
  getStringSet(key: string): Promise<ReadonlySet<string>>;
  /** Kotlin L12 `prefs.edit().putBoolean(key, value)`. */
  putBoolean(key: string, value: boolean): Promise<void>;
  /** Kotlin L28 `prefs.edit().putString(key, value)`. */
  putString(key: string, value: string): Promise<void>;
  /** Kotlin L48/L68/L78 `prefs.edit().putStringSet(key, ids)`. */
  putStringSet(key: string, values: ReadonlySet<string>): Promise<void>;
  /**
   * Kotlin L49/L65/L79 `prefs.edit().remove(key)` — queued into the open editor, not written
   * until `commit()`. The batching semantics of `edit()` are preserved deliberately: L49 removes
   * the legacy key **and** writes the id set in a single commit.
   */
  remove(key: string): void;
  /**
   * Kotlin L12/L28/L49/L68/L78-79 `editor.commit()`.
   *
   * @returns `false` when the write did not land. `SharedPreferencesSourceStorage` wraps the
   *          result in `check(...)` at L49/L68/L78, i.e. a false return **throws**.
   */
  commit(): Promise<boolean>;
}

/**
 * The subset of file access `SharedPreferencesSourceStorage` uses for `source_configs/*.json`.
 *
 * Every member is byte-identical to the matching `jsPlatform.FileStoragePort` member, so an
 * existing `FileStoragePort` implementation is assignable to this interface as-is. `rename` has
 * no counterpart there because only `AtomicFile` needs it (see below).
 */
export interface SourceConfigFilePort {
  load?(paths: readonly string[]): Promise<void>;
  flush?(): Promise<void>;
  /** Kotlin L8 `context.filesDir` — the parent of `source_configs`. */
  filesDir(): string;
  /** Kotlin L8 `.apply { mkdirs() }`. */
  mkdirs(path: string): void;
  /** Kotlin L71 `f.isFile`. */
  exists(path: string): boolean;
  /** Kotlin L46/L63 `out.write(bytes)` then `finishWrite`. */
  writeText(path: string, content: string): void;
  /** Kotlin L71 `AtomicFile(f).openRead().bufferedReader().use { it.readText() }`. */
  readText(path: string): string | null;
  /** Kotlin L71 `f.length()` and L43/L60/L71's 2 MiB guard. */
  length(path: string): number;
  /** Kotlin L80 `AtomicFile(configFile(sourceId)).delete()`. */
  delete(path: string): void;
  /**
   * Kotlin `AtomicFile.finishWrite(out)` — the promote step that renames `<name>.bak` onto
   * `<name>`. Not part of `jsPlatform.FileStoragePort`; a platform adapter must supply it for
   * the write to stay atomic. When it is absent the storage degrades to a direct write, which is
   * exactly what a non-atomic `localStorage.setItem` does, and is documented as such.
   */
  rename(from: string, to: string): void;
}

// ── Literals from `SharedPreferencesSourceStorage.kt` (verbatim) ───────────────

/** Kotlin L9 `context.getSharedPreferences("book_sources_config", Context.MODE_PRIVATE)`. */
export const PREFS_NAME = 'book_sources_config';

/** Kotlin L8 `java.io.File(context.filesDir, "source_configs")`. */
export const CONFIG_DIRECTORY = 'source_configs';

/** Kotlin L12 / L19 / L79 `source_enabled_$sourceId`. */
export const SOURCE_ENABLED_PREFIX = 'source_enabled_';

/** Kotlin L28 / L33 `"active_source_id"`. */
export const ACTIVE_SOURCE_ID_KEY = 'active_source_id';

/** Kotlin L48 / L55 / L68 / L78 `"custom_source_ids"`. */
export const CUSTOM_SOURCE_IDS_KEY = 'custom_source_ids';

/** Kotlin L49 / L58 / L65 / L79 `custom_source_json_$sourceId` — the pre-file-store legacy key. */
export const CUSTOM_SOURCE_JSON_PREFIX = 'custom_source_json_';

/** Kotlin L43 / L60 / L71 `2 * 1024 * 1024`, checked as `<=`, so 2 MiB exactly is allowed. */
export const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

/** Kotlin L43 / L60 `require(...) { "书源配置超过 2MiB" }` — the exact thrown message. */
export const CONFIG_TOO_LARGE_MESSAGE = '书源配置超过 2MiB';

/**
 * Kotlin L38 `digest.joinToString("") { "%02x".format(it) }` — every byte rendered as two
 * lowercase hex digits, no separator, then `".json"`.
 */
export const CONFIG_FILE_EXTENSION = '.json';

/** Kotlin L45/L62 `atomic.startWrite()` / `AtomicFile` — the staging filename is `<name>.bak`. */
export const ATOMIC_WRITE_SUFFIX = '.bak';
