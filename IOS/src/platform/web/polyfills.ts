/**
 * iOS 16.0 / Safari 16.0 运行时补洞（polyfills）。
 *
 * 部署目标是 **iOS 16.0**（`ios/App/App.xcodeproj/project.pbxproj` 的
 * `IPHONEOS_DEPLOYMENT_TARGET = 16.0`），WKWebView 就是 **Safari 16.0 引擎**。
 * 本文件是兼容性审计（`docs/SAFARI16_COMPAT.md`）落地的那一小块运行时部分；
 * CSS 侧的对策在各 `src/styles/*.css` 末尾追加的
 * `@supports not (color: color-mix(red, blue))` 兜底块里，`build.target`
 * 那一侧在 `vite.config.ts`。
 *
 * ── 审计结论：全仓库**只**有一处真的需要运行时补洞 ──────────────────────────
 *
 * 已确认 **Safari 16.0 原生就有、因此不需要补**（不要在这里重复造轮子）：
 *   `:has()` 15.4 · `@container` 16.0 · `oklch()`/`lab()` 15.4 · `subgrid` 16.0
 *   `dvh`/`svh`/`lvh` 15.4 · `overscroll-behavior` 16.0 · `text-size-adjust`
 *   `AbortSignal.timeout` 16.0 · `structuredClone` 15.4 · `crypto.randomUUID` 15.4
 *   `findLast`/`findLastIndex` 15.4 · `replaceAll` 13.1 · `matchAll` 13
 *   `ResizeObserver` 13.1 · `IntersectionObserver` 12.1 · `Intl.Segmenter` 14.1
 *   `createImageBitmap` 15 · `AudioWorklet` 14.1 · `HTMLDialogElement.showModal`
 *   15.4 · `navigator.share` 15 · `navigator.clipboard` 13.1 · `queueMicrotask` 12
 *   `import.meta` / 顶层 await（ESM，Safari 15 起）
 *
 * 已确认**代码里一次都没用**，所以不用补：
 *   `Object.groupBy` `Map.groupBy` `Array.fromAsync` `Promise.withResolvers`
 *   `toSorted` `toReversed` `toSpliced` `Array.prototype.with` `RegExp` v 标志
 *   `setHTMLUnsafe` `structuredClone` `Object.hasOwn` `Array.prototype.at`
 *   `findLast` `AbortSignal.timeout` `Intl.Segmenter`
 *   （`build.target: 'safari16'` 之后连语法层也不再依赖这些）
 *
 * **补不了、只能如实报错**的（见 `docs/PARITY_EXCEPTIONS.md`）：
 *   `navigator.wakeLock` —— Safari / WKWebView **从来就没有**这个 API（iOS 16.4
 *   才第一次有，且只在部分场景）。`src/platform/capabilities.ts` 的
 *   `createScreenAwakePort()` 已经按「铁律：没有静默降级」抛固定文案。
 *   `showSaveFilePicker` / `showOpenFilePicker` —— File System Access API 是
 *   Chromium 专有，Safari 没有。当前没有生产调用方（见兼容文档）。
 *
 * ── 本文件唯一补的东西：`crypto.randomUUID` ─────────────────────────────────
 *
 * `Crypto.randomUUID()` 是 **secure-context-only** 的（无 `crypto.subtle` 的
 * 同一条限制）。Capacitor iOS 的本地服务器跑在自定义 scheme
 * `capacitor://localhost` 上，而自定义 scheme **不算 secure context**
 * （ionic-team/capacitor#3418：Cookie 的 `Secure` 属性因此报错、`crypto.subtle`
 * 因此是 `undefined`）。本仓库有 6 处**无守卫**的直接调用：
 *
 *   `src/core/source/importer/sourceImporter.ts` L356 / L602
 *   `src/core/source/js/jsMessageHandler.ts` L636
 *   `src/core/comic/comicSettingsStore.ts` L418
 *   `src/core/library/libraryBookShare.ts` L216
 *   `src/core/library/libraryComicLocalImporter.ts` L551
 *   `src/platform/web/jsSourcePlatform.ts` L873
 *
 * 真机上如果 `randomUUID` 不存在，它们会抛 `TypeError: crypto.randomUUID is not
 * a function` —— 表现为「导入自定义书源 / 分享书籍 / 导入本地漫画」莫名其妙失败。
 * `crypto.getRandomValues` 没有 secure-context 限制，所以用它按 RFC 4122 v4 的
 * 位布局拼出同样的字符串（`appUpdateStore.ts` L202-211 的 `randomUuid()` 本来就
 * 是这个思路，只是它没被装回 `crypto` 上）。
 *
 * 幂等：原生有就**一个字节都不动**（Safari 16.0 桌面 / iOS 16.4+ 都走原生）。
 */

/** `Crypto.randomUUID` 的签名（lib.dom 里是模板字面量类型）。 */
type RandomUuid = () => `${string}-${string}-${string}-${string}-${string}`;

const HEX = '0123456789abcdef';

/** 用 `crypto.getRandomValues` 造一个 RFC 4122 §4.4 的 v4 UUID。 */
function uuidV4FromGetRandomValues(getRandomValues: Crypto['getRandomValues']): string {
  const bytes = getRandomValues(new Uint8Array(16));
  // version = 4 (§4.4.1.2) / variant = 10xx (§4.4.1.1)
  const v6 = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  const v8 = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  bytes[6] = v6;
  bytes[8] = v8;
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    const b = bytes[i] ?? 0;
    out += HEX[b >> 4];
    out += HEX[b & 0x0f];
  }
  return out;
}

/** 是否已经装过（防止多次 import 重复定义）。 */
let installed = false;

/**
 * 幂等地把 `crypto.randomUUID` 补上。原生存在时**不做任何事**。
 *
 * @returns 是否真的装了补洞（`false` = 原生就有，或根本没有 WebCrypto）。
 */
export function installSafari16Polyfills(): boolean {
  if (installed) return false;
  installed = true;

  const scope = globalThis as { crypto?: Crypto };
  const webCrypto = scope.crypto;
  if (webCrypto === undefined) return false; // 宿主坏了：让调用方自己抛错，别静默
  if (typeof webCrypto.randomUUID === 'function') return false; // 原生有，不碰
  if (typeof webCrypto.getRandomValues !== 'function') return false;

  const uuid: RandomUuid = () =>
    uuidV4FromGetRandomValues(webCrypto.getRandomValues.bind(webCrypto)) as ReturnType<RandomUuid>;
  // `getRandomValues` 是 WebIDL 方法，必须保留 `crypto` 作为接收者，
  // 所以这里先 bind 再赋值（与 libraryBookShare.ts L212-216 同一个坑）。
  Object.defineProperty(webCrypto, 'randomUUID', {
    value: uuid,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return true;
}

/**
 * 当前环境到底缺什么 —— 只给 `docs/SAFARI16_COMPAT.md` 与人工排查用，
 * 不要在业务代码里调用（会读 `performance` 之类不该在渲染期碰的东西）。
 */
export function safari16RuntimeGaps(): readonly string[] {
  const gaps: string[] = [];
  const scope = globalThis as { crypto?: Crypto };
  if (typeof scope.crypto?.randomUUID !== 'function') gaps.push('crypto.randomUUID');
  return gaps;
}

// 作为 `<script type="module">` 的副作用入口被 import 时自动执行一次。
installSafari16Polyfills();