/**
 * touchZones.ts — 逐行移植 Android
 * `app/src/main/java/com/example/ui/reader/TouchZones.kt`（101 行 / 100 非空）。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/reader/TouchZones.kt（只读）
 * TS 目标:   IOS/src/core/reader/touchZones.ts
 * 配套:
 *   - `TouchZoneGestures.kt`(112 行) → `src/ui/reader/touchZoneGestures.ts`
 *   - `TouchZoneEditor.kt`(387 行)   → `src/ui/components/reader/TouchZoneEditor.tsx`
 *   - `ReaderScreen.kt` L345-352 / L1701-1718 / L1864 / L1879 / L1974 / L3502-3516
 *     → `src/ui/pages/ReaderPage.tsx`
 *   - `ComicReaderConfig.kt` L86 / L124 / L191 / L272 → `src/core/comic/comicReaderConfig.ts`
 *   - `ComicReaderCore.kt` L887 / L930-944 / L988-1008 → `src/ui/pages/ComicReaderPage.tsx`
 *   - `ComicReaderSheets.kt` L1473-1477 → `ComicSettingsGestureTab.tsx`
 *
 * Kotlin → TS 行映射
 * ─────────────────────────────────────────────────────────────────────────────
 *   L1-7     package + imports（Context / JSONArray / JSONObject / UUID / abs）
 *                                                       → 无对应物；`android.content.Context`
 *                                                         由 `NovelTouchZoneStore` 的
 *                                                         `KeyValueStorePort` 端口替代
 *   L9       KDoc「展示文案在读取时翻译」                → 见下方 label 常量的注释
 *   L10-15   `enum class TouchAction(raw)`              → `TouchAction` + `TOUCH_ACTIONS`
 *                                                         + `TOUCH_ACTION_LABELS`
 *   L14      `val label get() = tr(raw)`                → `touchActionLabel()`（读时调 `tr`）
 *   L17-21   `enum class SwipeAction(raw)`              → `SwipeAction` + `SWIPE_ACTIONS`
 *                                                         + `SWIPE_ACTION_LABELS`
 *   L23      KDoc「Rectangles use viewport fractions」   → 文件头 + `TouchZone` 注释
 *   L24-31   `data class TouchZone`                     → `interface TouchZone` + `createTouchZone()`
 *   L32      `fun contains(x, y)`                        → `zoneContains()`
 *   L33-39   `fun normalized()`                          → `normalizeZone()`
 *   L34      `fun Float.safe(default)`                   → `normalizeZone()` 内 `safe()`
 *   L40-43   `fun json()`                                → `touchZoneJson()`
 *   L44-61   `companion object`
 *   L45-57   `fun decode(raw)`                           → `decodeZones()`
 *   L47      `require(array.length() <= 64)`             → `decodeZones()` 内 64 上限
 *   L50      `optString("id").ifBlank { UUID }`          → 同上（`makeUuid()`）
 *   L53-54   `enum.entries.firstOrNull { it.name == … } ?: NONE`
 *                                                       → `TOUCH_ACTIONS.find(…) ?? 'NONE'`
 *   L55      `if (o.has("distance")) o.getDouble(...)`    → `jsonDouble()`（缺失 ⇒ null，
 *                                                         存在但非法 ⇒ 整条 decode 失败）
 *   L56      `.distinctBy { it.id }`                     → `decodeZones()` 内 `seen`
 *   L58      `fun encode(zones)`                         → `encodeZones()` / `encodeZonesArray()`
 *   L59      KDoc「Last rectangle wins… NONE blocks」     → `zoneHit()`
 *   L60      `fun hit(zones, x, y)`                      → `zoneHit()`
 *   L64-70   `class NovelTouchZoneStore(context)`        → `NovelTouchZoneStore`（同步端口）
 *                                                         + `loadNovelTouchZones()` /
 *                                                           `saveNovelTouchZones()`（异步端口）
 *   L72      KDoc「One-way classification」              → `TouchGestureDecision` 注释
 *   L73-87   `class TouchGestureDecision`                → `TouchGestureDecision`
 *   L89-97   `fun fastPageCommit(…)`                     → `fastPageCommit()`
 *   L99-101  `fun swipeGuideSign(action, reverse)`       → `swipeGuideSign()`
 *
 * 本文件**不含** Compose / DOM / Android 依赖（E61）：`UUID.randomUUID()` 走
 * `globalThis.crypto`，存储走端口注入，密度由调用方传入。
 *
 * 单位约定：Kotlin 的 `dp` 阈值与 `Float` 视口比例在 Web 侧仍是「CSS px ≙ dp」，
 * `density` 由调用方传（`1` 表示 1 CSS px = 1 dp）。所有阈值（64 条上限、12..360 dp、
 * 0..0.92 / l+.08..1、850 dp/s）与 Kotlin 逐字相同。
 */

/* ══════════════════════════════════════════════════════════════════════════════
   枚举 — TouchZones.kt L10-21
   ══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin `enum class TouchAction(raw)` — 声明顺序即 UI 顺序。 */
export type TouchAction =
  | 'NONE'
  | 'PREVIOUS'
  | 'NEXT'
  | 'CONTROLS'
  | 'SETTINGS'
  | 'CONTENTS'
  | 'LISTEN'
  | 'EXIT';

/** Kotlin `TouchAction.entries`。 */
export const TOUCH_ACTIONS: readonly TouchAction[] = [
  'NONE',
  'PREVIOUS',
  'NEXT',
  'CONTROLS',
  'SETTINGS',
  'CONTENTS',
  'LISTEN',
  'EXIT',
];

/** Kotlin `enum class SwipeAction(raw)`。 */
export type SwipeAction = 'NONE' | 'PAGE' | 'CONTROLS' | 'SETTINGS';

/** Kotlin `SwipeAction.entries`。 */
export const SWIPE_ACTIONS: readonly SwipeAction[] = ['NONE', 'PAGE', 'CONTROLS', 'SETTINGS'];

/**
 * Kotlin L11-12 / L18 的 `raw` 文案。
 *
 * Kotlin 用 `val label: String get() = tr(raw)` 在**读取时**翻译（枚举类加载期翻译会把
 * 语言冻住）。TS 侧同理：`label` 常量只是 `tr()` 的中文 key，渲染时请调用
 * `touchActionLabel()` / `swipeActionLabel()`（`@core/i18n` 的 `tr`）。
 */
export const TOUCH_ACTION_LABELS: Readonly<Record<TouchAction, string>> = {
  NONE: '不执行操作',
  PREVIOUS: '上一页',
  NEXT: '下一页',
  CONTROLS: '呼出 / 收起状态栏',
  SETTINGS: '打开设置',
  CONTENTS: '打开目录',
  LISTEN: '听书',
  EXIT: '退出阅读',
};

/** Kotlin L18 raw 文案。 */
export const SWIPE_ACTION_LABELS: Readonly<Record<SwipeAction, string>> = {
  NONE: '不执行操作',
  PAGE: '滑动翻页',
  CONTROLS: '呼出状态栏',
  SETTINGS: '打开设置',
};

/* ══════════════════════════════════════════════════════════════════════════════
   常量
   ══════════════════════════════════════════════════════════════════════════════ */

/** TouchZones.kt L47 / L58 / L65-66 — SharedPreferences 名 + 键 + 64 条上限。 */
export const TOUCH_ZONE_PREFS = {
  /** Kotlin `context.getSharedPreferences("reader_touch_zones_v1", MODE_PRIVATE)` */
  name: 'reader_touch_zones_v1',
  /** Kotlin `prefs.getString("novel", null)` */
  key: 'novel',
  /** Kotlin `require(array.length() <= 64)` + `zones.take(64)` */
  maxZones: 64,
} as const;

/** TouchZones.kt L38 / L42 — `coerceIn(12f, 360f)`。 */
export const MIN_DISTANCE_DP = 12;
export const MAX_DISTANCE_DP = 360;

/** TouchZones.kt L36-37 — `coerceIn(l + .08f, 1f)` 的最小边长。 */
export const MIN_ZONE_EDGE = 0.08;

/** ReaderScreen.kt L3511 — `width * .15f`（legacy`defaultDistance`）。 */
export const DEFAULT_TOUCH_DISTANCE_RATIO = 0.15;

/** ReaderScreen.kt L3511 — `LocalRenderQuality.current.minimal → 48f`。 */
export const MINIMAL_TOUCH_DISTANCE_DP = 48;

/** TouchZoneGestures.kt L93 — `velocity.getDistance() < 850f * density`。 */
export const FAST_FLING_DP_PER_SEC = 850;

/* ══════════════════════════════════════════════════════════════════════════════
   模型 — TouchZones.kt L23-31
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * Kotlin `data class TouchZone`：矩形用**视口比例**，阈值用 dp（与编辑器缩放、
 * 显示密度无关）。
 */
export interface TouchZone {
  readonly id: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly tap: TouchAction;
  readonly swipe: SwipeAction;
  /** Kotlin L29 `val distanceDp: Float? = null` —— null 表示沿用阅读器原有阈值。 */
  readonly distanceDp: number | null;
}

/** Kotlin `List<TouchZone>?` —— null = 从未自定义（走 legacy 手势）。 */
export type TouchZoneConfig = readonly TouchZone[] | null;

/** Kotlin `TouchZone()` 默认参数值（L25-30）。 */
export function createTouchZone(
  id: string,
  patch: Partial<Omit<TouchZone, 'id'>> = {},
): TouchZone {
  return {
    id,
    left: 0.15,
    top: 0.2,
    right: 0.85,
    bottom: 0.65,
    tap: 'CONTROLS',
    swipe: 'PAGE',
    distanceDp: null,
    ...patch,
  };
}

/** Kotlin `Float.coerceIn(min, max)`（NaN 在 `safe()` 之前已被替换）。 */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** TouchZones.kt L32 `fun contains(x, y)` —— 四边闭合。 */
export function zoneContains(zone: TouchZone, x: number, y: number): boolean {
  return x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;
}

/** TouchZones.kt L33-39 `fun normalized()` —— 逐条复刻 coerce 范围与 NaN 兜底。 */
export function normalizeZone(zone: TouchZone): TouchZone {
  // L34 `fun Float.safe(default: Float) = if (isFinite()) this else default`
  const safe = (value: number, fallback: number): number =>
    Number.isFinite(value) ? value : fallback;
  const left = clamp(safe(zone.left, 0.15), 0, 0.92); // L35
  const top = clamp(safe(zone.top, 0.2), 0, 0.92);
  const right = clamp(safe(zone.right, 0.85), left + MIN_ZONE_EDGE, 1); // L36
  const bottom = clamp(safe(zone.bottom, 0.65), top + MIN_ZONE_EDGE, 1); // L37
  // L38 `distanceDp?.takeIf { it.isFinite() }?.coerceIn(12f, 360f)`
  const distanceDp =
    zone.distanceDp === null || !Number.isFinite(zone.distanceDp)
      ? null
      : clamp(zone.distanceDp, MIN_DISTANCE_DP, MAX_DISTANCE_DP);
  return { ...zone, left, top, right, bottom, distanceDp };
}

/**
 * TouchZones.kt L60 `fun hit(zones, x, y) = zones.lastOrNull { it.contains(x, y) }`
 * —— 最后一个命中的矩形对**点击和滑动**都生效；`NONE` 阻断下面所有矩形，不穿透。
 */
export function zoneHit(zones: readonly TouchZone[], x: number, y: number): TouchZone | null {
  for (let index = zones.length - 1; index >= 0; index -= 1) {
    const zone = zones[index];
    if (zone !== undefined && zoneContains(zone, x, y)) return zone;
  }
  return null;
}

/** TDZ 安全的三元夹紧：`zones.take(64).map { normalized }.distinctBy { id }`（L58 / L124）。 */
export function normalizeTouchZones(zones: readonly TouchZone[]): TouchZone[] {
  const out: TouchZone[] = [];
  const seen = new Set<string>();
  for (const zone of zones.slice(0, TOUCH_ZONE_PREFS.maxZones)) {
    const normalized = normalizeZone(zone);
    if (seen.has(normalized.id)) continue; // `distinctBy { it.id }` 保留第一条
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
   JSON — TouchZones.kt L40-58
   ══════════════════════════════════════════════════════════════════════════════ */

/** TouchZones.kt L40-43 `fun json()` —— 键序 `id,l,t,r,b,tap,swipe,distance?` 照抄。 */
export function touchZoneJson(zone: TouchZone): Record<string, string | number> {
  const json: Record<string, string | number> = {
    id: zone.id,
    l: zone.left,
    t: zone.top,
    r: zone.right,
    b: zone.bottom,
    tap: zone.tap,
    swipe: zone.swipe,
  };
  // L42 `distanceDp?.let { put("distance", it) }` —— null 时该键不出现
  if (zone.distanceDp !== null) json['distance'] = zone.distanceDp;
  return json;
}

/** Kotlin L58 `JSONArray { zones.take(64).forEach { put(it.normalized().json()) } }` 的数组形态。 */
export function encodeZonesArray(
  zones: readonly TouchZone[],
): ReadonlyArray<Record<string, string | number>> {
  return zones
    .slice(0, TOUCH_ZONE_PREFS.maxZones)
    .map((zone) => touchZoneJson(normalizeZone(zone)));
}

/** Kotlin L58 `fun encode(zones) = … .toString()`。 */
export function encodeZones(zones: readonly TouchZone[]): string {
  return JSON.stringify(encodeZonesArray(zones));
}

/**
 * `UUID.randomUUID().toString()` 的替代。测试通过 `makeUuid` 注入稳定 id
 * （编辑器与 `decodeZones` 在 id 缺失时都会调用它）。
 */
export function makeUuid(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  let out = '';
  for (let i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(12, 16)}-a${out.slice(16, 20)}-${out.slice(20, 32)}`;
}

/**
 * org.json `getDouble(key)` 的语义：Number 直取；String 走 `Double.parseDouble`
 * （因此 `"0.5"` 合法、`""` 抛错）；`JSONObject.NULL` / 缺失抛错。
 */
function jsonDouble(value: unknown, key: string): number {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new Error(`bad ${key}`);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`bad ${key}`);
}

/**
 * TouchZones.kt L45-57 `fun decode(raw): List<TouchZone>?`
 *
 * 任何一条坏数据（缺 `l/t/r/b`、数值非法、超过 64 条、整串不是 JSON）都会让**整个
 * decode 返回 `null`**（Kotlin `runCatching{}.getOrNull()`）。未知枚举值不失败，退回
 * `NONE`（L53-54 `?: TouchAction.NONE`）。
 */
export function decodeZones(raw: string | null): TouchZone[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (parsed.length > TOUCH_ZONE_PREFS.maxZones) return null; // L47 `require(<= 64)`
    const zones: TouchZone[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const source = entry as Record<string, unknown>;
      // L50 `o.optString("id").ifBlank { UUID.randomUUID().toString() }`
      const id = typeof source['id'] === 'string' && source['id'] !== '' ? source['id'] : makeUuid();
      const tapName = typeof source['tap'] === 'string' ? source['tap'] : '';
      const swipeName = typeof source['swipe'] === 'string' ? source['swipe'] : '';
      // L55 `if (o.has("distance")) o.getDouble("distance").toFloat() else null`
      let distanceDp: number | null = null;
      if (Object.prototype.hasOwnProperty.call(source, 'distance')) {
        distanceDp = jsonDouble(source['distance'], 'distance');
      }
      const zone = normalizeZone({
        id,
        left: jsonDouble(source['l'], 'l'),
        top: jsonDouble(source['t'], 't'),
        right: jsonDouble(source['r'], 'r'),
        bottom: jsonDouble(source['b'], 'b'),
        tap: TOUCH_ACTIONS.find((action) => action === tapName) ?? 'NONE',
        swipe: SWIPE_ACTIONS.find((action) => action === swipeName) ?? 'NONE',
        distanceDp,
      });
      if (seen.has(zone.id)) continue; // L56 `distinctBy { it.id }` 保留第一条
      seen.add(zone.id);
      zones.push(zone);
    }
    return zones;
  } catch {
    return null; // Kotlin `.getOrNull()`
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   Store — TouchZones.kt L64-70
   ══════════════════════════════════════════════════════════════════════════════ */

/** `SharedPreferences` 的最小同步形状（Kotlin `getString` / `edit().putString/remove`）。 */
export interface TouchZonePrefsPort {
  getString(key: string): string | null;
  putString(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * 平台层使用的完整键名。
 *
 * Android 的 SharedPreferences **文件名**（`reader_touch_zones_v1`）在 Web/设置表里
 * 退化为键前缀，与 `comicSettingsStore.comicPrefsKey()` 的
 * `comic_reader_store:key` 约定一致 ⇒ `reader_touch_zones_v1:novel`。
 */
export function novelTouchZonePrefsKey(): string {
  return `${TOUCH_ZONE_PREFS.name}:${TOUCH_ZONE_PREFS.key}`;
}

/** 内存实现（单测 / 无宿主存储兜底）。 */
export function createMemoryTouchZonePrefs(
  initial?: Readonly<Record<string, string>>,
): TouchZonePrefsPort {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getString: (key) => map.get(key) ?? null,
    putString: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

/**
 * TouchZones.kt L64-70 `class NovelTouchZoneStore(context)`。
 *
 * `load()` = `TouchZone.decode(prefs.getString("novel", null))`；
 * `save(null)` = `remove("novel")`，`save(list)` = `putString(encode(list))`。
 */
export class NovelTouchZoneStore {
  constructor(private readonly prefs: TouchZonePrefsPort) {}

  load(): TouchZoneConfig {
    return decodeZones(this.prefs.getString(novelTouchZonePrefsKey()));
  }

  save(zones: TouchZoneConfig): void {
    if (zones === null) {
      this.prefs.remove(novelTouchZonePrefsKey());
      return;
    }
    this.prefs.putString(novelTouchZonePrefsKey(), encodeZones(zones));
  }
}

/**
 * `SettingsRepository` 形状的异步端口（`app_settings` 表）。
 *
 * Kotlin 用 SharedPreferences，Web/iOS 侧的设置表是异步的，所以阅读页（`ReaderPage.tsx`）
 * 走这一对函数；`NovelTouchZoneStore` 保留给同步宿主与单测。
 */
export interface TouchZoneSettingsPort {
  getString(key: string, defaultValue: string): Promise<string>;
  setString(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 「没有存过分区」的占位值：`decodeZones('null')` ⇒ `null`（与 Kotlin 缺键等价）。 */
export const NO_TOUCH_ZONES_RAW = 'null';

/** Kotlin `touchStore.load()` 的异步版本。 */
export async function loadNovelTouchZones(port: TouchZoneSettingsPort): Promise<TouchZoneConfig> {
  const raw = await port.getString(novelTouchZonePrefsKey(), NO_TOUCH_ZONES_RAW);
  return decodeZones(raw);
}

/** Kotlin `touchStore.save(zones)` 的异步版本。 */
export async function saveNovelTouchZones(
  port: TouchZoneSettingsPort,
  zones: TouchZoneConfig,
): Promise<void> {
  if (zones === null) {
    await port.remove(novelTouchZonePrefsKey());
    return;
  }
  await port.setString(novelTouchZonePrefsKey(), encodeZones(zones));
}

/* ══════════════════════════════════════════════════════════════════════════════
   手势判定 — TouchZones.kt L72-87
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * TouchZones.kt L72-87 `class TouchGestureDecision`。
 *
 * 单向分类：一旦手势移动过，抬手**绝不**再产生 click。
 * `slop` = `viewConfiguration.touchSlop`，`threshold` = 该分区的完成距离（px）。
 */
export class TouchGestureDecision {
  private movedFlag = false;
  private cancelledFlag = false;
  private maxPointers = 1;
  private dxValue = 0;
  private dyValue = 0;

  constructor(
    private readonly slop: number,
    private readonly threshold: number,
  ) {}

  /** L74 `var moved`。 */
  get moved(): boolean {
    return this.movedFlag;
  }

  /** L75 `var cancelled`。 */
  get cancelled(): boolean {
    return this.cancelledFlag;
  }

  /** L77-78 `var dx` / `var dy`（相对 DOWN 的位移，px）。 */
  get dx(): number {
    return this.dxValue;
  }

  get dy(): number {
    return this.dyValue;
  }

  /** L76 `private var maxPointers` —— 多指一旦出现就永久取消（导出供断言/调试）。 */
  get pointers(): number {
    return this.maxPointers;
  }

  /** L79-83 `fun update(x, y, pointers, consumed)`。 */
  update(x: number, y: number, pointers = 1, consumed = false): void {
    this.dxValue = x;
    this.dyValue = y;
    this.maxPointers = Math.max(this.maxPointers, pointers);
    if (Math.hypot(x, y) > this.slop) this.movedFlag = true; // L81
    if (this.maxPointers > 1 || consumed) this.cancelledFlag = true; // L82
  }

  /** L84 `fun isTap() = !moved && !cancelled`。 */
  isTap(): boolean {
    return !this.movedFlag && !this.cancelledFlag;
  }

  /**
   * L85-86 `fun isSwipe(vertical)`。
   *
   * Kotlin 的 `vertical` 参数是 `@Suppress("UNUSED_PARAMETER")`：滑动判定用的是
   * 欧氏距离，与轴向无关。这里保留同名参数以保持调用点一致。
   */
  isSwipe(_vertical = false): boolean {
    return (
      this.movedFlag &&
      !this.cancelledFlag &&
      Math.hypot(this.dxValue, this.dyValue) >= this.threshold
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   纯函数 — TouchZones.kt L89-101
   ══════════════════════════════════════════════════════════════════════════════ */

/** 位移/速度向量（Kotlin `androidx.compose.ui.geometry.Offset`）。 */
export interface TouchVector {
  readonly x: number;
  readonly y: number;
}

/**
 * TouchZones.kt L90-97 `fun fastPageCommit(...)`。
 *
 * 只有「快速甩动」才覆盖 native 的完成判定：没有轴锁，也不改写路径。
 *  1. `distanceDp == null` 或速度 < `850 * density` ⇒ 交回 `nativeCommit`；
 *  2. 反向甩动（`delta·velocity < 0`）⇒ `false`（长距离外卷后回拉也要退回）；
 *  3. 否则要求 `delta >= distanceDp * density`。
 */
export function fastPageCommit(
  distanceDp: number | null,
  delta: TouchVector,
  velocity: TouchVector,
  density: number,
  nativeCommit: boolean,
): boolean {
  // L93 `if (distanceDp == null || velocity.getDistance() < 850f * density) return nativeCommit`
  if (distanceDp === null || Math.hypot(velocity.x, velocity.y) < FAST_FLING_DP_PER_SEC * density) {
    return nativeCommit;
  }
  // L95 `if (delta.x * velocity.x + delta.y * velocity.y < 0f) return false`
  if (delta.x * velocity.x + delta.y * velocity.y < 0) return false;
  // L96
  return Math.hypot(delta.x, delta.y) >= distanceDp * density;
}

/**
 * TouchZones.kt L100-101 `fun swipeGuideSign(action, reverse)`。
 *
 * 正值 = 物理右/下。`PAGE` 双向，与点击行为无关。
 */
export function swipeGuideSign(action: TouchAction, reverse: boolean): number {
  return (action === 'PREVIOUS' ? 1 : -1) * (reverse ? -1 : 1);
}

/**
 * TouchZoneGestures.kt L101-104 —— `SwipeAction.PAGE` 的分派：
 *
 * `val negative = (if (vertical) dy else dx) < 0`，
 * `currentAction(if (negative.xor(reverse)) NEXT else PREVIOUS)`。
 */
export function pageSwipeAction(
  dx: number,
  dy: number,
  vertical: boolean,
  reverse: boolean,
): TouchAction {
  const negative = (vertical ? dy : dx) < 0;
  return negative !== reverse ? 'NEXT' : 'PREVIOUS';
}

/** TouchZoneGestures.kt L90 / L107 —— `zone?.tap ?: TouchAction.NONE` 的等价读法。 */
export function zoneTapAction(zone: TouchZone | null): TouchAction {
  return zone === null ? 'NONE' : zone.tap;
}

/** TouchZoneGestures.kt L105-106 —— `SwipeAction` → 要执行的 `TouchAction`。 */
export function swipeActionOf(swipe: SwipeAction): TouchAction {
  switch (swipe) {
    case 'PAGE':
      return 'NONE'; // 由 `pageSwipeAction()` 决定方向，见调用点
    case 'CONTROLS':
      return 'CONTROLS';
    case 'SETTINGS':
      return 'SETTINGS';
    default:
      return 'NONE';
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   默认分区
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * ReaderScreen.kt L3505-3509 —— `showTouchEditor` 里的 `defaults`。
 *
 * 滚动模式：整屏一块、滑动关闭（`swipe = NONE`）。翻页模式：左 `split` / 中 / 右三段，
 * 左 = 上一页，右 = 下一页，中间默认 `CONTROLS`（`TouchZone()` 默认 tap）。
 */
export function novelDefaultTouchZones(scrollMode: boolean, split: number): TouchZone[] {
  if (scrollMode) {
    return [
      createTouchZone('scroll', { left: 0, top: 0, right: 1, bottom: 1, swipe: 'NONE' }),
    ];
  }
  return [
    createTouchZone('left', { left: 0, top: 0, right: split, bottom: 1, tap: 'PREVIOUS' }),
    createTouchZone('center', { left: split, top: 0, right: 1 - split, bottom: 1 }),
    createTouchZone('right', { left: 1 - split, top: 0, right: 1, bottom: 1, tap: 'NEXT' }),
  ];
}

/**
 * ReaderScreen.kt L3505 —— `split` 推导：
 * SIMULATE 档（或 minimal 渲染）用 `1/3`，其余 `0.35`。
 */
export function novelTouchZoneSplit(simulate: boolean, minimal: boolean): number {
  return simulate || minimal ? 1 / 3 : 0.35;
}

/**
 * ComicReaderCore.kt L930-937 —— 漫画默认三分区。
 *
 * 竖屏（`vertical`）上下三块，横屏左右三块；`id = default{index}`；
 * `tap` 取 `[gestureTapLeft, gestureTapCenter, gestureTapRight]`（RTL 反向时整体倒序），
 * `swipe` 取 `gestureSwipe ? PAGE : NONE`。
 */
export function comicDefaultTouchZones(args: {
  readonly vertical: boolean;
  readonly reverse: boolean;
  readonly taps: readonly [TouchAction, TouchAction, TouchAction];
  readonly swipe: SwipeAction;
}): TouchZone[] {
  const out: TouchZone[] = [];
  for (let index = 0; index < 3; index += 1) {
    const source = args.reverse ? 2 - index : index;
    const tap = args.taps[source] ?? 'NONE';
    out.push(
      args.vertical
        ? createTouchZone(`default${String(index)}`, {
            left: 0,
            top: index / 3,
            right: 1,
            bottom: (index + 1) / 3,
            tap,
            swipe: args.swipe,
          })
        : createTouchZone(`default${String(index)}`, {
            left: index / 3,
            top: 0,
            right: (index + 1) / 3,
            bottom: 1,
            tap,
            swipe: args.swipe,
          }),
    );
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════════
   漫画点击区解析 — ComicReaderCore.kt L988-1000
   ══════════════════════════════════════════════════════════════════════════════ */

/** `ComicGestureAction` 的字符串联合（避免 core/reader 依赖 core/comic 的类型）。 */
export type ComicZoneTapAction =
  | 'NONE'
  | 'PREV'
  | 'NEXT'
  | 'TOGGLE_CONTROLS'
  | 'TOC'
  | 'SETTINGS'
  | 'EXIT';

const COMIC_TAP_OF: Readonly<Record<TouchAction, ComicZoneTapAction>> = {
  NONE: 'NONE',
  PREVIOUS: 'PREV',
  NEXT: 'NEXT',
  CONTROLS: 'TOGGLE_CONTROLS',
  SETTINGS: 'SETTINGS',
  CONTENTS: 'TOC',
  LISTEN: 'NONE', // 漫画没有听书（编辑器也不提供该项）
  EXIT: 'EXIT',
};

/**
 * ComicReaderCore.kt L988-1000 `resolveTapAction` 的自定义区分支。
 *
 * 返回 `null` 表示「没有自定义区」⇒ 调用方回落到三分区 `gestureTapLeft/Center/Right`。
 * 有自定义区但**没命中任何矩形**时返回 `'NONE'`（Kotlin `?.tap` 为 null → `else` 分支），
 * 即空白区域不操作、也不回落到三分区。
 */
export function resolveComicZoneTapAction(
  zones: TouchZoneConfig,
  x: number,
  y: number,
): ComicZoneTapAction | null {
  if (zones === null) return null;
  const action = zoneHit(zones, x, y)?.tap ?? 'NONE';
  return COMIC_TAP_OF[action];
}

/* ══════════════════════════════════════════════════════════════════════════════
   编辑器辅助
   ══════════════════════════════════════════════════════════════════════════════ */

/**
 * TouchZoneEditor.kt L190-199 —— 四角/整体拖动的夹紧规则。
 *
 * 纯函数，供编辑器与单测共用（handle 0..3 = 左上/右上/左下/右下，其它 = 整体移动）。
 */
export function applyZoneDrag(zone: TouchZone, handle: number, dx: number, dy: number): TouchZone {
  switch (handle) {
    case 0:
      return {
        ...zone,
        left: Math.min(zone.left + dx, zone.right - MIN_ZONE_EDGE),
        top: Math.min(zone.top + dy, zone.bottom - MIN_ZONE_EDGE),
      };
    case 1:
      return {
        ...zone,
        right: zone.right + dx,
        top: Math.min(zone.top + dy, zone.bottom - MIN_ZONE_EDGE),
      };
    case 2:
      return {
        ...zone,
        left: Math.min(zone.left + dx, zone.right - MIN_ZONE_EDGE),
        bottom: zone.bottom + dy,
      };
    case 3:
      return { ...zone, right: zone.right + dx, bottom: zone.bottom + dy };
    default: {
      const mx = clamp(dx, -zone.left, 1 - zone.right);
      const my = clamp(dy, -zone.top, 1 - zone.bottom);
      return {
        ...zone,
        left: zone.left + mx,
        right: zone.right + mx,
        top: zone.top + my,
        bottom: zone.bottom + my,
      };
    }
  }
}
