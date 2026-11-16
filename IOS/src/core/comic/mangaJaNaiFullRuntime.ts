/**
 * mangaJaNaiFullRuntime.ts  ←  novel-reader/app/src/main/java/com/example/ui/comic/MangaJaNaiFullRuntime.kt
 *
 * Kotlin source: 155 lines / 134 non-blank（文件以 L155 `}` 结束，末尾带换行）。
 *
 * ┌─ Kotlin → TS 行号映射（逐段，TS 侧为本文件实际行号）───────────────────────────┐
 * │ Kotlin   │ TS                                                  │ 说明              │
 * │ L1-11    │ L1-76   （文件头 + import 段）                       │ package/imports   │
 * │ L13-14   │ L60-66  类头注释                                     │ doc 注释逐字保留  │
 * │ L14-22   │ L186-216  字段：gpu/cpu/cpuSide/prefs/key/tile/name   │ 句柄 + 缓存键      │
 * │ L19      │ L213-215  `key = "ncnn-20260526-f32-v1:…"`           │ 设备缓存键         │
 * │ L24-26   │ L218-220  `cancelled()`                              │ InterruptedException│
 * │ L27-40   │ L223-250  `createCpu(file, side)`                    │ CPU 会话选项       │
 * │ L41-63   │ L252-276  `runCpu(...)`                              │ 25ms 取消看门狗    │
 * │ L64-119  │ L299-389  `prepare(directory, actualInput)`           │ GPU 精度/速度探针  │
 * │ L120-123 │ L391-395  `chooseTile()`                             │ tile = preferred  │
 * │ L124-135 │ L397-416  `run(directory, input, output, side)`       │ GPU 失败 → CPU 重跑│
 * │ L136-140 │ L418-429  `override fun close()`                     │ 句柄/会话/tile 归位│
 * │ L141-154 │ L117-160  companion（watchdog/acceptableError/…）     │ 静态常量           │
 * └─────────────────────────────────────────────────────────────────────────────────┘
 *
 * ── 未移植项（GPU 部分逐条列明）────────────────────────────────────────────────────
 * 1. **JNI 本体（`MangaJaNaiGpu.kt` 12 行）**：`System.loadLibrary("mangajanai")` 与
 *    `external fun create/run/save/destroy` 不移植。它们被收成 `MangaJaNaiGpuPort`
 *    注入接口；`create` 返回 0 表示拿不到句柄（Kotlin 侧等价于 JNI create 失败）。
 * 2. **Vulkan / FP32 kernel**：`name = "Vulkan FP32"` 只是诊断字符串，本文件不实现
 *    任何 GPU 算子。宿主没注入 `gpu` 端口（`null`）时，`openGpu()` 抛
 *    `MangaJaNaiLinkageError`（= `UnsatisfiedLinkError`），随后走 Kotlin L111-117
 *    的「记录 warn + 关闭 + 落 CPU」分支，**不会静默退化成「返回原图」**。
 * 3. `.vkcache` 的生成/复用由原生侧负责；本文件只拼路径
 *    `cacheDir/mangajanai-full-${SDK_INT}.vkcache`（Kotlin L71）。
 * 4. `OrtSession.SessionOptions` 的选项对象 → `MangaJaNaiSessionOptions`（同
 *    `./mangaJaNaiRuntime` 的映射），`Runtime.getRuntime().availableProcessors()`
 *    → `MangaJaNaiDevicePort.availableProcessors`，`maxMemory()` →
 *    `MangaJaNaiDevicePort.maxMemoryBytes`。
 * 5. `android.util.Log` → `MangaJaNaiLogPort`；日志文本（`GPU probe cpuMs=…`、
 *    `Cached GPU unavailable`、`GPU failed; retrying exact tile on CPU`）逐字保留。
 * 6. `OutOfMemoryError` 的传播：JS 侧由 `MangaJaNaiOutOfMemoryError` / `RangeError`
 *    代表（Kotlin L114 `if (error is OutOfMemoryError) throw error`）。
 *
 * 依赖注入：`MangaJaNaiFull.verifyNative` 与 `MangaJaNaiFull.SHA256` 由 `deps` 传入，
 * 这样本文件不需要 import `./mangaJaNaiFull`（否则两文件互引）。
 */

import { clamp } from './comicPixOps'
import {
  MangaJaNaiCancelledError,
  MangaJaNaiIoError,
  MangaJaNaiLinkageError,
  MangaJaNaiOutOfMemoryError,
  type MangaJaNaiDevicePort,
  type MangaJaNaiFilePort,
  type MangaJaNaiPrefsFactory,
  type MangaJaNaiPrefsPort,
  type MangaJaNaiSchedulerPort,
} from './mangaJaNai'
import {
  MangaJaNaiRunOptions,
  type MangaJaNaiLogPort,
  type MangaJaNaiSession,
  type MangaJaNaiSessionFactory,
} from './mangaJaNaiRuntime'

/* ══════════════════════ 常量（Kotlin L14-22 / L141-154） ══════════════════════════ */

/** Kotlin L18 `getSharedPreferences("mangajanai-full-runtime", MODE_PRIVATE)`。 */
export const MANGA_JANAI_FULL_RUNTIME_PREFS = 'mangajanai-full-runtime'
/** Kotlin L19 `key = "ncnn-20260526-f32-v1:${Build.FINGERPRINT}:${MangaJaNaiFull.SHA256}"` 前缀。 */
export const MANGA_JANAI_FULL_KEY_PREFIX = 'ncnn-20260526-f32-v1'
/** Kotlin L20 `var tile = 48`。 */
export const MANGA_JANAI_FULL_TILE_DEFAULT = 48
/** Kotlin L22 `"Vulkan FP32"`。 */
export const MANGA_JANAI_FULL_NAME_GPU = 'Vulkan FP32'
/** Kotlin L22 `"CPU FP32"`。 */
export const MANGA_JANAI_FULL_NAME_CPU = 'CPU FP32'
/** Kotlin L29 `availableProcessors().coerceIn(1, 4)`。 */
export const MANGA_JANAI_FULL_MAX_THREADS = 4
/** Kotlin L69/L118 `createCpu(model, 80)` —— CPU 会话固定 side 80。 */
export const MANGA_JANAI_FULL_CPU_SIDE = 80
/** Kotlin L80 `preferredTile() + 32`。 */
export const MANGA_JANAI_FULL_PROBE_PAD = 32
/** Kotlin L147 `maxMemory() >= 384L * 1024 * 1024`。 */
export const MANGA_JANAI_FULL_BIG_MEMORY_BYTES = 384 * 1024 * 1024
/** Kotlin L147 `if (…) 240 else 128`。 */
export const MANGA_JANAI_FULL_TILE_BIG = 240
export const MANGA_JANAI_FULL_TILE_SMALL = 128
/** Kotlin L107 `gpuNs < cpuNs * 0.85`。 */
export const MANGA_JANAI_FULL_GPU_SPEEDUP = 0.85
/** Kotlin L146 `max <= 0.0015f && mean <= 0.0001`。 */
export const MANGA_JANAI_FULL_ACCEPTABLE_MAX_ERROR = 0.0015
export const MANGA_JANAI_FULL_ACCEPTABLE_MEAN_ERROR = 0.0001
/** Kotlin L54/L56 `scheduleAtFixedRate(…, 25, 25, MILLISECONDS)`。 */
export const MANGA_JANAI_FULL_CANCEL_POLL_MS = 25
/** Kotlin L152 `((x * 13 + y * 17 + c * 31) % 256) / 255f` 的三个乘数。 */
export const MANGA_JANAI_FULL_PROBE_X = 13
export const MANGA_JANAI_FULL_PROBE_Y = 17
export const MANGA_JANAI_FULL_PROBE_C = 31
/** Kotlin L71 `"mangajanai-full-${Build.VERSION.SDK_INT}.vkcache"`。 */
export function mangaJaNaiFullVkCacheName(sdkInt: number): string {
  return `mangajanai-full-${sdkInt}.vkcache`
}

/* ══════════════════════ GPU 端口（`MangaJaNaiGpu.kt` 的 4 个 JNI 入口） ════════════ */

/**
 * Kotlin L6-12 `internal object MangaJaNaiGpu`：
 * `create(param, weights, cache): Long` / `run(handle, input, output, side)` /
 * `save(handle)` / `destroy(handle)`。`create` 返回 0 = 未拿到句柄。
 */
export interface MangaJaNaiGpuPort {
  create(param: string, weights: string, cache: string): number
  run(handle: number, input: Float32Array, output: Float32Array, side: number): void
  save(handle: number): void
  destroy(handle: number): void
}

/* ══════════════════════ 静态辅助（Kotlin companion L141-154） ═════════════════════ */

/**
 * Kotlin L145-146 `internal fun acceptableError(max: Float, mean: Double): Boolean`。
 * 完整档比 mobile 档严格 20 倍（0.0015 / 0.0001）。
 */
export function mangaJaNaiFullAcceptableError(max: number, mean: number): boolean {
  return (
    Number.isFinite(max) &&
    Number.isFinite(mean) &&
    max <= MANGA_JANAI_FULL_ACCEPTABLE_MAX_ERROR &&
    mean <= MANGA_JANAI_FULL_ACCEPTABLE_MEAN_ERROR
  )
}

/** Kotlin L147 `internal fun preferredTile(): Int` —— 内存预算决定切片边长。 */
export function mangaJaNaiFullPreferredTile(maxMemoryBytes: number): number {
  return maxMemoryBytes >= MANGA_JANAI_FULL_BIG_MEMORY_BYTES
    ? MANGA_JANAI_FULL_TILE_BIG
    : MANGA_JANAI_FULL_TILE_SMALL
}

/** Kotlin L149-153 `private fun probeInput(side: Int): ByteBuffer` —— 确定性合成输入。 */
export function mangaJaNaiFullProbeInput(side: number): Float32Array {
  const values = new Float32Array(side * side * 3)
  let at = 0
  for (let c = 0; c <= 2; c += 1) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        values[at] =
          ((x * MANGA_JANAI_FULL_PROBE_X + y * MANGA_JANAI_FULL_PROBE_Y + c * MANGA_JANAI_FULL_PROBE_C) %
            256) /
          255
        at += 1
      }
    }
  }
  return values
}

/** Kotlin L148 `private fun direct(floats: Int)` —— 定长浮点缓冲（float 数）。 */
export function mangaJaNaiFullDirect(floatCount: number): Float32Array {
  return new Float32Array(floatCount)
}

/* ══════════════════════ 运行时依赖束 ══════════════════════════════════════════════ */

export interface MangaJaNaiFullRuntimeDeps {
  readonly device: MangaJaNaiDevicePort
  readonly prefs: MangaJaNaiPrefsFactory
  readonly sessions: MangaJaNaiSessionFactory
  readonly scheduler: MangaJaNaiSchedulerPort
  /** `MangaJaNaiGpu` JNI；`null` = 平台无 GPU 探测能力（等价 `System.loadLibrary` 失败）。 */
  readonly gpu: MangaJaNaiGpuPort | null
  readonly files: MangaJaNaiFilePort
  readonly now: () => number
  readonly isCancelled: () => boolean
  readonly log: MangaJaNaiLogPort
  /** `MangaJaNaiFull.verifyNative(directory)`（full.param + full.bin 的 SHA-256）。 */
  readonly verifyNative: (directory: string) => boolean
  /** `MangaJaNaiFull.SHA256` —— 参与设备缓存键。 */
  readonly modelSha256: string
}

/* ══════════════════════ MangaJaNaiFullRuntime（Kotlin L14-155） ═══════════════════ */

/**
 * Kotlin L13-155 `internal class MangaJaNaiFullRuntime(private val context: Context)`。
 *
 * One heavy engine at a time. GPU must pass a real FP32 CPU accuracy/speed probe.
 */
export class MangaJaNaiFullRuntime {
  private gpu = 0
  private cpu: MangaJaNaiSession | null = null
  private cpuSide = 0
  private readonly prefs: MangaJaNaiPrefsPort
  private readonly key: string
  private tileValue = MANGA_JANAI_FULL_TILE_DEFAULT

  constructor(private readonly deps: MangaJaNaiFullRuntimeDeps) {
    // Kotlin L18-19
    this.prefs = deps.prefs(MANGA_JANAI_FULL_RUNTIME_PREFS)
    this.key = `${MANGA_JANAI_FULL_KEY_PREFIX}:${deps.device.fingerprint}:${deps.modelSha256}`
  }

  /** Kotlin L20-21 `var tile = 48; private set`。 */
  get tile(): number {
    return this.tileValue
  }

  /** Kotlin L22 `val name get() = if (gpu != 0L) "Vulkan FP32" else "CPU FP32"`。 */
  get name(): string {
    return this.gpu !== 0 ? MANGA_JANAI_FULL_NAME_GPU : MANGA_JANAI_FULL_NAME_CPU
  }

  /** Kotlin L19 的缓存键（暴露只读值供宿主诊断/测试）。 */
  get deviceKey(): string {
    return this.key
  }

  /** Kotlin L24-26 `private fun cancelled()`。 */
  private cancelled(): void {
    if (this.deps.isCancelled()) throw new MangaJaNaiCancelledError()
  }

  /** Kotlin L27-40 `private fun createCpu(file: File, side: Int): OrtSession`。 */
  private createCpu(file: string, side: number): MangaJaNaiSession {
    return this.deps.sessions.create({
      modelPath: file,
      backend: 'CPU',
      optimizationLevel: 'ALL_OPT',
      intraOpNumThreads: clamp(
        this.deps.device.availableProcessors,
        1,
        MANGA_JANAI_FULL_MAX_THREADS,
      ),
      interOpNumThreads: 1,
      memoryPatternOptimization: true,
      cpuArenaAllocator: true,
      configEntries: [
        ['session.intra_op.allow_spinning', '0'],
        ['session.inter_op.allow_spinning', '0'],
        ['session.dynamic_block_base', '4'],
      ],
      symbolicDimensions: [
        ['batch_size', 1],
        ['width', side],
        ['height', side],
      ],
      xnnpack: null,
      side,
    })
  }

  /** Kotlin L41-63 `private fun runCpu(file, input, output, side)`。 */
  private runCpu(file: string, input: Float32Array, output: Float32Array, side: number): void {
    if (this.cpu === null || this.cpuSide !== side) {
      this.cpu?.close()
      this.cpu = null
      this.cpu = this.createCpu(file, side)
      this.cpuSide = side
    }
    const session = this.cpu
    const control = new MangaJaNaiRunOptions()
    // A cancelled background job must not hold up the current page for a large CPU tile.
    const timer = this.deps.scheduler.scheduleAtFixedRate(
      MANGA_JANAI_FULL_CANCEL_POLL_MS,
      MANGA_JANAI_FULL_CANCEL_POLL_MS,
      () => {
        if (control.isOpen && this.deps.isCancelled()) control.terminate()
      },
    )
    try {
      session.run(input, output, control)
    } finally {
      timer()
      control.close()
    }
  }

  /** Kotlin L72 `MangaJaNaiGpu.create(...)` 的端口包装（`null` 端口 = 原生库缺失）。 */
  private openGpu(directory: string): void {
    const gpu = this.deps.gpu
    if (gpu === null) {
      throw new MangaJaNaiLinkageError('mangajanai 原生 GPU 库不可用（System.loadLibrary 等价）')
    }
    const cache = this.deps.files.join(
      this.deps.files.cacheDir,
      mangaJaNaiFullVkCacheName(this.deps.device.sdkInt),
    )
    const handle = gpu.create(
      this.deps.files.join(directory, 'full.param'),
      this.deps.files.join(directory, 'full.bin'),
      cache,
    )
    this.gpu = handle
    if (handle === 0) {
      throw new MangaJaNaiLinkageError('MangaJaNaiGpu.create 未返回句柄（Vulkan FP32 不可用）')
    }
  }

  /** Kotlin L64-119 `fun prepare(directory: File, actualInput: ByteBuffer)`。 */
  prepare(directory: string, actualInput: Float32Array): void {
    // Kotlin L65 `if (gpu != 0L || cpu != null) return`。用局部量避免 TS 把
    // `this.cpu` 收窄成 `null`（`runCpu` 内部还会写它）。
    const activeCpu = this.cpu
    if (this.gpu !== 0 || activeCpu !== null) return
    const model = this.deps.files.join(directory, 'full.onnx')
    // Kotlin L67：prefs 里 device 对得上才读 gpu 结论，否则 null（未知）。
    const savedGpu =
      this.prefs.getString('device') === this.key ? this.prefs.getBoolean('gpu', false) : null
    if (savedGpu === false || !this.deps.verifyNative(directory)) {
      this.cpu = this.createCpu(model, MANGA_JANAI_FULL_CPU_SIDE)
      this.cpuSide = MANGA_JANAI_FULL_CPU_SIDE
      return
    }
    if (savedGpu === true) {
      try {
        this.openGpu(directory)
        this.chooseTile()
        return
      } catch (error) {
        if (error instanceof MangaJaNaiCancelledError) throw error
        this.deps.log.w('MangaJaNaiFull', 'Cached GPU unavailable', error)
        this.close()
      }
    }
    const side = mangaJaNaiFullPreferredTile(this.deps.device.maxMemoryBytes) + MANGA_JANAI_FULL_PROBE_PAD
    const inputs: Float32Array[] = [actualInput, mangaJaNaiFullProbeInput(side)]
    const output = mangaJaNaiFullDirect(side * side * 12)
    const reference: Float32Array[] = []
    let cpuNs = 0
    try {
      for (const input of inputs) {
        this.cancelled()
        this.runCpu(model, input, output, side)
        const start = this.deps.now()
        this.runCpu(model, input, output, side)
        cpuNs += this.deps.now() - start
        reference.push(new Float32Array(output))
      }
      this.cpu?.close()
      this.cpu = null // release CPU weights before creating the GPU model
      this.cancelled()
      this.openGpu(directory)
      let gpuNs = 0
      let maxError = 0
      let totalError = 0
      for (let index = 0; index < inputs.length; index += 1) {
        this.cancelled()
        const input = inputs[index]!
        const expected = reference[index]!
        this.gpuRun(input, output, side)
        const start = this.deps.now()
        this.gpuRun(input, output, side)
        gpuNs += this.deps.now() - start
        for (let i = 0; i < expected.length; i += 1) {
          const error = Math.abs(output[i]! - expected[i]!)
          maxError = Number.isFinite(error) ? Math.max(maxError, error) : Number.POSITIVE_INFINITY
          totalError += error
        }
      }
      const mean = totalError / (reference.length * (reference[0]?.length ?? 1))
      const accurate = mangaJaNaiFullAcceptableError(maxError, mean)
      const faster = gpuNs < cpuNs * MANGA_JANAI_FULL_GPU_SPEEDUP
      this.deps.log.i(
        'MangaJaNaiFull',
        `GPU probe cpuMs=${Math.trunc(cpuNs / 1_000_000)} gpuMs=${Math.trunc(gpuNs / 1_000_000)} max=${maxError} accurate=${accurate}`,
      )
      if (!accurate || !faster) {
        this.close()
      } else {
        this.deps.gpu?.save(this.gpu)
        this.chooseTile()
      }
      this.prefs.putString('device', this.key)
      this.prefs.putBoolean('gpu', this.gpu !== 0)
    } catch (error) {
      this.close()
      if (error instanceof MangaJaNaiCancelledError || this.deps.isCancelled()) {
        throw new MangaJaNaiCancelledError()
      }
      if (error instanceof MangaJaNaiOutOfMemoryError || error instanceof RangeError) throw error
      this.deps.log.w('MangaJaNaiFull', 'GPU unavailable; using original FP32 CPU model', error)
      this.prefs.putString('device', this.key)
      this.prefs.putBoolean('gpu', false)
    }
    if (this.gpu === 0) {
      this.cpu = this.createCpu(model, MANGA_JANAI_FULL_CPU_SIDE)
      this.cpuSide = MANGA_JANAI_FULL_CPU_SIDE
    }
  }

  /** Kotlin L120-123 `private fun chooseTile()`。 */
  private chooseTile(): void {
    // Larger original-resolution tiles reduce halo overlap/dispatches; memory stays bounded.
    this.tileValue = mangaJaNaiFullPreferredTile(this.deps.device.maxMemoryBytes)
  }

  /** Kotlin L124-135 `fun run(directory, input, output, side)`。 */
  run(directory: string, input: Float32Array, output: Float32Array, side: number): void {
    this.cancelled()
    if (this.gpu !== 0) {
      try {
        this.gpuRun(input, output, side)
      } catch (error) {
        if (!(error instanceof MangaJaNaiIoError)) throw error
        this.close()
        this.prefs.putString('device', this.key)
        this.prefs.putBoolean('gpu', false)
        this.deps.log.w('MangaJaNaiFull', 'GPU failed; retrying exact tile on CPU', error)
        this.cancelled()
        this.runCpu(this.deps.files.join(directory, 'full.onnx'), input, output, side)
      }
    } else {
      this.runCpu(this.deps.files.join(directory, 'full.onnx'), input, output, side)
    }
    this.cancelled()
  }

  /** Kotlin L136-140 `override fun close()`。 */
  close(): void {
    this.cpu?.close()
    this.cpu = null
    this.cpuSide = 0
    if (this.gpu !== 0) {
      const previous = this.gpu
      this.gpu = 0
      this.deps.gpu?.destroy(previous)
    }
    this.tileValue = MANGA_JANAI_FULL_TILE_DEFAULT
  }

  /** Kotlin L126-133 `MangaJaNaiGpu.run(gpu, input, output, side)`。 */
  private gpuRun(input: Float32Array, output: Float32Array, side: number): void {
    const gpu = this.deps.gpu
    if (gpu === null) {
      throw new MangaJaNaiLinkageError('mangajanai 原生 GPU 库不可用（System.loadLibrary 等价）')
    }
    gpu.run(this.gpu, input, output, side)
  }
}
