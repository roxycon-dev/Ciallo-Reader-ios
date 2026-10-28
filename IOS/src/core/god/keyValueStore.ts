/**
 * E61 —— 键值存储依赖注入（`src/core/**` 去 DOM 全局）。
 *
 * ## 背景
 *
 * `src/core/god/godRankingSettings.ts` 的 `readPrefs()` / `writePrefs()` 此前直接
 * 调 `window.localStorage`。这让 `src/core/**` 依赖 DOM 全局（E61）。
 *
 * Android 对照：`god/GodMomentSettingsStore.kt` 用 Preferences DataStore
 * （文件 `god_moment_prefs`），语义是「一个文件里放若干键值，读写都有 try/catch
 * 兜底，失败返回默认值」—— 与 `SharedPreferences` 同构，所以端口按
 * `KeyValueStore`（同步 API）建模。
 *
 * ## 为什么是同步而不是 async
 *
 * 现有调用方（`getGodRankingStyle()` 等导出函数）是**同步**的，UI 直接在
 * render 里读。改成 async 会牵动整条渲染链。Android 的
 * `SharedPreferences.getString` 本身也是同步的，所以同步端口是**如实建模**，
 * 不是妥协。
 *
 * 兜底：无宿主存储时读写都是 no-op / 返回 `null` → core 侧走默认值，
 * 对应 Kotlin DataStore 读失败返回默认值的分支。
 */

/** 键值存储端口的最小形状（与 `KeyValueStore` 结构兼容）。 */
export interface KeyValueStoreSource {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * 内存兜底实现。
 *
 * 为什么不是「返回 null 的空实现」：DataStore 读失败返回默认值，但**同一会话内
 * 后续写入仍要能被读到**（否则「改了设置立刻读回来是旧值」会成为诡异 bug）。
 * 内存实现让 core 在无宿主存储时仍具备完整可测的读写语义。
 */
const memory = new Map<string, string>();

const MEMORY_STORE: KeyValueStoreSource = {
  get: (key) => memory.get(key) ?? null,
  set: (key, value) => {
    memory.set(key, value);
  },
  remove: (key) => {
    memory.delete(key);
  },
};

let source: KeyValueStoreSource = MEMORY_STORE;

/** 装配处注入真实存储。传 `null` 恢复内存兜底（单测用）。 */
export function setKeyValueStore(next: KeyValueStoreSource | null): void {
  source = next ?? MEMORY_STORE;
}

/** 当前生效的存储。 */
export function getKeyValueStore(): KeyValueStoreSource {
  return source;
}

/** 临时覆盖存储，返回还原函数。供单测隔离用例。 */
export function withKeyValueStore(override: KeyValueStoreSource): () => void {
  const previous = source;
  source = override;
  return () => {
    source = previous;
  };
}

/** 清空内存兜底里的全部键。单测隔离用（否则用例之间会互相污染）。 */
export function clearMemoryKeyValueStore(): void {
  memory.clear();
}
