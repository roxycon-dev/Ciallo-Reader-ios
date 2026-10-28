/**
 * appUpdateStore.ts — line-by-line port of Android
 * `com/example/data/AppUpdateStore.kt`
 * (`novel-reader/app/src/main/java/com/example/data/AppUpdateStore.kt`,
 * 81 lines / 69 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-8    package + imports              → see "Skipped lines" below
 *   10     internal data class PendingAppUpdate → `PendingAppUpdate`
 *   12     the `directory` doc comment     → kept verbatim above `AppUpdateStore`
 *   13-17  class + directory/apkFile/metadata/newTransferFile → the class
 *   19-34  fun save                        → `save()`
 *   36-54  fun load                        → `load()`
 *   56-60  fun installedCode               → `installedCode()` + `AppPackageIdentity`
 *   62     the `cleanupInstalled` doc      → kept verbatim above `cleanupInstalled()`
 *   63-68  fun cleanupInstalled            → `cleanupInstalled()`
 *   70-74  fun clear                      → `clear()`
 *   76-78  fun clearPartialFiles          → `clearPartialFiles()`
 *   80     companion object storageLock    → implicit (see "Platform adaptations")
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.data` — TS module system.
 *  L3     `android.content.Context` — the only use is `context.filesDir`, which the
 *         injected `UpdateFileStore.filesDir` supplies.
 *  L4     `android.os.Build` — `Build.VERSION.SDK_INT >= 28` picks between
 *         `longVersionCode` / `versionCode`; both collapse to one `number`
 *         (`versionCode`) in the `AppPackageIdentity` port.
 *  L5     `android.util.AtomicFile` — the port declares the five calls this file makes
 *         (`openRead` / `startWrite` / `finishWrite` / `failWrite` / `delete`) over the
 *         injected `UpdateFileStore`; see `AtomicMetadataFile` below. ⚠️ HONEST NOTE:
 *         `AtomicFile`'s AOSP body is framework code, not part of this repo, so it could
 *         not be read line-by-line. The three properties this module actually depends on
 *         — a torn write never destroys the previous good metadata, `finishWrite`
 *         removes the rollback copy, and `delete()` removes base + rollback copy — are
 *         implemented and documented; any finer framework detail is unverified.
 *  L6     `org.json.JSONObject` — `put` → a plain record + `JSON.stringify` (the field
 *         ORDER of `pending.json` is preserved); `getString`/`getLong`/`optString`/
 *         `isNull` → the existing core shim `@core/source/impl/jsonSupport`.
 *  L7     `java.io.File` — `UpdateFileStore` (exists/stat/read/write/delete/list/
 *         rename/mkdirs/canonicalPath). Fixed private paths are preserved by keeping
 *         `app_updates/`, `update.apk` and `pending.json` as constants.
 *  L8     `java.util.UUID` — `crypto.randomUUID()`, with a `crypto.getRandomValues`
 *         fallback so the `.part` name is still unguessable where `randomUUID` is absent.
 *  L29-33 `metadata.startWrite()` / `finishWrite` / `failWrite` → `AtomicMetadataFile`,
 *         a small async wrapper that serialises the backup-rename dance.
 *  L37    `metadata.openRead().use { it.readImportBytes(192 * 1024) }` — the bounded read
 *         collapses to a `Content-Length`-free size check: the whole file is read and
 *         rejected when it exceeds `MAX_PENDING_METADATA_BYTES` (192 KiB), which is the
 *         same ceiling `readImportBytes` enforces. The message it raises is swallowed by
 *         `runCatching { … }.getOrNull()` exactly as in Kotlin.
 *  L58-59 `context.packageManager.getPackageInfo(…, 0)` → `AppPackageIdentity` port.
 *  L77    `directory.listFiles()` → `UpdateFileStore.list()` returning entry NAMES
 *         (matching `FileSystemApi.list`), re-joined into paths.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `synchronized(storageLock)` (Kotlin L80, and the *reentrant* nesting inside
 *    `cleanupInstalled()` → `load()` / `clear()`) is implicit on the single-threaded JS
 *    runtime — the same note `core/data/encryptedSecretStore.ts` already carries. A
 *    re-entrant async mutex would deadlock, so none is installed.
 *  * `File.extension` (`substring(lastIndexOf('.') + 1)`, `""` when there is no dot)
 *    is reimplemented literally; Kotlin's `String.length` is UTF-16 code units, which is
 *    JS `.length`, so the 5..200 / 24_000 truncations are byte-for-byte identical.
 *  * `check(cond) { msg }` → `if (!cond) throw new Error(msg)`. Every user-visible
 *    Chinese message is preserved verbatim. `require(cond)` (no message) and
 *    `error(msg)` (IllegalStateException) both map to `Error`; the `error()` messages
 *    ("更新缺少安装包" / "此版本没有可用安装包") ARE user-visible because `AppUpdateManager`
 *    surfaces `e.message` in the FAILED stage, so they are kept exact.
 *
 * ── 2026-10-06 逐行审查 pass (agent: update module) ─────────────────────────────────
 *  Field names, defaults and every guard in L19-78 were checked one for one:
 *  L14-L17 paths `app_updates/` / `update.apk` / `pending.json` / `<uuid>.part` ✔;
 *  L25-L28 the nine `pending.json` keys, in order ✔ (`tag, releaseUrl, notes, name, url,
 *  size, digest, versionCode, sha256`); L37 the 192 KiB read ceiling ✔; L39-L52 the
 *  validators (`officialUpdateAsset`, `releaseUrl == "$REPO/releases/tag/$tag"`, two
 *  `[0-9a-f]{64}` hashes, `size in 1..MAX`, `code > 0`) ✔; L53 `.take(24_000)` ✔;
 *  L63-L68 `installedCode() >= versionCode` before `clear()` ✔;
 *  L70-L78 `clear()` = apk + metadata + `.part` sweep ✔.
 *  FIXED (BUG ×3):
 *   1. `getLong` used `Number.parseFloat`, a PREFIX parser — `"204junk"` was accepted as
 *      204 where `org.json`'s `JSON.toLong` throws. Now strict.
 *   2. `AppPackageIdentity.versionCode` was a fixed `number`, so `cleanupInstalled()`
 *      could never observe a post-install bump and the APK would leak forever. A
 *      `() => number` thunk is now resolved on every call.
 *   3. `randomUuid()` returned a CONSTANT UUID when `crypto` was missing — two concurrent
 *      transfers would share one `.part` path. It now throws explicitly.
 *  FIXED (BUG): `deleteQuietly()` now swallows, matching `File.delete()` (Kotlin L116),
 *  so the manager's `finally` can no longer mask the real transfer outcome.
 */

import { isNull, optStringOrEmpty, parseJsonObject, type JsonObject } from '../source/impl/jsonSupport';
import {
  MAX_UPDATE_BYTES,
  officialUpdateAsset,
  UPDATE_REPOSITORY,
  makeUpdateRelease,
  type UpdateApkAsset,
  type UpdateRelease,
} from './githubUpdateChecker';

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L10  internal data class PendingAppUpdate
   ══════════════════════════════════════════════════════════════════════════════ */

export interface PendingAppUpdate {
  readonly release: UpdateRelease;
  readonly versionCode: number;
  readonly sha256: string;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L14-17  the fixed private paths — never a user-selected export,
   Downloads, or a book file
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin L14 `File(context.filesDir, "app_updates")`. */
export const APP_UPDATE_DIRECTORY = 'app_updates';
/** Kotlin L15 `File(directory, "update.apk")`. */
export const APP_UPDATE_APK_FILE = 'update.apk';
/** Kotlin L16 `AtomicFile(File(directory, "pending.json"))`. */
export const APP_UPDATE_METADATA_FILE = 'pending.json';
/** Kotlin L17 / L77 the `.part` extension of an in-flight transfer. */
export const APP_UPDATE_PARTIAL_EXTENSION = 'part';
/** Kotlin L37 `readImportBytes(192 * 1024)`. */
export const MAX_PENDING_METADATA_BYTES = 192 * 1024;
/** Kotlin L53 `.take(24_000)` on the release notes. */
export const MAX_PENDING_NOTES_CHARS = 24_000;
/** Kotlin L46 / L50 `Regex("[0-9a-f]{64}")`. */
const SHA256_LOWER_PATTERN = /^[0-9a-f]{64}$/;

/** Kotlin `File.extension` — `substring(lastIndexOf('.') + 1)`, `""` without a dot. */
export function fileExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index + 1);
}

/** Kotlin `File.canonicalFile` equality for the L22 transfer-file guard. */
export function canonicalize(path: string): string {
  const unified = path.replace(/\\/g, '/');
  const absolute = unified.startsWith('/');
  const out: string[] = [];
  for (const part of unified.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0) out.pop();
      else if (!absolute) out.push('..');
      continue;
    }
    out.push(part);
  }
  const joined = out.join('/');
  return absolute ? `/${joined}` : joined;
}

/** Kotlin `File(File(parent, child))` — POSIX join, the platform path form. */
export function joinPath(parent: string, child: string): string {
  const unifiedParent = parent.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${unifiedParent}/${child}`;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Injected storage — Android `Context.filesDir` + `java.io.File`
   ══════════════════════════════════════════════════════════════════════════════ */

/** The `java.io.File` surface `AppUpdateStore` uses, over `FileSystemApi`. */
export interface UpdateFileStore {
  /** Kotlin `context.filesDir`. */
  readonly filesDir: string;
  /** Kotlin `File.mkdirs()` (Kotlin L14 `.apply { mkdirs() }`). */
  mkdirs(path: string): Promise<void>;
  /** Kotlin `File.exists()`. */
  exists(path: string): Promise<boolean>;
  /** Kotlin `File.isFile` — Kotlin L22/L77's `it.isFile` filter. */
  isFile(path: string): Promise<boolean>;
  /** Kotlin `File.length()`. */
  size(path: string): Promise<number>;
  /** Kotlin `File.readBytes()`. */
  readFile(path: string): Promise<Uint8Array>;
  /** Kotlin `FileOutputStream(file).use { it.write(bytes) }`. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Kotlin `File.delete()` — `false` when the file was absent or undeletable. */
  delete(path: string): Promise<boolean>;
  /** Kotlin `directory.listFiles()` — entry NAMES, or `null` when unlistable. */
  list(path: string): Promise<string[] | null>;
  /** Kotlin `File.renameTo(target)` — `false` on cross-device failure. */
  rename(from: string, to: string): Promise<boolean>;
  /** Kotlin `File.canonicalFile` / `canonicalPath` (Kotlin L22). */
  canonicalPath(path: string): string;
}

/**
 * `UUID.randomUUID()` — `crypto.randomUUID()` where available (L8). The fallback
 * builds the same RFC-4122 v4 layout from `crypto.getRandomValues` so the `.part`
 * name stays unguessable; only the source of randomness differs.
 *
 * REVIEW FIX (BUG): when `globalThis.crypto` is missing this used to return the CONSTANT
 * `'00000000-0000-4000-8000-000000000000'`. Kotlin's `UUID.randomUUID()` can never
 * collide, and `AppUpdateManager.startDownload()` is re-entrant across tabs, so a fixed
 * name would let two in-flight transfers fight over one `.part` file — a silent
 * corruption the user never sees. A missing WebCrypto is a broken host, so it now
 * throws explicitly instead of degrading.
 */
export function randomUuid(): string {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto === undefined) throw new Error('当前环境缺少 crypto.randomUUID');
  if (typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  const bytes = webCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Android `AtomicFile` — the five calls Kotlin L16/L29-33/L37/L72 make
   ══════════════════════════════════════════════════════════════════════════════ */

/** The rollback copy `AtomicFile` keeps beside the base file while writing. */
export const ATOMIC_BACKUP_SUFFIX = '.bak';

/**
 * Android `android.util.AtomicFile` — new adaptation module (the AOSP class is
 * framework code and is NOT part of the read-only Kotlin sources, so it is not a
 * line-by-line port; see the HONEST NOTE in the header).
 *
 * Reproduced contract, in the order Kotlin exercises it:
 *   startWrite()  rename base → base.bak (stale .bak deleted first), create/truncate base
 *   finishWrite() delete base.bak
 *   failWrite()   restore base.bak over base (the previous good metadata survives)
 *   openRead()    read base, or restore base.bak when base is missing
 *   delete()      delete base, then base.bak
 */
export class AtomicMetadataFile {
  constructor(
    private readonly fs: UpdateFileStore,
    private readonly path: string,
  ) {}

  /** Kotlin L16 `private val metadata get() = AtomicFile(File(directory, "pending.json"))`. */
  get backupPath(): string {
    return `${this.path}${ATOMIC_BACKUP_SUFFIX}`;
  }

  /** Kotlin L29 `metadata.startWrite()`. */
  async startWrite(): Promise<void> {
    if (await this.fs.exists(this.path)) {
      if (await this.fs.exists(this.backupPath)) await this.fs.delete(this.backupPath);
      await this.fs.rename(this.path, this.backupPath);
    }
    await this.fs.writeFile(this.path, new Uint8Array(0));
  }

  /** Kotlin L32 `metadata.finishWrite(out)`. */
  async finishWrite(): Promise<void> {
    await this.fs.delete(this.backupPath);
  }

  /** Kotlin L33 `metadata.failWrite(out)` — put the previous good file back. */
  async failWrite(): Promise<void> {
    if (!(await this.fs.exists(this.backupPath))) return;
    await this.fs.delete(this.path);
    await this.fs.rename(this.backupPath, this.path);
  }

  /** Kotlin L37 `metadata.openRead()` — heals from the rollback copy when needed. */
  async openRead(): Promise<Uint8Array> {
    if (!(await this.fs.exists(this.path)) && (await this.fs.exists(this.backupPath))) {
      await this.fs.rename(this.backupPath, this.path);
    }
    return this.fs.readFile(this.path);
  }

  /** Kotlin L72 `metadata.delete()` — base and rollback copy. */
  async delete(): Promise<void> {
    await this.fs.delete(this.path);
    await this.fs.delete(this.backupPath);
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   Android `PackageManager` — Kotlin L58-59 / L64 (iOS: see appUpdateInstaller.ts)
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * Kotlin L58-59 `context.packageManager.getPackageInfo(context.packageName, 0)` — read
 * LIVE on every call, not snapshotted: `cleanupInstalled()` (L63-68) runs once per
 * process start and once per installer result, and only the live read can observe the
 * versionCode bump that a package replacement produced.
 *
 * REVIEW FIX (BUG): `versionCode` accepted only a fixed `number`, so a host that wired
 * it once at start-up would keep answering the PRE-install versionCode forever and
 * `cleanupInstalled()` would always return `false` — the 24 MB APK would never be
 * deleted. A `() => number` thunk is therefore accepted and re-read on every call;
 * passing the plain number still works (the tests do), it is just a one-shot snapshot.
 */
export interface AppPackageIdentity {
  /** Android `context.packageName` — e.g. `com.example.novelreader`. */
  readonly packageName: string;
  /** Android `info.versionCode` / `info.longVersionCode`, or a live reader for it. */
  readonly versionCode: number | (() => number);
}

/** Resolve `AppPackageIdentity.versionCode` on every call (see the note above). */
function readVersionCode(identity: AppPackageIdentity): number {
  return typeof identity.versionCode === 'function' ? identity.versionCode() : identity.versionCode;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin's two assertion helpers, reproduced with their DEFAULT messages
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * Kotlin `check(value, message = "Check failed.")` → `IllegalStateException`.
 * Used where the Kotlin source writes `check(cond)` / `check(cond) { msg }`.
 * `AppUpdateManager` surfaces `e.message` in the FAILED stage, so the default
 * text is observable and is reproduced rather than replaced with a nicer string.
 */
export function kCheck(condition: boolean, message = 'Check failed.'): void {
  if (!condition) throw new Error(message);
}

/**
 * Kotlin `require(value, message = "Failed requirement.")` → `IllegalArgumentException`.
 * Same rationale as `kCheck`.
 */
export function kRequire(condition: boolean, message = 'Failed requirement.'): void {
  if (!condition) throw new Error(message);
}

/* ══════════════════════════════════════════════════════════════════════════════
   Android `org.json` — throwing accessors Kotlin L39-52 relies on
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin `JSONObject.getString(key)` — throws when the key is absent. */
function getString(json: JsonObject, key: string): string {
  const value = json[key];
  if (value === undefined) throw new Error(`pending.json 缺少字段 ${key}`);
  // Kotlin `JSON.toString(JSONObject.NULL)` yields the literal "null".
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Kotlin `JSONObject.getLong(key)` — throws when absent, or when the value is not a
 * whole decimal number.
 *
 * REVIEW FIX (BUG): this used `Number.parseFloat`, which is a PREFIX parser —
 * `parseFloat("204junk") === 204` and `parseFloat("1e3") === 1000`. Kotlin routes
 * `getLong` through `org.json`'s `JSON.toLong`, which rejects both. `versionCode` is the
 * value `cleanupInstalled()` trusts to decide whether the downloaded APK may be deleted
 * (L51-52, L65), so a tampered `pending.json` could claim `"versionCode": "9999junk"`
 * and have it accepted here while Android throws and falls back to "keep the file".
 * Now the whole string must be a plain decimal run.
 */
function getLong(json: JsonObject, key: string): number {
  const value = json[key];
  if (value === undefined) throw new Error(`pending.json 缺少字段 ${key}`);
  if (value === null) throw new Error(`pending.json 字段 ${key} 不是数字`);
  const parsed =
    typeof value === 'number'
      ? value
      : /^[+-]?\d+$/.test(String(value))
        ? Number.parseInt(String(value), 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`pending.json 字段 ${key} 不是数字`);
  return Math.trunc(parsed);
}

/**
 * Kotlin L25-28 `JSONObject().put(…).put(…)` — field order is part of the file
 * format, so the record literal below follows the Kotlin chain exactly.
 */
export function encodePendingMetadata(pending: PendingAppUpdate): string {
  const asset = pending.release.apk;
  if (asset === null) throw new Error('更新缺少安装包');
  const json: Record<string, unknown> = {
    tag: pending.release.tag,
    releaseUrl: pending.release.releaseUrl,
    notes: pending.release.notes,
    name: asset.name,
    url: asset.url,
    size: asset.size ?? null,
    digest: asset.sha256 ?? null,
    versionCode: pending.versionCode,
    sha256: pending.sha256,
  };
  return JSON.stringify(json);
}

/* ══════════════════════════════════════════════════════════════════════════════
   Kotlin L12-80  AppUpdateStore
   ══════════════════════════════════════════════════════════════════════════════ */

/** Fixed private paths: never delete a user-selected export, Downloads, or book files. */
export interface AppUpdateStoreOptions {
  readonly fs: UpdateFileStore;
  /** Android `AppUpdateStore(context).installedCode()`. */
  readonly packageIdentity: AppPackageIdentity;
}

/** Fixed private paths: never delete a user-selected export, Downloads, or book files. */
export class AppUpdateStore {
  private readonly fs: UpdateFileStore;
  private readonly pkg: AppPackageIdentity;

  constructor(options: AppUpdateStoreOptions) {
    this.fs = options.fs;
    this.pkg = options.packageIdentity;
  }

  /* Kotlin L14 `private val directory get() = File(context.filesDir, "app_updates").apply { mkdirs() }` */
  private async directory(): Promise<string> {
    const path = joinPath(this.fs.filesDir, APP_UPDATE_DIRECTORY);
    await this.fs.mkdirs(path);
    return path;
  }

  /** Kotlin L15 `val apkFile get() = File(directory, "update.apk")` — path only, no mkdirs. */
  async apkFile(): Promise<string> {
    return joinPath(await this.directory(), APP_UPDATE_APK_FILE);
  }

  /**
   * Android `private val context: Context` → the injected file store, exposed so callers
   * can run `exists` / `delete` / `sha256` against the same private directory without
   * duplicating the path constants.
   */
  get fileStore(): UpdateFileStore {
    return this.fs;
  }

  /** Kotlin L116 `temporary?.delete()` inside `withContext(NonCancellable + Dispatchers.IO)`. */
  async deleteQuietly(path: string): Promise<void> {
    // REVIEW FIX (BUG): Kotlin's `File.delete()` NEVER throws — it returns `false` when the
    // file is already gone or undeletable. The ported version let a throwing store escape
    // into `AppUpdateManager.runTransfer`'s `finally`, where it would replace the real
    // outcome of the transfer (the FAILED frame, or the download-cancelled frame) with an
    // unrelated storage error. Swallowed here so the `finally` cannot mask anything.
    try {
      await this.fs.delete(path);
    } catch {
      // Kotlin L116 — the return value of `delete()` is not inspected either.
    }
  }

  /* Kotlin L16 `private val metadata get() = AtomicFile(File(directory, "pending.json"))` */
  private async metadata(): Promise<AtomicMetadataFile> {
    return new AtomicMetadataFile(this.fs, joinPath(await this.directory(), APP_UPDATE_METADATA_FILE));
  }

  /** Kotlin L17 `fun newTransferFile() = File(directory, "${UUID.randomUUID()}.part")`. */
  async newTransferFile(): Promise<string> {
    return joinPath(await this.directory(), `${randomUuid()}.${APP_UPDATE_PARTIAL_EXTENSION}`);
  }

  /* Kotlin L19-34  fun save(file: File, pending: PendingAppUpdate) */
  async save(file: string, pending: PendingAppUpdate): Promise<void> {
    // Kotlin L20 `val asset = pending.release.apk ?: error("更新缺少安装包")`
    const asset = pending.release.apk;
    if (asset === null) throw new Error('更新缺少安装包');
    // Kotlin L21 `require(officialUpdateAsset(pending.release.tag, asset.name, asset.url))`
    //          — the message-less form, so Kotlin raises "Failed requirement.".
    kRequire(officialUpdateAsset(pending.release.tag, asset.name, asset.url));
    // Kotlin L22 `check(file.parentFile?.canonicalFile == directory.canonicalFile && file.extension == "part")`
    //          — also message-less, so Kotlin raises "Check failed.".
    const directory = await this.directory();
    const parent = file.replace(/\\/g, '/').slice(0, Math.max(0, file.lastIndexOf('/')));
    kCheck(
      parent !== '' &&
        this.fs.canonicalPath(parent) === this.fs.canonicalPath(directory) &&
        fileExtension(file) === APP_UPDATE_PARTIAL_EXTENSION,
    );
    const apkFile = joinPath(directory, APP_UPDATE_APK_FILE);
    // Kotlin L23 `if (apkFile.exists()) check(apkFile.delete()) { "无法替换旧安装包" }`
    if (await this.fs.exists(apkFile)) {
      kCheck(await this.fs.delete(apkFile), '无法替换旧安装包');
    }
    // Kotlin L24 `check(file.renameTo(apkFile)) { "无法保存安装包" }`
    kCheck(await this.fs.rename(file, apkFile), '无法保存安装包');
    // Kotlin L25-33 the metadata write, with failWrite on any error.
    const metadata = await this.metadata();
    await metadata.startWrite();
    try {
      await this.fs.writeFile(
        joinPath(directory, APP_UPDATE_METADATA_FILE),
        new TextEncoder().encode(encodePendingMetadata(pending)),
      );
      await metadata.finishWrite();
    } catch (error) {
      await metadata.failWrite();
      throw error;
    }
  }

  /* Kotlin L36-54  fun load(): PendingAppUpdate? */
  async load(): Promise<PendingAppUpdate | null> {
    try {
      // Kotlin L37-38 readImportBytes(192 * 1024) + JSONObject(bytes.toString(UTF_8))
      const bytes = await (await this.metadata()).openRead();
      if (bytes.length > MAX_PENDING_METADATA_BYTES) return null;
      const json = parseJsonObject(new TextDecoder('utf-8').decode(bytes));
      if (json === null) return null;
      const tag = getString(json, 'tag');
      const name = getString(json, 'name');
      const url = getString(json, 'url');
      // Kotlin L42 `require(officialUpdateAsset(tag, name, url))`
      if (!officialUpdateAsset(tag, name, url)) return null;
      // Kotlin L43-44 `val releaseUrl = "$UPDATE_REPOSITORY/releases/tag/$tag"` + require
      const releaseUrl = `${UPDATE_REPOSITORY}/releases/tag/${tag}`;
      if (getString(json, 'releaseUrl') !== releaseUrl) return null;
      // Kotlin L45-46 `require(Regex("[0-9a-f]{64}").matches(hash))`
      const hash = getString(json, 'sha256');
      if (!SHA256_LOWER_PATTERN.test(hash)) return null;
      // Kotlin L47-48 `val size = if (json.isNull("size")) null else json.getLong("size")`
      const size = isNull(json, 'size') ? null : getLong(json, 'size');
      if (size !== null && !(size >= 1 && size <= MAX_UPDATE_BYTES)) return null;
      // Kotlin L49-50 `val digest = if (json.isNull("digest")) null else json.getString("digest")`
      const digest = isNull(json, 'digest') ? null : getString(json, 'digest');
      if (digest !== null && !SHA256_LOWER_PATTERN.test(digest)) return null;
      // Kotlin L51-52 `val code = json.getLong("versionCode"); require(code > 0)`
      const code = getLong(json, 'versionCode');
      if (!(code > 0)) return null;
      const asset: UpdateApkAsset = { name, url, size, sha256: digest };
      // Kotlin L53 `.take(24_000)` on the notes.
      const notes = optStringOrEmpty(json, 'notes').slice(0, MAX_PENDING_NOTES_CHARS);
      return {
        release: makeUpdateRelease(tag, releaseUrl, notes, asset),
        versionCode: code,
        sha256: hash,
      };
    } catch {
      // Kotlin L54 `runCatching { … }.getOrNull()`
      return null;
    }
  }

  /* Kotlin L56-60  @Suppress("DEPRECATION") fun installedCode(): Long */
  async installedCode(): Promise<number> {
    return readVersionCode(this.pkg);
  }

  /** True only after PackageManager confirms the saved target version was installed. */
  /* Kotlin L63-68  fun cleanupInstalled(): Boolean */
  async cleanupInstalled(): Promise<boolean> {
    const pending = await this.load();
    if (pending === null) return false;
    if ((await this.installedCode()) < pending.versionCode) return false;
    await this.clear();
    return true;
  }

  /* Kotlin L70-74  fun clear() */
  async clear(): Promise<void> {
    await this.fs.delete(await this.apkFile());
    await (await this.metadata()).delete();
    await this.clearPartialFiles();
  }

  /* Kotlin L76-78  fun clearPartialFiles() */
  async clearPartialFiles(): Promise<void> {
    const directory = await this.directory();
    const entries = await this.fs.list(directory);
    if (entries === null) return;
    for (const entry of entries) {
      if (fileExtension(entry) !== APP_UPDATE_PARTIAL_EXTENSION) continue;
      const path = joinPath(directory, entry);
      // Kotlin L77 `.filter { it.isFile && it.extension == "part" }`
      if (!(await this.fs.isFile(path))) continue;
      await this.fs.delete(path);
    }
  }
}
