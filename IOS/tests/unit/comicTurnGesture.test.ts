import { describe, expect, it } from 'vitest';
import {
  comicTurnIntent,
  comicTurnTravel,
  pagerThreshold,
} from '@core/comic/comicTurnGesture';

/**
 * 期望值全部按 Kotlin 源码的**字面量**推演，不是「跑出来的快照」。
 * Kotlin 源：ui/comic/ComicTurnGesture.kt L9-27。
 */

describe('comicTurnGesture (Kotlin ComicTurnGesture.kt)', () => {
  describe('comicTurnTravel (L16-17)', () => {
    it('clamps to the 64..104 dp band at density 1', () => {
      // spanPx * 0.18 → 100*0.18 = 18 → coerceIn(64, 104) = 64
      expect(comicTurnTravel(100, 1)).toBe(64);
      // 1000*0.18 = 180 → coerceIn(64, 104) = 104
      expect(comicTurnTravel(1000, 1)).toBe(104);
      // 500*0.18 = 90 → in band
      expect(comicTurnTravel(500, 1)).toBe(90);
    });

    it('scales the band with density', () => {
      expect(comicTurnTravel(100, 3)).toBe(64 * 3);
      // 1000 * .18 = 180 is below the 192px lower bound at density 3.
      expect(comicTurnTravel(1000, 3)).toBe(64 * 3);
      expect(comicTurnTravel(3000, 3)).toBe(104 * 3);
    });
  });

  describe('pagerThreshold (L9-13)', () => {
    it('is travel/span clamped to 0.04..0.35', () => {
      // span 500 → travel(1f)=90 → 90/500 = 0.18
      expect(pagerThreshold(500)).toBeCloseTo(0.18, 10);
      // span 1000 → travel=104 → 104/1000 = 0.104
      expect(pagerThreshold(1000)).toBeCloseTo(0.104, 10);
      // span 100 → travel=64 → 64/100 = 0.64 → clamped to 0.35
      expect(pagerThreshold(100)).toBe(0.35);
    });

    it('never returns below the 0.04 floor', () => {
      // span 5000 → travel=104 → 0.0208 → clamped up to 0.04
      expect(pagerThreshold(5000)).toBe(0.04);
    });

    it('treats a non-positive span as 1 (coerceAtLeast(1f))', () => {
      expect(pagerThreshold(0)).toBe(pagerThreshold(1));
      expect(pagerThreshold(-5)).toBe(pagerThreshold(1));
    });
  });

  describe('comicTurnIntent (L19-27)', () => {
    const density = 1;

    it('returns 0 for non-finite or non-positive inputs', () => {
      expect(comicTurnIntent(Number.NaN, 100, 500, 1)).toBe(0);
      expect(comicTurnIntent(100, Number.POSITIVE_INFINITY, 500, 1)).toBe(0);
      expect(comicTurnIntent(100, 100, 0, 1)).toBe(0);
      expect(comicTurnIntent(100, 100, 500, 0)).toBe(0);
    });

    it('rejects a gesture that reverses against its own velocity', () => {
      // distance > 0 but velocity < 0 and |v| >= 850 → reversed → 0
      expect(comicTurnIntent(120, -900, 500, density)).toBe(0);
      // …and the mirror case
      expect(comicTurnIntent(-120, 900, 500, density)).toBe(0);
    });

    it('accepts a far drag (distance >= travel)', () => {
      // travel(500,1) = 90 → distance 100 is far, direction +1
      expect(comicTurnIntent(100, 0, 500, density)).toBe(1);
      expect(comicTurnIntent(-100, 0, 500, density)).toBe(-1);
    });

    it('accepts a flick below the travel distance when velocity agrees', () => {
      // distance 30 (>= 18*density), |v| 900 (>= 850), same sign → flick
      expect(comicTurnIntent(30, 900, 500, density)).toBe(1);
      expect(comicTurnIntent(-30, -900, 500, density)).toBe(-1);
    });

    it('rejects a slow short drag that is neither far nor a flick', () => {
      expect(comicTurnIntent(30, 100, 500, density)).toBe(0);
      // velocity agrees but is below the 850 gate
      expect(comicTurnIntent(30, 800, 500, density)).toBe(0);
      // distance agrees but is below the 18 gate
      expect(comicTurnIntent(10, 900, 500, density)).toBe(0);
    });

    it('sign(0) → 0 (Kotlin `sign(0f).toInt()`)', () => {
      expect(comicTurnIntent(0, 0, 500, density)).toBe(0);
    });
  });
});
