/**
 * comicZoomGesture.ts  ←
 *   novel-reader/app/src/main/java/com/example/ui/comic/ComicZoomGesture.kt
 *
 * Kotlin source: 767 lines / 718 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1        `package com.example.ui.comic`                 — package decl          │
 * │ L3–43     Compose imports (`Animatable`, `AnimationState`, `Spring`,          │
 * │           `animateDecay`, `splineBasedDecay`, `spring`, `tween`,               │
 * │           `awaitEachGesture`, `awaitFirstDown`, `calculateCentroid`,           │
 * │           `calculatePan`, `calculateZoom`, `VelocityTracker`, `Density`,       │
 * │           `Job`, `delay`, `launch`, …) — platform/animation/gesture imports   │
 * │ L55       `@Stable`                                      — Compose annotation    │
 * │ L60–90    `mutableFloatStateOf` / `mutableLongStateOf` / `mutableStateOf` /    │
 * │           `remember` fields + `Job?` handles  — became plain class fields plus │
 * │           a `cancel()`-able handle (no Compose snapshot system in src/core)    │
 * │ L206–212  `Animatable(0f)` + `animateTo(1f, tween(220))` — injected            │
 * │           `AnimationDriver` (spring/tween/decay runners)                      │
 * │ L213      `suspend fun animateZoomTo(...)`               — async fn             │
 * │ L239      `suspend fun animateReset() = animateZoomTo(1f)`— async fn            │
 * │ L268–306  `suspend fun fling(...)`: `150.dp.toPx()` / `8000.dp.toPx()` density │
 * │           → injected `dpToPx`; `AnimationState` + `animateDecay(splineBasedDecay│
 * │           (density))` + `cancelAnimation()` → injected driver;               │
 * │           `try/catch CancellationException` → AbortError propagation           │
 * │ L277–279  `Offset.VectorConverter` `AnimationState`        — driver seam        │
 * │ L309–338  `suspend fun settle()/settleOffsets()`: `Animatable` + `spring(`     │
 * │           `dampingRatio = NoBouncy, stiffness = StiffnessMediumLow)` → driver │
 * │ L387–391  `fun Modifier.comicZoomable(...): Modifier = composed { … }` — the  │
 * │           gesture arbitration loop is ported as `ComicZoomGestureMachine`, an  │
 * │           injected-`PointerEventSource` state machine (identical control flow) │
 * │ L391–725  Compose `remember`/`DisposableEffect`/`pointerInput`/`awaitPointer-  │
 * │           Event` plumbing and the `continue`/`finally` scaffolding → an explicit │
 * │           async generator driven by the injected event source                  │
 * │ L731–732  `fun Modifier.comicEdgeSwipe(…): Modifier = if (!enabled) this …`  │
 * │           → `ComicEdgeSwipeMachine`                                            │
 * │ L743–767  `PointerEventPass.Initial` consumption loop → same, via `pass`       │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * PORTED VERBATIM (the parts worth testing): `limitScaleWithRubberBand`,
 * `rubberPan`, `panLimitX/Y`, `clampOffsets`, `horizontalPanEdge`, `canPan`,
 * `isZoomed`, `mediumScale`, `oneToOneScale`, `stepScales`, `nextStepScale`,
 * `updateTransform`, `snapZoomTo`, `snapReset`, and the whole directional pan/page
 * arbitration from L598–633 (`yieldH`/`yieldV`/`consumedSome`) — extracted into the
 * pure function `resolvePanArbitration()` so it can be unit-tested without a gesture
 * source. QuickZoom / edge-swipe thresholds (0.004 per px, 48dp radius, 320ms window,
 * 380ms long press, 340ms tap, 12dp edge accumulation, 64dp close) all preserved.
 *
 * ── ADAPTATIONS ───────────────────────────────────────────────────────────────────
 * • Compose snapshot state → plain mutable fields on `ComicZoomState`; observers get an
 *   injected `onChange()` callback (the UI layer wires that to React state).
 * • Coroutines (`Job`, `delay`, `launch`) → `AbortController` handles + `sleep()`.
 * • `Animatable`/`AnimationState`/`spring`/`tween`/`splineBasedDecay` → injected
 *   `ZoomAnimator` (`animateTween`, `animateSpring`, `animateDecay`). The iOS/web
 *   adapter lives outside src/core.
 * • `Density` (dp→px) → injected `dpToPx` on the gesture machine.
 * • `VelocityTracker` → injected `VelocityTracker` port (the Android implementation
 *   is a framework class; the seam keeps the same `addPosition`/`calculateVelocity`).
 * • `Modifier`/`pointerInput` → injected `PointerEventSource` async iterator.
 */

import {
  type ComicDirection,
  type ComicMode,
  type ComicPageAnim,
  type OffsetF,
  type SizeF,
  ZERO_OFFSET,
  ZERO_SIZE,
} from './comicPortTypes'
import { clamp } from './comicPixOps'

/* ══════════════ injected platform seams ══════════════ */

/** Cancellable handle (Kotlin `Job`). */
export interface Cancellable {
  cancel(): void
}

/** `kotlinx.coroutines.delay(ms)`. */
export type Sleeper = (ms: number) => Promise<void>

/** Android `VelocityTracker` — framework class, so it is a seam. */
export interface VelocityTracker {
  addPosition(timeMillis: number, x: number, y: number): void
  /** Returns null when there are not enough samples (Kotlin throws). */
  calculateVelocity(): { x: number; y: number } | null
}

/** Compose `PointerEventPass`. */
export type PointerEventPass = 'Initial' | 'Main' | 'Final'

export interface PointerChange {
  readonly id: number
  readonly position: OffsetF
  readonly pressed: boolean
  readonly previousPressed: boolean
  readonly uptimeMillis: number
  /** Zero once another consumer has claimed the move. */
  readonly positionChange: OffsetF
  readonly isConsumed: boolean
  consume(): void
}

export interface PointerEvent {
  readonly changes: ReadonlyArray<PointerChange>
  /** `calculateCentroid(useCurrent = true)` */
  centroid(useCurrent?: boolean): OffsetF | null
  /** `calculateZoom()` — cumulative pinch ratio since gesture start. */
  zoom(): number
  /** `calculatePan()` — cumulative pan since gesture start. */
  pan(): OffsetF
}

/**
 * Compose `awaitEachGesture` / `awaitPointerEvent` / `awaitFirstDown`.
 * `down()` mirrors `awaitFirstDown(requireUnconsumed = false, pass)`.
 */
export interface PointerEventSource {
  down(pass: PointerEventPass): Promise<PointerChange>
  next(pass: PointerEventPass): Promise<PointerEvent>
  /** `viewConfiguration.touchSlop` in px. */
  readonly touchSlop: number
}

/** Compose `Density.density` (`48.dp.toPx()` etc.). */
export type DpToPx = (dp: number) => number

/** Compose animation primitives (`Animatable`, `tween`, `spring`, `splineBasedDecay`). */
export interface ZoomAnimator {
  /** `Animatable.animateTo(target, tween(durationMs))` — resolves at the end. */
  tween(
    from: number,
    to: number,
    durationMs: number,
    onFrame: (v: number) => void,
    signal?: AbortSignal,
  ): Promise<void>
  /** `Animatable.animateTo(target, spring(NoBouncy, StiffnessMediumLow))`. */
  spring(
    from: number,
    to: number,
    dampingRatio: number,
    stiffness: number,
    onFrame: (v: number) => void,
    signal?: AbortSignal,
  ): Promise<void>
  /**
   * `AnimationState.animateDecay(splineBasedDecay(density))`.
   * `onFrame(vx, vy)` runs per frame; call `stop()` to emulate `cancelAnimation()`.
   * Resolves true when it ran to completion, false when cancelled.
   */
  decay(
    vx: number,
    vy: number,
    onFrame: (x: number, y: number) => void,
    signal?: AbortSignal,
  ): Promise<boolean>
}

/** Everything the gesture machines need from the host. */
export interface ComicZoomEnv {
  readonly source: PointerEventSource
  readonly anim: ZoomAnimator
  readonly sleep: Sleeper
  readonly dpToPx: DpToPx
  readonly density: number
  readonly size: () => SizeF
  createVelocityTracker(): VelocityTracker
}

/** The `ComicReaderConfig` members the gesture machines read. */
export interface ZoomGestureConfig {
  readonly doubleTapZoom: boolean
  readonly longPressZoom: boolean
  readonly zoomWhileTurn: boolean
  readonly gesturePinchClose: boolean
  readonly gestureLongPressPanel: boolean
  readonly gestureSwipe: boolean
  readonly mode: ComicMode
  readonly direction: ComicDirection
  readonly pageAnim: ComicPageAnim
}

/** 手势回调集合 */
export interface ComicGestureCallbacks {
  onTapZone(pos: OffsetF, size: SizeF): void
  onLongPress(pos: OffsetF): void
  onPinchClose(): void
  onEdgeBack(): void
  /** 放大状态下滑到边缘继续翻页（dir>0 屏幕向右拖） */
  onZoomedEdgeSwipe?: ((dir: number) => void) | undefined
}

/* ══════════════ ComicZoomState ══════════════ */

/**
 * 漫画缩放状态：单指拖动 / 双指缩放平移 / 双击放大 / 双击按住拖动(QuickZoom) / 长按放大共用。
 * 渲染模型：screen = center + (content - center) * scale + offset
 *
 * 手感算法移植自成熟开源实现（详见 docs/WHEEL_EVALUATION.md）：
 * - 缩放阻尼回弹（rubber band）：panpf/zoomimage `limitScaleWithRubberBand`（Apache-2.0）
 * - 双击动态档位：zoomimage `DynamicScalesCalculator`（Apache-2.0）
 * - 惯性 fling：splineBasedDecay + 撞墙即停（zoomimage / telephoto 同款）
 * - 双击按住上下拖缩放（QuickZoom）：saket/telephoto（Apache-2.0），dy × 0.004/px
 */
export class ComicZoomState {
  readonly minScale: number
  readonly maxScale: number

  scale = 1
  offsetX = 0
  offsetY = 0
  containerSize: SizeF = ZERO_SIZE
  /** 内容适配后（scale=1 时）的显示尺寸（px） */
  contentSize: SizeF = ZERO_SIZE
  /** 原始位图像素尺寸（双击 1:1 档位计算用；未设置时不提供该档） */
  intrinsicSize: SizeF = ZERO_SIZE

  /** 长按放大激活中（跟随手指平移，松手还原） */
  holdZoomActive = false

  /** 手势进行中（区域重解码等重活暂停的信号） */
  gestureActive = false
  /** 每次手势结束递增（触发松手后的懒刷新） */
  gestureEpoch = 0

  /** 松手动画（fling/回弹）任务，新手势开始时取消 */
  releaseJob: Cancellable | null = null

  /** 松手动画进行中（observable）：区域重解码等空闲触发逻辑用它判断"真正静止"。 */
  releaseAnimating = false

  /** 双击检测（per-cell，避免跨页误判） */
  lastTapTime = 0
  lastTapPos: OffsetF = ZERO_OFFSET
  pendingTapJob: Cancellable | null = null

  private env: ComicZoomEnv | null = null

  constructor(
    minScale = 1,
    maxScale = 5,
    /** Optional observer invoked after every mutation (the UI layer binds this to React). */
    private readonly onChange: () => void = () => {},
  ) {
    this.minScale = minScale
    this.maxScale = maxScale
  }

  /** Bind the injected animation/sleep environment (Kotlin gets it from the composition). */
  attach(env: ComicZoomEnv): void {
    this.env = env
  }

  private emit(): void {
    this.onChange()
  }

  /** `state.releaseJob?.cancel()` — read through a method so the nullable handle
   *  is not flow-narrowed away by the assignment sites. */
  releaseJobHandle(): Cancellable | null {
    return this.releaseJob
  }

  /** `state.pendingTapJob?.cancel()` */
  pendingTapJobHandle(): Cancellable | null {
    return this.pendingTapJob
  }

  /** 是否存在可平移空间（放大或内容超出容器） */
  get canPan(): boolean {
    return this.panLimitX() > 0.5 || this.panLimitY() > 0.5
  }

  get isZoomed(): boolean {
    return this.scale > 1.02 || this.canPan
  }

  /** 是否已到水平平移边界（direction >0 表示正方向边界） */
  horizontalPanEdge(direction: number): boolean {
    const limit = this.panLimitX()
    if (limit <= 0) return true
    return direction > 0 ? this.offsetX >= limit - 1 : this.offsetX <= -limit + 1
  }

  panLimitX(): number {
    const w = this.contentSize.width * this.scale - this.containerSize.width
    return Math.max(0, w / 2)
  }

  panLimitY(): number {
    const h = this.contentSize.height * this.scale - this.containerSize.height
    return Math.max(0, h / 2)
  }

  /* ── 动态双击档位（zoomimage DynamicScalesCalculator 思路） ── */

  /** 中档：至少 2.5x、能填满容器短边、必要时更高；上限不超过 4x */
  mediumScale(): number {
    const fill =
      this.contentSize.width > 1 &&
      this.contentSize.height > 1 &&
      this.containerSize.width > 1
        ? Math.max(
            this.containerSize.width / this.contentSize.width,
            this.containerSize.height / this.contentSize.height,
          )
        : 2.5
    return clamp(Math.max(2.5, Math.min(fill, 4)), this.minScale, this.maxScale)
  }

  /** 1:1 原始像素档（仅当原始图比适配显示更大时有意义） */
  oneToOneScale(): number {
    if (this.intrinsicSize.width < 1 || this.contentSize.width < 1) return NaN
    const s = this.intrinsicSize.width / this.contentSize.width
    return s > this.mediumScale() * 1.1 && s <= this.maxScale ? s : NaN
  }

  /** 双击循环档位序列（去重、升序） */
  stepScales(): number[] {
    const base = [this.minScale, this.mediumScale()]
    const o2o = this.oneToOneScale()
    if (!Number.isNaN(o2o)) base.push(o2o)
    const seen = new Set<number>()
    const uniq: number[] = []
    for (const s of base) {
      const k = Math.trunc(s * 100)
      if (seen.has(k)) continue
      seen.add(k)
      uniq.push(s)
    }
    return uniq.sort((a, b) => a - b)
  }

  /**
   * 下一个双击目标（zoomimage 0.35 容差）：从低到高找第一个
   * `step > current + 0.35 × 与下一低档的间距` 的档位；到顶回 min。
   */
  nextStepScale(): number {
    const steps = this.stepScales()
    for (let i = 1; i < steps.length; i++) {
      const gap = steps[i]! - steps[i - 1]!
      if (this.scale < steps[i]! - 0.35 * gap) return steps[i]!
    }
    return steps[0]!
  }

  /* ── 变换 ── */

  updateTransform(zoom: number, pan: OffsetF, focal: OffsetF): void {
    const raw = this.scale <= 0 ? zoom : this.scale * zoom
    const newScale = limitScaleWithRubberBand(this.scale, raw, this.minScale, this.maxScale)
    if (this.scale <= 0) {
      this.scale = newScale
      this.offsetX = pan.x
      this.offsetY = pan.y
      this.emit()
      return
    }
    const cx = this.containerSize.width / 2
    const cy = this.containerSize.height / 2
    const pX = (focal.x - cx - this.offsetX) / this.scale
    const pY = (focal.y - cy - this.offsetY) / this.scale
    this.scale = newScale
    this.offsetX = focal.x - cx - pX * newScale + pan.x
    this.offsetY = focal.y - cy - pY * newScale + pan.y
    this.clampOffsets()
    this.emit()
  }

  panBy(delta: OffsetF): void {
    // 橡胶带平移：界内全额跟手，越界部分 0.35 衰减——拖到边界是渐进阻力而非硬撞墙，
    // 松手后由 settle() 的弹簧把越界量拉回（否则弹簧回弹永不可达）
    const lx = this.panLimitX()
    const ly = this.panLimitY()
    this.offsetX = rubberPan(this.offsetX, delta.x, lx)
    this.offsetY = rubberPan(this.offsetY, delta.y, ly)
    this.emit()
  }

  clampOffsets(): void {
    const lx = this.panLimitX()
    const ly = this.panLimitY()
    this.offsetX = clamp(this.offsetX, -lx, lx)
    this.offsetY = clamp(this.offsetY, -ly, ly)
  }

  private setTransform(scale: number, offsetX: number, offsetY: number): void {
    this.scale = scale
    this.offsetX = offsetX
    this.offsetY = offsetY
    this.emit()
  }

  /** 双击/长按放大到指定倍数，保持 focal 点位置不动 */
  async animateZoomTo(targetScale: number, focal?: OffsetF, signal?: AbortSignal): Promise<void> {
    const startScale = this.scale
    const startOffX = this.offsetX
    const startOffY = this.offsetY
    const tScale = clamp(targetScale, this.minScale, this.maxScale)
    const cx = this.containerSize.width / 2
    const cy = this.containerSize.height / 2
    const f = focal ?? { x: cx, y: cy }
    const pCX = startScale > 0 ? (f.x - cx - startOffX) / startScale : 0
    const pCY = startScale > 0 ? (f.y - cy - startOffY) / startScale : 0
    const targetLimitX = Math.max(0, (this.contentSize.width * tScale - this.containerSize.width) / 2)
    const targetLimitY = Math.max(0, (this.contentSize.height * tScale - this.containerSize.height) / 2)
    const tOffX = clamp(f.x - cx - pCX * tScale, -targetLimitX, targetLimitX)
    const tOffY = clamp(f.y - cy - pCY * tScale, -targetLimitY, targetLimitY)
    // 只约束最终位置，和缩放倍率共用一个进度：逐帧按当时的边界夹紧，
    // 会让非中心焦点漂移，并把回弹途中被双击打断的偏移瞬间拉回边界。
    await this.env!.anim.tween(
      0,
      1,
      220,
      (v) => {
        this.setTransform(
          startScale + (tScale - startScale) * v,
          startOffX + (tOffX - startOffX) * v,
          startOffY + (tOffY - startOffY) * v,
        )
      },
      signal,
    )
    this.clampOffsets()
    this.emit()
  }

  async animateReset(signal?: AbortSignal): Promise<void> {
    await this.animateZoomTo(1, undefined, signal)
  }

  /** 瞬时缩放到目标（无动画，长按放大用——避免与跟手 panBy 并发互写） */
  snapZoomTo(targetScale: number, focal?: OffsetF): void {
    const tScale = clamp(targetScale, this.minScale, this.maxScale)
    const cx = this.containerSize.width / 2
    const cy = this.containerSize.height / 2
    const f = focal ?? { x: cx, y: cy }
    const pX = this.scale > 0 ? (f.x - cx - this.offsetX) / this.scale : 0
    const pY = this.scale > 0 ? (f.y - cy - this.offsetY) / this.scale : 0
    this.setTransform(tScale, f.x - cx - pX * tScale, f.y - cy - pY * tScale)
    this.clampOffsets()
  }

  snapReset(): void {
    this.setTransform(1, 0, 0)
    this.holdZoomActive = false
  }

  /* ── 松手行为：fling 惯性 / 越界回弹 ── */

  /**
   * 惯性滑动：splineBasedDecay + 撞墙即停（zoomimage/telephoto 模式）。
   * 返回是否真的执行了 fling（速度过低直接结束）。
   */
  async fling(velocity: OffsetF, dpToPx: DpToPx, signal?: AbortSignal): Promise<boolean> {
    // 速度阈值密度无关化：150dp/s 起步，8000dp/s 硬帽
    const minSpeed = dpToPx(150)
    const vCap = dpToPx(8000)
    const speed = Math.hypot(velocity.x, velocity.y)
    if (speed < minSpeed || !this.canPan) return false
    // 按模长截断（保持方向）：逐轴独立 clamp 会把对角高速 fling 扭向轴对齐
    const v =
      speed > vCap
        ? { x: (velocity.x * vCap) / speed, y: (velocity.y * vCap) / speed }
        : velocity
    let hitWall = false
    const env = this.env!
    const cancelled = { hit: false }
    const onAbort = (): void => {
      cancelled.hit = true
    }
    signal?.addEventListener('abort', onAbort)
    try {
      await env.anim.decay(
        v.x,
        v.y,
        (x, y) => {
          if (cancelled.hit) return
          const lx = this.panLimitX()
          const ly = this.panLimitY()
          if (x < -lx || x > lx || y < -ly || y > ly) {
            this.setTransform(this.scale, clamp(x, -lx, lx), clamp(y, -ly, ly))
            hitWall = true
            cancelled.hit = true
          } else {
            this.setTransform(this.scale, x, y)
          }
        },
        signal,
      )
    } catch (e) {
      // CancellationException must propagate; anything else (layout change → limit NaN)
      // clamps and finishes.
      if (isAbort(e)) throw e
      this.clampOffsets()
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
    // 撞墙即停后：把 panBy 橡胶带留下的越界量用弹簧拉回（无跳变收尾）
    if (hitWall) await this.settleOffsets(signal)
    return true
  }

  /** 松手收尾：scale 越界 → 动画回边界；offset 越界 → 弹簧回边界 */
  async settle(signal?: AbortSignal): Promise<void> {
    const target = clamp(this.scale, this.minScale, this.maxScale)
    if (Math.abs(target - this.scale) > 0.004) {
      await this.animateZoomTo(target, undefined, signal)
    } else {
      // scale 在界内但可能贴边，直接对齐避免浮点残留
      if (Math.abs(this.scale - target) > 0) this.scale = target
    }
    await this.settleOffsets(signal)
  }

  private async settleOffsets(signal?: AbortSignal): Promise<void> {
    const lx = this.panLimitX()
    const ly = this.panLimitY()
    if (
      this.offsetX < -lx - 0.5 ||
      this.offsetX > lx + 0.5 ||
      this.offsetY < -ly - 0.5 ||
      this.offsetY > ly + 0.5
    ) {
      const fromX = this.offsetX
      const fromY = this.offsetY
      const toX = clamp(this.offsetX, -lx, lx)
      const toY = clamp(this.offsetY, -ly, ly)
      // Compose spring(NoBouncy, StiffnessMediumLow)
      await this.env!.anim.spring(
        0,
        1,
        1,
        400,
        (v) => {
          this.setTransform(this.scale, fromX + (toX - fromX) * v, fromY + (toY - fromY) * v)
        },
        signal,
      )
    }
  }

  /** `DisposableEffect` teardown: cancels both pending jobs. */
  dispose(): void {
    this.pendingTapJob?.cancel()
    this.releaseJob?.cancel()
    this.pendingTapJob = null
    this.releaseJob = null
    this.releaseAnimating = false
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/**
 * 越界平移的增量式橡胶带（对照 limitScaleWithRubberBand 的 cur+over×f 形式）：
 * - 界内：全额跟手
 * - 越界：cur + d×0.35（越界增量衰减）——持续拖动越界量持续增长，硬顶 1.6×limit
 * - 无余量轴：0.3 阻尼漂移 ±96（跟手感），松手回弹
 */
export function rubberPan(cur: number, d: number, limit: number): number {
  if (limit <= 0.5) return clamp(cur + d * 0.3, -96, 96)
  const target = cur + d
  return target >= -limit && target <= limit
    ? target
    : clamp(cur + d * 0.35, -limit * 1.6, limit * 1.6)
}

/**
 * 缩放阻尼回弹（移植自 panpf/zoomimage `limitScaleWithRubberBand`，Apache-2.0）。
 * 界内原样通过；越界部分按 (1−progress)/2 衰减，硬顶 ratio 倍。
 */
export function limitScaleWithRubberBand(
  current: number,
  target: number,
  min: number,
  max: number,
  ratio = 2,
): number {
  if (target >= min && target <= max) return target
  const over = target - current
  if (target > max) {
    const hardMax = max * ratio
    return target < hardMax
      ? current + over * (1 - (target - max) / (hardMax - max)) * 0.5
      : hardMax
  }
  const hardMin = min / ratio
  return target > hardMin
    ? current + over * (1 - (min - target) / (min - hardMin)) * 0.5
    : hardMin
}

/* ══════════════ pan / page arbitration (extracted from L598–633) ══════════════ */

export interface PanArbitrationInput {
  readonly panLimitX: number
  readonly panLimitY: number
  readonly scale: number
  readonly offsetX: number
  readonly offsetY: number
  readonly delta: OffsetF
  readonly direction: ComicDirection
  readonly zoomWhileTurn: boolean
}

export interface PanArbitrationResult {
  /** Pan handed to `state.panBy` (a zeroed axis yields back to the page-turner). */
  readonly pan: OffsetF
  readonly consumed: boolean
}

/**
 * 方向感知平移仲裁（修复 FIT_HEIGHT/FILL 布局滑动翻页失效）：
 * 该方向无平移余量、或已拖到边界 → 翻页主轴此帧零位移且不消费，手势自然交还
 * Pager；非翻页主轴保持 rubberPan 阻尼漂移。
 */
export function resolvePanArbitration(i: PanArbitrationInput): PanArbitrationResult {
  const lx = i.panLimitX
  const ly = i.panLimitY
  const realZoom = i.scale > 1.02
  const pageAxisIsX = i.direction !== 'TTB'
  const atHEdge =
    lx > 0.5 &&
    ((i.delta.x > 0 && i.offsetX >= lx - 0.5) ||
      (i.delta.x < 0 && i.offsetX <= -lx + 0.5))
  const atVEdge =
    ly > 0.5 &&
    ((i.delta.y > 0 && i.offsetY >= ly - 0.5) ||
      (i.delta.y < 0 && i.offsetY <= -ly + 0.5))
  // 放大态到边是否交还翻页由 zoomWhileTurn 决定；未放大(布局溢出)时到边/无余量必须交还
  const yieldH = (atHEdge || lx <= 0.5) && (i.zoomWhileTurn || !realZoom)
  const yieldV = (atVEdge || ly <= 0.5) && (i.zoomWhileTurn || !realZoom)
  if (lx <= 0.5 && ly <= 0.5) return { pan: i.delta, consumed: false }
  const pX = yieldH && pageAxisIsX ? 0 : i.delta.x
  const pY = yieldV && !pageAxisIsX ? 0 : i.delta.y
  const consumedSome =
    (pX !== 0 || pY !== 0) && !((yieldH && pageAxisIsX) || (yieldV && !pageAxisIsX))
  return { pan: { x: pX, y: pY }, consumed: consumedSome }
}

/* ══════════════ comicZoomable ══════════════ */

/**
 * 核心手势状态机：缩放/平移/点按区/双击放大/双击按住拖缩放/长按放大/双指合拢退出/惯性 fling。
 *
 * 事件仲裁：
 * - 未放大时单指拖动不消费 → 交给 Pager/滚动容器翻页
 * - 放大（或内容超界可平移）时单指拖动消费平移；触边继续拖 → onZoomedEdgeSwipe 翻页；
 *   松手带速度 → 惯性 fling（撞墙即停）
 * - 双指手势始终消费（缩放+平移）；从 1x 合拢 < 0.62 → 退出请求；松手越界弹簧回弹
 * - 双击（可配置）→ 动态档位循环（1x → 填满 → 1:1）
 * - 双击第二击按住上下拖 → QuickZoom 连续缩放（telephoto dy×0.004）
 * - 长按（未移动）→ 长按放大（可配置关闭），期间消费全部事件；松手动画还原
 *
 * Coroutine → async generator: `run()` yields once per awaited suspend point so the
 * caller drives it (`for await (const cmd of machine.run())`). Release animations run
 * detached through `state.releaseJob` exactly like `scope.launch`.
 */
export class ComicZoomGestureMachine {
  private readonly longPressTimeout = 380
  private readonly tapMaxDuration = 340
  private readonly doubleTapWindow = 320

  constructor(
    private readonly state: ComicZoomState,
    private config: ZoomGestureConfig,
    private readonly callbacks: ComicGestureCallbacks,
    private readonly env: ComicZoomEnv,
  ) {
    state.attach(env)
  }

  /** AndroidView `update = { … }` equivalent — live config swap without restart. */
  updateConfig(config: ZoomGestureConfig): void {
    this.config = config
  }

  private get doubleTapRadius(): number {
    return this.env.dpToPx(48)
  }

  private abortable(): AbortController {
    return new AbortController()
  }

  /** One `awaitEachGesture` iteration. Returns when the gesture is fully settled. */
  async runOnce(): Promise<void> {
    const st = this.state
    const cfg = this.config
    const cb = this.callbacks
    const env = this.env
    const slop = env.source.touchSlop

    const down = await env.source.down('Main')
    if (down.isConsumed) return
    st.pendingTapJob?.cancel()
    // 新手势打断上一次松手动画（fling/回弹）
    st.releaseJob?.cancel()
    st.releaseJob = null
    st.releaseAnimating = false
    st.gestureActive = true

    let pointers = 1
    let holdZoomFired = false
    let holdZoomConsuming = false
    let panelLongPressed = false
    let transformMode = false
    let pinchCloseFired = false
    let edgeSwipeFired = false
    let edgeSwipeAccum = 0
    let moved = false
    let totalDragX = 0
    let totalDragY = 0
    let lastPos: OffsetF = down.position
    // QuickZoom：第二击按住上下拖
    let quickZoomCandidate =
      cfg.doubleTapZoom &&
      st.lastTapTime > 0 &&
      down.uptimeMillis - st.lastTapTime >= 0 &&
      down.uptimeMillis - st.lastTapTime <= this.doubleTapWindow &&
      Math.hypot(down.position.x - st.lastTapPos.x, down.position.y - st.lastTapPos.y) <
        this.doubleTapRadius
    let quickZoomActive = false
    if (quickZoomCandidate) {
      st.lastTapTime = 0
      st.pendingTapJob?.cancel()
    }
    const velocityTracker = env.createVelocityTracker()
    velocityTracker.addPosition(down.uptimeMillis, down.position.x, down.position.y)
    // All tap timing uses pointer event timestamps, including injected/queued events.
    const downTime = down.uptimeMillis
    let gestureEndTime = downTime

    // 长按计时（外部 scope，避免受限挂起限制）
    let longPressAbort: AbortController | null = null
    if (!quickZoomCandidate) {
      longPressAbort = this.abortable()
      const signal = longPressAbort.signal
      env
        .sleep(this.longPressTimeout)
        .then(() => {
          if (!moved && !transformMode && pointers === 1) {
            if (cfg.longPressZoom) {
              holdZoomFired = true
              holdZoomConsuming = true
              st.holdZoomActive = true
              // 瞬时定位（不做 220ms 动画）：动画期间逐帧写 scale/offset 会与
              // 跟手 panBy 并发互写（前 220ms 手指位移被动画覆盖，抖动+落点漂移）
              st.snapZoomTo(Math.min(2.8, st.mediumScale()), down.position)
            } else if (cfg.gestureLongPressPanel) {
              panelLongPressed = true
              holdZoomConsuming = true
              cb.onLongPress(down.position)
            }
          }
        })
        .catch(() => {})
      signal.addEventListener('abort', () => {})
    }

    try {
      for (;;) {
        const event = await env.source.next('Main')
        const first = event.changes.length > 0 ? event.changes[0] : undefined
        if (first !== undefined) gestureEndTime = first.uptimeMillis
        pointers = event.changes.filter((c) => c.pressed).length
        if (pointers === 0) {
          if (first !== undefined) lastPos = first.position
          break
        }

        if (pointers >= 2) {
          st.lastTapTime = 0
          transformMode = true
          quickZoomCandidate = false
          quickZoomActive = false
          longPressAbort?.abort()
          const zoomChange = event.zoom()
          const panChange = event.pan()
          const anchor = event.changes.find((c) => c.id === down.id)
          if (anchor !== undefined) {
            velocityTracker.addPosition(anchor.uptimeMillis, anchor.position.x, anchor.position.y)
          }
          if (zoomChange !== 1 || panChange.x !== 0 || panChange.y !== 0) {
            const centroid = event.centroid(true)
            if (centroid !== null) {
              st.updateTransform(zoomChange, panChange, centroid)
              if (
                cfg.gesturePinchClose &&
                !st.isZoomed &&
                st.scale < 0.62 &&
                !pinchCloseFired
              ) {
                pinchCloseFired = true
                cb.onPinchClose()
              }
              if (pinchCloseFired && st.scale < 0.62) st.scale = 0.62
            }
          }
          for (const c of event.changes) {
            if (c.positionChange.x !== 0 || c.positionChange.y !== 0) c.consume()
          }
          continue
        }

        const change = event.changes.find((c) => c.pressed)
        if (change === undefined) break
        velocityTracker.addPosition(change.uptimeMillis, change.position.x, change.position.y)

        // 首末页外翻等父层已接管拖动：positionChange() 会变成 0，
        // 仍须取消长按计时，避免拖了 380ms 后误开长按放大。
        if (change.isConsumed && !holdZoomConsuming && !transformMode) {
          moved = true
          st.lastTapTime = 0
          longPressAbort?.abort()
          continue
        }

        if (holdZoomConsuming) {
          // 长按放大/长按面板期间消费全部指针（多指同持不漏事件）
          for (const c of event.changes) {
            const d = c.positionChange
            if (d.x !== 0 || d.y !== 0) {
              if (holdZoomFired) st.panBy(d)
              c.consume()
            }
          }
          continue
        }

        if (transformMode) {
          // 双指抬掉一指后的剩余手势仍由本手势持有到底
          const d = change.positionChange
          if (d.x !== 0 || d.y !== 0) {
            if (st.isZoomed) st.panBy(d)
            change.consume()
          }
          continue
        }

        const delta = change.positionChange
        totalDragX += delta.x
        totalDragY += delta.y
        if (!moved && (Math.abs(totalDragX) > slop || Math.abs(totalDragY) > slop)) {
          moved = true
          st.lastTapTime = 0
          longPressAbort?.abort()
        }

        // QuickZoom 判定窗口消费事件：否则外部滚动容器会先吃掉头几 px 竖直位移
        if (quickZoomCandidate && !quickZoomActive) {
          if (delta.x !== 0 || delta.y !== 0) change.consume()
        }

        // QuickZoom 判定：竖直方向先过 slop 进入；水平主导则放弃（交给翻页）
        if (quickZoomCandidate && !quickZoomActive && moved) {
          if (Math.abs(totalDragY) > slop * 1.2 && Math.abs(totalDragY) > Math.abs(totalDragX)) {
            quickZoomActive = true
            longPressAbort?.abort()
          } else if (Math.abs(totalDragX) > Math.abs(totalDragY)) {
            quickZoomCandidate = false
          }
        }
        if (quickZoomActive) {
          // telephoto：向下拖放大，每 px +0.4%，焦点锁定双击点
          if (delta.y !== 0) {
            st.updateTransform(Math.exp(delta.y * 0.004), { x: 0, y: 0 }, down.position)
          }
          change.consume()
          continue
        }

        // 旧版放大边缘翻页回调：仅磁吸/卷页模式需要
        const edgeTurnMode = cfg.mode === 'MAGNETIC' || cfg.pageAnim === 'CURL'
        if (
          edgeTurnMode &&
          st.isZoomed &&
          moved &&
          cfg.zoomWhileTurn &&
          !edgeSwipeFired
        ) {
          // 仅水平主导且有实际水平位移才判方向；每次手势至多触发一次；
          // 触发需到边后累计再拖 12dp（单帧 0.5px 抖动误触）
          const dx = delta.x
          if (Math.abs(dx) > 0.5 && Math.abs(dx) > Math.abs(delta.y)) {
            const dir = dx > 0 ? 1 : -1
            if (st.horizontalPanEdge(dir)) {
              edgeSwipeAccum += Math.abs(dx)
              if (edgeSwipeAccum > this.env.dpToPx(12)) {
                edgeSwipeFired = true
                cb.onZoomedEdgeSwipe?.(dir)
                change.consume()
                continue
              }
            }
          }
        }

        if (st.isZoomed && moved) {
          const verdict = resolvePanArbitration({
            panLimitX: st.panLimitX(),
            panLimitY: st.panLimitY(),
            scale: st.scale,
            offsetX: st.offsetX,
            offsetY: st.offsetY,
            delta,
            direction: cfg.direction,
            zoomWhileTurn: cfg.zoomWhileTurn,
          })
          if (st.panLimitX() > 0.5 || st.panLimitY() > 0.5) {
            if (verdict.pan.x !== 0 || verdict.pan.y !== 0) st.panBy(verdict.pan)
            if (verdict.consumed) change.consume()
          }
          // 两轴均无余量（普通 fit 未放大）：不消费 → Pager 翻页
        }
        // 未放大时不消费 → pager 翻页
      }
    } finally {
      longPressAbort?.abort()
      st.gestureActive = false
      st.gestureEpoch += 1
      const wasQuickZoom = quickZoomActive
      const wasTransform = transformMode
      const vel = velocityTracker.calculateVelocity()
      const panVelocity: OffsetF = vel === null ? { x: 0, y: 0 } : { x: vel.x, y: vel.y }
      void panelLongPressed

      // 松手动画包装：releaseAnimating 是 "动画进行中" 信号，开始置 true、结束
      // （含取消）置 false——空闲等待者（hi-res 重解码）依赖它唤醒
      const launchRelease = (block: (signal: AbortSignal) => Promise<void>): void => {
        st.releaseAnimating = true
        const ctl = this.abortable()
        const c: Cancellable = { cancel: () => ctl.abort() }
        st.releaseJob = c
        void this.runRelease(c, ctl, block)
      }
      if (holdZoomFired) {
        st.holdZoomActive = false
        launchRelease(async (signal) => {
          await st.animateReset(signal)
        })
      } else if (wasQuickZoom || wasTransform) {
        // QuickZoom / 双指结束：越界回弹；双指平移带速度松手同样给惯性
        launchRelease(async (signal) => {
          if (wasTransform && st.isZoomed) {
            const flew = await st.fling(panVelocity, this.env.dpToPx, signal)
            if (!flew) await st.settle(signal)
          } else {
            await st.settle(signal)
          }
        })
      } else if (st.isZoomed && moved) {
        // 放大态平移松手：先尝试惯性，速度不足或不可平移则回弹
        launchRelease(async (signal) => {
          const flew = await st.fling(panVelocity, this.env.dpToPx, signal)
          if (!flew) await st.settle(signal)
        })
      } else {
        st.releaseJob = null
        st.releaseAnimating = false
      }
    }

    // 手指抬起：tap / double-tap 判定
    const pressDuration = gestureEndTime - downTime
    const tapEligible = !moved && !transformMode && !holdZoomConsuming && !quickZoomActive
    // 双击第二击按住较久后抬起仍应完成双击档位切换（tapMaxDuration 只约束单击）
    if (tapEligible && (pressDuration < this.tapMaxDuration || quickZoomCandidate)) {
      const now = gestureEndTime
      const isDouble =
        quickZoomCandidate ||
        (st.lastTapTime > 0 &&
          now - st.lastTapTime >= 0 &&
          now - st.lastTapTime <= this.doubleTapWindow &&
          Math.hypot(lastPos.x - st.lastTapPos.x, lastPos.y - st.lastTapPos.y) <
            this.doubleTapRadius)
      if (isDouble) {
        st.pendingTapJob?.cancel()
        st.lastTapTime = 0
        st.lastTapPos = { x: 0, y: 0 }
        if (cfg.doubleTapZoom) {
          // 动态档位：1x → 填满 → 1:1 → …；已在高档则回 1x
          // (read through an accessor: Kotlin's `state.releaseJob?.cancel()` sees the
          //  handle assigned inside `launchRelease` further up)
          st.releaseJobHandle()?.cancel()
          st.releaseAnimating = true
          const ctl = this.abortable()
          const c: Cancellable = { cancel: (): void => ctl.abort() }
          st.releaseJob = c
          void this.runRelease(c, ctl, async (signal) => {
            await st.animateZoomTo(st.nextStepScale(), lastPos, signal)
          })
        } else {
          cb.onTapZone(lastPos, this.env.size())
        }
      } else {
        st.lastTapTime = now
        st.lastTapPos = lastPos
        const tapPos = lastPos
        const tapSize = this.env.size()
        if (cfg.doubleTapZoom) {
          st.pendingTapJob?.cancel()
          const tapAbort = new AbortController()
          const c: Cancellable = { cancel: () => tapAbort.abort() }
          st.pendingTapJob = c
          this.env
            .sleep(this.doubleTapWindow)
            .then(() => {
              if (!tapAbort.signal.aborted) cb.onTapZone(tapPos, tapSize)
            })
            .catch(() => {})
        } else cb.onTapZone(tapPos, tapSize)
      }
    }
  }

  private async runRelease(
    c: Cancellable,
    ctl: AbortController,
    block: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    void c
    try {
      await block(ctl.signal)
    } catch {
      /* CancellationException / abort — same as Kotlin's scope cancellation */
    } finally {
      if (this.state.releaseJob === c) {
        this.state.releaseAnimating = false
        this.state.releaseJob = null
      }
    }
  }

  /** `awaitEachGesture { }` — runs until the source is exhausted or cancelled. */
  async run(): Promise<void> {
    for (;;) {
      await this.runOnce()
    }
  }
}

/* ══════════════ comicEdgeSwipe ══════════════ */

/**
 * 侧边滑动快速关闭：从屏幕左/右边缘向内滑动。挂在阅读器根部（Initial pass 抢先消费）。
 * `zoomed` 为放大状态信号——放大平移时从屏幕边缘起手不应退出阅读器（手势归属缩放）。
 */
export class ComicEdgeSwipeMachine {
  private zoomed: () => boolean
  private onTrigger: () => void

  constructor(
    private readonly enabled: boolean,
    zoomed: () => boolean,
    onTrigger: () => void,
    private readonly env: ComicZoomEnv,
  ) {
    this.zoomed = zoomed
    this.onTrigger = onTrigger
  }

  update(zoomed: () => boolean, onTrigger: () => void): void {
    this.zoomed = zoomed
    this.onTrigger = onTrigger
  }

  /** One gesture. Returns immediately when disabled (mirrors `if (!enabled) this`). */
  async runOnce(): Promise<void> {
    if (!this.enabled) return
    const env = this.env
    const edge = env.dpToPx(24)
    const slop = env.source.touchSlop
    const down = await env.source.down('Initial')
    if (this.zoomed() || down.isConsumed) return
    if (down.position.x > edge && down.position.x < env.size().width - edge) return
    const fromLeft = down.position.x <= edge
    let dx = 0
    let dy = 0
    let active = false
    for (;;) {
      const event = await env.source.next('Initial')
      if (event.changes.filter((c) => c.pressed).length > 1 || this.zoomed()) return
      const change = event.changes.find((c) => c.id === down.id)
      if (change === undefined) break
      if (!change.pressed) break
      // 放大态（双指/长按开始后）由缩放手势接管，边缘关闭让位
      if (active && this.zoomed()) {
        active = false
        return
      }
      dx += change.positionChange.x
      dy += change.positionChange.y
      const inward = fromLeft ? dx > 0 : dx < 0
      if (!active && Math.abs(dx) > slop && inward && Math.abs(dx) > Math.abs(dy) * 1.5) {
        active = true
      }
      if (active) change.consume()
    }
    if (active && Math.abs(dx) > env.dpToPx(64) && !this.zoomed()) this.onTrigger()
  }

  async run(): Promise<void> {
    for (;;) await this.runOnce()
  }
}

