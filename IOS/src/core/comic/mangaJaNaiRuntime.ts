/**
 * mangaJaNaiRuntime.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/MangaJaNaiRuntime.kt
 *
 * Kotlin source: 183 lines / 156 non-blank（文件以 L183 `}` 结束，末尾带换行）。
 *
 * ┌─ Kotlin → TS 行号映射（逐段，TS 侧为本文件实际行号）───────────────────────────┐
 * │ Kotlin   │ TS                                              │ 说明                 │
 * │ L1-11    │ L1-76   （文件头 + import 段）                   │ package/imports      │
 * │ L13-16   │ L60-66 文件头注释                                │ doc 注释逐字保留     │
 * │ L17      │ L72-83   `enum class Backend` → 联合类型 + 常量   │ 三档后端             │
 * │ L18-27   │ L85-110 + L240-247  字段与线程预算常量            │ 会话与线程预算       │
 * │ L22      │ L263-267  `deviceKey = "span-mobile-v1:…"`        │ 缓存键（设备指纹）   │
 * │ L28-51   │ L274-314  `private fun create(file, kind)`        │ 会话选项逐项照搬     │
 * │ L53-55   │ L316-318  `private fun cancelled()`               │ InterruptedException │
 * │ L60-149  │ L320-457  `fun prepare(...)`                      │ 实测探针 + 选后端    │
 * │ L151-173 │ L459-500  `fun run(...)`                          │ 驱动回退 + 吞吐 EMA  │
 * │ L175     │ L502-505  `override fun close()`                  │ 关闭会话             │
 * │ L177     │ L508-513  `fun penalizeTimeout()`                 │ 超时惩罚             │
 * │ L179-182 │ L222-231  `internal fun acceptableError(max, mean)`│ 0.03 / 0.003        │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ── 端口（本文件是 MangaJaNai 家族的「ONNX 会话」抽象层）──────────────────────────
 * Kotlin 直接使用 `ai.onnxruntime`：`OrtEnvironment` / `OrtSession` /
 * `OrtSession.SessionOptions` / `OnnxTensor` / `OrtSession.RunOptions` / `OrtException`。
 * iOS 侧不内置 ONNX Runtime（`docs/PARITY_EXCEPTIONS.md` E1 只排除「运行时本体」），
 * 因此这里把整个会话层收成三个注入接口：
 *
 *   • `MangaJaNaiSessionFactory` ← `OrtEnvironment.getEnvironment()`
 *                                + `availableProviders()`
 *   • `MangaJaNaiSession`        ← `OrtSession.run(mapOf("input"..), mapOf("output"..))`
 *                                + `OrtSession.close()`
 *   • `MangaJaNaiRunOptions`     ← `OrtSession.RunOptions`（`setTerminate` / `close`）
 *   • `MangaJaNaiSessionError`   ← `OrtException`
 *
 * 张量不再以 `OnnxTensor.createTensor(env, FloatBuffer, shape)` 形式出现：直接传
 * `Float32Array`（输入 `1×3×side×side`，输出 `1×3×(2·side)×(2·side)`，NCHW 行主序）。
 * Kotlin 里的 direct `FloatBuffer` 是「同一块堆外内存的双视图」，这里 `Float32Array`
 * 就是那块内存，语义等价（会话就地写入 `output`）。
 *
 * ── 循环依赖（唯一一处，已按 `anime4KCnn.ts` ↔ `comicImagePipeline.ts` 先例处理）──
 * 本文件从 `./mangaJaNai` 取错误类型与模型常量，`./mangaJaNai` 从本文件取
 * `MangaJaNaiRuntime` / `MangaJaNaiRunOptions`。两边**只在函数体内**引用对方绑定，
 * 顶层只做 class / const 声明，ESM 求值顺序不影响任何一侧；vitest 两种导入顺序都跑过。
 *
 * ── 未移植项 ──────────────────────────────────────────────────────────────────────
 * 1. `OrtSession.SessionOptions.setOptimizationLevel(ALL_OPT)` 等**选项对象**：不移植为
 *    方法调用，而是逐项塞进 `MangaJaNaiSessionOptions`（`optimizationLevel: 'ALL_OPT'`），
 *    由宿主的会话实现翻译给原生 ONNX / CoreML。
 * 2. `options.addXnnpack(mapOf("intra_op_num_threads" to ...))`：只有
 *    `availableProviders()` 含 `"XNNPACK"` 时才会走到；Web/原生无该 provider 时该分支
 *    与 Kotlin 一致地**不参与探测**。
 * 3. `OrtSession.RunOptions.setTerminate(true)` 的真实中断：端口只提供「置位」，
 *    是否真的中断由宿主的会话实现决定（等价于 ORT 内部轮询）。
 * 4. NNAPI：Kotlin 注释明确「Mobile drivers can take minutes to compile NNAPI graphs,
 *    outside run cancellation」→ 从来不作为候选，这里同样不实现（注释逐字保留）。
 * 5. `android.util.Log` → `MangaJaNaiLogPort`（宿主注入，不写 console）。
 */

import {
  MANGA_JANAI_HALO,
  MANGA_JANAI_SHA256,
  MANGA_JANAI_TILE,
  MangaJaNaiBudgetExceededError,
  MangaJaNaiCancelledError,
  type MangaJaNaiDevicePort,
  type MangaJaNaiPrefsFactory,
  type MangaJaNaiPrefsPort,
} from './mangaJaNai'
import { clamp } from './comicPixOps'

/* ── Kotlin L17 `enum class Backend { CPU, CPU_BALANCED, XNNPACK }` ── */

/** `MangaJaNaiRuntime.Backend` 三档（值即 Kotlin `name`，用于 SharedPreferences 回读）。 */
export type MangaJaNaiBackend = 'CPU' | 'CPU_BALANCED' | 'XNNPACK'

/** 声明顺序 = Kotlin `enum` ordinal（`values()` 的遍历顺序）。 */
export const MANGA_JANAI_BACKEND_VALUES: ReadonlyArray<MangaJaNaiBackend> = [
  'CPU',
  'CPU_BALANCED',
  'XNNPACK',
]

/** Kotlin L21 `getSharedPreferences("mangajanai-runtime", MODE_PRIVATE)`。 */
export const MANGA_JANAI_RUNTIME_PREFS = 'mangajanai-runtime'
/** Kotlin L22 `deviceKey = "span-mobile-v1:${Build.FINGERPRINT}:${MangaJaNai.SHA256}"` 的前缀。 */
export const MANGA_JANAI_RUNTIME_DEVICE_PREFIX = 'span-mobile-v1'
/** Kotlin L23 `var tileNanoseconds = 100_000_000L`。 */
export const MANGA_JANAI_INITIAL_TILE_NANOSECONDS = 100_000_000
/** Kotlin L25 `availableProcessors().coerceIn(1, 4)`。 */
export const MANGA_JANAI_RUNTIME_MAX_THREADS = 4
/** Kotlin L26 `availableProcessors().coerceIn(1, 5)`。 */
export const MANGA_JANAI_RUNTIME_MAX_BALANCED_THREADS = 5
/** Kotlin L105 `if (balancedThreads >= 4) add(Backend.CPU_BALANCED)`。 */
export const MANGA_JANAI_BALANCED_MIN_THREADS = 4
/** Kotlin L114 `deadline - now < bestNs * 6 + 1_000_000_000L`。 */
export const MANGA_JANAI_PROBE_BUDGET_FACTOR = 6
export const MANGA_JANAI_PROBE_RESERVE_NANOSECONDS = 1_000_000_000
/** Kotlin L130 `if (accurate && ns < bestNs * 0.85)`。 */
export const MANGA_JANAI_PROBE_SPEEDUP = 0.85
/** Kotlin L177 `maxOf(tileNanoseconds * 2, 250_000_000L)`。 */
export const MANGA_JANAI_TIMEOUT_PENALTY_FLOOR_NANOSECONDS = 250_000_000
/** Kotlin L171 `(tileNanoseconds * 3 + elapsed) / 4` 的权重。 */
export const MANGA_JANAI_THROUGHPUT_EMA_WEIGHT = 3
export const MANGA_JANAI_THROUGHPUT_EMA_DIVISOR = 4
/** Kotlin L181 `max <= 0.03f && mean <= 0.003`。 */
export const MANGA_JANAI_ACCEPTABLE_MAX_ERROR = 0.03
export const MANGA_JANAI_ACCEPTABLE_MEAN_ERROR = 0.003
/** Kotlin L106 `if ("XNNPACK" in providers)`。 */
export const MANGA_JANAI_XNNPACK_PROVIDER = 'XNNPACK'

/* ── ONNX 会话端口（`ai.onnxruntime` 的注入等价物）──────────────────────────────── */

/** 预置的单步张量形状：输入 `1×3×side×side`，输出 `1×3×(2·side)×(2·side)`。 */
export interface MangaJaNaiSessionOptions {
  /** `.onnx` 绝对路径（Kotlin `file.absolutePath`）。 */
  readonly modelPath: string
  readonly backend: MangaJaNaiBackend
  /** `setOptimizationLevel(ALL_OPT)` */
  readonly optimizationLevel: 'ALL_OPT'
  /** `setIntraOpNumThreads(...)` */
  readonly intraOpNumThreads: number
  /** `setInterOpNumThreads(1)` */
  readonly interOpNumThreads: number
  /** `setMemoryPatternOptimization(true)` */
  readonly memoryPatternOptimization: boolean
  /** `setCPUArenaAllocator(true)` */
  readonly cpuArenaAllocator: boolean
  /** `addConfigEntry(key, value)`，按插入顺序。 */
  readonly configEntries: ReadonlyArray<readonly [string, string]>
  /** `setSymbolicDimensionValue(name, value)`。 */
  readonly symbolicDimensions: ReadonlyArray<readonly [string, number]>
  /** `addXnnpack(mapOf("intra_op_num_threads" to ...))`，非 XNNPACK 档为 null。 */
  readonly xnnpack: ReadonlyArray<readonly [string, string]> | null
  /** 本会话的 `side`（= 输入边长；输出边长 2·side）。 */
  readonly side: number
}

/** `OrtSession.RunOptions`：取消闸门。 */
export interface MangaJaNaiRunControl {
  /** `setTerminate(true)` */
  terminate(): void
  /** 会话实现可轮询的中断标志。 */
  readonly terminated: boolean
  /** `options.close()` */
  close(): void
}

/** `OrtSession`：一次 `run(mapOf("input" to x), mapOf("output" to y))` + `close()`。 */
export interface MangaJaNaiSession {
  /**
   * Kotlin `session.run(mapOf("input" to input), emptySet(), mapOf("output" to output), options)`。
   * `output` 就地写入（`FloatBuffer` 语义）。
   */
  run(input: Float32Array, output: Float32Array, control: MangaJaNaiRunControl): void
  close(): void
}

/** `OrtEnvironment` + `OrtSession.SessionOptions` 的工厂。 */
export interface MangaJaNaiSessionFactory {
  create(options: MangaJaNaiSessionOptions): MangaJaNaiSession
  /** `OrtEnvironment.getAvailableProviders().map { it.name }`。 */
  availableProviders(): ReadonlyArray<string>
}

/** `OrtException`。会话实现用它表达「驱动拒绝/图不兼容」，与真实网络错误区分。 */
export class MangaJaNaiSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MangaJaNaiSessionError'
  }
}

/**
 * Kotlin L171-175 / L237-238 的 `OrtSession.RunOptions`：
 * `watchdog.schedule({ synchronized(options) { if (optionsOpen) options.setTerminate(true) } })`
 * 与 `finally { synchronized(options) { optionsOpen = false; options.close() } }`。
 */
export class MangaJaNaiRunOptions implements MangaJaNaiRunControl {
  private open = true
  private terminating = false

  terminate(): void {
    if (this.open) this.terminating = true
  }

  get terminated(): boolean {
    return this.terminating
  }

  get isOpen(): boolean {
    return this.open
  }

  close(): void {
    this.open = false
  }
}

/* ── 运行时依赖束（Kotlin 构造函数里的 `Context`）───────────────────────────────── */

export interface MangaJaNaiRuntimeDeps {
  /** `Runtime.getRuntime().availableProcessors()` / `Build.FINGERPRINT`。 */
  readonly device: MangaJaNaiDevicePort
  /** `context.getSharedPreferences(name, MODE_PRIVATE)`。 */
  readonly prefs: MangaJaNaiPrefsFactory
  /** `OrtEnvironment` / `OrtSession`。 */
  readonly sessions: MangaJaNaiSessionFactory
  /** `System.nanoTime()`（纳秒）。 */
  readonly now: () => number
  /** `Thread.currentThread().isInterrupted`。 */
  readonly isCancelled: () => boolean
  /** `android.util.Log`。 */
  readonly log: MangaJaNaiLogPort
}

/** `android.util.Log`（`i` / `w` 两个级别，够本家族全部调用点）。 */
export interface MangaJaNaiLogPort {
  i(tag: string, message: string): void
  w(tag: string, message: string, error?: unknown): void
}

/** Kotlin L180-181 `internal fun acceptableError(max: Float, mean: Double): Boolean`。 */
export function mangaJaNaiAcceptableError(max: number, mean: number): boolean {
  return (
    Number.isFinite(max) &&
    Number.isFinite(mean) &&
    max <= MANGA_JANAI_ACCEPTABLE_MAX_ERROR &&
    mean <= MANGA_JANAI_ACCEPTABLE_MEAN_ERROR
  )
}

/**
 * Kotlin L16-183 `internal class MangaJaNaiRuntime(private val context: Context)`。
 *
 * Mobile SPAN 模型。FP32 CPU with measured XNNPACK.
 * All calls are protected by MangaJaNai's page lock. At most one native session is alive.
 */
export class MangaJaNaiRuntime {
  private session: MangaJaNaiSession | null = null
  private backend: MangaJaNaiBackend = 'CPU'
  private modelPath = ''
  private readonly preferences: MangaJaNaiPrefsPort
  private readonly threads: number
  private readonly balancedThreads: number
  private tileNanosecondsValue = MANGA_JANAI_INITIAL_TILE_NANOSECONDS

  constructor(private readonly deps: MangaJaNaiRuntimeDeps) {
    this.preferences = deps.prefs(MANGA_JANAI_RUNTIME_PREFS)
    // Kotlin L25-26
    this.threads = clamp(deps.device.availableProcessors, 1, MANGA_JANAI_RUNTIME_MAX_THREADS)
    this.balancedThreads = clamp(
      deps.device.availableProcessors,
      1,
      MANGA_JANAI_RUNTIME_MAX_BALANCED_THREADS,
    )
  }

  /** Kotlin L23 `var tileNanoseconds = 100_000_000L`（`private set`）。 */
  get tileNanoseconds(): number {
    return this.tileNanosecondsValue
  }

  /** Kotlin L22 `deviceKey = "span-mobile-v1:${Build.FINGERPRINT}:${MangaJaNai.SHA256}"`。 */
  get deviceKey(): string {
    return `${MANGA_JANAI_RUNTIME_DEVICE_PREFIX}:${this.deps.device.fingerprint}:${MANGA_JANAI_SHA256}`
  }

  /** 当前后端（Kotlin 私有字段，暴露只读值供宿主诊断）。 */
  get currentBackend(): MangaJaNaiBackend {
    return this.backend
  }

  /** Kotlin L28-51 `private fun create(file: File, kind: Backend): OrtSession`。 */
  private create(file: string, kind: MangaJaNaiBackend): MangaJaNaiSession {
    const symbolicDimensions: Array<readonly [string, number]> = [
      ['batch_size', 1],
      ['width', MANGA_JANAI_TILE + MANGA_JANAI_HALO * 2],
      ['height', MANGA_JANAI_TILE + MANGA_JANAI_HALO * 2],
    ]
    // Kotlin L41：CPU_BALANCED 才加 dynamic_block_base
    const configEntries: Array<readonly [string, string]> = [
      ['session.intra_op.allow_spinning', '0'],
      ['session.inter_op.allow_spinning', '0'],
    ]
    if (kind === 'CPU_BALANCED') configEntries.push(['session.dynamic_block_base', '4'])
    let intraOpNumThreads: number
    switch (kind) {
      case 'XNNPACK':
        intraOpNumThreads = 1
        break
      case 'CPU_BALANCED':
        intraOpNumThreads = this.balancedThreads
        break
      case 'CPU':
        intraOpNumThreads = this.threads
        break
    }
    return this.deps.sessions.create({
      modelPath: file,
      backend: kind,
      optimizationLevel: 'ALL_OPT',
      intraOpNumThreads,
      interOpNumThreads: 1,
      memoryPatternOptimization: true,
      cpuArenaAllocator: true,
      configEntries,
      symbolicDimensions,
      xnnpack:
        kind === 'XNNPACK' ? [['intra_op_num_threads', String(this.threads)]] : null,
      side: MANGA_JANAI_TILE + MANGA_JANAI_HALO * 2,
    })
  }

  /** Kotlin L53-55 `private fun cancelled()`。 */
  private cancelled(): void {
    if (this.deps.isCancelled()) throw new MangaJaNaiCancelledError()
  }

  /**
   * Kotlin L57-149 `fun prepare(file, input, output, buffer, options, deadline)`。
   *
   * Benchmarks real first-tile data once per OS/model; rejects slower or inaccurate drivers.
   * CPU reference closes before a candidate opens, avoiding two copies of the weights.
   *
   * @param input  首个真实切片（`1×3×side×side`，3 通道平面顺序 R/G/B）。
   * @param output 输出缓冲（`1×3×2side×2side`）；探针按引用值逐元素比对。
   */
  prepare(
    file: string,
    input: Float32Array,
    output: Float32Array,
    control: MangaJaNaiRunControl,
    deadline: number,
  ): void {
    if (this.session !== null && this.modelPath === file) return
    this.close()
    this.modelPath = file
    const device = this.preferences.getString('device')
    const savedBackendRaw =
      device === this.deviceKey ? this.preferences.getString('backend') : null
    const saved =
      savedBackendRaw !== null && (MANGA_JANAI_BACKEND_VALUES as ReadonlyArray<string>).includes(savedBackendRaw)
        ? (savedBackendRaw as MangaJaNaiBackend)
        : null
    if (saved !== null) {
      try {
        this.session = this.create(file, saved)
        this.backend = saved
        const started = this.deps.now()
        this.session.run(input, output, control)
        this.tileNanosecondsValue = this.deps.now() - started
        this.cancelled()
        return
      } catch (error) {
        if (!(error instanceof MangaJaNaiSessionError)) throw error
        // Kotlin L76-79 `catch (_: OrtException)`
        this.close()
        this.preferences.remove('backend')
        if (this.deps.now() >= deadline) throw new MangaJaNaiBudgetExceededError()
      }
    }
    // Kotlin L83-94 `fun timed(candidate)`（内联，保留调用顺序）
    const timed = (candidate: MangaJaNaiSession): number => {
      this.cancelled()
      if (this.deps.now() >= deadline) throw new MangaJaNaiBudgetExceededError()
      const start = this.deps.now()
      try {
        candidate.run(input, output, control)
      } catch (error) {
        if (this.deps.now() >= deadline) throw new MangaJaNaiBudgetExceededError()
        throw error
      }
      this.cancelled()
      return this.deps.now() - start
    }
    const reference = new Float32Array(output.length)
    let best: MangaJaNaiBackend = 'CPU'
    let bestNs: number
    const cpu = this.create(file, 'CPU')
    try {
      timed(cpu) // warmup is excluded from throughput comparison
      bestNs = timed(cpu)
      reference.set(output)
    } finally {
      cpu.close()
    }
    const providers = new Set(this.deps.sessions.availableProviders())
    const candidates: MangaJaNaiBackend[] = []
    if (this.balancedThreads >= MANGA_JANAI_BALANCED_MIN_THREADS) candidates.push('CPU_BALANCED')
    if (providers.has(MANGA_JANAI_XNNPACK_PROVIDER)) candidates.push('XNNPACK')
    // Mobile drivers can take minutes to compile NNAPI graphs, outside run cancellation.
    // The lightweight network uses bounded CPU/XNNPACK work to keep cold pages responsive.
    try {
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]!
        this.cancelled()
        // Kotlin L114：Keep enough time for a useful first page; optional probes can stop here.
        if (deadline - this.deps.now() < bestNs * MANGA_JANAI_PROBE_BUDGET_FACTOR + MANGA_JANAI_PROBE_RESERVE_NANOSECONDS) {
          break
        }
        let trial: MangaJaNaiSession | null = null
        try {
          trial = this.create(file, candidate)
          timed(trial)
          const ns = timed(trial)
          let maxError = 0
          let totalError = 0
          for (let i = 0; i < reference.length; i += 1) {
            const error = Math.abs(output[i]! - reference[i]!)
            if (!Number.isFinite(error)) {
              maxError = Number.POSITIVE_INFINITY
              break
            }
            maxError = Math.max(maxError, error)
            totalError += error
          }
          const accurate = mangaJaNaiAcceptableError(maxError, totalError / reference.length)
          this.deps.log.i(
            'MangaJaNai',
            `probe=${candidate} tileMs=${Math.trunc(ns / 1_000_000)} maxError=${maxError} accurate=${accurate}`,
          )
          if (accurate && ns < bestNs * MANGA_JANAI_PROBE_SPEEDUP) {
            best = candidate
            bestNs = ns
            // Last candidate can remain warm; otherwise close before trying another.
            if (candidate === candidates[candidates.length - 1]) {
              this.session = trial
              trial = null
            }
          }
        } catch (error) {
          if (!(error instanceof MangaJaNaiSessionError)) throw error
          this.deps.log.w('MangaJaNai', `Rejecting ${candidate}`, error)
        } finally {
          trial?.close()
        }
      }
      this.backend = best
      this.tileNanosecondsValue = bestNs
      if (this.session === null) this.session = this.create(file, best)
      this.preferences.putString('device', this.deviceKey)
      this.preferences.putString('backend', best)
      this.deps.log.i(
        'MangaJaNai',
        `selected=${best} threads=${best === 'CPU_BALANCED' ? this.balancedThreads : this.threads} tileMs=${Math.trunc(bestNs / 1_000_000)}`,
      )
    } catch (error) {
      this.close()
      throw error
    }
  }

  /**
   * Kotlin L151-173 `fun run(file, inputs, outputs, options, deadline)`。
   *
   * 每片一次；驱动拒绝时用同一份 FP32 CPU 图重跑**这一片**，并把后端结论写回 prefs。
   */
  run(
    file: string,
    input: Float32Array,
    output: Float32Array,
    control: MangaJaNaiRunControl,
    deadline: number,
  ): void {
    this.cancelled()
    if (this.deps.now() >= deadline) throw new MangaJaNaiBudgetExceededError()
    const started = this.deps.now()
    const session = this.session
    if (session === null) {
      throw new MangaJaNaiSessionError('MangaJaNai session 尚未创建（prepare 未成功）')
    }
    try {
      session.run(input, output, control)
    } catch (error) {
      if (!(error instanceof MangaJaNaiSessionError)) throw error
      this.cancelled()
      if (this.deps.now() >= deadline) throw new MangaJaNaiBudgetExceededError()
      if (this.backend === 'CPU') throw error
      // A driver can reject a later run; retry this exact tile using the same FP32 CPU graph.
      this.close()
      this.cancelled()
      this.backend = 'CPU'
      this.session = this.create(file, this.backend)
      this.preferences.putString('device', this.deviceKey)
      this.preferences.putString('backend', this.backend)
      this.deps.log.w('MangaJaNai', 'Driver failed; retrying tile on optimized CPU', error)
      this.session.run(input, output, control)
    }
    const elapsed = this.deps.now() - started
    this.tileNanosecondsValue = Math.max(
      elapsed,
      Math.trunc(
        (this.tileNanosecondsValue * MANGA_JANAI_THROUGHPUT_EMA_WEIGHT + elapsed) /
          MANGA_JANAI_THROUGHPUT_EMA_DIVISOR,
      ),
    )
    this.cancelled()
  }

  /** Kotlin L175 `override fun close()`。 */
  close(): void {
    this.session?.close()
    this.session = null
  }

  /** Kotlin L177 `fun penalizeTimeout()`。 */
  penalizeTimeout(): void {
    this.tileNanosecondsValue = Math.max(
      this.tileNanosecondsValue * 2,
      MANGA_JANAI_TIMEOUT_PENALTY_FLOOR_NANOSECONDS,
    )
  }
}
