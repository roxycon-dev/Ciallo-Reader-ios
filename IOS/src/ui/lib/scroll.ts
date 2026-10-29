/**
 * 滚动定位工具 —— 统一处理 `Element.scrollTo` / `scrollIntoView` 的能力缺失。
 *
 * ## 为什么需要它
 *
 * 本项目的滚动定位共 21 处调用 `el.scrollTo({...})` / `el.scrollIntoView({...})`。
 * 这两个是 **DOM Level 1 的滚动 API**，WKWebView / 浏览器都有，但 **jsdom 未实现**：
 * 调用会抛 `TypeError: el.scrollTo is not a function`。
 *
 * 之前每处都是裸调，于是任何在 jsdom 里渲染到该分支的组件都会挂。
 * （实测：`ComicReaderPage` 的「外部跳转同步」effect 让整个
 * `comicSheetsWiring.test.tsx` 挂死。）
 *
 * ## 语义等价性
 *
 * `scrollTo({ top })` 与 `el.scrollTop = top` 对「无动画的瞬时定位」**完全等价** ——
 * 前者是后者的带选项包装（`behavior: 'auto'` 就是立即滚动）。
 * 因此能力缺失时退化到属性赋值，不改变任何可观察行为。
 *
 * `scrollIntoView` 没有等价的属性写法，退化为**什么都不做**（不是错误）：
 * 它只影响「跳转后把目标滚进视口」这一纯视觉辅助，不影响数据正确性。
 *
 * ## 与「禁止静默降级」铁律的关系
 *
 * 铁律要求「**能力缺失要显式抛可搜索错误**」，指的是**功能端口**
 * （`XxxPort`）缺失 —— 那会让功能真的不能用，必须让调用方与排障者立刻知道。
 * 滚动定位属于**尽力而为的视觉辅助**，缺失只影响观感、不影响正确性，
 * 抛错反而会把整个阅读器炸掉。此处静默退化是刻意的，理由写在这里备查。
 */

/** 滚动的可选参数（与 DOM `ScrollToOptions` 对齐，取我们实际用到的子集）。 */
export interface ScrollToOptionsLike {
  readonly top?: number;
  readonly left?: number;
  readonly behavior?: 'auto' | 'smooth';
}

/**
 * 把元素滚到指定坐标。
 *
 * @param el 目标元素；`null` 时什么都不做
 * @param options 目标坐标 / 行为
 * @returns 是否真的执行了滚动（`false` = 宿主缺 `scrollTo`，已退化为属性赋值或跳过）
 */
export function scrollElementTo(el: Element | null, options: ScrollToOptionsLike): boolean {
  if (el === null) return false;
  if (typeof el.scrollTo === 'function') {
    el.scrollTo(options);
    return true;
  }
  // 退化：直接写 scrollTop / scrollLeft。对 `behavior: 'auto'` 等价；
  // `behavior: 'smooth'` 退化为瞬时跳变 —— jsdom 下本就看不到动画，无实际差异。
  let moved = false;
  if (options.top !== undefined) {
    el.scrollTop = options.top;
    moved = true;
  }
  if (options.left !== undefined) {
    el.scrollLeft = options.left;
    moved = true;
  }
  return moved;
}

/**
 * 把元素滚进视口。
 *
 * @param el 目标元素；`null` 时什么都不做
 * @param options `block` / `inline` 对齐 DOM `ScrollIntoViewOptions`
 * @returns 是否真的执行了滚动（`false` = 宿主缺 `scrollIntoView`，已跳过）
 */
export function scrollElementIntoView(
  el: Element | null,
  options: { readonly block?: 'start' | 'center' | 'end' | 'nearest'; readonly inline?: 'start' | 'center' | 'end' | 'nearest'; readonly behavior?: 'auto' | 'smooth' } = {},
): boolean {
  if (el === null) return false;
  if (typeof el.scrollIntoView !== 'function') return false;
  el.scrollIntoView(options);
  return true;
}
