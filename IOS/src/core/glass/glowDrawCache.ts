/**
 * `me/trishiraj/shadowglow/GlowDrawCache.kt`（99 行 / 84 非空）→ `@core/glass/glowDrawCache`。
 *
 * ⚠️ 端口此前是 `parityMisc.ts` 里的两个**空壳类** —— 只有构造字段，`draw` 一个都没有，
 * 而且 `cornerRadius` / `sigma` / `trailFraction` 三个字段还被改名成
 * `radius` / `blurSigma` / `lengthFraction`（7 处字段里 3 处漂移）。
 * 也就是说 `signature`、σ 量化、`changed` 判定、trail 的分段与环绕**全部不存在**
 * （见 E212）。本模块补真身：只产出**可判定的数值与解析请求**，绘制由 UI 层做。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `RoundRectGlowDrawCache` 的八个构造参数 | L14-23 | `RoundRectGlowDrawCacheInput` |
 * | `previousLeft/Top/Right/Bottom = Float.NaN` | L26-29 | `ROUND_RECT_INITIAL_PREVIOUS` |
 * | `previousSigma = Int.MIN_VALUE` | L31 | `ROUND_RECT_INITIAL_SIGMA_KEY` |
 * | `totalOffsetX/Y` + 四边 | L36-41 | `roundRectGlowBounds()` |
 * | `if (right <= left \|\| bottom <= top) return` | L42 | `bounds.visible` |
 * | `changed = left != previousLeft \|\| …` | L43 | `roundRectGlowChanged()` |
 * | `radius = cornerRadius.coerceIn(0f, (right - left) / 2f)` | L46 | `roundRectGlowRadius()` |
 * | `signature = "RR\|…\|…\|…"` | L51 | `roundRectGlowSignature()` |
 * | `if (sigma.isNaN() \|\| sigma < 0f)` | L53 | `roundRectGlowSigmaInvalid()` |
 * | `sigmaKey = (sigma * 2f).roundToInt()` | L56 | `roundRectGlowSigmaKey()` |
 * | `if (changed \|\| sigmaKey != previousSigma)` | L57 | `needsResolve` |
 * | `GlowTrailDrawCache` 的五个构造参数 | L67-73 | `GlowTrailDrawCacheInput` |
 * | `segmentLength = length * trailFraction.coerceIn(.01f, 1f)` | L77 | `trailSegmentPlan()` |
 * | `if (length <= 0f) return` | L83 | `plan.visible` |
 * | `start = (progress * length) % length` / `end = start + segmentLength` | L84-85 | 同上 |
 * | `getSegment(start, end)` 与环绕两段 | L87-92 | `trailSegmentRanges()` |
 *
 * 五处只有读原文才会发现的语义
 * ───────────────────────────
 * 1. **σ 被量化到「半个像素」再进缓存**（L56 `(sigma * 2f).roundToInt()`）。同一个桶里
 *    复用解析结果是**像素级等价**的（L54-55 的注释），但写成「直接用 sigma 当键」会
 *    让每帧都 miss —— 动画期每帧 σ 都在动，缓存等于没有。
 * 2. **`changed` 只看四边，且是精确浮点比较**（L43）。`parallaxX/Y` 参与四边计算，
 *    所以视差一动就 `changed`；而 `sigma` 变化不算 `changed`，它走自己的 `sigmaKey` 比较。
 * 3. **`sigma` 非法时要清缓存**（L53 `shadow = null; previousSigma = Int.MIN_VALUE; return`）。
 *    把 `previousSigma` 复位成哨兵值，是为了让「非法 → 恢复合法」时**重新解析**；
 *    只置 `shadow = null` 而不复位，恢复正常后会命中一个已置空的旧 key 从而画不出东西。
 * 4. **签名的三处 `* 2f` 是为了「半像素」粒度**（L51）：`(right-left)*2`、`(bottom-top)*2`、
 *    `radius*2` 都 `roundToInt`。签名的单位是**半像素**，不是像素 —— 直接写像素会让
 *    「差半像素」的两个轮廓共用同一条缓存，模糊边缘差一格。
 * 5. **轨迹环绕必须拆成两段**（L87-92）：`end > length` 时先取 `[start, length]`，
 *    再取 `[0, end-length]`。只取一段会让尾迹在跨越起点那一帧整段消失。
 *
 * 平台差异
 * ────────
 * - `android.graphics.Path` / `PathMeasure` / `RectF` → 本模块只算**区间与边界**，
 *   真正的路径运算由 UI 层（`Canvas2D` / `Path2D`）承担。
 * - `DrawScope` / `drawResolvedBlurredShadow` → 返回 `resolveBlurredShadow()` 的入参
 *   （`ResolveBlurredShadowInput` 的几何部分），由 UI 层补 `drawMask` 后调用。
 * - `Outline.toAndroidPath()` → 调用方给 `outlineLength`（路径总长）；长度是唯一被
 *   `PathMeasure` 用到的量。
 * - `Color` → `rgb`（`0x00RRGGBB`）+ `effectiveAlpha`，与 `@core/glass/shadowBlurEngine`
 *   的入参形态一致。
 */

import type { ResolveBlurredShadowInput, ShadowCacheBucket } from './shadowBlurEngine';

/**
 * Kotlin `Float.roundToInt()`：`Math.round`，即 half-up 向 **+∞**。
 *
 * JS 的 `Math.round` 语义相同，但对 `(-0.5, 0)` 区间返回 **-0**，而 Kotlin 返回 `0`。
 * `-0` 会让 `sigmaKey !== previousSigma` 这类比较在高位桶上出现假不等（`-0 === 0` 为真，
 * 但 `Object.is(-0, 0)` 为假，而缓存键会先转成字符串 `-0`）。这里把 `-0` 归一成 `0`。
 */
export function ktRoundToInt(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/** Kotlin `Int.MIN_VALUE` —— `previousSigma` 的哨兵初值（L31）。 */
export const ROUND_RECT_INITIAL_SIGMA_KEY = -2147483648;

/** L51 的签名前缀。 */
export const ROUND_RECT_SIGNATURE_PREFIX = 'RR';
/** L95 `resolveBlurredShadow(..., "TRAIL", ...)` 的签名。 */
export const TRAIL_SIGNATURE = 'TRAIL';
/** L77 `trailFraction.coerceIn(.01f, 1f)` 的下界。 */
export const TRAIL_MIN_FRACTION = 0.01;
/** L60 / L96 的缓存桶 —— 两个缓存都是逐帧动画。 */
export const GLOW_SHADOW_BUCKET: ShadowCacheBucket = 'ANIMATED';

/** L19-23 的八个构造参数（字段名与 Kotlin 一致）。 */
export interface RoundRectGlowDrawCacheInput {
  readonly width: number;
  readonly height: number;
  readonly spread: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** L20 `cornerRadius`（端口旧名 `radius`）。 */
  readonly cornerRadius: number;
  /** `Color` 的 `0x00RRGGBB`。 */
  readonly rgb: number;
  readonly alpha: number;
}

/** L38-41 的四边 + L42 的可见性。 */
export interface RoundRectGlowBounds {
  /** L36 `offsetX + parallaxX`。 */
  readonly totalOffsetX: number;
  /** L37 `offsetY + parallaxY`。 */
  readonly totalOffsetY: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /** L42 `!(right <= left || bottom <= top)` —— 为假时整帧不画。 */
  readonly visible: boolean;
}

/**
 * L36-41：偏移与四边。
 *
 * 加法顺序照抄 Kotlin（`-spread + totalOffsetX`，不是 `totalOffsetX - spread`）——
 * 浮点下两者可能差一个 ulp，而 `changed` 是**精确比较**，差一个 ulp 就是一次多余的重解析。
 */
export function roundRectGlowBounds(
  input: Pick<RoundRectGlowDrawCacheInput, 'width' | 'height' | 'spread' | 'offsetX' | 'offsetY'>,
  parallaxX: number,
  parallaxY: number,
): RoundRectGlowBounds {
  const totalOffsetX = input.offsetX + parallaxX;
  const totalOffsetY = input.offsetY + parallaxY;
  const left = -input.spread + totalOffsetX;
  const top = -input.spread + totalOffsetY;
  const right = input.width + input.spread + totalOffsetX;
  const bottom = input.height + input.spread + totalOffsetY;
  return {
    totalOffsetX,
    totalOffsetY,
    left,
    top,
    right,
    bottom,
    visible: !(right <= left || bottom <= top),
  };
}

/**
 * L46 `cornerRadius.coerceIn(0f, (right - left) / 2f)` —— 圆角不超过半宽。
 *
 * 调用方必须先过 L42 的可见性判定：Kotlin 的 `coerceIn` 在 `min > max` 时抛
 * `IllegalArgumentException("Cannot coerce value to an empty range")`，而
 * `right <= left` 恰好让上界变负。这里按同一顺序返回夹紧值，并在上界为负时返回 0
 * （那条路径在原文里不可达，见上句）。
 */
export function roundRectGlowRadius(cornerRadius: number, left: number, right: number): number {
  const upper = (right - left) / 2;
  if (!(upper >= 0)) return 0;
  return Math.min(Math.max(cornerRadius, 0), upper);
}

/**
 * L51 `"RR|${((right - left) * 2f).roundToInt()}|${((bottom - top) * 2f).roundToInt()}|${(radius * 2f).roundToInt()}"`。
 *
 * 三处 `* 2f` 是**半像素**粒度：直接写像素会让「差半像素」的两个轮廓共用同一条缓存。
 */
export function roundRectGlowSignature(
  bounds: Pick<RoundRectGlowBounds, 'left' | 'top' | 'right' | 'bottom'>,
  radius: number,
): string {
  const w = ktRoundToInt((bounds.right - bounds.left) * 2);
  const h = ktRoundToInt((bounds.bottom - bounds.top) * 2);
  const r = ktRoundToInt(radius * 2);
  return `${ROUND_RECT_SIGNATURE_PREFIX}|${String(w)}|${String(h)}|${String(r)}`;
}

/** L43 `changed = left != previousLeft || top != previousTop || right != previousRight || bottom != previousBottom`。 */
export function roundRectGlowChanged(
  previous: Pick<RoundRectGlowBounds, 'left' | 'top' | 'right' | 'bottom'>,
  next: Pick<RoundRectGlowBounds, 'left' | 'top' | 'right' | 'bottom'>,
): boolean {
  return (
    next.left !== previous.left ||
    next.top !== previous.top ||
    next.right !== previous.right ||
    next.bottom !== previous.bottom
  );
}

/** L53 `sigma.isNaN() || sigma < 0f`。 */
export function roundRectGlowSigmaInvalid(sigma: number): boolean {
  return Number.isNaN(sigma) || sigma < 0;
}

/** L56 `sigmaKey = (sigma * 2f).roundToInt()` —— 半个像素一个桶。 */
export function roundRectGlowSigmaKey(sigma: number): number {
  return ktRoundToInt(sigma * 2);
}

/** 一帧的缓存状态（`previous*` / `signature` / `previousSigma` / `shadow` 的可读投影）。 */
export interface RoundRectGlowFrameState {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly radius: number;
  readonly signature: string;
  readonly changed: boolean;
  readonly sigmaKey: number;
  /** L57 `changed || sigmaKey != previousSigma`。 */
  readonly needsResolve: boolean;
  /** L53 早退（`shadow = null`）。 */
  readonly shadowCleared: boolean;
}

/**
 * `RoundRectGlowDrawCache` —— L14-64。
 *
 * `draw(parallaxX, parallaxY, sigma)` 返回「这一帧要不要重解析阴影 + 解析入参」。
 * 返回 `null` 表示这一帧不画（L42 早退，或 σ 非法）。
 */
export class RoundRectGlowDrawCache {
  private readonly input: RoundRectGlowDrawCacheInput;

  /** L26-29 四个 `Float.NaN`。 */
  private previous: { left: number; top: number; right: number; bottom: number } = {
    left: Number.NaN,
    top: Number.NaN,
    right: Number.NaN,
    bottom: Number.NaN,
  };

  /** L30 `signature = ""`。 */
  private signatureValue = '';

  /** L31 `previousSigma = Int.MIN_VALUE`。 */
  private previousSigma = ROUND_RECT_INITIAL_SIGMA_KEY;

  /** L32 `shadow: ResolvedBlurredShadow? = null`。 */
  private shadowValue: RoundRectShadowRequest | null = null;

  constructor(input: RoundRectGlowDrawCacheInput) {
    this.input = input;
  }

  /** L30 的当前签名（未绘制过时是空串，与 Kotlin 一致）。 */
  get signature(): string {
    return this.signatureValue;
  }

  /** L31 的当前 σ 桶。 */
  get sigmaKey(): number {
    return this.previousSigma;
  }

  /** L32 的当前解析结果（`null` = 这一帧不画）。 */
  get shadow(): RoundRectShadowRequest | null {
    return this.shadowValue;
  }

  /**
   * L34-63。返回本帧要**绘制**的解析请求；`null` 表示不画（L42 越界或 L53 σ 非法）。
   *
   * 顺序照抄：算四边 → 可见性早退 → `changed` 判定 → 半径与签名 → σ 合法性 →
   * σ 桶 → 是否重解析 → 返回。
   */
  draw(parallaxX: number, parallaxY: number, sigma: number): RoundRectShadowRequest | null {
    const bounds = roundRectGlowBounds(this.input, parallaxX, parallaxY);
    // L42 `if (right <= left || bottom <= top) return`
    if (!bounds.visible) return null;
    const changed = roundRectGlowChanged(this.previous, bounds);
    let radius = 0;
    if (changed) {
      // L45 先记录四边，再算半径与签名
      this.previous = { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
      radius = roundRectGlowRadius(this.input.cornerRadius, bounds.left, bounds.right);
      this.signatureValue = roundRectGlowSignature(bounds, radius);
    } else {
      // 未变时沿用上一次的半径（签名里也是它）
      radius = roundRectGlowRadius(this.input.cornerRadius, bounds.left, bounds.right);
    }
    // L53 `if (sigma.isNaN() || sigma < 0f) { shadow = null; previousSigma = Int.MIN_VALUE; return }`
    if (roundRectGlowSigmaInvalid(sigma)) {
      this.shadowValue = null;
      this.previousSigma = ROUND_RECT_INITIAL_SIGMA_KEY;
      return null;
    }
    const sigmaKey = roundRectGlowSigmaKey(sigma);
    // L57 `if (changed || sigmaKey != previousSigma)`
    if (changed || sigmaKey !== this.previousSigma) {
      this.previousSigma = sigmaKey;
      this.shadowValue = {
        signature: this.signatureValue,
        rgb: this.input.rgb,
        effectiveAlpha: this.input.alpha,
        sigmaPx: sigma,
        dx: 0,
        dy: 0,
        boundsLeft: bounds.left,
        boundsTop: bounds.top,
        boundsRight: bounds.right,
        boundsBottom: bounds.bottom,
        strokeWidthPx: 0,
        alpha: this.input.alpha,
        bucket: GLOW_SHADOW_BUCKET,
        useCache: true,
        style: 'Fill',
      };
    }
    return this.shadowValue;
  }

  /** 只观察不绘制时用（测试与调试）。 */
  frameState(parallaxX: number, parallaxY: number, sigma: number): RoundRectGlowFrameState {
    const bounds = roundRectGlowBounds(this.input, parallaxX, parallaxY);
    const radius = roundRectGlowRadius(this.input.cornerRadius, bounds.left, bounds.right);
    const changed = roundRectGlowChanged(this.previous, bounds);
    const sigmaKey = roundRectGlowSigmaKey(sigma);
    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      radius,
      signature: bounds.visible ? roundRectGlowSignature(bounds, radius) : this.signatureValue,
      changed,
      sigmaKey,
      needsResolve: changed || sigmaKey !== this.previousSigma,
      shadowCleared: roundRectGlowSigmaInvalid(sigma),
    };
  }
}

/** `ResolveBlurredShadowInput` 去掉 `drawMask`（由 UI 层补）。 */
export type RoundRectShadowRequest = Omit<ResolveBlurredShadowInput, 'drawMask'> & {
  /** L59 的 `Fill`（矩形阴影永远是填充，不是描边）。 */
  readonly style: 'Fill';
};

/* ══════════════════════════ GlowTrailDrawCache（L66-99） ══════════════════════════ */

/** L68-72 的五个构造参数（`sigma` / `trailFraction` 沿用 Kotlin 名）。 */
export interface GlowTrailDrawCacheInput {
  /** `outline.toAndroidPath()` 的结果长度 —— `PathMeasure(fullPath).length`。 */
  readonly outlineLength: number;
  readonly strokeWidth: number;
  /** L70 `sigma`（端口旧名 `blurSigma`）。 */
  readonly sigma: number;
  readonly alpha: number;
  /** L72 `trailFraction`（端口旧名 `lengthFraction`）。 */
  readonly trailFraction: number;
  /** `Color` 的 `0x00RRGGBB`。 */
  readonly rgb: number;
}

/** L84-85 的分段计划。 */
export interface TrailSegmentPlan {
  /** L77 `segmentLength = length * trailFraction.coerceIn(.01f, 1f)`。 */
  readonly segmentLength: number;
  /** L84 `(progress * length) % length`。 */
  readonly start: number;
  /** L85 `start + segmentLength`。 */
  readonly end: number;
  /** L83 `length > 0f`。 */
  readonly visible: boolean;
  /** L87 `end <= length` —— 为假时要拆成两段（环绕起点）。 */
  readonly wraps: boolean;
}

/**
 * L77 / L84-85。
 *
 * `%` 在 Kotlin 与 JS 上对负数**同号**（`-3 % 10 == -3`），所以这里不用额外归一化 ——
 * 换成 `((x % n) + n) % n` 反而会让 `progress` 为负时与原文不一致（原文不会负，
 * 但那属于上游约定，不该在这一层偷偷纠正）。
 */
export function trailSegmentPlan(
  outlineLength: number,
  progress: number,
  trailFraction: number,
): TrailSegmentPlan {
  const segmentLength = outlineLength * Math.min(Math.max(trailFraction, TRAIL_MIN_FRACTION), 1);
  if (!(outlineLength > 0)) {
    return { segmentLength, start: 0, end: 0, visible: false, wraps: false };
  }
  const start = (progress * outlineLength) % outlineLength;
  const end = start + segmentLength;
  return { segmentLength, start, end, visible: true, wraps: end > outlineLength };
}

/**
 * L87-92 的 `getSegment` 区间。
 *
 * 不环绕 → `[[start, end]]`；环绕 → `[[start, length], [0, end - length]]`。
 * 只取一段会让尾迹在跨越起点那一帧整段消失。
 */
export function trailSegmentRanges(outlineLength: number, plan: TrailSegmentPlan): readonly (readonly [number, number])[] {
  if (!plan.visible) return [];
  if (!plan.wraps) return [[plan.start, plan.end]];
  return [
    [plan.start, outlineLength],
    [0, plan.end - outlineLength],
  ];
}

/** `GlowTrailDrawCache` 一帧的绘制请求（`null` = 不画）。 */
export type TrailShadowRequest = Omit<ResolveBlurredShadowInput, 'drawMask'> & {
  /** L96 的 `stroke`（`Stroke(strokeWidth)`）。 */
  readonly style: 'Stroke';
  /** 本帧的两段（或一段）区间，UI 层据此构造 `Path`。 */
  readonly ranges: readonly (readonly [number, number])[];
};

/**
 * `GlowTrailDrawCache` —— L67-99。
 *
 * 与 `RoundRectGlowDrawCache` 的两处结构差异，都在原文里写着：
 * 1. **`useCache = false`**（L96）—— 每一帧的路径都不同，缓存没有意义；
 * 2. **`style = Stroke(strokeWidth)`** 而不是 `Fill`，所以 `strokeWidthPx` 非零。
 */
export class GlowTrailDrawCache {
  private readonly input: GlowTrailDrawCacheInput;

  /** L76 `length = measure.length`。 */
  readonly length: number;

  /** L77 `segmentLength`。 */
  readonly segmentLength: number;

  constructor(input: GlowTrailDrawCacheInput) {
    this.input = input;
    this.length = input.outlineLength;
    this.segmentLength = trailSegmentPlan(input.outlineLength, 0, input.trailFraction).segmentLength;
  }

  /** L82-98。返回本帧的绘制请求；`null` 表示不画（L83 `length <= 0f`）。 */
  draw(progress: number): TrailShadowRequest | null {
    const plan = trailSegmentPlan(this.length, progress, this.input.trailFraction);
    // L83 `if (length <= 0f) return`
    if (!plan.visible) return null;
    const ranges = trailSegmentRanges(this.length, plan);
    // L93-94 `segment.computeBounds(bounds, true)` —— 端点是路径上的采样点，UI 层算包围盒。
    return {
      signature: TRAIL_SIGNATURE,
      rgb: this.input.rgb,
      effectiveAlpha: this.input.alpha,
      sigmaPx: this.input.sigma,
      dx: 0,
      dy: 0,
      boundsLeft: 0,
      boundsTop: 0,
      boundsRight: 0,
      boundsBottom: 0,
      strokeWidthPx: this.input.strokeWidth,
      alpha: this.input.alpha,
      bucket: GLOW_SHADOW_BUCKET,
      // L96 `useCache = false`
      useCache: false,
      style: 'Stroke',
      ranges,
    };
  }
}
