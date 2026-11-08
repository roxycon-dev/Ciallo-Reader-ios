/**
 * comicSceneFx.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/ComicSceneFx.kt
 *
 * Kotlin source: 629 lines / 597 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1        `package com.example.ui.comic`               — package decl            │
 * │ L3–31     Compose imports (`Canvas`, `Brush`, `Color`, `Path`, `BlendMode`,    │
 * │           `Offset`, `Size`, `lerp`, `withTransform`, `rotate`, `dp`, …) —       │
 * │           replaced by the injected `SceneCanvas` seam                         │
 * │ L57–70    `private class FxParticle`                    — ported as an interface │
 * │           with mutable fields + `alphaFrac` getter                             │
 * │ L73       `private class FxRipple`                      — ported as interface    │
 * │ L84–85    `Color(0xFF7EC9EB)` / `Color(0xFF1A237E)`     — packed ARGB ints       │
 * │ L87–91    `waveY(x, baseline, frequency, amplitude, phase)` — ported verbatim   │
 * │ L94–98    `sakuraSwayDeg(t, period, seed)`              — ported verbatim        │
 * │ L101–110  `sakuraPetalShapes: List<Path>` — 24 pre-generated petal paths —      │
 * │           ported as `SAKURA_PETAL_SHAPES: PathCommand[][]` (same cubicTo /      │
 * │           close command sequence, pre-generated to avoid per-frame allocation) │
 * │ L112–142  `@Composable fun ComicSceneEffectOverlay`      — SKIPPED (UI): the     │
 * │           `remember`/`LaunchedEffect`/`withFrameNanos` loop became             │
 * │           `ComicSceneFxDriver` (`step(dt, absTime)` + `draw(canvas, scene)` +  │
 * │           injected `FrameTicker`), preserving the 0.001–0.1s dt clamp and the  │
 * │           "rebuild engine on scene change" behaviour                            │
 * │ L145–153  `ComicSceneFxEngine` fields incl. `Random(initialScene.ordinal*7919+13)`│
 * │           — ported; the RNG is the injected `FxRandom` (`nextFloat()` only),   │
 * │           with `createSeededRandom()` as the deterministic default             │
 * │ L162–170  `when (scene) { … }` step dispatch              — ported verbatim     │
 * │ L174–209  `ensureSpawn(vw, vh)` (counts / depth / maxLife per scene) — ported  │
 * │ L212–361  `stepRain` / `respawnTop` / `stepRipples` / `stepSnow` / `stepSakura`│
 * │           / `stepFirefly` / `stepCampfire` / `stepDrift` — ported line-by-line, │
 * │           every magic number preserved                                          │
 * │ L365–381  `draw(scope, scene)` dispatch                   — ported               │
 * │ L384–628  `drawRain` / `drawSnow` / `drawSakura` / `drawFireflies` /            │
 * │           `drawCampfire` / `drawOcean` / `drawNight` — ported as command       │
 * │           emitters against the injected `SceneCanvas` (same gradients, alphas,  │
 * │           blend modes, path maths)                                              │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * ── ADAPTATIONS ───────────────────────────────────────────────────────────────────
 * • `kotlin.random.Random(seed)` → injected `FxRandom { nextFloat(): number }`. The
 *   seed expression `scene.ordinal * 7919 + 13` is preserved and
 *   `createSeededRandom` (mulberry32) gives the same determinism contract: same seed
 *   ⇒ same stream. The exact float sequence differs from XorWow (it did not need to
 *   match: nothing persists these draws).
 * • Compose `Canvas`/`Brush`/`Color`/`Path`/`BlendMode` → `SceneCanvas` command sink.
 *   All colour literals, alpha factors, gradient stops, offsets and radii survive as
 *   numbers in the emitted commands.
 * • `withFrameNanos` → injected `FrameTicker`; `System.nanoTime()` → `performance.now()`
 *   via the ticker's timestamp, converted to seconds exactly as Kotlin did
 *   (`now / 1_000_000_000f`).
 * • `Color.lerp(a, b, t)` → `lerpArgb` (Android `Color.argb` linear blend).
 */

import type { ComicScene } from '../audio/sceneTypes'

/** `enum class ComicScene` declaration order — `ordinal` seeds the particle RNG. */
export const SCENE_ORDINAL: Readonly<Record<ComicScene, number>> = {
  NONE: 0,
  RAIN: 1,
  SNOW: 2,
  SAKURA: 3,
  FIREFLY: 4,
  OCEAN: 5,
  CAMPFIRE: 6,
  NIGHT: 7,
}

/* ── injected platform seams ─────────────────────────────────────────────────────── */

/** Packed 0xAARRGGBB colour, matching Compose `Color`'s internal representation. */
export type Argb = number

/** Compose `BlendMode` values used by this file. */
export type SceneBlend = 'SrcOver' | 'Plus'

/** One `Brush.linearGradient` / `radialGradient` / `verticalGradient` stop. */
export interface GradientStop {
  /** `position` — 0f..1f; radial gradients in this file use the 2-stop list form. */
  readonly position: number
  readonly color: Argb
}

export interface GradientSpec {
  readonly kind: 'linear' | 'radial' | 'vertical'
  readonly stops: ReadonlyArray<GradientStop>
  readonly startX?: number
  readonly startY?: number
  readonly endX?: number
  readonly endY?: number
  readonly centerX?: number
  readonly centerY?: number
  readonly radius?: number
  readonly startYTop?: number
  readonly endYBottom?: number
}

/** `androidx.compose.ui.graphics.Path` — cubic/quad segments, mirrored verbatim. */
export interface PathCommand {
  readonly op: 'moveTo' | 'lineTo' | 'cubicTo' | 'quadTo' | 'close'
  readonly args: ReadonlyArray<number>
}

export interface SceneLineCommand {
  readonly kind: 'line'
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly strokeWidth: number
  readonly color: Argb | null
  readonly brush: GradientSpec | null
}

export interface SceneCircleCommand {
  readonly kind: 'circle'
  readonly cx: number
  readonly cy: number
  readonly radius: number
  readonly color: Argb | null
  readonly brush: GradientSpec | null
  readonly blend: SceneBlend
}

export interface SceneOvalCommand {
  readonly kind: 'oval'
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly color: Argb | null
  readonly brush: GradientSpec | null
  readonly strokeWidth: number | null
}

export interface SceneRectCommand {
  readonly kind: 'rect'
  readonly brush: GradientSpec | null
  readonly width: number
  readonly height: number
}

export interface ScenePathCommand {
  readonly kind: 'path'
  readonly commands: ReadonlyArray<PathCommand>
  readonly color: Argb
  /** `withTransform({ translate(x, y); rotate(deg) })` — sakura petals only. */
  readonly translateX?: number
  readonly translateY?: number
  readonly rotateDeg?: number
}

export type SceneCommand =
  | SceneLineCommand
  | SceneCircleCommand
  | SceneOvalCommand
  | SceneRectCommand
  | ScenePathCommand

/**
 * Drawing sink (Compose `DrawScope`). The adapter replays these commands on Canvas 2D,
 * Skia or any other renderer — nothing here touches a rendering API.
 */
export interface SceneCanvas {
  /** `DrawScope.size` — the FX engine sizes its world from this. */
  size(): { width: number; height: number }
  emit(command: SceneCommand): void
}

/** `withFrameNanos` — drives `step`. Timestamps arrive in nanoseconds. */
export interface FrameTicker {
  /** Resolves the next frame's `frameTimeNanos`, or null when stopped. */
  next(): Promise<number | null>
}

/** Deterministic RNG seam (`kotlin.random.Random.nextFloat()` is the only call). */
export interface FxRandom {
  nextFloat(): number
}

/** mulberry32 — the default seeded generator. Same seed ⇒ same stream. */
export function createSeededRandom(seed: number): FxRandom {
  let a = seed >>> 0
  return {
    nextFloat(): number {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/* ── particle state ──────────────────────────────────────────────────────────────── */

/** 景深 0(远)..1(近) */
export interface FxParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  alphaBase: number
  life: number
  maxLife: number
  seed: number
  depth: number
}

/** 雨滴落地涟漪（独立短命实体） */
export interface FxRipple {
  x: number
  y: number
  t: number
  dur: number
  r: number
  seed: number
}

export function makeParticle(): FxParticle {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    size: 4,
    alphaBase: 0.6,
    life: 0,
    maxLife: 10,
    seed: 0,
    depth: 1,
  }
}

export function makeRipple(): FxRipple {
  return { x: 0, y: 0, t: 0, dur: 0.7, r: 10, seed: 0 }
}

/** `val alphaFrac: Float get() = (life / maxLife).coerceIn(0f, 1f)` */
export function alphaFrac(p: FxParticle): number {
  const v = p.life / p.maxLife
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/* ── Wave Field（skydoves 参数直取） ── */

const WAVE_LAYERS = 4
const WAVE_BASE_FREQ = 0.010
const WAVE_FREQ_RAMP = 0.18
const WAVE_AMPL_FALL_OFF = 0.08
const WAVE_PHASE_RAMP = 0.35
const WAVE_PHASE_SPEED = 2.2
const WAVE_SECONDARY_RATIO = 2.7
const WAVE_SECONDARY_AMP = 0.35
const WAVE_FRONT: Argb = 0xff7ec9eb
const WAVE_BACK: Argb = 0xff1a237e

export function waveY(
  x: number,
  baseline: number,
  frequency: number,
  amplitude: number,
  phase: number,
): number {
  const primary = Math.sin(x * frequency + phase) * amplitude
  const secondary =
    Math.sin(x * frequency * WAVE_SECONDARY_RATIO + phase * 1.7) * amplitude * WAVE_SECONDARY_AMP
  return baseline + primary + secondary
}

/* ── sakura sway 拟合（jhammann 关键帧 -5°→28°→3°、周期 2-4s 的非对称摆动） ── */

export function sakuraSwayDeg(t: number, period: number, seed: number): number {
  const ph = 2 * Math.PI * (t / period + seed)
  // 基波 + 二次谐波构造非对称（峰值偏前 40%），叠加中位偏移——与 CSS 关键帧同族
  return 8 + 16 * Math.sin(ph) + 7 * Math.sin(2 * ph + 0.9)
}

/** 预生成的樱花花瓣形状（尺寸变体，避免每帧 Path 分配） */
export const SAKURA_PETAL_SHAPES: ReadonlyArray<ReadonlyArray<PathCommand>> = buildSakuraPetalShapes()

function buildSakuraPetalShapes(): PathCommand[][] {
  const out: PathCommand[][] = []
  for (let i = 0; i < 24; i++) {
    const sp = i / 24
    const rx = 4.6 + sp * 3.2
    const cmds: PathCommand[] = [
      { op: 'moveTo', args: [-rx, 0] },
      { op: 'cubicTo', args: [-rx * 0.4, -rx * 0.75, rx * 0.5, -rx * 0.6, rx, 0] },
      { op: 'cubicTo', args: [rx * 0.5, rx * 0.6, -rx * 0.4, rx * 0.75, -rx, 0] },
      { op: 'close', args: [] },
    ]
    out.push(cmds)
  }
  return out
}

/* ── colour helpers (Compose Color + Color.lerp) ─────────────────────────────────── */

/** `Color(argb).copy(alpha = a)` — keeps RGB, replaces the alpha byte. */
export function withAlpha(argb: Argb, a: number): Argb {
  const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255) & 0xff
  return ((argb & 0x00ffffff) | (alpha << 24)) >>> 0
}

/**
 * `Brush.verticalGradient(listOf(c0, c1, c2))` distributes stops evenly; the
 * explicit-position overload is represented by supplying `position` per stop.
 */
export function evenStops(colors: ReadonlyArray<Argb>): GradientStop[] {
  const n = colors.length
  return colors.map((color, i) => ({ position: n === 1 ? 0 : i / (n - 1), color }))
}

/** `lerp(Color, Color, t)` over the ARGB channels (Android `Color.argb` blend). */
export function lerpArgb(a: Argb, b: Argb, t: number): Argb {
  const f = Math.max(0, Math.min(1, t))
  const inv = 1 - f
  const aa = Math.round(((a >>> 24) & 0xff) * inv + ((b >>> 24) & 0xff) * f)
  const ar = Math.round(((a >>> 16) & 0xff) * inv + ((b >>> 16) & 0xff) * f)
  const ag = Math.round(((a >>> 8) & 0xff) * inv + ((b >>> 8) & 0xff) * f)
  const ab = Math.round((a & 0xff) * inv + (b & 0xff) * f)
  return (((aa << 24) | (ar << 16) | (ag << 8) | ab) >>> 0)
}

/* ── engine ──────────────────────────────────────────────────────────────────────── */

/** Per-scene particle budget (`ensureSpawn`). */
export const SCENE_PARTICLE_COUNT: Readonly<Record<ComicScene, number>> = {
  NONE: 0,
  RAIN: 130,
  SNOW: 90,
  SAKURA: 44,
  FIREFLY: 26,
  CAMPFIRE: 34,
  OCEAN: 16,
  NIGHT: 46,
}

/**
 * 场景引擎：粒子状态 + 逐场景 step/draw。
 * 模拟状态：场景变化时整体重建（引擎持粒子数组，帧内原地变异，零分配）。
 */
export class ComicSceneFxEngine {
  readonly rnd: FxRandom
  readonly particles: FxParticle[] = []
  readonly ripples: FxRipple[] = []
  private w = 0
  private h = 0
  private time = 0
  private scene: ComicScene
  private spawned = false

  /** 主导风（px/s）：场景级慢变阵风（blow 模型：定向下限 + 缓慢起伏） */
  private wind = 0

  constructor(
    initialScene: ComicScene,
    random?: FxRandom,
  ) {
    this.scene = initialScene
    // `Random(initialScene.ordinal * 7919 + 13)` — ordinal comes from the enum's
    // declaration order (SCENE_ORDINAL mirrors it verbatim).
    this.rnd = random ?? createSeededRandom(SCENE_ORDINAL[initialScene] * 7919 + 13)
  }

  currentScene(): ComicScene {
    return this.scene
  }

  step(dt: number, absTime: number): void {
    this.time += dt
    this.wind = Math.sin(absTime * 0.11) * 22 + Math.sin(absTime * 0.043) * 30
    if (!this.spawned) return
    switch (this.scene) {
      case 'RAIN':
        this.stepRain(dt)
        break
      case 'SNOW':
        this.stepSnow(dt)
        break
      case 'SAKURA':
        this.stepSakura(dt)
        break
      case 'FIREFLY':
        this.stepFirefly(dt)
        break
      case 'CAMPFIRE':
        this.stepCampfire(dt)
        break
      case 'OCEAN':
      case 'NIGHT':
        this.stepDrift(dt)
        break
      case 'NONE':
        break
    }
  }

  /** 视口尺寸首次到达 / 变化时布种 */
  ensureSpawn(vw: number, vh: number): void {
    if (this.spawned && Math.abs(vw - this.w) < 1 && Math.abs(vh - this.h) < 1) return
    this.w = vw
    this.h = vh
    this.spawned = true
    this.particles.length = 0
    this.ripples.length = 0
    const count = SCENE_PARTICLE_COUNT[this.scene]
    for (let it = 0; it < count; it++) {
      const p = makeParticle()
      p.x = this.rnd.nextFloat() * this.w
      p.y = this.rnd.nextFloat() * this.h
      p.depth =
        this.scene === 'RAIN' || this.scene === 'SNOW'
          ? ((it % 3) / 2) * 0.8 + 0.2 // 三层景深
          : this.rnd.nextFloat()
      p.seed = this.rnd.nextFloat()
      p.maxLife =
        this.scene === 'SAKURA'
          ? 14 + this.rnd.nextFloat() * 8
          : this.scene === 'CAMPFIRE'
            ? 1.2 + this.rnd.nextFloat() * 1.4
            : this.scene === 'FIREFLY' || this.scene === 'OCEAN' || this.scene === 'NIGHT'
              ? 8 + this.rnd.nextFloat() * 8
              : 30
      p.life = this.rnd.nextFloat() * p.maxLife
      this.particles.push(p)
    }
  }

  /* ── 雨：重力加速 + 终端速度 + 风 ── */
  private stepRain(dt: number): void {
    for (const p of this.particles) {
      p.life += dt
      const term = 420 + 640 * p.depth // 终端速度（景深）
      const g = 2400 * (0.5 + p.depth) // 重力（ParticleEmitter a·dt）
      p.vy = Math.min(p.vy + g * dt, term)
      p.vx = this.wind * (0.5 + p.depth) + Math.sin(this.time * 0.7 + p.seed * 9) * 18
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.y > this.h) {
        // 回收：顶部重生（EdgeBehavior.Wrap 语义）
        if (this.ripples.length < 22 && this.rnd.nextFloat() < 0.5) {
          this.ripples.push({
            x: p.x,
            y: this.h - 3 - this.rnd.nextFloat() * 9,
            t: 0,
            dur: 0.55 + this.rnd.nextFloat() * 0.4,
            r: 4 + this.rnd.nextFloat() * 8,
            seed: p.seed,
          })
        }
        this.respawnTop(p)
      }
      if (p.x < -40) p.x = this.w + 20
      if (p.x > this.w + 40) p.x = -20
    }
    this.stepRipples(dt)
  }

  private respawnTop(p: FxParticle): void {
    p.y = -30 - this.rnd.nextFloat() * 80
    p.x = this.rnd.nextFloat() * (this.w + 120) - 60
    p.vy = 40
    p.life = 0
  }

  private stepRipples(dt: number): void {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]!
      r.t += dt
      if (r.t > r.dur) this.ripples.splice(i, 1)
    }
  }

  /* ── 雪：低重力 + 终端小 + 横向摆动 ── */
  private stepSnow(dt: number): void {
    for (const p of this.particles) {
      p.life += dt
      const term = 24 + 70 * p.depth
      p.vy = Math.min(p.vy + 140 * dt, term)
      p.vx = this.wind * 0.4 + Math.sin(this.time * (0.5 + p.seed) + p.seed * 20) * (10 + 26 * p.depth)
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.y > this.h + 20) {
        p.y = -16
        p.x = this.rnd.nextFloat() * this.w
        p.vy = 0
        p.life = 0
      }
      if (p.x < -30) p.x = this.w + 10
      if (p.x > this.w + 30) p.x = -10
    }
  }

  /* ── 樱花（jhammann/sakura 三运动叠加）：fall + blow + sway ── */
  private stepSakura(dt: number): void {
    for (const p of this.particles) {
      p.life += dt
      if (p.life > p.maxLife) {
        p.life = 0
        p.y = -24
        p.x = this.rnd.nextFloat() * this.w
      }
      // fall：近似线性的缓慢下落（fallSpeed 语义）
      p.vy = 26 + 44 * p.depth
      // blow：慢速定向横漂（soft/medium-left/right 语义 → wind + 每瓣固定偏向）
      const blowDir = p.seed > 0.5 ? 1 : -1
      const blow = this.wind * 0.6 + blowDir * (12 + 30 * p.seed)
      // sway：横向摆动（2-4s 周期）
      const swayPeriod = 2 + p.seed * 2
      p.vx = blow + Math.cos((this.time * 2 * Math.PI) / swayPeriod + p.seed * 12) * 26
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.x < -40) p.x = this.w + 20
      if (p.x > this.w + 40) p.x = -20
      if (p.y > this.h + 30) {
        p.y = -24
        p.x = this.rnd.nextFloat() * this.w
        p.life = 0
      }
    }
  }

  /* ── 萤火：随机游走（Ornstein-Uhlenbeck 型速度扰动 + 阻尼 + 软边界回航） ── */
  private stepFirefly(dt: number): void {
    for (const p of this.particles) {
      p.life += dt
      if (p.life > p.maxLife) {
        p.life = 0
        p.x = this.rnd.nextFloat() * this.w
        p.y = this.rnd.nextFloat() * this.h
      }
      // 随机加速度 + 轻阻尼（随机游走，不是直线）
      const sigma = 140 * (0.5 + p.seed)
      p.vx += (this.rnd.nextFloat() - 0.5) * sigma * dt
      p.vy += (this.rnd.nextFloat() - 0.5) * sigma * dt
      p.vx *= 1 - 0.6 * dt
      p.vy *= 1 - 0.6 * dt
      const sp = Math.hypot(p.vx, p.vy)
      if (sp > 46) {
        p.vx *= 46 / sp
        p.vy *= 46 / sp
      }
      // 软边界回航（离边 <60px 时向内转向力）
      if (p.x < 60) p.vx += 60 * dt * 3
      if (p.x > this.w - 60) p.vx -= 60 * dt * 3
      if (p.y < 60) p.vy += 60 * dt * 3
      if (p.y > this.h - 60) p.vy -= 60 * dt * 3
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
  }

  /* ── 篝火火星（ParticleEmitter 上抛+回拉重力+生命淡出） ── */
  private stepCampfire(dt: number): void {
    const cx = this.w * 0.5
    for (const p of this.particles) {
      p.life += dt
      if (p.life > p.maxLife) {
        p.life = 0
        p.maxLife = 1.2 + this.rnd.nextFloat() * 1.4
        p.x = cx + (this.rnd.nextFloat() - 0.5) * this.w * 0.12
        p.y = this.h * 0.94 - this.rnd.nextFloat() * 30
        p.vy = -(110 + this.rnd.nextFloat() * 120) * (0.6 + p.depth)
        p.vx = (this.rnd.nextFloat() - 0.5) * 36
        p.seed = this.rnd.nextFloat()
      }
      p.vy += 46 * dt // 轻重力（上抛后减速、飘落）
      p.vx += Math.sin(this.time * 2.2 + p.seed * 17) * 30 * dt // 火焰热扰动摇摆
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
  }

  /* ── 海边飞沫/夏夜星尘的缓漂 ── */
  private stepDrift(dt: number): void {
    for (const p of this.particles) {
      p.life += dt
      if (p.life > p.maxLife) p.life = 0
      p.vx = this.wind * 0.25 + Math.sin(this.time * 0.16 + p.seed * 9) * 14
      p.x += p.vx * dt
      p.y +=
        (this.scene === 'OCEAN' ? -6 : 3) *
          p.depth *
          dt *
          (this.scene === 'OCEAN' ? 8 : 2) +
        Math.sin(this.time * 0.4 + p.seed * 31) * 4 * dt
      if (p.x < -30) p.x = this.w + 20
      if (p.x > this.w + 30) p.x = -20
      if (p.y < -30) p.y = this.h + 20
      if (p.y > this.h + 30) p.y = -20
    }
  }

  /* ════════════════ 绘制 ════════════════ */

  draw(canvas: SceneCanvas, scene: ComicScene): void {
    const size = canvas.size()
    this.ensureSpawn(size.width, size.height)
    if (!this.spawned) return
    if (this.scene !== scene) this.scene = scene
    switch (scene) {
      case 'RAIN':
        this.drawRain(canvas)
        break
      case 'SNOW':
        this.drawSnow(canvas)
        break
      case 'SAKURA':
        this.drawSakura(canvas)
        break
      case 'FIREFLY':
        this.drawFireflies(canvas)
        break
      case 'CAMPFIRE':
        this.drawCampfire(canvas)
        break
      case 'OCEAN':
        this.drawOcean(canvas)
        break
      case 'NIGHT':
        this.drawNight(canvas)
        break
      case 'NONE':
        break
    }
  }

  /** 雨（WeatherView 运动模糊）：沿速度矢量的渐变软尖划线 */
  private drawRain(c: SceneCanvas): void {
    for (const p of this.particles) {
      const stretch = (10 + 14 * p.depth) * (0.7 + 0.6 * p.seed)
      const len = Math.max(1, Math.hypot(p.vx, p.vy))
      const ux = p.vx / len
      const uy = p.vy / len
      const x1 = p.x - ux * stretch
      const y1 = p.y - uy * stretch
      const x2 = p.x + ux * stretch
      const y2 = p.y + uy * stretch
      const a = (0.24 + 0.4 * p.depth) * (0.7 + 0.3 * p.seed)
      c.emit({
        kind: 'line',
        x1,
        y1,
        x2,
        y2,
        strokeWidth: (0.9 + 0.9 * p.depth) * (0.8 + 0.4 * p.seed),
        color: null,
        brush: {
          kind: 'linear',
          stops: [
            { position: 0, color: withAlpha(0xffb8c8dc, 0) },
            { position: 0.45, color: withAlpha(0xffd6e4f2, a) },
            { position: 0.55, color: withAlpha(0xffe8f0fa, a) },
            { position: 1, color: withAlpha(0xffb8c8dc, 0) },
          ],
          startX: x1,
          startY: y1,
          endX: x2,
          endY: y2,
        },
      })
    }
    // 落地涟漪（扩散椭圆 + 渐隐）
    for (const r of this.ripples) {
      const t = r.t / r.dur
      c.emit({
        kind: 'oval',
        left: r.x - r.r * (0.5 + t),
        top: r.y - r.r * (0.2 + t * 0.4),
        width: r.r * (1 + 2 * t),
        height: r.r * (0.4 + 0.8 * t),
        color: withAlpha(0xff9ec4de, (1 - t) * 0.3),
        brush: null,
        strokeWidth: 1.1 * (1 - t) + 0.3,
      })
    }
  }

  /** 雪（WeatherView 径向渐变 + 第四轮景深分层保留） */
  private drawSnow(c: SceneCanvas): void {
    for (const p of this.particles) {
      const near = p.depth > 0.6
      const radius = near ? 3.2 + p.seed * 3.4 : 1.3 + p.seed * 2.1
      if (near) {
        c.emit({
          kind: 'circle',
          cx: p.x,
          cy: p.y,
          radius: radius * 2.2,
          color: null,
          brush: {
            kind: 'radial',
            stops: [
              { position: 0, color: 0x40ffffff },
              { position: 1, color: 0 },
            ],
            centerX: p.x,
            centerY: p.y,
            radius: radius * 2.2,
          },
          blend: 'SrcOver',
        })
        c.emit({
          kind: 'circle',
          cx: p.x,
          cy: p.y,
          radius,
          color: withAlpha(0xffffffff, 0.65 + p.seed * 0.3),
          brush: null,
          blend: 'SrcOver',
        })
      } else {
        // 远景：径向渐变软圆（透明带随深度 sigmoid 前移——WeatherView 模型）
        const sigmoid = 1 / (1 + Math.exp(-(p.depth * 2 - 1)))
        const coreStop = 0.15 + sigmoid * 0.3
        c.emit({
          kind: 'circle',
          cx: p.x,
          cy: p.y,
          radius: radius * 1.6,
          color: null,
          brush: {
            kind: 'radial',
            stops: [
              { position: 0, color: withAlpha(0xffc9d9ea, 0.16 + p.seed * 0.26) },
              {
                position: coreStop,
                color: withAlpha(0xffc9d9ea, (0.16 + p.seed * 0.26) * 0.6),
              },
              { position: 1, color: 0 },
            ],
            centerX: p.x,
            centerY: p.y,
            radius: radius * 1.6,
          },
          blend: 'SrcOver',
        })
      }
    }
  }

  /** 樱花：花瓣形 + sway 旋转 + 生命淡出（sakura 0.9→0.2） */
  private drawSakura(c: SceneCanvas): void {
    const shapes = SAKURA_PETAL_SHAPES
    for (const p of this.particles) {
      const lifeFrac = alphaFrac(p)
      // 生命期 0.9 → 0.2 淡出（fall 关键帧语义）
      const alpha = (0.9 - 0.7 * lifeFrac) * (0.55 + 0.45 * p.depth)
      const rot = sakuraSwayDeg(this.time, 2 + p.seed * 2, p.seed)
      const idx = Math.trunc(p.seed * shapes.length) % shapes.length
      const pink = p.seed > 0.5 ? 0xfff6c6d9 : 0xfffadce8
      c.emit({
        kind: 'path',
        commands: shapes[idx]!,
        color: withAlpha(pink, alpha),
        translateX: p.x,
        translateY: p.y,
        rotateDeg: rot,
      })
    }
  }

  /** 萤火：呼吸发光（Plus 混合）+ 随机游走轨迹 */
  private drawFireflies(c: SceneCanvas): void {
    for (const p of this.particles) {
      // 呼吸感亮度（非固定亮度）
      const pulse = 0.5 + 0.5 * Math.sin(this.time * (1.1 + p.seed * 2.2) + p.seed * 30)
      const glowA = 0.12 + 0.75 * pulse
      const glowR = 7 + 6 * pulse + p.depth * 4
      c.emit({
        kind: 'circle',
        cx: p.x,
        cy: p.y,
        radius: glowR * 2.4,
        color: null,
        brush: {
          kind: 'radial',
          stops: [
            { position: 0, color: withAlpha(0xffd8ff9e, glowA) },
            { position: 1, color: 0 },
          ],
          centerX: p.x,
          centerY: p.y,
          radius: glowR * 2.4,
        },
        blend: 'Plus',
      })
      c.emit({
        kind: 'circle',
        cx: p.x,
        cy: p.y,
        radius: 1.6 + p.depth,
        color: withAlpha(0xfff4ffd0, 0.35 + 0.6 * pulse),
        brush: null,
        blend: 'Plus',
      })
    }
  }

  /** 篝火：火焰本体 Path 形变 + 发光火星 */
  private drawCampfire(c: SceneCanvas): void {
    const cx = this.w * 0.5
    const baseY = this.h * 0.965
    // 火焰本体：3 层舌尖，控制点随时间正弦摆动（skydoves Canvas 物理动效思路）
    const tongues = [0xffe25822, 0xfff77622, 0xffffc53d]
    tongues.forEach((color, layer) => {
      const tW = this.w * (0.1 + 0.055 * layer) // 逐层收窄
      const tH = (110 + 50 * (2 - layer)) * (1 + 0.08 * Math.sin(this.time * 5.1 + layer * 2.1))
      const swayX = Math.sin(this.time * (3.4 + layer * 0.8) + layer * 1.7) * (14 + 7 * (2 - layer))
      const flicker = 0.82 + 0.18 * Math.sin(this.time * 9.3 + layer * 4.4)
      const commands: PathCommand[] = [
        { op: 'moveTo', args: [cx - tW, baseY] },
        {
          op: 'quadTo',
          args: [cx - tW * 0.8 + swayX * 0.4, baseY - tH * 0.45, cx + swayX, baseY - tH * flicker],
        },
        {
          op: 'quadTo',
          args: [cx + tW * 0.8 + swayX * 0.4, baseY - tH * 0.45, cx + tW, baseY],
        },
        { op: 'close', args: [] },
      ]
      c.emit({ kind: 'path', commands, color: withAlpha(color, 0.5 - 0.12 * layer) })
    })
    // 火焰辉光
    c.emit({
      kind: 'circle',
      cx,
      cy: baseY - 40,
      radius: this.w * 0.32,
      color: null,
      brush: {
        kind: 'radial',
        stops: [
          { position: 0, color: 0x30ffb25e },
          { position: 1, color: 0 },
        ],
        centerX: cx,
        centerY: baseY - 40,
        radius: this.w * 0.32,
      },
      blend: 'SrcOver',
    })
    // 火星：上飘 + 发光 + 渐隐（生命 (1-frac) 淡出）
    for (const p of this.particles) {
      const frac = alphaFrac(p)
      const fade = frac < 0 ? 0 : frac > 1 ? 1 : 1 - frac
      const a = 0.75 * fade * fade
      c.emit({
        kind: 'circle',
        cx: p.x,
        cy: p.y,
        radius: 2.2 + 2.6 * p.depth,
        color: null,
        brush: {
          kind: 'radial',
          stops: [
            { position: 0, color: withAlpha(0xffffb25e, a) },
            { position: 1, color: 0 },
          ],
          centerX: p.x,
          centerY: p.y,
          radius: 2.2 + 2.6 * p.depth,
        },
        blend: 'Plus',
      })
      c.emit({
        kind: 'circle',
        cx: p.x,
        cy: p.y,
        radius: 1.1 + p.depth * 0.9,
        color: withAlpha(0xffffd9a0, a),
        brush: null,
        blend: 'Plus',
      })
    }
  }

  /** 海边：Wave Field 多层正弦水面 + 飞沫 + 黄昏氛围天（flux 构图） */
  private drawOcean(c: SceneCanvas): void {
    const size = c.size()
    const waveTop = this.h * 0.8
    // 天空氛围（flux：黄昏渐变，克制 α 不盖阅读内容）
    c.emit({
      kind: 'rect',
      width: size.width,
      height: size.height,
      brush: {
        kind: 'vertical',
        stops: evenStops([withAlpha(0xff0a0e27, 0.16), withAlpha(0xff2e3a67, 0.05), 0]),
        startYTop: 0,
        endYBottom: waveTop,
      },
    })
    // 水面（skydoves Wave Field：4 层 + 频率/振幅/相位爬升视差 + 二次谐波）
    const baseline0 = this.h * 0.97
    const stepPx = 6
    for (let layer = WAVE_LAYERS - 1; layer >= 0; layer--) {
      const layerT = layer / (WAVE_LAYERS - 1)
      const freq = WAVE_BASE_FREQ * (1 + layer * WAVE_FREQ_RAMP)
      const ampl = this.h * 0.018 * Math.max(1 - layer * WAVE_AMPL_FALL_OFF, 0.05)
      const phase = this.time * WAVE_PHASE_SPEED * (1 + layer * WAVE_PHASE_RAMP) + layer * (Math.PI / WAVE_LAYERS)
      const baseColor = lerpArgb(WAVE_FRONT, WAVE_BACK, layerT)
      // 氛围层：整体 α 压低（0.34 前 → 0.12 后），漫画保持可读
      const layerColor = withAlpha(baseColor, 0.12 + 0.22 * (1 - layerT))
      const commands: PathCommand[] = []
      let x = 0
      commands.push({
        op: 'moveTo',
        args: [0, waveY(x, baseline0 - layer * this.h * 0.012, freq, ampl, phase)],
      })
      while (x < this.w) {
        x = Math.min(x + stepPx, this.w)
        commands.push({
          op: 'lineTo',
          args: [x, waveY(x, baseline0 - layer * this.h * 0.012, freq, ampl, phase)],
        })
      }
      commands.push({ op: 'lineTo', args: [this.w, this.h] })
      commands.push({ op: 'lineTo', args: [0, this.h] })
      commands.push({ op: 'close', args: [] })
      c.emit({ kind: 'path', commands, color: layerColor })
    }
    // 飞沫光点（近水面缓漂）
    for (const p of this.particles) {
      const a = 0.1 + 0.14 * (0.5 + 0.5 * Math.sin(this.time * 0.8 + p.seed * 21))
      c.emit({
        kind: 'circle',
        cx: p.x,
        cy: p.y * 0.2 + waveTop,
        radius: 1 + p.seed * 1.8,
        color: withAlpha(0xffdde8f2, a),
        brush: null,
        blend: 'SrcOver',
      })
    }
  }

  /** 夏夜：星光层次（呼吸闪烁）+ 萤火点缀 + 薄云漂移（flux 分层构图） */
  private drawNight(c: SceneCanvas): void {
    const size = c.size()
    // 夜幕氛围（顶部深蓝，克制 α）
    c.emit({
      kind: 'rect',
      width: size.width,
      height: size.height,
      brush: {
        kind: 'vertical',
        stops: evenStops([withAlpha(0xff070b1e, 0.18), withAlpha(0xff101b3a, 0.06), 0]),
        startYTop: 0,
        endYBottom: this.h * 0.7,
      },
    })
    for (const p of this.particles) {
      const twinkle = 0.5 + 0.5 * Math.sin(this.time * (0.8 + p.seed * 2.6) + p.seed * 40)
      const layerBright = 0.25 + 0.6 * p.depth
      const a = layerBright * (0.35 + 0.65 * twinkle)
      if (p.seed > 0.28) {
        // 星：小亮点 + 闪烁（个别大星带十字光芒）
        c.emit({
          kind: 'circle',
          cx: p.x,
          cy: p.y,
          radius: 0.8 + p.depth * 1.6,
          color: withAlpha(0xffeaf2ff, a),
          brush: null,
          blend: 'Plus',
        })
        if (p.seed > 0.93) {
          const len = 4 + 5 * twinkle
          c.emit({
            kind: 'line',
            x1: p.x - len,
            y1: p.y,
            x2: p.x + len,
            y2: p.y,
            strokeWidth: 0.8,
            color: withAlpha(0xffeaf2ff, a * 0.6),
            brush: null,
          })
          c.emit({
            kind: 'line',
            x1: p.x,
            y1: p.y - len,
            x2: p.x,
            y2: p.y + len,
            strokeWidth: 0.8,
            color: withAlpha(0xeaf2ff, a * 0.6),
            brush: null,
          })
        }
      } else if (p.seed > 0.12) {
        // 萤火点缀（下半屏，呼吸发光）
        const y = p.y * 0.5 + this.h * 0.5
        const glowA = (0.1 + 0.5 * twinkle) * p.depth
        c.emit({
          kind: 'circle',
          cx: p.x,
          cy: y,
          radius: 9,
          color: null,
          brush: {
            kind: 'radial',
            stops: [
              { position: 0, color: withAlpha(0xffd8ff9e, glowA) },
              { position: 1, color: 0 },
            ],
            centerX: p.x,
            centerY: y,
            radius: 9,
          },
          blend: 'Plus',
        })
      }
    }
    // 薄云：2-3 团椭圆雾缓慢漂移（flux Clouds 意象的程序化实现）
    const cloudCount = 3
    for (let i = 0; i < cloudCount; i++) {
      const seedC = i * 0.37 + 0.11
      const cy = this.h * (0.1 + 0.09 * i)
      const speed = 6 + 10 * seedC
      const cxPos = ((this.time * speed + seedC * this.w * 3) % (this.w + 420)) - 210
      const cw = this.w * (0.3 + 0.12 * i)
      c.emit({
        kind: 'oval',
        left: cxPos - cw * 0.5,
        top: cy - 36,
        width: cw,
        height: 72,
        color: null,
        brush: {
          kind: 'radial',
          stops: [
            { position: 0, color: withAlpha(0xff93a7ce, 0.1) },
            { position: 1, color: 0 },
          ],
          centerX: cxPos,
          centerY: cy,
          radius: cw * 0.5,
        },
        strokeWidth: null,
      })
    }
  }
}

/* ══════════════ Composable driver (L112–142) ══════════════ */

/** `dt = ((now - last) / 1_000_000_000f).coerceIn(0.001f, 0.1f)` — extracted so the
 *  cut-over is unit-testable without a frame ticker. */
export function clampFrameDt(deltaNanos: number): number {
  return Math.min(Math.max(deltaNanos / 1_000_000_000, 0.001), 0.1)
}

/**
 * `ComicSceneEffectOverlay` 的纯逻辑形态：帧循环 + 场景切换时重建引擎。
 * 模拟在帧内同步完成（≤160 粒子），draw 阶段只读——与 Kotlin 注释所述一致。
 */
export class ComicSceneFxDriver {
  private engine: ComicSceneFxEngine
  private scene: ComicScene
  private last = 0
  private frameTick = 0

  constructor(
    initialScene: ComicScene,
    private readonly ticker: FrameTicker,
    private readonly random?: FxRandom,
  ) {
    this.scene = initialScene
    this.engine = new ComicSceneFxEngine(initialScene, random)
  }

  /** `LaunchedEffect(currentScene) { engine = ComicSceneFxEngine(currentScene) }` */
  setScene(scene: ComicScene): void {
    this.scene = scene
    this.engine = new ComicSceneFxEngine(scene, this.random)
  }

  currentScene(): ComicScene {
    return this.scene
  }

  /** The timestamp the UI layer uses to trigger a repaint. */
  tick(): number {
    return this.frameTick
  }

  /** One `withFrameNanos` iteration; `now` is in nanoseconds. */
  frame(now: number): void {
    if (this.last !== 0) {
      const dt = clampFrameDt(now - this.last)
      this.engine.step(dt, now / 1_000_000_000)
      this.frameTick = now
    }
    this.last = now
  }

  /**
   * The `while (true) { withFrameNanos { … } }` loop. Resolves when the ticker stops
   * (`next()` resolves null) or the scene becomes NONE.
   */
  async run(canvas: SceneCanvas): Promise<void> {
    for (;;) {
      const now = await this.ticker.next()
      if (now === null) return
      this.frame(now)
      if (this.scene !== 'NONE') this.engine.draw(canvas, this.scene)
    }
  }

  /** Draw one frame without advancing the simulation (used by the UI layer). */
  draw(canvas: SceneCanvas): void {
    if (this.scene === 'NONE') return
    this.engine.draw(canvas, this.scene)
  }
}
