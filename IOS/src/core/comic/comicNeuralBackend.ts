/**
 * `ui/comic/ComicNeuralBackend.kt`（77 行 / 66 非空）→ `@core/comic/comicNeuralBackend`。
 *
 * 原文一行注释给出了整个契约：「Two tiny bundled graphs, CPU only. JNI failure falls back to
 * the deterministic Kotlin engine.」—— 所以这里有两件事必须**可判定**：
 *
 *   1. **RGBA ↔ NCHW 的搬运**（L41-42 / L48-49）。写反下标不会报错，只会让画面变成
 *      「通道错位」或「行序错乱」，而这在缩略图上几乎看不出来、在大图上才明显 ——
 *      是最该被测试钉住的一段。
 *   2. **失败即降级的状态机**（L22-23 / L54-62 / L71-76）。`unavailable` 一旦置真就**再也不会**
 *      尝试原生；`InterruptedException` 要**原样抛出**（不能被降级吞掉，否则「取消」会变成
 *      「跑完再返回 null」）；其余 `Exception` / `LinkageError` 才 `disable()` 并返回 null。
 *
 * 端口此前**只有一句注释**：`anime4KCnn.ts` L15 / L273 写着
 * 「`ComicNeuralBackend.run("restore", …)` — ALWAYS null here」与
 * 「// Kotlin `ComicNeuralBackend.run(...)` — always null on this port」。
 * `grep ComicNeuralBackend` 能命中，但那个 object 从来没有被实现过（E203）。
 *
 * 行映射
 * ──────
 * | Kotlin | 行 | 这里 |
 * |---|---|---|
 * | `@Volatile applicationContext` / `configure` | L12/L19 | `configure()` + `contextPresent` |
 * | `@Volatile unavailable` | L13 | `this.unavailable`（只由 `disable()` 置真） |
 * | `@Volatile internal var usedNative` | L14-15 | `get usedNative()`（**只在成功返回前**置真） |
 * | `private val lock = Any()` | L16 | 串行化 `run()` / `release()` |
 * | `sessions: mutableMapOf<String, OrtSession>` | L17 | `sessions: Map<model, Session>` |
 * | `run(model, rgba, w, h)` 的四道门 | L22-26 | `run()` 的前四个 early-return |
 * | `nchw[ch * area + i] = rgba[i * 4 + ch]` | L42 | `rgbaToNchw()` |
 * | `packed[i * 4 + ch] = nchw[ch * area + i]` | L49 | `nchwToRgba()` |
 * | `SessionOptions` 五项 | L32-36 | `NEURAL_SESSION_OPTIONS` |
 * | `longArrayOf(1, 4, height, width)` + `"rgba"` | L43-44 | `neuralTensorShape()` + `NEURAL_INPUT_NAME` |
 * | `release()` | L66-69 | `release()` |
 * | `disable(error)` | L71-76 | `disable()`（含日志三件） |
 *
 * 平台差异
 * ────────
 * - `ai.onnxruntime.*` 是 JNI 绑定；Web/iOS 侧的 ONNX 会话由
 *   `@core/comic/mangaJaNaiRuntime` 的注入端口承担（同一套「没有原生就显式失败」的约定）。
 *   本模块只声明**会话端口**与可判定的编排，不绑定任何推理库。
 * - `Context.assets.open("comic_enhancement/$model-s.onnx")` → `neuralAssetName()`；
 *   真正的取字节动作由端口承担。
 * - `Log.w("ComicEnhance", …)` → 注入的 `warn` 回调（`src/core` 不允许依赖 console）。
 */

/** L24 `InterruptedException("CNN cancelled")` 的文案。 */
export const NEURAL_CANCEL_MESSAGE = 'CNN cancelled';

/** L75 `Log.w("ComicEnhance", …)` 的 tag 与文案。 */
export const NEURAL_LOG_TAG = 'ComicEnhance';
export const NEURAL_LOG_MESSAGE = 'Native CNN unavailable; using Kotlin reference';

/** L43 `longArrayOf(1, 4, height, width)` —— **4 通道**、H 在 W 之前。 */
export const NEURAL_CHANNELS = 4;

/** L44 `session.run(mapOf("rgba" to tensor))` 的输入名。 */
export const NEURAL_INPUT_NAME = 'rgba';

/** L30 资源路径模板：`comic_enhancement/$model-s.onnx`。 */
export function neuralAssetName(model: string): string {
  return `comic_enhancement/${model}-s.onnx`;
}

/** L43 的输入张量形状：`[1, 4, height, width]`（NCHW，不是 NHWC）。 */
export function neuralTensorShape(width: number, height: number): readonly [number, number, number, number] {
  return [1, NEURAL_CHANNELS, height, width];
}

/**
 * L31-38 `OrtSession.SessionOptions().use { … }` 的五项。
 *
 * 注意 `BASIC_OPT` 与两个 `false`：关掉内存模式复用与 CPU arena，
 * 因为这两个模型很小、而且切换漫画时会反复重建会话 —— 复用反而把内存留在 arena 里。
 */
export const NEURAL_SESSION_OPTIONS = {
  intraOpThreads: 2,
  interOpThreads: 1,
  optimizationLevel: 'BASIC_OPT',
  memoryPatternOptimization: false,
  cpuArenaAllocator: false,
} as const;

/**
 * L41-42 `for (i in 0 until area) for (ch in 0..3) nchw[ch * area + i] = rgba[i * 4 + ch]`
 * —— **交错 RGBA → 平面 NCHW**。
 */
export function rgbaToNchw(rgba: Float32Array, width: number, height: number): Float32Array {
  const area = width * height;
  const out = new Float32Array(area * NEURAL_CHANNELS);
  for (let i = 0; i < area; i += 1) {
    for (let ch = 0; ch < NEURAL_CHANNELS; ch += 1) {
      out[ch * area + i] = rgba[i * NEURAL_CHANNELS + ch] ?? 0;
    }
  }
  return out;
}

/**
 * L47-49 `output.floatBuffer.get(nchw)` + `packed[i * 4 + ch] = nchw[ch * area + i]`
 * —— **平面 NCHW → 交错 RGBA**（`rgbaToNchw` 的逆）。
 */
export function nchwToRgba(nchw: Float32Array, width: number, height: number): Float32Array {
  const area = width * height;
  const out = new Float32Array(area * NEURAL_CHANNELS);
  for (let i = 0; i < area; i += 1) {
    for (let ch = 0; ch < NEURAL_CHANNELS; ch += 1) {
      out[i * NEURAL_CHANNELS + ch] = nchw[ch * area + i] ?? 0;
    }
  }
  return out;
}

/** 一次推理会话（`OrtSession` 的投影）。 */
export interface NeuralSession {
  /** L44 `session.run(mapOf("rgba" to tensor))` —— 返回输出张量（NCHW 平面）。 */
  run(input: Float32Array, shape: readonly [number, number, number, number]): Float32Array;
  /** L67 `it.close()`。 */
  close(): void;
}

/** 创建会话的端口（`context.assets.open(...)` + `env.createSession(bytes, options)`）。 */
export type NeuralSessionFactory = (model: string) => NeuralSession;

export interface ComicNeuralBackendOptions {
  /** 取模型字节并建会话（L29-38）。抛错等同于 Kotlin 那边的 `Exception`。 */
  readonly openSession: NeuralSessionFactory;
  /** L75 `Log.w(...)`。 */
  readonly warn?: (tag: string, message: string, error: unknown) => void;
}

/**
 * L21-64 `run(model, rgba, width, height): FloatArray?`。
 *
 * 四道门与三条 catch 的顺序**完全照抄**（顺序即语义）：
 *
 * ```
 * val context = applicationContext ?: return null      // 没 configure 过
 * if (unavailable) return null                          // 已经降级过，永不再试
 * if (isInterrupted) throw InterruptedException(...)    // 取消：抛，不降级
 * synchronized(lock) {                                  // 串行
 *     if (unavailable) return null                      // 双检
 *     try { … ; usedNative = true; packed }
 *     catch (InterruptedException) { throw }             // 取消：透传
 *     catch (Exception) { disable(); null }
 *     catch (LinkageError) { disable(); null }
 * }
 * ```
 *
 * `usedNative` 只在**成功返回之前**置真（L50）—— 降级路径上它保持原值，
 * 这样调用方能区分「这次真的用了原生」与「回落到 Kotlin 参考实现」。
 */
export class ComicNeuralBackend {
  private readonly openSession: NeuralSessionFactory;

  private readonly warn: (tag: string, message: string, error: unknown) => void;

  private readonly sessions = new Map<string, NeuralSession>();

  private configured = false;

  private unavailable = false;

  private usedNativeFlag = false;

  /** 串行化：Kotlin `private val lock = Any()`（同一个 object 的所有调用共用一把锁）。 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ComicNeuralBackendOptions) {
    this.openSession = options.openSession;
    this.warn =
      options.warn ??
      ((tag, message, error) => {
        void tag;
        void message;
        void error;
      });
  }

  /** L19 `configure(context) { applicationContext = context.applicationContext }`。 */
  configure(): void {
    this.configured = true;
  }

  /** L13 `unavailable` / L14 `usedNative` 的只读投影（测试与调用方都要能看）。 */
  get isUnavailable(): boolean {
    return this.unavailable;
  }

  get usedNative(): boolean {
    return this.usedNativeFlag;
  }

  /** L21-64。 */
  async run(
    model: string,
    rgba: Float32Array,
    width: number,
    height: number,
    signal?: { readonly aborted: boolean },
  ): Promise<Float32Array | null> {
    // L22 `applicationContext ?: return null`
    if (!this.configured) return null;
    // L23 `if (unavailable) return null`
    if (this.unavailable) return null;
    // L24 `if (Thread.currentThread().isInterrupted) throw InterruptedException("CNN cancelled")`
    if (signal?.aborted === true) throw new Error(NEURAL_CANCEL_MESSAGE);
    return this.withLock(() => {
      // L26 双检：等锁期间可能已被别的线程降级
      if (this.unavailable) return null;
      try {
        let session = this.sessions.get(model);
        if (session === undefined) {
          session = this.openSession(model);
          this.sessions.set(model, session);
        }
        const nchw = rgbaToNchw(rgba, width, height);
        const output = session.run(nchw, neuralTensorShape(width, height));
        if (signal?.aborted === true) throw new Error(NEURAL_CANCEL_MESSAGE);
        const packed = nchwToRgba(output, width, height);
        this.usedNativeFlag = true;
        return packed;
      } catch (error) {
        // L45-46 取消要**原样抛出**，不能被降级吞掉
        if (error instanceof Error && error.message === NEURAL_CANCEL_MESSAGE) throw error;
        this.disable(error);
        return null;
      }
    });
  }

  /** L66-69 `release()`。 */
  async release(): Promise<void> {
    await this.withLock(() => {
      for (const session of this.sessions.values()) {
        try {
          session.close();
        } catch {
          /* L67 `runCatching { it.close() }` —— 关不掉也继续清 */
        }
      }
      this.sessions.clear();
    });
  }

  /** L71-76 `disable(error)`。 */
  private disable(error: unknown): void {
    this.unavailable = true;
    for (const session of this.sessions.values()) {
      try {
        session.close();
      } catch {
        /* runCatching */
      }
    }
    this.sessions.clear();
    this.warn(NEURAL_LOG_TAG, NEURAL_LOG_MESSAGE, error);
  }

  private withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
