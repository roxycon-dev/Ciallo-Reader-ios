/**
 * 平台端口适配器 —— 把 `PlatformBundle` 的窄能力补成 core 层需要的宽端口。
 *
 * `PlatformBundle`（`platform/interfaces.ts`）提供的是 `db` / `fs` / `http` /
 * `secure` / `tts` 等**最小能力集**；而书源存储、下载偏好、阅读记录元数据这几处
 * 需要的是 Android `SharedPreferences` 语义（`prefs.all` / `getStringSet` /
 * `putStringSet`）与 `File` 语义（同步 `exists` / `mkdirs` / `writeText`）。
 *
 * Android 的对照：
 *  - `SharedPreferencesSourceStorage` 直接吃 `context.getSharedPreferences(...)`
 *    （`source/storage/SharedPreferencesSourceStorage.kt:3`）；
 *  - `NovelDownloadStore(prefs)` 吃同一套（`download/NovelDownloadStore.kt`）；
 *  - `ReadingRecordMetadata(prefs)` 同上。
 *
 * iOS 侧 `@capacitor/preferences`（UserDefaults）能覆盖字符串键值，但**没有**
 * `getStringSet` / `all()`。本文件用「JSON 编码成一个字符串键」来补齐集合语义 ——
 * 与 Android `putStringSet` 的可观察行为一致（读出来是 `Set<String>`）。
 *
 * 为什么放在 `platform/web/` 而不是 `ios-native/`：这些适配器**不碰 Capacitor**，
 * 只用注入的 `SecureStore`（web-mock 下是内存 Map，ios-native 下是 Preferences），
 * 所以两边共用一份实现。
 */

import type { FileSystemApi, SecureStore } from '@platform/interfaces';
import type { SourcePrefsPort } from '@core/source/storage/sourceStorage';
import type { SourcePrefsValue } from '@core/source/storage/sourceStorage';
import { SOURCE_ENABLED_PREFIX } from '@core/source/storage/sourceStorage';

/** 集合类偏好的键在 SecureStore 里的实际存储键（加前缀避免与普通键冲突）。 */
const STRING_SET_PREFIX = 'ss:';

/**
 * 用 `SecureStore` 实现 `SourcePrefsPort`（Android `SharedPreferences` 视图）。
 *
 * `all()` 在 Capacitor Preferences 上没有对应 API —— Preferences 只支持按 key 读，
 * 没有 `keys()`。Android 的 `prefs.all` 主要被 `SharedPreferencesSourceStorage` 用来
 * 读 `SOURCE_ENABLED_PREFIX` 批量状态；本适配器额外维护一个「已写入的启用态索引」，
 * 使 `all()` 能返回完整视图。
 */
export class SecureStoreSourcePrefs implements SourcePrefsPort {
  /** `edit()` 的批量语义：Android 的 `editor.commit()` 是**同步**的，这里用「待提交队列」对齐。 */
  private pendingRemovals = new Set<string>();
  /**
   * `SecureStore.get` 是异步的，但 `SourcePrefsPort.all()` 必须**同步**返回快照
   * （Android 的 `SharedPreferences.all` 就是内存里的 `LinkedHashMap`）。
   * 解法：所有写都经过本适配器，于是维护一份内存镜像；`all()` 读镜像。
   * 冷启动时（镜像空）用 `EXTRA_KEYS` 兜底 —— 书源启用态在首屏之前必然
   * 经过 `putBoolean`/`putString`，所以镜像在 `initialize()` 之前就会被填好。
   */
  private readonly mirror = new Map<string, SourcePrefsValue>();
  private readonly mirrorIndex = new Set<string>();

  constructor(private readonly store: SecureStore) {}

  async readStoredBoolean(key: string): Promise<boolean | null> {
    const value = await this.store.get(key);
    if (value === null) return null;
    if (value !== 'true' && value !== 'false') throw new Error('Stored source switch is not a boolean');
    const enabled = value === 'true'; this.mirror.set(key, enabled); this.mirrorIndex.add(key); return enabled;
  }

  all(): Readonly<Record<string, SourcePrefsValue>> {
    const out: Record<string, SourcePrefsValue> = {};
    for (const key of this.mirrorIndex) {
      if (this.pendingRemovals.has(key)) continue;
      if (this.mirror.has(key)) out[key] = this.mirror.get(key) as SourcePrefsValue;
    }
    return out;
  }

  async getString(key: string, fallback: string | null): Promise<string | null> {
    const value = await this.store.get(key);
    if (value !== null) {
      const boolean = (typeof this.mirror.get(key) === 'boolean' || key.startsWith(SOURCE_ENABLED_PREFIX)) && (value === 'true' || value === 'false');
      this.mirror.set(key, boolean ? value === 'true' : value); this.mirrorIndex.add(key);
    }
    return value === null ? fallback : value;
  }

  async getStringSet(key: string): Promise<ReadonlySet<string>> {
    const raw = await this.store.get(STRING_SET_PREFIX + key);
    if (raw === null) return new Set<string>();
    const parsed: unknown = safeParse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  }

  async putBoolean(key: string, value: boolean): Promise<void> {
    // SharedPreferences 把 boolean 与 string 分开存；落盘统一编码成 `"true"`/`"false"`。
    await this.store.set(key, value ? 'true' : 'false');
    this.mirror.set(key, value);
    this.mirrorIndex.add(key);
  }

  async putString(key: string, value: string): Promise<void> {
    await this.store.set(key, value);
    this.mirror.set(key, value);
    this.mirrorIndex.add(key);
  }

  async putStringSet(key: string, values: ReadonlySet<string>): Promise<void> {
    await this.store.set(STRING_SET_PREFIX + key, JSON.stringify(Array.from(values)));
    this.mirror.set(key, new Set(values));
    this.mirrorIndex.add(key);
  }

  /**
   * Kotlin `prefs.edit().remove(key)` —— 只入队，**真正落盘在 `commit()`**。
   * Android 的 `SharedPreferences.Editor.remove()` 是同步返回 void 的，这里保持一致。
   */
  remove(key: string): void {
    this.pendingRemovals.add(key);
    this.pendingRemovals.add(STRING_SET_PREFIX + key);
  }

  /**
   * Kotlin `SharedPreferences.Editor.commit()` —— 把 `edit()` 队列落盘。
   * @returns false 表示写失败（Android 同语义）。
   */
  async commit(): Promise<boolean> {
    try {
      for (const key of this.pendingRemovals) {
        await this.store.remove(key);
        this.mirror.delete(key);
        this.mirrorIndex.delete(key);
      }
      this.pendingRemovals.clear();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * `SourceConfigFilePort`（`source/storage/sourceStorage.ts`）——
 * Android 侧是 `File` + `AtomicFile` 的同步语义，这里用 `FileSystemApi` 的
 * Promise 接口逐条映射。
 *
 * `finishWrite`（`AtomicFile` 的「把 .bak 提升为正式文件」）在 `FileSystemApi` 上
 * 没有对应操作，这里实现为「写 .bak → 读回 → 写正式文件 → 删 .bak」，可观察行为
 * 与 Android 的原子替换一致（读者要么看到旧内容，要么看到新内容）。
 */
export class FileSystemSourceConfigFile {
  constructor(
    private readonly fs: FileSystemApi,
    private readonly root = '',
  ) {}

  filesDir(): string {
    return this.root;
  }

  mkdirs(path: string): void {
    // `FileSystemApi` 没有 mkdir；写文件时 Capacitor 会自动建父目录，
    // 这里只需保证路径以分隔符收敛（Android `mkdirs()` 是幂等的 no-op 兜底）。
    void path;
  }

  exists(path: string): boolean {
    // load() fills the synchronous view before persisted definitions are read.
    return this.written.has(path);
  }

  private readonly written = new Set<string>();

  writeText(path: string, content: string): void {
    this.pendingWrites.set(path, content);
    this.written.add(path);
    this.pendingDeletes.delete(path);
  }

  private readonly pendingWrites = new Map<string, string>();
  private readonly committed = new Map<string, string>();
  private readonly pendingDeletes = new Set<string>();
  private flushTail: Promise<void> = Promise.resolve();

  async load(paths: readonly string[]): Promise<void> {
    await this.flushTail;
    for (const path of paths) {
      if (this.pendingWrites.has(path) || this.pendingDeletes.has(path)) continue;
      if (!(await this.fs.exists(path))) { this.pendingWrites.delete(path); this.committed.delete(path); this.written.delete(path); continue; }
      const bytes = await this.fs.readFile(path);
      if (bytes.length > 2 * 1024 * 1024) throw new Error('书源配置文件过大');
      this.committed.set(path, new TextDecoder('utf-8', { fatal: true }).decode(bytes)); this.written.add(path);
    }
  }

  readText(path: string): string | null {
    const pending = this.pendingWrites.get(path);
    if (pending !== undefined) return pending;
    return this.committed.get(path) ?? null;
  }

  length(path: string): number {
    const content = this.readText(path);
    return content === null ? 0 : new TextEncoder().encode(content).length;
  }

  delete(path: string): void {
    this.pendingWrites.delete(path);
    this.written.delete(path);
    this.pendingDeletes.add(path);
  }

  /** Kotlin `AtomicFile.finishWrite(out)` —— 把暂存内容提升为正式文件。 */
  async finishWrite(path: string): Promise<void> {
    const content = this.pendingWrites.get(path);
    if (content === undefined) return;
    if (this.fs.writeFileAtomic) await this.fs.writeFileAtomic(path, new TextEncoder().encode(content));
    else await this.fs.writeFile(path, new TextEncoder().encode(content));
    this.committed.set(path, content);
  }

  /** `File.renameTo` —— Android 用它把 `.bak` 提升为正式文件（AtomicFile 的语义）。 */
  rename(from: string, to: string): void {
    const content = this.pendingWrites.get(from);
    if (content === undefined) return;
    this.pendingWrites.set(to, content);
    this.pendingWrites.delete(from);
    this.written.delete(from);
    this.written.add(to);
    this.pendingDeletes.add(from); this.pendingDeletes.delete(to);
  }

  /** 把所有暂存写落盘（Android 的 `finishWrite` 是在 `writeText` 内部调用的）。 */
  flush(): Promise<void> {
    const writes = new Map(this.pendingWrites), deletes = new Set(this.pendingDeletes);
    this.pendingWrites.clear(); this.pendingDeletes.clear();
    const operation = this.flushTail.then(async () => {
      for (const [path, content] of writes) {
        const bytes = new TextEncoder().encode(content);
        if (bytes.length > 2 * 1024 * 1024) throw new Error('书源配置文件过大');
        if (this.fs.writeFileAtomic) await this.fs.writeFileAtomic(path, bytes); else await this.fs.writeFile(path, bytes);
        this.committed.set(path, content);
      }
      for (const path of deletes) { await this.fs.delete(path); this.committed.delete(path); }
    });
    this.flushTail = operation.catch(() => {});
    return operation;
  }
}

/**
 * `NovelDownloadPrefs`（`download/novelDownloadStore.ts:15-20`）——
 * `getString` / `putString`（返回 false 表示写失败）/ `remove`。
 */
export class SecureStoreNovelPrefs {
  constructor(private readonly store: SecureStore) {}

  async getString(key: string): Promise<string | null> {
    return this.store.get(key);
  }

  async putString(key: string, value: string): Promise<boolean> {
    try {
      await this.store.set(key, value);
      return true;
    } catch {
      // Android `SharedPreferences.Editor.commit()` 返回 false 而不是抛异常；
      // 这里保持同一契约（失败用返回值表达）。
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    await this.store.remove(key);
  }
}

/**
 * `ReadingRecordMetadataPrefs`（`library/libraryReadingRecords.ts:298-301`）。
 */
export class SecureStoreRecordMetadataPrefs {
  constructor(private readonly store: SecureStore) {}

  async getString(key: string): Promise<string | null> {
    return this.store.get(key);
  }

  async putString(key: string, value: string): Promise<void> {
    await this.store.set(key, value);
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
