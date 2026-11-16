/**
 * Kotlin source: `com.example.source.js.JsSourceEngine.kt` `__boundedRegex` /
 * `__boundedRegexBatch`（L191-238）+ `com.example.source.parser.RuleBudget`
 * （RuleBudget.kt:18-31，`text(input, 500)` 的 2 MiB 守卫与 500ms deadline）。
 *
 * 2026-10-11（SECURITY_AUDIT P0-1~P0-4 / P1-2 / E86）改动说明：
 * - 从 `jsSourceEngine.ts` 整体迁出：Worker 沙箱（`platform/web/jsSandboxBody.ts`）
 *   必须在**沙箱 realm 内部**同步提供这两个绑定（instrument.js 的 `RegExp.exec`
 *   覆盖层会同步调用 `__boundedRegexBatch`，无法走异步 RPC）。为了让核心实现与
 *   沙箱内实现**零漂移**，本模块把整份实现写成**零 import 的自包含函数**，并导出
 *   `BOUNDED_REGEX_SANDBOX_SOURCE`（`Function.prototype.toString` 逐个拼接），
 *   沙箱体与核心引擎用的是同一份代码。
 * - 自包含的代价：`matchObject` 不再走 `./json.ts` 的 org.json 端口，改用
 *   `JSON.stringify` 直接产出。json.ts 的 `toString()` 本身就是
 *   `JSON.stringify(toJSON())`，对这里出现的取值（number / string / null）输出
 *   逐字节一致（键序 = 插入序：index → end → groups）。
 * - E86 收口：正则预算从「入口一次」改成与 `ruleBudget.boundedReplace` 相同的
 *   「两点检查」结构 —— 2 MiB 守卫 → 入口 deadline 检查 → 扫描 → 扫描结束
 *   deadline 检查。Kotlin 靠 `Bounded.get()` 每 256 次字符读取查一次 deadline
 *   在扫描**中途**打断（RuleBudget.kt:24-26）；JS `RegExp` 是原生实现、无法
 *   中途回调，因此灾难性回溯在 TS 上会多烧最多一次完整扫描的 CPU 才抛
 *   `书源正则执行超时`（与 Android 同文案同异常语义），已如实登记 E86。
 * - 沙箱装配约束：本文件内**禁止出现任何模块级 import / 被 listed 函数引用的
 *   模块级常量** —— `Function.prototype.toString` 拼出的源码要在沙箱 realm 里
 *   独立求值，所有被列出的函数只能引用彼此与自身参数（正则预算 500ms 是 Kotlin
 *   `RuleBudget.text(input, 500)` 的字面量，直接内联）。
 */

/**
 * Kotlin `require(cond)` with no message → `IllegalArgumentException("Check failed.")`.
 */
function requireCheck(condition: boolean, message = 'Check failed.'): void {
  if (!condition) throw new Error(message);
}

/** Kotlin `Pattern.CASE_INSENSITIVE|UNICODE_CASE / MULTILINE / DOTALL` mapping. */
function jsFlagsFor(flags: string): string {
  return (flags.includes('i') ? 'i' : '') + (flags.includes('m') ? 'm' : '') + (flags.includes('s') ? 's' : '');
}

/**
 * Kotlin `private fun kotlinToString(value: Any?): String` — `args[i].toString()`.
 * quickjs-kt hands JS numbers over as `Double`, so an integral value prints as
 * `1.0` on Android; `String(1)` would give `1` and change the regex input.
 */
function kotlinToString(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    return `${value}.0`;
  }
  return String(value);
}

/** Kotlin `(args[3] as? Number)?.toInt() ?: 0` — `Double.toInt()` truncates. */
function kotlinToInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * Kotlin's `catch (e: StackOverflowError) { throw IllegalArgumentException("书源正则回溯过深", e) }`
 * wraps the whole matcher usage. JS surfaces catastrophic backtracking as a
 * `RangeError: Maximum call stack size exceeded`; a genuine `SyntaxError`
 * (Java's `PatternSyntaxException`) keeps propagating unchanged.
 */
function withStackOverflowGuard<T>(block: () => T): T {
  try {
    return block();
  } catch (e) {
    if (e instanceof RangeError && /call stack|stack size/i.test(e.message)) {
      throw new Error('书源正则回溯过深', { cause: e });
    }
    throw e;
  }
}

/**
 * Kotlin `java.util.regex.Pattern.compile(pattern, options)` — only the pattern
 * and the flags. The Kotlin call site is
 * `.matcher(com.example.source.parser.RuleBudget.text(input, 500))`, and
 * `RuleBudget.text` is not part of the compiled pattern: it enforces the 2 MiB
 * input guard and opens the 500 ms deadline, which the port does explicitly via
 * `openRegexBudget(input)` before calling this (Kotlin L201/223). A JS
 * `RegExp` has no "matcher over a CharSequence" step, so there is nothing left
 * for `input` to do here.
 */
function compileBounded(pattern: string, flags: string, withG: boolean): RegExp {
  return new RegExp(pattern, jsFlagsFor(flags) + (withG ? 'g' : ''));
}

/** Kotlin `nowElapsed()` — `SystemClock.elapsedRealtime()` 的 Web 近似。 */
function nowElapsed(): number {
  return Date.now();
}

function isDeadlineExceeded(deadline: number): boolean {
  return Date.now() > deadline;
}

/** Kotlin `RuleBudget.text(input, 500)`（RuleBudget.kt:21-23）的入口半边：2 MiB 守卫 + 开表。 */
function openRegexBudget(input: string): number {
  requireCheck(input.length <= 2 * 1024 * 1024, '规则输入超过 2MiB');
  const deadline = nowElapsed() + 500;
  if (isDeadlineExceeded(deadline)) throw new Error('书源正则执行超时');
  return deadline;
}

/** Kotlin `RuleBudget.Bounded.get()` 每 256 次读取的 `check { "书源正则执行超时" }` 的结束半边（E86）。 */
function assertRegexBudget(deadline: number): void {
  if (nowElapsed() > deadline) throw new Error('书源正则执行超时');
}

/**
 * Kotlin `JSONObject().put("index", start()).put("end", end()).put("groups", groups)`
 * — plain-object + `JSON.stringify` 产出与 org.json 端口 `toString()` 逐字节一致
 * （见文件头说明）。
 */
function matchEntry(match: RegExpExecArray, captured?: { total: number }): Record<string, unknown> {
  const groups: unknown[] = [];
  for (let i = 0; i < match.length; i += 1) {
    const group = match[i];
    if (group === undefined) {
      // Kotlin `matcher.group(i) ?: JSONObject.NULL`
      groups.push(null);
    } else {
      if (captured !== undefined) captured.total += group.length;
      groups.push(group);
    }
  }
  return { index: match.index, end: match.index + match[0].length, groups };
}

/**
 * Kotlin `private fun boundedRegex(args)` — single-shot match, JSON string.
 */
export function boundedRegex(args: unknown[]): string {
  const pattern = kotlinToString(args[0]);
  const flags = kotlinToString(args[1]);
  const input = kotlinToString(args[2]);
  const start = kotlinToInt(args[3]);
  requireCheck(pattern.length <= 4096 && input.length <= 2 * 1024 * 1024);
  // `RuleBudget.text(input, 500)` keeps the 2 MiB guard and opens the deadline.
  const deadline = openRegexBudget(input);
  return withStackOverflowGuard(() => {
    // Kotlin builds one matcher and either `lookingAt()` on a region or
    // `find(start)`. The sticky branch anchors at `start`; the scanning branch
    // searches forward from `start`.
    const sticky = flags.includes('y');
    const regex = new RegExp(pattern, jsFlagsFor(flags) + (sticky ? 'y' : 'g'));
    if (start < 0 || start > input.length) return 'null';
    regex.lastIndex = start;
    const match = BOUNDED_NATIVE_REGEX_EXEC.call(regex, input);
    // E86：扫描结束的第二次 deadline 检查（Kotlin 在扫描中途逐 256 字符轮询）。
    assertRegexBudget(deadline);
    if (match === null) return 'null';
    return JSON.stringify(matchEntry(match));
  });
}

/**
 * Kotlin `private fun boundedRegexBatch(args)` — up to 128 matches, JSON array.
 */
export function boundedRegexBatch(args: unknown[]): string {
  const pattern = kotlinToString(args[0]);
  const flags = kotlinToString(args[1]);
  const input = kotlinToString(args[2]);
  const start = kotlinToInt(args[3]);
  requireCheck(pattern.length <= 4096 && input.length <= 2 * 1024 * 1024);
  const out: unknown[] = [];
  // Kotlin's `if (start in 0..input.length)` guard sits OUTSIDE the `try`, so an
  // out-of-range start still returns the (empty) array without compiling.
  if (start < 0 || start > input.length) return '[]';
  const deadline = openRegexBudget(input);
  return withStackOverflowGuard(() => {
    const sticky = flags.includes('y');
    const scanner = compileBounded(pattern, flags, true);
    const sticker = sticky ? new RegExp(pattern, jsFlagsFor(flags) + 'y') : null;
    let position = start;
    const captured = { total: 0 };
    while (out.length < 128) {
      let match: RegExpExecArray | null;
      if (sticky && sticker !== null) {
        // Kotlin `matcher.region(position, input.length); matcher.lookingAt()`
        sticker.lastIndex = position;
        match = BOUNDED_NATIVE_REGEX_EXEC.call(sticker, input);
      } else {
        // Kotlin `if (out.length() == 0) matcher.find(start) else matcher.find()`
        scanner.lastIndex = out.length === 0 ? start : position;
        match = BOUNDED_NATIVE_REGEX_EXEC.call(scanner, input);
      }
      // E86：每轮扫描结束各查一次 deadline。
      assertRegexBudget(deadline);
      if (match === null) break;
      out.push(matchEntry(match, captured));
      position = match.index + match[0].length;
      // Kotlin `if (matcher.start() == matcher.end() || captured >= 65536 ||
      //               'g' !in flags && 'y' !in flags) break`
      if (
        match[0].length === 0 ||
        captured.total >= 65536 ||
        (!flags.includes('g') && !flags.includes('y'))
      ) {
        break;
      }
    }
    return JSON.stringify(out);
  });
}

/** Kotlin `RuleBudget.text(input, 500)` 的 500ms 字面量（仅核心侧读取；沙箱内联）。 */
export const REGEX_BUDGET_MS = 500;

/**
 * 原生 `RegExp.prototype.exec`。
 *
 * Kotlin 侧 `__boundedRegex*` 的实际匹配发生在 **java.util.regex**（沙箱插桩
 * 之外，JsSourceEngine.kt:201/223）；TS 对应物是原生 `RegExp` 引擎。沙箱里
 * instrument.js 会把 `RegExp.prototype.exec` 覆写成「tick + 批处理」入口 ——
 * 若 `boundedRegexBatch` 内部的 `scanner.exec` 也走它，会重新进入
 * `__boundedRegexBatch` 造成无限递归（instrument.js:34 → boundedRegexBatch →
 * scanner.exec → instrument.js:34 …）。因此在**模块装载时**（沙箱体装载顺序：
 * 本模块源码先于 instrument.js 求值）捕获原生实现，匹配语义与 Kotlin 一致地
 * 发生在插桩层之外；预算由本模块自身的「入口 + 扫描结束」deadline 检查承担。
 */
const BOUNDED_NATIVE_REGEX_EXEC: (this: RegExp, input: string) => RegExpExecArray | null =
  RegExp.prototype.exec;

/**
 * 沙箱装配源：上面每一个被列出的函数的源码（`Function.prototype.toString`）。
 * 集合必须是**封闭**的 —— 列出的函数只能引用列表内其它函数与自身参数，
 * 否则拼出的源码在沙箱 realm 里会引用到不存在的名字。
 * `jsSandboxBody.ts` 把这段源码与 acorn/instrument 资产一起拼进沙箱体；
 * 防漂移由 `tests/unit/jsSandbox.test.ts` 的「核心实现 ≡ 沙箱实现」parity 测试钉死。
 */
const BOUNDED_REGEX_SANDBOX_PRELUDE =
  'var BOUNDED_NATIVE_REGEX_EXEC = RegExp.prototype.exec;';

const SANDBOX_FUNCTION_SOURCES: Array<(...args: never[]) => unknown> = [
  requireCheck as (...args: never[]) => unknown,
  jsFlagsFor as (...args: never[]) => unknown,
  kotlinToString as (...args: never[]) => unknown,
  kotlinToInt as (...args: never[]) => unknown,
  withStackOverflowGuard as (...args: never[]) => unknown,
  compileBounded as (...args: never[]) => unknown,
  nowElapsed as (...args: never[]) => unknown,
  isDeadlineExceeded as (...args: never[]) => unknown,
  openRegexBudget as (...args: never[]) => unknown,
  assertRegexBudget as (...args: never[]) => unknown,
  matchEntry as (...args: never[]) => unknown,
  boundedRegex as (...args: never[]) => unknown,
  boundedRegexBatch as (...args: never[]) => unknown,
];

export const BOUNDED_REGEX_SANDBOX_SOURCE: string = [
  BOUNDED_REGEX_SANDBOX_PRELUDE,
  ...SANDBOX_FUNCTION_SOURCES.map((fn) => String(fn)),
].join('\n');
