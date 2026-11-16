/**
 * mangaJaNaiFull.test.ts — 钉死 MangaJaNai 家族（mobile + full）的移植行为。
 *
 * 被测端口（`src/core/comic/`）：
 *   • `mangaJaNai.ts`            ← MangaJaNai.kt（261 行）
 *   • `mangaJaNaiRuntime.ts`     ← MangaJaNaiRuntime.kt（183 行）
 *   • `mangaJaNaiFullRuntime.ts` ← MangaJaNaiFullRuntime.kt（155 行）
 *   • `mangaJaNaiFull.ts`        ← MangaJaNaiFull.kt（246 行）
 *   • 复用：`mangaJaNaiMobile.ts` / `mangaJaNaiTiles.ts`
 *
 * 覆盖（与任务书逐条对应）：
 *   1. 常量从 Kotlin 原文核对（字节数 / SHA-256 / URL / 限额 / 阈值 / 缓存键模板）
 *   2. 切片数量 / 顺序 / 重叠（TILE=128、HALO=24；full HALO=16）
 *   3. 取消 / 进度 / 超时（InterruptedException 语义 + 看门狗 + 超时惩罚）
 *   4. 缓存键（deviceKey、prefs device/backend、model stamp、切片 LRU）
 *   5. 降级分支（GPU 端口缺失 / 探针不准 / 探针更慢 / 运行期驱动失败 → CPU FP32）
 *   6. 错误传播（模型校验失败 / 包无效 / 超时 / OOM / LinkageError / NaN 输出）
 *   7. 像素格式（NCHW 平面归一化 + ARGB 打包）与缩放倍率（2×/3200/4M 三夹逼）
 *   8. 内存预算（neuralBudget → countBudget → mangaMobileInputSize 收缩）
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppLanguage, setAppLanguage } from '@core/i18n/locale'
import type { PixImage } from '@core/comic/comicPixOps'
import {
  MANGA_JANAI_ASSET_FILE,
  MANGA_JANAI_DEADLINE_NS,
  MANGA_JANAI_HALO,
  MANGA_JANAI_IDLE_RELEASE_MS,
  MANGA_JANAI_MODEL_BYTES,
  MANGA_JANAI_NEURAL_BUDGET_NS,
  MANGA_JANAI_NEURAL_RESERVE_NS,
  MANGA_JANAI_PAGE_LOCK_HELD_MESSAGE,
  MANGA_JANAI_SHA256,
  MANGA_JANAI_SIDE,
  MANGA_JANAI_TILE,
  MANGA_JANAI_TILE_MARGIN,
  MangaJaNai,
  MangaJaNaiBudgetExceededError,
  MangaJaNaiCancelledError,
  MangaJaNaiIoError,
  MangaJaNaiLinkageError,
  MangaJaNaiOutOfMemoryError,
  MangaJaNaiPageLock,
  MangaJaNaiState,
  mangaJaNaiEnhanceProgress,
  mangaJaNaiFullEnhanceProgress,
  mangaJaNaiModelDownloadFailed,
  mangaJaNaiModelSizeMb,
  mangaJaNaiOutputSize,
  readTileFromPix,
  type MangaJaNaiByteReader,
  type MangaJaNaiByteWriter,
  type MangaJaNaiFilePort,
  type MangaJaNaiHost,
  type MangaJaNaiHttpCall,
  type MangaJaNaiHttpPort,
  type MangaJaNaiPrefsPort,
  type MangaJaNaiScalePort,
  type MangaJaNaiSchedulerPort,
  type MangaJaNaiZipEntry,
  type MangaJaNaiZipReader,
} from '@core/comic/mangaJaNai'
import {
  MANGA_JANAI_INITIAL_TILE_NANOSECONDS,
  MANGA_JANAI_RUNTIME_PREFS,
  MangaJaNaiRunOptions,
  MangaJaNaiRuntime,
  MangaJaNaiSessionError,
  mangaJaNaiAcceptableError,
  type MangaJaNaiLogPort,
  type MangaJaNaiSession,
  type MangaJaNaiSessionFactory,
  type MangaJaNaiSessionOptions,
} from '@core/comic/mangaJaNaiRuntime'
import {
  MANGA_JANAI_FULL_BIN_BYTES,
  MANGA_JANAI_FULL_BIN_SHA256,
  MANGA_JANAI_FULL_DOWNLOAD_PREFS,
  MANGA_JANAI_FULL_HALO,
  MANGA_JANAI_FULL_META_LIMIT,
  MANGA_JANAI_FULL_MODEL_BYTES,
  MANGA_JANAI_FULL_MODEL_URL,
  MANGA_JANAI_FULL_PACK_LIMIT,
  MANGA_JANAI_FULL_PACK_URL,
  MANGA_JANAI_FULL_PARAM_BYTES,
  MANGA_JANAI_FULL_PARAM_SHA256,
  MANGA_JANAI_FULL_RETRY_INTERVAL_MS,
  MANGA_JANAI_FULL_SHA256,
  MangaJaNaiFull,
} from '@core/comic/mangaJaNaiFull'
import {
  MANGA_JANAI_FULL_ACCEPTABLE_MAX_ERROR,
  MANGA_JANAI_FULL_ACCEPTABLE_MEAN_ERROR,
  MANGA_JANAI_FULL_BIG_MEMORY_BYTES,
  MANGA_JANAI_FULL_CPU_SIDE,
  MANGA_JANAI_FULL_GPU_SPEEDUP,
  MANGA_JANAI_FULL_KEY_PREFIX,
  MANGA_JANAI_FULL_NAME_CPU,
  MANGA_JANAI_FULL_NAME_GPU,
  MANGA_JANAI_FULL_PROBE_PAD,
  MANGA_JANAI_FULL_RUNTIME_PREFS,
  MANGA_JANAI_FULL_TILE_BIG,
  MANGA_JANAI_FULL_TILE_DEFAULT,
  MANGA_JANAI_FULL_TILE_SMALL,
  MangaJaNaiFullRuntime,
  mangaJaNaiFullAcceptableError,
  mangaJaNaiFullPreferredTile,
  mangaJaNaiFullProbeInput,
  mangaJaNaiFullVkCacheName,
  type MangaJaNaiGpuPort,
} from '@core/comic/mangaJaNaiFullRuntime'
import {
  bilinearPixel,
  combineMangaJaNaiDetail,
  mangaMobileInputSize,
} from '@core/comic/mangaJaNaiMobile'
import { MangaJaNaiTileCache, intArrayHashCode } from '@core/comic/mangaJaNaiTiles'

/* ══════════════════════ 假宿主：时钟 / 定时器 ══════════════════════ */

class FakeClock {
  ns = 0
  now = (): number => this.ns
  advanceMs(delta: number): void {
    this.ns += delta * 1e6
  }
}

interface FakeTask {
  readonly atNs: number
  readonly periodNs: number | null
  readonly task: () => void
  cancelled: boolean
  fired: number
}

class FakeScheduler implements MangaJaNaiSchedulerPort {
  readonly tasks: FakeTask[] = []
  constructor(private readonly clock: FakeClock) {}

  schedule(delayMs: number, task: () => void): () => void {
    const entry: FakeTask = {
      atNs: this.clock.ns + delayMs * 1e6,
      periodNs: null,
      task,
      cancelled: false,
      fired: 0,
    }
    this.tasks.push(entry)
    return () => {
      entry.cancelled = true
    }
  }

  scheduleAtFixedRate(initialDelayMs: number, periodMs: number, task: () => void): () => void {
    const entry: FakeTask = {
      atNs: this.clock.ns + initialDelayMs * 1e6,
      periodNs: periodMs * 1e6,
      task,
      cancelled: false,
      fired: 0,
    }
    this.tasks.push(entry)
    return () => {
      entry.cancelled = true
    }
  }

  /** 触发所有「到点且未取消」的任务（周期任务只触发一次，避免测试抖动）。 */
  runDue(): void {
    for (const entry of this.tasks) {
      if (entry.cancelled || entry.atNs > this.clock.ns) continue
      if (entry.periodNs === null && entry.fired > 0) continue
      entry.fired += 1
      entry.task()
    }
  }

  pendingDelaysMs(): number[] {
    return this.tasks
      .filter((entry) => !entry.cancelled && entry.fired === 0)
      .map((entry) => Math.round((entry.atNs - this.clock.ns) / 1e6))
  }
}

/* ══════════════════════ 假宿主：文件系统 / Zip / 资产 ══════════════════════ */

class BytesReader implements MangaJaNaiByteReader {
  private offset = 0
  constructor(private readonly bytes: Uint8Array) {}
  read(target: Uint8Array): number {
    if (this.offset >= this.bytes.length) return -1
    const count = Math.min(target.length, this.bytes.length - this.offset)
    target.set(this.bytes.subarray(this.offset, this.offset + count))
    this.offset += count
    return count
  }
  close(): void {}
}

class BytesWriter implements MangaJaNaiByteWriter {
  private readonly chunks: Uint8Array[] = []
  constructor(private readonly onClose: (bytes: Uint8Array) => void) {}
  write(source: Uint8Array, offset: number, length: number): void {
    this.chunks.push(source.slice(offset, offset + length))
  }
  close(): void {
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const merged = new Uint8Array(total)
    let at = 0
    for (const chunk of this.chunks) {
      merged.set(chunk, at)
      at += chunk.length
    }
    this.onClose(merged)
  }
}

interface FakeZipEntry {
  readonly name: string
  readonly isDirectory: boolean
  readonly bytes: Uint8Array
}

class FakeZipReader implements MangaJaNaiZipReader {
  private index = -1
  private offset = 0
  constructor(private readonly entries: ReadonlyArray<FakeZipEntry>) {}
  nextEntry(): MangaJaNaiZipEntry | null {
    this.index += 1
    this.offset = 0
    const entry = this.entries[this.index]
    if (entry === undefined) return null
    return { name: entry.name, isDirectory: entry.isDirectory }
  }
  read(target: Uint8Array): number {
    const entry = this.entries[this.index]
    if (entry === undefined || this.offset >= entry.bytes.length) return -1
    const count = Math.min(target.length, entry.bytes.length - this.offset)
    target.set(entry.bytes.subarray(this.offset, this.offset + count))
    this.offset += count
    return count
  }
  closeEntry(): void {}
  close(): void {}
}

class FakeFiles implements MangaJaNaiFilePort {
  readonly filesDir = '/files'
  readonly cacheDir = '/cache'
  readonly table = new Map<string, { bytes: Uint8Array; modified: number }>()
  readonly assets = new Map<string, Uint8Array>()
  readonly zips = new Map<string, ReadonlyArray<FakeZipEntry>>()
  readonly deleted: string[] = []

  join(parent: string, child: string): string {
    return `${parent.replace(/\/+$/, '')}/${child}`
  }
  put(path: string, bytes: Uint8Array, modified = 1): void {
    this.table.set(path, { bytes, modified })
  }
  length(path: string): number {
    return this.table.get(path)?.bytes.length ?? 0
  }
  lastModified(path: string): number {
    return this.table.get(path)?.modified ?? 0
  }
  exists(path: string): boolean {
    return this.table.has(path)
  }
  mkdirs(): void {}
  delete(path: string): boolean {
    this.deleted.push(path)
    return this.table.delete(path)
  }
  rename(from: string, to: string): boolean {
    const entry = this.table.get(from)
    if (entry === undefined) return false
    this.table.delete(from)
    this.table.set(to, entry)
    return true
  }
  openRead(path: string): MangaJaNaiByteReader {
    const entry = this.table.get(path)
    if (entry === undefined) throw new MangaJaNaiIoError(`missing file: ${path}`)
    return new BytesReader(entry.bytes)
  }
  openWrite(path: string): MangaJaNaiByteWriter {
    return new BytesWriter((bytes) => this.put(path, bytes))
  }
  openAsset(assetPath: string): MangaJaNaiByteReader {
    const bytes = this.assets.get(assetPath)
    if (bytes === undefined) throw new MangaJaNaiIoError(`missing asset: ${assetPath}`)
    return new BytesReader(bytes)
  }
  openZip(path: string): MangaJaNaiZipReader {
    return new FakeZipReader(this.zips.get(path) ?? [])
  }
}

/* ══════════════════════ 假宿主：SharedPreferences ══════════════════════ */

class FakePrefs implements MangaJaNaiPrefsPort {
  readonly values = new Map<string, string | boolean | number>()
  getString(key: string): string | null {
    const value = this.values.get(key)
    return typeof value === 'string' ? value : null
  }
  getBoolean(key: string, fallback: boolean): boolean {
    const value = this.values.get(key)
    return typeof value === 'boolean' ? value : fallback
  }
  getLong(key: string, fallback: number): number {
    const value = this.values.get(key)
    return typeof value === 'number' ? value : fallback
  }
  putString(key: string, value: string): void {
    this.values.set(key, value)
  }
  putBoolean(key: string, value: boolean): void {
    this.values.set(key, value)
  }
  putLong(key: string, value: number): void {
    this.values.set(key, value)
  }
  remove(key: string): void {
    this.values.delete(key)
  }
}

class FakePrefsFactory {
  readonly stores = new Map<string, FakePrefs>()
  call(name: string): MangaJaNaiPrefsPort {
    let store = this.stores.get(name)
    if (store === undefined) {
      store = new FakePrefs()
      this.stores.set(name, store)
    }
    return store
  }
  get(name: string): FakePrefs {
    return this.call(name) as FakePrefs
  }
}

/* ══════════════════════ 假宿主：HTTP ══════════════════════ */

interface FakeRoute {
  readonly status: number
  readonly bytes: Uint8Array | null
}

class FakeHttp implements MangaJaNaiHttpPort {
  readonly routes = new Map<string, FakeRoute>()
  readonly requested: string[] = []
  newCall(url: string): MangaJaNaiHttpCall {
    this.requested.push(url)
    const route = this.routes.get(url)
    if (route === undefined) throw new MangaJaNaiIoError(`network unavailable: ${url}`)
    return {
      statusCode: route.status,
      isSuccessful: route.status >= 200 && route.status < 300,
      body: route.bytes === null ? null : new BytesReader(route.bytes),
      cancel: () => undefined,
      close: () => undefined,
    }
  }
}

/* ══════════════════════ 假宿主：推理会话 ══════════════════════ */

/** 会话行为：`(input, output, side, runIndex)`。 */
type FakeRunBehaviour = (
  input: Float32Array,
  output: Float32Array,
  side: number,
  runIndex: number,
) => void

class FakeSessions implements MangaJaNaiSessionFactory {
  readonly created: MangaJaNaiSessionOptions[] = []
  readonly runs: Array<{ side: number; input: Float32Array }> = []
  closed = 0
  providers: string[] = ['CPU']
  constructor(private readonly behave: FakeRunBehaviour) {}

  create(options: MangaJaNaiSessionOptions): MangaJaNaiSession {
    this.created.push(options)
    return {
      run: (input, output) => {
        this.runs.push({ side: options.side, input: Float32Array.from(input) })
        this.behave(input, output, options.side, this.runs.length - 1)
      },
      close: () => {
        this.closed += 1
      },
    }
  }

  availableProviders(): ReadonlyArray<string> {
    return this.providers
  }
}

/** 2× 最近邻上采样 —— 「恒等网络」：输出核心区 == 输入第 `y/2` 行第 `x/2` 列。 */
function nearest2x(input: Float32Array, output: Float32Array, side: number): void {
  const area = side * side
  const out2 = side * 2
  for (let c = 0; c < 3; c += 1) {
    for (let oy = 0; oy < out2; oy += 1) {
      const sy = Math.trunc(oy / 2)
      for (let ox = 0; ox < out2; ox += 1) {
        const sx = Math.trunc(ox / 2)
        output[c * area * 4 + oy * out2 + ox] = input[c * area + sy * side + sx] ?? 0
      }
    }
  }
}

/* ══════════════════════ 假宿主：位图缩放 ══════════════════════ */

class FakeCodec implements MangaJaNaiScalePort {
  scaled = 0
  createScaledBitmap(src: PixImage, width: number, height: number): PixImage {
    this.scaled += 1
    const data = new Uint32Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        data[y * width + x] = bilinearPixel(
          src,
          src.width,
          src.height,
          ((x + 0.5) * src.width) / width - 0.5,
          ((y + 0.5) * src.height) / height - 0.5,
        )
      }
    }
    return { width, height, data }
  }
}

/* ══════════════════════ 假宿主：日志 / 内存压力 ══════════════════════ */

class FakeLog implements MangaJaNaiLogPort {
  readonly entries: Array<{ level: 'i' | 'w'; tag: string; message: string }> = []
  i(tag: string, message: string): void {
    this.entries.push({ level: 'i', tag, message })
  }
  w(tag: string, message: string): void {
    this.entries.push({ level: 'w', tag, message })
  }
  has(fragment: string): boolean {
    return this.entries.some((entry) => entry.message.includes(fragment))
  }
}

class FakeMemory {
  private lowListeners: Array<() => void> = []
  private trimListeners: Array<(level: number) => void> = []
  onLowMemory(listener: () => void): () => void {
    this.lowListeners.push(listener)
    return () => undefined
  }
  onTrimMemory(listener: (level: number) => void): () => void {
    this.trimListeners.push(listener)
    return () => undefined
  }
  fireLowMemory(): void {
    for (const listener of [...this.lowListeners]) listener()
  }
  fireTrim(level: number): void {
    for (const listener of [...this.trimListeners]) listener(level)
  }
}

/* ══════════════════════ 组装宿主 ══════════════════════ */

interface Harness {
  readonly host: MangaJaNaiHost
  readonly clock: FakeClock
  readonly scheduler: FakeScheduler
  readonly files: FakeFiles
  readonly prefs: FakePrefsFactory
  readonly http: FakeHttp
  readonly sessions: FakeSessions
  readonly log: FakeLog
  readonly codec: FakeCodec
  readonly memory: FakeMemory
  cancelled(): void
}

interface HarnessOptions {
  readonly behave?: FakeRunBehaviour
  readonly processors?: number
  readonly maxMemoryBytes?: number
  readonly fingerprint?: string
  readonly sdkInt?: number
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const clock = new FakeClock()
  const scheduler = new FakeScheduler(clock)
  const files = new FakeFiles()
  const prefs = new FakePrefsFactory()
  const http = new FakeHttp()
  const sessions = new FakeSessions(options.behave ?? nearest2x)
  const log = new FakeLog()
  const codec = new FakeCodec()
  const memory = new FakeMemory()
  let flag = false
  const host: MangaJaNaiHost = {
    now: clock.now,
    isCancelled: () => flag,
    files,
    prefs: (name: string) => prefs.call(name),
    http,
    scheduler,
    device: {
      availableProcessors: options.processors ?? 8,
      maxMemoryBytes: options.maxMemoryBytes ?? 512 * 1024 * 1024,
      fingerprint: options.fingerprint ?? 'TEST-FINGERPRINT',
      sdkInt: options.sdkInt ?? 34,
    },
    memory,
    sessions,
    gpu: null,
    codec,
    full: MangaJaNaiFull,
    log,
  }
  MangaJaNai.configure(host)
  return {
    host,
    clock,
    scheduler,
    files,
    prefs,
    http,
    sessions,
    log,
    codec,
    memory,
    cancelled: () => {
      flag = true
    },
  }
}

/** 生成确定性的测试图：每像素 `0xAARRGGBB`。 */
function makeImage(width: number, height: number, pick: (x: number, y: number) => number): PixImage {
  const data = new Uint32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[y * width + x] = pick(x, y) >>> 0
  }
  return { width, height, data }
}

function gradient(width: number, height: number): PixImage {
  return makeImage(
    width,
    height,
    (x, y) => 0xff000000 | (((x * 7) % 256) << 16) | (((y * 11) % 256) << 8) | ((x * y) % 256),
  )
}

function uniform(width: number, height: number): PixImage {
  return makeImage(width, height, () => 0xff336699)
}

function inferCount(log: FakeLog): number {
  const line = [...log.entries].reverse().find((entry) => entry.message.includes('inferred='))
  if (line === undefined) return -1
  const match = /inferred=(\d+)/.exec(line.message)
  return match === null ? -1 : Number(match[1])
}

afterEach(() => {
  vi.restoreAllMocks()
  setAppLanguage(AppLanguage.ZH)
  MangaJaNai.release()
  MangaJaNaiFull.release()
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 1. 常量核对（值直接抄自 Kotlin 原文）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('Kotlin 常量逐字核对', () => {
  it('mobile 档：MODEL_BYTES / SHA256 / TILE / HALO / SIDE / DEADLINE', () => {
    expect(MANGA_JANAI_MODEL_BYTES).toBe(1_673_288)
    expect(MANGA_JANAI_SHA256).toBe(
      '718b8670ab396a5174e5b4b38f9d3947beaac3afbe9647d494d65925180a2a7b',
    )
    expect(MANGA_JANAI_TILE).toBe(128)
    expect(MANGA_JANAI_HALO).toBe(24)
    // Kotlin L33 `private const val SIDE = TILE + HALO * 2`
    expect(MANGA_JANAI_SIDE).toBe(176)
    expect(MANGA_JANAI_DEADLINE_NS).toBe(4_300_000_000)
    expect(MANGA_JANAI_NEURAL_BUDGET_NS).toBe(3_200_000_000)
    expect(MANGA_JANAI_NEURAL_RESERVE_NS).toBe(700_000_000)
    expect(MANGA_JANAI_TILE_MARGIN).toBe(1.4)
    expect(MANGA_JANAI_ASSET_FILE).toBe('comic_enhancement/janai-span-mobile.onnx')
    expect(MANGA_JANAI_IDLE_RELEASE_MS).toBe(60_000)
  })

  it('full 档：67 MB 模型 + ncnn param/bin 的字节数与 SHA-256', () => {
    expect(MANGA_JANAI_FULL_MODEL_BYTES).toBe(67_191_396)
    expect(MANGA_JANAI_FULL_SHA256).toBe(
      'c985d6b78ed1a659867cd5697ce80743ad9ddd73868f463e69c824f15f169eb0',
    )
    expect(MANGA_JANAI_FULL_PARAM_BYTES).toBe(102_736)
    expect(MANGA_JANAI_FULL_PARAM_SHA256).toBe(
      '92bb351b492ba789925b345710ad45c4d5e6cc696540a55348c5f82fb4c36cf8',
    )
    expect(MANGA_JANAI_FULL_BIN_BYTES).toBe(66_814_088)
    expect(MANGA_JANAI_FULL_BIN_SHA256).toBe(
      'c0f66830e66bbc75ce45364bfef1317fa7b16813bc427ff6903aceafb757cb80',
    )
    expect(MANGA_JANAI_FULL_HALO).toBe(16)
  })

  it('full 档：下载 URL / 限额 / 重试节流 / 元数据限额 / 切片尺寸', () => {
    expect(MANGA_JANAI_FULL_PACK_URL).toBe(
      'https://github.com/roxycon-dev/Ciallo-Reader/releases/download/v1.3.6/MangaJaNai-full-v1-fp32.zip',
    )
    expect(MANGA_JANAI_FULL_MODEL_URL).toBe(
      'https://huggingface.co/haesslerian/MangaJaNai_V1_ONNX/resolve/2f67ff30209f2e0c75b7c55e6f3ffc3adbc960f7/2x_MangaJaNai_1200p_V1_ESRGAN_70k.onnx',
    )
    expect(MANGA_JANAI_FULL_PACK_LIMIT).toBe(90_000_000)
    expect(MANGA_JANAI_FULL_META_LIMIT).toBe(8192)
    expect(MANGA_JANAI_FULL_RETRY_INTERVAL_MS).toBe(3_600_000)
    expect(MANGA_JANAI_FULL_TILE_DEFAULT).toBe(48)
    expect(MANGA_JANAI_FULL_CPU_SIDE).toBe(80)
    expect(MANGA_JANAI_FULL_PROBE_PAD).toBe(32)
  })

  it('缓存键模板：deviceKey 前缀 + prefs 命名空间', () => {
    expect(MANGA_JANAI_RUNTIME_PREFS).toBe('mangajanai-runtime')
    expect(MANGA_JANAI_FULL_RUNTIME_PREFS).toBe('mangajanai-full-runtime')
    expect(MANGA_JANAI_FULL_DOWNLOAD_PREFS).toBe('mangajanai-full-download')
    expect(MANGA_JANAI_FULL_KEY_PREFIX).toBe('ncnn-20260526-f32-v1')
    const h = makeHarness()
    const runtime = new MangaJaNaiRuntime({
      device: h.host.device,
      prefs: h.host.prefs,
      sessions: h.sessions,
      now: h.host.now,
      isCancelled: h.host.isCancelled,
      log: h.log,
    })
    expect(runtime.deviceKey).toBe(`span-mobile-v1:TEST-FINGERPRINT:${MANGA_JANAI_SHA256}`)
    expect(runtime.tileNanoseconds).toBe(MANGA_JANAI_INITIAL_TILE_NANOSECONDS)
    expect(MANGA_JANAI_INITIAL_TILE_NANOSECONDS).toBe(100_000_000)
  })

  it('内存预算与探针阈值：384MB → 240 / 128；误差 0.0015/0.0001 与 0.03/0.003', () => {
    expect(MANGA_JANAI_FULL_BIG_MEMORY_BYTES).toBe(384 * 1024 * 1024)
    expect(MANGA_JANAI_FULL_TILE_BIG).toBe(240)
    expect(MANGA_JANAI_FULL_TILE_SMALL).toBe(128)
    expect(mangaJaNaiFullPreferredTile(MANGA_JANAI_FULL_BIG_MEMORY_BYTES)).toBe(
      MANGA_JANAI_FULL_TILE_BIG,
    )
    expect(mangaJaNaiFullPreferredTile(MANGA_JANAI_FULL_BIG_MEMORY_BYTES - 1)).toBe(
      MANGA_JANAI_FULL_TILE_SMALL,
    )
    expect(MANGA_JANAI_FULL_ACCEPTABLE_MAX_ERROR).toBe(0.0015)
    expect(MANGA_JANAI_FULL_ACCEPTABLE_MEAN_ERROR).toBe(0.0001)
    expect(mangaJaNaiFullAcceptableError(0.0015, 0.0001)).toBe(true)
    expect(mangaJaNaiFullAcceptableError(0.00151, 0.0001)).toBe(false)
    expect(mangaJaNaiFullAcceptableError(0.0015, 0.00011)).toBe(false)
    expect(mangaJaNaiFullAcceptableError(Number.NaN, 0)).toBe(false)
    expect(mangaJaNaiAcceptableError(0.03, 0.003)).toBe(true)
    expect(mangaJaNaiAcceptableError(0.031, 0.003)).toBe(false)
    expect(MANGA_JANAI_FULL_GPU_SPEEDUP).toBe(0.85)
    expect(mangaJaNaiFullVkCacheName(34)).toBe('mangajanai-full-34.vkcache')
  })

  it('全精度探针输入 = (x*13 + y*17 + c*31) % 256 / 255，按 NCHW 平面铺开', () => {
    const values = mangaJaNaiFullProbeInput(3)
    const area = 9
    const expected = (c: number, x: number, y: number): number =>
      ((x * 13 + y * 17 + c * 31) % 256) / 255
    expect(values.length).toBe(area * 3)
    expect(values[0]).toBeCloseTo(expected(0, 0, 0), 6)
    expect(values[4]).toBeCloseTo(expected(0, 1, 1), 6)
    expect(values[area + 5]).toBeCloseTo(expected(1, 2, 1), 6)
    expect(values[area * 2 + 8]).toBeCloseTo(expected(2, 2, 2), 6)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 2. 文案（中文逐字 / 英文同表）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('文案逐字（Strings.kt L3080-3093）', () => {
  it('中文分支', () => {
    setAppLanguage(AppLanguage.ZH)
    expect(mangaJaNaiEnhanceProgress(42)).toBe('增强 42%')
    expect(mangaJaNaiFullEnhanceProgress(42)).toBe('完整增强 42%')
    expect(mangaJaNaiModelDownloadFailed(404)).toBe('完整模型下载失败：HTTP 404')
    expect(mangaJaNaiModelSizeMb(42)).toBe('完整模型 42 MB')
  })

  it('英文分支', () => {
    setAppLanguage(AppLanguage.EN)
    expect(mangaJaNaiEnhanceProgress(42)).toBe('Enhancing 42%')
    expect(mangaJaNaiFullEnhanceProgress(42)).toBe('Full enhance 42%')
    expect(mangaJaNaiModelDownloadFailed(404)).toBe('Model download failed: HTTP 404')
    expect(mangaJaNaiModelSizeMb(42)).toBe('Full model 42 MB')
  })

  it('异常文案逐字（Kotlin tr(...) 常量）', () => {
    setAppLanguage(AppLanguage.ZH)
    expect(new MangaJaNaiBudgetExceededError().message).toBe('增强超时，已保留原图')
    expect(new MangaJaNaiCancelledError().message).toBe('MangaJaNai cancelled')
    expect(MANGA_JANAI_PAGE_LOCK_HELD_MESSAGE).toContain('MangaJaNai 页锁')
    expect(new MangaJaNaiIoError('增强引擎尚未初始化').message).toBe('增强引擎尚未初始化')
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 3. 切片：数量 / 顺序 / 重叠 / 边缘复制
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('切片尺寸与重叠（TILE=128 / HALO=24）', () => {
  it('readTileFromPix 按 Kotlin 的 clamp 复制边缘像素', () => {
    const src = gradient(10, 6)
    const target = new Int32Array(12 * 12) // tileSize=8, halo=2
    readTileFromPix(src, 0, 0, target, 8, 2)
    const side = 12
    // 左上角 (0,0) 落在 (halo, halo)
    expect(target[2 * side + 2]).toBe((src.data[0] as number) | 0)
    // 左边界外 (0..1 列) 复制自第 0 列
    expect(target[2 * side + 0]).toBe((src.data[0] as number) | 0)
    expect(target[3 * side + 1]).toBe((src.data[10] as number) | 0)
    // 上边界外整行复制自第 0 行
    expect(target[0 * side + 5]).toBe(target[2 * side + 5])
    // 右/下边界外复制自最后有效列/行
    expect(target[11 * side + 11]).toBe(target[9 * side + 9])
  })

  it('相邻切片在 halo 区重合 48 列（300×200 → 6 片，行优先）', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    MangaJaNai.enhance(gradient(300, 200), 1)
    // prepare 4 次探针 + 6 片推理
    expect(h.sessions.runs.length).toBe(10)
    expect(h.sessions.runs[0]!.side).toBe(MANGA_JANAI_SIDE)
    const tiles = h.sessions.runs.slice(4).map((run) => run.input)
    expect(tiles.length).toBe(6)
    const side = MANGA_JANAI_SIDE
    const halo = MANGA_JANAI_HALO
    // 第 0 片（x=0）与第 1 片（x=128）：源 104..151 的 48 列必须逐像素相同
    for (let row = halo; row < halo + 152; row += 1) {
      for (let col = 0; col < 48; col += 1) {
        expect(tiles[0]![row * side + 128 + col]).toBe(tiles[1]![row * side + col])
      }
    }
  })

  it('切片顺序：x 内层、y 外层（300×200 → (0,0),(128,0),(256,0),(0,128)…）', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    // R 通道标记 x、G 通道标记 y（都 ÷2 以塞进 0..255）
    const src = makeImage(300, 200, (x, y) => 0xff000000 | ((x >> 1) << 16) | ((y >> 1) << 8))
    MangaJaNai.enhance(src, 1)
    const tiles = h.sessions.runs.slice(4).map((run) => run.input)
    const side = MANGA_JANAI_SIDE
    const area = side * side
    const channelAt = (tile: Float32Array, plane: 0 | 1, ox: number, oy: number): number =>
      Math.round((tile[plane * area + (oy + MANGA_JANAI_HALO) * side + ox + MANGA_JANAI_HALO] ?? 0) * 255)
    expect(channelAt(tiles[0]!, 0, 0, 0)).toBe(0)
    expect(channelAt(tiles[1]!, 0, 0, 0)).toBe(64)
    expect(channelAt(tiles[2]!, 0, 0, 0)).toBe(128)
    expect(channelAt(tiles[3]!, 0, 0, 0)).toBe(0)
    expect(channelAt(tiles[3]!, 1, 0, 0)).toBe(64)
  })

  it('相同切片只推理一次（capacity=1 的 LRU）', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    MangaJaNai.enhance(uniform(300, 200), 1)
    expect(h.sessions.runs.length).toBe(4 + 1)
    expect(h.log.has('tiles=6 inferred=1')).toBe(true)
  })

  it('MangaJaNaiTileCache 按内容命中并做 LRU 换出', () => {
    const cache = new MangaJaNaiTileCache(1)
    const a = new Int32Array([1, 2, 3])
    const b = new Int32Array([4, 5, 6])
    expect(cache.find(a)).toBeNull()
    cache.put(a, Float32Array.from([0.1, 0.2]))
    expect(cache.find(a)).not.toBeNull()
    cache.put(b, Float32Array.from([0.3, 0.4]))
    expect(cache.find(a)).toBeNull()
    expect(cache.find(b)).not.toBeNull()
    expect(intArrayHashCode(a)).toBe(31 * (31 * (31 * 1 + 1) + 2) + 3)
    // Kotlin L29 `require(it.input.size == input.size && it.output.size == output.size)`
    expect(() => cache.put(a, Float32Array.from([0.5]))).toThrow(RangeError)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 4. 像素格式 / 缩放倍率 / 内存预算
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('像素格式与缩放倍率', () => {
  it('输入张量是 R/G/B 三平面归一化浮点（NCHW）', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    const src = makeImage(8, 8, (x, y) => 0xff000000 | ((x * 16) << 16) | ((y * 16) << 8) | 0x20)
    MangaJaNai.enhance(src, 1)
    const first = h.sessions.runs[0]!.input
    const area = MANGA_JANAI_SIDE * MANGA_JANAI_SIDE
    expect(first.length).toBe(area * 3)
    const at = MANGA_JANAI_HALO * MANGA_JANAI_SIDE + MANGA_JANAI_HALO
    expect(first[at]).toBeCloseTo(0, 6)
    expect(first[area + at]).toBeCloseTo(0, 6)
    expect(first[area * 2 + at]).toBeCloseTo(0x20 / 255, 6)
    const at2 = at + 1
    expect(first[at2]).toBeCloseTo(16 / 255, 6)
    expect(first[area + at2]).toBeCloseTo(0, 6)
  })

  it('outputSize：2× 上限 / 3200 长边 / 4M 像素三夹逼，且保底 1', () => {
    // 面积未触顶 → 恰好 2×
    expect(mangaJaNaiOutputSize(100, 50)).toEqual([200, 100])
    expect(mangaJaNaiOutputSize(800, 600)).toEqual([1600, 1200])
    // 面积触顶（3200×2400=7.68M）→ 按 sqrt(4M/area) 收缩
    expect(mangaJaNaiOutputSize(3200, 2400)).toEqual([2309, 1732])
    const [w3, h3] = mangaJaNaiOutputSize(4000, 6000)
    expect(w3 * h3).toBeLessThanOrEqual(4_000_000)
    expect(Math.max(w3, h3)).toBeLessThan(3200)
    expect(mangaJaNaiOutputSize(1, 1)).toEqual([2, 2])
  })

  it('mobile 输入尺寸：1400 / 900k / 0.93 收缩直到切片数 ≤ 预算', () => {
    expect(mangaMobileInputSize(800, 1000, 1000)).toEqual([800, 1000])
    expect(mangaMobileInputSize(2800, 2000, 1000)).toEqual([1122, 801])
    const [w, h] = mangaMobileInputSize(2800, 2000, 8)
    const tiles =
      Math.trunc((w + MANGA_JANAI_TILE - 1) / MANGA_JANAI_TILE) *
      Math.trunc((h + MANGA_JANAI_TILE - 1) / MANGA_JANAI_TILE)
    expect(tiles).toBeLessThanOrEqual(8)
    expect(mangaMobileInputSize(2800, 2000, 0)).toEqual(mangaMobileInputSize(2800, 2000, 1))
  })

  it('大页按「实测吞吐」收缩神经输入，并显式走 createScaledBitmap', () => {
    // 每次推理 200ms → tileNanoseconds=2e8 → countBudget=trunc(3.2e9/2.8e8)=11
    const h = makeHarness({
      behave: (input, output, side) => {
        h.clock.advanceMs(200)
        nearest2x(input, output, side)
      },
    })
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    MangaJaNai.enhance(uniform(2800, 2000), 1)
    expect(h.codec.scaled).toBe(1)
    const logLine = h.log.entries.find((entry) => entry.message.startsWith('aiComplete=true'))
    expect(logLine).toBeDefined()
    const match = /neural=(\d+)x(\d+)/.exec(logLine!.message)
    expect(match).not.toBeNull()
    const iw = Number(match![1])
    const ih = Number(match![2])
    expect(iw).toBeLessThan(2800)
    const tiles =
      Math.trunc((iw + MANGA_JANAI_TILE - 1) / MANGA_JANAI_TILE) *
      Math.trunc((ih + MANGA_JANAI_TILE - 1) / MANGA_JANAI_TILE)
    expect(tiles).toBeLessThanOrEqual(11)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 5. 取消 / 进度 / 超时 / 静默
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('取消 / 进度 / 超时', () => {
  it('推理中取消 → MangaJaNaiCancelledError，且不上报失败文案', () => {
    const h = makeHarness({
      behave: (input, output, side, index) => {
        if (index >= 4) h.cancelled()
        nearest2x(input, output, side)
      },
    })
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    expect(() => MangaJaNai.enhance(gradient(300, 200), 1)).toThrow(MangaJaNaiCancelledError)
    expect(MangaJaNai.status).not.toBe('增强失败 · 已保留原图')
    expect(MangaJaNai.status).not.toBe('增强超时 · 已保留原图')
  })

  it('未开始就取消 → 直接抛 Cancelled（不建会话）', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    h.cancelled()
    expect(() => MangaJaNai.enhance(gradient(20, 20), 1)).toThrow(MangaJaNaiCancelledError)
    expect(h.sessions.created.length).toBe(0)
  })

  it('超时 → BudgetExceeded + 「增强超时 · 已保留原图」，不返回部分结果', () => {
    const h = makeHarness({
      behave: (input, output, side, index) => {
        if (index >= 4) h.clock.advanceMs(4_500)
        nearest2x(input, output, side)
      },
    })
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    expect(() => MangaJaNai.enhance(gradient(300, 200), 1)).toThrow(MangaJaNaiBudgetExceededError)
    expect(MangaJaNai.status).toBe('增强超时 · 已保留原图')
    expect(h.log.has('aiComplete=true')).toBe(false)
  })

  it('看门狗 + 空闲释放都注册在宿主调度器上', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    MangaJaNai.enhance(gradient(20, 20), 1)
    expect(h.scheduler.pendingDelaysMs()).toContain(MANGA_JANAI_IDLE_RELEASE_MS)
    expect(h.scheduler.tasks.length).toBeGreaterThanOrEqual(2)
  })

  it('进度按百分比变化上报（引擎准备中… → 增强 100%）', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    const seen: string[] = []
    const off = MangaJaNai.onStatus((value) => {
      if (value !== '') seen.push(value)
    })
    MangaJaNai.enhance(gradient(200, 200), 1)
    off()
    expect(seen).toContain('引擎准备中…')
    expect(seen[seen.length - 1]).toBe('增强 100%')
    expect(seen.indexOf('引擎准备中…')).toBeLessThan(seen.indexOf('增强 100%'))
    expect(h.sessions.runs.length).toBeGreaterThan(4)
  })

  it('withSilentStatus 抑制全部上报（后台任务不抢状态栏）', () => {
    makeHarness()
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    const before = MangaJaNai.status
    const out = MangaJaNai.withSilentStatus(true, () => MangaJaNai.enhance(gradient(20, 20), 1))
    expect(out.width).toBe(40)
    expect(MangaJaNai.status).toBe(before)
    expect(MangaJaNai.isSilent).toBe(false)
  })

  it('页锁可重入（enhance 内调用 MangaJaNaiFull.release），跨任务互斥', () => {
    const lock = new MangaJaNaiPageLock()
    const taskA = {}
    const taskB = {}
    lock.lock(taskA)
    lock.lock(taskA)
    expect(lock.held).toBe(true)
    expect(lock.tryLock(taskB)).toBe(false)
    lock.unlock(taskA)
    lock.unlock(taskA)
    expect(lock.held).toBe(false)
    expect(lock.tryLock(taskB)).toBe(true)
    lock.unlock(taskB)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 6. 缓存键与后端探测
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('缓存键与后端探测（MangaJaNaiRuntime）', () => {
  function runtimeOf(h: Harness): MangaJaNaiRuntime {
    return new MangaJaNaiRuntime({
      device: h.host.device,
      prefs: h.host.prefs,
      sessions: h.sessions,
      now: h.host.now,
      isCancelled: h.host.isCancelled,
      log: h.log,
    })
  }

  const input = (): Float32Array => new Float32Array(MANGA_JANAI_SIDE * MANGA_JANAI_SIDE * 3)
  const output = (): Float32Array => new Float32Array(MANGA_JANAI_SIDE * MANGA_JANAI_SIDE * 12)

  it('首次 prepare 探测 CPU/BALANCED/XNNPACK 并写回 device+backend', () => {
    const h = makeHarness()
    h.sessions.providers = ['CPU', 'XNNPACK']
    const runtime = runtimeOf(h)
    runtime.prepare('/m.onnx', input(), output(), new MangaJaNaiRunOptions(), 4_300_000_000)

    expect(h.sessions.created.length).toBe(4)
    const cpu = h.sessions.created[0]!
    expect(cpu.intraOpNumThreads).toBe(4) // availableProcessors=8 → coerceIn(1,4)
    expect(cpu.interOpNumThreads).toBe(1)
    expect(cpu.symbolicDimensions).toEqual([
      ['batch_size', 1],
      ['width', MANGA_JANAI_SIDE],
      ['height', MANGA_JANAI_SIDE],
    ])
    expect(cpu.xnnpack).toBeNull()
    const balanced = h.sessions.created[1]!
    expect(balanced.backend).toBe('CPU_BALANCED')
    expect(balanced.intraOpNumThreads).toBe(5) // coerceIn(1,5)
    expect(balanced.configEntries).toContainEqual(['session.dynamic_block_base', '4'])
    const xnnpack = h.sessions.created[2]!
    expect(xnnpack.backend).toBe('XNNPACK')
    expect(xnnpack.intraOpNumThreads).toBe(1)
    expect(xnnpack.xnnpack).toEqual([['intra_op_num_threads', '4']])

    const prefs = h.prefs.get(MANGA_JANAI_RUNTIME_PREFS)
    expect(prefs.getString('device')).toBe(runtime.deviceKey)
    expect(prefs.getString('backend')).toBe('CPU')
    expect(h.log.has('selected=CPU')).toBe(true)
  })

  it('device 键不匹配（换了设备指纹）→ 忽略缓存的后端，重新探测', () => {
    const h = makeHarness()
    const prefs = h.prefs.get(MANGA_JANAI_RUNTIME_PREFS)
    prefs.putString('device', 'span-mobile-v1:OTHER:sha')
    prefs.putString('backend', 'XNNPACK')
    const runtime = runtimeOf(h)
    runtime.prepare('/m.onnx', input(), output(), new MangaJaNaiRunOptions(), 4_300_000_000)
    expect(h.sessions.created[0]!.backend).toBe('CPU')
    expect(prefs.getString('device')).toBe(runtime.deviceKey)
  })

  it('device 键匹配 → 直接用缓存后端跑一次（不探测）', () => {
    const h = makeHarness()
    const runtime = runtimeOf(h)
    const prefs = h.prefs.get(MANGA_JANAI_RUNTIME_PREFS)
    prefs.putString('device', runtime.deviceKey)
    prefs.putString('backend', 'CPU_BALANCED')
    runtime.prepare('/m.onnx', input(), output(), new MangaJaNaiRunOptions(), 4_300_000_000)
    expect(h.sessions.created.length).toBe(1)
    expect(h.sessions.created[0]!.backend).toBe('CPU_BALANCED')
    expect(h.sessions.runs.length).toBe(1)
  })

  it('缓存后端建会话失败 → 清 backend；已过 deadline 则 BudgetExceeded', () => {
    const h = makeHarness()
    const runtime = new MangaJaNaiRuntime({
      device: h.host.device,
      prefs: h.host.prefs,
      sessions: {
        create: () => {
          throw new MangaJaNaiSessionError('graph rejected')
        },
        availableProviders: () => ['CPU'],
      },
      now: h.host.now,
      isCancelled: h.host.isCancelled,
      log: h.log,
    })
    const prefs = h.prefs.get(MANGA_JANAI_RUNTIME_PREFS)
    prefs.putString('device', runtime.deviceKey)
    prefs.putString('backend', 'XNNPACK')
    h.clock.advanceMs(5_000)
    expect(() =>
      runtime.prepare('/m.onnx', input(), output(), new MangaJaNaiRunOptions(), 4_000_000_000),
    ).toThrow(MangaJaNaiBudgetExceededError)
    expect(prefs.getString('backend')).toBeNull()
  })

  it('run 的吞吐 EMA 与超时惩罚（Kotlin L171 / L177）', () => {
    const h = makeHarness()
    const factory: MangaJaNaiSessionFactory = {
      create: () => ({
        run: () => {
          h.clock.advanceMs(40)
        },
        close: () => undefined,
      }),
      availableProviders: () => ['CPU'],
    }
    const runtime = new MangaJaNaiRuntime({
      device: h.host.device,
      prefs: h.host.prefs,
      sessions: factory,
      now: h.host.now,
      isCancelled: h.host.isCancelled,
      log: h.log,
    })
    runtime.prepare('/m.onnx', input(), output(), new MangaJaNaiRunOptions(), 4_300_000_000)
    // 探针每次 40ms → tileNanoseconds = 40ms
    expect(runtime.tileNanoseconds).toBe(40_000_000)
    runtime.run('/m.onnx', input(), output(), new MangaJaNaiRunOptions(), 4_300_000_000)
    // max(40ms, (40ms*3 + 40ms)/4 = 40ms) = 40ms
    expect(runtime.tileNanoseconds).toBe(40_000_000)
    runtime.penalizeTimeout()
    expect(runtime.tileNanoseconds).toBe(250_000_000)
    runtime.penalizeTimeout()
    expect(runtime.tileNanoseconds).toBe(500_000_000)
  })

  it('CPU 后端驱动故障不吞异常（Kotlin L160），且不改写 backend', () => {
    const h = makeHarness()
    const prefs = h.prefs.get(MANGA_JANAI_RUNTIME_PREFS)
    let failRun = false
    const runtime = new MangaJaNaiRuntime({
      device: h.host.device,
      prefs: h.host.prefs,
      sessions: {
        create: () => ({
          run: () => {
            if (failRun) throw new MangaJaNaiSessionError('driver lost')
            nearest2x(
              new Float32Array(MANGA_JANAI_SIDE * MANGA_JANAI_SIDE * 3),
              new Float32Array(MANGA_JANAI_SIDE * MANGA_JANAI_SIDE * 12),
              MANGA_JANAI_SIDE,
            )
          },
          close: () => undefined,
        }),
        availableProviders: () => ['CPU'],
      },
      now: h.host.now,
      isCancelled: h.host.isCancelled,
      log: h.log,
    })
    prefs.putString('device', runtime.deviceKey)
    prefs.putString('backend', 'CPU')
    runtime.prepare('/m.onnx', input(), output(), new MangaJaNaiRunOptions(), 4_300_000_000)
    failRun = true
    expect(() =>
      runtime.run('/m.onnx', input(), output(), new MangaJaNaiRunOptions(), 4_300_000_000),
    ).toThrow(MangaJaNaiSessionError)
    expect(prefs.getString('backend')).toBe('CPU')
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 7. 模型加载 / 下载校验（mobile）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('模型加载与校验（mobile）', () => {
  it('verify：长度不符直接 false；长度对但内容不符也 false', () => {
    const h = makeHarness()
    const path = '/files/mangajanai/janai-span-v3-f32.onnx'
    h.files.put(path, new Uint8Array(10))
    expect(MangaJaNai.verify(path)).toBe(false)
    h.files.put(path, new Uint8Array(MANGA_JANAI_MODEL_BYTES))
    expect(MangaJaNai.verify(path)).toBe(false)
  })

  it('资产拷贝通过校验才落盘；校验失败 → 「增强模型校验失败」且 .part 被清理', () => {
    const h = makeHarness()
    h.files.assets.set(MANGA_JANAI_ASSET_FILE, new Uint8Array(MANGA_JANAI_MODEL_BYTES))
    expect(() => MangaJaNai.model()).toThrow(MangaJaNaiIoError)
    expect(() => MangaJaNai.model()).toThrow('增强模型校验失败')
    expect(h.files.deleted).toContain('/files/mangajanai/mobile.part')
    expect(h.files.exists('/files/mangajanai/janai-span-v3-f32.onnx')).toBe(false)
  })

  it('增强引擎未初始化 → 明确 IOException 文案（不返回原图）', () => {
    const fresh = new MangaJaNaiState()
    expect(() => fresh.enhance(gradient(8, 8), 1)).toThrow('增强引擎尚未初始化')
    expect(() => fresh.model()).toThrow('增强引擎尚未初始化')
  })

  it('verify 过程中取消 → Cancelled（64KB 分块之间的取消点）', () => {
    const h = makeHarness()
    const path = '/files/mangajanai/janai-span-v3-f32.onnx'
    h.files.put(path, new Uint8Array(MANGA_JANAI_MODEL_BYTES))
    h.cancelled()
    expect(() => MangaJaNai.verify(path)).toThrow(MangaJaNaiCancelledError)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 8. 完整档：下载 / 解包 / 重试链
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('完整档模型包（download / unpack / model）', () => {
  const FULL_DIR = '/files/mangajanai/full'

  it('包 404 → 回退单文件；单文件长度不符 → 「完整模型校验失败」', () => {
    const h = makeHarness()
    h.clock.advanceMs(1_000)
    h.http.routes.set(MANGA_JANAI_FULL_PACK_URL, { status: 404, bytes: null })
    h.http.routes.set(MANGA_JANAI_FULL_MODEL_URL, { status: 200, bytes: new Uint8Array(1024) })
    expect(() => MangaJaNaiFull.model()).toThrow('完整模型校验失败')
    expect(h.http.requested).toEqual([MANGA_JANAI_FULL_PACK_URL, MANGA_JANAI_FULL_MODEL_URL])
    expect(h.log.has('Model pack unavailable; trying original CPU weights')).toBe(true)
    expect(h.prefs.get(MANGA_JANAI_FULL_DOWNLOAD_PREFS).getLong('lastAttempt', 0)).toBeGreaterThan(0)
    expect(h.files.exists(`${FULL_DIR}/download.zip.part`)).toBe(false)
    expect(h.files.deleted).toContain(`${FULL_DIR}/full.onnx.part`)
  })

  it('包与单文件都 404 → 下载失败文案逐字（含 HTTP 码）', () => {
    const h = makeHarness()
    h.http.routes.set(MANGA_JANAI_FULL_PACK_URL, { status: 404, bytes: null })
    h.http.routes.set(MANGA_JANAI_FULL_MODEL_URL, { status: 404, bytes: null })
    expect(() => MangaJaNaiFull.model()).toThrow('完整模型下载失败：HTTP 404')
    expect(h.http.requested).toEqual([MANGA_JANAI_FULL_PACK_URL, MANGA_JANAI_FULL_MODEL_URL])
  })

  it('download：超限 → 「完整模型大小不符」；空体 → 「完整模型为空」', () => {
    const h = makeHarness()
    h.http.routes.set(MANGA_JANAI_FULL_PACK_URL, { status: 200, bytes: new Uint8Array(2048) })
    expect(() =>
      MangaJaNaiFull.download(MANGA_JANAI_FULL_PACK_URL, '/files/a.bin', 1024),
    ).toThrow('完整模型大小不符')
    h.http.routes.set(MANGA_JANAI_FULL_PACK_URL, { status: 200, bytes: null })
    expect(() =>
      MangaJaNaiFull.download(MANGA_JANAI_FULL_PACK_URL, '/files/a.bin', 1024),
    ).toThrow('完整模型为空')
  })

  it('unpack：未知条目 / 重复条目 / 尺寸不符各自报错，且 .part 全清', () => {
    const h = makeHarness()
    const pack = '/files/pack.zip'

    h.files.zips.set(pack, [{ name: 'evil.bin', isDirectory: false, bytes: new Uint8Array(4) }])
    expect(() => MangaJaNaiFull.unpack(pack, FULL_DIR)).toThrow('完整模型包无效')

    h.files.zips.set(pack, [
      { name: 'manifest.json', isDirectory: false, bytes: new Uint8Array(2) },
      { name: 'manifest.json', isDirectory: false, bytes: new Uint8Array(2) },
    ])
    expect(() => MangaJaNaiFull.unpack(pack, FULL_DIR)).toThrow('完整模型包无效')

    h.files.zips.set(pack, [
      { name: 'full.param', isDirectory: false, bytes: new Uint8Array(10) },
      { name: 'full.bin', isDirectory: false, bytes: new Uint8Array(10) },
      { name: 'full.onnx', isDirectory: false, bytes: new Uint8Array(10) },
    ])
    expect(() => MangaJaNaiFull.unpack(pack, FULL_DIR)).toThrow('完整模型包不完整')
    expect(h.files.deleted).toContain(`${FULL_DIR}/full.param.part`)
    expect(h.files.deleted).toContain(`${FULL_DIR}/full.bin.part`)
    expect(h.files.deleted).toContain(`${FULL_DIR}/full.onnx.part`)
  })

  it('unpack：目录条目 / 缺失必需条目 → 「完整模型包无效」/「完整模型校验失败」', () => {
    const h = makeHarness()
    const pack = '/files/pack.zip'
    h.files.zips.set(pack, [
      { name: 'full.param', isDirectory: true, bytes: new Uint8Array(0) },
    ])
    expect(() => MangaJaNaiFull.unpack(pack, FULL_DIR)).toThrow('完整模型包无效')

    // Kotlin L117 把「条目齐全」和三份 SHA-256 放在同一个 `||` 链里 → 缺失条目也算校验失败
    h.files.zips.set(pack, [
      { name: 'manifest.json', isDirectory: false, bytes: new Uint8Array(2) },
    ])
    expect(() => MangaJaNaiFull.unpack(pack, FULL_DIR)).toThrow('完整模型校验失败')
    expect(h.files.exists(`${FULL_DIR}/manifest.json.part`)).toBe(false)
  })

  it('verifyNative：param/bin 缺失或长度不符 → false（GPU 因此不会被尝试）', () => {
    const h = makeHarness()
    expect(MangaJaNaiFull.verifyNative(FULL_DIR)).toBe(false)
    h.files.put(`${FULL_DIR}/full.param`, new Uint8Array(2))
    h.files.put(`${FULL_DIR}/full.bin`, new Uint8Array(2))
    expect(MangaJaNaiFull.verifyNative(FULL_DIR)).toBe(false)
    h.files.put(`${FULL_DIR}/full.param`, new Uint8Array(MANGA_JANAI_FULL_PARAM_BYTES))
    expect(MangaJaNaiFull.verifyNative(FULL_DIR)).toBe(false)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 9. GPU / CPU 回退（MangaJaNaiFullRuntime）
 * ══════════════════════════════════════════════════════════════════════════════ */

interface GpuHarness {
  readonly runtime: MangaJaNaiFullRuntime
  readonly created: MangaJaNaiSessionOptions[]
  readonly prefs: FakePrefs
  readonly log: FakeLog
  readonly calls: { run: number; save: number; destroy: number }
}

interface GpuHarnessOptions {
  readonly gpu: 'none' | 'ok' | 'inaccurate' | 'run-fails'
  readonly verifyNative: boolean
  readonly savedGpu?: boolean
  readonly deviceKeyMatches?: boolean
  readonly cpuCostMs?: number
  readonly gpuCostMs?: number
}

function makeGpuHarness(options: GpuHarnessOptions): GpuHarness {
  const clock = new FakeClock()
  const prefsFactory = new FakePrefsFactory()
  const log = new FakeLog()
  const files = new FakeFiles()
  const scheduler = new FakeScheduler(clock)
  const created: MangaJaNaiSessionOptions[] = []
  const calls = { run: 0, save: 0, destroy: 0 }
  const cpuCost = options.cpuCostMs ?? 4
  const gpuCost = options.gpuCostMs ?? 1
  const factory: MangaJaNaiSessionFactory = {
    create: (sessionOptions) => {
      created.push(sessionOptions)
      return {
        run: (input, output) => {
          clock.advanceMs(cpuCost)
          nearest2x(input, output, sessionOptions.side)
        },
        close: () => undefined,
      }
    },
    availableProviders: () => ['CPU'],
  }
  const gpu: MangaJaNaiGpuPort | null =
    options.gpu === 'none'
      ? null
      : {
          create: (param, weights, cache) => {
            expect(param).toBe('/files/mangajanai/full/full.param')
            expect(weights).toBe('/files/mangajanai/full/full.bin')
            expect(cache).toBe('/cache/mangajanai-full-34.vkcache')
            return 7
          },
          run: (handle, input, output, side) => {
            expect(handle).toBe(7)
            calls.run += 1
            if (options.gpu === 'run-fails') throw new MangaJaNaiIoError('vulkan lost')
            clock.advanceMs(gpuCost)
            nearest2x(input, output, side)
            if (options.gpu === 'inaccurate') output[0] = (output[0] ?? 0) + 1
          },
          save: () => {
            calls.save += 1
          },
          destroy: () => {
            calls.destroy += 1
          },
        }
  const runtime = new MangaJaNaiFullRuntime({
    device: {
      availableProcessors: 8,
      maxMemoryBytes: 512 * 1024 * 1024,
      fingerprint: 'TEST-FINGERPRINT',
      sdkInt: 34,
    },
    prefs: (name: string) => prefsFactory.call(name),
    scheduler,
    sessions: factory,
    gpu,
    files,
    now: clock.now,
    isCancelled: () => false,
    log,
    verifyNative: () => options.verifyNative,
    modelSha256: MANGA_JANAI_FULL_SHA256,
  })
  const prefs = prefsFactory.get(MANGA_JANAI_FULL_RUNTIME_PREFS)
  if (options.savedGpu !== undefined) {
    prefs.putBoolean('gpu', options.savedGpu)
    prefs.putString(
      'device',
      options.deviceKeyMatches === false
        ? `${MANGA_JANAI_FULL_KEY_PREFIX}:OTHER:sha`
        : runtime.deviceKey,
    )
  }
  return { runtime, created, prefs, log, calls }
}

describe('GPU/CPU 回退（full runtime）', () => {
  const PROBE_SIDE = MANGA_JANAI_FULL_TILE_BIG + MANGA_JANAI_FULL_PROBE_PAD

  it('无 GPU 端口（Web）→ warn 后用 FP32 CPU，tile 保持 48，绝不返回原图', () => {
    const h = makeGpuHarness({ gpu: 'none', verifyNative: true })
    h.runtime.prepare('/files/mangajanai/full', new Float32Array(PROBE_SIDE * PROBE_SIDE * 3))
    expect(h.runtime.name).toBe(MANGA_JANAI_FULL_NAME_CPU)
    expect(h.runtime.tile).toBe(MANGA_JANAI_FULL_TILE_DEFAULT)
    expect(h.prefs.getBoolean('gpu', true)).toBe(false)
    expect(h.prefs.getString('device')).toBe(h.runtime.deviceKey)
    expect(h.log.has('GPU unavailable; using original FP32 CPU model')).toBe(true)
    expect(h.created[h.created.length - 1]!.side).toBe(MANGA_JANAI_FULL_CPU_SIDE)
  })

  it('verifyNative=false → 完全不碰 GPU（CPU side=80 直接返回）', () => {
    const h = makeGpuHarness({ gpu: 'ok', verifyNative: false })
    h.runtime.prepare('/files/mangajanai/full', new Float32Array(4 * 3))
    expect(h.created.length).toBe(1)
    expect(h.created[0]!.side).toBe(MANGA_JANAI_FULL_CPU_SIDE)
    expect(h.created[0]!.configEntries).toContainEqual(['session.dynamic_block_base', '4'])
    expect(h.runtime.tile).toBe(MANGA_JANAI_FULL_TILE_DEFAULT)
    expect(h.calls.run).toBe(0)
  })

  it('缓存 gpu=true 且 device 匹配 → 直接开 GPU 并选大切片（零 CPU 会话）', () => {
    const h = makeGpuHarness({ gpu: 'ok', verifyNative: true, savedGpu: true })
    h.runtime.prepare('/files/mangajanai/full', new Float32Array(4 * 3))
    expect(h.created.length).toBe(0)
    expect(h.runtime.name).toBe(MANGA_JANAI_FULL_NAME_GPU)
    expect(h.runtime.tile).toBe(MANGA_JANAI_FULL_TILE_BIG)
  })

  it('缓存 gpu=true 但 device 键不匹配 → 走探针路径（不直接信任）', () => {
    const h = makeGpuHarness({
      gpu: 'ok',
      verifyNative: true,
      savedGpu: true,
      deviceKeyMatches: false,
    })
    h.runtime.prepare('/files/mangajanai/full', new Float32Array(PROBE_SIDE * PROBE_SIDE * 3))
    expect(h.created.length).toBeGreaterThanOrEqual(1)
    expect(h.created[0]!.side).toBe(PROBE_SIDE)
    expect(h.calls.save).toBe(1)
  })

  it('探针输出不准（>0.0015）→ 拒绝 GPU，CPU 兜底', () => {
    const h = makeGpuHarness({ gpu: 'inaccurate', verifyNative: true })
    h.runtime.prepare('/files/mangajanai/full', new Float32Array(PROBE_SIDE * PROBE_SIDE * 3))
    expect(h.calls.save).toBe(0)
    expect(h.calls.destroy).toBe(1)
    expect(h.runtime.name).toBe(MANGA_JANAI_FULL_NAME_CPU)
    expect(h.prefs.getBoolean('gpu', true)).toBe(false)
    expect(h.log.has('accurate=false')).toBe(true)
  })

  it('探针更慢（gpuNs >= cpuNs*0.85）→ 拒绝 GPU', () => {
    const h = makeGpuHarness({
      gpu: 'ok',
      verifyNative: true,
      cpuCostMs: 4,
      gpuCostMs: 10,
    })
    h.runtime.prepare('/files/mangajanai/full', new Float32Array(PROBE_SIDE * PROBE_SIDE * 3))
    expect(h.calls.save).toBe(0)
    expect(h.runtime.name).toBe(MANGA_JANAI_FULL_NAME_CPU)
    expect(h.prefs.getBoolean('gpu', true)).toBe(false)
  })

  it('探针又快又准 → save() 并切到大切片', () => {
    const h = makeGpuHarness({ gpu: 'ok', verifyNative: true })
    h.runtime.prepare('/files/mangajanai/full', new Float32Array(PROBE_SIDE * PROBE_SIDE * 3))
    expect(h.calls.save).toBe(1)
    expect(h.runtime.name).toBe(MANGA_JANAI_FULL_NAME_GPU)
    expect(h.runtime.tile).toBe(MANGA_JANAI_FULL_TILE_BIG)
    expect(h.prefs.getBoolean('gpu', false)).toBe(true)
    expect(h.log.has('accurate=true')).toBe(true)
  })

  it('运行期 GPU IOException → destroy + gpu=false，并用 CPU 重跑同一片', () => {
    const h = makeGpuHarness({ gpu: 'run-fails', verifyNative: true, savedGpu: true })
    h.runtime.prepare('/files/mangajanai/full', new Float32Array(4 * 3))
    expect(h.runtime.name).toBe(MANGA_JANAI_FULL_NAME_GPU)
    const side = MANGA_JANAI_FULL_CPU_SIDE
    h.runtime.run(
      '/files/mangajanai/full',
      new Float32Array(side * side * 3),
      new Float32Array(side * side * 12),
      side,
    )
    expect(h.runtime.name).toBe(MANGA_JANAI_FULL_NAME_CPU)
    expect(h.calls.destroy).toBe(1)
    expect(h.prefs.getBoolean('gpu', true)).toBe(false)
    expect(h.created.some((session) => session.side === side)).toBe(true)
    expect(h.log.has('GPU failed; retrying exact tile on CPU')).toBe(true)
  })

  it('close()：销毁句柄并把 tile 归位到 48', () => {
    const h = makeGpuHarness({ gpu: 'ok', verifyNative: true, savedGpu: true })
    h.runtime.prepare('/files/mangajanai/full', new Float32Array(4 * 3))
    expect(h.runtime.tile).toBe(MANGA_JANAI_FULL_TILE_BIG)
    h.runtime.close()
    expect(h.calls.destroy).toBe(1)
    expect(h.runtime.tile).toBe(MANGA_JANAI_FULL_TILE_DEFAULT)
    expect(h.runtime.name).toBe(MANGA_JANAI_FULL_NAME_CPU)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 10. 完整档 enhance 全量管线
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('完整档 enhance 管线', () => {
  it('原始分辨率切片（48+2×16=80）、像素级混合、拼接后是 2× 最近邻', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNaiFull, 'model').mockReturnValue('/files/mangajanai/full')
    const src = gradient(100, 80)
    const out = MangaJaNaiFull.enhance(src, 1)
    expect(out.width).toBe(200)
    expect(out.height).toBe(160)
    for (let y = 0; y < 160; y += 1) {
      for (let x = 0; x < 200; x += 1) {
        expect(out.data[y * 200 + x]).toBe(src.data[Math.trunc(y / 2) * 100 + Math.trunc(x / 2)])
      }
    }
    expect(h.sessions.created[0]!.side).toBe(MANGA_JANAI_FULL_CPU_SIDE)
    expect(h.log.has('core=48 tiles=6 inferred=6')).toBe(true)
  })

  it('strength=0 → 输出 == 原图（混合系数 0）', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNaiFull, 'model').mockReturnValue('/files/mangajanai/full')
    const src = gradient(60, 40)
    const out = MangaJaNaiFull.enhance(src, 0)
    expect(out.width).toBe(120)
    expect(out.height).toBe(80)
    for (let y = 0; y < 80; y += 1) {
      for (let x = 0; x < 120; x += 1) {
        expect(out.data[y * 120 + x]).toBe(src.data[Math.trunc(y / 2) * 60 + Math.trunc(x / 2)])
      }
    }
    expect(h.log.has('inferred=')).toBe(true)
  })

  it('网络输出 NaN → 「完整增强输出无效」并上报「完整增强失败，点击重试」', () => {
    makeHarness({
      behave: (input, output, side) => {
        nearest2x(input, output, side)
        output.fill(Number.NaN)
      },
    })
    vi.spyOn(MangaJaNaiFull, 'model').mockReturnValue('/files/mangajanai/full')
    expect(() => MangaJaNaiFull.enhance(gradient(60, 40), 1)).toThrow('完整增强输出无效')
    expect(MangaJaNaiFull.status).toBe('完整增强失败，点击重试')
  })

  it('会话装不上（LinkageError）→ 「当前设备无法加载完整增强」', () => {
    const h = makeHarness()
    h.sessions.create = () => {
      throw new MangaJaNaiLinkageError('loadLibrary failed')
    }
    vi.spyOn(MangaJaNaiFull, 'model').mockReturnValue('/files/mangajanai/full')
    expect(() => MangaJaNaiFull.enhance(gradient(20, 20), 1)).toThrow('当前设备无法加载完整增强')
  })

  it('取消 → 不写失败文案（Kotlin L223 的 if (error is Interrupted) "" 分支）', () => {
    const h = makeHarness({
      behave: (input, output, side, index) => {
        if (index >= 4) h.cancelled()
        nearest2x(input, output, side)
      },
    })
    vi.spyOn(MangaJaNaiFull, 'model').mockReturnValue('/files/mangajanai/full')
    expect(() => MangaJaNaiFull.enhance(gradient(100, 80), 1)).toThrow(MangaJaNaiCancelledError)
    expect(MangaJaNaiFull.status).toBe('')
  })

  it('相同切片只推理一次，且第二次调用仍命中缓存（cacheCore 未变）', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNaiFull, 'model').mockReturnValue('/files/mangajanai/full')
    const src = uniform(100, 80)
    MangaJaNaiFull.enhance(src, 1)
    expect(inferCount(h.log)).toBe(1)
    MangaJaNaiFull.enhance(src, 1)
    const last = [...h.log.entries].reverse().find((entry) => entry.message.includes('inferred='))
    expect(last!.message).toContain('inferred=0')
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 11. 错误传播与内存清理（mobile）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('错误传播（mobile）', () => {
  it('OOM → 关闭会话 + 「内存不足 · 已保留原图」/「增强内存不足」', () => {
    const h = makeHarness({
      behave: (input, output, side, index) => {
        if (index >= 4) throw new MangaJaNaiOutOfMemoryError('bitmap alloc failed')
        nearest2x(input, output, side)
      },
    })
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    expect(() => MangaJaNai.enhance(gradient(300, 200), 1)).toThrow('增强内存不足')
    expect(MangaJaNai.status).toBe('内存不足 · 已保留原图')
    expect(h.sessions.closed).toBeGreaterThan(0)
  })

  it('LinkageError → 「增强不可用 · 已保留原图」/「当前设备无法加载增强引擎」', () => {
    const h = makeHarness()
    h.sessions.create = () => {
      throw new MangaJaNaiLinkageError('no libonnxruntime')
    }
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    expect(() => MangaJaNai.enhance(gradient(20, 20), 1)).toThrow('当前设备无法加载增强引擎')
    expect(MangaJaNai.status).toBe('增强不可用 · 已保留原图')
  })

  it('普通会话错误 → 「增强失败 · 已保留原图」并原样抛出', () => {
    makeHarness({
      behave: (input, output, side, index) => {
        if (index >= 4) throw new TypeError('bad tensor')
        nearest2x(input, output, side)
      },
    })
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    expect(() => MangaJaNai.enhance(gradient(300, 200), 1)).toThrow(TypeError)
    expect(MangaJaNai.status).toBe('增强失败 · 已保留原图')
  })

  it('内存压力回调：TRIM_MEMORY_RUNNING_MODERATE(5) 不释放，RUNNING_LOW(10) 释放', () => {
    const h = makeHarness()
    vi.spyOn(MangaJaNai, 'model').mockReturnValue('/files/x.onnx')
    MangaJaNai.enhance(gradient(20, 20), 1)
    const closedBefore = h.sessions.closed
    h.memory.fireTrim(5)
    expect(h.sessions.closed).toBe(closedBefore)
    h.memory.fireTrim(10)
    expect(h.sessions.closed).toBeGreaterThan(closedBefore)
  })
})

/* ══════════════════════════════════════════════════════════════════════════════
 * 12. 既有部分实现的回归（combine / band 缩放）
 * ══════════════════════════════════════════════════════════════════════════════ */

describe('combineMangaJaNaiDetail（MangaJaNaiMobile.kt L28-74）', () => {
  it('strength<=0 时只做原图缩放', () => {
    const src = gradient(10, 6)
    const neural = makeImage(10, 6, () => 0xff000000)
    const neuralOut = makeImage(20, 12, () => 0xff000000)
    const out = combineMangaJaNaiDetail(src, neural, neuralOut, 20, 12, 0)
    expect(out.width).toBe(20)
    expect(out.height).toBe(12)
    expect(out.data[0]).toBe(src.data[0])
  })

  it('输入/输出尺寸不等时按双线性缩放叠加（不是恒等近似）', () => {
    const src = makeImage(10, 6, (x, y) => 0xff000000 | ((x * 20) << 16) | ((y * 30) << 8))
    const neuralIn = makeImage(5, 3, () => 0xff000000)
    const neuralOut = makeImage(10, 6, (x, y) => 0xff000000 | ((x * 20) << 16) | ((y * 30) << 8))
    const out = combineMangaJaNaiDetail(src, neuralIn, neuralOut, 20, 12, 1)
    for (let i = 0; i < out.data.length; i += 1) {
      expect(out.data[i]! >>> 24).toBe(0xff)
    }
    expect(out.data[6 * 20 + 10]).not.toBe(src.data[3 * 10 + 5])
  })

  it('取消缝：自定义错误工厂 + 自定义判定', () => {
    const src = gradient(10, 6)
    const neural = makeImage(10, 6, () => 0xff000000)
    const neuralOut = makeImage(20, 12, () => 0xff000000)
    class Boom extends Error {}
    expect(() =>
      combineMangaJaNaiDetail(src, neural, neuralOut, 20, 12, 1, () => true, () => new Boom('x')),
    ).toThrow(Boom)
  })
})
