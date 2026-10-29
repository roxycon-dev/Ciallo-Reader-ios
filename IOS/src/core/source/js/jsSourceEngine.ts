/**
 * Android source: `com.example.source.js.JsSourceEngine.kt` (552 lines, 530 non-blank)
 * Ported: 530 / 530 non-blank lines. Skipped: none.
 *
 * Platform adaptations:
 * - `com.dokar.quickjs.QuickJs` → the injected `JsRuntime` sandbox built from
 *   `new Function` / `AsyncFunction`. `evaluate`, `function` and
 *   `asyncFunction` keep the same protocol, so the `sendMessage` /
 *   `sendMessageSync` payload shapes and the SYNC_OVERRIDE/PREAMBLE bootstrap
 *   scripts are byte-for-byte the Android ones.
 * - `app.assets.open("js_safety/acorn.js" | "instrument.js" |
 *   "venera/comic_metadata.js")` → injected `readAsset` over the app bundle.
 * - `Mutex` + `withContext(NonCancellable + Dispatchers.IO)` → `JsMutex`, with
 *   the `QuickJsAsyncLifecycle.settle()` step still in a `finally`.
 * - `kotlinx.coroutines.Job` → an `AbortSignal` (`handler.requestJob`).
 * - `android.os.SystemClock.elapsedRealtime()` → injected `elapsedRealtime`.
 * - `java.util.regex.Pattern` in `__boundedRegex` / `__boundedRegexBatch` →
 *   JS `RegExp`. The i/m/s flag mapping, the 4096-char / 2 MiB guards, the
 *   sticky (`y`) region semantics, the 500 ms `RuleBudget.text(input, 500)`
 *   budget, the 128-match and 64 KiB capture caps and the
 *   "书源正则回溯过深" error are preserved.
 *   `matcher.find(start)` → `RegExp` with `g` and `lastIndex = start`;
 *   `matcher.find()` after a match → `lastIndex = matcher.end()`.
 *   `args[i].toString()` → `kotlinToString` (quickjs-kt widens JS numbers to
 *   `Double`, so `1` crosses as `"1.0"`).
 *   Residual Java-vs-JS regex differences (`\p{…}` category syntax, possessive
 *   quantifiers, `u`-flag-only escapes) are registered as E59.
 * - `org.json` in the guards → the local org.json port (`./json.ts`).
 * - `SourceException.ParseError` → the existing TS `ParseError`.
 * - `org.json.JSONObject.quote(value)` → `JSON.stringify(value)` (re-exported as
 *   `jsonQuote` because `JsComicSource.q()` depends on it).
 *
 * 2026-10-11（SECURITY_AUDIT P0-1 ~ P0-4 / P1-2 / E86）改动说明（行号映射随之失效）：
 * - `JsRuntime.evaluate` 改 async（`jsPlatform.ts`）→ 本文件全部 `runtime.evaluate`
 *   调用点加 `await`，`instrument()` 改 async —— 求值现在往返平台层的真 Worker
 *   沙箱（`platform/web/jsSourcePlatform.ts`），第三方书源代码不再与 App 同 realm
 *   （P0-1/P0-2；Kotlin 的同步 `quickJs.evaluate` 是 JS 侧无法复刻的结构性偏差）。
 * - `__boundedRegex` / `__boundedRegexBatch` 实现整体迁到 `./boundedRegex.ts`
 *   （E86：预算改为「入口 + 扫描结束」两点检查；同时该文件导出
 *   `BOUNDED_REGEX_SANDBOX_SOURCE`，Worker 沙箱内与核心共用同一份实现）。
 * - `SYNC_OVERRIDE` 从「同步桥」改写为「异步桥」（P0-3）：Worker 沙箱里同步往返
 *   主线程没有安全实现，`sendMessageSync(...)` 一律改为 `await sendMessage(...)`。
 *   `isLogged` getter 无法 await → 改为读快照 `globalThis.__veneraIsLogged`
 *   （初始化时播种 + `setLoggedIn` 时推送，见 Kotlin 侧逐次查询语义的差异登记）。
 *   其余 getter（HtmlElement/HtmlNode/Image 的 `get text()` 等）返回 Promise，
 *   书源需 `await` —— 与 Venera 官方 App 的异步 `sendMessage` 语义一致。
 * - `withRuntime` 捕获 `JsSandboxResetError`（主线程看门狗终止沙箱的兜底，
 *   P0-4）：realm 状态丢失，复位 `ready` 让下次调用重新初始化。
 */

import { ParseError } from '../sourceException';
import { JSONObject, jsonQuote } from './json';
import type { JsMessageHandler } from './jsMessageHandler';
import { boundedRegex, boundedRegexBatch } from './boundedRegex';
import {
  JsSandboxResetError,
  JsMutex,
  type CancellationSignal,
  type JsRuntime,
} from './jsPlatform';
import { QuickJsAsyncLifecycle } from './quickJsAsyncLifecycle';
import { NATIVE_SYNC_OVERRIDE } from './nativeSyncBootstrap';

/** Public engine API; the production implementation may live wholly in a Worker. */
export interface JsSourceEngineApi {
  setInitializationCode?(code: string): void;
  call(code: string, signal?: CancellationSignal): Promise<string | null>;
  setLoggedIn(logged: boolean): void;
  isLoggedIn(): boolean;
  fetchImageBytes(url: string, headers: Record<string, string>, signal?: CancellationSignal): Promise<Uint8Array | null>;
  transformImageBlocking(code: string, bytes: Uint8Array): Promise<Uint8Array | null>;
}

// `__boundedRegex` / `__boundedRegexBatch` 的实现本体在 `./boundedRegex.ts`
// （2026-10-11 迁出，E86 两点预算 + 沙箱同源装配）；这里保持 Kotlin 的
// `JsSourceEngine` 公开面（原导出位置不变，`tests/unit/jsSourceRepo.test.ts` 引用）。
export { boundedRegex, boundedRegexBatch };

/** Kotlin `check(…) { "书源脚本执行超过 45 秒" }`. */
export const EXECUTION_BUDGET_MS = 45_000;
/** Kotlin `quickJs.memoryLimit = 32L * 1024 * 1024`. */
export const MEMORY_LIMIT = 32 * 1024 * 1024;
/** Kotlin `quickJs.maxStackSize = 512L * 1024`. */
export const MAX_STACK_SIZE = 512 * 1024;

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Everything the engine needs from the platform. */
export interface JsSourceEngineDeps {
  readonly runtime: JsRuntime;
  /** Kotlin `context.assets.open(path)`. */
  readonly readAsset: (path: string) => string;
  /** Kotlin `android.os.SystemClock.elapsedRealtime()`. */
  readonly elapsedRealtime: () => number;
  readonly handler: JsMessageHandler;
}

/**
 * 单个 JS 书源的 QuickJS 运行环境。
 * 加载 Venera 运行时 + 源脚本，并通过 sendMessage 桥接 Kotlin 能力。
 */
export class JsSourceEngine {
  private readonly mutex = new JsMutex();
  private ready = false;
  private className = '';
  private initializing = false;
  private executionDeadline = 0;
  private executionJob: CancellationSignal = null;

  constructor(
    private readonly runtimeJs: string,
    private readonly sourceJs: string,
    private readonly sourceKey: string,
    private readonly deps: JsSourceEngineDeps,
    /** Kotlin `insecureTls` — forwarded to the message bridge's HTTP client. */
    readonly insecureTls = false,
  ) {
    // 注册前台 Activity 跟踪：UI.showInputDialog 需要在 Activity 上弹对话框
    // (Kotlin: `JsActivityTracker.register(context)` in `init`).
  }

  private get handler(): JsMessageHandler {
    return this.deps.handler;
  }

  private get quickJs(): JsRuntime {
    return this.deps.runtime;
  }

  // ---- execution budget ----

  /** Kotlin `private suspend fun beginBudget()`. */
  private beginBudget(signal: CancellationSignal): void {
    this.executionJob = signal;
    this.executionDeadline = this.deps.elapsedRealtime() + EXECUTION_BUDGET_MS;
    this.handler.requestJob = signal;
    // Kotlin 把 caller 的 Job 交给 checkBudget（取消在下一次 tick/桥调用打断）；
    // Worker 沙箱里 tick 跑在沙箱线程，由运行时投递 {op:'abort'} 实现同一语义。
    this.quickJs.armExecution(signal);
  }

  /** Kotlin `private fun checkBudget()`. */
  private checkBudget(): void {
    if (!this.initializing && this.executionJob?.aborted === true) {
      const error = new Error('JS request cancelled');
      error.name = 'AbortError';
      throw error;
    }
    if (this.deps.elapsedRealtime() > this.executionDeadline) {
      throw new Error('书源脚本执行超过 45 秒');
    }
  }

  /** Kotlin `private suspend fun instrument(code: String): String`。 */
  private async instrument(code: string): Promise<string> {
    const out = await this.quickJs.evaluate(
      `__cialloInstrument(${JSON.stringify(code)})`,
      'instrument_source.js',
    );
    if (out === null) throw new Error('JS instrumentation failed');
    return out;
  }

  /** Kotlin `private suspend fun <T> withRuntime(block: suspend () -> T): T`. */
  private async withRuntime<T>(block: () => Promise<T>, signal: CancellationSignal): Promise<T> {
    const release = await this.mutex.acquire();
    try {
      // Preserve the caller's Job for guard/HTTP cancellation. Let alpha13 finish
      // consuming its native promises before another request can use this context.
      this.beginBudget(signal);
      try {
        return await block();
      } catch (e) {
        // 主线程看门狗终止了沙箱（插桩 tick 管不到的原生悬挂，P0-4 兜底）：
        // realm 状态（__veneraSrc 等）已随 terminate 丢失，复位 ready，
        // 下一次调用走完整的 initializeLocked 重新装配。
        if (e instanceof JsSandboxResetError) this.ready = false;
        throw e;
      } finally {
        await QuickJsAsyncLifecycle.settle(this.quickJs);
      }
    } finally {
      release();
    }
  }

  // ---- login state ----

  /** Kotlin `fun setLoggedIn(logged: Boolean)`. */
  setLoggedIn(logged: boolean): void {
    this.handler.setLoggedIn(logged);
    // Kotlin 的 `isLogged` getter 每次访问都同步查询桥；Worker 沙箱里 getter
    // 无法 await（P0-3），改为快照 —— 这里把新的登录态推进沙箱（fire-and-forget）。
    void this.quickJs
      .evaluate(`globalThis.__veneraIsLogged = ${logged ? 'true' : 'false'};`, 'globals.js')
      .catch(() => undefined);
  }

  /** Kotlin `fun isLoggedIn(): Boolean`. */
  isLoggedIn(): boolean {
    return this.handler.isLoggedIn();
  }

  /** 用 Cronet 直接下载图片字节（H@H 等 OkHttp 握手失败的图床）。 */
  fetchImageBytes(
    url: string,
    headers: Record<string, string>,
    signal: CancellationSignal = this.executionJob,
  ): Promise<Uint8Array | null> {
    return this.handler.fetchImageBytes(url, headers, signal);
  }

  /** 执行一段以 src 为实例的 JS 表达式，返回 JSON 字符串 {ok, data|error}。 */
  call(jsCall: string, signal: CancellationSignal = null): Promise<string | null> {
    return this.withRuntime(async () => {
      await this.ensureReadyLocked();
      const code = CALL_WRAPPER.replace('__CIALLO_JS_CALL__', () => jsCall);
      try {
        const raw = await this.quickJs.evaluate(await this.instrument(code), 'call.js');
        if (raw !== null && raw.includes('"ok":false')) {

          console.warn(`JsEngine[${this.sourceKey}]`, `js error: ${raw.slice(0, 400)}`);
        }
        return raw;
      } catch (e) {
        if (isAbort(e)) throw e;
        const message = e instanceof Error && e.message !== '' ? e.message : 'Exception';
        return `{"ok":false,"error":${JSON.stringify(message)}}`;
      }
    }, signal);
  }

  /** 运行脚本返回的 modifyImage 代码，对图片字节做像素级重排（如禁漫天堂分块乱序）。 */
  transformImage(
    jsCode: string,
    input: Uint8Array,
    signal: CancellationSignal = null,
  ): Promise<Uint8Array | null> {
    return this.withRuntime(async () => {
      await this.ensureReadyLocked();
      const previousImages = this.handler.beginImageSession();
      try {
        const key = this.handler.createImage(input);
        if (key === null) return null;
        const code = MODIFY_IMAGE_WRAPPER
          .replace('__CIALLO_IMAGE_KEY__', () => String(key))
          .replace('__CIALLO_MODIFY_CODE__', () => jsCode);
        const raw = await this.quickJs.evaluate(await this.instrument(code), 'modify_image.js');
        const trimmed = raw?.trim() ?? '';
        const outKey = /^-?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
        return outKey === null ? null : this.handler.exportImageBytes(outKey);
      } catch (e) {
        if (isAbort(e)) throw e;
         
        console.warn(`JsEngine[${this.sourceKey}]`, 'modifyImage failed', e);
        return null;
      } finally {
        this.handler.endImageSession(previousImages);
      }
    }, signal);
  }

  /** OkHttp 拦截器等阻塞场景使用 */
  transformImageBlocking(jsCode: string, input: Uint8Array): Promise<Uint8Array | null> {
    return this.transformImage(jsCode, input, null);
  }

  private async ensureReadyLocked(): Promise<void> {
    if (this.ready) return;
    // Bootstrap installs non-configurable guards. Finish that one-time setup
    // even if its first caller cancels; HTTP still observes the caller's Job.
    this.initializing = true;
    try {
      await this.initializeLocked();
    } finally {
      this.initializing = false;
    }
  }

  private async initializeLocked(): Promise<void> {
    const runtime = this.quickJs;

    // 2026-10-11：`registerFunction` 不再是 no-op（P0-3）—— 绑定进运行时注册表；
    // Worker 沙箱里 `__cialloTick` / `__boundedRegex` / `__boundedRegexBatch` 由
    // 沙箱体原生提供（同源实现，见 boundedRegex.ts），注册仅记录绑定面。
    runtime.registerFunction('__cialloTick', () => {
      this.checkBudget();
      return null;
    });
    runtime.registerFunction('__boundedRegex', (...args: unknown[]) => {
      this.checkBudget();
      return boundedRegex(args);
    });
    runtime.registerFunction('__boundedRegexBatch', (...args: unknown[]) => {
      this.checkBudget();
      return boundedRegexBatch(args);
    });
    // defineProperty returns globalThis. Do not send the global object (including
    // native bindings and Symbols) through QuickJS's JS-to-Kotlin value converter.
    await runtime.evaluate(RUNTIME_GUARDS, 'runtime_guards.js');
    const acorn = this.deps.readAsset('js_safety/acorn.js');
    if (acorn !== '') await runtime.evaluate(acorn, 'acorn.js');
    const instrumentAsset = this.deps.readAsset('js_safety/instrument.js');
    if (instrumentAsset !== '') await runtime.evaluate(instrumentAsset, 'instrument.js');
    // 同步桥：Convert/Html/Storage/uuid/random 等要求同步返回值
    // 2026-10-11（P0-3）：Worker 隔离下同步往返不可行 —— 绑定保留（Kotlin 注册面），
    // 沙箱侧的桩只能以 Promise 形态返回；SYNC_OVERRIDE 已全部改走异步 `sendMessage`。
    runtime.registerFunction('sendMessageSync', (...args: unknown[]) => {
      this.checkBudget();
      return this.handler.handle(args[0]);
    });
    // 异步桥：Network/setTimeout/UI 等 await 或 .then 使用。
    // 挂起实现：UI.showInputDialog 需等待用户输入，故走 handleAsync。
    runtime.registerAsyncFunction('sendMessage', async (...args: unknown[]) => {
      this.checkBudget();
      return this.handler.handleAsync(args[0]);
    });
    // Venera App 注入的全局变量（appVersion 等）
    await runtime.evaluate("globalThis.appVersion = '1.7.0';", 'globals.js');
    await runtime.evaluate(this.runtimeJs, 'venera_runtime.js');
    // Venera 的 sendMessage 混合同步/异步语义；2026-10-11 起统一走异步桥（P0-3）
    await runtime.evaluate(runtime.synchronousBindings ? NATIVE_SYNC_OVERRIDE : SYNC_OVERRIDE, 'sync_override.js');
    const comicMetadata = this.deps.readAsset('venera/comic_metadata.js');
    if (comicMetadata !== '') await runtime.evaluate(comicMetadata, 'comic_metadata.js');
    // Venera App 在引擎初始化时注入的模型类（ComicDetails/Chapter 等）
    await runtime.evaluate(PREAMBLE, 'models.js');
    await runtime.evaluate(await this.instrument(this.sourceJs), 'source.js');
    const match = /class\s+([A-Za-z_$][\w$]*)\s+extends\s+ComicSource/.exec(this.sourceJs);
    this.className = match?.[1] ?? '';
    if (this.className.trim() === '') {
      this.className =
        await runtime.evaluate(
          `(() => {
                    const names = Object.getOwnPropertyNames(globalThis);
                    const found = names.filter(n => {
                        try {
                            return typeof globalThis[n] === 'function'
                                && globalThis[n].prototype instanceof ComicSource;
                        } catch (e) { return false; }
                    });
                    return found[0] || '';
                })()`,
          'models.js',
        ) ?? '';
    }
    if (this.className.trim() === '') {
      throw new ParseError('JS 书源未找到 ComicSource 类');
    }
    // 与 Venera 一致：源实例只创建一次、init() 一次，后续调用全部复用同一实例
    // 先创建实例并抓取 settings 默认值，但暂不执行 init()，
    // 保证 init() 期间 loadSetting 也能拿到默认值（如 jm/ehentai 的域名）。
    await runtime.evaluate(INSTANTIATE.replace('__CIALLO_CLASS__', () => this.className), 'instantiate.js');
    // Kotlin `quickJs.evaluate<String>("globalThis.__veneraDefaults") ?: "{}"`
    const settingsJson = (await runtime.evaluate('globalThis.__veneraDefaults', 'settings.js')) ?? '{}';
    // Kotlin 的 `isLogged` getter 每次同步查询桥（SYNC_OVERRIDE）；Worker 沙箱里
    // getter 不能 await（P0-3），改读快照 —— 这里播种初值，setLoggedIn 推送更新。
    await runtime.evaluate(
      `globalThis.__veneraIsLogged = ${this.handler.isLoggedIn() ? 'true' : 'false'};`,
      'globals.js',
    );
    try {
      const defaults: Record<string, string> = {};
      const obj = new JSONObject(settingsJson);
      for (const k of obj.keys()) defaults[k] = obj.optString(k);
      this.handler.setSettingDefaults(defaults);
    } catch (e) {
      if (isAbort(e)) throw e;
      // 忽略设置解析失败
    }
    // Defaults and bindings are reusable even if the optional init is cancelled.
    this.ready = true;
    // 默认值注入完成后，再执行 init()（错误不致命，源继续用默认配置工作）
    await runtime.evaluate(INIT_CALL, 'instantiate.js');
  }
}

// ----------------------------------------------------------------------
// bootstrap scripts (verbatim ports of the Kotlin raw strings)
// ----------------------------------------------------------------------

/** Kotlin `fun call(jsCall)` wrapper, with `$jsCall` replaced by the placeholder. */
const CALL_WRAPPER = `await (async () => {
    const __flattenChapters = (value) => {
        const entries = value instanceof Map ? Array.from(value.entries()) : Object.entries(value);
        const out = [];
        for (const [k, v] of entries) {
            if (v instanceof Map) {
                for (const [k2, v2] of v.entries()) {
                    out.push({ id: String(k2), title: String(v2), group: String(k) });
                }
            } else if (v && typeof v === 'object' && !Array.isArray(v)) {
                for (const [k2, v2] of Object.entries(v)) {
                    out.push({ id: String(k2), title: String(v2), group: String(k) });
                }
            } else {
                out.push({ id: String(k), title: String(v) });
            }
        }
        return out;
    };
    const __normalize = (value) => {
        if (value instanceof Map) {
            const out = {};
            for (const [key, item] of value.entries()) out[String(key)] = __normalize(item);
            return out;
        }
        if (Array.isArray(value)) return value.map(__normalize);
        if (value && typeof value === 'object') {
            const out = {};
            for (const key of Object.keys(value)) {
                const v = value[key];
                if (key === 'chapters' && v &&
                    (v instanceof Map || (typeof v === 'object' && !Array.isArray(v)))) {
                    out[key] = __flattenChapters(v);
                } else {
                    out[key] = __normalize(v);
                }
            }
            return out;
        }
        return value;
    };
    try {
        const src = globalThis.__veneraSrc;
        const result = await (__CIALLO_JS_CALL__);
        return JSON.stringify({ ok: true, data: __normalize(result === undefined ? null : result) });
    } catch (e) {
        return JSON.stringify({
            ok: false,
            error: [e && e.message ? String(e.message) : '', String(e && e.stack ? e.stack : e)]
                .filter(Boolean).join('\\n'),
            message: e && e.message ? String(e.message) : ''
        });
    }
})();`;

/** Kotlin `transformImage` wrapper, with `$key` / `$jsCode` as placeholders. */
const MODIFY_IMAGE_WRAPPER = `(() => {
    const __img = new Image(__CIALLO_IMAGE_KEY__);
    __CIALLO_MODIFY_CODE__
    const __res = modifyImage(__img);
    const __outKey = __res && __res.key != null ? String(__res.key) : String(__CIALLO_IMAGE_KEY__);
    return __outKey;
})()`;

/** Kotlin `runtime_guards.js` evaluation. */
const RUNTIME_GUARDS = `Object.defineProperty(globalThis, '__cialloTick', {writable:false,configurable:false});
Object.defineProperty(globalThis, '__boundedRegex', {writable:false,configurable:false});
Object.defineProperty(globalThis, '__boundedRegexBatch', {writable:false,configurable:false});
void 0;`;

/** Kotlin `PREAMBLE` (models.js). */
const PREAMBLE = `// ComicDetails / Comic 已由 Venera 运行时提供，这里只补 Chapter / Category
class Chapter {
    constructor(options = {}) {
        this.id = options.id;
        this.title = options.title;
        this.order = options.order;
        this.group = options.group;
    }
}
class Category {
    constructor(options = {}) {
        this.title = options.title;
        this.category = options.category;
    }
}`;

/** Kotlin `instantiate.js` instance creation, with `$className` as a placeholder. */
const INSTANTIATE = `globalThis.__veneraSrc = new __CIALLO_CLASS__();
// 与 Venera 一致：部分源只实现 search.loadNext（首页传 null），补一个 load 适配
(() => {
    const s = globalThis.__veneraSrc.search || {};
    if (typeof s.load !== 'function' && typeof s.loadNext === 'function') {
        s.load = (keyword, options, page) => {
            const list = s.optionList || [];
            const opts = list.map((item, i) => {
                if (options && options[i] !== undefined && options[i] !== null) return options[i];
                const d = item.default;
                if (Array.isArray(d)) return JSON.stringify(d);
                if (d !== undefined && d !== null) return String(d);
                return null;
            });
            return s.loadNext(keyword, opts, null);
        };
    }
})();
(() => {
    const s = globalThis.__veneraSrc.settings || {};
    const out = {};
    for (const k of Object.keys(s)) {
        const item = s[k];
        if (item && typeof item === 'object' && item.default !== undefined) {
            out[k] = String(item.default);
        }
    }
    globalThis.__veneraDefaults = JSON.stringify(out);
})();`;

/** Kotlin `init()` invocation, verbatim. */
const INIT_CALL = `if (typeof globalThis.__veneraSrc.init === 'function') {
    try {
        await (async () => { await globalThis.__veneraSrc.init(); })();
    } catch (e) {
        // 忽略：源继续用默认配置工作
    }
}`;

/**
 * Kotlin `companion object { private val SYNC_OVERRIDE }` — **2026-10-11（P0-3）异步桥改写**。
 * Kotlin 原文把每个消费点写成同步 `sendMessageSync(...)`（QuickJS 内可以同步往返
 * Kotlin）；Worker 沙箱里同步往返主线程没有安全实现，因此全部改写为
 * `await sendMessage(...)`（Venera 官方 App 的 `sendMessage` 本就是异步通道，
 * 书源的 await 用法与其一致）。可观察差异：
 *  - `isLogged` getter 不能 await → 读引擎播种/推送的快照 `globalThis.__veneraIsLogged`；
 *  - 其余 getter（HtmlElement/HtmlNode/Image 的属性访问）返回 Promise，书源需 `await`；
 *  - 不经 await 的同步消费（`let id = createUuid()`）拿到的是 Promise —— 由
 *    CALL_WRAPPER 的 catch 变成 `{"ok":false,...}`（响亮失败，不是静默错值），
 *    已登记 E33/E40 的残余差异。
 * `sendMessageSync` 的载荷形状、方法名、分支顺序与 Kotlin 逐字一致。
 */
const SYNC_OVERRIDE = `// ---- ComicSource 存储/登录状态（异步桥，P0-3） ----
ComicSource.prototype.loadData = async function (dataKey) {
    let raw = await sendMessage({ method: 'load_data', key: this.key, data_key: dataKey });
    if (typeof raw === 'string' && raw.startsWith('JSON:')) {
        try { return JSON.parse(raw.slice(5)); } catch (e) { return raw; }
    }
    return raw;
};
ComicSource.prototype.saveData = async function (dataKey, data) {
    await sendMessage({ method: 'save_data', key: this.key, data_key: dataKey, data: data });
};
ComicSource.prototype.deleteData = async function (dataKey) {
    await sendMessage({ method: 'delete_data', key: this.key, data_key: dataKey });
};
ComicSource.prototype.loadSetting = function (settingKey) {
    return sendMessage({ method: 'load_setting', key: this.key, setting_key: settingKey });
};
// Kotlin: get() { return sendMessageSync({ method: 'isLogged', key: this.key }); }
// getter 无法 await —— 快照由引擎初始化时播种、setLoggedIn 时推送。
Object.defineProperty(ComicSource.prototype, 'isLogged', {
    get() { return globalThis.__veneraIsLogged === true; }
});

// ---- Convert（异步桥） ----
Convert.encodeUtf8 = (str) => sendMessage({ method: 'convert', type: 'utf8', value: str, isEncode: true });
Convert.decodeUtf8 = (value) => sendMessage({ method: 'convert', type: 'utf8', value: value, isEncode: false });
Convert.encodeGbk = (str) => sendMessage({ method: 'convert', type: 'gbk', value: str, isEncode: true });
Convert.decodeGbk = (value) => sendMessage({ method: 'convert', type: 'gbk', value: value, isEncode: false });
Convert.encodeBase64 = (value) => sendMessage({ method: 'convert', type: 'base64', value: value, isEncode: true });
Convert.decodeBase64 = (value) => sendMessage({ method: 'convert', type: 'base64', value: value, isEncode: false });
Convert.md5 = (value) => sendMessage({ method: 'convert', type: 'md5', value: value, isEncode: true });
Convert.sha1 = (value) => sendMessage({ method: 'convert', type: 'sha1', value: value, isEncode: true });
Convert.sha256 = (value) => sendMessage({ method: 'convert', type: 'sha256', value: value, isEncode: true });
Convert.sha512 = (value) => sendMessage({ method: 'convert', type: 'sha512', value: value, isEncode: true });
Convert.hmac = (key, value, hash) => sendMessage({ method: 'convert', type: 'hmac', value: value, key: key, hash: hash, isEncode: true });
Convert.hmacString = (key, value, hash) => sendMessage({ method: 'convert', type: 'hmac', value: value, key: key, hash: hash, isEncode: true, isString: true });
Convert.decryptAesEcb = (value, key) => sendMessage({ method: 'convert', type: 'aes-ecb', value: value, key: key, isEncode: false });
Convert.decryptAesCbc = (value, key, iv) => sendMessage({ method: 'convert', type: 'aes-cbc', value: value, key: key, iv: iv, isEncode: false });
Convert.decryptAesCfb = (value, key, blockSize) => sendMessage({ method: 'convert', type: 'aes-cfb', value: value, key: key, blockSize: blockSize, isEncode: false });
Convert.decryptAesOfb = (value, key, blockSize) => sendMessage({ method: 'convert', type: 'aes-ofb', value: value, key: key, blockSize: blockSize, isEncode: false });
Convert.decryptRsa = (value, key) => sendMessage({ method: 'convert', type: 'rsa', value: value, key: key, isEncode: false });
Convert.hexEncode = (value) => sendMessage({ method: 'convert', type: 'hex', value: value });

// ---- Network（桥接返回 JSON 字符串，这里解析为普通对象） ----
Network.sendRequest = async function (method, url, headers, data) {
    let result = await sendMessage({ method: 'http', http_method: method, url: url, headers: headers, data: data });
    if (typeof result === 'string') { result = JSON.parse(result); }
    if (result.error) { throw result.error; }
    return result;
};
Network.fetchBytes = async function (method, url, headers, data) {
    let result = await sendMessage({ method: 'http', http_method: method, bytes: true, url: url, headers: headers, data: data });
    if (typeof result === 'string') { result = JSON.parse(result); }
    if (result.error) { throw result.error; }
    if (typeof result.body === 'string') {
        result.body = Convert.decodeBase64(result.body);
    }
    return result;
};
Network.getCookies = async function (url) {
    const result = await sendMessage({method:'cookie',function:'get',url:url});
    return typeof result === 'string' ? JSON.parse(result) : result;
};
Network.setCookies = function (url, cookies) {
    return sendMessage({method:'cookie',function:'set',url:url,cookies:cookies});
};

// ---- 工具函数（异步桥） ----
createUuid = () => sendMessage({ method: 'uuid' });
randomInt = (min, max) => sendMessage({ method: 'random', type: 'int', min: min, max: max });
randomDouble = (min, max) => sendMessage({ method: 'random', type: 'double', min: min, max: max });

// ---- HtmlDocument / HtmlElement / HtmlNode（异步桥版本） ----
// 构造器里的 parse 是 fire-and-forget：主线程按到达顺序**串行**执行宿主调用
// （jsSourcePlatform.ts queueHostCall），保证 parse 先于后续 querySelector。
HtmlDocument = class HtmlDocument {
    static _key = 0;
    constructor(html) {
        this.key = HtmlDocument._key;
        HtmlDocument._key++;
        sendMessage({ method: 'html', function: 'parse', key: this.key, data: html });
    }
    querySelector(query) {
        return (async () => {
            let k = await sendMessage({ method: 'html', function: 'querySelector', key: this.key, query: query });
            return k == null ? null : new HtmlElement(k, this.key);
        })();
    }
    querySelectorAll(query) {
        return (async () => {
            let ks = await sendMessage({ method: 'html', function: 'querySelectorAll', key: this.key, query: query });
            return (ks || []).map(k => new HtmlElement(k, this.key));
        })();
    }
    getElementById(id) {
        return (async () => {
            let k = await sendMessage({ method: 'html', function: 'getElementById', key: this.key, id: id });
            return k == null ? null : new HtmlElement(k, this.key);
        })();
    }
    dispose() {
        sendMessage({ method: 'html', function: 'dispose', key: this.key });
    }
};

HtmlElement = class HtmlElement {
    constructor(key, doc) { this.key = key; this.doc = doc; }
    get text() { return sendMessage({ method: 'html', function: 'getText', key: this.key, doc: this.doc }); }
    get attributes() {
        return (async () => {
            let raw = await sendMessage({ method: 'html', function: 'getAttributes', key: this.key, doc: this.doc });
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        })();
    }
    get children() {
        return (async () => {
            let ks = await sendMessage({ method: 'html', function: 'getChildren', key: this.key, doc: this.doc });
            return (ks || []).map(k => new HtmlElement(k, this.doc));
        })();
    }
    get nodes() {
        return (async () => {
            let ks = await sendMessage({ method: 'html', function: 'getNodes', key: this.key, doc: this.doc });
            return (ks || []).map(k => new HtmlNode(k, this.doc));
        })();
    }
    get innerHTML() { return sendMessage({ method: 'html', function: 'getInnerHTML', key: this.key, doc: this.doc }); }
    get parent() {
        return (async () => {
            let k = await sendMessage({ method: 'html', function: 'getParent', key: this.key, doc: this.doc });
            return k == null ? null : new HtmlElement(k, this.doc);
        })();
    }
    get classNames() { return sendMessage({ method: 'html', function: 'getClassNames', key: this.key, doc: this.doc }); }
    get id() { return sendMessage({ method: 'html', function: 'getId', key: this.key, doc: this.doc }); }
    get localName() { return sendMessage({ method: 'html', function: 'getLocalName', key: this.key, doc: this.doc }); }
    get previousElementSibling() {
        return (async () => {
            let k = await sendMessage({ method: 'html', function: 'getPreviousSibling', key: this.key, doc: this.doc });
            return k == null ? null : new HtmlElement(k, this.doc);
        })();
    }
    get nextElementSibling() {
        return (async () => {
            let k = await sendMessage({ method: 'html', function: 'getNextSibling', key: this.key, doc: this.doc });
            return k == null ? null : new HtmlElement(k, this.doc);
        })();
    }
    querySelector(query) {
        return (async () => {
            let k = await sendMessage({ method: 'html', function: 'dom_querySelector', key: this.key, query: query, doc: this.doc });
            return k == null ? null : new HtmlElement(k, this.doc);
        })();
    }
    querySelectorAll(query) {
        return (async () => {
            let ks = await sendMessage({ method: 'html', function: 'dom_querySelectorAll', key: this.key, query: query, doc: this.doc });
            return (ks || []).map(k => new HtmlElement(k, this.doc));
        })();
    }
};

HtmlNode = class HtmlNode {
    constructor(key, doc) { this.key = key; this.doc = doc; }
    get text() { return sendMessage({ method: 'html', function: 'node_text', key: this.key, doc: this.doc }); }
    get type() { return sendMessage({ method: 'html', function: 'node_type', key: this.key, doc: this.doc }); }
    toElement() {
        return (async () => {
            let k = await sendMessage({ method: 'html', function: 'node_toElement', key: this.key, doc: this.doc });
            return k == null ? null : new HtmlElement(k, this.doc);
        })();
    }
};

// ---- Image（异步桥版本，底层图像处理暂不支持时返回 null） ----
Image = class Image {
    constructor(key) { this.key = key; }
    copyRange(x, y, width, height) {
        return (async () => {
            let key = await sendMessage({ method: 'image', function: 'copyRange', key: this.key, x: x, y: y, width: width, height: height });
            return key == null ? null : new Image(key);
        })();
    }
    copyAndRotate90() {
        return (async () => {
            let key = await sendMessage({ method: 'image', function: 'copyAndRotate90', key: this.key });
            return key == null ? null : new Image(key);
        })();
    }
    fillImageAt(x, y, image) {
        sendMessage({ method: 'image', function: 'fillImageAt', key: this.key, x: x, y: y, image: image.key });
    }
    fillImageRangeAt(x, y, image, srcX, srcY, width, height) {
        sendMessage({ method: 'image', function: 'fillImageRangeAt', key: this.key, x: x, y: y, image: image.key, srcX: srcX, srcY: srcY, width: width, height: height });
    }
    get width() { return sendMessage({ method: 'image', function: 'getWidth', key: this.key }); }
    get height() { return sendMessage({ method: 'image', function: 'getHeight', key: this.key }); }
    static empty(width, height) {
        return (async () => {
            let key = await sendMessage({ method: 'image', function: 'emptyImage', width: width, height: height });
            return key == null ? null : new Image(key);
        })();
    }
};`;

export { SYNC_OVERRIDE, PREAMBLE, RUNTIME_GUARDS, CALL_WRAPPER, MODIFY_IMAGE_WRAPPER, jsonQuote };
