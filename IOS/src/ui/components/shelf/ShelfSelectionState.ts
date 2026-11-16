/**
 * Port of Android `ui/shelf/ShelfMultiSelect.kt` (670 lines total / 604 non-blank / 353 code).
 *
 * This file holds the **pure state** (the Kotlin file's own words: "纯状态、无 Android
 * 依赖，可单测；动画与业务逻辑分离（UI 只读状态）"), so it is a `.ts` module with no
 * React. The gesture loop (`Modifier.shelfGestures`, Kotlin L530–669) is ported to
 * `@ui/components/shelf/ShelfSelectionHost.tsx` because it needs pointer events.
 *
 * Full-line map (Kotlin line → TS):
 *    1–22   package + imports → file header. `MutableState` → a plain field plus a
 *           change-notification callback list (`subscribe`).
 *   23–34  the state-machine KDoc (the ASCII diagram) → `ShelfPhase` KDoc, verbatim.
 *   35     `enum class ShelfPhase { BROWSE, SELECTING, DRAGGING }` → same.
 *   37–46  the `ShelfSelectionScope` KDoc ("两个栏目完全独立") → same.
 *   47     `enum class ShelfSelectionScope { BOOK, FAV }` → same.
 *   49–471 `class ShelfSelectionState`:
 *   50–62    `phase` (private set) + `scope` (private set) + their KDoc → same fields.
 *   64–65    `private fun scopeOf(key) = if (isFavShelfKey(key)) FAV else BOOK`
 *            → `scopeOf` (private method).
 *   67–79    `fun accepts(key)` + the ⚠️ KDoc ("这就是「两个栏目完全独立」的落点")
 *            → `accepts`.
 *   81–88    `selected` / `dragging` + KDoc → same.
 *   90–103   `flyingHome` + the ⚠️ KDoc (松手瞬间真实卡片会浮现 → 必须继续藏着)
 *            → same.
 *  105–107   `ghostTilt` (internal set) → same.
 *  109–111   `pointer: Offset` (private set) → `{ x, y } | null` (Offset.Unspecified
 *            becomes `null`, the JS-idiomatic "unspecified").
 *  113–115   `hoverTarget` (private set) → same.
 *  117–119   `edgeScroll` (private set) → same.
 *  121–127   `lastHoverId` + the hysteresis KDoc → same private field.
 *  129–131   `lastDragX` → same private field.
 *  133–139   `private companion object { HYSTERESIS = 12f; EDGE_BAND_DP = 96f }`
 *            → module-level consts `HYSTERESIS` / `EDGE_BAND_DP`.
 *  141–155   `private fun pickTarget(root, hostTop, hostBottom)` + the ⚠️ KDoc about
 *            requiring **完整可见** (Rect.top / Rect.bottom) → `pickTarget`.
 *  157–164   `pressedKey` + KDoc → same.
 *  166–179   `itemRects` / `coverRects` (+ the ⚠️ KDoc why coverRects is required) /
 *            `targetRects` maps → same three `Map<string, Rect>`.
 *  181–182   `slideVisited: LinkedHashSet<String>` → `Set<string>` (insertion order is
 *            not read anywhere; only membership is).
 *  184–192   `anchorKey` + the ⚠️ KDoc ("长按明明选中了，下一瞬又没了")
 *            → same.
 *  195–207   `lastSlideKey` (internal set) + the ⚠️ KDoc ("第二本一直在选中和未选中
 *            之间跳跃闪烁") → same.
 *  206–214   `lastAutoSelectAt`, `markAutoSelect()`, `isRecentAutoSelect()` using
 *            `android.os.SystemClock.uptimeMillis()` → `performance.now()` (the web
 *            monotonic clock) — documented adaptation.
 *  216–229   `registerItem(key, c)` + the ⚠️ KDoc about LazyGrid slot reuse → takes a
 *            plain `Rect | null` instead of `LayoutCoordinates`.
 *  231–233   `itemBoundsModifier(key)` → `itemRectOf(key)` (React reads the registry
 *            in render instead of attaching a modifier).
 *  235–237   `coverBoundsModifier(key)` → `coverRectOf(key)`.
 *  239–243   `dropTargetModifier(id)` → `targetRectOf(id)`.
 *  245–268   `pruneGeometry(aliveItems, aliveTargets)` + the long ⚠️ KDoc about ghost
 *            hit-zones → same.
 *  270–278   `var aliveKeys` + the KDoc ("命中测试在这里**当场**过滤") → same.
 *  280–289   `hitTestItem(root)` (cache then `fallbackHit`) → same.
 *  291–292   `var fallbackHit: ((Offset) -> String?)?` → same.
 *  294–297   `targetRect(id)` / `itemRect(key)` / `coverRect(key)` → same.
 *  299–318   `select` / `unselect` / `toggle` + their ⚠️ KDoc blocks → same.
 *  320–333   `enterSelection(key)` + the ⚠️ KDoc ("BROWSE → SELECTING 的唯一入口")
 *            → same.
 *  335–346   `selectAll(keys)` + KDoc → same.
 *  348–352   `slideAcross(key)` → same.
 *  354–369   `exitSelection()` → same.
 *  371–379   `beginDrag(picked, at)` → same.
 *  381–428   `moveDrag(at, hostTop, hostBottom, hostOffset, density)` — the root/host
 *            coordinate unification ⚠️, the hysteresis `kept` branch, the edge-scroll
 *            band, and the ghost-tilt EMA `(tilt * 0.7 + (dx / (18*density)) * 0.3)`
 *            clamped to ±14 → same.
 *  430–443   `endDrag(): Pair<String?, List<String>>` → same (returns a tuple array).
 *  445–455   `cancelDrag()` → same.
 *  457–460   `beginReturnFlight(items)` → same.
 *  462–465   `endReturnFlight()` → same.
 *  467–470   `internal fun setPressed(key)` → `setPressed` (public in TS so the host can
 *            call it from the gesture loop).
 *  473–474   `@Composable fun rememberShelfSelectionState() = remember { ShelfSelectionState() }`
 *            → `createShelfSelectionState()` factory (instantiation is the host's job).
 *  476–489   the `DropSink` doc-comment block (duplicated KDoc above the class) →
 *            carried on `DropSink`; the stray empty doc comment at L476–479 with no
 *            declaration is a Kotlin authoring artifact and is not reproduced.
 *  490–497   `class ShelfGestureSink` + the ⚠️ KDoc ("手势循环会一直用第一次组合那一版
 *            闭包") → same; the ⚠️ is why the host re-assigns every field each render.
 *  499–509   `class DropSink` with `internal var onDrop` + `emit` → same.
 *  511–529   the `shelfGestures` KDoc (three root causes of "长按没反应", the
 *            `CancellationException` widening) → moved verbatim to the host file where
 *            the gesture loop now lives; the last paragraph's `@param` list is kept
 *            here on `ShelfGestureSink` for traceability.
 *  530–669   `internal fun Modifier.shelfGestures(...)` → `@ui/components/shelf/
 *            ShelfSelectionHost.tsx` `useShelfGestures` (pointer events instead of
 *            `pointerInput` coroutines). Every constant, threshold and ordering is
 *            preserved there.
 *
 * Skipped: nothing. `Offset.Unspecified` → `null`; `Offset.Zero` → `{x:0,y:0}`;
 * `SystemClock.uptimeMillis()` → `performance.now()`; `@Composable remember` → a
 * plain factory. The `.forEach`-style `Rect` helpers are plain object literals.
 */

export const SHELF_KEY_FAV_PREFIX = 'fav::';
export const DROP_TARGET_FAVORITE = 'drop::favorite';
export const DROP_TARGET_NEW = 'drop::new';
export const DROP_PREFIX_FAV_CATEGORY = 'drop::favcat::';

export function dropTargetOfCategory(name: string): string {
  return `drop::cat::${name}`;
}

export function dropTargetOfFavoriteCategory(name: string): string {
  return `${DROP_PREFIX_FAV_CATEGORY}${name}`;
}

export function favShelfKey(itemKey: string): string {
  return `${SHELF_KEY_FAV_PREFIX}${itemKey}`;
}

export function isFavShelfKey(key: string): boolean {
  return key.startsWith(SHELF_KEY_FAV_PREFIX);
}

/** `androidx.compose.ui.geometry.Offset` in JS. `null` stands in for `Offset.Unspecified`. */
export interface ShelfOffset {
  x: number;
  y: number;
}

/** `androidx.compose.ui.geometry.Rect` in JS. */
export interface ShelfRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function offset(x: number, y: number): ShelfOffset {
  return { x, y };
}

export function rectContains(r: ShelfRect, point: ShelfOffset): boolean {
  return point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
}

export function rectCenter(r: ShelfRect): ShelfOffset {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

export function rectSize(r: ShelfRect): { width: number; height: number } {
  return { width: r.right - r.left, height: r.bottom - r.top };
}

export function translateRect(r: ShelfRect, dx: number, dy: number): ShelfRect {
  return { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy };
}

export function rectsEqual(a: ShelfRect, b: ShelfRect): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

/**
 * 书架手势状态机（设计稿 §3.1）：
 *
 * ```
 * 浏览态 --长按350ms--> 多选态 --点击--> 切换选中
 *    |                    |--长按未选中--> 选中并继续滑动连选
 *    |                    |--长按已选中250ms--> 拖拽态
 * 拖拽态 --松手有效--> 放置动画 + 执行 + 撤销 Snackbar
 *       --松手无效--> 弹簧回弹，保持选中
 * ```
 * 纯状态、无 Android 依赖，可单测；动画与业务逻辑分离（UI 只读状态）。
 */
export const ShelfPhase = {
  BROWSE: 'BROWSE',
  SELECTING: 'SELECTING',
  DRAGGING: 'DRAGGING',
} as const;

export type ShelfPhaseCode = (typeof ShelfPhase)[keyof typeof ShelfPhase];

/**
 * 本次多选名单属于哪个板块。
 *
 * 用户明确要求：「我的书架」和「我喜欢的」是**完全独立**的两个栏目，
 * 多选名单绝不能混在一起（原来顶部「已选择 N 本」会把两边相加，
 * 底部操作栏还得写一堆"混选"分支来兜）。
 *
 * 进入多选时由**第一个被长按的条目**决定本次归属；之后所有会改动名单的手势，
 * 都必须先过 [ShelfSelectionState.accepts]，另一板块的卡片一律不受理。
 */
export const ShelfSelectionScope = {
  BOOK: 'BOOK',
  FAV: 'FAV',
} as const;

export type ShelfSelectionScopeCode =
  (typeof ShelfSelectionScope)[keyof typeof ShelfSelectionScope];

/** 落点迟滞（dp）：已高亮的胶囊要移出这么多才肯让位 — Kotlin L135 */
export const HYSTERESIS = 12;
/** 边缘自动滚动的感应带宽度（dp） — Kotlin L138 */
export const EDGE_BAND_DP = 96;

/** 长按进入多选 — AppMotion.LONG_PRESS_MS */
export const LONG_PRESS_MS = 350;
/** 多选态下再次长按"已选中"的书 → 拿起 — AppMotion.PICK_UP_MS */
export const PICK_UP_MS = 250;
/** `isRecentAutoSelect()` 的 500L 窗口 — Kotlin L214 */
export const AUTO_SELECT_GUARD_MS = 500;

export interface DropEmitArgs {
  target: string | null;
  items: string[];
  release: ShelfOffset;
}

/**
 * 手势回调水槽。
 *
 * ⚠️ `Modifier.pointerInput` 的协程**只在 key 变化时重启**，而它捕获的 lambda 是
 * 组合时那一刻的闭包 —— 不这样"每次组合把最新回调换进来"，手势循环会一直用
 * 第一次组合那一版闭包。后果（用户报的「移动到新分类后就打不开书、也选不中」）：
 * onTap 里持有的 sortedBooks 还是**旧分类**的书单，命中到的书在旧书单里找不到
 * ⇒ 点了完全没反应；长按选中的也是一个空壳 key。
 * 和 [DropSink] 一个套路：Modifier 内不是可组合作用域，靠这个稳定对象带进去。
 *
 * `@param hostOffset 宿主在窗口中的位置（把局部坐标换算成 root 坐标做命中测试）`
 * `@param onTap 短按（未超时、未移动超 slop）且命中条目时回调`
 */
export interface ShelfGestureSinkLike {
  hostOffset: () => ShelfOffset;
  hostTop: () => number;
  hostBottom: () => number;
  enabled: () => boolean;
  haptic: (kind: 'SELECTION' | 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'SUCCESS') => void;
  onTap: (key: string) => void;
}

export class ShelfGestureSink implements ShelfGestureSinkLike {
  hostOffset: () => ShelfOffset = () => offset(0, 0);
  hostTop: () => number = () => 0;
  hostBottom: () => number = () => 0;
  enabled: () => boolean = () => true;
  haptic: (kind: 'SELECTION' | 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'SUCCESS') => void = () => {};
  onTap: (key: string) => void = () => {};
}

/** 放置结果的落点水槽 — Kotlin L499–509 */
export class DropSink {
  /**
   * @param target 命中的放置目标（null = 落在无效区域，要回弹归位）
   * @param items 被拖起的条目
   * @param release 松手瞬间手指在宿主内的坐标（动画从这一点起飞）
   */
  onDrop: ((target: string | null, items: string[], release: ShelfOffset) => void) | null = null;

  emit(target: string | null, items: string[], release: ShelfOffset): void {
    this.onDrop?.(target, items, release);
  }
}

export type ShelfStateListener = (state: ShelfSelectionState) => void;

export class ShelfSelectionState {
  /** 当前阶段 */
  phase: ShelfPhaseCode = ShelfPhase.BROWSE;

  /**
   * 本次多选名单的归属板块；`null` = 还没进入多选（浏览态）。
   *
   * 由 [enterSelection] 依据第一个被长按的 key 的前缀设定，[exitSelection] 清空。
   * 定下来之后名单就"锁"在单一板块里，见 [accepts]。
   */
  scope: ShelfSelectionScopeCode | null = null;

  /** 已选中的条目 key */
  selected: ReadonlySet<string> = new Set<string>();

  /** 正在被拖拽的 key（被长按的那本在最上层） */
  dragging: string[] = [];

  /**
   * 正在「飞回原位」的 key。
   *
   * ⚠️ 松手那一瞬间 `dragging` 就清空了，而幽灵卡还要飞 ~560ms 才落位。
   * 只按 dragging 判定可见性的话，真实卡片会在松手瞬间就浮现出来 ——
   * 于是屏幕上同时出现「原位已经站好的书」和「还在半空飞的书」，
   * 而且两者位置不一样，看着像有两个副本。
   * 所以归位飞行期间真实卡片必须继续藏着，等幽灵卡落位、两者完全重合再显示。
   */
  flyingHome: ReadonlySet<string> = new Set<string>();

  /** 松手瞬间幽灵卡的倾角，交给飞行动画做起始值（否则起飞会"啪"地摆正一下） */
  ghostTilt = 0;

  /** 手指位置（宿主局部坐标）；`null` = `Offset.Unspecified` */
  pointer: ShelfOffset | null = null;

  /** 当前悬停的放置目标 id */
  hoverTarget: string | null = null;

  /** 边缘自动滚动速度（px / 帧；由宿主用 effect 驱动 scrollBy） */
  edgeScroll = 0;

  /**
   * 手指正按在哪一条上（仅用于按压视觉）。
   * 手势已全部收归宿主：条目自己不再挂 pointerInput，
   * 由宿主在 down 时命中、抬手/取消时清空。
   */
  pressedKey: string | null = null;

  /**
   * 当前**真实存在**的条目 key 名单（由宿主按数据注入）。
   *
   * 命中测试在这里**当场**过滤，而不是只靠后台裁剪：
   * 裁剪是 LaunchedEffect，总要等到下一帧才跑；在那一帧里手指点下去，
   * 命中的就还是那个已经不存在的旧 key —— 表现就是「点不动、选不中」。
   * 名单为空（还没注入）时不拦截，退回旧行为，避免把整页手势打死。
   */
  /**
   * ⚠️ ADAPTATION: React 禁止在渲染期改写外部对象，因此 Kotlin L270–292 里
   * `state.aliveKeys = aliveKeys` / `state.fallbackHit = fallbackHit` 这两行
   * 不再挂在状态机上，而是作为 [hitTestItem] 的**参数**传入。
   * 这比 Kotlin 的写法更严格：「当场过滤」现在对每一次命中都成立，
   * 不存在"等下一帧才生效"的窗口 —— KDoc 里担心的
   * 「点下去命中已消失的旧 key」这一帧窗口被彻底消掉。
   */

  /**
   * 上一次命中的落点（迟滞用）。
   *
   * 手指停在两个胶囊的缝隙或边缘上时，逐事件的微小抖动会让高亮来回闪。
   * 已经命中的目标给它一点"粘性"：要移出矩形外 [HYSTERESIS] 才算真的离开。
   */
  private lastHoverId: string | null = null;

  /** 上一次的手指横坐标（算跟手倾角的速度用） */
  private lastDragX = 0;

  /** 清掉所有拖拽期的临时判定状态 */
  private resetDragHitState(): void {
    this.lastHoverId = null;
  }

  /** 条目几何（宿主局部坐标） */
  private readonly itemRects = new Map<string, ShelfRect>();
  /**
   * **封面**几何（宿主局部坐标）。
   *
   * 归位动画必须用这个而不是 [itemRects]：itemRects 登记的是整张卡（封面 + 间距 + 书名），
   * 它的中心比封面中心低；而跟手的幽灵卡画的是封面，两者差半张封面左右 ——
   * 表现就是"归位落点明显偏低，动画结束瞬间书从下面瞬移到上面"。
   *
   * 另外幽灵卡尺寸也必须取自这里（真实封面尺寸随列数变化），
   * 写死 104x132dp 在 4/5/6 列机型上会与真实封面差一圈。
   */
  private readonly coverRects = new Map<string, ShelfRect>();
  /** 放置目标几何（分类 Chip / ♡） */
  private readonly targetRects = new Map<string, ShelfRect>();

  /** 滑动连选已"划过"的条目（滑回可取消） */
  private readonly slideVisited = new Set<string>();

  /**
   * 本次多选的**锚点**（长按选中的那一本）。
   *
   * 为什么需要它：长按选中 A 后手指仍按住，只要微动一下跟踪循环就会再次命中 A，
   * 而 A 已在 slideVisited 里 → slideAcross 判定"滑回来了" → 把 A **取消选中**。
   * 用户看到的就是"长按明明选中了，下一瞬又没了"，而且时有时无（取决于手指动没动）。
   * 锚点不允许被滑回取消 —— 要取消就抬手再点，或者点 ✕ 退出。
   */
  private anchorKey: string | null = null;

  /**
   * 滑动连选**上一次命中**的条目（边缘触发用）。
   *
   * 锚点保护只救得了第一本：手指划到第二本 B 后停在它上面，轻微抖动的每个
   * move 事件都会再次命中 B —— 电平触发的 slideAcross 会把 B 在"选中/取消"
   * 之间来回切（用户报的"第二本一直在选中和未选中之间跳跃闪烁"）。
   * 连选必须只在命中条目**变化**时切换（见宿主跟踪循环），这个字段就是
   * 上一次命中的记录：进入多选时置为锚点，退出时清空。
   */
  lastSlideKey: string | null = null;

  /** 最近一次由长按自动选中的时刻（条目自身的 onClick 要忽略紧随其后的 up，避免二次反选） */
  private lastAutoSelectAt = 0;

  private readonly listeners = new Set<ShelfStateListener>();

  /** Change notification (Compose `mutableStateOf` read-tracking → explicit subscribe). */
  subscribe(listener: ShelfStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener(this);
  }

  /** 由 key 前缀判定它属于哪个板块（`fav::` → 收藏，其余 → 书架）。 */
  private scopeOf(key: string): ShelfSelectionScopeCode {
    return isFavShelfKey(key) ? ShelfSelectionScope.FAV : ShelfSelectionScope.BOOK;
  }

  /**
   * 这个 key 能不能进本次名单。
   *
   * 浏览态（[scope] == null）一律放行 —— 还没定板块；
   * 一旦定了板块，就只收本板块的 key。这就是「两个栏目完全独立」的落点：
   * 在书架里长按进入多选后，点/划到「我喜欢的」的卡片会被挡在这里，
   * 名单里永远只有一种 key。
   */
  accepts(key: string): boolean {
    switch (this.scope) {
      case null:
        return true;
      case ShelfSelectionScope.FAV:
        return isFavShelfKey(key);
      case ShelfSelectionScope.BOOK:
        return !isFavShelfKey(key);
      default:
        return true;
    }
  }

  /**
   * 登记（或补登记）一张卡片的矩形。
   *
   * ⚠️ 为什么需要"补登记"：`onGloballyPositioned` 只在**布置**时回调，
   * 而 LazyGrid 会**复用槽位** —— 切换分类时，0 号槽位原来放的是 A 书，
   * 现在放 B 书，位置**一模一样** ⇒ 没有布置变化 ⇒ 回调**根本不触发**
   * ⇒ B 的矩形永远没登记 ⇒ 点它没反应、长按也选不中（用户报的「打不开书籍、
   * 而且选中不了」就是这条）。所以每次组合都要用上一次布置得到的坐标补登一次。
   */
  registerItem(key: string, r: ShelfRect | null): void {
    if (r === null) return;
    this.itemRects.set(key, r);
  }

  itemRectOf(key: string): ShelfRect | null {
    return this.itemRects.get(key) ?? null;
  }

  /** 封面专用几何登记（归位动画的落点依据） */
  registerCover(key: string, r: ShelfRect | null): void {
    if (r === null) return;
    this.coverRects.set(key, r);
  }

  coverRectOf(key: string): ShelfRect | null {
    return this.coverRects.get(key) ?? null;
  }

  registerDropTarget(id: string, r: ShelfRect | null): void {
    if (r === null) return;
    this.targetRects.set(id, r);
  }

  targetRectOf(id: string): ShelfRect | null {
    return this.targetRects.get(id) ?? null;
  }

  /**
   * 按"当前**真实存在**的条目 / 落点"裁剪三张几何表。
   *
   * ⚠️ 这是必须的：`onGloballyPositioned` 只有布置回调、**没有** dispose 回调，
   * 条目从列表里消失（比如被移动到别的分类）后，它的矩形会**永久留在表里**。
   * 于是那块区域变成一个"幽灵热区"：
   *  - 点它 → [hitTestItem] 返回一个已经不存在的 key → 业务层找不到这本书
   *    → 点了完全没反应（用户：「移动后无法点进去」）；
   *  - 列表重排后后面的书填补上来，真实矩形与幽灵矩形重叠，而 [hitTestItem] 用
   *    `firstOrNull` 按 HashMap 的**不确定**迭代顺序取 → 时中时不中
   *    （用户：「无法长按其他书后点击它选中」）；
   *  - 更糟的是落点表：删掉的分类/改名的分类矩形还在，手指划过那块**空白**会命中
   *    一个不存在的分类名 → 书被写上这个分类 → 在**任何**分类里都看不到
   *    （用户：「一些书莫名其妙找不到」）。
   *
   * 所以每次数据变化后都要按真实集合裁剪一遍。滚出屏幕的条目不受影响：
   * 它的 key 仍在 aliveItems 里，滚回来时 onGloballyPositioned 会重新登记。
   */
  pruneGeometry(aliveItems: ReadonlySet<string>, aliveTargets: ReadonlySet<string>): void {
    for (const key of [...this.itemRects.keys()]) {
      if (!aliveItems.has(key)) this.itemRects.delete(key);
    }
    for (const key of [...this.coverRects.keys()]) {
      if (!aliveItems.has(key)) this.coverRects.delete(key);
    }
    for (const id of [...this.targetRects.keys()]) {
      if (!aliveTargets.has(id)) this.targetRects.delete(id);
    }
  }

  /**
   * Kotlin L280–289 `fun hitTestItem(root: Offset): String?`.
   *
   * ⚠️ `aliveKeys` / `fallbackHit` are explicit parameters here — see the note on
   * the removed `aliveKeys` field (React forbids mutating the state object during
   * render, and parameterising them also removes the one-frame staleness window).
   */
  hitTestItem(
    root: ShelfOffset,
    aliveKeys: ReadonlySet<string>,
    fallbackHit: ((point: ShelfOffset) => string | null) | null,
  ): string | null {
    const alive = aliveKeys;
    for (const [k, r] of this.itemRects) {
      if ((alive.size === 0 || alive.has(k)) && rectContains(r, root)) return k;
    }
    // 缓存没命中（卡片换了 key、坐标回调还没补上）→ 直接问列表要答案
    const fb = fallbackHit?.(root);
    if (fb == null) return null;
    return alive.size === 0 || alive.has(fb) ? fb : null;
  }

  targetRect(id: string): ShelfRect | null {
    return this.targetRects.get(id) ?? null;
  }
  itemRect(key: string): ShelfRect | null {
    return this.itemRects.get(key) ?? null;
  }
  /** 封面矩形（root 坐标）；没有登记过就退回整卡矩形 */
  coverRect(key: string): ShelfRect | null {
    return this.coverRects.get(key) ?? this.itemRects.get(key) ?? null;
  }

  /* ─── 状态迁移 ─── */

  select(key: string): void {
    // 最后一道闸：另一板块的 key 一律不收。
    // 手势层（宿主的点击/长按/滑动连选）已各自判过一遍，这里是兜底 ——
    // 以后新增任何手势路径也不会把两个栏目的名单混起来。
    if (!this.accepts(key)) return;
    this.selected = new Set([...this.selected, key]);
    this.slideVisited.add(key);
    this.notify();
  }

  unselect(key: string): void {
    // 取消选中不加闸门：无论如何都要能把自己已选的东西摘掉
    const next = new Set(this.selected);
    next.delete(key);
    this.selected = next;
    this.slideVisited.delete(key);
    this.notify();
  }

  toggle(key: string): void {
    if (this.selected.has(key)) this.unselect(key);
    else this.select(key);
  }

  /** 长按第一本：进入多选态，它同时是本次的锚点（不允许被滑回取消，见 [anchorKey]） */
  enterSelection(key: string): void {
    this.phase = ShelfPhase.SELECTING;
    // ⚠️ 这里是「BROWSE → SELECTING」的唯一入口，也是**唯一**给本次多选定板块的地方：
    // 在书架里长按 → 本次只选书；在「我喜欢的」里长按 → 本次只选收藏。
    // 之后 [accepts] 就按这个 scope 把另一板块的卡片全部挡在名单外。
    this.scope = this.scopeOf(key);
    this.selected = new Set([key]);
    this.slideVisited.clear();
    this.slideVisited.add(key);
    this.anchorKey = key;
    this.lastSlideKey = key;
    this.pressedKey = null;
    this.notify();
  }

  /** 「全选」：把传进来的这一批都选上（书架/收藏各自调用，互不干涉） */
  selectAll(keys: ReadonlyArray<string>): void {
    if (this.phase === ShelfPhase.BROWSE) this.phase = ShelfPhase.SELECTING;
    // 保险：理论上到不了（顶栏只在多选态可见，那时 scope 已定），
    // 但万一被别处调用，就用这批 key 补定一个板块，而不是放行混选。
    if (this.scope === null) {
      const first = keys[0];
      if (first !== undefined) this.scope = this.scopeOf(first);
    }
    // 按板块过滤后再并入：即使调用方把两边的 key 混着传进来，名单也只会收本板块的。
    const accepted = keys.filter((k) => this.accepts(k));
    this.selected = new Set([...this.selected, ...accepted]);
    for (const k of accepted) this.slideVisited.add(k);
    if (this.anchorKey === null) this.anchorKey = accepted[0] ?? null;
    this.notify();
  }

  /** 滑动连选：划过就选中，滑回来就取消；锚点不参与 */
  slideAcross(key: string): void {
    if (key === this.anchorKey) return;
    if (this.slideVisited.has(key)) this.unselect(key);
    else this.select(key);
  }

  exitSelection(): void {
    this.phase = ShelfPhase.BROWSE;
    this.selected = new Set<string>();
    this.dragging = [];
    this.slideVisited.clear();
    this.anchorKey = null;
    this.lastSlideKey = null;
    this.hoverTarget = null;
    this.edgeScroll = 0;
    this.resetDragHitState();
    this.flyingHome = new Set<string>();
    this.pointer = null;
    this.pressedKey = null;
    // 退出多选 → 板块归属一并清空，下次长按重新按第一个条目定
    this.scope = null;
    this.notify();
  }

  /** 拿起：被长按的那本放最上层，其余选中的跟着一起飞 */
  beginDrag(picked: string, at: ShelfOffset): void {
    // 被长按的那本放最上层
    const rest = [...this.selected].filter((it) => it !== picked);
    this.dragging = [picked, ...rest];
    this.pointer = at;
    this.resetDragHitState();
    this.phase = ShelfPhase.DRAGGING;
    this.notify();
  }

  moveDrag(
    at: ShelfOffset,
    hostTop: number,
    hostBottom: number,
    hostOffset: ShelfOffset = offset(0, 0),
    density = 1,
  ): void {
    this.pointer = at;
    // 一切判定统一到 root 坐标：
    // targetRects 是用 positionInRoot() 登记的，hostTop/hostBottom 也是 root 的，
    // 而手指的 at 是宿主局部坐标 —— 三者混算会整体偏一个宿主位移量。
    const root = offset(at.x + hostOffset.x, at.y + hostOffset.y);

    // 落点命中（带迟滞：已经高亮的那个，要移出它外扩 HYSTERESIS 的范围才肯让位，
    // 否则手指停在两个胶囊的缝隙上会来回闪）
    const hit = this.pickTarget(root, hostTop, hostBottom);
    let kept: string | null = null;
    if (hit === null && this.lastHoverId !== null) {
      const r = this.targetRects.get(this.lastHoverId);
      const pad = HYSTERESIS * density;
      if (
        r !== undefined &&
        root.x >= r.left - pad &&
        root.x <= r.right + pad &&
        root.y >= r.top - pad &&
        root.y <= r.bottom + pad
      ) {
        kept = this.lastHoverId;
      }
    }
    const now = hit ?? kept;
    if (now !== this.lastHoverId) this.lastHoverId = now;
    this.hoverTarget = now;

    // 边缘自动滚动：靠近上下边缘时给一个 px/帧 的速度，由宿主的 effect 驱动
    const edge = EDGE_BAND_DP * density;
    const speed = 16 * density;
    const rootY = root.y;
    if (rootY < hostTop + edge) this.edgeScroll = -speed;
    else if (rootY > hostBottom - edge) this.edgeScroll = speed;
    else this.edgeScroll = 0;

    // 跟手倾角：横向移动越快歪得越多，松手时作为飞行动画的起始值
    const dx = at.x - this.lastDragX;
    this.lastDragX = at.x;
    this.ghostTilt = Math.max(
      -14,
      Math.min(14, this.ghostTilt * 0.7 + (dx / (18 * density)) * 0.3),
    );
    this.notify();
  }

  /**
   * 落点命中（root 坐标）。
   *
   * ⚠️ 除了"手指在矩形里"，还必须要求这个胶囊**完整可见**
   * （[Rect.top] 不低于宿主顶、[Rect.bottom] 不超出宿主底）。
   * 只校验中心点的话，滚到一半、只从顶/底露出半截的胶囊也会被命中 ——
   * 手指明明停在空白处，却触发了分类（用户：「有时候拖动会触发页面上下滑动 /
   * 手指不是刚好在分类之上也触发了」）。
   */
  private pickTarget(root: ShelfOffset, hostTop: number, hostBottom: number): string | null {
    let hitRect: ShelfRect | null = null;
    for (const r of this.targetRects.values()) {
      if (rectContains(r, root) && r.top >= hostTop && r.bottom <= hostBottom) {
        hitRect = r;
        break;
      }
    }
    if (hitRect === null) return null;
    for (const [key, r] of this.targetRects) {
      if (rectsEqual(r, hitRect)) return key;
    }
    return null;
  }

  /** 松手：交出（命中的落点, 被拖起的条目）并回到多选态（选中保留） */
  endDrag(): [string | null, string[]] {
    const target = this.hoverTarget;
    const items = this.dragging;
    this.dragging = [];
    this.hoverTarget = null;
    this.lastHoverId = null;
    this.edgeScroll = 0;
    this.ghostTilt = 0;
    this.lastDragX = 0;
    this.phase = ShelfPhase.SELECTING;
    this.pointer = null;
    this.notify();
    return [target, items];
  }

  /** 取消拖拽（返回键 / 手势被抢）：不落到任何地方，由调用方决定怎么归位 */
  cancelDrag(): void {
    this.dragging = [];
    this.hoverTarget = null;
    this.lastHoverId = null;
    this.edgeScroll = 0;
    this.ghostTilt = 0;
    this.lastDragX = 0;
    this.phase = ShelfPhase.SELECTING;
    this.pointer = null;
    this.notify();
  }

  /** 归位飞行开始：这些条目在落位前必须保持隐藏 */
  beginReturnFlight(items: ReadonlyArray<string>): void {
    this.flyingHome = new Set(items);
    this.notify();
  }

  /** 归位飞行结束：幽灵卡与真实卡片此刻完全重合，可以交班了 */
  endReturnFlight(): void {
    this.flyingHome = new Set<string>();
    this.notify();
  }

  /** 宿主在 down/up 时维护按压态（条目自身不再处理手势） */
  setPressed(key: string | null): void {
    this.pressedKey = key;
    this.notify();
  }

  /**
   * DragStack 的倾角回写（Kotlin `SideEffect { state.ghostTilt = tilt }`, L1091）：
   * 把当前倾角交回状态机，松手后的飞行动画要接住这个角度当起始值，
   * 否则幽灵卡会在起飞那一刻硬生生摆正一下。
   */
  setGhostTiltAnimated(tilt: number): void {
    this.ghostTilt = tilt;
    this.notify();
  }

  /**
   * 滑动连选**上一次命中**的写入（Kotlin 里 `state.lastSlideKey = hit` 是 internal
   * setter，宿主直接赋值）。React 禁止在渲染期改写外部对象，而这里发生在一个
   * 指针事件回调里 —— 通过方法写入让变更显式化，也与 Kotlin 的 internal setter
   * 语义一一对应。
   */
  setLastSlideKey(key: string | null): void {
    this.lastSlideKey = key;
  }

  markAutoSelect(): void {
    // ⚠️ ADAPTATION: `android.os.SystemClock.uptimeMillis()` → `performance.now()`.
    this.lastAutoSelectAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  isRecentAutoSelect(): boolean {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return now - this.lastAutoSelectAt < AUTO_SELECT_GUARD_MS;
  }
}

/** `@Composable fun rememberShelfSelectionState()` — Kotlin L473–474. */
export function createShelfSelectionState(): ShelfSelectionState {
  return new ShelfSelectionState();
}
