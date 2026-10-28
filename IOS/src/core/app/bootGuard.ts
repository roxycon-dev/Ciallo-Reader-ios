/**
 * 启动看门狗运行时 — 把 `src/core/app/navigation.ts` 的纯函数接到真实存储与计时器。
 *
 * Android（MainActivity.kt L119-140）在 `onCreate` 里同步跑：
 *  「极致」画质 20 秒内连续两次崩溃 → 自动降回「高」，
 *  存活满 20 秒则解除武装。防止实验性着色器造成「一崩就再也打不开」的死循环变砖。
 *
 * Web 侧存储是异步的（Capacitor Preferences / SQLite），所以这里：
 *  1. 立即武装（读一次）
 *  2. 存活满窗口后 disarm（`setTimeout`）
 *  3. `beforeunload` 不 disarm —— 正常关页面不算崩溃？Android 不区分；
 *     这里只在页面存活满窗口时 disarm，语义与 Android 的 postDelayed 一致。
 *
 *  ── 本次审查新增（2026-10-06） ──────────────────────────────────────────────
 *  `installBootGuard` 需要一个**同步**的 `BootPrefsLike`，而真实的
 *  `SettingsRepository` 全是 async。`snapshotBootPrefs()` 先把这三个键读成一张
 *  快照（等价于 Android 的 SharedPreferences 在内存里），写入排进队列；
 *  `installBootGuardFromSettings()` 是给 `bootstrapLibrary()` 用的一行接线。
 *  ⚠️ 调用点必须排在任何 `render_quality` 读取之前（Android 侧看门狗在
 *  `onCreate()` 里、`MainViewModel` 构造之前，同一次冷启动就能看到降级值）。
 */
import {
  BOOT_GUARD_WINDOW_MS,
  disarmBootGuard,
  RENDER_QUALITY_HIGH,
  runBootGuard,
  type BootPrefsLike,
} from '@core/app/navigation';

let armed = false;

/** 真实存储适配：把 `BootPrefsLike` 桥到 SettingsRepository 的 app_settings 表。 */
export function createPrefsLike(get: (key: string) => number, set: (key: string, value: number) => void): BootPrefsLike {
  return {
    getInt: (key, fallback) => {
      const v = get(key);
      return v === undefined || v === null ? fallback : v;
    },
    getLong: (key, fallback) => {
      const v = get(key);
      return v === undefined || v === null ? fallback : v;
    },
    putInt: (key, value) => set(key, Math.trunc(value)),
    putLong: (key, value) => set(key, Math.trunc(value)),
  };
}

export interface BootGuardOptions {
  prefs: BootPrefsLike;
  now?: () => number;
  scheduleDisarm?: (fn: () => void, ms: number) => void;
}

/**
 * 跑一次看门狗。返回 `downgraded` 时调用方应刷新渲染配置（着色器/玻璃层重建）。
 */
export function installBootGuard(options: BootGuardOptions): { downgraded: boolean } {
  const now = options.now ?? (() => Date.now());
  const schedule = options.scheduleDisarm ?? ((fn, ms) => setTimeout(fn, ms));
  const result = runBootGuard(options.prefs, now());
  armed = result.disarm;
  if (result.disarm) {
    schedule(() => {
      if (!armed) return;
      armed = false;
      disarmBootGuard(options.prefs);
    }, BOOT_GUARD_WINDOW_MS);
  }
  return { downgraded: result.downgraded };
}

/** 测试用：重置武装状态。 */
export function resetBootGuardForTest(): void {
  armed = false;
}

/** 测试用：查询武装状态。 */
export function isBootGuardArmed(): boolean {
  return armed;
}

/* ── SettingsRepository 接线 ─────────────────────────────────────────────── */

/** Kotlin `MainActivity.kt` L121 `boot.getInt("render_quality", 2)`. */
export const BOOT_GUARD_QUALITY_KEY = 'render_quality';
/** Kotlin L123 `boot.getLong("boot_guard_last", 0L)`. */
export const BOOT_GUARD_LAST_KEY = 'boot_guard_last';
/** Kotlin L124 `boot.getInt("boot_guard_cnt", 0)`. */
export const BOOT_GUARD_COUNT_KEY = 'boot_guard_cnt';

/** `SettingsRepository` 里看门狗用到的四个 async 方法（逐字对应 L121-137）。 */
export interface BootGuardSettings {
  getInt(key: string, defaultValue?: number): Promise<number>;
  getLong(key: string, defaultValue?: number): Promise<number>;
  setInt(key: string, value: number): Promise<void>;
  setLong(key: string, value: number): Promise<void>;
}

/** 一个 `BootPrefsLike` + 把它身上挂起的写入全部 await 掉的能力。 */
export interface BootPrefsHandle {
  readonly prefs: BootPrefsLike;
  flush(): Promise<void>;
}

/**
 * 把 async 存储读成一份同步快照，再把写入排进队列 —— 等价于 Android 的
 * SharedPreferences（同步读、异步 apply）。
 */
export async function snapshotBootPrefs(
  settings: BootGuardSettings,
): Promise<BootPrefsHandle> {
  const [quality, last, count] = await Promise.all([
    settings.getInt(BOOT_GUARD_QUALITY_KEY, RENDER_QUALITY_HIGH),
    settings.getLong(BOOT_GUARD_LAST_KEY, 0),
    settings.getInt(BOOT_GUARD_COUNT_KEY, 0),
  ]);
  const cache = new Map<string, number>([
    [BOOT_GUARD_QUALITY_KEY, quality],
    [BOOT_GUARD_LAST_KEY, last],
    [BOOT_GUARD_COUNT_KEY, count],
  ]);
  const pending: Promise<void>[] = [];
  const put = (key: string, value: number, write: (k: string, v: number) => Promise<void>) => {
    cache.set(key, value);
    pending.push(write(key, value));
  };
  const prefs: BootPrefsLike = {
    getInt: (key, fallback) => cache.get(key) ?? fallback,
    getLong: (key, fallback) => cache.get(key) ?? fallback,
    putInt: (key, value) => {
      put(key, Math.trunc(value), (k, v) => settings.setInt(k, v));
    },
    putLong: (key, value) => {
      put(key, Math.trunc(value), (k, v) => settings.setLong(k, v));
    },
  };
  return {
    prefs,
    flush: async () => {
      await Promise.all(pending);
    },
  };
}

/**
 * 冷启动接线（Kotlin `MainActivity.kt` L119-140 的 `onCreate` 段）。
 * 返回 `downgraded` 时调用方**不需要**额外动作：降级值已经落库，
 * 后续任何 `render_quality` 读取都会拿到「高」—— 与 Android 同一次冷启动生效。
 */
export async function installBootGuardFromSettings(
  settings: BootGuardSettings,
  options: { now?: () => number; scheduleDisarm?: (fn: () => void, ms: number) => void } = {},
): Promise<{ downgraded: boolean }> {
  const handle = await snapshotBootPrefs(settings);
  const result = installBootGuard({
    prefs: handle.prefs,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.scheduleDisarm !== undefined ? { scheduleDisarm: options.scheduleDisarm } : {}),
  });
  await handle.flush();
  return { downgraded: result.downgraded };
}