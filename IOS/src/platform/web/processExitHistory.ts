/**
 * 进程退出历史 —— Web 宿主实现（`ProcessExitHistoryPort`）。
 *
 * Android 侧这条数据由系统给：`ActivityManager.getHistoricalProcessExitReasons(
 * packageName, 0, 8)` 返回**系统自己记的**退出原因（被杀 / 崩溃 / 低内存回收），
 * 应用不参与记录，也删不掉。浏览器没有同名 API，这是平台事实，不是移植遗漏。
 *
 * 但「宿主能不能攒出一份」的答案是**能**，而且这正是本实现的落点：
 *   · `RouteExitBreadcrumbs`（`core/data/startupDiagnostics.ts`）在路由切换时把
 *     「最后一屏 + 说明」写进 `sessionStorage`；
 *   · 正常卸载会删掉该键，**异常退出会留下它** —— 于是下一次启动读到它，
 *     就等价于系统那条 `REASON_CRASH` 记录；
 *   · 读不到（首次运行 / 正常退出）就返回空数组，core 走 Kotlin 自己的
 *     `"No process exit records available."` 分支（那条分支本来就在 Kotlin 里）。
 *
 * 因此这里既不是「假装有」，也不是「没有能力」：它把 Web 宿主**真实能观察到**的
 * 那一条退出事件映射成 `ProcessExitRecord`，字段语义与 `ApplicationExitInfo` 对齐。
 *
 * 字段对齐（Android `ApplicationExitInfo` → 本实现）：
 *   `getTimestamp()`   → 证据里的 `timestamp`（缺失时用写入时刻）
 *   `getPid()`         → 0（浏览器不暴露进程号）
 *   `getProcessName()` → `'web'`
 *   `getReason()`      → 4（`REASON_CRASH`；键还在就说明上次没走正常卸载）
 *   `getStatus()`      → 0（无退出码）
 *   `getImportance()`  → 100（`IMPORTANCE_FOREGROUND`）
 *   `getPss()`/`getRss()` → 0（浏览器不暴露内存）
 *   `getDescription()` → 面包屑原文（`route=… note=…`）
 *   `getTraceInputStream()` → null（没有系统级 trace）
 */

import type { ProcessExitHistoryPort, ProcessExitRecord } from '@platform/interfaces';

/** 与 `RouteExitBreadcrumbs.crashedLastTime` 读的是同一个键。 */
export const WEB_EXIT_EVIDENCE_KEY = 'process-exit-evidence';

/** Android `ApplicationExitInfo.REASON_CRASH`。 */
export const REASON_CRASH = 4;

/** Android `ApplicationExitInfo.IMPORTANCE_FOREGROUND`。 */
export const IMPORTANCE_FOREGROUND = 100;

/** `sessionStorage` 里能存的最小形状（写入方是 `RouteExitBreadcrumbs`）。 */
interface ExitEvidence {
  readonly timestamp?: number;
  readonly route?: string | null;
  readonly note?: string | null;
}

function parseEvidence(raw: string | null): ExitEvidence | null {
  if (raw === null || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as ExitEvidence;
  } catch {
    // 早期版本只写了纯文本路由名，没有 JSON 外壳 —— 当成 route 用。
    return { route: raw };
  }
}

/**
 * 浏览器宿主：把「上次没走正常卸载」这一条证据映射成一条退出记录。
 *
 * @param storage 默认 `globalThis.sessionStorage`；拿不到（SSR / 单测未注入）时
 *                视为没有证据 —— 与「首次运行」同一条路径。
 */
export function createWebProcessExitHistoryPort(
  storage?: Pick<Storage, 'getItem'>,
): ProcessExitHistoryPort {
  return {
    async read(maxRecords: number): Promise<readonly ProcessExitRecord[]> {
      if (maxRecords <= 0) return [];
      const store = storage ?? defaultSessionStorage();
      if (store === null) return [];
      const evidence = parseEvidence(store.getItem(WEB_EXIT_EVIDENCE_KEY));
      if (evidence === null) return [];
      const description = [
        evidence.route == null ? null : `route=${evidence.route}`,
        evidence.note == null ? null : `note=${evidence.note}`,
      ]
        .filter((part): part is string => part !== null)
        .join(' ');
      return [
        {
          timestamp: typeof evidence.timestamp === 'number' ? evidence.timestamp : 0,
          pid: 0,
          processName: 'web',
          reason: REASON_CRASH,
          status: 0,
          importance: IMPORTANCE_FOREGROUND,
          pssKiB: 0,
          rssKiB: 0,
          description: description === '' ? null : description,
          trace: null,
        },
      ];
    },
  };
}

function defaultSessionStorage(): Pick<Storage, 'getItem'> | null {
  const holder = globalThis as { sessionStorage?: Pick<Storage, 'getItem'> };
  return holder.sessionStorage ?? null;
}
