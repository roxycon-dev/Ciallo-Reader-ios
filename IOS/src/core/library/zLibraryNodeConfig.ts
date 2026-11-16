/**
 * Kotlin → TS: `library/ZLibraryNodeConfig.kt` (15 lines total / 14 non-blank)
 *             → `src/core/library/zLibraryNodeConfig.ts`
 *
 * Line mapping (every Kotlin line accounted for):
 *   L1         package com.example.library                    → SKIPPED (TS has no packages)
 *   L3-11      KDoc 当前使用的 Z-Library 节点…（含 v1.0.1 整合适配的历史说明，
 *              `ZLibraryEndpointProvider.getEndpoint` 第 0 步的优先级说明）
 *                                                          → preserved verbatim on `ZLibraryNodeConfig`
 *   L12        object ZLibraryNodeConfig                    → `export const ZLibraryNodeConfig`
 *              (a mutable slot cannot be a namespace object in TS, so the slot lives in the
 *               module and the object exposes it through a get/set accessor pair)
 *   L13        @Volatile                                    → SKIPPED: JVM-only visibility hint;
 *              JS is single-threaded, every read observes the last written value (documented
 *              in `src/core/source/zlibrary/encryptedCookieJar.ts` the same way)
 *   L14        var domain: String = ""                      → the module-level `currentDomain`
 *              slot, initialised to the empty string, PLUS the four exported accessors
 *              (`ZLibraryNodeConfig.domain`, `nodeDomain()`, `setNodeDomain()`,
 *              `createNodeConfigPort()`) so the already-ported callers in
 *              `src/core/source/zlibrary/*` can be wired to it without editing them.
 *   L15        closing brace                                → n/a
 *
 * ADAPTATION — the throwing getter contract (documented, preserved):
 *   `src/core/source/zlibrary/zLibraryHost.ts` declares
 *   `ZLibraryNodeConfigPort.nodeDomain(): string` with the note "may throw — the Kotlin call
 *   sites use `runCatching { }`". Android had a real reason for that: `ZLibraryNodeConfig`
 *   is a Kotlin `object` initialised during class loading, and a read that raced (or ran
 *   before) that initialisation threw `ExceptionInInitializerError` / `NoClassDefFoundError`.
 *   In ES modules the binding is initialised before any importer can observe it, so THIS
 *   getter never throws — but the port is deliberately declared as an interface so a host may
 *   still supply a throwing implementation, and every `try/catch` fallback already written in
 *   `zLibraryEndpointProvider.ts` (L288-294 `adoptLiveNode`, L319-325 `getEndpoint`),
 *   `encryptedCookieJar.ts` (L136-140 `loadForRequest`) and `zLibrarySource.ts` is KEPT.
 *
 * The empty-string initial value is load-bearing and must not be "fixed" to a default domain:
 * `ZLibraryEndpointProvider.getEndpoint` step 0 treats "" as "the user has not chosen yet" and
 * falls through to the custom endpoint / cache / scan chain, and `EncryptedCookieJar
 * .loadForRequest` falls back to the domain stored with the account. `MainActivity` restores
 * the real value by calling `ZLibraryNodeManager.restoreSelection()` at startup
 * (see `zLibraryNodeManager.ts`).
 */

import type { ZLibraryNodeConfigPort } from '../source/zlibrary/zLibraryHost';

/** Kotlin L14 — `@Volatile var domain: String = ""`. */
let currentDomain = '';

/**
 * 当前使用的 Z-Library 节点（可在诊断页一键切换）。
 * 书库隐藏会话实时读取该值，切换后立即生效。
 *
 * 初始值为空串 =「尚未恢复用户选择」：App 启动时 MainActivity 调
 * [ZLibraryNodeManager.restoreSelection] 从 SharedPreferences 恢复。
 * 修复（v1.0.1 整合适配）：原初始值 "z-library.sk" 是已死域名，且在恢复前
 * 会遮蔽缓存/自定义端点的优先级（ZLibraryEndpointProvider.getEndpoint 第 0 步）。
 */
export const ZLibraryNodeConfig = {
  /** Kotlin `ZLibraryNodeConfig.domain` read. */
  get domain(): string {
    return currentDomain;
  },
  /** Kotlin `ZLibraryNodeConfig.domain = …`. */
  set domain(value: string) {
    currentDomain = value;
  },
};

/**
 * Kotlin `ZLibraryNodeConfig.domain` — the read used by `ZLibraryNativeSession.domain`
 * (`zLibraryNativeSession.ts`) and by any port that needs a plain function.
 */
export function nodeDomain(): string {
  return currentDomain;
}

/** Kotlin `ZLibraryNodeConfig.domain = domain`. */
export function setNodeDomain(domain: string): void {
  currentDomain = domain;
}

/**
 * The real `ZLibraryNodeConfigPort` for `src/core/source/zlibrary/*`:
 * `ZLibraryEndpointProvider(store, nodeConfig, nodeManager, …)`.
 *
 * Ported verbatim so no caller needs editing; a host that wants a different backing store
 * (e.g. a setting mirror) implements the same two methods itself.
 */
export function createNodeConfigPort(): ZLibraryNodeConfigPort {
  return {
    nodeDomain,
    setNodeDomain,
  };
}

/**
 * Kotlin `Context.MODE_PRIVATE` counterpart for the node store opened by the host:
 * `getSharedPreferences(PREFS_NAME, MODE_PRIVATE)` where `PREFS_NAME = "zlib_node_manager"`
 * (see `zLibraryNodeManager.ts`). `MODE_PRIVATE` has no TS equivalent — a browser/
 * WKWebView storage bucket is private to the origin by definition — so the name is all the
 * platform layer needs.
 */
export const NODE_PREFS_PRIVATE = true;