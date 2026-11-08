/**
 * JS 书源沙箱体（SECURITY_AUDIT P0-1 ~ P0-4 / P1-2，2026-10-11）。
 *
 * 一段**自包含的经典脚本**，同时供两种宿主使用：
 *  - 生产：`Blob` Worker（`createBlobSandboxTransport`，独立线程 + 独立 realm，
 *    摸不到主线程的 `document` / `localStorage` / DOM）；
 *  - 测试：`node:vm` 全新 context（`tests/unit/helpers/jsSandboxTestHarness.ts`），
 *    realm 隔离语义与真 Worker 一致（全新全局、无 DOM）。
 *
 * 沙箱内提供（对齐 Kotlin `JsSourceEngine.kt:189-271` 的初始化序列）：
 *  - `__cialloTick` / `tick`：**墙钟**预算检查（Kotlin `checkBudget` 是
 *    `elapsedRealtime() > deadline`，JsSourceEngine.kt:36-39；预算毫秒数可由
 *    `{op:'eval'}` 注入以便测试）。Kotlin 侧 tick 由 `instrument.js` 插桩进每个
 *    循环 / 函数 / catch 体；本沙箱体在加载 acorn + instrument 资产后行为与
 *    QuickJS 内完全一致。
 *  - `__boundedRegex` / `__boundedRegexBatch`：来自 `@core/source/js/boundedRegex`
 *    的 `BOUNDED_REGEX_SANDBOX_SOURCE` —— 与核心引擎**同一份实现**（零漂移），
 *    因为 instrument.js 的 `RegExp.exec` 覆盖层会**同步**调用它们，无法走异步 RPC。
 *  - `__cialloPrepare`：程序求值的两处语义修正（`new Function` / `AsyncFunction`
 *    产生的是**函数体**，而 Kotlin `quickJs.evaluate` 求值的是**程序**）：
 *      1. 顶层 `class` / `function` / `let` / `const` 声明改写到 `globalThis`
 *         （QuickJS 的全局 context 里它们跨 evaluate 持久存活；函数体内它们
 *         会随调用结束消失，导致 source.js 的类在后续 INSTANTIATE 里不可见）；
 *      2. **完成值**（P0-2）：最后一个顶层表达式语句改写为 `return (…)`，
 *         否则 `__cialloInstrument(...)` 求值恒为 undefined，引擎初始化必炸。
 *  - 宿主函数 RPC（P0-3）：`registerFunction` / `registerAsyncFunction` 注册的
 *    绑定在沙箱内是 `globalThis.<name>` 形态的 RPC 桩 —— Worker 里持不住主线程
 *    函数引用，同步往返在浏览器主线程上也没有安全实现，所以桩统一返回
 *    Promise（`registerFunction` 的同步绑定同样如此；E33/E40 已登记）。
 *
 * P1-2（尽力而为的限额，如实标注近似程度）：
 *  - 脚本体积 ≤ 512 KB / AST ≤ 10 万节点：instrument.js 资产自带（Kotlin 同款）；
 *  - 求值完成值的编码长度 ≤ `memoryLimit`（30 MiB）→ 超限抛错（硬）；
 *  - `performance.memory.usedJSHeapSize` > `memoryLimit` → 记一次软超限
 *    （Chrome 系独有；Safari / Firefox 无此 API，无法近似检测 —— 不硬失败，
 *    避免跨引擎行为分叉）；
 *  - 512 KiB 栈上限：浏览器没有等价物，依赖引擎原生 `RangeError`（深度递归
 *    在耗尽真实栈之前就会先被插桩 tick 的 45s 预算打断）。
 */
import { BOUNDED_REGEX_SANDBOX_SOURCE } from '@core/source/js/boundedRegex';
import acornSource from '../../../public/js_safety/acorn.js?raw';
import instrumentSource from '../../../public/js_safety/instrument.js?raw';

/** Kotlin `check(android.os.SystemClock.elapsedRealtime() <= executionDeadline) { "书源脚本执行超过 45 秒" }`（JsSourceEngine.kt:38）— 逐字。 */
export const SANDBOX_BUDGET_MESSAGE = '书源脚本执行超过 45 秒';
/** Kotlin `CancellationException("JS request cancelled")`（JsSourceEngine.kt:37）— 逐字。 */
export const SANDBOX_ABORT_MESSAGE = 'JS request cancelled';
/** Kotlin `memoryLimit = 32L * 1024 * 1024`（JsSourceEngine.kt:49）的兜底默认。 */
const DEFAULT_MEMORY_LIMIT = 32 * 1024 * 1024;
/** Kotlin `executionDeadline = elapsedRealtime() + 45_000`（JsSourceEngine.kt:33）的兜底默认。 */
const DEFAULT_BUDGET_MS = 45_000;

// 注意：以下手写模板内部不得出现反引号与 `${`。整个沙箱体在文件尾用数组 join
// 与运行期 `JSON.stringify` 拼装 —— acorn.js / instrument.js / 函数源码里都有
// 反引号或模板串，绝不能嵌进字面量。

const SANDBOX_HEADER = `// === JS 书源沙箱体（SECURITY_AUDIT P0-1~P0-4 / P1-2, 2026-10-11） ===
// 经典脚本：Blob Worker 与 node:vm 测试传输共用。宿主只提供 self.postMessage / self.onmessage。
var __cialloNativeAsyncFunction = (async function () {}).constructor;
var __cialloBootEval = eval; // instrument.js 会覆写 globalThis.eval；引导求值必须用原生 eval（保存的间接调用 = 全局作用域）
var __cialloDeadline = Infinity;
var __cialloAborted = false;
var __cialloOverLimit = false;
var __cialloMemoryLimit = ${String(DEFAULT_MEMORY_LIMIT)};
function __cialloTick() {
  if (__cialloAborted) {
    var abortError = new Error(${JSON.stringify(SANDBOX_ABORT_MESSAGE)});
    abortError.name = 'AbortError';
    throw abortError;
  }
  // Kotlin checkBudget()：墙钟 deadline（JsSourceEngine.kt:36-39），预算毫秒数由 eval 消息注入。
  if (Date.now() >= __cialloDeadline) throw new Error(${JSON.stringify(SANDBOX_BUDGET_MESSAGE)});
}
globalThis.__cialloTick = __cialloTick;
function __cialloEncode(v) {
  if (v === undefined) return { t: 'undefined' };
  if (v === null) return { t: 'null' };
  var ty = typeof v;
  if (ty === 'number' || ty === 'boolean' || ty === 'string') return { t: ty, v: v };
  try {
    return { t: 'json', v: JSON.stringify(v) };
  } catch (err) {
    return { t: 'string', v: String(v) };
  }
}
`;

const SANDBOX_BINDINGS_BEFORE_REGEX = `
// ---- native 绑定：__boundedRegex / __boundedRegexBatch（与核心实现同源，见 boundedRegex.ts） ----
`;

const SANDBOX_BINDINGS_AFTER_REGEX = `
globalThis.__boundedRegex = function () {
  // quickjs-kt 约定：绑定 lambda 收到「全部调用参数组成的数组」
  // （JsSourceEngine.kt:191 的 quickJs.function("__boundedRegex") { args -> ... }）；
  // instrument.js 以展开参数调用（instrument.js:34），这里负责收集。
  return boundedRegex(Array.prototype.slice.call(arguments));
};
globalThis.__boundedRegexBatch = function () {
  return boundedRegexBatch(Array.prototype.slice.call(arguments));
};
// ---- 宿主函数 RPC（P0-3）：绑定名由主线程 {op:'register'} 下发，沙箱内建全局桩 ----
var __cialloPendingCalls = new Map();
var __cialloCallSeq = 0;
function __cialloHostCall(name, args) {
  return new Promise(function (resolve, reject) {
    var rid = ++__cialloCallSeq;
    __cialloPendingCalls.set(rid, { resolve: resolve, reject: reject });
    self.postMessage({ op: 'call', rid: rid, name: name, args: args });
  });
}
var __cialloNativeBindingNames = { __cialloTick: true, __boundedRegex: true, __boundedRegexBatch: true };
function __cialloDefineStub(name) {
  // Kotlin RUNTIME_GUARDS（JsSourceEngine.kt:239-249）：绑定面以 writable:false,configurable:false 钉死
  if (__cialloNativeBindingNames[name]) return;
  if (Object.prototype.hasOwnProperty.call(globalThis, name)) return;
  Object.defineProperty(globalThis, name, {
    value: function () { return __cialloHostCall(name, Array.prototype.slice.call(arguments)); },
    writable: false,
    configurable: false,
  });
}
`;

export const SANDBOX_PREPARE = `
// ---- __cialloPrepare：程序语义修正（顶层声明持久化 + 完成值，见文件头） ----
function __cialloPrepare(code) {
  var ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  });
  var edits = [];
  var hoisted = [];
  var stmts = ast.body;
  var s;
  for (s = 0; s < stmts.length; s++) {
    var stmt = stmts[s];
    if (stmt.type === 'ClassDeclaration' && stmt.id) {
      // class X {} → globalThis.X = class X {}（跨求值持久 + 同程序内可引用）
      edits.push({ at: stmt.start, end: stmt.start, text: 'globalThis.' + stmt.id.name + ' = ' });
    } else if (stmt.type === 'FunctionDeclaration' && stmt.id) {
      hoisted.push(stmt);
    } else if (stmt.type === 'VariableDeclaration' && stmt.kind !== 'var') {
      // let a = 1, b = 2; → globalThis.a = 1, globalThis.b = 2;
      var decls = stmt.declarations;
      for (var d = 0; d < decls.length; d++) {
        var decl = decls[d];
        if (decl.id.type !== 'Identifier') {
          throw new Error('沙箱不支持顶层 ' + stmt.kind + ' 解构声明');
        }
        if (d === 0) {
          edits.push({ at: stmt.start, end: decl.id.start, text: 'globalThis.' });
        } else {
          edits.push({ at: decl.id.start, end: decl.id.start, text: 'globalThis.' });
        }
      }
    }
  }
  for (var h = 0; h < hoisted.length; h++) {
    // 函数声明前置赋给全局（保留同程序内提升可用性），原位置声明照旧保留。
    var fn = hoisted[h];
    edits.push({ at: 0, end: 0, text: 'globalThis.' + fn.id.name + ' = ' + code.slice(fn.start, fn.end) + ';\\n' });
  }
  // 完成值（P0-2）：最后一个顶层表达式语句 → return (expr);
  // 注意：last.end 是**包含行尾分号**的（对 "1 + 1;" 而言 end 指向分号之后），
  // 直接在 last.end 处插入右括号会产出 "return (1 + 1;)" —— 语法错误。
  // 故插入点要从 last.end 往前跳过空白与分号。
  var last = stmts.length > 0 ? stmts[stmts.length - 1] : null;
  if (last && last.type === 'ExpressionStatement') {
    var insertAt = last.end;
    while (insertAt > last.start) {
      var ch = code.charCodeAt(insertAt - 1);
      // 32=space 9=tab 10=LF 13=CR 59=';'
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 59) insertAt -= 1;
      else break;
    }
    edits.push({ at: last.start, end: last.start, text: 'return (' });
    edits.push({ at: insertAt, end: insertAt, text: ')' });
  }
  edits.sort(function (a, b) { return b.at - a.at; });
  var out = code;
  for (var i = 0; i < edits.length; i++) {
    var e = edits[i];
    out = out.slice(0, e.at) + e.text + out.slice(e.end);
  }
  return out;
}
`;

const SANDBOX_BOOT_AND_LOOP = `
// ---- 引导：先 acorn（instrument.js 依赖 acorn.parse），再 instrument（依赖 __cialloTick） ----
__cialloBootEval(globalThis.__cialloAcornSource);
__cialloBootEval(globalThis.__cialloInstrumentSource);
globalThis.__cialloAcornSource = null;
globalThis.__cialloInstrumentSource = null;

var __cialloFns = {};
var __cialloAsyncFns = {};

self.onmessage = function (ev) {
  var d = ev.data;
  if (!d || typeof d !== 'object') return;
  if (d.op === 'register') {
    __cialloDefineStub(String(d.name));
    return;
  }
  if (d.op === 'abort') {
    // Kotlin executionJob?.isActive == false → 下一次 checkBudget 抛 CancellationException。
    __cialloAborted = true;
    return;
  }
  if (d.op === 'callResult') {
    var entry = __cialloPendingCalls.get(d.rid);
    if (entry) {
      __cialloPendingCalls.delete(d.rid);
      if (d.ok) {
        entry.resolve(d.value);
      } else {
        var callError = new Error(d.message || '宿主函数调用失败');
        if (d.errorName) callError.name = d.errorName;
        entry.reject(callError);
      }
    }
    return;
  }
  if (d.op === 'eval') {
    var evalId = d.id;
    (async function () {
      try {
        __cialloAborted = false;
        __cialloOverLimit = false;
        __cialloMemoryLimit = typeof d.memoryLimit === 'number' && d.memoryLimit > 0 ? d.memoryLimit : ${String(DEFAULT_MEMORY_LIMIT)};
        __cialloDeadline = Date.now() + (typeof d.budgetMs === 'number' && d.budgetMs > 0 ? d.budgetMs : ${String(DEFAULT_BUDGET_MS)});
        var prepared = __cialloPrepare(String(d.code));
        // 用**原生** AsyncFunction 编译：instrument.js 包装过的构造器会把已插桩的
        // 代码再次插桩（并触发其 512KB 上限）。书源自己 new Function(...) 的
        // 动态代码仍走 instrument.js 的包装构造器 —— 双层插桩语义与 Kotlin 一致。
        var fn = new __cialloNativeAsyncFunction('__cialloTick', 'tick', '__fns', '__asyncFns', prepared);
        var value = await fn(__cialloTick, __cialloTick, __cialloFns, __cialloAsyncFns);
        var box = __cialloEncode(value);
        if (box && typeof box.v === 'string' && box.v.length > __cialloMemoryLimit) {
          throw new Error('书源脚本结果超过内存上限（P1-2 近似检测）');
        }
        // P1-2 软监控：dedicated worker 的 performance.memory ≈ 沙箱自身堆（Chrome 系独有）。
        try {
          var perfMemory = typeof performance !== 'undefined' ? performance.memory : null;
          if (perfMemory && typeof perfMemory.usedJSHeapSize === 'number' && perfMemory.usedJSHeapSize > __cialloMemoryLimit) {
            __cialloOverLimit = true;
          }
        } catch (memErr) { /* 无 performance.memory 的引擎无法近似检测 */ }
        self.postMessage({ op: 'result', id: evalId, ok: true, over: __cialloOverLimit, value: box });
      } catch (e) {
        var message = e && e.message ? e.message : String(e);
        var errorName = e && e.name ? e.name : '';
        self.postMessage({
          op: 'result',
          id: evalId,
          ok: false,
          over: message === ${JSON.stringify(SANDBOX_BUDGET_MESSAGE)},
          message: message,
          errorName: errorName,
        });
      }
    })();
    return;
  }
};
`;

/**
 * 组装沙箱体。运行期拼接（不用模板字面量内嵌资产）：acorn.js 含大量反引号，
 * 函数源码同理 —— 全部经 `JSON.stringify` 转成合法 JS 字符串字面量后再拼。
 */
export const SANDBOX_BODY: string = [
  SANDBOX_HEADER,
  SANDBOX_BINDINGS_BEFORE_REGEX,
  BOUNDED_REGEX_SANDBOX_SOURCE,
  SANDBOX_BINDINGS_AFTER_REGEX,
  SANDBOX_PREPARE,
  'globalThis.__cialloAcornSource = ',
  JSON.stringify(acornSource),
  ';',
  'globalThis.__cialloInstrumentSource = ',
  JSON.stringify(instrumentSource),
  ';',
  SANDBOX_BOOT_AND_LOOP,
].join('\n');
