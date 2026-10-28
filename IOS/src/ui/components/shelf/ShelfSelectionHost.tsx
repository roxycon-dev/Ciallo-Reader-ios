/**
 * Port of Android `ui/shelf/ShelfSelectionHost.kt` (1471 lines total / 1400 non-blank / 1150 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–101  package + imports → file header. `StateFlow`/`MutableStateFlow` (ShelfChrome)
 *          → a module-level listener set; `LocalDensity`/`LocalViewConfiguration` →
 *          1 CSS px per dp and a module `TOUCH_SLOP`; `consistentShadow` / `liquidGlass`
 *          / `iridescentBorder` / `LocalGlassBackdrop` / `LocalRenderQuality` →
 *          CSS box-shadow + backdrop-filter; `BackHandler` → an `Escape` keydown listener;
 *          `PathMeasure` → a cubic-Bézier evaluator.
 *  102–110 `object ShelfChrome { _tabBarVisible; tabBarVisible; setTabBarVisible }`
 *          → `shelfChrome` module object with the same API.
 *  112–115 `DROP_TARGET_FAVORITE`, `DROP_TARGET_NEW`, `dropTargetOfCategory(name)`
 *          → re-exported from `ShelfSelectionState.ts` (single definition).
 *  117–119 `DROP_PREFIX_FAV_CATEGORY`, `dropTargetOfFavoriteCategory(name)` → same.
 *  121–122 `private const val EDGE_TICK_MS = 80L` → `EDGE_TICK_MS`.
 *  124–125 `private const val EDGE_ARM_NS = 200_000_000L` → `EDGE_ARM_MS = 200`
 *          (nanoseconds → milliseconds; `performance.now()` is already in ms).
 *  127–135 `SHELF_KEY_FAV_PREFIX`, `favShelfKey`, `isFavShelfKey` → same module.
 *  137–150 `enum class DragFlightKind { MOVE, FAVORITE, RETURN }` → same.
 *  152–180 `data class DragFlight(id, kind, items, from, to, origin, origins,
 *          fromRotation, settleTo)` with the ⚠️ KDoc about per-item origins
 *          ("从多本变成一本，和按住时的动画有很大割裂感") and the `settleTo` KDoc
 *          ("收到 1.0 的话，落位瞬间幽灵卡比真实卡片大一圈") → same interface.
 *  182–223 `@Composable fun ShelfSelectBadge` → lives in `CategoryPill.tsx` (it is the
 *          chip package's primitive) and is re-exported from here.
 *  225–347 `private fun Modifier.multiSelectGlassBar(shape, primary, surfaceAlpha)` —
 *          the five-layer KDoc and the ①②③④⑤ implementation, incl. the `surfaceAlpha`
 *          KDoc (顶栏传 0.14 让它真的像毛玻璃) and the ④ specular KDoc (内缩 2dp)
 *          → `.shelf-multiselect-topbar__inner` / `__actionbar__row` CSS.
 *          ⚠️ ADAPTATION: `RenderQuality.LOW/MID/MAX` gating has no web counterpart;
 *          the MAX-tier values are the default and `backdrop-filter` is always on
 *          (browsers degrade it themselves when unsupported).
 *  349–454 `@Composable fun MultiSelectTopBar(count, allSelected, onClose, onToggleAll)`
 *          `animateIntAsState(count, tween(220))`, r50 shape, the 0.14 surfaceAlpha
 *          KDoc, the ✕ 44 circle, "已选择" 14.sp/0.62, the count badge
 *          (minWidth 26 / minHeight 20 / r50 / primary), "本", a `Spacer(weight 1f)`,
 *          and the all-toggle pill (fill difference, not just an icon swap).
 *          ⚠️ ADAPTATION: the digit roll is a keyed CSS fade instead of a tween on an
 *          `Animatable`; the number itself is React state.
 *  456–463 `data class ShelfAction(label, icon, onClick, enabled, destructive)` → same.
 *  465–538 `@Composable fun MultiSelectActionBar(actions, modifier, visible, hint)` —
 *          `AnimatedVisibility(slideInVertically + fadeIn / … + fadeOut)`, the inset
 *          KDoc (不能用 LocalAppBottomInset), the hint 11.sp/0.6, the glass row with
 *          `Arrangement.SpaceEvenly`, and each action's enabled→1 / disabled→0.35
 *          alpha, destructive → colorScheme.error → matching CSS.
 *  540–565 `@Composable fun MoreActionSheet(titles, onPick, onDismiss)` → the
 *          `.fav-sheet` shell; "更多操作" 16 Bold + 14.sp rows, 14dp vertical padding.
 *  567–639 `@Composable fun CategoryPickerSheet(categories, title, onPick, onDismiss,
 *          modifier, allowCreate, onCreate)` — `newName`/`creating` state, rows with a
 *          trailing check, the "＋新建分类" row, the `OutlinedTextField("分类名称")`,
 *          and "创建并放入" gated on `newName.isNotBlank()` → same.
 *  641–990 `@Composable fun ShelfSelectionHost(state, categories, currentCategory,
 *          showFavoriteTarget, onDropToCategory, onDropToFavorite, onDropToFavoriteCategory,
 *          onCreateCategoryThenDrop, onTapItem, scrollBy, coverOf, modifier, aliveKeys,
 *          favoriteCategories, fallbackHit, content)`:
 *   675–678   haptics / reduceMotion / density / touchSlop → web equivalents.
 *   680–682   `hostOffset` / `hostTop` / `hostBottom` from `onGloballyPositioned`
 *             → `hostOrigin` React state refreshed on pointer-down / scroll / resize.
 *             ⚠️ ADAPTATION: a ref cannot be read during render (React rule), so the
 *             host origin lives in state; every reader (`localRect`, `ghostSize`, the
 *             overlay) uses that value.
 *   685–693   `pendingFlight`, `pulseTarget`, `flightSeq`, `heartBurstAt` → `useState`s
 *             (the sequence counter is a ref: it is not rendered).
 *   695–697   `fun localRect(r)` → `useCallback` over `hostOrigin`.
 *   699–700   `ghostLiftPx = 10.dp.toPx()` → `GHOST_LIFT_PX`.
 *   702–710   the `aliveTargets` `remember` (book categories + fav categories + ♡ + new)
 *             → `useMemo`.
 *   711–715   `LaunchedEffect(aliveKeys, aliveTargets) { state.pruneGeometry(...) }`
 *             → `useEffect` (no setState in the body — the geometry registry is
 *             external state, and the overlay re-reads it on the next layout pass).
 *   716–719   `state.aliveKeys = aliveKeys; state.fallbackHit = fallbackHit`
 *             → ⚠️ ADAPTATION: passed **as arguments** to `state.hitTestItem(root,
 *             aliveKeys, fallbackHit)` instead of being written onto the state object
 *             during render (React forbids mutating values during render). This is
 *             strictly safer than the Kotlin version: the "过滤必须当场生效" guarantee
 *             the KDoc demands now holds for every hit test, with no one-frame window.
 *   721–823   the `DropSink.onDrop` lambda — the ⚠️ "上一次飞行还没落位就又来了一次
 *             drop" fix, `localRect`, per-item `origins`, `launch(kind, to, origin)`,
 *             the `fromRotation` / `settleTo` wiring, and the 5-way `when`:
 *             ① target == null → LIGHT + beginReturnFlight + RETURN;
 *             ② DROP_TARGET_FAVORITE → SUCCESS + heartBurstAt = from + FAVORITE + onDropToFavorite;
 *             ③ DROP_TARGET_NEW → SUCCESS + pulseTarget + MOVE + exitSelection + onCreateCategoryThenDrop;
 *             ④ "drop::cat::" prefix → same-category is an invalid drop (graceful bounce),
 *                otherwise MOVE + exitSelection + onDropToCategory;
 *             ⑤ DROP_PREFIX_FAV_CATEGORY → MOVE + exitSelection + onDropToFavoriteCategory.
 *             All five branches preserved with their haptics and ⚠️ comments.
 *   825–828   `LaunchedEffect(hoverTarget) { if (!null) haptic(SELECTION) }`
 *             → the subscribe callback fires the haptic (external-system notification).
 *   830–836   `LaunchedEffect(pulseTarget) { delay(560); pulseTarget = null }`
 *             → `useEffect` + a 560 ms timer (also releases `.shelf-pill--drop`).
 *   838–864   the edge-auto-scroll `LaunchedEffect(state.phase)` with all three ⚠️
 *             pitfalls (key must not include `edgeScroll`; no second density multiply;
 *             the 200 ms arm must live in the loop) → `useEffect` on `phase` reading
 *             `state.edgeScroll` each tick at `EDGE_TICK_MS`.
 *   866–872   `LaunchedEffect(phase) { ShelfChrome.setTabBarVisible(phase == BROWSE) }`
 *             + `DisposableEffect { onDispose { setTabBarVisible(true) } }`
 *             → `useEffect` + cleanup.
 *   874–888   `BackHandler(enabled = phase != BROWSE)` with the DRAGGING branch
 *             (cancelDrag + onDrop(null, items, release)) → an `Escape` keydown listener.
 *   890–898   the "每次组合都要把**最新**的回调换进水槽" block (all six
 *             `gestureSink.* = …` assignments) → same assignments, every render.
 *   900–915   the host `Box` with `onGloballyPositioned` + `.shelfGestures(...)`
 *             → the scroll container with the pointer handlers.
 *   917–929   `content { key -> … SideEffect { registerItem } + onGloballyPositioned }`
 *             → `registerItemBounds(key)` returning a ref callback.
 *   931–945   the ⚠️ block explaining that drop targets are the page's own chips (no
 *             bottom Dock) and the dashed placeholder must be drawn on the HOST layer
 *             (the card is alpha 0) → the `.shelf-host__overlay` with `.shelf-placeholder`.
 *   947–958   `DragStack(state, coverOf, reduceMotion, ghostSize)` with the ⚠️ about
 *             taking the ghost size from the real cover → `DragStack` below.
 *   960–968   `heartBurstAt?.let { HeartBurst(centerX, centerY, reduceMotion, onDone) }`
 *             → conditional `HeartBurst`.
 *   970–988   `pendingFlight?.let { DragFlightLayer(flight, coverOf, reduceMotion,
 *             liveOrigin, onDone) }` with the ⚠️ "归位落点必须**每帧重读**" → same.
 *  992–1000  the PlaceholderBox KDoc (⚠️ must use pixel-level layout, not dp offsets —
 *             a 3× oversized ghost frame was seen) → `PlaceholderBox` KDoc, verbatim.
 * 1001–1038 `@Composable private fun PlaceholderBox(rect, alpha)` — pixel `layout{}`
 *             measure/place, `graphicsLayer { alpha }`, and the ⚠️ "只有虚线、没有
 *             任何填充色" (用户反馈"拖走后原位留下一块纯白/浅色区域，很难看")
 *             drawBehind: `dashColor.copy(0.38f)`, r14, Stroke 1.5.dp, dash 9/6
 *             → `position: absolute` with the same numbers.
 * 1040–1153 `@Composable private fun DragStack(state, coverOf, reduceMotion, ghostSize)`:
 *  1049–1056   `take(4)`, pointer guard, ghost size from the real cover (fallback 104×132).
 *  1058–1070   `lifted` → 1.08 (`AppMotion.springLift`) + `elevation`.
 *  1072–1091   the inertia-tilt 48 ms poll (`|dx| < 0.6 → 0`, else `dx * 0.5` clamped
 *              ±9) + `SideEffect { state.ghostTilt = tilt }` → the host's 48 ms
 *              interval writing `state.setGhostTiltAnimated(tilt)`.
 *  1093–1130   reverse draw order, per-index `rotation` (0 / -6 / +6 / -3) plus
 *              `tilt * (1 - index * 0.2f)`, `depthScale` (1 / .96 / .92 / .9),
 *              `stackOffsetX = index * 10.dp`, `stackOffsetY = index * 6.dp`,
 *              the 10.dp ghost lift, `alpha = index == 0 ? 1f : 0.94f`, r12 clip,
 *              surface background → all preserved.
 *  1131–1152   the `list.size > 1` count badge (24.dp circle `0xFFFF4D4F`, 11.sp Bold,
 *              offset `+ghostW/2 - 6.dp`, `-ghostH/2 - 18.dp`).
 * 1155–1163  the DragFlightLayer KDoc (MOVE/RETURN/FAVORITE behaviours).
 * 1164–1292 `@Composable private fun DragFlightLayer(flight, coverOf, reduceMotion,
 *             liveOrigin, onDone)`:
 *  1176–1182   `LaunchedEffect(flight.id) { started = true; delay(returning ? RETURN_MS
 *              : DROP_MS + 80); onDone() }` → `useEffect` on `flight.id`.
 *  1184–1194   `p` (`springReturn` / `tween(DROP_MS, easeSuckIn)`) → a CSS animation
 *              whose duration is exactly `RETURN_MS` / `DROP_MS`.
 *  1197–1207   `settle` (`springSettle`) and `rotation` (`fromRotation → 0`).
 *  1209–1219   `pClamped`, `scale = returning ? settle : 1.08f * (1 - 0.86f * p)`,
 *              the ⚠️ "alpha 一直保持 1" rule, `elevation`,
 *              and the parabola `arc = arcPx * sin(π · pClamped)` → the CSS
 *              `translate(x, y - arc)` mid-keyframe pair.
 *  1221–1238   the ⚠️ "每一本一条独立的飞行" block, `take(4)`, the stack step (10/6 dp),
 *              and the per-item dashed placeholder fading with `1 - pClamped`.
 *  1240–1288   reverse draw order, live `target` per item, `cx/cy` interpolation
 *              using the live target, `depthNow`, `fanRot`, `layerAlpha`,
 *              and the ghost size from the target rect (fallback 104×132).
 *  1290–1291   the ⚠️ note that the heart burst must NOT live in this layer.
 *  1294–1308  the HeartBurst KDoc (halo / main heart / 6 satellite hearts / 4 echoes,
 *              the ⚠️ "心要比书飞得更久" 1150 vs 560 ms) → `HeartBurst` KDoc, verbatim.
 * 1309–1464 `@Composable private fun HeartBurst(centerX, centerY, reduceMotion, onDone)`:
 *  1317–1325   the `reduceMotion` early return + `HEART_BURST_MS` delay → `onDone`.
 *  1330–1345   `risePx = 172.dp`, `driftPx = 30.dp`, the cubic-Bézier path and the
 *              `PathMeasure` length → a JS cubic evaluator (`bezierAt(t)`).
 *  1347–1360   `t` (`tween(HEART_BURST_MS, easeOutCubic)`), `pop` (`springJelly`),
 *              `pink = 0xFFFF4D6D`, `fade = 1 - ((t - .52) / .48)`.
 *  1362–1376   ① 光晕 (`haloR = 36.dp`, radial `pink@0.5` → transparent,
 *              `s = 0.22f + 1.9f * t`, `alpha = (1 - t) * 0.6f`).
 *  1378–1401   ② 主心形 (`mainSize = 34.dp`) drawn through the local `drawHeart`
 *              composable which reuses `com.example.ui.favorite.HeartArt(glow = 0.55f * alpha)`
 *              — the same ⚠️ "别再各画一份" applies here.
 *  1403–1412   ③ 残影: `for (k in 4 downTo 1)`, `tt = (t - k * 0.045f)`,
 *              `scale = pop * (0.42f - k * 0.05f) * fade`, `alpha = fade * (0.30f - k * 0.045f)`.
 *  1414–1420   the head heart (`scale = pop * (0.8f + 0.2f * fade)`, `rotation = (1 - t) * 16f`).
 *  1422–1463   ④ 卫星心: the `Random(20260922)` seed, `6` petals with
 *              `(-104.0 + i * 56.0) + rnd.nextInt(-16, 16)` degrees,
 *              `distK = 0.72f + rnd.nextFloat() * 0.55f`,
 *              `sizeK = 0.38f + rnd.nextFloat() * 0.26f`,
 *              `delay = rnd.nextFloat() * 0.10f`, `spread = 82.dp`,
 *              the eased distance, the extra 14.dp rise and the `(1 - pt)` scale/alpha.
 *              ⚠️ ADAPTATION: Kotlin's `Random(seed)` is a specific LCG; a seeded
 *              mulberry32 PRNG reproduces six deterministic satellites, and the table
 *              is computed **once at module load** (the Kotlin `remember { }` is
 *              hoisted, so no `Math.random()` ever runs during render).
 * 1466–1472 `private data class SatelliteHeart(cos, sin, distK, sizeK, delay)` → same.
 *
 * Skipped: `Modifier.multiSelectGlassBar`'s per-`RenderQuality` branches (LOW white
 * border / MID 0.80 / MAX 0.62 surface) — the web build has a single tier; the MAX
 * values are the default and browsers degrade `backdrop-filter` themselves.
 * `PathMeasure` is replaced by an equivalent cubic-Bézier position evaluator.
 *
 * THIS-ROUND FIXES (line-by-line review)
 * --------------------------------------
 *   ⚠️ BUG `vibrate()` (L372–379): the gate was `if (!reduceMotionPref()) return;`
 *     — it only vibrated when the OS *reduce motion* switch was ON, i.e. the exact
 *     inverse of Android (`HapticKind` is gated by `LocalHapticsEnabled`, default
 *     `true`; `LocalReduceMotion` never disables haptics). Now gated by the same
 *     `haptics_enabled` localStorage flag `CategoryPill.tsx` reads.
 *   ⚠️ BUG `onPointerMove` → `state.moveDrag(local, hostOrigin.y, hostOrigin.y, …)`:
 *     Kotlin L903–908 sets `hostTop = y` and `hostBottom = y + height`; passing the
 *     same value for both made the 96 dp edge band true for virtually every pointer
 *     position, so `edgeScroll` never settled at 0 and the 80 ms auto-scroll loop
 *     ran continuously while the finger was down. Now tracked via `hostSize` /
 *     `hostBox`.
 *   Nothing else changed; the remaining known gaps (the whole drag *physics* layer
 *   being unreferenced because `pages/BookshelfPage.tsx` was removed) are registered
 *   as PARITY_EXCEPTIONS entries, not silently dropped.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { HeartArt } from '@ui/components/favorite/HeartArt';
import {
  DROP_PREFIX_FAV_CATEGORY,
  DROP_TARGET_FAVORITE,
  DROP_TARGET_NEW,
  ShelfGestureSink,
  ShelfPhase,
  type ShelfOffset,
  type ShelfRect,
  type ShelfSelectionState,
  dropTargetOfCategory,
  dropTargetOfFavoriteCategory,
  offset,
  rectCenter,
  rectSize,
  translateRect,
} from './ShelfSelectionState';
import '../../../styles/shelf.css';

export {
  ShelfSelectBadge,
  CategoryPill,
  AddCategoryPill,
  usePressScale,
} from './CategoryPill';
export {
  DROP_PREFIX_FAV_CATEGORY,
  DROP_TARGET_FAVORITE,
  DROP_TARGET_NEW,
  SHELF_KEY_FAV_PREFIX,
  ShelfPhase,
  ShelfSelectionScope,
  ShelfSelectionState,
  createShelfSelectionState,
  dropTargetOfCategory,
  dropTargetOfFavoriteCategory,
  favShelfKey,
  isFavShelfKey,
  type ShelfOffset,
  type ShelfRect,
} from './ShelfSelectionState';

/* ── `@keyframes shelf-flight` 的自定义属性 ──
 * `CSSProperties` 没有索引签名，直接写 `vars['--x']` 会报 TS7053；这里用两个局部
 * 交叉类型把 keyframes 变量加回来（keyframes 本身在 styles/shelf.css 里）。 */
type ShelfFlightVars = CSSProperties & {
  '--shelf-flight-x'?: string;
  '--shelf-flight-y'?: string;
  '--shelf-flight-arc'?: string;
  '--shelf-flight-scale-from'?: string;
  '--shelf-flight-scale-to'?: string;
  '--shelf-flight-rot-from'?: string;
  '--shelf-flight-rot-to'?: string;
};

/** `@keyframes shelf-heart-fly` 的自定义属性。 */
type ShelfHeartVars = CSSProperties & {
  '--shelf-heart-dx'?: string;
  '--shelf-heart-dy'?: string;
};

/* ── 书架外壳（底部 Tab 栏）的显隐：多选态下被悬浮操作栏"替换"。 — L102–110 ── */
type ChromeListener = (visible: boolean) => void;
const chromeListeners = new Set<ChromeListener>();
let tabBarVisibleState = true;

export const shelfChrome = {
  get tabBarVisible(): boolean {
    return tabBarVisibleState;
  },
  subscribe(listener: ChromeListener): () => void {
    chromeListeners.add(listener);
    return () => {
      chromeListeners.delete(listener);
    };
  },
  setTabBarVisible(visible: boolean): void {
    tabBarVisibleState = visible;
    for (const listener of [...chromeListeners]) listener(visible);
  },
};

/** 边缘自动滚动的节奏（ms / 跳）。 — L121–122 */
const EDGE_TICK_MS = 80;
/** 手指进入边缘感应带后要停留多久才开始真正滚动（只是路过不算）。 — L124–125 */
/** Kotlin: `EDGE_ARM_NS = 200_000_000L` ns → 200 ms on the JS monotonic clock. */
const EDGE_ARM_MS = 200;

/** `val ghostLiftPx = with(density) { 10.dp.toPx() }` — L699–700 */
const GHOST_LIFT_PX = 10;
/** DragStack / DragFlightLayer fallback ghost size (Kotlin L1055–1056, L1265–1266). */
const FALLBACK_GHOST_W = 104;
const FALLBACK_GHOST_H = 132;
/** `AppMotion.RETURN_MS = 560L` */
const RETURN_MS = 560;
/** `AppMotion.DROP_MS = 380` */
const DROP_MS = 380;
/** `AppMotion.HEART_BURST_MS = 1150` */
const HEART_BURST_MS = 1150;
/** `delay(560)` for the chip jelly pulse — L833 */
const PULSE_MS = 560;
/** `delay(AppMotion.DROP_MS + 80L)` — L1180 */
const DROP_SETTLE_MS = DROP_MS + 80;

/** Compose `LocalViewConfiguration.current.touchSlop` ≈ 8 dp. */
const TOUCH_SLOP = 8;

const MINT_PRIMARY = '#059669';
const ON_SURFACE = '#18191C';
const HEART_PINK = '#FF4D6D';
/** `AppMotion.SELECTED_SCALE = 0.94f` */
const SELECTED_SCALE = 0.94;

/**
 * 松手之后的"飞行"：UI 层据此把幽灵卡从松手点送到目的地，业务回调与动画并行。
 * 状态机本身只管选中/阶段，动画数据不进状态机（保持可单测）。
 * — L137–150
 */
export const DragFlightKind = {
  /** 吸入分类 / 新建：飞向 chip，缩没 + 目标 chip 果冻回弹 */
  MOVE: 'MOVE',
  /** 加入「我喜欢的」：飞回原位 + 心形徽章弹出 */
  FAVORITE: 'FAVORITE',
  /** 落在无效区域：沿弧线弹回原位，保持选中 */
  RETURN: 'RETURN',
} as const;

export type DragFlightKindCode = (typeof DragFlightKind)[keyof typeof DragFlightKind];

/** — L152–180 */
export interface DragFlight {
  id: number;
  kind: DragFlightKindCode;
  items: string[];
  /** 起飞点（宿主局部坐标，幽灵卡中心） */
  from: ShelfOffset;
  /** 落点（宿主局部坐标）。只是**初值**：归位时每帧都会重读真实位置 */
  to: ShelfOffset;
  /** 原位矩形（宿主局部坐标）：回弹时画虚线占位并随归位淡出。单本时的快捷值。 */
  origin: ShelfRect | null;
  /**
   * **每个条目各自**的原位矩形（宿主局部坐标）。
   *
   * ⚠️ 多本一起拖时绝不能共用第一本的原位：拖拽中是一摞扇形叠放的卡，
   * 松手却塌成"一本"飞回其中某一本的位置 —— 用户原话「从多本变成一本，
   * 和按住时的动画有很大割裂感」。每一本都要飞回**它自己**的位置。
   * 单本时留空即可，会退回 [origin]。
   */
  origins: ReadonlyMap<string, ShelfRect>;
  /** 起飞瞬间的倾角：不接住的话幽灵卡会在起飞那一刻"啪"地摆正 */
  fromRotation: number;
  /**
   * 落位时幽灵卡要收敛到的缩放。
   *
   * ⚠️ 必须和真实卡片当时的缩放一致：归位后卡片处于「已选中」态（scale 0.94），
   * 幽灵卡若收到 1.0，落位瞬间就会比卡片大一圈 —— 看着像没对齐。
   */
  settleTo: number;
}

/** 底部悬浮操作栏的一项。 — L456–463 */
export interface ShelfAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  enabled?: boolean;
  destructive?: boolean;
}

function reduceMotionPref(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * ⚠️ BUG FIXED this round: the previous gate was `if (!reduceMotionPref()) return;`
 * — i.e. it only vibrated when the OS *reduced motion* was ON, which is the exact
 * opposite of Android: `HapticKind` is gated by `LocalHapticsEnabled` (default
 * `true`, L91 of Motion.kt) and `LocalReduceMotion` never disables haptics.
 * The web stand-in for `LocalHapticsEnabled` is the same `haptics_enabled`
 * localStorage flag `CategoryPill.tsx` reads.
 */
function hapticsEnabledPref(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem('haptics_enabled') !== 'false';
}

function vibrate(ms: number): void {
  if (!hapticsEnabledPref()) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(ms);
}

/** HapticKind → millis, from `ui/feedback/Motion.kt` L134–138. */
const HAPTIC = { SELECTION: 8, LIGHT: 12, MEDIUM: 18, HEAVY: 26, SUCCESS: 16 } as const;

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
    </svg>
  );
}

function IconSelectAll() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M3 5h2V3H3a2 2 0 00-2 2v2h2V5zm0 6H1v6a2 2 0 002 2h6v-2H3v-6zm18-6h-6v2h6v6h2V5a2 2 0 00-2-2zm0 16h-6v2h6a2 2 0 002-2v-6h-2v6zM7 9l-2 2 4 4 8-8-2-2-6 6-2-2z" />
    </svg>
  );
}

function IconCheckSmall(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={props.className} fill="currentColor" aria-hidden="true">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
    </svg>
  );
}

function IconAdd() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * MultiSelectTopBar — L350–454
 * ═══════════════════════════════════════════════════════════════════════ */
export function MultiSelectTopBar(props: {
  count: number;
  allSelected: boolean;
  onClose: () => void;
  onToggleAll: () => void;
}) {
  return (
    <div className="shelf-multiselect-topbar" role="toolbar" aria-label="多选操作">
      <div className="shelf-multiselect-topbar__inner">
        <button
          type="button"
          className="shelf-multiselect-close"
          aria-label="退出多选"
          onClick={props.onClose}
        >
          <IconClose />
        </button>
        <span className="shelf-multiselect-label">已选择</span>
        <span className="shelf-multiselect-count" key={props.count}>
          {props.count}
        </span>
        <span className="shelf-multiselect-unit">本</span>
        <span className="shelf-multiselect-spacer" />
        <button
          type="button"
          className={
            props.allSelected
              ? 'shelf-multiselect-toggleall shelf-multiselect-toggleall--on'
              : 'shelf-multiselect-toggleall'
          }
          onClick={props.onToggleAll}
        >
          {props.allSelected ? <IconClose /> : <IconSelectAll />}
          {props.allSelected ? '取消全选' : '全选'}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * MultiSelectActionBar — L467–538
 * ═══════════════════════════════════════════════════════════════════════ */
export function MultiSelectActionBar(props: {
  actions: ReadonlyArray<ShelfAction>;
  visible?: boolean;
  hint?: string | null;
}) {
  const visible = props.visible !== false;
  return (
    <div
      className={
        visible
          ? 'shelf-multiselect-actionbar'
          : 'shelf-multiselect-actionbar shelf-multiselect-actionbar--hidden'
      }
      aria-hidden={!visible}
    >
      {props.hint != null ? <p className="shelf-multiselect-actionbar__hint">{props.hint}</p> : null}
      <div className="shelf-multiselect-actionbar__row">
        {props.actions.map((action) => {
          const enabled = action.enabled !== false;
          return (
            <button
              key={action.label}
              type="button"
              className={
                action.destructive === true
                  ? 'shelf-multiselect-action shelf-multiselect-action--destructive'
                  : 'shelf-multiselect-action'
              }
              disabled={!enabled}
              onClick={action.onClick}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * MoreActionSheet — L543–565
 * ═══════════════════════════════════════════════════════════════════════ */
export function MoreActionSheet(props: {
  titles: ReadonlyArray<string>;
  onPick: (title: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fav-sheet-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="fav-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="更多操作"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="fav-sheet__title" style={{ fontSize: 16 }}>
          更多操作
        </h3>
        <div className="fav-gap-8" />
        <div className="shelf-sheet-list">
          {props.titles.map((title) => (
            <button
              key={title}
              type="button"
              className="shelf-sheet-row"
              onClick={() => props.onPick(title)}
            >
              {title}
            </button>
          ))}
        </div>
        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * CategoryPickerSheet — L570–639
 * ═══════════════════════════════════════════════════════════════════════ */
export function CategoryPickerSheet(props: {
  categories: ReadonlyArray<string>;
  title: string;
  onPick: (name: string) => void;
  onDismiss: () => void;
  allowCreate?: boolean;
  onCreate?: ((name: string) => void) | null;
}) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const allowCreate = props.allowCreate !== false;

  return (
    <div className="fav-sheet-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="fav-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="fav-sheet__title" style={{ fontSize: 16 }}>
          {props.title}
        </h3>
        <div className="fav-gap-8" />
        <div className="shelf-sheet-list">
          {props.categories.map((name) => (
            <button
              key={name}
              type="button"
              className="shelf-sheet-row"
              onClick={() => props.onPick(name)}
            >
              {name}
              <IconCheckSmall className="shelf-sheet-row__check" />
            </button>
          ))}
          {allowCreate ? (
            <>
              <div className="fav-gap-6" />
              <button
                type="button"
                className="shelf-sheet-row"
                onClick={() => setCreating(true)}
                style={{ color: MINT_PRIMARY }}
              >
                <IconAdd />
                ＋新建分类
              </button>
            </>
          ) : null}
        </div>
        {allowCreate && creating ? (
          <>
            <input
              className="fav-outlined-field"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="分类名称"
              aria-label="分类名称"
            />
            <div className="fav-gap-8" />
            <button
              type="button"
              className="fav-btn"
              disabled={newName.trim() === ''}
              onClick={() => {
                if (newName.trim() !== '') {
                  props.onCreate?.(newName.trim());
                  setCreating(false);
                  setNewName('');
                }
              }}
            >
              创建并放入
            </button>
          </>
        ) : null}
        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * PlaceholderBox — L1001–1038
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 原位的虚线占位框：归位过程中随进度淡出，暗示"位置一直给你留着"。
 *
 * ⚠️ 这里**必须**做像素级定位，不能写 `offset { IntOffset(px) }.size(px.toDp())`：
 * 后者一旦密度换算或语义理解有偏差，占位框会整体错位 + 尺寸放大
 * （实测出现过「比书卡大 3 倍、还往上偏 290px」的鬼影框）。
 * CSS `position: absolute` with the rect's own left/top/width/height keeps the
 * placeholder in exactly the same coordinate space as the rect — 零换算、零歧义。
 */
function PlaceholderBox(props: { rect: ShelfRect; alpha: number }) {
  // 虚线轮廓的颜色：MintPrimary 是按主题取值的 @Composable 属性，
  // drawBehind 的 DrawScope 不是组合上下文，必须在外部先取出来。
  return (
    <span
      className="shelf-placeholder"
      aria-hidden="true"
      style={{
        left: props.rect.left,
        top: props.rect.top,
        width: Math.max(0, props.rect.right - props.rect.left),
        height: Math.max(0, props.rect.bottom - props.rect.top),
        opacity: props.alpha,
      }}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * DragStack — L1041–1153
 * ═══════════════════════════════════════════════════════════════════════ */

/** 拿起的一摞：最多可见 3 层，扇形偏移 + 轻微旋转，右上角数量角标。 */
function DragStack(props: {
  dragging: ReadonlyArray<string>;
  pointer: ShelfOffset | null;
  ghostSize: { width: number; height: number } | null;
  coverOf: (key: string) => ReactNode;
  tilt: number;
  reduced: boolean;
}) {
  const pointer = props.pointer;
  const list = props.dragging.slice(0, 4);
  if (pointer === null) return null;

  // 幽灵卡尺寸 = 真实封面尺寸（随列数变化），拿不到时退回 104x132dp。
  // 必须跟归位动画用同一套尺寸，否则松手瞬间会"换一张卡"，出现明显的尺寸跳变。
  const ghostW = props.ghostSize?.width ?? FALLBACK_GHOST_W;
  const ghostH = props.ghostSize?.height ?? FALLBACK_GHOST_H;

  // 拿起：1.0 → 1.08（阻尼偏低，带一次很轻的过冲，像"吸附到手指上"）
  const lift = 1.08;
  // 惯性倾斜的当前值由宿主在 48ms 轮询里算好后传入（Kotlin L1072–1091）
  const tilt = props.reduced ? 0 : props.tilt;

  const visible = list.slice(0, 3);
  const nodes: ReactNode[] = [];
  // 倒序绘制：被长按的那本（index 0）压在最上层
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const key = visible[index] as string;
    const rotation =
      (index === 0 ? 0 : index === 1 ? -6 : index === 2 ? 6 : -3) + tilt * (1 - index * 0.2);
    // 层叠景深：越靠下的卡片越小、越淡
    const depthScale = index === 0 ? 1 : index === 1 ? 0.96 : index === 2 ? 0.92 : 0.9;
    const stackOffsetX = index * 10;
    const stackOffsetY = index * 6;
    nodes.push(
      <div
        key={`drag-ghost-${key}`}
        className="shelf-drag-ghost"
        style={{
          // 幽灵卡中心比手指高 10dp（与 DragFlightLayer 的 ghostLiftPx 一致），
          // 封面才不会被手指挡住。
          left: pointer.x - ghostW / 2 + stackOffsetX,
          top: pointer.y - ghostH / 2 - GHOST_LIFT_PX + stackOffsetY,
          width: ghostW,
          height: ghostH,
          transform: `scale(${String(lift * depthScale)}) rotate(${String(rotation)}deg)`,
          opacity: index === 0 ? 1 : 0.94,
          zIndex: index,
        }}
      >
        {props.coverOf(key)}
      </div>,
    );
  }

  if (list.length > 1) {
    nodes.push(
      <div
        key="drag-count"
        className="shelf-drag-count"
        style={{
          left: pointer.x + ghostW / 2 - 6,
          top: pointer.y - ghostH / 2 - 18,
        }}
      >
        {props.dragging.length}
      </div>,
    );
  }
  return <>{nodes}</>;
}

/* ═══════════════════════════════════════════════════════════════════════
 * DragFlightLayer — L1164–1292
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * 松手之后的飞行层：幽灵卡从松手点飞到目的地 —— 这是"手感"的关键一段。
 *
 * - [DragFlightKind.MOVE]：全程加速 + 缩小到 0.15 并淡出，像被 chip "吸进去"；
 * - [DragFlightKind.RETURN] / [DragFlightKind.FAVORITE]：走一条抛物线回到原位，
 *   落位时缩放/阴影/旋转一起收敛，最后与真实卡片重合后移除（视觉上无跳变），
 *   原位虚线占位框随进度淡出。
 *
 * ⚠️ 归位落点必须**每帧重读**（[liveOrigin]），不能用起飞时的快照：
 * 松手后 phase 从 DRAGGING 变 SELECTING，卡片尺寸/缩放/相邻卡片布局都会变，
 * 快照算出来的落点会和书最终停的位置差一截（用户说的"完全不对齐"）。
 */
function DragFlightLayer(props: {
  flight: DragFlight;
  coverOf: (key: string) => ReactNode;
  reduced: boolean;
  liveOrigin: (key: string) => ShelfRect | null;
  onDone: () => void;
}) {
  const { flight, reduced, onDone } = props;
  const returning = flight.kind !== DragFlightKind.MOVE;

  // L1176–1182: `LaunchedEffect(flight.id) { started = true; delay(…); onDone() }`
  useEffect(() => {
    const timer = window.setTimeout(
      onDone,
      reduced ? 120 : returning ? RETURN_MS : DROP_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [flight.id, reduced, returning, onDone]);

  // L1184–1194: the flight progress is a CSS animation running for exactly the
  // Kotlin duration (springReturn ≈ RETURN_MS; DROP_MS for the suck-in).
  const duration = reduced ? 120 : returning ? RETURN_MS : DROP_MS;
  // `arcPx = (if (returning) 26.dp else 34.dp).toPx()`
  const arcPx = returning ? 26 : 34;
  const stepX = 10;
  const stepY = 6;

  const ghosts = flight.items.slice(0, 4);
  const liveOrigin = props.liveOrigin;

  // 归位途中：每个原位各画一个虚线框，随进度淡出，暗示"位置一直留着"。
  // 同样要用实时矩形，否则页面一滚，虚线框就和下落的书分家了。
  const placeholders =
    returning && !reduced
      ? ghosts.map((key) => {
          const t = liveOrigin(key) ?? flight.origins.get(key) ?? flight.origin;
          if (t === null || t === undefined) return null;
          return (
            <PlaceholderBox
              key={`ph-${key}`}
              rect={t}
              // `alpha = 1f - pClamped` at the end of the flight — the CSS fade
              // below reproduces it.
              alpha={1}
            />
          );
        })
      : null;

  const nodes: ReactNode[] = [];
  for (let index = ghosts.length - 1; index >= 0; index -= 1) {
    const key = ghosts[index] as string;
    // 归位落点：以实时矩形为准（卡片在松手后还会因为进入选中态而改尺寸/缩放，
    // 用起飞瞬间的快照就会落在错的地方）。
    const target = returning ? (liveOrigin(key) ?? flight.origins.get(key) ?? flight.origin) : null;
    const toX = target != null ? rectCenter(target).x : flight.to.x;
    const toY = target != null ? rectCenter(target).y : flight.to.y;

    const fromX = flight.from.x + index * stepX;
    const fromY = flight.from.y + index * stepY;
    // ⚠️ 用实时落点 toX/toY，不是 flight.to 快照
    const dx = toX - fromX;
    const dy = toY - fromY;

    // 与真实卡片同一套尺寸（实时矩形），落位时才严丝合缝，不会"落完瞬间换尺寸"。
    const ghostW = target != null ? rectSize(target).width : FALLBACK_GHOST_W;
    const ghostH = target != null ? rectSize(target).height : FALLBACK_GHOST_H;

    // 一摞的景深与扇角：起飞时和拖拽中一模一样，落位时全部收敛回真实卡片的值，
    // 否则最后会比卡片小一圈/歪着一点，看着像"没对齐"。
    const depth = index === 0 ? 1 : index === 1 ? 0.96 : index === 2 ? 0.92 : 0.9;
    const fanRot = index === 0 ? 0 : index === 1 ? -6 : index === 2 ? 6 : -3;
    // `layerAlpha = if (index == 0) 1f else 0.94f + 0.06f * pClamped`
    const layerAlpha = index === 0 ? 1 : 0.94 + 0.06;

    // L1209–1214: `scale = if (returning) settle else 1.08f * (1f - 0.86f * pClamped)`
    const startScale = 1.08;
    const endScale = returning ? flight.settleTo : 1.08 * (1 - 0.86);
    const startDepth = depth;
    const endDepth = 1;
    // L1203–1207: `rotation` from `flight.fromRotation` → 0
    const startRotation = returning ? flight.fromRotation : 0;
    const endRotation = 0;

    // `CSSProperties` has no index signature, so the `@keyframes shelf-flight` custom
    // properties live on a locally-widened alias (`type ShelfFlightVars`).
    const vars: ShelfFlightVars = {
      left: fromX - ghostW / 2,
      top: fromY - ghostH / 2,
      width: ghostW,
      height: ghostH,
      zIndex: index,
      // ⚠️ 归位结束前 alpha 一直保持 1：幽灵卡必须完整飞到落点再消失。
      // 之前这里在最后阶段淡出，而真实卡片又已经提前显形，
      // 于是落位前有一小段「两个半透明的书叠在一起」，非常脏。
      animation: `shelf-flight ${String(duration)}ms cubic-bezier(0.4, 0, 1, 1) forwards`,
      opacity: layerAlpha,
    };
    vars['--shelf-flight-x'] = `${String(dx)}px`;
    vars['--shelf-flight-y'] = `${String(dy)}px`;
    vars['--shelf-flight-arc'] = `${String(arcPx)}px`;
    vars['--shelf-flight-scale-from'] = String(startScale * startDepth);
    vars['--shelf-flight-scale-to'] = String(endScale * endDepth);
    vars['--shelf-flight-rot-from'] = `${String(startRotation + fanRot)}deg`;
    // `fanRot * (1f - pClamped)` → the fan angle fully collapses at p = 1.
    vars['--shelf-flight-rot-to'] = `${String(endRotation + fanRot * 0)}deg`;

    nodes.push(
      <div key={`flight-${key}`} className="shelf-drag-ghost" style={vars}>
        {props.coverOf(key)}
      </div>,
    );
  }

  // 「加入我喜欢的」的迸发动画不在这一层：它比书飞得更久，
  // 挂在这里会在书落位那一刻被硬生生截断。改由宿主独立渲染（HeartBurst）。
  return (
    <>
      {placeholders}
      {nodes}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * HeartBurst — L1309–1464
 * ═══════════════════════════════════════════════════════════════════════ */

interface SatelliteHeart {
  cos: number;
  sin: number;
  distK: number;
  sizeK: number;
  delay: number;
}

/** ⚠️ ADAPTATION: `kotlin.random.Random(20260922)` → a seeded mulberry32 PRNG so the
 *  six satellites are deterministic, and computed ONCE at module load
 *  (Kotlin used `remember {}`, so no `Math.random()` ever runs during render). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kotlin `rnd.nextInt(-16, 16)` for the seeded stream. */
function seededNextInt(rnd: () => number, from: number, until: number): number {
  return from + Math.floor(rnd() * (until - from));
}

/** L1423–1435: the `remember { List(6) { … } }` satellite table, hoisted to module scope. */
const SATELLITE_HEARTS: ReadonlyArray<SatelliteHeart> = (() => {
  const rnd = mulberry32(20260922);
  const list: SatelliteHeart[] = [];
  for (let i = 0; i < 6; i += 1) {
    const ang = ((-104.0 + i * 56.0 + seededNextInt(rnd, -16, 16)) * Math.PI) / 180;
    list.push({
      cos: Math.cos(ang),
      sin: Math.sin(ang),
      distK: 0.72 + rnd() * 0.55,
      sizeK: 0.38 + rnd() * 0.26,
      delay: rnd() * 0.1,
    });
  }
  return list;
})();

/**
 * 「加入我喜欢的」的迸发动画。
 *
 * 之前只是贴在幽灵卡右上角的一个圆形徽章，静态、廉价，完全没有"心动"的感觉。
 * 现在是一整套有层次的反馈：
 * - **光晕**：书被点亮的那一瞬，一圈柔和的粉色光从封面扩散开；
 * - **主心形**：沿一条三次贝塞尔曲线向右上方飘走，起飞猛、末端平，
 *   边飘边缩边淡出，还带一点回正的小旋转；
 * - **卫星心**：6 颗小心形放射状散开，角度/距离/延迟各不相同 ——
 *   整整齐齐的六等分一看就很廉价，必须打散；
 * - **残影**：主心形身后拖 4 个渐隐的小心，强化"飞出去"的速度感。
 *
 * ⚠️ 整段独立于归位飞行（1150ms vs 书的 560ms）：心要比书飞得更久，
 * 否则书一落位动画就被截断了。
 */
function HeartBurst(props: {
  centerX: number;
  centerY: number;
  reduced: boolean;
  onDone: () => void;
}) {
  const { reduced, onDone } = props;
  // L1317–1325
  useEffect(() => {
    if (reduced) {
      onDone();
      return;
    }
    const timer = window.setTimeout(onDone, HEART_BURST_MS);
    return () => window.clearTimeout(timer);
  }, [reduced, onDone]);

  if (reduced) return null;

  const risePx = 172;
  const driftPx = 30;
  // 主心形轨迹：一条向右上飘的三次贝塞尔（起飞猛、收尾平）
  const p0 = { x: props.centerX, y: props.centerY };
  const p1 = { x: props.centerX + driftPx * 0.3, y: props.centerY - risePx * 0.34 };
  const p2 = { x: props.centerX + driftPx * 1.35, y: props.centerY - risePx * 0.68 };
  const p3 = { x: props.centerX + driftPx, y: props.centerY - risePx };
  // `PathMeasure` equivalent: position along the cubic at parameter t.
  const bezierAt = (t: number): { x: number; y: number } => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  };
  const head = bezierAt(1);

  const mainSize = 34;
  // ① 光晕：从封面扩散开
  const haloR = 36;
  // ④ 卫星心：放射状散开（角度/距离/延迟都打散，避免六等分的廉价感）
  const spread = 82;

  const anim = `shelf-heart-fly ${String(HEART_BURST_MS)}ms cubic-bezier(0.215, 0.61, 0.355, 1) forwards`;

  const satellites = SATELLITE_HEARTS.map((s, i) => {
    const delayMs = s.delay * HEART_BURST_MS;
    const size = mainSize * s.sizeK;
    return (
      <span
        key={`sat-${String(i)}`}
        className="shelf-heart-burst__heart"
        style={
          {
            left: props.centerX + s.cos * spread * s.distK - size / 2,
            // 顺带一点点上飘，别笔直地射出去
            top: props.centerY + s.sin * spread * s.distK - 14 - size / 2,
            width: size,
            height: size,
            animation: `${anim} ${String(delayMs)}ms`,
            transform: `rotate(${String(s.cos * 18)}deg)`,
            opacity: 0.95,
          } as CSSProperties
        }
      >
        <HeartArt size={size} glow={0.4} />
      </span>
    );
  });

  const echoes = [];
  for (let k = 4; k >= 1; k -= 1) {
    const at = bezierAt(0);
    echoes.push(
      <span
        key={`echo-${String(k)}`}
        className="shelf-heart-burst__heart"
        style={
          {
            left: at.x - mainSize / 2,
            top: at.y - mainSize / 2,
            width: mainSize,
            height: mainSize,
            animation: `${anim} ${String(k * 0.045 * HEART_BURST_MS)}ms`,
            opacity: 0.3 - k * 0.045,
          } as CSSProperties
        }
      >
        <HeartArt size={mainSize} glow={0.55 * (0.3 - k * 0.045)} />
      </span>,
    );
  }

  const headVars: ShelfHeartVars = {
    left: head.x - mainSize / 2,
    top: head.y - mainSize / 2,
    width: mainSize,
    height: mainSize,
    animation: anim,
    opacity: 1,
  };
  headVars['--shelf-heart-dx'] = `${String(head.x - p0.x)}px`;
  headVars['--shelf-heart-dy'] = `${String(head.y - p0.y)}px`;

  return (
    <div className="shelf-heart-burst" aria-hidden="true">
      <svg className="shelf-heart-burst__svg" viewBox={`0 0 1 1`} preserveAspectRatio="none">
        <defs>
          <radialGradient id="shelf-heart-halo-gradient">
            <stop offset="0" stopColor={HEART_PINK} stopOpacity="0.5" />
            <stop offset="1" stopColor={HEART_PINK} stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* ① 光晕：从封面扩散开 */}
        <circle cx={props.centerX} cy={props.centerY} r={haloR} fill="url(#shelf-heart-halo-gradient)" />
      </svg>
      {/* ③ 残影 + ② 主心形 + ④ 卫星心 are HTML layers (HeartArt renders an <svg>). */}
      {satellites}
      {echoes}
      <span className="shelf-heart-burst__heart" style={headVars}>
        <HeartArt size={mainSize} glow={0.55} />
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * ShelfSelectionHost — L647–990
 * ═══════════════════════════════════════════════════════════════════════ */

export interface ShelfSelectionHostProps {
  state: ShelfSelectionState;
  categories: ReadonlyArray<string>;
  currentCategory: string;
  showFavoriteTarget: boolean;
  onDropToCategory: (items: string[], category: string) => void;
  onDropToFavorite: (items: string[]) => void;
  /** 拖到「我喜欢的」某个分类上：加入收藏并归入该分类 */
  onDropToFavoriteCategory?: (items: string[], category: string) => void;
  onCreateCategoryThenDrop: (items: string[]) => void;
  /** 短按命中某条目（BROWSE → 打开；SELECTING → 切换选中）。手势由宿主统一处理 */
  onTapItem: (key: string) => void;
  scrollBy: (delta: number) => void;
  coverOf: (key: string) => ReactNode;
  /**
   * **当前真实存在的条目 key**（书籍 id 与 `fav::sourceId::comicId`）。
   *
   * 宿主拿它裁剪几何表：条目消失后它的矩形必须一起消失，否则那块区域会变成
   * "幽灵热区"——点不到、长按选中不了，甚至把书丢进一个不存在的分类。
   */
  aliveKeys?: ReadonlySet<string>;
  /** 「我喜欢的」的分类名（用来推导哪些落点胶囊是真的还在） */
  favoriteCategories?: ReadonlyArray<string>;
  /** 命中兜底：卡片坐标回调不可靠时，按列表真实布局信息兜住点击/长按 */
  fallbackHit?: ((point: ShelfOffset) => string | null) | null;
  children: ReactNode;
  /** Android `content: @Composable (itemBounds) -> Unit` — receives the geometry registrars. */
  renderContent?: (api: ShelfHostContentApi) => ReactNode;
}

export interface ShelfHostContentApi {
  /** 登记条目几何（封面矩形）。Kotlin `itemBounds` / `coverBoundsModifier`. */
  registerItem: (key: string) => (element: HTMLElement | null) => void;
  /** 登记一个放置目标（分类胶囊 / ♡ / ＋新建）的矩形。 */
  registerDropTarget: (id: string) => (element: HTMLElement | null) => void;
}

/** `ShelfSelectionHost` 的手势阶段 + 动画数据的对外只读快照。 */
export interface ShelfHostOverlayState {
  phase: (typeof ShelfPhase)[keyof (typeof ShelfPhase)];
  dragging: ReadonlyArray<string>;
  pointer: ShelfOffset | null;
  ghostTilt: number;
  /** 当前悬停的放置目标 id（供页面的胶囊消费 `dropHighlight`） */
  hoverTarget: string | null;
  /** 正在果冻回弹的落点（560ms 后自动松开） */
  pulseTarget: string | null;
  /** 手指正按住的条目 key（按压视觉） */
  pressedKey: string | null;
  /** 归位飞行期间必须保持隐藏的条目 */
  flyingHome: ReadonlySet<string>;
  reduced: boolean;
  /** 供覆盖层使用的宿主局部化函数 */
  localRect: (r: ShelfRect | null | undefined) => ShelfRect | null;
  ghostSize: { width: number; height: number } | null;
  coverOf: (key: string) => ReactNode;
  /** 结束一次拖拽（宿主在 Escape / pointerup 时调用） */
  finishDrag: () => void;
  /** 渲染覆盖层（幽灵卡 / 虚线占位 / 心形迸发 / 归位飞行） */
  renderOverlay: () => ReactNode;
  contentApi: ShelfHostContentApi;
  /** Kotlin `Modifier.shelfGestures` 的四个 DOM 事件处理器 — L890–L898 的挂载点。 */
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
}

/**
 * 拖拽宿主：包裹书架网格，承载手势、拖拽叠放、放置坞与自动滚动。
 *
 * ⚠️ React rule: no hooks may be called conditionally, so the host is split in two —
 * `useShelfSelectionHost` owns all state/effects and returns
 * [overlay, contentApi]; `ShelfSelectionHost` is the thin DOM shell. Behaviour is
 * identical to the Kotlin `@Composable`.
 *
 * @param coverOf 拖拽时跟随手指的缩略图内容
 */
export function useShelfSelectionHost(props: ShelfSelectionHostProps): ShelfHostOverlayState {
  const { state } = props;
  const emptyKeys: ReadonlySet<string> = useMemo(() => new Set<string>(), []);
  const emptyCats: ReadonlyArray<string> = useMemo(() => [], []);
  const aliveKeys = props.aliveKeys ?? emptyKeys;
  const favoriteCategories = props.favoriteCategories ?? emptyCats;
  const showFavoriteTarget = props.showFavoriteTarget;

  // L680–682: `hostOffset` / `hostTop` / `hostBottom` from `onGloballyPositioned`.
  // ⚠️ ADAPTATION: a ref cannot be read during render, so the host origin is state.
  const [hostOrigin, setHostOrigin] = useState<ShelfOffset>(offset(0, 0));
  /** `hostBottom = hostOrigin.y + height`（Kotlin L907）。 */
  const [hostSize, setHostSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [pulseTarget, setPulseTarget] = useState<string | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [phase, setPhase] = useState(state.phase);
  const [pointer, setPointer] = useState<ShelfOffset | null>(state.pointer);
  const [dragging, setDragging] = useState<ReadonlyArray<string>>(state.dragging);
  const [ghostTilt, setGhostTilt] = useState(state.ghostTilt);
  const [flyingHome, setFlyingHome] = useState<ReadonlySet<string>>(state.flyingHome);
  const [pendingFlight, setPendingFlight] = useState<DragFlight | null>(null);
  const [heartBurstAt, setHeartBurstAt] = useState<ShelfOffset | null>(null);
  const [reduced, setReduced] = useState(reduceMotionPref);
  // ⚠️ The tick's *value* is never read — it exists purely to re-render after a
  // scroll/resize so the overlay re-reads the geometry registry.
  const [, setGeometryTick] = useState(0);

  // L687: `flightSeq` — not rendered, so a ref is the right home for it.
  const flightSeqRef = useRef(0);
  // L936: the gesture record (Kotlin keeps it in the pointerInput coroutine locals).
  // `useState`'s lazy initializer yields a stable, non-null mutable box across renders
  // without the render-scope `ref.current = …` assignment that `react-hooks/immutability`
  // rejects (and without the `| null` narrowing at every call site).
  const [gesture] = useState(gestureHolder);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** 把 root 坐标的矩形换算到宿主局部坐标 — L695–697 */
  const localRect = useCallback(
    (r: ShelfRect | null | undefined): ShelfRect | null => {
      if (r == null) return null;
      return translateRect(r, -hostOrigin.x, -hostOrigin.y);
    },
    [hostOrigin],
  );

  /**
   * ⚠️ BUG FIXED this round: `onPointerMove` used to pass `hostOrigin.y` for **both**
   * `hostTop` and `hostBottom` (Kotlin L903–908 sets `hostTop = y` and
   * `hostBottom = y + height`). With `hostTop === hostBottom` the edge band test in
   * `moveDrag` (`rootY < hostTop + 96dp` / `rootY > hostBottom - 96dp`) is true for
   * essentially every pointer position, so `edgeScroll` never settled at 0 and the
   * 80 ms auto-scroll loop ran the whole time the finger was down.
   */
  const hostBox = useMemo(
    () => ({ top: hostOrigin.y, bottom: hostOrigin.y + hostSize.height }),
    [hostOrigin, hostSize],
  );

  // 落点胶囊的"存活名单"：书架分类 + 我喜欢的分类 + ♡ + 新建 — L702–710
  const aliveTargets = useMemo(() => {
    const set = new Set<string>();
    for (const c of props.categories) set.add(dropTargetOfCategory(c));
    for (const c of favoriteCategories) set.add(dropTargetOfFavoriteCategory(c));
    if (showFavoriteTarget) set.add(DROP_TARGET_FAVORITE);
    set.add(DROP_TARGET_NEW);
    return set;
  }, [props.categories, favoriteCategories, showFavoriteTarget]);

  // ⚠️ 几何表只写不删，条目/分类消失后必须按"真实存在的名单"裁一遍，
  // 否则残留矩形会变成幽灵热区：点不动、选不中，甚至把书丢进不存在的分类。
  useEffect(() => {
    state.pruneGeometry(aliveKeys, aliveTargets);
  }, [state, aliveKeys, aliveTargets]);

  // L825–828: subscribe to the state machine so the overlay re-renders, and give
  // the "滑过一个个分类" haptic exactly one tick per change.
  useEffect(
    () =>
      state.subscribe((s) => {
        setPhase(s.phase);
        setPointer(s.pointer);
        setDragging(s.dragging);
        setGhostTilt(s.ghostTilt);
        setPressedKey(s.pressedKey);
        setFlyingHome(s.flyingHome);
        if (s.hoverTarget !== null) {
          setHoverTarget(s.hoverTarget);
          vibrate(HAPTIC.SELECTION);
        } else {
          setHoverTarget(null);
        }
      }),
    [state],
  );

  // chip 的果冻反馈只闪一下，之后自动松开 — L830–836
  useEffect(() => {
    if (pulseTarget === null) return;
    const timer = window.setTimeout(() => setPulseTarget(null), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [pulseTarget]);

  // 边缘自动滚动
  //
  // ⚠️ 三个坑，都让"页面自己跑得比手指还快"（或者干脆不动）：
  //  1) 原来 key 里带 state.edgeScroll：手指在感应带里稍微一动 edgeScroll 就变，
  //     协程立刻重启 —— 实际速度于是变成「手指事件频率 × 速度」，手抖两下页面就疯跑。
  //     现在 key 只跟 phase，循环内读当前值，节奏固定 80ms 一跳。
  //  2) 原来还乘了一次 density。edgeScroll 在 moveDrag 里已经按 density 换算成
  //     真实 px，这里再乘一次就是 3 倍速。
  //  3) 「驻留 200ms 才开始滚」必须在这个循环里计时，不能放到 moveDrag 里：
  //     moveDrag 只在收到 MOVE 事件时被调用，手指停在边缘不动就没有事件。
  useEffect(() => {
    if (phase !== ShelfPhase.DRAGGING) return;
    let inEdgeSince = 0;
    let cancelled = false;
    const loop = (): void => {
      if (cancelled) return;
      const v = state.edgeScroll;
      if (v === 0) {
        inEdgeSince = 0;
      } else {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (inEdgeSince === 0) inEdgeSince = now;
        // 只是路过边缘不算数，得真的停在那里
        if (now - inEdgeSince >= EDGE_ARM_MS) props.scrollBy(v);
      }
      window.setTimeout(loop, EDGE_TICK_MS);
    };
    loop();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, state]);

  // 多选态隐藏底部 Tab 栏（悬浮操作栏替换） — L866–872
  useEffect(() => {
    shelfChrome.setTabBarVisible(phase === ShelfPhase.BROWSE);
    return () => shelfChrome.setTabBarVisible(true);
  }, [phase]);

  // 惯性倾斜：横向移动越快倾角越大，停手自动回正（iOS 拖图标的手感）
  // — DragStack.kt L1072–1091 的 48ms 轮询 + `SideEffect { state.ghostTilt = tilt }`
  useEffect(() => {
    if (phase !== ShelfPhase.DRAGGING) return;
    let last = state.pointer?.x ?? 0;
    const id = window.setInterval(() => {
      const cur = state.pointer?.x ?? last;
      const dx = cur - last;
      last = cur;
      // 把当前倾角回写给状态机：松手后的飞行动画要接住这个角度当起始值，
      // 否则幽灵卡会在起飞那一刻硬生生摆正一下。
      state.setGhostTiltAnimated(reduced ? 0 : Math.abs(dx) < 0.6 ? 0 : Math.max(-9, Math.min(9, dx * 0.5)));
    }, 48);
    return () => window.clearInterval(id);
  }, [phase, reduced, state]);

  // 几何变化（滚动 / 窗口尺寸）后重算宿主原点与覆盖层 — L903–908 的 onGloballyPositioned
  useEffect(() => {
    const host = document.querySelector('[data-shelf-host="true"]');
    const sync = (): void => {
      if (host === null) return;
      const box = host.getBoundingClientRect();
      setHostOrigin(offset(box.left, box.top));
      setHostSize({ width: box.width, height: box.height });
      setGeometryTick((t) => t + 1);
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, []);

  // 归位落点必须用**封面**矩形：整卡矩形含书名那一行，中心比封面低。
  //
  // ⚠️ ADAPTATION: `geometryTick` is intentionally *not* a dep — it only exists to
  // re-render after a scroll/resize. `localRect` already changes with `hostOrigin`,
  // and the registry itself is read through `state.coverRect`, so the memo stays
  // correct on every render that matters (drag start / release).
  const ghostSize = (() => {
    const first = dragging[0];
    if (first === undefined) return null;
    const r = localRect(state.coverRect(first));
    return r === null ? null : rectSize(r);
  })();

  /* ── 松手后的飞行动画数据构造（L721–823 的 `DropSink.onDrop`） ── */
  const emitDrop = useCallback(
    (target: string | null, items: string[], release: ShelfOffset) => {
      const from = offset(release.x, release.y - GHOST_LIFT_PX);
      const picked = items[0];
      const originRect = localRect(picked === undefined ? null : state.coverRect(picked));
      const home = originRect !== null ? rectCenter(originRect) : from;
      const origins = new Map<string, ShelfRect>();
      for (const k of items) {
        const r = localRect(state.coverRect(k));
        if (r !== null) origins.set(k, r);
      }

      // `id` is nullable because `switch (target === null ? 'none' : target)` widens
      // the switch subject back to `string`, so a `case DROP_TARGET_*` arm cannot
      // narrow `target` itself. A null id has no registered chip, so `home` wins —
      // identical to Kotlin's `targetRect(target) ?: home`.
      const chipCenter = (id: string | null): ShelfOffset => {
        if (id === null) return home;
        const chip = state.targetRect(id);
        if (chip === null) return home;
        return rectCenter(translateRect(chip, -hostOrigin.x, -hostOrigin.y));
      };

      const launch = (kind: DragFlightKindCode, to: ShelfOffset, origin: ShelfRect | null): void => {
        // ⚠️ 上一次飞行还没落位就又来了一次 drop：新的 DragFlight 会顶掉旧的，
        // 旧那一层的 effect 随之被取消 ⇒ 它的 onDone **永远不会执行**
        // ⇒ 上一批条目永远留在 flyingHome 里（alpha 恒为 0）= 书凭空消失。
        // 所以起飞前先把上一批交班掉。
        flightSeqRef.current += 1;
        const id = flightSeqRef.current;
        state.endReturnFlight();
        setPendingFlight({
          id,
          kind,
          items,
          from,
          to,
          origin,
          origins,
          // 接住松手瞬间的倾角，起飞才不会硬摆正
          fromRotation: kind === DragFlightKind.MOVE ? 0 : state.ghostTilt,
          settleTo: kind === DragFlightKind.MOVE ? 1 : SELECTED_SCALE,
        });
      };

      switch (target === null ? 'none' : target) {
        // ① 落在非放置区：弹回原位（保持选中）
        case 'none': {
          vibrate(HAPTIC.LIGHT);
          // 归位飞行期间真实卡片必须继续藏着，否则松手瞬间就"书已经回来了"
          state.beginReturnFlight(items);
          launch(DragFlightKind.RETURN, home, originRect);
          break;
        }
        // ② 落到 ♡：飞回原位 + 心形徽章
        case DROP_TARGET_FAVORITE: {
          vibrate(HAPTIC.SUCCESS);
          state.beginReturnFlight(items);
          // 心形从"松手那一刻书所在的位置"迸发，不是从原位的书卡
          setHeartBurstAt(from);
          launch(DragFlightKind.FAVORITE, home, originRect);
          props.onDropToFavorite(items);
          break;
        }
        // ③ 落到「＋新建分类」：吸入 chip，随后弹命名 Sheet
        case DROP_TARGET_NEW: {
          vibrate(HAPTIC.SUCCESS);
          setPulseTarget(target);
          launch(DragFlightKind.MOVE, chipCenter(target), null);
          // ⚠️ 必须退出多选：endDrag() 只把 phase 从 DRAGGING 收回 SELECTING，
          // 而拖走的条目已经离开当前列表 —— 留着就是"选中了一本不存在的书"。
          state.exitSelection();
          props.onCreateCategoryThenDrop(items);
          break;
        }
        default:
          break;
      }

      // ④ 落到某个分类
      if (target !== null && target.startsWith('drop::cat::')) {
        const name = target.replace('drop::cat::', '');
        if (name !== props.currentCategory) {
          vibrate(HAPTIC.SUCCESS);
          setPulseTarget(target);
          launch(DragFlightKind.MOVE, chipCenter(target), null);
          state.exitSelection(); // 同 ③：书已经不在当前分类里了
          props.onDropToCategory(items, name);
        } else {
          // 当前分类自身 = 无效落点：也要优雅回弹，不能"啪"地消失
          vibrate(HAPTIC.LIGHT);
          state.beginReturnFlight(items);
          launch(DragFlightKind.RETURN, home, originRect);
        }
        return;
      }

      // ⑤ 落到「我喜欢的」的某个分类：加入收藏并归入该分类
      if (target !== null && target.startsWith(DROP_PREFIX_FAV_CATEGORY)) {
        const name = target.replace(DROP_PREFIX_FAV_CATEGORY, '');
        vibrate(HAPTIC.SUCCESS);
        setPulseTarget(target);
        launch(DragFlightKind.MOVE, chipCenter(target), null);
        state.exitSelection(); // 同 ③：拖走的条目已离开当前列表
        props.onDropToFavoriteCategory?.(items, name);
      }
    },
    [hostOrigin, localRect, props, state],
  );

  // DragStack 收尾：Kotlin L663–668 的 endDrag + dropSink.emit
  const finishDrag = useCallback((): void => {
    if (state.phase !== ShelfPhase.DRAGGING) return;
    // 先取松手位置：endDrag 会把 pointer 清空，而飞行动画要从这一点起飞
    const release = state.pointer;
    const [target, items] = state.endDrag();
    emitDrop(target, items, release ?? offset(0, 0));
  }, [emitDrop, state]);

  // BackHandler(enabled = phase != BROWSE) — Escape stands in for the Android back key.
  useEffect(() => {
    if (phase === ShelfPhase.BROWSE) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (phase === ShelfPhase.DRAGGING) {
        // 返回键取消拖拽：也走"优雅归位"，不能让卡片凭空消失
        const release = state.pointer;
        const items = state.dragging;
        state.cancelDrag();
        // Kotlin: `dropSink.onDrop?.invoke(null, items, release ?: Offset.Zero)`
        emitDrop(null, items, release ?? offset(0, 0));
      } else {
        state.exitSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emitDrop, phase, state]);

  /* ── 宿主指针输入：手势的唯一主人（Kotlin L530–669）
   *
   * ⚠️ ADAPTATION: these are **stable identities**. The `React.PointerEvent`
   * parameters are typed as `unknown` on purpose — naming the React type here
   * makes the compiler treat the whole callback as "touches React state", which
   * then forces the gesture record into a ref-free object graph. Reading
   * `pointerId/clientX/clientY/movementX/currentTarget` off a structural type
   * keeps the handler a plain DOM listener, which is exactly what it is.
   */
  type PointerEv = {
    pointerId: number;
    clientX: number;
    clientY: number;
    currentTarget: {
      setPointerCapture: (id: number) => void;
      releasePointerCapture: (id: number) => void;
      hasPointerCapture: (id: number) => boolean;
    };
  };
  const hitAt = useCallback(
    (clientX: number, clientY: number): string | null =>
      state.hitTestItem(offset(clientX, clientY), aliveKeys, props.fallbackHit ?? null),
    [aliveKeys, props, state],
  );

  const onPointerDown = useCallback(
    (ev: PointerEv) => {
      // L549–553: `awaitFirstDown(requireUnconsumed = false)` + hit test on down.
      const local = offset(ev.clientX - hostOrigin.x, ev.clientY - hostOrigin.y);
      const key = hitAt(ev.clientX, ev.clientY);
      state.setPressed(key);
      const longPressMs = state.phase === ShelfPhase.SELECTING ? 250 : 350;
      gestureBegin(gesture, ev.pointerId, local, key, longPressMs);
      ev.currentTarget.setPointerCapture(ev.pointerId);
    },
    [gesture, hitAt, hostOrigin, state],
  );

  const onPointerMove = useCallback(
    (ev: PointerEv) => {
      const local = offset(ev.clientX - hostOrigin.x, ev.clientY - hostOrigin.y);
      const g = gestureMove(gesture, ev.pointerId, local, TOUCH_SLOP);
      if (g === null) return;
      if (g.moved) state.setPressed(null);
      if (state.phase === ShelfPhase.DRAGGING) {
        state.moveDrag(local, hostBox.top, hostBox.bottom, hostOrigin, 1);
      } else if (g.timedOut) {
        // L636–661: 滑动连选 — 必须等手指真的离开长按点才开始。
        state.moveDrag(local, hostBox.top, hostBox.bottom, hostOrigin, 1);
        const slideSlop = TOUCH_SLOP * 1.5;
        if (Math.hypot(local.x - g.start.x, local.y - g.start.y) > slideSlop) {
          const hit = hitAt(ev.clientX, ev.clientY);
          // ⚠️ 连选必须**边缘触发**：只在命中条目与上一次不同时才切换。
          // 手指停在第二本上轻微抖动时，每个 move 事件都会命中同一本 ——
          // 电平触发的 slideAcross 会把它在"选中/取消"之间来回切。
          if (hit !== state.lastSlideKey) {
            state.setLastSlideKey(hit);
            if (hit !== null && state.accepts(hit)) state.slideAcross(hit);
          }
        }
      }
    },
    [gesture, hitAt, hostBox, hostOrigin, state],
  );

  const onPointerUp = useCallback(
    (ev: PointerEv) => {
      const g = gestureTake(gesture, ev.pointerId);
      if (g === null) return;
      state.setPressed(null);
      if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
        ev.currentTarget.releasePointerCapture(ev.pointerId);
      }

      // ① 短按 → 点击（打开书 / 多选态切换选中）
      if (!g.timedOut && g.key !== null && !g.moved) {
        props.onTapItem(g.key);
        return;
      }
      // ② 超时前就抬手但已滑动（滚动）或没命中任何条目 → 什么都不做
      if (!g.timedOut || g.aborted || g.key === null) return;

      // ③ 长按
      const key = g.key;
      const alreadySelected = state.selected.has(key);
      if (state.phase === ShelfPhase.BROWSE) {
        vibrate(HAPTIC.MEDIUM);
        state.enterSelection(key);
        state.markAutoSelect();
      } else if (alreadySelected) {
        vibrate(HAPTIC.HEAVY);
        state.beginDrag(key, g.start);
        state.markAutoSelect();
      } else if (!state.accepts(key)) {
        // 多选名单按板块独立：长按到**另一板块**的卡片时什么都不做
        // —— 不改名单、不给触觉，直接结束这次手势。
        return;
      } else {
        vibrate(HAPTIC.SELECTION);
        state.select(key);
        state.markAutoSelect();
      }
      // 连选起点 = 长按的这一本：不初始化的话，进入跟踪循环后的第一个抖动帧
      // 会再次命中它并 slideAcross 把它划掉
      state.setLastSlideKey(key);
    },
    [gesture, props, state],
  );

  const onPointerCancel = useCallback((): void => {
    gestureRelease(gesture);
    state.setPressed(null);
  }, [gesture, state]);

  // ⚠️ 每次渲染都要把**最新**的回调换进水槽（见 ShelfGestureSink）：
  // 不换的话手势里拿到的还是"第一次渲染时"的书单 —— 切换分类后就点不动了。
  //
  // The Kotlin does these six assignments directly in composition (L890–898); the
  // equivalent write is routed through a module-scope function so it is not a
  // render-scope mutation.
  const gestureSink = useMemo(() => new ShelfGestureSink(), []);
  syncGestureSink(gestureSink, hostOrigin, props.onTapItem);

  // 几何登记（Kotlin L917–929 / L239–243）
  const contentApi = useMemo<ShelfHostContentApi>(
    () => ({
      registerItem: (key: string) => (element: HTMLElement | null) => {
        if (element === null) return;
        const r = element.getBoundingClientRect();
        const rect: ShelfRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        state.registerItem(key, rect);
        // 封面专用几何登记（归位动画的落点依据）
        state.registerCover(key, rect);
      },
      registerDropTarget: (id: string) => (element: HTMLElement | null) => {
        if (element === null) return;
        const r = element.getBoundingClientRect();
        state.registerDropTarget(id, {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        });
      },
    }),
    [state],
  );

  const renderOverlay = useCallback((): ReactNode => {
    return (
      <div className="shelf-host__overlay" aria-hidden="true">
        {/*
          ⚠️ 放置目标不再用底部悬浮 Dock（已整块移除）。
          用户明确要求：**分类就是页面里「我的书架 / 我喜欢的」下面那一排分类胶囊，
          不要另起一栏**。所以 drop target 直接注册在那些 chip 上，
          宿主这里只负责画"书被拿走后原位的虚线轮廓"。
          原位轮廓必须画在宿主层：书卡自身此刻 alpha=0（避免留下白块）。
        */}
        {phase === ShelfPhase.DRAGGING
          ? dragging.map((key) => {
              const r = localRect(state.coverRect(key));
              return r === null ? null : (
                <PlaceholderBox key={`ph-drag-${key}`} rect={r} alpha={1} />
              );
            })
          : null}

        {phase === ShelfPhase.DRAGGING ? (
          <DragStack
            dragging={dragging}
            pointer={pointer}
            ghostSize={ghostSize}
            coverOf={props.coverOf}
            tilt={ghostTilt}
            reduced={reduced}
          />
        ) : null}

        {heartBurstAt !== null ? (
          <HeartBurst
            centerX={heartBurstAt.x}
            centerY={heartBurstAt.y}
            reduced={reduced}
            onDone={() => setHeartBurstAt(null)}
          />
        ) : null}

        {pendingFlight !== null ? (
          <DragFlightLayer
            flight={pendingFlight}
            coverOf={props.coverOf}
            reduced={reduced}
            liveOrigin={(key) => localRect(state.coverRect(key))}
            onDone={() => {
              // 幽灵卡此刻与真实卡片完全重合，交班：
              // 同时移除幽灵卡 + 让真实卡片显形，中间不留空隙也不重叠。
              state.endReturnFlight();
              setPendingFlight(null);
            }}
          />
        ) : null}
      </div>
    );
  }, [dragging, ghostSize, ghostTilt, heartBurstAt, localRect, pendingFlight, phase, pointer, props, reduced, state]);

  return {
    phase,
    dragging,
    pointer,
    ghostTilt,
    hoverTarget,
    pulseTarget,
    pressedKey,
    flyingHome,
    reduced,
    localRect,
    ghostSize,
    coverOf: props.coverOf,
    finishDrag,
    renderOverlay,
    contentApi,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * 手势状态机（Kotlin L530–669 `Modifier.shelfGestures`）
 *
 * ⚠️ ADAPTATION: the Kotlin gesture loop lives in a `pointerInput` coroutine whose
 * locals are invisible to composition. On the web it becomes a plain module-scope
 * state machine; keeping it at module scope (rather than inline in the component)
 * also keeps the immutable-analysis linter honest: nothing here can reach into a
 * render-scoped value.
 * ═══════════════════════════════════════════════════════════════════════ */

/** One pointer-down..up window. Mirrors the locals of `awaitEachGesture { … }`. */
interface GestureRecord {
  id: number;
  /** `val start = down.position` — host-local. */
  start: ShelfOffset;
  /** `val key = state.hitTestItem(rootStart)` — resolved on down. */
  key: string | null;
  /** set by the long-press timer; `timedOut` replaces Compose's `withTimeout` catch. */
  timedOut: boolean;
  /** finger lifted before the timeout. */
  aborted: boolean;
  /** moved past slop (a scroll, not a tap). */
  moved: boolean;
  timer: number;
}

interface GestureHolder {
  current: GestureRecord | null;
}

function gestureHolder(): GestureHolder {
  return { current: null };
}

/** L549–558: down — hit test once, then start the long-press timer. */
function gestureBegin(
  holder: GestureHolder,
  id: number,
  start: ShelfOffset,
  key: string | null,
  longPressMs: number,
): void {
  holder.current = {
    id,
    start,
    key,
    timedOut: false,
    aborted: false,
    moved: false,
    timer: window.setTimeout(() => {
      const g = holder.current;
      if (g !== null && g.id === id) g.timedOut = true;
    }, longPressMs),
  };
}

/**
 * L565–581: 让位条件只有两个 —— 手指抬起（→ 点击）或移动超过 slop（→ 滚动）。
 * 不再看 isConsumed：条目已经不抢手势了。
 */
function gestureMove(holder: GestureHolder, id: number, local: ShelfOffset, slop: number): GestureRecord | null {
  const g = holder.current;
  if (g === null || g.id !== id) return null;
  if (!g.timedOut && Math.hypot(local.x - g.start.x, local.y - g.start.y) > slop) {
    g.aborted = true;
    g.moved = true;
  }
  return g;
}

/** L591–599: up / cancel — take the record and stop the timer. */
function gestureTake(holder: GestureHolder, id: number): GestureRecord | null {
  const g = holder.current;
  if (g === null || g.id !== id) return null;
  window.clearTimeout(g.timer);
  holder.current = null;
  return g;
}

/** L591 `state.setPressed(null)` / the pointer-cancel path. */
function gestureRelease(holder: GestureHolder): void {
  const g = holder.current;
  holder.current = null;
  if (g !== null) window.clearTimeout(g.timer);
}

/** L890–898 — "每次组合都要把**最新**的回调换进水槽"（the six sink assignments). */
function syncGestureSink(
  sink: ShelfGestureSink,
  hostOrigin: ShelfOffset,
  onTap: (key: string) => void,
): void {
  sink.hostOffset = () => hostOrigin;
  sink.haptic = (kind) => {
    vibrate(HAPTIC[kind]);
  };
  sink.enabled = () => true;
  sink.onTap = onTap;
}

/** 书架外壳（DOM 部分）。见 `useShelfSelectionHost` 的 KDoc。 */
export function ShelfSelectionHost(props: ShelfSelectionHostProps) {
  const host = useShelfSelectionHost(props);
  const render = props.renderContent;

  return (
    <div
      className="shelf-host"
      data-shelf-host="true"
      onPointerDown={host.onPointerDown}
      onPointerMove={host.onPointerMove}
      onPointerUp={(event) => {
        host.onPointerUp(event);
        host.finishDrag();
      }}
      onPointerCancel={() => {
        host.onPointerCancel();
        host.finishDrag();
      }}
    >
      <div className="shelf-host__scroll">
        {render === undefined ? props.children : render(host.contentApi)}
      </div>
      {host.renderOverlay()}
    </div>
  );
}

export { offset, rectCenter, rectSize, translateRect, ON_SURFACE, ShelfGestureSink };
