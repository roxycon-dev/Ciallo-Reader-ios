/**
 * 主页渲染失败自动降级 — Android `data/HomeRenderRecovery.kt`（55 行）的逐行移植。
 *
 * Android 语义（`HomeRenderRecovery.kt:6`「Recover only from an actual UI render
 * failure during entry, never from a normal restart.」）：
 *  1. 进入主页时 `arm()`（`MainActivity.kt:690-694`，在**组合之前**）记下时刻与 token；
 *  2. 进程级未捕获异常处理里调 `onUncaught()`：只在 20 s 窗口内、且栈帧命中渲染层、
 *     且当前画质 ≥ HIGH(2) 时，把 `render_quality` 写成 -1（极简）并置
 *     `home_render_recovery_notice = true`（`commit()`：进程即将退出，`apply()` 会丢）；
 *  3. 下次进主页 `consumeNotice()`：读到就清掉并返回 true，UI 弹 LENGTH_LONG 提示。
 *
 * 与 Android 的三处必然差异（Web 没有对应物，逐条落在下面）：
 *  - **没有 `Thread.currentThread().uncaughtExceptionHandler`**：等价物是 React 错误边界
 *    （`src/ui/shell/RenderRecoveryBoundary.tsx`）+ `window` 的 `error` /
 *    `unhandledrejection` 监听（`src/main.tsx`）。三者都只是把异常喂给 `onUncaught()`。
 *  - **没有 `Throwable.stackTrace` 结构体**：Java 栈帧是 `className.methodName`，Web 只有
 *    一行文本，所以 `GlassCard` 之类的类名判定退化成「栈帧文本包含关键词」。
 *  - **没有 `VirtualMachineError` 家族**：`StackOverflowError` 的等价物是
 *    `RangeError: Maximum call stack size exceeded`（SpiderMonkey 是
 *    `InternalError: too much recursion`），`OutOfMemoryError` 只能靠消息文本识别。
 *    Android 里这些是 `VirtualMachineError` 子类 → **直接判非渲染失败**，即便栈帧里
 *    确实是 GlassCard（递归溢出往往正是玻璃卡片引起的，但降级解决不了它）。
 *
 * core 层约束：本文件是纯 TS + 纯字符串处理，不碰 DOM / React / Capacitor
 * （`window` / `document` / `localStorage` 一律不出现），存储走注入的
 * `RenderRecoverySettings`（与 `bootGuard.ts` 的 `BootGuardSettings` 同一套路）。
 */

/* ══════════════════════════════════════════════════════════════
   常量 — 逐条对应 Kotlin
   ══════════════════════════════════════════════════════════════ */

/** Kotlin L8 `const val ENTRY_WINDOW_MS = 20_000L`。 */
export const ENTRY_WINDOW_MS = 20_000;

/** Kotlin L27 `prefs.getInt("render_quality", 2)` 的默认值（HIGH）。 */
export const RENDER_QUALITY_DEFAULT = 2;

/** Kotlin L30 `putInt("render_quality", -1)` —— `RenderQuality.MINIMAL.id`。 */
export const RENDER_QUALITY_MINIMAL = -1;

/** Kotlin L27/L30 的存储键（`novel_reader_prefs` → `app_settings` 表）。 */
export const RENDER_QUALITY_KEY = 'render_quality';

/** Kotlin L30 `putBoolean("home_render_recovery_notice", true)`。 */
export const HOME_RENDER_RECOVERY_NOTICE_KEY = 'home_render_recovery_notice';

/** Kotlin L44 `repeat(8)` —— cause 链最多回溯 8 层。 */
export const CAUSE_DEPTH_LIMIT = 8;

/* ══════════════════════════════════════════════════════════════
   存储端口
   ══════════════════════════════════════════════════════════════ */

/**
 * `HomeRenderRecovery` 用到的四个 async 方法（`SettingsRepository` 逐字兼容）。
 *
 * Kotlin 是同步 `SharedPreferences`；Web 是 async（SQLite / Capacitor Preferences），
 * 所以调用方必须 `await` 到落库后再刷新页面 —— 参考 `bootGuard.ts:109` 的思路。
 */
export interface RenderRecoverySettings {
  getInt(key: string, defaultValue?: number): Promise<number>;
  setInt(key: string, value: number): Promise<void>;
  getBoolean(key: string, defaultValue?: boolean): Promise<boolean>;
  setBoolean(key: string, value: boolean): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * 设置存储提供者。`main.tsx` 在启动时注入一个**懒**解析器（`import()` 平台与
 * `SettingsRepository`），这样 core 层不需要认识 `@platform/*`。
 * 返回 `null` 表示「当前宿主还没有存储」→ 所有写操作静默跳过（单元测试也靠这个
 * 让未注入的模块保持零副作用）。
 */
export type RenderRecoverySettingsProvider = () => Promise<RenderRecoverySettings | null>;

let settingsProvider: RenderRecoverySettingsProvider | null = null;

/** 注入存储提供者（`main.tsx` 调用一次；传 `null` 可撤销）。 */
export function installRenderRecoverySettings(provider: RenderRecoverySettingsProvider | null): void {
  settingsProvider = provider;
}

/* ══════════════════════════════════════════════════════════════
   arm / disarm — Kotlin L9-21
   ══════════════════════════════════════════════════════════════ */

/** Kotlin L9 `private var nextToken = 0L` —— 单调递增，不用随机数。 */
let nextToken = 0;

/** Kotlin L10 `private var activeToken = 0L`（0 = 未武装）。 */
let activeToken = 0;

/** Kotlin L11 `private var enteredAt = 0L`。 */
let enteredAt = 0;

export interface ArmOptions {
  /** 单调时钟。默认 `Date.now()`（与 `bootGuard.ts` 一致，可注入以便测试）。 */
  now?: () => number;
}

function clockOf(options: ArmOptions): () => number {
  return options.now ?? (() => Date.now());
}

/**
 * Kotlin L13-17 `@Synchronized fun arm(): Long`。
 *
 * `enteredAt = now()`、`activeToken = ++nextToken`，返回 token。
 * 重复 `arm()` 会顶掉上一个 token（Android 同样如此：`DisposableEffect` 的
 * onDispose 用旧 token 调 `disarm` 时不再生效）。
 */
export function arm(options: ArmOptions = {}): number {
  enteredAt = clockOf(options)();
  // Kotlin L15 `activeToken = ++nextToken`：nextToken 永不回退，所以 disarm 之后的
  // 新 token 仍然严格大于历史 token，旧入口迟到的 `disarm` 不可能蒙中。
  nextToken += 1;
  activeToken = nextToken;
  return activeToken;
}

/**
 * Kotlin L19-21 `@Synchronized fun disarm(token: Long)`。
 *
 * **只在 token 匹配时**清零 —— token 不匹配（旧入口的 `DisposableEffect` 迟到）
 * 必须保留武装状态，否则会漏掉新入口窗口内的崩溃。
 */
export function disarm(token: number): void {
  if (activeToken === token) activeToken = 0;
}

/* ══════════════════════════════════════════════════════════════
   isRenderFailure — Kotlin L41-61
   ══════════════════════════════════════════════════════════════ */

/**
 * 渲染栈帧关键词 —— 逐条对应 `isRenderFailure` 的六个分支（Kotlin L47-57）。
 *
 *  | Kotlin 分支（L47-57）                                        | Web 关键词 |
 *  |--------------------------------------------------------------|-----------|
 *  | L48 `android.graphics.*`                                     | `canvas` / `webgl` / `getContext` / `measureText` |
 *  | L49 `androidx.compose.ui.graphics.*`                         | 同上（Chromium/WebKit 的绘制栈都从 `CanvasRenderingContext2D.getContext` 起步） |
 *  | L50-51 `androidx.compose.ui.node.*` + measure/layout/draw/place | `ResizeObserver` / `IntersectionObserver` / `measureText`（Web 把 measure/layout 交给这两个回调） |
 *  | L52-54 `ui.components.{GlassCard,LiquidSegmentView,LiquidSliderView,PullOutRender}` | `GlassCard` / `GlassCardLayers` / `MaxCardLayers` / `LiquidSegment` / `LiquidSlider` / `PullOut` |
 *  | L55 `com.kashif_e.backdrop.*`                                | `backdrop` |
 *  | L56 `dev.liquidglass.*`                                      | `liquidglass` |
 *
 * 一律小写比较：Android 的 `startsWith` 是大小写敏感的类名前缀匹配，而 Web 侧
 * 打包器/压缩器会改变标识符大小写（`liquidglass` 组件在源码里是 `LiquidGlass`，
 * 而 CSS 属性叫 `backdrop-filter`），所以这里统一折叠大小写。
 */
const RENDER_FRAME_KEYWORDS: readonly string[] = [
  // 分支 1 + 2：android.graphics.* / androidx.compose.ui.graphics.* → Canvas / WebGL
  'canvas',
  'webgl',
  'getcontext',
  'measuretext',
  // 分支 3：androidx.compose.ui.node.* 的 measure/layout/draw/place → 布局观察者
  'resizeobserver',
  'intersectionobserver',
  // 分支 4：com.example.ui.components.{GlassCard,LiquidSegmentView,LiquidSliderView,PullOutRender}
  'glasscard',
  'glasscardlayers',
  'maxcardlayers',
  'liquidsegment',
  'liquidslider',
  'pullout',
  // 分支 5：com.kashif_e.backdrop.* → `backdrop-filter` 玻璃链路
  'backdrop',
  // 分支 6：dev.liquidglass.*
  'liquidglass',
];

/**
 * Kotlin L46 `error is VirtualMachineError || error is ThreadDeath` 的 Web 对应。
 *
 * - `StackOverflowError` → `RangeError: Maximum call stack size exceeded`（V8）
 *   / `InternalError: too much recursion`（SpiderMonkey）
 * - `OutOfMemoryError` → 引擎只给文本（`out of memory` / `allocation failed`）
 * - `ThreadDeath` → 无对应物（Web 没有线程终止异常），保留为空
 *
 * 命中即代表「资源/引擎级致命错误」，无论栈帧多像渲染栈都不降级 —— 与 Kotlin
 * L46 `return false` 一样是**短路**（不再继续看后续 cause）。
 */
const FATAL_MESSAGE_PATTERNS: readonly RegExp[] = [
  /maximum call stack/i,
  /too much recursion/i,
  /stack overflow/i,
  /out of memory/i,
  /allocation failed/i,
];

function isFatalFailure(failure: unknown): boolean {
  if (!(failure instanceof Error)) return false;
  const text = `${failure.name}: ${failure.message}`;
  return FATAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}

/** V8 栈帧行：`    at fn (file:line:col)`。 */
const V8_FRAME_LINE = /^\s*at\s/;
/** JavaScriptCore / SpiderMonkey 栈帧行：`fn@file:line:col`。 */
const NON_V8_FRAME_LINE = /@.+:\d+:\d+\s*$/;

function isFrameLine(line: string): boolean {
  return V8_FRAME_LINE.test(line) || NON_V8_FRAME_LINE.test(line);
}

/**
 * 把 `Error.stack` 拆成「栈帧行」。
 *
 * 首行是 `Error: message`（V8），不能当帧看 —— 否则 `throw new Error('GlassCard
 * failed')` 这类业务错误会被误判成渲染失败（Kotlin 只看 `stackTrace` 元素，
 * 从不看 `message`）。非 V8 格式（`fn@url:line:col`）首行本身就是帧，单独识别。
 * 两种格式都没认出来时退化成「丢弃首行」，宁可漏判也不误判。
 */
function frameLinesOf(stack: string): string[] {
  const lines = stack.split('\n');
  const frames = lines.filter(isFrameLine);
  if (frames.length > 0) return frames;
  return lines.slice(1);
}

function stackOf(failure: unknown): string {
  if (!(failure instanceof Error)) return '';
  return typeof failure.stack === 'string' ? failure.stack : '';
}

/** Kotlin L47-57 的 `error.stackTrace.any { ... }`：任一帧命中关键词即为渲染栈。 */
function hasRenderFrame(failure: unknown): boolean {
  const stack = stackOf(failure);
  if (stack === '') return false;
  const frames = frameLinesOf(stack);
  return frames.some((frame) => {
    const lower = frame.toLowerCase();
    return RENDER_FRAME_KEYWORDS.some((keyword) => lower.includes(keyword));
  });
}

/**
 * Kotlin L58 `error.cause?.takeUnless { it === error }`。
 * Web 侧同一个坑：`error.cause = error` 会造成死循环，Java 用 `takeUnless` 挡住，
 * 这里同样把自引用折成 `undefined`（外层 `for` 自然结束）。
 */
function causeOf(failure: unknown): unknown {
  if (typeof failure !== 'object' || failure === null) return undefined;
  if (!('cause' in failure)) return undefined;
  return (failure as { cause?: unknown }).cause;
}

/**
 * Kotlin L41-61 `private fun isRenderFailure(failure: Throwable): Boolean`。
 *
 * 纯字符串判定，不读 `window`。返回 `true` 只代表「栈帧里出现过渲染层」，
 * 是否真的降级由 `onUncaught()` 结合窗口与当前画质决定。
 */
export function isRenderFailure(failure: unknown): boolean {
  let cause: unknown = failure;
  let renderFrame = false;
  // Kotlin L44 `repeat(8)`：只看 cause 链前 8 层（含 failure 本身）。
  for (let depth = 0; depth < CAUSE_DEPTH_LIMIT; depth += 1) {
    if (cause === null || cause === undefined) return renderFrame;
    // Kotlin L46：VM 级致命错误（栈溢出 / OOM）直接排除，短路整条链。
    if (isFatalFailure(cause)) return false;
    // Kotlin L47-57：任一分支命中即标记（不提前 return —— 后续 cause 里可能出现致命错误）。
    if (hasRenderFrame(cause)) renderFrame = true;
    const next = causeOf(cause);
    if (next === cause) break;
    cause = next;
  }
  return renderFrame;
}

/* ══════════════════════════════════════════════════════════════
   onUncaught — Kotlin L23-32
   ══════════════════════════════════════════════════════════════ */

export interface RecoveryDeps {
  /**
   * 显式存储；`null` = 「没有存储，直接放弃」。
   * 省略时用 `installRenderRecoverySettings()` 注入的提供者。
   */
  settings?: RenderRecoverySettings | null;
  /** 单调时钟，必须与 `arm({ now })` 用同一个，否则窗口判定无意义。 */
  now?: () => number;
}

async function resolveSettings(deps: RecoveryDeps): Promise<RenderRecoverySettings | null> {
  if (deps.settings !== undefined) return deps.settings;
  if (settingsProvider === null) return null;
  try {
    return await settingsProvider();
  } catch {
    // 存储层还没起来（例如启动早期异常）：当作「没有存储」，不降级也不抛。
    return null;
  }
}

/**
 * Kotlin L23-32 `@Synchronized fun onUncaught(context: Context, failure: Throwable)`。
 *
 * 判定顺序与 Kotlin 完全一致：
 *  1. 未武装（`activeToken == 0`）→ 返回；
 *  2. `elapsed ∉ 0..ENTRY_WINDOW_MS` → 返回；
 *  3. `!isRenderFailure(failure)` → 返回；
 *  4. `render_quality < 2`（已经是 MINIMAL/LOW/MID）→ 返回，**只从 HIGH/MAX 降级**；
 *  5. 写 `render_quality = -1` + `home_render_recovery_notice = true`，然后解除武装
 *     （Android L31 `activeToken = 0L`：一次窗口只降一次）。
 *
 * 与 Kotlin 的 `commit()` 对齐：两次写都 `await` 到落库（Web 存储是 async，
 * `void` 掉的话下一次冷启动读到的还是旧画质 —— 这正是 Kotlin 用 `commit()`
 * 而不是 `apply()` 的原因）。
 */
export async function onUncaught(failure: unknown, deps: RecoveryDeps = {}): Promise<void> {
  // L24 前半：未武装。
  if (activeToken === 0) return;
  // L24 后半：`SystemClock.uptimeMillis() - enteredAt !in 0..ENTRY_WINDOW_MS`。
  const elapsed = (deps.now ?? (() => Date.now()))() - enteredAt;
  if (!(elapsed >= 0 && elapsed <= ENTRY_WINDOW_MS)) return;
  // L25：渲染栈判定。
  if (!isRenderFailure(failure)) return;

  const settings = await resolveSettings(deps);
  if (settings === null) return;

  // L27：只允许从 HIGH(2) / MAX(3) 降级，已经降过的不再动。
  const quality = await settings.getInt(RENDER_QUALITY_KEY, RENDER_QUALITY_DEFAULT);
  if (quality < RENDER_QUALITY_DEFAULT) return;

  // L30：等价于 `prefs.edit().putInt(...).putBoolean(...).commit()`（顺序写、全部落库）。
  await settings.setInt(RENDER_QUALITY_KEY, RENDER_QUALITY_MINIMAL);
  await settings.setBoolean(HOME_RENDER_RECOVERY_NOTICE_KEY, true);
  // L31：本窗口已完成降级，后续异常不再重复处理。
  activeToken = 0;
}

/* ══════════════════════════════════════════════════════════════
   consumeNotice — Kotlin L34-39
   ══════════════════════════════════════════════════════════════ */

/**
 * Kotlin L34-39 `fun consumeNotice(context: Context): Boolean`。
 *
 * 读到 `home_render_recovery_notice` 就**清掉并返回 true**（Android 用
 * `remove().apply()`），所以同一次降级只会提示一次 —— 用户连点重进主页也不会刷屏。
 */
export async function consumeNotice(deps: RecoveryDeps = {}): Promise<boolean> {
  const settings = await resolveSettings(deps);
  if (settings === null) return false;
  const flagged = await settings.getBoolean(HOME_RENDER_RECOVERY_NOTICE_KEY, false);
  if (!flagged) return false;
  await settings.remove(HOME_RENDER_RECOVERY_NOTICE_KEY);
  return true;
}

/* ══════════════════════════════════════════════════════════════
   测试辅助
   ══════════════════════════════════════════════════════════════ */

/**
 * 复位模块级状态（token / 时钟 / 存储提供者）。
 * Android 的 `object` 单例随进程消亡，测试里必须手动清 —— 与
 * `resetBootGuardForTest()` 同一约定。
 */
export function resetRenderRecoveryForTest(): void {
  nextToken = 0;
  activeToken = 0;
  enteredAt = 0;
  settingsProvider = null;
}
