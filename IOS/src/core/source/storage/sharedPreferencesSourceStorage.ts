/**
 * Kotlin → TS: `app/src/main/java/com/example/source/storage/SharedPreferencesSourceStorage.kt`
 *             (86 lines incl. trailing newline, 74 non-blank)
 *          → `src/core/source/storage/sharedPreferencesSourceStorage.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1        `package com.example.source.storage`  → SKIPPED (TS has no packages)
 *   L2        (blank)                               → SKIPPED
 *   L3        `import android.content.Context`      → REPLACED by the injected `SourcePrefsPort`
 *                                                     + `SourceConfigFilePort`
 *   L4        `import kotlinx.coroutines.Dispatchers` → SKIPPED: there is no dispatcher. Each
 *   L5        `import kotlinx.coroutines.withContext`   method is already `async` in TS, so the
 *                                                     thread hop is a platform concern.
 *   L6        (blank)                               → SKIPPED
 *   L7        `class SharedPreferencesSourceStorage(context: Context) : SourceStorage {`
 *                                                  → `class SharedPreferencesSourceStorage` with an
 *                                                     options object instead of a Context
 *   L8        `private val directory = File(context.filesDir, "source_configs").apply { mkdirs() }`
 *                                                  → the `ensureConfigDirectory()` call plus
 *                                                     `CONFIG_DIRECTORY_NAME` / `configDirectory`
 *   L9        `private val prefs = context.getSharedPreferences("book_sources_config", MODE_PRIVATE)`
 *                                                  → the injected `prefs` port
 *   L10       (blank)                               → SKIPPED
 *   L11-14    `saveSourceState`                     → `saveSourceState`
 *   L12       `prefs.edit().putBoolean("source_enabled_$sourceId", enabled).commit()`
 *                                                  → `SOURCE_ENABLED_PREFIX + sourceId` → `putBoolean` → `commit`
 *   L13       `Unit`                                → the method's `Promise<void>` resolves to undefined
 *   L15       (blank)                               → SKIPPED
 *   L16-25    `getSourceStates`                     → `getSourceStates`
 *   L17       `val result = mutableMapOf<String, Boolean>()` → the local `result` object
 *   L18       `prefs.all.forEach { (key, value) ->` → `Object.entries(await prefs.all())`
 *   L19       `if (key.startsWith("source_enabled_") && value is Boolean)`
 *                                                  → `key.startsWith(SOURCE_ENABLED_PREFIX) && typeof value === 'boolean'`
 *   L20       `val sourceId = key.removePrefix("source_enabled_")` → `slice(SOURCE_ENABLED_PREFIX.length)`
 *   L21       `result[sourceId] = value`            → `result[sourceId] = value`
 *   L22-23    the `if` / `forEach` braces           → n/a
 *   L24       `result`                              → the returned record
 *   L25       `}`                                   → n/a
 *   L26       (blank)                               → SKIPPED
 *   L27-30    `saveActiveSourceId`                  → `saveActiveSourceId`
 *   L28       `prefs.edit().putString("active_source_id", sourceId).commit()` → verbatim
 *   L31       (blank)                               → SKIPPED
 *   L32-34    `getActiveSourceId`                   → `getActiveSourceId`
 *   L33       `prefs.getString("active_source_id", null)` → `getString(ACTIVE_SOURCE_ID_KEY, null)`
 *   L35       (blank)                               → SKIPPED
 *   L36-39    `private fun configFile(id: String): File` → `configFilePath(id)`
 *   L37       `MessageDigest.getInstance("SHA-256").digest(id.toByteArray())`
 *                                                  → the injected/portable `sha256Hex(utf8(id))`
 *   L38       `File(directory, digest.joinToString("") { "%02x".format(it) } + ".json")`
 *                                                  → `joinToString("") { "%02x".format(it) }` + `.json`
 *   L40       (blank)                               → SKIPPED
 *   L41-51    `saveCustomSourceJson`                 → `saveCustomSourceJson`
 *   L42       `synchronized(storageLock) {`         → `await storageLock.withLock(...)` (module-level, L84)
 *   L43       `require(jsonContent.toByteArray().size <= 2 * 1024 * 1024) { "书源配置超过 2MiB" }`
 *                                                  → `require(utf8ByteLength(jsonContent) <= MAX_CONFIG_BYTES, …)`
 *   L44       `val atomic = android.util.AtomicFile(configFile(sourceId))` → `AtomicFileView` over the port
 *   L45       `val out = atomic.startWrite()`        → `startWrite()` (writes `<name>.bak`)
 *   L46       `try { out.write(jsonContent.toByteArray(Charsets.UTF_8)); atomic.finishWrite(out) }`
 *                                                  → `writeText` then `finishWrite` (the `rename`)
 *   L47       `catch (e: Exception) { atomic.failWrite(out); throw e }` → `catch { failWrite(); throw }`
 *   L48       `val ids = prefs.getStringSet("custom_source_ids", emptySet()).orEmpty() + sourceId`
 *                                                  → `new Set([...ids, sourceId])`
 *   L49       `check(prefs.edit().putStringSet("custom_source_ids", ids).remove("custom_source_json_$sourceId").commit())`
 *                                                  → `check(await commit())`, throwing on `false`
 *   L50       `}`                                    → n/a
 *   L52       (blank)                               → SKIPPED
 *   L53-74    `getCustomSourceJsons`                 → `getCustomSourceJsons`
 *   L54       `synchronized(storageLock) {`          → the lock again
 *   L55       `val ids = prefs.getStringSet(…).orEmpty().toMutableSet()` → a mutable `Set`
 *   L56       `val editor = prefs.edit()`            → the implicit editor carried by the port
 *   L57       `prefs.all.forEach { (key, value) ->`  → `Object.entries(await prefs.all())`
 *   L58       `if (key.startsWith("custom_source_json_") && value is String)` → the same shape
 *   L59       `val id = key.removePrefix("custom_source_json_")` → `slice(CUSTOM_SOURCE_JSON_PREFIX.length)`
 *   L60       `require(value.toByteArray().size <= 2 * 1024 * 1024) { "书源配置超过 2MiB" }`
 *                                                  → the same size guard on the legacy value
 *   L61       `val atomic = android.util.AtomicFile(configFile(id))` → `AtomicFileView`
 *   L62-66    the second write-through + `ids.add(id); editor.remove(key)` → same as above, plus
 *                                                     the id insert and the queued key removal
 *   L67       `}`                                    → n/a
 *   L68       `check(editor.putStringSet("custom_source_ids", ids).commit())` → `check(await commit())`
 *   L69-72    `ids.mapNotNull { id -> f.isFile && f.length() <= 2MiB ? id to readText() else null }.toMap()`
 *                                                  → the `Map<string,string|null>` then filtered
 *   L73       `}`                                    → n/a
 *   L75       (blank)                               → SKIPPED
 *   L76-82    `removeCustomSourceJson`               → `removeCustomSourceJson`
 *   L77       `synchronized(storageLock) {`          → the lock again
 *   L78-79    `check(prefs.edit().putStringSet("custom_source_ids", ids - sourceId).remove("custom_source_json_$sourceId").remove("source_enabled_$sourceId").commit())`
 *                                                  → three queued edits in one commit + `check`
 *   L80       `android.util.AtomicFile(configFile(sourceId)).delete()` → `files.delete(path)`
 *   L81       `}`                                    → n/a
 *   L83       (blank)                               → SKIPPED
 *   L84       `companion object { private val storageLock = Any() }` → the module-level `storageLock`
 *   L85       `}`                                    → n/a
 *
 * ── THINGS THAT HAD TO CHANGE, AND WHY ────────────────────────────────────────
 *   1. `MessageDigest` (L37). The JDK's synchronous `MessageDigest` has **no** synchronous web
 *      counterpart — `crypto.subtle.digest` is promise-based and `SubtleCrypto` is a Web global
 *      that `src/core/**` must not assume. A synchronous, dependency-free SHA-256 is therefore
 *      supplied here (`sha256Hex`), which is what `MessageDigest.getInstance("SHA-256")` is:
 *      a pure function of the bytes. It is covered by NIST vectors in
 *      `tests/unit/sourceStorageSharedPreferences.test.ts`. Hosts that already ship a native
 *      SHA-256 may inject their own through `SourceStorageOptions.sha256Hex`.
 *   2. `String.toByteArray()` (L43/L46/L60/L63) is **UTF-8** by default, so the size guard is
 *      a UTF-8 byte count, not `.length`. `utf8ByteLength` reproduces that including surrogate
 *      pairs (a 4-byte emoji counts as 4, not 2).
 *   3. `AtomicFile` (L44/L61/L80) is Android's write-to-`.bak`-then-rename primitive. It is
 *      modelled explicitly by `AtomicFileView` so `startWrite` / `finishWrite` / `failWrite`
 *      keep their distinct outcomes rather than collapsing into one `writeText` call.
 *   4. `check(...)` (L49/L68/L78-79) throws `IllegalStateException("Failed requirement.")` —
 *      Kotlin's message when no lambda is supplied. Preserved verbatim.
 *   5. `require(…) { msg }` (L43/L60) throws `IllegalArgumentException(msg)`. Preserved as
 *      `Error(msg)` with the same Chinese text.
 *   6. `Map<String, Boolean>` (L5/L9) → `Record<string, boolean>`. A JS object cannot hold an
 *      `undefined` value and `{ __proto__: … }` is a hazard, so ids are stored with
 *      `Object.create(null)`-equivalent semantics via a plain object literal plus a
 *      `__proto__`-safe assignment.
 */

import {
  ACTIVE_SOURCE_ID_KEY,
  ATOMIC_WRITE_SUFFIX,
  CONFIG_DIRECTORY,
  CONFIG_FILE_EXTENSION,
  CONFIG_TOO_LARGE_MESSAGE,
  CUSTOM_SOURCE_IDS_KEY,
  CUSTOM_SOURCE_JSON_PREFIX,
  MAX_CONFIG_BYTES,
  PREFS_NAME,
  SOURCE_ENABLED_PREFIX,
  type SourceConfigFilePort,
  type SourcePrefsPort,
  type SourcePrefsValue,
  type SourceStorage,
} from './sourceStorage';

/** Kotlin L49/L68/L78 `check(...)` with no message lambda — Kotlin's own wording. */
const FAILED_REQUIREMENT = 'Failed requirement.';

/** Kotlin L84 `companion object { private val storageLock = Any() }` — one lock for all instances. */
class AsyncMutex {
  private tail: Promise<unknown> = Promise.resolve();

  async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => gate);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * Kotlin L84 — a **companion object**, i.e. shared by every instance in the process, exactly
 * like the Kotlin `private val storageLock` in the companion.
 */
const storageLock = new AsyncMutex();

// ── Kotlin L37 — MessageDigest.getInstance("SHA-256") ──────────────────────────

/** Kotlin L38 `"%02x".format(it)` on a signed Java byte ⇒ the unsigned byte's hex. */
const HEX_DIGITS = '0123456789abcdef';

function toHex8(value: number): string {
  return HEX_DIGITS[(value >>> 4) & 0xf] + (HEX_DIGITS[value & 0xf] ?? '0');
}

/** UTF-8 encode a JS string to bytes. Matches `String.toByteArray()` (UTF-8) exactly. */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Kotlin L43/L46/L60/L63 `String.toByteArray()` — `.size` is the **UTF-8** byte count. */
export function utf8ByteLength(text: string): number {
  return utf8Bytes(text).length;
}

// SHA-256 round constants (FIPS 180-4 §4.2.2).
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/**
 * Kotlin L37 `java.security.MessageDigest.getInstance("SHA-256").digest(bytes)` as a
 * synchronous pure function. See the header note (1) for why this is not `crypto.subtle`.
 */
export function sha256Hex(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const block = new Uint8Array(paddedLength);
  block.set(bytes);
  block[bytes.length] = 0x80;
  // 64-bit big-endian length; the high word is safe because a JS array cannot reach 2^53 bytes.
  const hi = Math.floor(bitLength / 0x100000000);
  const lo = bitLength >>> 0;
  block[paddedLength - 8] = (hi >>> 24) & 0xff;
  block[paddedLength - 7] = (hi >>> 16) & 0xff;
  block[paddedLength - 6] = (hi >>> 8) & 0xff;
  block[paddedLength - 5] = hi & 0xff;
  block[paddedLength - 4] = (lo >>> 24) & 0xff;
  block[paddedLength - 3] = (lo >>> 16) & 0xff;
  block[paddedLength - 2] = (lo >>> 8) & 0xff;
  block[paddedLength - 1] = lo & 0xff;

  const w = new Uint32Array(64);
  // Eight working registers, kept as plain locals rather than a destructured array so
  // `noUncheckedIndexedAccess` does not widen every read to `number | undefined`.
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let t = 0; t < 16; t += 1) {
      const i = offset + t * 4;
      w[t] =
        (((block[i] ?? 0) << 24) |
          ((block[i + 1] ?? 0) << 16) |
          ((block[i + 2] ?? 0) << 8) |
          (block[i + 3] ?? 0)) >>>
        0;
    }
    for (let t = 16; t < 64; t += 1) {
      const w15 = w[t - 15] ?? 0;
      const w2 = w[t - 2] ?? 0;
      const s0 = (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) >>> 0;
      const s1 = (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)) >>> 0;
      w[t] = (((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) >>> 0) as number;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let hh = h7;
    for (let t = 0; t < 64; t += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = (((e & f) ^ (~e & g)) >>> 0) as number;
      const temp1 = (hh + S1 + ch + (SHA256_K[t] ?? 0) + (w[t] ?? 0)) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = (((a & b) ^ (a & c) ^ (b & c)) >>> 0) as number;
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + hh) >>> 0;
  }

  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  let hex = '';
  for (const word of words) {
    hex +=
      toHex8((word >>> 24) & 0xff) +
      toHex8((word >>> 16) & 0xff) +
      toHex8((word >>> 8) & 0xff) +
      toHex8(word & 0xff);
  }
  return hex;
}

// ── Kotlin L44/L45/L46/L47/L62/L63/L64 — android.util.AtomicFile ──────────────

/**
 * Kotlin `android.util.AtomicFile` over `SourceConfigFilePort`.
 * `startWrite` stages into `<path>.bak`, `finishWrite` renames it into place and
 * `failWrite` unlinks the staging file — the three outcomes of L45-47 and L62-64.
 */
class AtomicFileView {
  private staging: string | null = null;

  constructor(
    private readonly files: SourceConfigFilePort,
    readonly path: string,
  ) {}

  startWrite(): string {
    this.staging = this.path + ATOMIC_WRITE_SUFFIX;
    return this.staging;
  }

  /** Kotlin L46 `out.write(...)` then L46 `atomic.finishWrite(out)`. */
  writeAndFinish(content: string): void {
    const staging = this.staging ?? this.startWrite();
    this.files.writeText(staging, content);
    this.files.rename(staging, this.path);
    this.staging = null;
  }

  /** Kotlin L47 `atomic.failWrite(out)` — leaves the previous good file untouched. */
  failWrite(): void {
    if (this.staging !== null) this.files.delete(this.staging);
    this.staging = null;
  }
}

// ── Kotlin L7 ──────────────────────────────────────────────────────────────────

export interface SourceStorageOptions {
  /** Kotlin L9 `context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE)`. */
  readonly prefs: SourcePrefsPort;
  /** Kotlin L8 / L36-L38 — file access for `source_configs/<sha256>.json`. */
  readonly files: SourceConfigFilePort;
  /**
   * Kotlin L37 `MessageDigest.getInstance("SHA-256")`. Defaults to the pure-TS `sha256Hex`
   * above; override when the host already ships a native synchronous SHA-256.
   */
  readonly sha256Hex?: (bytes: Uint8Array) => string;
}

export class SharedPreferencesSourceStorage implements SourceStorage {
  /** Kotlin L9 `private val prefs`. */
  private readonly prefs: SourcePrefsPort;
  /** Kotlin L8 `private val directory` (created eagerly by `.apply { mkdirs() }`). */
  private readonly directory: string;
  private readonly files: SourceConfigFilePort;
  private readonly digest: (bytes: Uint8Array) => string;

  constructor(options: SourceStorageOptions) {
    this.prefs = options.prefs;
    this.files = options.files;
    this.digest = options.sha256Hex ?? sha256Hex;
    // Kotlin L8 — `.apply { mkdirs() }` ran in the property initializer, i.e. in the
    // constructor. The directory path is therefore fixed here too.
    this.directory = `${options.files.filesDir()}/${CONFIG_DIRECTORY}`;
    this.files.mkdirs(this.directory);
  }

  /** Kotlin L9 — exposed so a host can name the `localStorage` / Preferences namespace. */
  static readonly PREFS_NAME = PREFS_NAME;

  /** Kotlin L8. */
  get configDirectory(): string {
    return this.directory;
  }

  // ── L11-L25 ─────────────────────────────────────────────────────────────────

  async saveSourceState(sourceId: string, enabled: boolean): Promise<void> {
    await this.prefs.putBoolean(`${SOURCE_ENABLED_PREFIX}${sourceId}`, enabled);
    await this.prefs.commit();
  }

  async getSourceStates(knownIds?: readonly string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
    const entries = await this.prefs.all();
    for (const [key, value] of Object.entries(entries)) {
      // Kotlin L19 `key.startsWith("source_enabled_") && value is Boolean`
      if (key.startsWith(SOURCE_ENABLED_PREFIX) && typeof value === 'boolean') {
        const sourceId = key.slice(SOURCE_ENABLED_PREFIX.length);
        result[sourceId] = value;
      }
    }
    if (this.prefs.readStoredBoolean) {
      const ids = [...new Set(knownIds ?? [...await this.prefs.getStringSet(CUSTOM_SOURCE_IDS_KEY)])];
      for (let offset = 0; offset < ids.length; offset += 4) await Promise.all(ids.slice(offset, offset + 4).map(async (id) => {
        const stored = await this.prefs.readStoredBoolean!(`${SOURCE_ENABLED_PREFIX}${id}`); if (stored !== null) result[id] = stored;
      }));
    }
    return result;
  }

  // ── L27-L34 ─────────────────────────────────────────────────────────────────

  async saveActiveSourceId(sourceId: string): Promise<void> {
    await this.prefs.putString(ACTIVE_SOURCE_ID_KEY, sourceId);
    await this.prefs.commit();
  }

  async getActiveSourceId(): Promise<string | null> {
    return this.prefs.getString(ACTIVE_SOURCE_ID_KEY, null);
  }

  // ── L36-L39 ─────────────────────────────────────────────────────────────────

  /** Kotlin L36-L39 `private fun configFile(id: String): java.io.File`. */
  configFilePath(id: string): string {
    const digestBytes = utf8Bytes(id);
    const digest = this.digest(digestBytes);
    return `${this.directory}/${digest}${CONFIG_FILE_EXTENSION}`;
  }

  // ── L41-L51 ─────────────────────────────────────────────────────────────────

  async saveCustomSourceJson(sourceId: string, jsonContent: string): Promise<void> {
    await storageLock.withLock(async () => {
      // Kotlin L43 `require(jsonContent.toByteArray().size <= 2 * 1024 * 1024)`
      if (!(utf8ByteLength(jsonContent) <= MAX_CONFIG_BYTES)) {
        throw new Error(CONFIG_TOO_LARGE_MESSAGE);
      }
      const atomic = new AtomicFileView(this.files, this.configFilePath(sourceId));
      atomic.startWrite();
      try {
        atomic.writeAndFinish(jsonContent);
        await this.files.flush?.();
      } catch (error) {
        atomic.failWrite();
        throw error;
      }
      // Kotlin L48 `prefs.getStringSet(…).orEmpty() + sourceId`
      const ids = new Set(await this.prefs.getStringSet(CUSTOM_SOURCE_IDS_KEY));
      ids.add(sourceId);
      await this.prefs.putStringSet(CUSTOM_SOURCE_IDS_KEY, ids);
      // Kotlin L49 `…remove("custom_source_json_$sourceId").commit()`
      this.prefs.remove(`${CUSTOM_SOURCE_JSON_PREFIX}${sourceId}`);
      this.check(await this.prefs.commit());
    });
  }

  // ── L53-L74 ─────────────────────────────────────────────────────────────────

  async getCustomSourceJsons(): Promise<Record<string, string>> {
    return storageLock.withLock(async () => {
      // Kotlin L55 `prefs.getStringSet(…).orEmpty().toMutableSet()`
      const ids = new Set(await this.prefs.getStringSet(CUSTOM_SOURCE_IDS_KEY));
      await this.files.load?.([...ids].map((id) => this.configFilePath(id)));
      for (const id of ids) if (!this.files.exists(this.configFilePath(id))) await this.prefs.getString(`${CUSTOM_SOURCE_JSON_PREFIX}${id}`, null);
      const entries = await this.prefs.all();

      for (const [key, value] of Object.entries(entries)) {
        // Kotlin L58 `key.startsWith("custom_source_json_") && value is String`
        if (!key.startsWith(CUSTOM_SOURCE_JSON_PREFIX) || typeof value !== 'string') continue;
        const id = key.slice(CUSTOM_SOURCE_JSON_PREFIX.length);
        // Kotlin L60 — the same 2 MiB guard on the legacy inline value.
        if (!(utf8ByteLength(value) <= MAX_CONFIG_BYTES)) {
          throw new Error(CONFIG_TOO_LARGE_MESSAGE);
        }
        const atomic = new AtomicFileView(this.files, this.configFilePath(id));
        atomic.startWrite();
        try {
          atomic.writeAndFinish(value);
          await this.files.flush?.();
        } catch (error) {
          atomic.failWrite();
          throw error;
        }
        ids.add(id);
        // Kotlin L65 `ids.add(id); editor.remove(key)` — queued, flushed by the commit below.
        this.prefs.remove(key);
      }

      // Kotlin L68 `check(editor.putStringSet("custom_source_ids", ids).commit())`
      await this.prefs.putStringSet(CUSTOM_SOURCE_IDS_KEY, ids);
      this.check(await this.prefs.commit());

      // Kotlin L69-L72 `ids.mapNotNull { id -> … }.toMap()`
      const result: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const id of ids) {
        const path = this.configFilePath(id);
        if (!this.files.exists(path)) continue;
        if (!(this.files.length(path) <= MAX_CONFIG_BYTES)) continue;
        const content = this.files.readText(path);
        if (content === null) continue;
        result[id] = content;
      }
      return result;
    });
  }

  // ── L76-L82 ─────────────────────────────────────────────────────────────────

  async removeCustomSourceJson(sourceId: string): Promise<void> {
    await storageLock.withLock(async () => {
      // Kotlin L78 `prefs.getStringSet(…).orEmpty() - sourceId`
      const ids = new Set(await this.prefs.getStringSet(CUSTOM_SOURCE_IDS_KEY));
      ids.delete(sourceId);
      await this.prefs.putStringSet(CUSTOM_SOURCE_IDS_KEY, ids);
      // Kotlin L79 — both removals are queued into the same commit.
      this.prefs.remove(`${CUSTOM_SOURCE_JSON_PREFIX}${sourceId}`);
      this.prefs.remove(`${SOURCE_ENABLED_PREFIX}${sourceId}`);
      this.check(await this.prefs.commit());
      // Kotlin L80 `AtomicFile(configFile(sourceId)).delete()`
      this.files.delete(this.configFilePath(sourceId));
      await this.files.flush?.();
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Kotlin L49/L68/L78-79 `check(prefs.edit()…commit())`. */
  private check(committed: boolean): void {
    if (!committed) throw new Error(FAILED_REQUIREMENT);
  }
}

/** Re-exported so the string / boolean / set discrimination rules live in one place. */
export type { SourcePrefsValue };
