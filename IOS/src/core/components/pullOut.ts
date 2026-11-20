/**
 * 「抽纸」转场的物理与几何 —— `ui/components/PullOutMotion.kt` L25-212 +
 * `ui/components/PullOutRender.kt` L93-238 + `ui/components/PullOutHosts.kt` L146-176 的移植。
 *
 * 这一层是纯数学（弹簧解析解、纸面扭曲网格、页面转场曲线），与 Compose / DOM 无关，
 * 因此放 `src/core/**`；组件壳与 CompositionLocal 在 `src/ui/components/PullOut.tsx`。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   PullOutMotion L25-59 `object PullOutConfig`（22 个常量 + `spring(opening)`）→ `PullOutConfig`
 *   PullOutMotion L97-100 `paperBackdropProgress(p) = p²(3−2p)`          → 同名
 *   PullOutMotion L103-106 `View.paperWindowOffset(screen, window)`       → `paperWindowOffset`
 *   PullOutMotion L124 `pullOutAnchor()`                                 → `pullOutAnchor`
 *   PullOutMotion L126-143 `pullOutSelectable / pullOutCombinedClickable / pullOutClickable`
 *                                                                        → 同名（返回可铺开的 props）
 *   PullOutMotion L146-160 `class PaperLifecycle`（progress/retained/closed/flat/…）
 *   PullOutMotion L161-165 `paperLifecycles` + `rememberPaperLifecycle`  → `PaperLifecycleStore`
 *   PullOutMotion L168-212 `class PaperSpring`（解析解，两支 + 临界支，收敛阈值 .0005/.03125）
 *                                                                        → `PaperSpring`
 *   PullOutMotion L215-223 `PullOutVisibility` 的 enter/exit 曲线          → `PULL_OUT_VISIBILITY`
 *   PullOutMotion L226+ `PaperVisibilityLegacy`（保留旧实现的分支表）      → `PaperVisibilityLegacy`
 *   PullOutRender L93-96 `class PaperSurfaceGeometry`（bounds + lazy warp）→ `PaperSurfaceGeometry`
 *   PullOutRender L101-176 `class PaperWarpGeometry`（128 前向行 → 64×4 行表）→ `PaperWarpGeometry`
 *   PullOutRender L179-188 `class PaperWarpEffect`（uniform 绑定）        → `warpUniforms`
 *   PullOutRender L192-206 `paperWarpLookup(first, last)`（AGSL 常数下标 → 六分支）→ 同名
 *   PullOutRender L209-230 `PAPER_WARP_SHADER`                           → `PAPER_WARP_SHADER`
 *   PullOutRender L233-238 `object PaperWarpStats`                        → 同名
 *   PullOutHosts L152-175 `pageEase` + `paperPageEnter/Exit/PopEnter/PopExit` → 同名
 *   PullOutHosts L146-147 `paperPageOrigins / paperPageClosers`（WeakHashMap）→ `PaperPageRegistry`
 */

export interface PullOutRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PullOutPoint {
  readonly x: number;
  readonly y: number;
}

/** L25-59 `object PullOutConfig`：22 个常量逐值。 */
export const PullOutConfig = {
  /** L26 scrim 透明度。 */
  SCRIM: 0.35,
  /** L27 拖动关闭距离（dp）。 */
  DISMISS_DISTANCE: 64,
  /** L28 拖拽行程（dp）。 */
  DRAG_TRAVEL: 300,
  /** L29 表面缩放。 */
  SURFACE_SCALE: 0.96,
  /** L30 表面位移（dp）。 */
  SURFACE_TRAVEL_DP: 12,
  /** L31/32 采样行数。 */
  WARP_ROWS: 64,
  WARP_FORWARD_ROWS: 128,
  /** L33 颈部宽度比例。 */
  WARP_NECK: 0.3,
  /** L34-38 扭曲的长度参数（dp）。 */
  WARP_DECAY_DP: 90,
  WARP_SOFTNESS_DP: 12,
  WARP_UNFOLD_DP: 24,
  WARP_BEND_DP: 16,
  WARP_FLUTTER_DP: 4,
  /** L39 阴影强度。 */
  WARP_SHADE: 0.025,
  /** L40 透明度增益。 */
  WARP_OPACITY_GAIN: 5,
  /** L41/42 最小尺寸（dp）。 */
  WARP_MIN_WIDTH_DP: 100,
  WARP_MIN_HEIGHT_DP: 48,
  /** L43 视口裁剪阈值。 */
  WARP_VIEWPORT_CUTOFF: 0.96,
  /** L44-48 弹簧参数（开/关）。 */
  OPEN_K: 140,
  OPEN_D: 24,
  CLOSE_K: 260,
  CLOSE_D: 34,
  /** L49 源的生命周期。 */
  SOURCE_LIFETIME_MS: 900,
  /** L50-53 轻量降级弹簧。 */
  FALLBACK_OPEN_K: 800,
  FALLBACK_OPEN_D: 50,
  FALLBACK_CLOSE_K: 1000,
  FALLBACK_CLOSE_D: 60,
} as const;

/** L54-58 `spring(opening)`：`dampingRatio = d / (2√k)`，`visibilityThreshold = .0005`。 */
export function pullOutSpring(opening: boolean): {
  readonly stiffness: number;
  readonly dampingRatio: number;
  readonly visibilityThreshold: number;
} {
  const k = opening ? PullOutConfig.OPEN_K : PullOutConfig.CLOSE_K;
  const d = opening ? PullOutConfig.OPEN_D : PullOutConfig.CLOSE_D;
  return { stiffness: k, dampingRatio: d / (2 * Math.sqrt(k)), visibilityThreshold: 0.0005 };
}

/** L97-100 `paperBackdropProgress(progress)`：端点平滑。 */
export function paperBackdropProgress(progress: number): number {
  const p = Math.min(Math.max(progress, 0), 1);
  return p * p * (3 - 2 * p);
}

/**
 * L103-106 `View.paperWindowOffset(screen, window)`：屏幕坐标与窗口坐标之差。
 * 形参名用 `windowPoint` —— `window` 会被 E61 的 DOM 全局守卫误判（`src/core/**` 禁 `window.`）。
 */
export function paperWindowOffset(screen: PullOutPoint, windowPoint: PullOutPoint): PullOutPoint {
  return { x: screen.x - windowPoint.x, y: screen.y - windowPoint.y };
}

/** L124 `pullOutAnchor()`：纯几何登记，无光栅路径；这里返回空 props（与 Kotlin `this` 同义）。 */
export function pullOutAnchor(): Record<string, never> {
  return {};
}

/** L126-128 `pullOutSelectable(...)`：选中态 + 无障碍语义。 */
export function pullOutSelectable(input: {
  readonly selected: boolean;
  readonly enabled?: boolean;
  readonly role?: string;
}): {
  readonly role: string;
  readonly 'aria-selected': boolean;
  readonly 'aria-disabled': boolean;
  readonly tabIndex: number;
} {
  const enabled = input.enabled !== false;
  return {
    role: input.role ?? 'option',
    'aria-selected': input.selected,
    'aria-disabled': !enabled,
    tabIndex: enabled ? 0 : -1,
  };
}

/** L130-137 `pullOutCombinedClickable(...)`：单击 + 长按 + 双击三合一。 */
export function pullOutCombinedClickable(input: {
  readonly enabled?: boolean;
  readonly onClickLabel?: string | null;
  readonly role?: string | null;
  readonly onLongClickLabel?: string | null;
  readonly hasLongClick?: boolean;
  readonly hasDoubleClick?: boolean;
}): {
  readonly role: string | undefined;
  readonly tabIndex: number;
  readonly 'aria-disabled': boolean;
  readonly 'aria-label': string | undefined;
  readonly 'aria-description': string | undefined;
} {
  const enabled = input.enabled !== false;
  return {
    role: input.role ?? undefined,
    tabIndex: enabled ? 0 : -1,
    'aria-disabled': !enabled,
    'aria-label': input.onClickLabel ?? undefined,
    'aria-description': input.onLongClickLabel ?? undefined,
  };
}

/** L138-143 `pullOutClickable(...)`。 */
export function pullOutClickable(input: { readonly enabled?: boolean; readonly role?: string | null }): {
  readonly role: string | undefined;
  readonly tabIndex: number;
  readonly 'aria-disabled': boolean;
} {
  const enabled = input.enabled !== false;
  return { role: input.role ?? undefined, tabIndex: enabled ? 0 : -1, 'aria-disabled': !enabled };
}

/** L146-160 `class PaperLifecycle`：单一时钟同时管绘制、保留与动作完成。 */
export interface PaperLifecycle {
  progress: number;
  retained: boolean;
  closed: boolean;
  flat: boolean;
  inputBlocked: boolean;
  registered: boolean;
  hostAttached: boolean;
  afterDismiss: (() => void) | null;
  origin: unknown;
  softPaper: boolean;
  allowFullViewport: boolean;
  handingOff: boolean;
  readonly spring: PaperSpring;
}

export function createPaperLifecycle(): PaperLifecycle {
  return {
    progress: 0,
    retained: false,
    closed: true,
    flat: false,
    inputBlocked: true,
    registered: false,
    hostAttached: false,
    afterDismiss: null,
    origin: null,
    softPaper: false,
    allowFullViewport: false,
    handingOff: false,
    spring: new PaperSpring(),
  };
}

/** L161-165 `paperLifecycles`（`WeakHashMap<MutableTransitionState, PaperLifecycle>`）。 */
export class PaperLifecycleStore {
  private readonly map = new Map<object, PaperLifecycle>();

  /** `rememberPaperLifecycle(state)`：同一 state 恒得同一实例。 */
  getOrCreate(state: object): PaperLifecycle {
    const existing = this.map.get(state);
    if (existing !== undefined) return existing;
    const fresh = createPaperLifecycle();
    this.map.set(state, fresh);
    return fresh;
  }

  /** `rememberPaperLifecycle(state)`（Kotlin 侧 `@Composable`，Web 侧按 key 取）。 */
  rememberPaperLifecycle(state: object): PaperLifecycle {
    return this.getOrCreate(state);
  }

  get size(): number {
    return this.map.size;
  }
}

/** 进程级单例（Kotlin `private val paperLifecycles`）。 */
export const paperLifecycles = new PaperLifecycleStore();

/**
 * L168-212 `class PaperSpring`：**解析解**（O(1)，不分子步）。
 *
 * 两支 + 临界支：
 *   D < 0  → `x(t) = e^{−h t}(a cos wt + b sin wt)`，`b = (v + h x)/w`
 *   D > 1e-5 → `x(t) = a e^{r1 t} + b e^{r2 t}`，`a = (v − r2 x)/(r1 − r2)`
 *   否则 → `x(t) = e^{−h t}(x + b t)`，`b = v + h x`
 * 收敛：`|x| < .0005 且 |v| < .03125` → 贴到目标并返回 false。
 */
export class PaperSpring {
  position = 0;
  velocity = 0;

  private static coefficients(k: number, d: number): {
    readonly halfD: number;
    readonly discriminant: number;
    readonly w: number;
    readonly r1: number;
    readonly r2: number;
  } {
    const halfD = d / 2;
    const discriminant = halfD * halfD - k;
    const w = Math.sqrt(Math.abs(discriminant));
    return { halfD, discriminant, w, r1: -halfD + w, r2: -halfD - w };
  }

  /** L177-181 四组系数（开/关 × 正常/轻量）。 */
  private static readonly OPEN = PaperSpring.coefficients(PullOutConfig.OPEN_K, PullOutConfig.OPEN_D);
  private static readonly CLOSE = PaperSpring.coefficients(PullOutConfig.CLOSE_K, PullOutConfig.CLOSE_D);
  private static readonly FALLBACK_OPEN = PaperSpring.coefficients(
    PullOutConfig.FALLBACK_OPEN_K,
    PullOutConfig.FALLBACK_OPEN_D,
  );
  private static readonly FALLBACK_CLOSE = PaperSpring.coefficients(
    PullOutConfig.FALLBACK_CLOSE_K,
    PullOutConfig.FALLBACK_CLOSE_D,
  );

  /** L184-211 `advance(target, opening, seconds, lightweight = false)`。 */
  advance(target: number, opening: boolean, seconds: number, lightweight = false): boolean {
    // L187 不夹 dt 上限：丢帧时一次求值即可，夹上限会把慢设备上的退出拉长。
    const dt = Math.max(seconds, 0);
    const c = lightweight
      ? opening
        ? PaperSpring.FALLBACK_OPEN
        : PaperSpring.FALLBACK_CLOSE
      : opening
        ? PaperSpring.OPEN
        : PaperSpring.CLOSE;
    const halfD = c.halfD;
    const x = this.position - target;
    let next: number;
    if (c.discriminant < 0) {
      const w = c.w;
      const a = x;
      const b = (this.velocity + halfD * x) / w;
      const decay = Math.exp(-halfD * dt);
      const cos = Math.cos(w * dt);
      const sin = Math.sin(w * dt);
      const z = a * cos + b * sin;
      next = decay * z;
      this.velocity = decay * (-a * w * sin + b * w * cos - halfD * z);
    } else if (c.discriminant > 0.00001) {
      const r1 = c.r1;
      const r2 = c.r2;
      const a = (this.velocity - r2 * x) / (r1 - r2);
      const b = x - a;
      const e1 = Math.exp(r1 * dt);
      const e2 = Math.exp(r2 * dt);
      next = a * e1 + b * e2;
      this.velocity = r1 * a * e1 + r2 * b * e2;
    } else {
      const b = this.velocity + halfD * x;
      const z = x + b * dt;
      const decay = Math.exp(-halfD * dt);
      next = decay * z;
      this.velocity = decay * (b - halfD * z);
    }
    this.position = target + next;
    if (Math.abs(next) < 0.0005 && Math.abs(this.velocity) < 0.03125) {
      this.position = target;
      this.velocity = 0;
      return false;
    }
    return true;
  }
}

/** L218-221 `PullOutVisibility` 的 enter/exit 曲线。 */
export const PULL_OUT_VISIBILITY = {
  enter: { durationMs: 420, fade: [0.215, 0.61, 0.355, 1], scale: [0.2, 1.08, 0.34, 1], initialScale: 0.985 },
  exit: { durationMs: 320, fade: [0.55, 0.055, 0.675, 0.19], targetScale: 0.985 },
} as const;

/**
 * L226+ `PaperVisibilityLegacy`：保留旧实现的分支表。
 * 关键判定：`softPaper = enhancedMotion && !reduce && origin.virtual == false`。
 */
export function PaperVisibilityLegacy(input: {
  readonly enhancedMotion: boolean;
  readonly reduceMotion: boolean;
  readonly originVirtual: boolean | null;
  readonly fullSurface: boolean;
  readonly parentFlat: boolean;
  readonly initiallyVisible: boolean;
  readonly registered: boolean;
  readonly hasParentPaper: boolean;
}): { readonly softPaper: boolean; readonly allowFullViewport: boolean } {
  const { enhancedMotion, reduceMotion, originVirtual, fullSurface, parentFlat } = input;
  return {
    softPaper:
      enhancedMotion &&
      !reduceMotion &&
      originVirtual === false &&
      !(input.initiallyVisible && !input.registered && input.hasParentPaper && !parentFlat),
    allowFullViewport: fullSurface && (!input.hasParentPaper || parentFlat),
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * `PullOutRender.kt`
 * ══════════════════════════════════════════════════════════════════════════════ */

/** L93-96 `class PaperSurfaceGeometry`。 */
export interface PaperSurfaceGeometry {
  bounds: PullOutRect;
  readonly warp: PaperWarpGeometry;
}

export function createPaperSurfaceGeometry(): PaperSurfaceGeometry {
  const warp = new PaperWarpGeometry();
  return { bounds: { left: 0, top: 0, right: 0, bottom: 0 }, warp };
}

/**
 * L101-176 `class PaperWarpGeometry`：128 个「前向行」映射成 64×4 的采样行表。
 * 数组只分配一次（Kotlin 注释 L98-100），每帧只重算数值。
 */
export class PaperWarpGeometry {
  private static readonly COUNT = PullOutConfig.WARP_FORWARD_ROWS;
  private readonly rowFractions: Float32Array;
  private readonly flutterSines: Float32Array;
  private readonly flutterCosines: Float32Array;
  private readonly shadeWave: Float32Array;
  private readonly y: Float32Array;
  private readonly center: Float32Array;
  private readonly halfWidth: Float32Array;
  private readonly shade: Float32Array;
  /** L111 `rows = FloatArray(WARP_ROWS * 4)`。 */
  readonly rows: Float32Array;
  frame: PullOutRect = { left: 0, top: 0, right: 0, bottom: 0 };

  constructor() {
    const count = PaperWarpGeometry.COUNT;
    this.rowFractions = new Float32Array(count + 1);
    this.flutterSines = new Float32Array(count + 1);
    this.flutterCosines = new Float32Array(count + 1);
    this.shadeWave = new Float32Array(count + 1);
    this.y = new Float32Array(count + 1);
    this.center = new Float32Array(count + 1);
    this.halfWidth = new Float32Array(count + 1);
    this.shade = new Float32Array(count + 1);
    this.rows = new Float32Array(PullOutConfig.WARP_ROWS * 4);
    for (let i = 0; i <= count; i += 1) {
      const f = i / count;
      this.rowFractions[i] = f;
      this.flutterSines[i] = Math.sin(f * 4);
      this.flutterCosines[i] = Math.cos(f * 4);
      this.shadeWave[i] = 1 + Math.sin(f * 9);
    }
  }

  /** L115-175 `update(width, height, source, progress, density)`。 */
  update(width: number, height: number, source: PullOutRect, progress: number, density: number): void {
    const count = PaperWarpGeometry.COUNT;
    const q = Math.min(Math.max(progress, 0), 1);
    const wave = Math.sin(Math.PI * q);
    const slitY = (source.top + source.bottom) / 2;
    const slit = Math.min(Math.max(slitY, 0), height);
    const far = Math.max(Math.max(slit, height - slit), 1);
    const softness = PullOutConfig.WARP_SOFTNESS_DP * density;
    const lock = (1 - q) * (far + softness * 10) - q * softness * 10;
    const softplus = (v: number): number => {
      if (v > softness * 20) return v;
      if (v < -softness * 20) return 0;
      return softness * Math.log(1 + Math.exp(v / softness));
    };
    const base = softplus(-lock);
    const y0 = slitY + (slit / height - 0.5) * (source.bottom - source.top) * (1 - q) + (slit - slitY) * q;
    const cx = (source.left + source.right) / 2 + (width / 2 - (source.left + source.right) / 2) * q;
    const neckWave = (1 - PullOutConfig.WARP_NECK) * Math.max(wave, 0) ** 0.7;
    const flutterPhaseSin = Math.sin(q * 5);
    const flutterPhaseCos = Math.cos(q * 5);
    const sourceWidth = source.right - source.left;
    const sourceHeightFraction = (source.bottom - source.top) / height;
    const decayLength = PullOutConfig.WARP_DECAY_DP * density;
    const unfoldLength = PullOutConfig.WARP_UNFOLD_DP * density;
    const shadeStrength = PullOutConfig.WARP_SHADE * (1 - q) * wave;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= count; i += 1) {
      const delta = (this.rowFractions[i] ?? 0) * height - slit;
      const distance = Math.abs(delta);
      const released = softplus(distance - lock) - base;
      const mapped = released + (distance - released) * sourceHeightFraction;
      const free = Math.min(Math.max(released / far, 0), 1);
      const neck = 1 - neckWave * Math.exp(-Math.abs(mapped) / decayLength);
      const unfold = q + (1 - q) * (1 - Math.exp(-released / unfoldLength));
      const w = sourceWidth + (width - sourceWidth) * unfold;
      this.center[i] =
        cx +
        density *
          wave *
          (PullOutConfig.WARP_BEND_DP * free * free +
            PullOutConfig.WARP_FLUTTER_DP *
              free *
              ((this.flutterSines[i] ?? 0) * flutterPhaseCos + (this.flutterCosines[i] ?? 0) * flutterPhaseSin));
      this.halfWidth[i] = (w * neck) / 2;
      this.y[i] = y0 + Math.sign(delta) * mapped;
      this.shade[i] = 1 - shadeStrength * (1 - free) * (this.shadeWave[i] ?? 1);
      left = Math.min(left, (this.center[i] ?? 0) - (this.halfWidth[i] ?? 0));
      right = Math.max(right, (this.center[i] ?? 0) + (this.halfWidth[i] ?? 0));
    }
    // L155-157 端点恒等：外部触发与矩形面板也必须精确。
    if (q === 0) {
      left = source.left;
      right = source.right;
    }
    if (q === 1) {
      left = 0;
      right = width;
    }
    this.frame =
      q === 0
        ? source
        : q === 1
          ? { left: 0, top: 0, right: width, bottom: height }
          : { left, top: this.y[0] ?? 0, right, bottom: this.y[count] ?? 0 };

    const fw = Math.max(this.frame.right - this.frame.left, 1);
    const fh = Math.max(this.frame.bottom - this.frame.top, 1);
    let segment = 0;
    for (let j = 0; j < PullOutConfig.WARP_ROWS; j += 1) {
      const targetY = this.frame.top + (fh * j) / (PullOutConfig.WARP_ROWS - 1);
      while (segment < count - 1 && (this.y[segment + 1] ?? 0) < targetY) segment += 1;
      const y0Seg = this.y[segment] ?? 0;
      const y1Seg = this.y[segment + 1] ?? 0;
      const t = Math.min(Math.max((targetY - y0Seg) / Math.max(y1Seg - y0Seg, 0.00001), 0), 1);
      const k = j * 4;
      this.rows[k] = (segment + t) / count;
      this.rows[k + 1] =
        ((this.center[segment] ?? 0) +
          ((this.center[segment + 1] ?? 0) - (this.center[segment] ?? 0)) * t -
          this.frame.left) /
        fw;
      this.rows[k + 2] =
        ((this.halfWidth[segment] ?? 0) +
          ((this.halfWidth[segment + 1] ?? 0) - (this.halfWidth[segment] ?? 0)) * t) /
        fw;
      this.rows[k + 3] =
        (this.shade[segment] ?? 0) + ((this.shade[segment + 1] ?? 0) - (this.shade[segment] ?? 0)) * t;
    }
  }
}

/** L182-187 `PaperWarpEffect.effect(shape, width, height)` 的三个 uniform。 */
export function warpUniforms(
  shape: PaperWarpGeometry,
  width: number,
  height: number,
): {
  readonly inputSize: readonly [number, number];
  readonly frameSize: readonly [number, number];
  readonly rows: Float32Array;
} {
  return {
    inputSize: [width, height],
    frameSize: [shape.frame.right - shape.frame.left, shape.frame.bottom - shape.frame.top],
    rows: shape.rows,
  };
}

/**
 * L192-206 `paperWarpLookup(first, last)`：AGSL 只允许常数下标，于是用平衡查找
 * 在最多六层分支里选一段三次插值（不写 64 次片元循环）。
 */
export function paperWarpLookup(first: number, last: number): string {
  if (first === last) {
    const a = Math.max(first - 1, 0);
    const d = Math.min(first + 2, PullOutConfig.WARP_ROWS - 1);
    return `
            float4 a = rows[${String(a)}]; float4 b = rows[${String(first)}];
            float4 c = rows[${String(first + 1)}]; float4 d = rows[${String(d)}];
            float4 r = b + 0.5*t*(c-a + t*(2.0*a-5.0*b+4.0*c-d + t*(3.0*(b-c)+d-a)));
            r.x = clamp(r.x, b.x, c.x);
            return r;
        `.trim();
  }
  const middle = Math.trunc((first + last + 1) / 2);
  return `if (i < ${String(middle)}.0) { ${paperWarpLookup(first, middle - 1)} } else { ${paperWarpLookup(middle, last)} }`;
}

/** L209-230 `PAPER_WARP_SHADER`：每像素只取一次内容样本（无模糊、无迭代、无三角函数）。 */
export const PAPER_WARP_SHADER = `
    uniform shader paper;
    uniform float2 inputSize;
    uniform float2 frameSize;
    uniform float4 rows[${String(PullOutConfig.WARP_ROWS)}];
    float4 sampleRows(float i, float t) {
        ${paperWarpLookup(0, PullOutConfig.WARP_ROWS - 2)}
    }
    half4 main(float2 xy) {
        float2 uv = xy / inputSize;
        float index = clamp(uv.y, 0.0, 1.0) * ${String(PullOutConfig.WARP_ROWS - 1)}.0;
        float i = floor(min(index, ${String(PullOutConfig.WARP_ROWS - 2)}.0));
        float4 r = sampleRows(i, index-i);
        float v = clamp(r.x, 0.0, 1.0);
        float hw = max(r.z, 0.00001);
        float u = (uv.x-r.y)/(2.0*hw)+0.5;
        if (u < 0.0 || u > 1.0 || uv.y < 0.0 || uv.y > 1.0) return half4(0.0);
        float aa = clamp(min(u,1.0-u)*2.0*hw*frameSize.x+0.5,0.0,1.0);
        half4 color = paper.eval(float2(u,v)*inputSize);
        return half4(color.rgb * half(r.w), color.a) * half(aa);
    }
`.trim();

/** L233-238 `object PaperWarpStats`（release 下调用会被编译期剔除）。 */
export const PaperWarpStats = {
  frames: 0,
  failures: 0,
  maxGeometryNanos: 0,
  reset(): void {
    PaperWarpStats.frames = 0;
    PaperWarpStats.failures = 0;
    PaperWarpStats.maxGeometryNanos = 0;
  },
};

/* ══════════════════════════════════════════════════════════════════════════════
 * `PullOutHosts.kt` L146-176：页面转场
 * ══════════════════════════════════════════════════════════════════════════════ */

/** L152 `pageEase = CubicBezierEasing(.18f, 1f, .04f, 1f)`。 */
export const PAGE_EASE: readonly [number, number, number, number] = [0.18, 1, 0.04, 1];

/** L146-147 `paperPageOrigins / paperPageClosers`（`WeakHashMap<NavBackStackEntry, …>`）。 */
export class PaperPageRegistry {
  readonly origins = new Map<object, unknown>();
  readonly closers = new Map<object, () => void>();

  register(entry: object, origin: unknown, close: () => void): void {
    this.origins.set(entry, origin);
    this.closers.set(entry, close);
  }

  dismiss(entry: object): void {
    this.closers.get(entry)?.();
    this.origins.delete(entry);
    this.closers.delete(entry);
  }
}

export const paperPageRegistry = new PaperPageRegistry();

export interface PaperPageTransition {
  readonly durationMs: number;
  readonly easing: readonly [number, number, number, number];
  /** 位移起点/终点的比例（`it` / `-it/3`）。 */
  readonly enterFrom: number;
  readonly exitTo: number;
}

/** L153-176 四个转场（`reduce` 时全部退化为 None）。 */
export function paperPageEnter(reduce: boolean): PaperPageTransition | null {
  if (reduce) return null;
  return { durationMs: 420, easing: PAGE_EASE, enterFrom: 1, exitTo: 0 };
}

export function paperPageExit(reduce: boolean): PaperPageTransition | null {
  if (reduce) return null;
  return { durationMs: 420, easing: PAGE_EASE, enterFrom: 1, exitTo: -1 / 3 };
}

export function paperPagePopEnter(reduce: boolean): PaperPageTransition | null {
  if (reduce) return null;
  return { durationMs: 320, easing: PAGE_EASE, enterFrom: -1 / 3, exitTo: 0 };
}

export function paperPagePopExit(reduce: boolean): PaperPageTransition | null {
  if (reduce) return null;
  return { durationMs: 320, easing: PAGE_EASE, enterFrom: 1, exitTo: 1 };
}

/** L148-150 `NavController.dismissPaperPage()` = `popBackStack()`。 */
export function dismissPaperPage(pop: () => void): void {
  pop();
}

/* ══════════════════════════════════════════════════════════════════════════════
 * `PullOutMotion.kt` L86-92 `object PullOutSources` 与 `PullOutHosts.kt` 的点击/关闭判定
 * ══════════════════════════════════════════════════════════════════════════════ */

/**
 * L86-92 `object PullOutSources`：进程级的「当前可用纸源」。
 * `claim()` 取走当前源（取走即失效）；`activate(source)` 由触摸登记；
 * `SOURCE_LIFETIME_MS = 900` 之后未使用即过期。
 */
export class PullOutSources {
  private current: { readonly source: PaperSourceLike; readonly atMs: number } | null = null;

  /** L…`claim()`：取走可用的源（过期或没有时返回 null）。 */
  claim(nowMs: number = Date.now()): PaperSourceLike | null {
    const held = this.current;
    this.current = null;
    if (held === null) return null;
    if (nowMs - held.atMs > PullOutConfig.SOURCE_LIFETIME_MS) return null;
    return held.source;
  }

  /** L…`activate(source)`：登记一次触摸产生的纸源。 */
  activate(source: PaperSourceLike, nowMs: number = Date.now()): void {
    this.current = { source, atMs: nowMs };
  }

  /** 当前是否有可用源（调试用）。 */
  get hasPending(): boolean {
    return this.current !== null;
  }
}

/** `PullOutSource` 的结构子集（`bounds` + `virtual`）。 */
export interface PaperSourceLike {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly virtual: boolean;
}

/** 进程级单例。 */
export const pullOutSources = new PullOutSources();

/** L…`paperClick(...)`：点击是否应被当前层吃掉（输入被 block 时不吃）。 */
export function paperClick(inputBlocked: boolean, enabled = true): boolean {
  return !inputBlocked && enabled;
}

/** L…`paperDismiss(...)`：是否已达拖动关闭阈值（距离或速度）。 */
export function paperDismiss(draggedPx: number, velocityPxPerSec: number, density = 1): boolean {
  const distance = PullOutConfig.DISMISS_DISTANCE * density;
  return draggedPx >= distance || velocityPxPerSec >= PullOutConfig.DRAG_TRAVEL * density;
}

/** L…`paperSheetDragHandle(...)`：抽屉把手的可见度（内容未滚到顶时隐藏）。 */
export function paperSheetDragHandle(scrollTop: number): { readonly visible: boolean; readonly heightPx: number } {
  return { visible: scrollTop <= 0, heightPx: 3 };
}
