/**
 * 批量导入与启动诊断 —— `data/BookImportBatch.kt` L7-47 + `data/StartupDiagnostics.kt`
 * L202-220 + `data/ProcessExitDiagnostics.kt` L9 的逐行移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L7  `data class BookImportProgress(completed, total, fileName)`      → `BookImportProgress`
 *   L9-15 `data class BookImportReport(succeeded, failed, failures)` + `message()` → `BookImportReport`
 *   L18-47 `importBookBatch(items, onProgress, importOne)`：串行、去重、单文件失败不中断
 *                                                                       → `importBookBatch`
 *   `StartupDiagnostics.kt` L202 `diagnosedStartupTask(...)`              → `diagnosedStartupTask`
 *   `StartupDiagnostics.kt` L216 `optionalStartupTask(...)`               → `optionalStartupTask`
 *   `StartupDiagnostics.kt` L76-88 `redact(text)`（六条正则）              → `startupRedact`
 *   `StartupDiagnostics.kt` L180-190 `readLimited(input, max)`             → `readLimitedText`
 *   `ProcessExitDiagnostics.kt` L9-27 `object ProcessExitDiagnostics`      → `ProcessExitDiagnostics`
 *   （`getHistoricalProcessExitReasons` 由 `ProcessExitHistoryPort` 提供 —— 见
 *    `@platform/interfaces`、`platform/web/processExitHistory.ts`、
 *    `platform/ios-native/processExitHistory.ts`）
 *
 * 关键语义（Kotlin 注释 L17 / L37-42）：
 *  · 串行处理以限制内存；每个文件有自己的事务；
 *  · 取消（`CancellationException`）必须**继续向上抛**，不能被计入失败；
 *  · 失败明细最多保留 5 条，其余汇总成「另有 N 本失败」。
 */

import type { ProcessExitHistoryPort, ProcessExitRecord } from '@platform/interfaces';

/** L7 `BookImportProgress`。 */
export interface BookImportProgress {
  readonly completed: number;
  readonly total: number;
  readonly fileName: string;
}

/** L9-15 `BookImportReport` + `message()`。 */
export class BookImportReport {
  constructor(
    readonly succeeded: number,
    readonly failed: number,
    readonly failures: readonly string[],
  ) {}

  /** L10-14 `message()`。 */
  message(): string {
    let out = `导入完成：成功 ${String(this.succeeded)} 本，失败 ${String(this.failed)} 本`;
    if (this.failures.length > 0) out += `\n${this.failures.join('\n')}`;
    if (this.failed > this.failures.length) {
      out += `\n另有 ${String(this.failed - this.failures.length)} 本失败，请检查文件后重试`;
    }
    return out;
  }
}

/** 取消信号（对应 Kotlin `CancellationException`）：必须原样向上抛。 */
export class ImportCancelled extends Error {
  constructor() {
    super('import cancelled');
    this.name = 'ImportCancelled';
  }
}

/**
 * L18-47 `importBookBatch(items, onProgress, importOne)`。
 *
 * @param items 待导入项（`distinct()` 后串行处理）
 * @param onProgress 进度回调（开始 + 解析出文件名后各一次 + 每项结束一次）
 * @param importOne `importOne(item, onResolved)`；`onResolved(name)` 更新文件名
 * @param isCancelled 取消探针（Kotlin `currentCoroutineContext().ensureActive()`）
 */
export async function importBookBatch<T>(
  items: readonly T[],
  onProgress: (progress: BookImportProgress) => void,
  importOne: (item: T, onResolved: (name: string) => void) => Promise<void>,
  isCancelled: () => boolean = () => false,
): Promise<BookImportReport> {
  let succeeded = 0;
  let failed = 0;
  const failures: string[] = [];
  const files = [...new Set(items)];
  for (let index = 0; index < files.length; index += 1) {
    if (isCancelled()) throw new ImportCancelled();
    let name = `文件 ${String(index + 1)}`;
    onProgress({ completed: index, total: files.length, fileName: name });
    try {
      const item = files[index] as T;
      await importOne(item, (resolved) => {
        name = resolved;
        onProgress({ completed: index, total: files.length, fileName: name });
      });
      succeeded += 1;
    } catch (error) {
      if (error instanceof ImportCancelled) throw error;
      failed += 1;
      if (failures.length < 5) {
        const message = error instanceof Error ? error.message : '未知错误';
        failures.push(`${name}：${message}`);
      }
    }
    onProgress({ completed: index + 1, total: files.length, fileName: name });
  }
  return new BookImportReport(succeeded, failed, failures);
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * `data/StartupDiagnostics.kt` L202-220
 * ═══════════════════════════════════════════════════════════════════════════════ */

export interface StartupTaskResult {
  readonly name: string;
  readonly ok: boolean;
  readonly elapsedMs: number;
  readonly error: string | null;
}

/**
 * L202 `diagnosedStartupTask(name, block)`：记录耗时与失败原因，**失败不上抛**
 * （启动路径必须继续），但结果一定进诊断表。
 */
export async function diagnosedStartupTask(
  name: string,
  block: () => Promise<void>,
  record: (result: StartupTaskResult) => void,
  now: () => number = () => performance.now(),
): Promise<StartupTaskResult> {
  const startedAt = now();
  try {
    await block();
    const result: StartupTaskResult = { name, ok: true, elapsedMs: now() - startedAt, error: null };
    record(result);
    return result;
  } catch (error) {
    const result: StartupTaskResult = {
      name,
      ok: false,
      elapsedMs: now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
    record(result);
    return result;
  }
}

/**
 * L216 `optionalStartupTask(name, block)`：可选任务失败完全静默（不记录、不上抛），
 * 只返回是否成功。
 */
export async function optionalStartupTask(
  name: string,
  block: () => Promise<void>,
): Promise<boolean> {
  void name;
  try {
    await block();
    return true;
  } catch {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * `data/StartupDiagnostics.kt` L76-90 / L180-190 —— `redact` 与 `readLimited`
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 这两个纯函数是 `ProcessExitDiagnostics` 的**前置条件**：Kotlin 在拼进程退出
 * 报告时对 `description` 与系统 trace 各调一次 `redact`，trace 还先过一遍
 * `readLimited(128 * 1024)`。此前 iOS 侧两个函数都没有移植，所以「读系统退出历史」
 * 这件事整体无法落地 —— 直接输出原文会把账号、Cookie、邮箱、绝对路径写进导出报告。
 */

/** Kotlin L180 `readLimited(input, max)` 的字节上限（`ProcessExitDiagnostics` 用的是 128 KiB）。 */
export const STARTUP_TRACE_LIMIT_BYTES = 128 * 1024;

/** Kotlin L188 `"\n[trace/file size limit reached]"` —— 截断时必须追加。 */
export const STARTUP_TRACE_TRUNCATED_SUFFIX = '\n[trace/file size limit reached]';

/**
 * Kotlin `StartupDiagnostics.kt:180-190`：
 *
 * ```kotlin
 * internal fun readLimited(input: java.io.InputStream, max: Int): String {
 *     val output = java.io.ByteArrayOutputStream()
 *     val buffer = ByteArray(8192)
 *     var remaining = max
 *     while (remaining > 0) {
 *         val n = input.read(buffer, 0, minOf(buffer.size, remaining))
 *         if (n < 0) break
 *         if (n == 0) break
 *         output.write(buffer, 0, n)
 *         remaining -= n
 *     }
 *     return output.toByteArray().toString(Charsets.UTF_8) +
 *         if (remaining == 0) "\n[trace/file size limit reached]" else ""
 * }
 * ```
 *
 * 端口把「读流」交给平台层，这里只做**按字节截断**：先 `TextEncoder` 取字节，
 * 截到 `max`，再用**非 fatal** 的 `TextDecoder` 解码 —— 与 Kotlin
 * `ByteArray.toString(Charsets.UTF_8)` 对半个多字节字符的处理一致（替换成 U+FFFD），
 * 而不是丢字符。
 */
export function readLimitedText(text: string, max: number = STARTUP_TRACE_LIMIT_BYTES): string {
  const limit = Math.max(0, Math.trunc(max));
  const bytes = new TextEncoder().encode(text);
  if (bytes.length < limit) return new TextDecoder().decode(bytes);
  const sliced = bytes.subarray(0, limit);
  // Kotlin 只在「读满」时追加，这里等价于「原始字节数 >= limit」。
  return new TextDecoder().decode(sliced) + (bytes.length >= limit ? STARTUP_TRACE_TRUNCATED_SUFFIX : '');
}

/**
 * Kotlin `StartupDiagnostics.kt:76-88` `redact(text)` —— 六条正则在**同一顺序**下
 * 逐条替换。顺序是语义的一部分：
 *
 * | # | 正则（Kotlin 原文） | 替换 |
 * |---|---|---|
 * | 1 | `(?i)(?:https?|wss?)://[^\s<>"]+` | `[url]` |
 * | 2 | `(?i)\b(?:authorization\|cookie\|set-cookie\|password\|passwd\|secret\|access[_-]?token\|refresh[_-]?token\|api[_-]?key\|token)\b\s*[:=]\s*[^\r\n]+` | `[credential]` |
 * | 3 | `(?i)\bBearer\s+\S+` | `[credential]` |
 * | 4 | `(?i)\b(?:secret[-_]\S+\|password\|passwd)\b` | `[credential]` |
 * | 5 | `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` | `[email]` |
 * | 6 | `(?:[A-Za-z]:[\\/]\|/(?:data\|storage\|sdcard\|private\|home)/)[^\s"]+` | `[path]` |
 *
 * ⚠️ 第 2 条必须排在第 3/4 条**之前**：`Cookie: Bearer abc` 若先被第 3 条命中，
 * 只会抹掉 `Bearer abc` 而留下 `Cookie: `；反过来整行都变成 `[credential]`。
 */
export function startupRedact(text: string): string {
  return text
    .replace(/(?:https?|wss?):\/\/[^\s<>"]+/gi, '[url]')
    .replace(
      /\b(?:authorization|cookie|set-cookie|password|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|token)\b\s*[:=]\s*[^\r\n]+/gi,
      '[credential]',
    )
    .replace(/\bBearer\s+\S+/gi, '[credential]')
    .replace(/\b(?:secret[-_]\S+|password|passwd)\b/gi, '[credential]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:data|storage|sdcard|private|home)\/)[^\s"]+/g, '[path]');
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * `data/ProcessExitDiagnostics.kt` L9-27
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** Kotlin L12 `getHistoricalProcessExitReasons(packageName, 0, 8)` 的 8 条上限。 */
export const PROCESS_EXIT_MAX_RECORDS = 8;

/** Kotlin L13 `"No process exit records available."`。 */
export const PROCESS_EXIT_EMPTY_REPORT = 'No process exit records available.';

/** Kotlin L26 `"Process exit history unavailable: ${it.javaClass.name}"` 的前缀。 */
export const PROCESS_EXIT_UNAVAILABLE_PREFIX = 'Process exit history unavailable: ';

/** Kotlin L20 `"--- System-provided ANR/native trace ---"`。 */
export const PROCESS_EXIT_TRACE_HEADER = '--- System-provided ANR/native trace ---';

/** Kotlin L23 `"trace unavailable: ${it.javaClass.name}"` 的前缀。 */
export const PROCESS_EXIT_TRACE_UNAVAILABLE_PREFIX = 'trace unavailable: ';

/**
 * Kotlin `ProcessExitDiagnostics.kt:9-27` `object ProcessExitDiagnostics.read(context)`。
 *
 * 逐行语义：
 *  - L11-12 取 `ActivityManager.getHistoricalProcessExitReasons(packageName, 0, 8)`；
 *  - L13 空表 → `"No process exit records available."`；
 *  - L16 每条一行：`time=… pid=… process=… reason=… status=… importance=… pssKiB=… rssKiB=…`；
 *  - L17 `description=` 走 `redact(exit.description.orEmpty())`（空描述也要打一行）；
 *  - L18-23 `traceInputStream` 非空时先 `readLimited(it, 128 * 1024)` 再 `redact`；
 *    读流失败只写 `trace unavailable: <类名>`，**不中断整份报告**；
 *  - L26 整体异常 → `"Process exit history unavailable: <类名>"`。
 *
 * 与 Kotlin 的唯一形态差异：记录由平台端口给出（`ProcessExitRecord`）而不是现场
 * 调 `ActivityManager`，因为 core 不碰平台 API。所有格式化 / 脱敏 / 容错逐条保留。
 */
export class ProcessExitDiagnostics {
  /**
   * @param records 系统给出的退出记录（新的在前）
   * @param maxRecords Kotlin `getHistoricalProcessExitReasons(…, 0, 8)` 的第三个参数
   */
  static read(
    records: readonly ProcessExitRecord[],
    maxRecords: number = PROCESS_EXIT_MAX_RECORDS,
  ): string {
    try {
      const exits = records.slice(0, Math.max(0, Math.trunc(maxRecords)));
      if (exits.length === 0) return PROCESS_EXIT_EMPTY_REPORT;
      const lines: string[] = [];
      for (const exit of exits) {
        lines.push(
          `time=${String(exit.timestamp)} pid=${String(exit.pid)} process=${exit.processName} ` +
            `reason=${String(exit.reason)} status=${String(exit.status)} ` +
            `importance=${String(exit.importance)} pssKiB=${String(exit.pssKiB)} ` +
            `rssKiB=${String(exit.rssKiB)}`,
        );
        lines.push(`description=${startupRedact(exit.description ?? '')}`);
        if (exit.trace !== null) {
          try {
            lines.push(PROCESS_EXIT_TRACE_HEADER);
            lines.push(startupRedact(readLimitedText(exit.trace)));
          } catch (error) {
            // Kotlin `runCatching { … }.onFailure { appendLine("trace unavailable: …") }`
            lines.push(PROCESS_EXIT_TRACE_UNAVAILABLE_PREFIX + errorName(error));
          }
        }
      }
      return `${lines.join('\n')}\n`;
    } catch (error) {
      // Kotlin `.getOrElse { "Process exit history unavailable: ${it.javaClass.name}" }`
      return PROCESS_EXIT_UNAVAILABLE_PREFIX + errorName(error);
    }
  }

  /**
   * 走平台端口拿记录再格式化：`read(ProcessExitHistoryPort)`。
   *
   * 端口自身 reject 时**不外抛**，落到 Kotlin 的
   * `"Process exit history unavailable: <类名>"`，因为诊断路径绝不能把导出按钮打断。
   */
  static async readFromPort(
    port: ProcessExitHistoryPort,
    maxRecords: number = PROCESS_EXIT_MAX_RECORDS,
  ): Promise<string> {
    try {
      const records = await port.read(maxRecords);
      return ProcessExitDiagnostics.read(records, maxRecords);
    } catch (error) {
      return PROCESS_EXIT_UNAVAILABLE_PREFIX + errorName(error);
    }
  }
}

/** Kotlin `it.javaClass.name` —— JS 侧取构造器名，取不到时退回 `Error`。 */
export function errorName(error: unknown): string {
  if (error instanceof Error && error.name !== '') return error.name;
  const ctor = (error as { constructor?: { name?: string } } | null)?.constructor?.name;
  return typeof ctor === 'string' && ctor !== '' ? ctor : 'Error';
}

/**
 * **不是 Kotlin 的东西**：Web / iOS 侧「上一次运行是否异常退出」的界面态记录。
 *
 * 原先把这段直接命名成 `ProcessExitDiagnostics` 并标为
 * `ProcessExitDiagnostics.kt L9` 的移植 —— 语义其实完全不同：Kotlin 那个
 * object 只做「读系统退出历史并脱敏输出」，不记录任何路由。为了让两者不再混用，
 * 路由面包屑保留在这个名字下，Kotlin 的真身回到上面的 `ProcessExitDiagnostics`。
 */
export class RouteExitBreadcrumbs {
  private lastRoute: string | null = null;
  private lastNote: string | null = null;

  setRoute(route: string): void {
    this.lastRoute = route;
  }

  note(key: string, value: string): void {
    this.lastNote = `${key}=${value}`;
  }

  snapshot(): { readonly route: string | null; readonly note: string | null } {
    return { route: this.lastRoute, note: this.lastNote };
  }

  /** Web 侧用 `sessionStorage` 标记：正常卸载会清除该标记。 */
  static crashedLastTime(storage: Pick<Storage, 'getItem'>): boolean {
    return storage.getItem('process-exit-evidence') !== null;
  }
}
