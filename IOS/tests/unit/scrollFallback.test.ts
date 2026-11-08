/**
 * `scrollElementTo` / `scrollElementIntoView` 的契约测试。
 *
 * 重点锁两件事：
 *  ① 宿主**有**滚动 API 时走原生路径（参数原样透传，不被改写）；
 *  ② 宿主**没有**时（jsdom 默认如此）退化到属性赋值 / 跳过，且**不抛错** ——
 *     这正是 `comicSheetsWiring.test.tsx` 挂死过的那个坑。
 */

import { describe, expect, it, vi } from 'vitest';

import { scrollElementIntoView, scrollElementTo } from '@ui/lib/scroll';

function makeEl(): HTMLDivElement {
  return document.createElement('div');
}

describe('scrollElementTo', () => {
  it('宿主有 scrollTo 时原样透传参数并返回 true', () => {
    const el = makeEl();
    const spy = vi.fn();
    Object.defineProperty(el, 'scrollTo', { value: spy, configurable: true });

    expect(scrollElementTo(el, { top: 120, behavior: 'auto' })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ top: 120, behavior: 'auto' });
  });

  it('宿主无 scrollTo 时退化为 scrollTop 赋值且不抛错（jsdom 场景）', () => {
    const el = makeEl();
    // jsdom 的 HTMLElement 上 scrollTo 是 undefined —— 显式确认前提
    expect((el as { scrollTo?: unknown }).scrollTo).toBeUndefined();

    expect(scrollElementTo(el, { top: 240 })).toBe(true);
    expect(el.scrollTop).toBe(240);
  });

  it('宿主无 scrollTo 时 scrollLeft 也能退化赋值', () => {
    const el = makeEl();
    expect((el as { scrollTo?: unknown }).scrollTo).toBeUndefined();

    expect(scrollElementTo(el, { left: 60 })).toBe(true);
    expect(el.scrollLeft).toBe(60);
  });

  it('top + left 同时给出时两者都写', () => {
    const el = makeEl();
    expect((el as { scrollTo?: unknown }).scrollTo).toBeUndefined();

    scrollElementTo(el, { top: 10, left: 20 });
    expect(el.scrollTop).toBe(10);
    expect(el.scrollLeft).toBe(20);
  });

  it('宿主有 scrollTo 时优先用原生，不写 scrollTop', () => {
    const el = makeEl();
    const spy = vi.fn();
    Object.defineProperty(el, 'scrollTo', { value: spy, configurable: true });

    scrollElementTo(el, { top: 300 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(el.scrollTop).toBe(0); // 没被属性赋值污染
  });

  it('元素为 null 时返回 false 且不抛错', () => {
    expect(scrollElementTo(null, { top: 10 })).toBe(false);
  });

  it('空 options + 无 scrollTo 时返回 false（没有任何可写坐标）', () => {
    const el = makeEl();
    expect((el as { scrollTo?: unknown }).scrollTo).toBeUndefined();
    expect(scrollElementTo(el, {})).toBe(false);
  });

  it('behavior smooth 在退化路径下不报错（退化为瞬时，jsdom 本就无动画）', () => {
    const el = makeEl();
    expect((el as { scrollTo?: unknown }).scrollTo).toBeUndefined();
    expect(scrollElementTo(el, { top: 88, behavior: 'smooth' })).toBe(true);
    expect(el.scrollTop).toBe(88);
  });
});

describe('scrollElementIntoView', () => {
  it('宿主有 scrollIntoView 时透传参数并返回 true', () => {
    const el = makeEl();
    const spy = vi.fn();
    Object.defineProperty(el, 'scrollIntoView', { value: spy, configurable: true });

    expect(scrollElementIntoView(el, { block: 'center' })).toBe(true);
    expect(spy).toHaveBeenCalledWith({ block: 'center' });
  });

  it('宿主无 scrollIntoView 时跳过并返回 false，不抛错', () => {
    const el = makeEl();
    expect((el as { scrollIntoView?: unknown }).scrollIntoView).toBeUndefined();
    expect(scrollElementIntoView(el, { block: 'start' })).toBe(false);
  });

  it('元素为 null 时返回 false', () => {
    expect(scrollElementIntoView(null, { block: 'start' })).toBe(false);
  });

  it('不传 options 时调用原生 scrollIntoView()（无参）', () => {
    const el = makeEl();
    const spy = vi.fn();
    Object.defineProperty(el, 'scrollIntoView', { value: spy, configurable: true });

    expect(scrollElementIntoView(el)).toBe(true);
    expect(spy).toHaveBeenCalledWith({});
  });
});
