/**
 * Shared source-layer capability shapes for the UI.
 *
 * Kotlin → TS:
 *   `com.example.source.SourceResult` (sealed Success/Error) → `SourceResultLike`
 *   `com.example.source.LoginCredential` → `LoginCredential` (already ported in
 *   `@core/source/loginCredential`, re-exported by the login dialog).
 *
 * The UI never needs the generic `data` payload of a `SourceResult.Success` — it only
 * branches on success vs. error and reads `exception.message` — so the narrowed shape
 * is enough and avoids a second generic instantiation at every call site.
 */

export type SourceResultLike<T> =
  | { kind: 'success'; data: T }
  | { kind: 'error'; exception: Error };

/** Kotlin `com.example.source.SourceLog` (dump / clear) — the debug-log dialog data. */
export interface SourceLogLike {
  dump(): string;
  clear(): void;
}

/**
 * Kotlin `com.example.source.importer.SourceImporter.PRESET_SOURCE_URLS`（L38–43）
 * —— 逐字照抄，三条 URL 与三个中文标签都不差。
 *
 * ⚠️ 同一张表在 `@core/source/importer/sourceImporter` 里也有一份（供
 * `tests/unit/sourceModulesPort.test.ts:308` 断言）。两份必须逐字一致：
 * 本文件保持零 import 的叶子设计，不从 core 转发（那会把 sourceHttp /
 * jsonBookSource / 解析器整条链拖进 UI bundle）。改动任一份都要同步另一份，
 * 且以 Kotlin `SourceImporter.PRESET_SOURCE_URLS` 为唯一真源。
 */
export const PRESET_SOURCE_URLS: ReadonlyArray<readonly [string, string]> = [
  ['https://raw.ixnic.net/XIU2/Yuedu/master/shuyuan', 'XIU2 精品书源（镜像）'],
  ['https://cdn.jsdelivr.net/gh/XIU2/Yuedu@master/shuyuan', 'XIU2 精品书源（CDN）'],
  ['https://raw.githubusercontent.com/XIU2/Yuedu/master/shuyuan', 'XIU2 精品书源（GitHub 直连）'],
];

/** Kotlin `com.example.data.UPDATE_REPOSITORY` (used by the settings page). */
export const UPDATE_REPOSITORY = 'https://github.com/roxycon-dev/Ciallo-Reader';
