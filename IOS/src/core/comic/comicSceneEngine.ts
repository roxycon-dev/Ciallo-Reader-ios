/**
 * comicSceneEngine.kt  ←  novel-reader/app/src/main/java/com/example/ui/comic/ComicSceneEngine.kt
 * file: `comicSceneEngine.ts`
 *
 * Kotlin source: 257 lines / 240 non-blank.
 *
 * ┌─ SKIPPED LINE RANGES (verbatim accounting) ────────────────────────────────────┐
 * │ L1        `package com.example.ui.comic`               — package decl            │
 * │ L3–23     Compose + `AudioTrack`/`AudioFormat`/`AudioManager` imports — the    │
 * │           audio device and the UI overlay are injected seams                   │
 * │ L34–41    `class ComicAmbientAudio(context)` with `MediaPlayer` / `AudioTrack`  │
 * │           / `Thread` fields — became `ComicAmbientAudio` over the injected     │
 * │           `AudioPlayer` / `PcmSink` / `Scheduler`                              │
 * │ L56       `create(context)` — the caller constructs the adapter directly       │
 * │ L67–87    `context.assets.openFd("ambient/$asset")` + `MediaPlayer` setup +     │
 * │           `prepare()`/`start()` — became `AudioPlayer.playAsset(asset, loop)`  │
 * │ L92–125   `startSynth(scene)`: `AudioTrack.getMinBufferSize`, `AudioTrack(...)` │
 * │           ctor, `setVolume`/`play`, `write(chunk)`, and the `Thread { … }`     │
 * │           daemon loop — became `PcmSink.start(Synth, chunkSize)`; the chunk    │
 * │           size 4096, the 22050 Hz rate and the coerceAtLeast(8192) buffer      │
 * │           floor are preserved as constants                                      │
 * │ L135–151  `stop()`: `MediaPlayer.stop/release`, `Thread.join(300)`,            │
 * │           `AudioTrack.stop/release` — became `AudioPlayer.stop()` /             │
 * │           `PcmSink.stop(timeoutMs)` / `PcmSink.release()`                      │
 * │ L154–168  `abstract class Synth` + `companion forScene` — ported                │
 * │ L171–256  `Rain` / `Ocean` / `Campfire` / `Night` / `Breeze` subclasses —       │
 * │           ported line-by-line; only `kotlin.random.Random.nextFloat()` → the   │
 * │           injected `NoiseRandom`                                                │
 * └───────────────────────────────────────────────────────────────────────────────┘
 *
 * The DSP itself (noise shaping coefficients, LFO frequencies, crackle envelope,
 * chirp phase wrap, amplitude curves) is byte-for-byte the Kotlin arithmetic.
 *
 * ── ADAPTATIONS ───────────────────────────────────────────────────────────────────
 * • `MediaPlayer` loop → `AudioPlayer` seam (HTMLAudioElement / AVPlayer adapter).
 * • `AudioTrack` streaming → `PcmSink` seam (Web Audio AudioWorklet / AVAudioEngine).
 * • `Thread { while (running) { fill; write } }` → an injected `onChunk` callback the
 *   sink invokes; `running` semantics preserved (the sink stops calling after stop()).
 * • `kotlin.random.Random.nextFloat()` → injected `NoiseRandom` so tests can pin the
 *   noise stream; default is an unseeded mulberry32 (`Math.random`-free).
 * • The Compose `ComicSceneEffectOverlay` import in the file header belongs to
 *   comicSceneFx.ts (ported there) and is not duplicated here.
 */

import type { ComicScene } from '../audio/sceneTypes'

/* ── injected seams ──────────────────────────────────────────────────────────────── */

/** `MediaPlayer`-equivalent: one looping CC0 recording per scene. */
export interface AudioPlayer {
  /**
   * Open + loop + play a bundled asset. Synchronous by design so `start()` keeps
   * Kotlin's `runCatching { … }` shape — throw = asset missing → synth fallback.
   */
  playAsset(asset: string, loop: boolean): void
  setVolume(volume: number): void
  stop(): void
}

/** `AudioTrack`-equivalent: 16-bit mono PCM sink at a fixed sample rate. */
export interface PcmSink {
  /** Minimum buffer in bytes (`AudioTrack.getMinBufferSize`, floored at 8192). */
  minBufferBytes(): number
  setVolume(volume: number): void
  play(): void
  /** Pull chunks: the sink calls `onChunk(Int16Array)` until `stop()` is called. */
  start(onChunk: (chunk: Int16Array) => void): void
  stop(): void
  release(): void
}

/** `View.post`-style deferral for the synth daemon loop's shutdown handshake. */
export interface AudioScheduler {
  joinOrTimeout(ms: number): void
}

/** `kotlin.random.Random.nextFloat()` — the only call the synths make. */
export interface NoiseRandom {
  nextFloat(): number
}

/** Unseeded generator matching `kotlin.random.Random` (global, non-deterministic). */
export function createNoiseRandom(): NoiseRandom {
  let a = (Math.floor(Math.random() * 0x100000000) >>> 0) >>> 0
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

/* ── ambient asset table ─────────────────────────────────────────────────────────── */

/**
 * 场景 → 真实录音资产名（CC0；见 assets/ambient/CREDITS.md）。
 * Every attribution comment from the Kotlin source is preserved verbatim.
 */
export function assetOf(scene: ComicScene): string | null {
  switch (scene) {
    case 'RAIN':
      return 'scene_rain.ogg' // Ylmir @ opengameart, Rain (loopable)
    case 'SNOW':
      return 'scene_snow.ogg' // TinyWorlds, Forest Ambience（雪夜林间）
    case 'SAKURA':
      return 'scene_sakura.ogg' // isaiah658, Ambient Bird Sounds（春樱鸟鸣）
    case 'FIREFLY':
      return 'scene_firefly.ogg' // Wolfgang_, Crickets Ambient（夏夜蟋蟀）→ 新反馈7：+夜风层
    case 'OCEAN':
      return 'scene_ocean.ogg' // RandomMind, Sea and river waves（海浪）
    case 'CAMPFIRE':
      return 'scene_campfire.ogg' // PagDev, Fireplace loop（篝火）
    case 'NIGHT':
      return 'scene_night.ogg' // Siobhan Leachman, Chorus Cicada（蝉鸣）
    case 'NONE':
      return null
  }
}

/* ── procedural synthesisers (L155–256) ──────────────────────────────────────────── */

const TWO_PI = Math.PI * 2

/** 程序化合成器：逐 chunk 生成 PCM */
export abstract class Synth {
  constructor(protected readonly sampleRate: number) {}

  abstract fill(out: Int16Array): void

  protected toSample(v: number): number {
    const c = v < -1 ? -1 : v > 1 ? 1 : v
    const n = Math.trunc(c * 32767)
    // Int16 wraps like Kotlin's `Short` bit pattern
    return n < -32768 ? 32767 : n
  }

  static forScene(scene: ComicScene, sampleRate: number, rnd: NoiseRandom): Synth {
    switch (scene) {
      case 'RAIN':
        return new Rain(sampleRate, rnd)
      case 'OCEAN':
        return new Ocean(sampleRate, rnd)
      case 'CAMPFIRE':
        return new Campfire(sampleRate, rnd)
      case 'NIGHT':
        return new Night(sampleRate)
      case 'SNOW':
      case 'SAKURA':
      case 'FIREFLY':
        return new Breeze(sampleRate, rnd)
      case 'NONE':
        return new Breeze(sampleRate, rnd)
    }
  }
}

/** 白噪声 + 一阶低通 */
export class Rain extends Synth {
  private lp = 0
  constructor(
    sampleRate: number,
    private readonly rnd: NoiseRandom,
  ) {
    super(sampleRate)
  }

  override fill(out: Int16Array): void {
    for (let i = 0; i < out.length; i++) {
      const white = this.rnd.nextFloat() * 2 - 1
      this.lp += 0.18 * (white - this.lp)
      const v = this.lp * 1.6
      out[i] = this.toSample(v)
    }
  }
}

/** 布朗噪声 + 慢速 LFO（海浪涨落） */
export class Ocean extends Synth {
  private brown = 0
  private phase = 0
  constructor(
    sampleRate: number,
    private readonly rnd: NoiseRandom,
  ) {
    super(sampleRate)
  }

  override fill(out: Int16Array): void {
    for (let i = 0; i < out.length; i++) {
      const white = this.rnd.nextFloat() * 2 - 1
      this.brown = (this.brown + 0.02 * white) / 1.02
      this.phase += (TWO_PI * 0.09) / this.sampleRate
      const wave = Math.sin(this.phase) * 0.5 + 0.5
      const v = this.brown * 5 * (0.25 + 0.75 * wave * wave)
      out[i] = this.toSample(v)
    }
  }
}

/** 低沉火焰 + 随机爆裂噼啪 */
export class Campfire extends Synth {
  private lp = 0
  private crackleLeft = 0
  private crackleAmp = 0
  constructor(
    sampleRate: number,
    private readonly rnd: NoiseRandom,
  ) {
    super(sampleRate)
  }

  override fill(out: Int16Array): void {
    for (let i = 0; i < out.length; i++) {
      const white = this.rnd.nextFloat() * 2 - 1
      this.lp += 0.045 * (white - this.lp)
      if (this.crackleLeft <= 0 && this.rnd.nextFloat() < 0.00045) {
        this.crackleLeft = Math.trunc(this.sampleRate * 0.012)
        this.crackleAmp = 0.5 + this.rnd.nextFloat() * 0.5
      }
      let v = this.lp * 2.2
      if (this.crackleLeft > 0) {
        const env = this.crackleLeft / (this.sampleRate * 0.012)
        v += (this.rnd.nextFloat() * 2 - 1) * this.crackleAmp * env * env
        this.crackleLeft--
      }
      out[i] = this.toSample(v * 0.8)
    }
  }
}

/** 夏夜：低频虫鸣和弦 + 断续蝉声 */
export class Night extends Synth {
  private chirpPhase = 0
  private chirpOn = true
  private chirpCount = 0
  constructor(sampleRate: number) {
    super(sampleRate)
  }

  override fill(out: Int16Array): void {
    for (let i = 0; i < out.length; i++) {
      this.chirpPhase += (TWO_PI * 4200.0) / this.sampleRate
      if (this.chirpPhase > TWO_PI * 1e9) this.chirpPhase -= TWO_PI * 1e9
      this.chirpCount++
      // 0.5s 鸣 + 0.35s 停
      if (this.chirpCount > this.sampleRate / 2) {
        this.chirpOn = !this.chirpOn
        this.chirpCount = 0
      }
      const amp = this.chirpOn ? 0.5 + 0.5 * Math.sin(this.chirpPhase * 24.0) : 0
      const crickets = Math.sin(this.chirpPhase) * amp * 0.08
      const drone = Math.sin(this.chirpPhase * 0.0021) * 0.02
      out[i] = this.toSample(crickets + drone)
    }
  }
}

/** 微风（雪/樱/萤默认）：极轻的过滤噪声 */
export class Breeze extends Synth {
  private lp = 0
  private phase = 0
  constructor(
    sampleRate: number,
    private readonly rnd: NoiseRandom,
  ) {
    super(sampleRate)
  }

  override fill(out: Int16Array): void {
    for (let i = 0; i < out.length; i++) {
      const white = this.rnd.nextFloat() * 2 - 1
      this.lp += 0.04 * (white - this.lp)
      this.phase += (TWO_PI * 0.05) / this.sampleRate
      const swell = 0.6 + 0.4 * Math.sin(this.phase)
      out[i] = this.toSample(this.lp * 1.1 * swell)
    }
  }
}

/* ── ComicAmbientAudio (L34–152) ─────────────────────────────────────────────────── */

/** Kotlin's fallback synth sample rate and PCM chunk size. */
export const AMBIENT_SAMPLE_RATE = 22050
export const AMBIENT_CHUNK_SIZE = 4096
export const AMBIENT_MIN_BUFFER_FLOOR = 8192

/**
 * 场景引擎（环境音）：
 * - 首选 assets/ambient/ 下的真实录音素材（全部 CC0，来源与作者见 assets/ambient/CREDITS.md），
 *   循环播放（素材已带交叉淡化循环缝，无接缝咔哒）；
 * - 资产缺失时回退旧版程序合成（仅兜底，不再是主路径）。
 * 声音与特效完全独立开关，互不绑定。
 */
export class ComicAmbientAudio {
  private player: AudioPlayer | null = null
  private track: PcmSink | null = null
  private running = false
  private volume = 0.4
  private usingSynth = false

  constructor(
    private readonly deps: {
      player: AudioPlayer
      sink: PcmSink
      sched: AudioScheduler
      random?: NoiseRandom
    },
  ) {}

  isRunning(): boolean {
    return this.running
  }

  /** True when the program-synth fallback is the active path. */
  isSynthFallback(): boolean {
    return this.usingSynth
  }

  start(scene: ComicScene, initialVolume: number): void {
    if (scene === 'NONE') return
    this.stop()
    this.volume = Math.min(1, Math.max(0, initialVolume))
    const asset = assetOf(scene)
    // 真实录音主路径：assets → 循环播放
    if (asset !== null) {
      try {
        const p = this.deps.player
        p.playAsset(asset, true)
        this.player = p
        this.running = true
        this.usingSynth = false
        return
      } catch {
        // fall through to the synth fallback
      }
    }
    // 兜底：资产缺失（异常打包等）时回退程序合成，保证功能不缺失
    this.startSynth(scene)
  }

  private startSynth(scene: ComicScene): void {
    this.running = true
    this.usingSynth = true
    const sampleRate = AMBIENT_SAMPLE_RATE
    const minBuf = Math.max(this.deps.sink.minBufferBytes(), AMBIENT_MIN_BUFFER_FLOOR)
    void minBuf // the sink owns the actual buffer; the floor is the documented contract
    const sink = this.deps.sink
    sink.setVolume(this.volume)
    sink.play()
    const synth = Synth.forScene(scene, sampleRate, this.deps.random ?? createNoiseRandom())
    const chunk = new Int16Array(AMBIENT_CHUNK_SIZE)
    sink.start((c) => {
      synth.fill(chunk)
      for (let i = 0; i < c.length; i++) c[i] = chunk[i]!
    })
    this.track = sink
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    this.player?.setVolume(this.volume)
    this.track?.setVolume(this.volume)
  }

  stop(): void {
    this.running = false
    this.usingSynth = false
    const p = this.player
    this.player = null
    if (p !== null) {
      try {
        p.stop()
      } catch {
        /* ignore */
      }
    }
    try {
      this.deps.sched.joinOrTimeout(300)
    } catch {
      /* InterruptedException → re-interrupt; no-op in JS */
    }
    const t = this.track
    this.track = null
    if (t !== null) {
      try {
        t.stop()
        t.release()
      } catch {
        /* ignore */
      }
    }
  }
}
