import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE_TRANSITION,
  FADE_KIND,
  NAV_FADE_MS,
  NOOP_KIND,
  PAGE_EASE_CSS,
  ROUTES,
  SLIDE_IN_KIND,
  routeEnterDurationMs,
  routeEnterKeyframes,
  routeTransition,
} from '../../src/core/app/navigation';
import {
  PAPER_PAGE_COVERED_FRACTION,
  PAPER_PAGE_EASE,
  paperPageDirectionSpec,
} from '../../src/ui/shared/pullOutHosts';

/**
 * `NavHost` 的四个默认转场在 Android 是 `PullOutHosts.kt:151-175` 的 `paperPage*`
 * （`MainActivity.kt:629-662` 直接传给 `NavHost`），**不是** 250 ms fade。
 *
 * 本文件把两侧数值钉在一起：`core` 不能 import `ui`（`coreLayerPurity`），所以常量
 * 各写一份，靠这条测试保证不会漂移。同时钉住「只有 god_editor 覆盖默认」这一事实：
 * 本树 `MainActivity.kt` 里唯一的 per-route `enterTransition` 就是
 * `composable("god_editor", …)` 的四个 `None`（L1360-1363）。
 */
describe('NavHost default transition = paperPage* (PullOutHosts.kt L151-175)', () => {
  it('uses the same easing on both sides', () => {
    expect(PAGE_EASE_CSS).toBe(PAPER_PAGE_EASE);
    expect(PAGE_EASE_CSS).toBe('cubic-bezier(0.18, 1, 0.04, 1)');
  });

  const cases = [
    ['enter', DEFAULT_ROUTE_TRANSITION.enter, 420, 1, 0],
    ['exit', DEFAULT_ROUTE_TRANSITION.exit, 420, 0, -PAPER_PAGE_COVERED_FRACTION],
    ['popEnter', DEFAULT_ROUTE_TRANSITION.popEnter, 320, -PAPER_PAGE_COVERED_FRACTION, 0],
    ['popExit', DEFAULT_ROUTE_TRANSITION.popExit, 320, 0, 1],
  ] as const;

  for (const [direction, parts, ms, fromFraction, toFraction] of cases) {
    it(`${direction}: ${ms} ms, from ${fromFraction} to ${toFraction}`, () => {
      expect(parts).toHaveLength(1);
      const part = parts[0];
      expect(part?.kind).toBe(SLIDE_IN_KIND);
      expect(part?.ms).toBe(ms);
      expect(part?.easing).toBe(PAGE_EASE_CSS);
      expect(part?.value).toBe(fromFraction);
      expect(part?.toFraction).toBe(toFraction);
      const spec = paperPageDirectionSpec(direction);
      expect(spec.ms).toBe(ms);
      expect(spec.easing).toBe(PAPER_PAGE_EASE);
      expect(spec.fromFraction).toBe(fromFraction);
      expect(spec.toFraction).toBe(toFraction);
    });
  }

  it('no longer claims the 250 ms fade default', () => {
    expect(DEFAULT_ROUTE_TRANSITION.enter.some((part) => part.kind === FADE_KIND)).toBe(false);
    expect(routeEnterDurationMs(DEFAULT_ROUTE_TRANSITION.enter)).toBe(420);
    expect(routeEnterDurationMs(DEFAULT_ROUTE_TRANSITION.popEnter)).toBe(320);
    expect(routeEnterDurationMs(DEFAULT_ROUTE_TRANSITION.enter)).not.toBe(NAV_FADE_MS);
  });

  it('enter slides in from the right edge and never fades', () => {
    const [from, to] = routeEnterKeyframes(DEFAULT_ROUTE_TRANSITION.enter);
    expect(from).toStrictEqual({ transform: 'translateX(100.0000%)' });
    expect(to).toStrictEqual({ transform: 'translateX(0.0000%)' });
  });

  it('popEnter starts one third to the left', () => {
    const [from, to] = routeEnterKeyframes(DEFAULT_ROUTE_TRANSITION.popEnter);
    expect(from).toStrictEqual({ transform: 'translateX(-33.3333%)' });
    expect(to).toStrictEqual({ transform: 'translateX(0.0000%)' });
  });

  it('reader / comicReader / comicChapters no longer override the default', () => {
    const names = [
      ROUTES.reader,
      ROUTES.comicReader,
      ROUTES.comicChapters,
      ROUTES.comicReaderOnline,
      ROUTES.novelReaderOnline,
    ] as const;
    for (const name of names) {
      expect(routeTransition(name)).toBe(DEFAULT_ROUTE_TRANSITION);
    }
  });

  it('godEditor maps to EnterTransition.None, i.e. zero-duration noop parts', () => {
    for (const direction of ['enter', 'exit', 'popEnter', 'popExit'] as const) {
      const spec = routeTransition(ROUTES.godEditor)[direction];
      expect(spec).toHaveLength(1);
      expect(spec[0]?.kind).toBe(NOOP_KIND);
      expect(routeEnterDurationMs(spec)).toBe(0);
    }
  });

  it('a noop spec produces no transform keyframes', () => {
    const [from, to] = routeEnterKeyframes(routeTransition(ROUTES.godEditor).enter);
    expect(from).toStrictEqual({});
    expect(to).toStrictEqual({});
  });

  it('an exit direction expresses its target fraction', () => {
    const [from, to] = routeEnterKeyframes([
      { kind: SLIDE_IN_KIND, ms: 420, value: 0, toFraction: -1 / 3, easing: PAGE_EASE_CSS },
    ]);
    expect(from).toStrictEqual({ transform: 'translateX(0.0000%)' });
    expect(to).toStrictEqual({ transform: 'translateX(-33.3333%)' });
  });
});
