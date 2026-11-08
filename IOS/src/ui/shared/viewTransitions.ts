/**
 * E50 —— Shared-element 转场。
 *
 * 权威行为来自 Kotlin（只读参考，不修改）：
 *   - `MainActivity.kt:472` —— `SharedTransitionLayout` 包住整个 `NavHost`，
 *     通过 `CompositionLocalProvider(LocalSharedTransitionScope provides this)`
 *     下发；`NavHost` 的 enter/exit/popEnter/popExit 都是 `fadeIn/fadeOut(tween(250))`。
 *   - `MainActivity.kt:75`  —— `compositionLocalOf<SharedTransitionScope?>`，为 `null`
 *     时共享元素静默退化成普通淡入淡出（Compose 官方就是这个降级语义）。
 *   - `ui/HomeScreen.kt:185` —— 页面通过 `LocalSharedTransitionScope.current` 取 scope。
 *   - `ui/HomeScreen.kt:1554-1555` —— `boxModifier.sharedElement(
 *     state = rememberSharedContentState(key = "book_cover_${book.id}"))`。
 *
 * ## 等价实现：View Transitions API
 *
 * Compose 的 `sharedElement` 与 Web 的 **View Transitions** 是同一套抽象的两种实现：
 * 都是「标记一个元素 → 导航时让同一 key 的新旧两个元素做位置/尺寸插值动画」。
 * 映射关系：
 *
 * | Compose | Web View Transitions |
 * |---|---|
 * | `SharedTransitionLayout` | `document.startViewTransition(fn)` |
 * | `rememberSharedContentState(key = "book_cover_42")` | CSS `view-transition-name: book-cover-42` |
 * | `sharedElement(state = …)` | 该元素在同一帧内存在于新旧两个 DOM 快照 |
 * | `SharedTransitionScope` 为 `null` → 静默退化 | `startViewTransition` 不存在 → 直接执行 `fn()` |
 * | `fadeIn(tween(250))`（NavHost 层） | 由 CSS `::view-transition-old/new(root)` 动画控制 |
 *
 * ## 降级策略（与 Compose 严格一致）
 *
 * Compose 在 `LocalSharedTransitionScope == null` 时**不报错**、只退化成普通转场。
 * 本实现同样：`startViewTransition` 不可用时直接同步执行回调，不抛错 ——
 * 这样在旧 WebView / 测试环境（jsdom 无 ViewTransitions）下功能仍完整。
 */

/** 一对「共享元素」的唯一名字。 */
export type SharedElementKey = string;

/**  book's cover key —— `HomeScreen.kt:1555` 的 `book_cover_${book.id}`。 */
export function bookCoverKey(bookId: number | string): SharedElementKey {
  return `book-cover-${bookId}`;
}

/**
 * `document.startViewTransition` 的存在性探测。
 *
 * lib.dom 已有完整 `Document.startViewTransition` 类型（返回 `ViewTransition`），
 * 但**旧 WebView / jsdom** 上该方法不存在 —— 故这里只在调用点做 `typeof` 收窄，
 * 而不是自己再声明一份接口（之前自定义 `metadata: unknown` 那版正因如此与真实
 * 类型不兼容）。
 */
function hasViewTransition(doc: Document): doc is Document & {
  startViewTransition: (cb: () => void | Promise<void>) => ViewTransition;
} {
  return typeof (doc as { startViewTransition?: unknown }).startViewTransition === 'function';
}

/** 动画时长：Kotlin `NavHost` 的 `tween(250)`。 */
export const SHARED_ELEMENT_FADE_MS = 250;

/**
 * CSS 侧需要的样式 —— `view-transition-name` 必须**唯一且在快照期间存在**。
 *
 * 必须写成样式表而非内联：View Transitions 抓快照时读的是**计算样式**，
 * 内联 style 会被算进去但优先级管理更脆；放样式表更接近 Compose 的
 * 「scope 在组合期就绑定好元素」的语义。
 */
export const SHARED_ELEMENT_STYLE_ID = 'ciallo-shared-elements';

/**
 * 把共享元素的名字写进 CSS 规则。
 *
 * @param name 元素名 —— 需与调用处的 `data-shared-element` 一致
 */
function cssEscape(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/gu, '\\$&');
}

/** 元素 props：把共享元素标记名挂到 DOM 上。 */
export interface SharedElementProps {
  /** 共享名（用 `bookCoverKey()` 之类的工厂函数生成）。 */
  'data-shared-element': SharedElementKey;
}

/** 一次转场中同一 key 只应出现一次；重复会被浏览器拒绝并跳过整场动画。 */
function ensureUniqueNames(): void {
  if (typeof document === 'undefined') return;
  const seen = new Map<string, number>();
  const nodes = document.querySelectorAll('[data-shared-element]');
  for (const node of nodes) {
    const key = node.getAttribute('data-shared-element');
    if (key === null || key === '') continue;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) continue;
    // ⚠️ 重复 key：View Transitions 规范要求同一时刻一个 name 只对应一个元素，
    // 否则浏览器**整场动画被跳过**。这里把重复项改成 instance 化的名字，
    // 保证「重复的那张封面」仍能各自独立转场，而不是让整场动画失效。
    node.setAttribute('data-shared-element', `${key}--dup${n - 1}`);
  }
}

/**
 * 在一次 DOM 更新（通常是导航）外面套上 shared-element 转场。
 *
 * 对齐 Compose：`SharedTransitionLayout` 的 scope 由外层提供，
 * 内层各处 `sharedElement` 自动参与；本函数是 Web 侧的「外层 scope」。
 *
 * @param update 会改变 DOM 的回调（路由切换、状态翻转等）
 * @returns 转场结束的 Promise；不支持时**立即 resolve**（不抛错）
 */
export async function withSharedElementTransition(
  update: () => void | Promise<void>,
): Promise<void> {
  if (typeof document === 'undefined') {
    await update();
    return;
  }
  const doc = document;
  if (!hasViewTransition(doc)) {
    // Compose：`LocalSharedTransitionScope == null` → 静默退化为普通转场。
    await update();
    return;
  }
  ensureUniqueNames();
  let updatePromise: Promise<void> | null = null;
  const updateOnce = (): Promise<void> => {
    if (updatePromise === null) {
      try { updatePromise = Promise.resolve(update()); }
      catch (error) { updatePromise = Promise.reject(error); }
    }
    return updatePromise;
  };
  let transition: ViewTransition;
  try {
    transition = doc.startViewTransition(updateOnce);
  } catch {
    await updateOnce();
    return;
  }
  // Routing must commit even when WebKit suspends snapshot capture and timers.
  // The route's own entry animation remains available when the snapshot is late.
  await updateOnce();
  // A suspended snapshot in WKWebView must not suspend navigation. Also end a
  // transition whose update ran but whose animation never finishes.
  const watchdog = setTimeout(() => {
    try { transition.skipTransition(); } catch { /* Browser already discarded the snapshot. */ }
    void updateOnce().catch(() => {});
  }, SHARED_ELEMENT_FADE_MS * 2);
  void transition.ready.catch(() => {});
  try {
    await transition.updateCallbackDone;
    await transition.finished;
  } catch {
    // 动画被打断（用户快速连点）不应影响功能 —— 与 Compose 中断转场一致。
    await updateOnce();
  } finally {
    clearTimeout(watchdog);
  }
}

/**
 * 注入共享元素所需的样式表。
 *
 * 两类规则：
 *  1. `[data-shared-element]` 上的 `view-transition-name` 本身 ——
 *     但 name 需要动态取属性值，CSS 做不到，故用**逐条注入**的方式：
 *     每次转场前由 `syncSharedElementStyles()` 把当前页面上的 key 写成规则。
 *  2. 根快照的淡入淡出（对应 Kotlin `NavHost` 的 `fadeIn(tween(250))`）。
 *
 * 之所以不能直接写 `[data-shared-element] { view-transition-name: attr(data-shared-element) }`
 * —— CSS 的 `attr()` 目前只支持 `content` 属性，不支持任意属性值。
 */
export function ensureSharedElementStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SHARED_ELEMENT_STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = SHARED_ELEMENT_STYLE_ID;
  style.textContent = [
    // Kotlin NavHost L475-478：四个方向都是 250ms 的 fade。
    `::view-transition-old(root),::view-transition-new(root){`,
    `animation-duration:${SHARED_ELEMENT_FADE_MS}ms;`,
    `animation-timing-function:cubic-bezier(0.2,0,0,1);`,
    `}`,
    // 共享元素本身不做整体淡入淡出 —— 它是位置/尺寸插值，
    // 若再叠加 fade 会与 Compose 的 sharedElement 行为不符。
    `::view-transition-group(*){animation-duration:${SHARED_ELEMENT_FADE_MS}ms;}`,
  ].join('\n');
  document.head?.appendChild(style);
}

/**
 * 把当前 DOM 上所有 `[data-shared-element]` 的 key 同步成 `view-transition-name` 规则。
 *
 * 必须在**每次转场前**调用（新页面的元素刚挂载、旧页面的还在 DOM 里）。
 * 重复 key 在这里被消歧（与 `ensureUniqueNames` 同一逻辑，但发生在写入规则前，
 * 顺序上更早，避免规则重复）。
 */
export function syncSharedElementStyles(): void {
  if (typeof document === 'undefined') return;
  ensureSharedElementStyles();
  const style = document.getElementById(SHARED_ELEMENT_STYLE_ID);
  if (style === null) return;

  ensureUniqueNames();
  const seen = new Set<string>();
  const rules: string[] = [];
  const nodes = document.querySelectorAll('[data-shared-element]');
  for (const node of nodes) {
    const key = node.getAttribute('data-shared-element');
    if (key === null || key === '' || seen.has(key)) continue;
    seen.add(key);
    rules.push(`.${cssEscape(key)}{view-transition-name:${cssEscape(key)};}`);
  }
  // 只保留转场相关规则，尾部两行固定保留（根 fade + group 时长）。
  style.textContent = [
    ...rules,
    `::view-transition-old(root),::view-transition-new(root){`,
    `animation-duration:${SHARED_ELEMENT_FADE_MS}ms;`,
    `animation-timing-function:cubic-bezier(0.2,0,0,1);`,
    `}`,
    `::view-transition-group(*){animation-duration:${SHARED_ELEMENT_FADE_MS}ms;}`,
  ].join('\n');
}
