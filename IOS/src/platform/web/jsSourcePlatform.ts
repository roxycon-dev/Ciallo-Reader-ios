/**
 * JS 书源引擎的平台适配器 — 实现 `src/core/source/js/jsPlatform.ts` 声明的端口。
 *
 * **2026-10-11（SECURITY_AUDIT P0-1 ~ P0-4 / P1-2）改动说明**：
 * - `createWebJsRuntime` 重写：inline `new Function` 同 realm 路径**整体移除**；
 *   `evaluate` 改 async 并一律走真 Worker 沙箱（`jsSandboxBody.ts` 自包含体，
 *   Blob Worker / node:vm 测试传输共用），宿主不可用时**显式抛错**（P0-1 修法 6）。
 * - `registerFunction` / `registerAsyncFunction` 从 no-op 改为真绑定（P0-3）：
 *   宿主侧注册表 + 沙箱内全局 RPC 桩，主线程按到达顺序串行执行（保序）。
 * - 45s 预算：沙箱内 `__cialloTick` 墙钟检查（对齐 Kotlin `checkBudget`，
 *   JsSourceEngine.kt:36-39），主线程看门狗兜插桩管不到的原生悬挂（P0-4）。
 * - 30 MiB / 512 KiB（P1-2）：结果编码长度硬上限 + `performance.memory` 软监控，
 *   近似程度见 jsSandboxBody.ts 文件头。
 * - 新增 `armExecution(signal)`（Kotlin `beginBudget` 的 Job→checkBudget 半边）。
 *
 * Android 侧对应物：
 *  - `com.dokar.quickjs.QuickJs`（JsRuntime）
 *  - `Context.getSharedPreferences`（KeyValueStorage）
 *  - `Context.filesDir/cacheDir/assets` + `java.io.File`（FileStoragePort）
 *  - Cronet / OkHttp（HttpClient）
 *  - `android.graphics.Bitmap` / `BitmapFactory`（Bitmap、ImageProbe）
 *  - `MessageDigest` / `Mac` / `Cipher` / `RSA`（CryptoPort）
 *  - `android.webkit.WebView` + `CookieManager`（WebViewFactory）
 *  - `org.jsoup.Jsoup`（HtmlDomParser）
 *
 * 这些实现**不属于** `src/core`（core 不许依赖 DOM/Capacitor），
 * 所以住在 platform 层，与其它平台能力同一处。
 */
import {
  type Bitmap as BitmapShape,
  type BrowserCookiePort,
  type CryptoPort,
  type CancellationSignal,
  type FileStoragePort,
  type HtmlDomNode,
  type HtmlDomParser,
  type HttpClient as JsHttpClient,
  type HttpRequestSpec,
  type HttpResponseSpec,
  JsSandboxResetError,
  type JsRuntime,
  type KeyValueStorage,
  type MonotonicClock,
  type SystemProxyResolverPort,
  type WallClock,
  type WebViewFactory,
} from '@core/source/js/jsPlatform';
import { aesDecrypt } from '@core/crypto/aes';
// SECURITY_AUDIT P0-1~P0-4 / P1-2：自包含沙箱体（真 Worker 与 node:vm 测试传输共用）。
import { SANDBOX_BODY, SANDBOX_BUDGET_MESSAGE } from './jsSandboxBody';
// E38/E42：主机 WebView（隐藏 iframe + 引导页桥接，详见 webViewFactory.ts 头注）。
import { createDocumentCookiePort, createFrameWebViewFactory } from './webViewFactory';

/* ══════════════ 时钟（System.currentTimeMillis / SystemClock.elapsedRealtime） ══════════════ */

export const wallClock: WallClock = () => Date.now();

export const monotonicClock: MonotonicClock = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/* ══════════════ KeyValueStorage（SharedPreferences） ══════════════ */

/**
 * SharedPreferences 适配：Android 是内存 Map + 异步落盘。
 * 这里用 localStorage（同步）+ 内存缓存，读路径零 await。
 * 损坏数据回落空表（与 Android 反序列化失败回落默认值同语义）。
 */
export function createWebKeyValueStorage(namespace = 'js_source_prefs'): KeyValueStorage {
  const cache = new Map<string, string>();
  let loaded = false;

  const load = (): void => {
    if (loaded) return;
    loaded = true;
    try {
      const raw = window.localStorage.getItem(namespace);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') cache.set(key, value);
      }
    } catch {
      // 损坏 / 不可读 → 空表（Android SharedPreferences 亦不因此崩）
    }
  };

  const flush = (): void => {
    try {
      window.localStorage.setItem(
        namespace,
        JSON.stringify(Object.fromEntries(cache.entries())),
      );
    } catch {
      // Android commit() 返回 false 而不抛；这里同样吞掉
    }
  };

  return {
    getString: (key) => {
      load();
      return cache.get(key) ?? null;
    },
    getBoolean: (key, fallback) => {
      load();
      const value = cache.get(key);
      return value === undefined ? fallback : value === 'true';
    },
    getInt: (key, fallback) => {
      load();
      const value = cache.get(key);
      if (value === undefined) return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    putString: (key, value) => {
      load();
      cache.set(key, value);
      flush();
    },
    putBoolean: (key, value) => {
      load();
      cache.set(key, String(value));
      flush();
    },
    putInt: (key, value) => {
      load();
      cache.set(key, String(value));
      flush();
    },
    remove: (key) => {
      load();
      cache.delete(key);
      flush();
    },
    clear: () => {
      loaded = true;
      cache.clear();
      flush();
    },
  };
}

/* ══════════════ FileStoragePort（filesDir / cacheDir / assets） ══════════════ */

export interface WebFileStorageOptions {
  filesDir?: string;
  cacheDir?: string;
  /** `context.assets.open(path)` 的读取器（APK 内置资源）。 */
  readAsset?: (path: string) => string | null;
}

/**
 * 存储后端用 localStorage（脚本缓存都是小文本 / 小字节）。
 * 路径即 key；`filesDir()` / `cacheDir()` 返回带前缀的虚拟目录，
 * 让调用方的路径拼接语义与 Android 完全一致。
 */
export function createWebFileStorage(options: WebFileStorageOptions = {}): FileStoragePort {
  const filesDir = options.filesDir ?? 'files';
  const cacheDir = options.cacheDir ?? 'cache';
  const NS = 'js_source_files';
  const store = new Map<string, string>();

  const load = (): void => {
    try {
      const raw = window.localStorage.getItem(NS);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string') store.set(k, v);
        }
      }
    } catch {
      /* 损坏 → 空表 */
    }
  };
  load();

  const flush = (): void => {
    try {
      window.localStorage.setItem(NS, JSON.stringify(Object.fromEntries(store.entries())));
    } catch {
      /* 配额失败：与 Android 写失败同样不抛 */
    }
  };

  return {
    filesDir: () => filesDir,
    cacheDir: () => cacheDir,
    exists: (path) => store.has(path),
    readText: (path) => store.get(path) ?? null,
    writeText: (path, content) => {
      store.set(path, content);
      flush();
    },
    readBytes: (path) => {
      const text = store.get(path);
      return text === undefined ? null : unb64(text);
    },
    writeBytes: (path, content) => {
      store.set(path, b64(content));
      flush();
    },
    delete: (path) => {
      store.delete(path);
      flush();
    },
    mkdirs: () => {
      // localStorage 无目录概念；调用方的 mkdirs 变成 no-op
    },
    length: (path) => {
      const text = store.get(path);
      return text === undefined ? 0 : text.length;
    },
    toFileUrl: (path) => `file://${path}`,
    readAsset: (path) => options.readAsset?.(path) ?? null,
    listFiles: (dir) => {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

/** base64 编码（写入 / 读出对称）。 */
export function b64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 解码。 */
export function unb64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/* ══════════════ HttpClient（Cronet / OkHttp） ══════════════ */

export interface FetchJsHttpClientOptions {
  baseHeaders?: Record<string, string>;
}

/** 浏览器 fetch 适配：共用 per-origin 连接池，比手搓连接更省。 */
export function createFetchJsHttpClient(options: FetchJsHttpClientOptions = {}): JsHttpClient {
  return {
    async execute(request: HttpRequestSpec): Promise<HttpResponseSpec> {
      const controller = new AbortController();
      const callMs = request.timeouts?.callMs ?? 0;
      const timer = callMs > 0 ? setTimeout(() => controller.abort(), callMs) : null;
      const abortOuter = (): void => controller.abort();
      if (request.signal !== undefined && request.signal !== null) {
        request.signal.addEventListener('abort', abortOuter);
      }
      try {
        const headers: Record<string, string> = {
          ...(options.baseHeaders ?? {}),
          ...request.headers,
        };
        // Kotlin `response.headers("Set-Cookie")` 返回全部出现次数
        const setCookies: string[] = [];
        const raw = (globalThis as { __cialloRawSetCookie?: string[] }).__cialloRawSetCookie;
        if (raw !== undefined) {
          setCookies.push(...raw);
          (globalThis as { __cialloRawSetCookie?: string[] }).__cialloRawSetCookie = [];
        }
        const response = await fetch(request.url, {
          method: request.method,
          headers,
          ...(request.hasBody === true && request.body != null
            ? { body: request.body as unknown as BodyInit }
            : {}),
          signal: controller.signal,
        });
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });
        // getSetCookie 是标准接口（取全部 Set-Cookie）
        const getter = (response.headers as unknown as { getSetCookie?: () => string[] })
          .getSetCookie;
        if (typeof getter === 'function') {
          setCookies.push(...getter.call(response.headers));
        }
        const body = new Uint8Array(await response.arrayBuffer());
        return {
          status: response.status,
          finalUrl: response.url || request.url,
          headers: responseHeaders,
          setCookies,
          body,
        };
      } finally {
        if (timer !== null) clearTimeout(timer);
        if (request.signal !== undefined && request.signal !== null) {
          request.signal.removeEventListener('abort', abortOuter);
        }
      }
    },
  };
}

/** iOS 无系统代理注入点 → 永远直连。 */
export const noSystemProxy: SystemProxyResolverPort = {
  resolve: () => null,
};

/* ══════════════ JsRuntime（真 Worker 沙箱，SECURITY_AUDIT P0-1~P0-4 / P1-2，2026-10-11） ══════════════ */

/** Kotlin `memoryLimit = 32MiB`；书源侧按 30 MiB 上限使用。 */
export const JS_RUNTIME_MEMORY_MB = 30;
export const JS_RUNTIME_MEMORY_LIMIT = JS_RUNTIME_MEMORY_MB * 1024 * 1024;
export const JS_RUNTIME_MAX_STACK = 512 * 1024;
/** Q8 已批准：45 秒硬预算。 */
export const JS_RUNTIME_BUDGET_MS = 45_000;
export const JS_RUNTIME_TICK_NAME = '__cialloTick';

/**
 * 主线程看门狗在预算之后再等的宽限：沙箱内的 `__cialloTick` 按墙钟在
 * `budgetMs` 处打断（对齐 Kotlin `checkBudget`），看门狗只兜**插桩管不到**的
 * 原生悬挂（灾难性正则回溯、超大 `JSON.parse`）—— 那时要终止并重建沙箱。
 */
const WATCHDOG_SLACK_MS = 1_000;

export interface JsRuntimeLimits {
  budgetMs: number;
  memoryLimit: number;
  maxStackSize: number;
  /**
   * 沙箱传输工厂（测试注入 `node:vm` 传输用）。未注入时用 Blob Worker。
   * 工厂返回 null = 宿主不支持沙箱 → `createWebJsRuntime` **显式抛错**
   * （SECURITY_AUDIT P0-1 修法 6：不再静默回落同 realm 的 inline 执行）。
   */
  createSandbox?: () => JsSandboxTransport | null;
}

/* ---- 沙箱消息协议（host ↔ sandbox） ---- */

/** 完成值信封（可结构化克隆）。 */
export interface SandboxValueBox {
  t: 'undefined' | 'null' | 'number' | 'boolean' | 'string' | 'json';
  v?: unknown;
}

/** host → sandbox。 */
export type SandboxRequest =
  | { readonly op: 'register'; readonly name: string }
  | { readonly op: 'abort' }
  | {
      readonly op: 'eval';
      readonly id: number;
      readonly code: string;
      readonly budgetMs: number;
      readonly memoryLimit: number;
      readonly maxStackSize: number;
    }
  | {
      readonly op: 'callResult';
      readonly rid: number;
      readonly ok: boolean;
      readonly value?: unknown;
      readonly message?: string;
      readonly errorName?: string;
    };

/** sandbox → host。 */
export type SandboxResponse =
  | {
      readonly op: 'result';
      readonly id: number;
      readonly ok: boolean;
      readonly over?: boolean;
      readonly value?: SandboxValueBox;
      readonly message?: string;
      readonly errorName?: string;
    }
  | { readonly op: 'call'; readonly rid: number; readonly name: string; readonly args: unknown[] };

/**
 * 沙箱传输抽象：真 Worker 与测试用的 `node:vm` 传输共用同一协议。
 * `postMessage` = host → sandbox；`setMessageHandler` = sandbox → host。
 */
export interface JsSandboxTransport {
  postMessage(message: SandboxRequest): void;
  setMessageHandler(handler: ((message: SandboxResponse) => void) | null): void;
  setErrorHandler(handler: ((message: string) => void) | null): void;
  terminate(): void;
}

export type JsSandboxFactory = () => JsSandboxTransport | null;

/** 生产工厂：自包含沙箱体（jsSandboxBody.ts）装入 Blob Worker。 */
export function createBlobSandboxTransport(): JsSandboxTransport | null {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return null;
  try {
    const blob = new Blob([SANDBOX_BODY], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return {
      postMessage: (message) => {
        worker.postMessage(message);
      },
      setMessageHandler: (handler) => {
        worker.onmessage = handler === null ? null : (event: MessageEvent): void => handler(event.data as SandboxResponse);
      },
      setErrorHandler: (handler) => {
        worker.onerror = handler === null ? null : (event: ErrorEvent): void => handler(event.message || 'JS 沙箱发生未捕获错误');
      },
      terminate: () => {
        worker.terminate();
      },
    };
  } catch {
    return null;
  }
}

export interface WebJsRuntime extends JsRuntime {
  /** 恒为 `'worker'`：inline 同 realm 路径已移除（P0-1），沙箱不可用直接抛错。 */
  readonly isolationLevel: 'worker';
  /**
   * 异步求值（真隔离）。与 `evaluate` 等价 —— Q8 时代的名字保留为别名，
   * 现在生产路径只有这一条（2026-10-11 之前它是 0 调用点的死代码）。
   */
  evaluateInWorker(code: string, filename?: string): Promise<string | null>;
  guardHits(): number;
  remainingBudgetMs(nowMs: number): number;
  dispose(): void;
}

interface PendingEval {
  readonly resolve: (value: string | null) => void;
  readonly reject: (error: Error) => void;
  readonly watchdog: ReturnType<typeof setTimeout> | null;
}

/**
 * 隔离等级（**如实标注**）：
 *  - 求值一律走独立沙箱 realm（Blob Worker 线程；测试用 node:vm context），
 *    书源代码触不到主线程的 `document` / `localStorage` / DOM / App 状态。
 *  - 45s 预算：沙箱内 `__cialloTick` 按墙钟检查（对齐 Kotlin `checkBudget`，
 *    JsSourceEngine.kt:36-39），instrument.js 把 tick 插桩进每个循环/函数/catch；
 *    主线程看门狗兜插桩管不到的原生悬挂（终止并重建沙箱，`JsSandboxResetError`）。
 *  - Kotlin `quickJs.evaluate` 是同步 API —— 本端 `evaluate` 因此是 async，
 *    同步求值入口不复存在（E33/E40 的结构性偏差）。
 *
 * ⚠️ 这条差异登记在 `docs/PARITY_EXCEPTIONS.md`（书源脚本沙箱隔离）。
 */
export function createWebJsRuntime(limits: Partial<JsRuntimeLimits> = {}): WebJsRuntime {
  const budgetMs = limits.budgetMs ?? JS_RUNTIME_BUDGET_MS;
  const memoryLimit = limits.memoryLimit ?? JS_RUNTIME_MEMORY_LIMIT;
  const maxStackSize = limits.maxStackSize ?? JS_RUNTIME_MAX_STACK;
  const createSandbox = limits.createSandbox ?? createBlobSandboxTransport;

  // P0-1 修法 6：能力探测 —— 沙箱不可用就显式失败，绝不静默回落 inline。
  let sandbox: JsSandboxTransport | null = createSandbox();
  if (sandbox === null) {
    throw new Error('JS 书源运行时不可用：当前宿主不支持 Worker 沙箱（inline 同 realm 回退已按 SECURITY_AUDIT P0-1 移除）');
  }

  let disposed = false;
  let hits = 0;
  let seq = 0;
  let startedAt: number | null = null;
  const mutex = createMutex();
  const bindings = new Map<string, (...args: unknown[]) => unknown>();
  const pendingEvals = new Map<number, PendingEval>();

  const cleanupPending = (entry: PendingEval): void => {
    if (entry.watchdog !== null) clearTimeout(entry.watchdog);
  };

  const failAllPending = (error: Error): void => {
    for (const [, entry] of pendingEvals) {
      cleanupPending(entry);
      entry.reject(error);
    }
    pendingEvals.clear();
  };

  const terminateSandbox = (): void => {
    if (sandbox === null) return;
    sandbox.setMessageHandler(null);
    sandbox.setErrorHandler(null);
    sandbox.terminate();
    sandbox = null;
  };

  const ensureSandbox = (): JsSandboxTransport => {
    if (sandbox !== null) return sandbox;
    // 看门狗终止后的惰性重建：重新注册全部绑定名（realm 状态本身由引擎侧
    // 捕获 `JsSandboxResetError` 后走重新初始化）。
    const fresh = createSandbox();
    if (fresh === null) throw new Error('JS 书源沙箱重建失败：宿主不再支持 Worker');
    fresh.setMessageHandler(handleSandboxMessage);
    fresh.setErrorHandler(handleSandboxError);
    for (const name of bindings.keys()) fresh.postMessage({ op: 'register', name });
    sandbox = fresh;
    return fresh;
  };

  const handleSandboxError = (message: string): void => {
    failAllPending(new JsSandboxResetError(message));
  };

  const handleSandboxMessage = (message: SandboxResponse): void => {
    if (message.op === 'call') {
      queueHostCall(message);
      return;
    }
    const entry = pendingEvals.get(message.id);
    if (entry === undefined) return;
    pendingEvals.delete(message.id);
    cleanupPending(entry);
    if (message.over === true) hits += 1;
    if (message.ok !== true) {
      const error = new Error(message.message ?? '书源脚本执行失败');
      if (message.errorName !== undefined && message.errorName !== '') error.name = message.errorName;
      entry.reject(error);
      return;
    }
    const box = message.value;
    if (box === undefined || box.t === 'undefined' || box.t === 'null') {
      entry.resolve(null);
      return;
    }
    if (box.t === 'json') {
      // 归一化 JSON 文本（与旧 Worker 路径一致；引擎消费的完成值恒为字符串/null）。
      entry.resolve(JSON.stringify(JSON.parse(String(box.v))));
      return;
    }
    entry.resolve(String(box.v));
  };

  /**
   * 宿主函数调用按**严格串行**分发：沙箱内的同步序列（例如 `new HtmlDocument(html)`
   * 构造里的 parse 紧跟 `querySelector`）依赖先后顺序，主线程必须按到达顺序
   * 处理完一个再处理下一个 —— 对齐 Kotlin「单个 QuickJS context 同一时刻只跑
   * 一个绑定调用」的语义。
   */
  let callChain: Promise<void> = Promise.resolve();
  const queueHostCall = (message: Extract<SandboxResponse, { op: 'call' }>): void => {
    callChain = callChain.then(async () => {
      if (disposed) return;
      const binding = bindings.get(message.name);
      try {
        if (binding === undefined) throw new Error(`未注册的宿主函数：${message.name}`);
        const value = await binding(...message.args);
        if (disposed) return;
        sandbox?.postMessage({ op: 'callResult', rid: message.rid, ok: true, value });
      } catch (e) {
        if (disposed) return;
        const errorName = e instanceof Error && e.name !== 'Error' ? e.name : '';
        sandbox?.postMessage({
          op: 'callResult',
          rid: message.rid,
          ok: false,
          message: e instanceof Error ? e.message : String(e),
          ...(errorName !== '' ? { errorName } : {}),
        });
      }
    });
  };

  const evaluateInSandbox = (
    code: string,
    _filename: string,
  ): Promise<string | null> => {
    const sb = ensureSandbox();
    const id = ++seq;
    return new Promise<string | null>((resolve, reject) => {
      // 看门狗兜底：budgetMs 内沙箱 tick 自己会打断（realm 得以存活）；
      // 只有原生悬挂才会走到这里 —— 终止并重建，错误类型标记 realm 已重置。
      const watchdog = setTimeout(() => {
        pendingEvals.delete(id);
        hits += 1;
        terminateSandbox();
        reject(new JsSandboxResetError(SANDBOX_BUDGET_MESSAGE));
      }, budgetMs + WATCHDOG_SLACK_MS);
      pendingEvals.set(id, { resolve, reject, watchdog });
      sb.postMessage({ op: 'eval', id, code, budgetMs, memoryLimit, maxStackSize });
    });
  };

  // ---- armExecution（Kotlin beginBudget 的「Job 交给 checkBudget」半边） ----
  let armedSignal: CancellationSignal = null;
  const armedListener = (): void => {
    sandbox?.postMessage({ op: 'abort' });
  };

  // 初始沙箱也要挂上消息处理器（重建路径在 ensureSandbox 里挂）。
  sandbox.setMessageHandler(handleSandboxMessage);
  sandbox.setErrorHandler(handleSandboxError);

  return {
    memoryLimit,
    maxStackSize,
    get isolationLevel() {
      return 'worker' as const;
    },
    async acquire(): Promise<() => void> {
      return mutex.acquire();
    },
    registerFunction(name: string, fn: (...args: unknown[]) => unknown): void {
      bindings.set(name, fn);
      sandbox?.postMessage({ op: 'register', name });
    },
    registerAsyncFunction(name: string, fn: (...args: unknown[]) => Promise<unknown>): void {
      bindings.set(name, fn as unknown as (...args: unknown[]) => unknown);
      sandbox?.postMessage({ op: 'register', name });
    },
    armExecution(signal: CancellationSignal): void {
      if (armedSignal !== null) armedSignal.removeEventListener('abort', armedListener);
      armedSignal = signal;
      if (signal === null) return;
      signal.addEventListener('abort', armedListener, { once: true });
      if (signal.aborted) armedListener();
    },
    /** 异步求值（真隔离，生产唯一路径）。 */
    evaluate(code: string, filename = 'inline.js'): Promise<string | null> {
      if (disposed) return Promise.reject(new Error('JS 书源运行时已释放'));
      if (startedAt === null) startedAt = performance.now();
      return evaluateInSandbox(code, filename);
    },
    /** `evaluate` 的别名（Q8 时代的命名，见 WebJsRuntime 注释）。 */
    evaluateInWorker(code: string, filename = 'inline.js'): Promise<string | null> {
      return this.evaluate(code, filename);
    },
    gc(): void {
      /* Kotlin `runtime.gc()`：JS 无显式 GC；沙箱实例整体由 terminate 回收 */
    },
    guardHits: () => hits,
    remainingBudgetMs(nowMs: number): number {
      if (startedAt === null) return budgetMs;
      return Math.max(0, budgetMs - (nowMs - startedAt));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      failAllPending(new Error('JS 书源运行时已释放'));
      if (armedSignal !== null) armedSignal.removeEventListener('abort', armedListener);
      terminateSandbox();
      startedAt = null;
    },
  };
}

/**
 * 极简 FIFO 互斥（对齐 Kotlin `Mutex.withLock`）。
 * 每个等待者拿到一个 release 函数；调用它就把锁交给队首。
 */
function createMutex(): { acquire(): Promise<() => void> } {
  let locked = false;
  const waiters: Array<() => void> = [];

  const unlock = (): void => {
    const next = waiters.shift();
    if (next !== undefined) {
      next();
      return;
    }
    locked = false;
  };

  return {
    acquire(): Promise<() => void> {
      return new Promise<() => void>((resolve) => {
        const grant = (): void => {
          resolve(unlock);
        };
        if (!locked) {
          locked = true;
          grant();
          return;
        }
        waiters.push(grant);
      });
    },
  };
}

/* ══════════════ Bitmap（BitmapFactory / Canvas） ══════════════ */

const ARGB_CHANNELS = 4;

/** Canvas 支撑的 ARGB_8888 位图（对应 Android `Bitmap.Config.ARGB_8888`）。 */
class CanvasBitmap implements BitmapShape {
  readonly width: number;

  readonly height: number;

  private data: Uint8Array;

  constructor(
    width: number,
    height: number,
    data?: Uint8Array,
  ) {
    this.width = Math.max(0, Math.trunc(width));
    this.height = Math.max(0, Math.trunc(height));
    this.data =
      data ?? new Uint8Array(this.width * this.height * ARGB_CHANNELS);
  }

  get allocationByteCount(): number {
    return this.data.length;
  }

  getPixels(x: number, y: number, width: number, height: number): Uint8Array {
    const out = new Uint8Array(width * height * ARGB_CHANNELS);
    for (let row = 0; row < height; row += 1) {
      const sy = y + row;
      if (sy < 0 || sy >= this.height) continue;
      for (let col = 0; col < width; col += 1) {
        const sx = x + col;
        if (sx < 0 || sx >= this.width) continue;
        const src = (sy * this.width + sx) * ARGB_CHANNELS;
        const dst = (row * width + col) * ARGB_CHANNELS;
        out[dst] = this.data[src] as number;
        out[dst + 1] = this.data[src + 1] as number;
        out[dst + 2] = this.data[src + 2] as number;
        out[dst + 3] = this.data[src + 3] as number;
      }
    }
    return out;
  }

  createBitmap(width: number, height: number): BitmapShape {
    return new CanvasBitmap(width, height);
  }

  createBitmapFrom(
    src: BitmapShape,
    x: number,
    y: number,
    width: number,
    height: number,
  ): BitmapShape {
    return new CanvasBitmap(width, height, src.getPixels(x, y, width, height));
  }

  createRotated90(src: BitmapShape): BitmapShape {
    // Android `createBitmap(src, 0, 0, w, h, matrix(90f), true)`
    const w = src.height;
    const h = src.width;
    const out = new CanvasBitmap(w, h);
    for (let row = 0; row < h; row += 1) {
      for (let col = 0; col < w; col += 1) {
        // 顺时针 90°：(x,y) → (h-1-y, x)
        const px = src.getPixels(col, row, 1, 1);
        const dstX = h - 1 - row;
        const dstY = col;
        const dst = (dstY * w + dstX) * ARGB_CHANNELS;
        out.data[dst] = px[0] as number;
        out.data[dst + 1] = px[1] as number;
        out.data[dst + 2] = px[2] as number;
        out.data[dst + 3] = px[3] as number;
      }
    }
    return out;
  }

  drawBitmap(dst: BitmapShape, src: BitmapShape, x: number, y: number): void {
    if (!(dst instanceof CanvasBitmap)) return;
    for (let row = 0; row < src.height; row += 1) {
      for (let col = 0; col < src.width; col += 1) {
        dst.blit(src.getPixels(col, row, 1, 1), x + col, y + row, 1, 1);
      }
    }
  }

  drawBitmapRect(
    dst: BitmapShape,
    src: BitmapShape,
    srcX: number,
    srcY: number,
    width: number,
    height: number,
    x: number,
    y: number,
  ): void {
    if (!(dst instanceof CanvasBitmap)) return;
    dst.blit(src.getPixels(srcX, srcY, width, height), x, y, width, height);
  }

  private blit(
    pixels: Uint8Array,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    for (let row = 0; row < height; row += 1) {
      const dy = y + row;
      if (dy < 0 || dy >= this.height) continue;
      for (let col = 0; col < width; col += 1) {
        const dx = x + col;
        if (dx < 0 || dx >= this.width) continue;
        const s = (row * width + col) * ARGB_CHANNELS;
        const d = (dy * this.width + dx) * ARGB_CHANNELS;
        this.data[d] = pixels[s] as number;
        this.data[d + 1] = pixels[s + 1] as number;
        this.data[d + 2] = pixels[s + 2] as number;
        this.data[d + 3] = pixels[s + 3] as number;
      }
    }
  }

  /** Kotlin `BitmapFactory.decodeByteArray` 是同步的；浏览器解码是异步的，
   *  所以这里只查预解码缓存，未命中返回 null（调用方走占位分支）。
   *  先调 `preloadImageBytes(data, key)` 即可命中。 */
  decodeBytes(_bytes: Uint8Array): BitmapShape | null {
    return null;
  }

  compressPng(): Uint8Array | null {
    return null; // 纯像素数组无 PNG 编码；调用方走占位分支
  }

  recycle(): void {
    this.data = new Uint8Array(0);
  }
}

/** 与 Android `BitmapFactory` 的格式探测同款最小签名。 */
export function sniffImageMime(data: Uint8Array): string {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'image/png';
  }
  // WebP = "RIFF" + 4B size + "WEBP"
  if (
    data.length >= 12 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

async function decodeViaCanvas(
  data: Uint8Array,
  mime: string,
): Promise<CanvasBitmap | null> {
  if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  try {
    const type = mime === 'application/octet-stream' ? sniffImageMime(data) : mime;
    const blob = new Blob([data as unknown as BlobPart], { type });
    const source = await createImageBitmap(blob);
    const width = source.width;
    const height = source.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.drawImage(source, 0, 0);
    source.close();
    const imageData = ctx.getImageData(0, 0, width, height);
    return new CanvasBitmap(width, height, new Uint8Array(imageData.data.buffer.slice(0)));
  } catch {
    return null;
  }
}

/** 同步入口：只能处理已缓存的解码结果（`BitmapFactory.decodeByteArray` 是同步的）。 */
const decodeCache = new Map<string, CanvasBitmap | null>();

export async function decodeImageBytes(data: Uint8Array): Promise<CanvasBitmap | null> {
  return decodeViaCanvas(data, sniffImageMime(data));
}

/** 预解码并缓存，供同步 `Bitmap.decodeBytes` 命中。 */
export async function preloadImageBytes(
  data: Uint8Array,
  cacheKey: string,
): Promise<void> {
  decodeCache.set(cacheKey, await decodeViaCanvas(data, sniffImageMime(data)));
}

export function cachedImageBytes(cacheKey: string): CanvasBitmap | null {
  return decodeCache.get(cacheKey) ?? null;
}

export function createCanvasBitmap(width: number, height: number): BitmapShape {
  return new CanvasBitmap(width, height);
}

/* ══════════════ ImageProbe（coil） ══════════════ */

export function createWebImageProbe(): {
  loadBitmap(url: string, headers: Record<string, string>): Promise<BitmapShape | null>;
} {
  return {
    async loadBitmap(url: string, headers: Record<string, string>): Promise<BitmapShape | null> {
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        return await decodeViaCanvas(bytes, sniffImageMime(bytes));
      } catch {
        return null;
      }
    },
  };
}

/* ══════════════ CryptoPort（MessageDigest / Mac / Cipher / RSA） ══════════════ */

/**
 * SubtleCrypto 适配。
 * ⚠️ SubtleCrypto **不提供 MD5**（WebCrypto 规范只收 SHA 系列），
 * 且**全部接口都是异步的**，而 `CryptoPort` 是同步的。
 * 所以这里用一份纯 TS 同步实现（MD5/SHA1/SHA256/HMAC）。
 *
 * AES 同样走纯 TS 同步实现（E34/E41 收口）：`crypto.subtle` 只支持 `AES-CBC`，
 * 而 Kotlin `JsMessageHandler.kt:359-362` 实现了 **ECB / CBC / CFB / OFB 四种**
 * transformation，其中三种 WebCrypto 完全没有 —— 等原生桥会永远卡着。
 * AES 是纯数学算法、不依赖任何平台能力（与 E61 同性质），故落在
 * `src/core/crypto/aes.ts`。
 *
 * RSA 保持注入 + 未注入显式抛错：Kotlin 侧 `handleConvert` 的 `when` 里
 * **没有 `rsa` 分支**（`else -> null`），`Convert.decryptRsa` 恒返回 null，
 * 两侧行为已一致，**不需要实现**（见 E34/E41 原因列）。
 */
export interface SyncDigestImpl {
  md5(data: Uint8Array): Uint8Array;
  sha1(data: Uint8Array): Uint8Array;
  sha256(data: Uint8Array): Uint8Array;
  hmac(algorithm: 'HmacSHA1' | 'HmacSHA256', key: Uint8Array, data: Uint8Array): Uint8Array;
}

let digestImpl: SyncDigestImpl | null = null;

/** 注入同步摘要实现（见 `src/core/source/zlibrary/md5.ts` 与本文件的 sha 系列）。 */
export function installSyncDigestImpl(impl: SyncDigestImpl): void {
  digestImpl = impl;
}

export interface WebCryptoPortOptions {
  /**
   * `AES/…` 解密的**原生**实现（iOS 侧用 CommonCrypto / CryptoKit）。
   *
   * 不注入时自动回落到 `@core/crypto/aes` 的纯 TS 实现 —— 四种 transformation
   * 全部可用。留这个注入点是为了能做逐字节对照验证，不是必需依赖。
   */
  aesDecrypt?: CryptoPort['aesDecrypt'];
  /**
   * `RSA` 私钥解密。**两侧都不需要**：Kotlin `handleConvert` 无 `rsa` 分支，
   * `Convert.decryptRsa` 恒返回 null。未注入时显式抛错（不静默降级）。
   */
  rsaDecrypt?: CryptoPort['rsaDecrypt'];
}

export function createWebCryptoPort(options: WebCryptoPortOptions = {}): CryptoPort {
  const need = (name: string): SyncDigestImpl => {
    if (digestImpl === null) {
      throw new Error(`缺少同步 ${name} 实现：请调用 installSyncDigestImpl`);
    }
    return digestImpl;
  };
  return {
    digest(algorithm: string, data: Uint8Array): Uint8Array {
      const impl = need(algorithm);
      const name = algorithm.toUpperCase();
      if (name.includes('MD5')) return impl.md5(data);
      if (name.includes('SHA-1') || name === 'SHA1') return impl.sha1(data);
      if (name.includes('SHA-256') || name === 'SHA256') return impl.sha256(data);
      throw new Error(`不支持的摘要算法：${algorithm}`);
    },
    hmac(algorithm: string, key: Uint8Array, data: Uint8Array): Uint8Array {
      const impl = need(algorithm);
      const name = algorithm.toUpperCase().replace(/[/-]/g, '');
      if (name.includes('SHA1')) return impl.hmac('HmacSHA1', key, data);
      if (name.includes('SHA256')) return impl.hmac('HmacSHA256', key, data);
      throw new Error(`不支持的 MAC 算法：${algorithm}`);
    },
    aesDecrypt: (mode, key, iv, data) =>
      // 优先用注入的原生实现（存在时走它，便于与 Kotlin 的 Cipher 逐字节对照）；
      // 未注入则回落纯 TS —— 三种 WebCrypto 缺失的模式只能靠它。
      options.aesDecrypt === undefined
        ? aesDecrypt(mode, key, iv, data)
        : options.aesDecrypt(mode, key, iv, data),
    rsaDecrypt: (value, key) => {
      if (options.rsaDecrypt === undefined) {
        throw new Error('RSA 解密需要原生实现（见 platform/ios-native）');
      }
      return options.rsaDecrypt(value, key);
    },
    randomUUID: () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          }),
    // Kotlin `Random.nextInt(min, max)` 半开区间
    randomInt: (min, max) => min + Math.floor(Math.random() * (max - min)),
    randomDouble: (min, max) => min + Math.random() * (max - min),
  };
}

/* ══════════════ HtmlDomParser（Jsoup） ══════════════ */

/**
 * jsoup 替代：与 `src/core/source/zlibrary/parser/htmlDocument.ts` 同一套
 * 选择器语义，不在这里重复实现第二套 DOM（避免两套行为漂移）。
 */
export function createInjectedHtmlDomParser(): HtmlDomParser {
  throw new Error('请注入 parseHtml / wholeText（见 src/core/source/zlibrary/parser/htmlDocument.ts）');
}

export function wrapHtmlDomParser(impl: HtmlDomParser): HtmlDomParser {
  return impl;
}

/* ══════════════ WebView / Cookie（WKWebView） ══════════════ */

export const documentCookiePort: BrowserCookiePort = createDocumentCookiePort();

/**
 * E38 / E42：主机 WebView 工厂。
 *
 * 原先登记「需内嵌 WKWebView（Capacitor Browser 插件是独立进程，拿不到回传）」，
 * 2026-10-09 核实该判断不成立：App 本身就是 WKWebView，隐藏 `<iframe>` 用的
 * 就是**同一个引擎实例**（真实网络栈 + 真实 Cookie 存储 + 与 `fetch` 共享 UA），
 * 无需任何 Capacitor 插件。实现见 `webViewFactory.ts`，含三处跨域限制的
 * 明确对策（引导页 + `window.name` 跨导航携带桥接）。
 */
export function createUnwiredWebViewFactory(): WebViewFactory {
  return createFrameWebViewFactory();
}

export type { HtmlDomNode };