/**
 * `ui/components/OverlayAnimations.kt`（86 行 / 79 非空）→ `@core/ui/overlayEntrance`。
 *
 * 为什么单独一个模块：这个文件里的四个组件**没有一个**是「淡入 + 缩放」那种通用入场，
 * 它们全部由 `WenkuMotion` 的三条曲线驱动同一个 0..1 线性进度，再用 `graphicsLayer`
 * 把进度映射成 alpha / 位移。端口此前把这三个组件写成三条固定 keyframes（`scale(0.92)`、
 * `translateY(16.6667%)`、220ms 线性遮罩），等于把「曲线 × 线性进度」这个结构整个丢掉了。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `DialogEntrance`（`fromBottom = false`） | L14-18 | `overlayEntranceSpec('dialog')` |
 * | `BottomSheetEntrance`（`fromBottom = true`） | L20-24 | `overlayEntranceSpec('sheet')` |
 * | `OverlayEntrance` 的进度驱动 | L37-45 | `OVERLAY_ENTER_MS` / `OVERLAY_EXIT_MS` + `LINEAR` |
 * | `graphicsLayer` 的四个映射 | L46-55 | `overlayEntranceFrame(kind, raw)` |
 * | `ScrimEntrance` | L61-78 | `overlayScrimSpec()` + `OVERLAY_SCRIM_*` |
 * | `PullOutScrim` | L80-86 | `pullOutScrimSpec(visible)` |
 *
 * 三处只有读原文才会发现的语义
 * ─────────────────────────────
 * 1. **底部面板不淡入**。L50 `alpha = if (fromBottom) 1f else WenkuMotion.ease.transform(raw)`
 *    —— 面板从第一帧起 alpha 就是 1，只靠位移进入；只有居中对话框才淡入。写成两者都淡入，
 *    面板会在滑入的同时「半透明地飘过来」，比 Android 虚一大截。
 * 2. **X 位移是负的，且两档不同**。L51 `translationX = -(if (fromBottom) 18.dp else 8.dp).toPx() * remaining`
 *    —— 都从左侧 18/8 dp 处归位。迹向写错（正数）会让面板从右往左滑。
 * 3. **Y 位移两档用的是两条不同曲线**。L52-54 底部面板是 `(size.height + 24.dp) * remaining`
 *    （`plane` 曲线，整幅高度 + 24dp 外扩），对话框是 `20.dp * (1f - WenkuMotion.settle.transform(raw))`
 *    （`settle` 曲线，20dp 且**过冲**到负值）。用一个 `translateY(16.6667%)` 同时糊住两档，
 *    面板只能升到六分之一高度，对话框则完全没有回弹。
 * 4. **进出时长不同**。L40-42 `tween(if (visible) durationMillis else WenkuMotion.EXIT_MS, LinearEasing)`
 *    —— 入场 420ms（`ENTER_MS`）、出场 320ms（`EXIT_MS`），进度本身是**线性**的，缓动只在
 *    那三条 `CubicBezierEasing` 里。端口原来把缓动写在动画时长上（`220ms linear`、
 *    `180ms cubic-bezier(...)`），两层混成了一层。
 * 5. **`ScrimEntrance` 无共享状态时是「挂载后下一帧才可见」**。L66
 *    `LaunchedEffect(shared) { if (shared == null) standaloneVisible = true }` —— 首帧 open=false
 *    才能让 `animateFloatAsState` 真的从 0 补到 1；直接把初始值设成 true 就没有遮罩淡入。
 *
 * 平台差异
 * ────────
 * - `graphicsLayer` → CSS `transform` + `opacity`：核心模块只产出**数值**，由
 *   `src/ui/components/OverlayAnimations.tsx` 与 `src/styles/components.css` 消费。
 * - `WenkuContentClock(progress, content)`（内容错峰浮现，`WenkuMotion.LIST_*` 驱动）→
 *   `.overlay-entrance__content` 的 `animation-delay` 阶梯，见组件文件。
 * - `rememberWenkuAccessibility().reduceMotion` → 时长归零（`.reduce-motion` 与
 *   `prefers-reduced-motion`），见 CSS。
 */

/* ── 时长与曲线：`WenkuTokens.kt` L122-124 / L159-168 ─────────────────────── */

/** `WenkuMotion.ENTER_MS` = 420 —— `DialogEntrance` / `BottomSheetEntrance` / `ScrimEntrance` 的入场时长。 */
export const OVERLAY_ENTER_MS = 420;

/** `WenkuMotion.EXIT_MS` = 320 —— 出场时长（与入场不同，L40）。 */
export const OVERLAY_EXIT_MS = 320;

/** L41 `easing = LinearEasing` —— 进度本身线性，缓动在下面三条曲线上。 */
export const OVERLAY_PROGRESS_EASING = 'linear';

/** `WenkuMotion.ease` = `CubicBezierEasing(0.215f, 0.61f, 0.355f, 1f)`（= Curves.easeOutCubic）。 */
export const OVERLAY_EASE_POINTS: readonly [number, number, number, number] = [0.215, 0.61, 0.355, 1];

/** `WenkuMotion.settle` = `CubicBezierEasing(0.2f, 1.08f, 0.34f, 1f)` —— `y1 > 1` 会过冲。 */
export const OVERLAY_SETTLE_POINTS: readonly [number, number, number, number] = [0.2, 1.08, 0.34, 1];

/** `WenkuMotion.plane` = `CubicBezierEasing(0.18f, 0.72f, 0.18f, 1f)`。 */
export const OVERLAY_PLANE_POINTS: readonly [number, number, number, number] = [0.18, 0.72, 0.18, 1];

/** CSS 形式的同三条曲线（供 `.overlay-entrance` 的内联 token 使用）。 */
export const OVERLAY_EASE_CSS = `cubic-bezier(${OVERLAY_EASE_POINTS.join(', ')})`;
export const OVERLAY_SETTLE_CSS = `cubic-bezier(${OVERLAY_SETTLE_POINTS.join(', ')})`;
export const OVERLAY_PLANE_CSS = `cubic-bezier(${OVERLAY_PLANE_POINTS.join(', ')})`;

/**
 * Compose `CubicBezierEasing` 的 y(x)：控制点 (0,0) (x1,y1) (x2,y2) (1,1)，
 * 先按 x 反解参数 t，再取 y(t)。`settle` 的 `y1 = 1.08` 让 y(x) 在中段超过 1，
 * 这里的求值必须保留这一点（否则「回到原位」的那一点点回弹会消失）。
 */
export function cubicBezierY(
  points: readonly [number, number, number, number],
  x: number,
): number {
  const [x1, y1, x2, y2] = points;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Newton 三步 + 二分兜底：导数接近 0 时 Newton 会跳出去，兜底保证单调收敛。
  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-9) return sampleY(t);
    const slope = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(slope) < 1e-9) break;
    t -= err / slope;
    if (t < 0 || t > 1) break;
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (sampleX(mid) < x) lo = mid;
    else hi = mid;
  }
  return sampleY((lo + hi) / 2);
}

/* ── 两档几何：`OverlayEntrance` 的 fromBottom 分支 ───────────────────────── */

export type OverlayEntranceKind = 'dialog' | 'sheet';

/** L51 `if (fromBottom) 18.dp else 8.dp`。 */
export const OVERLAY_SHEET_LATERAL_DP = 18;
export const OVERLAY_DIALOG_LATERAL_DP = 8;

/** L52 `size.height + 24.dp.toPx()` 里的那个 24dp。 */
export const OVERLAY_SHEET_BOTTOM_INSET_DP = 24;

/** L53 `20.dp.toPx() * (1f - settle.transform(raw))` 里的那个 20dp。 */
export const OVERLAY_DIALOG_TRAVEL_DP = 20;

export interface OverlayEntranceSpec {
  readonly kind: OverlayEntranceKind;
  /** `fromBottom` —— 决定 alpha 与两条位移公式。 */
  readonly fromBottom: boolean;
  /** L50：`fromBottom` 时恒为 1（不淡入）。 */
  readonly fadesIn: boolean;
  /** L51 的横向起点（dp，取绝对值；实际位移是负的）。 */
  readonly lateralDp: number;
  /** L52-54 的纵向：`'height'` 走 `(100% + 24px) * remaining`，`'px'` 走 `20px * settleRemaining`。 */
  readonly travelKind: 'height' | 'px';
  /** `'px'` 档的像素值（`'height'` 档为 0）。 */
  readonly travelPx: number;
  /** 入场 / 出场时长。 */
  readonly enterMs: number;
  readonly exitMs: number;
}

/** `DialogEntrance` / `BottomSheetEntrance` 的静态规格。 */
export function overlayEntranceSpec(kind: OverlayEntranceKind): OverlayEntranceSpec {
  const fromBottom = kind === 'sheet';
  return {
    kind,
    fromBottom,
    fadesIn: !fromBottom,
    lateralDp: fromBottom ? OVERLAY_SHEET_LATERAL_DP : OVERLAY_DIALOG_LATERAL_DP,
    travelKind: fromBottom ? 'height' : 'px',
    travelPx: fromBottom ? 0 : OVERLAY_DIALOG_TRAVEL_DP,
    enterMs: OVERLAY_ENTER_MS,
    exitMs: OVERLAY_EXIT_MS,
  };
}

export interface OverlayEntranceFrame {
  /** 0..1（`raw.coerceIn(0,1)`）。 */
  readonly raw: number;
  /** L48 `WenkuMotion.plane.transform(raw)`。 */
  readonly plane: number;
  /** L49 `1f - plane` —— 横向与「整幅高度」位移的系数。 */
  readonly remaining: number;
  /** L50 的 alpha（面板恒 1）。 */
  readonly alpha: number;
  /** L51 的横向位移（负值，单位 px）。 */
  readonly translateX: number;
  /**
   * L52-54 的纵向系数：
   *   `'height'` 档 —— `remaining`，实际位移 = `(容器高度 + 24px) * factor`
   *   `'px'` 档     —— `1 - settle(raw)`，实际位移 = `20px * factor`（可为微负，即过冲）
   */
  readonly travelFactor: number;
  /** 纵向位移的展开方式（与上面两行一一对应）。 */
  readonly travelKind: 'height' | 'px';
}

/**
 * L46-55 的整套映射。`raw` 是线性进度（0..1），不是时间占比 —— 时间与进度的换算在
 * `tween(durationMillis, LinearEasing)` 里，因此两者相等，但语义上要分开。
 */
export function overlayEntranceFrame(kind: OverlayEntranceKind, raw: number): OverlayEntranceFrame {
  const spec = overlayEntranceSpec(kind);
  const clamped = Math.max(0, Math.min(1, raw));
  const plane = cubicBezierY(OVERLAY_PLANE_POINTS, clamped);
  const remaining = 1 - plane;
  const alpha = spec.fadesIn ? cubicBezierY(OVERLAY_EASE_POINTS, clamped) : 1;
  return {
    raw: clamped,
    plane,
    remaining,
    alpha,
    translateX: -spec.lateralDp * remaining,
    travelFactor:
      spec.travelKind === 'height' ? remaining : 1 - cubicBezierY(OVERLAY_SETTLE_POINTS, clamped),
    travelKind: spec.travelKind,
  };
}

/* ── CSS 帧表（components.css 同值内联，测试逐帧对拍） ──────────────────── */

/** 采样点（%）。头尾必取，中段 5/10/15 密一点以压住前 20% 的快速位移。 */
export const OVERLAY_FRAME_STOPS = [0, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

/** 与 CSS 一样只保留 4 位小数（避免 0.30000000000000004 这类尾数进入对拍）。 */
function fixed4(value: number): number {
  return Number(value.toFixed(4));
}

export interface OverlayKeyframeStop {
  /** 百分比（整数，直接写进 `N% { … }`）。 */
  readonly percent: number;
  readonly opacity: number;
  /** `translateX(calc(<lateral>px * <factor>))` 的系数。 */
  readonly lateralFactor: number;
  /** `translateY(calc(...))` 的系数（两种档位写法不同，见 `overlayKeyframeDeclarations`）。 */
  readonly travelFactor: number;
}

/** 某一档的全部采样帧（与 `components.css` 的 `@keyframes` 逐帧对拍）。 */
export function overlayKeyframeStops(kind: OverlayEntranceKind): readonly OverlayKeyframeStop[] {
  const lateralDp = overlayEntranceSpec(kind).lateralDp;
  return OVERLAY_FRAME_STOPS.map((percent) => {
    const frame = overlayEntranceFrame(kind, percent / 100);
    return {
      percent,
      opacity: fixed4(frame.alpha),
      lateralFactor: fixed4(-frame.translateX / lateralDp),
      travelFactor: fixed4(frame.travelFactor),
    };
  });
}

/**
 * 一个采样帧在 CSS 里的**逐字**声明（两条，按 `opacity` / `transform` 的顺序）。
 * 测试直接把这段字符串拿去 `toContain`，所以任何一侧改数值都会红。
 */
export function overlayKeyframeDeclarations(kind: OverlayEntranceKind, stop: OverlayKeyframeStop): string {
  const spec = overlayEntranceSpec(kind);
  const travel =
    spec.travelKind === 'height'
      ? `calc((100% + ${String(OVERLAY_SHEET_BOTTOM_INSET_DP)}px) * ${String(stop.travelFactor)})`
      : `calc(${String(OVERLAY_DIALOG_TRAVEL_DP)}px * ${String(stop.travelFactor)})`;
  return [
    `opacity: ${String(stop.opacity)};`,
    `transform: translateX(calc(-${String(spec.lateralDp)}px * ${String(stop.lateralFactor)})) translateY(${travel});`,
  ].join('\n');
}

/* ── ScrimEntrance L61-78 ───────────────────────────────────────────────── */

/** L66 `LaunchedEffect(shared) { if (shared == null) standaloneVisible = true }` 的首帧状态。 */
export const OVERLAY_SCRIM_STANDALONE_INITIAL = false;

/**
 * L69-76 `animateFloatAsState(if (open) 1f else 0f, tween(if (open) durationMillis else EXIT_MS, easing = plane))`。
 * 注意 easing 是 **plane**，不是 `ease` —— 遮罩与面板本体用的是不同曲线。
 */
export function overlayScrimSpec(open: boolean, durationMillis: number = OVERLAY_ENTER_MS): {
  readonly target: number;
  readonly durationMs: number;
  readonly easingCss: string;
} {
  return {
    target: open ? 1 : 0,
    durationMs: open ? durationMillis : OVERLAY_EXIT_MS,
    easingCss: OVERLAY_PLANE_CSS,
  };
}

/* ── PullOutScrim L80-86 ───────────────────────────────────────────────── */

/**
 * L84-85 `fadeIn(PullOutConfig.spring(true))` / `fadeOut(PullOutConfig.spring(false))`。
 *
 * ⚠️ 这两个 spring 是**近临界**的（`PullOutMotion.kt` L44-48 `OPEN_K = 140, OPEN_D = 24`、
 * `CLOSE_K = 260, CLOSE_D = 34`），阻尼比 = D / (2√K) ≈ 1.014 / 1.054 —— 略过阻尼，
 * 不会有可见回弹。CSS 侧用 `ease-out` 近似并在注释里写明来源；两个 K/D 是权威值，
 * 由 `pullOutHosts.ts` 的 `PULL_OUT_SPRING` 承载。
 *
 * ⚠️ 形参 `enter` / `exit`（L82）在 Kotlin 里**声明了但没有用** —— 函数体内直接用
 * `fadeIn(...)` / `fadeOut(...)` 覆盖。端口保留同签名并同样忽略它们，以免调用方
 * 以为传入的转场会生效。
 */
export function pullOutScrimSpec(visible: boolean): {
  readonly target: number;
  readonly opening: boolean;
  readonly easingCss: string;
} {
  return {
    target: visible ? 1 : 0,
    opening: visible,
    easingCss: 'cubic-bezier(0.25, 1, 0.5, 1)',
  };
}

/* ── 内容错峰（`WenkuContentClock`）────────────────────────────────────── */

/** `WenkuMotion.LIST_WINDOW = 0.52f` —— 内容在这段进度窗口内依次浮现。 */
export const OVERLAY_CONTENT_WINDOW = 0.52;

/** `WenkuMotion.LIST_DELAY_STEP = 0.055f` —— 每个子块之间的进度间隔。 */
export const OVERLAY_CONTENT_STEP = 0.055;

/** `WenkuMotion.LIST_MAX_DELAY_BANDS = 8` —— 最多 8 档，超出共用最后一档。 */
export const OVERLAY_CONTENT_MAX_BANDS = 8;

/**
 * 第 `index` 个子块在**整段动画**里的延迟（毫秒）。
 *
 * `WenkuContentClock` 按进度窗口把内容分档浮现：第 `index` 档从
 * `index * LIST_DELAY_STEP * progress` 起算，最多 8 档。换算到 CSS 的
 * `animation-delay` 时，档位延迟 = `(index * STEP * ENTER_MS)`，但整个窗口
 * 不超过 `LIST_WINDOW * ENTER_MS`，所以取两者较小值。
 */
export function overlayContentDelayMs(index: number, enterMs: number = OVERLAY_ENTER_MS): number {
  const band = Math.min(Math.max(index, 0), OVERLAY_CONTENT_MAX_BANDS);
  const raw = band * OVERLAY_CONTENT_STEP * enterMs;
  return Math.min(raw, OVERLAY_CONTENT_WINDOW * enterMs);
}
