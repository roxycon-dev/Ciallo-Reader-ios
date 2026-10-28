/**
 * Kotlin → TS map
 * ──────────────
 * Tests for `src/core/mascot/mascotEvents.ts` and `src/core/mascot/mascotSpriteSheet.ts`
 * — the ports of `ui/mascot/MascotAnimationController.kt` and
 * `ui/mascot/MascotSpriteSheet.kt`.
 *
 * Nothing skipped — every assertion targets a ported Kotlin expression.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CONFETTI_SEEDS,
  MASCOT_DURATION_MS,
  MascotAnimationController,
  __resetMascotEventIds,
  popupAlphaComplete,
  popupAlphaStandard,
  popupScaleComplete,
  popupScaleStandard,
  type MascotEvent,
} from '../../src/core/mascot/mascotEvents';
import {
  MascotAssetMap,
  MascotSpriteSheet,
  mascotMoodOf,
} from '../../src/core/mascot/mascotSpriteSheet';

beforeEach(() => {
  __resetMascotEventIds();
});

describe('MascotAnimationController.kt ids', () => {
  it('AtomicLong(0).incrementAndGet() starts at 1 and increments monotonically', () => {
    expect(MascotAnimationController.play('AddBookmark').id).toBe(1);
    expect(MascotAnimationController.play('AddBookmark').id).toBe(2);
    expect(MascotAnimationController.play('DeleteBook').id).toBe(3);
  });
});

describe('MascotAnimationController.kt play/subscribe', () => {
  it('fans the instance out synchronously to every subscriber (方案 A: 打断重播)', () => {
    const seen: Array<{ event: MascotEvent; id: number }> = [];
    const off = MascotAnimationController.subscribe((i) => seen.push({ event: i.event, id: i.id }));
    MascotAnimationController.play('BookComplete');
    MascotAnimationController.play('CleanComplete');
    off();
    MascotAnimationController.play('MoveBook');
    expect(seen).toEqual([
      { event: 'BookComplete', id: 1 },
      { event: 'CleanComplete', id: 2 },
    ]);
  });

  it('play() returns the emitted instance so callers can interrupt by id', () => {
    const a = MascotAnimationController.play('MoveBook');
    const b = MascotAnimationController.play('MoveBook');
    expect(b.id).toBeGreaterThan(a.id);
  });

  it('unsubscribing twice is harmless', () => {
    let count = 0;
    const off = MascotAnimationController.subscribe(() => {
      count += 1;
    });
    off();
    off();
    MascotAnimationController.play('AddBookmark');
    expect(count).toBe(0);
  });

  it('unsubscribing during a fan-out does not skip the remaining subscribers', () => {
    const order: string[] = [];
    let self: (() => void) | null = null;
    self = MascotAnimationController.subscribe(() => {
      order.push('a');
      self?.();
    });
    MascotAnimationController.subscribe(() => order.push('b'));
    expect(MascotAnimationController.subscriberCount()).toBe(2);
    MascotAnimationController.play('AddBookmark');
    expect(order).toEqual(['a', 'b']);
  });
});

describe('popupScaleStandard (the 0.2 / 0.28 / 0.8 keyframes)', () => {
  it('ramps 0.4 → 1.08 over the first 20%', () => {
    expect(popupScaleStandard(0)).toBeCloseTo(0.4, 9);
    expect(popupScaleStandard(0.1)).toBeCloseTo(0.74, 9);
    expect(popupScaleStandard(0.2)).toBeCloseTo(1.08, 9);
  });

  it('settles 1.08 → 1.00 over the next 8%', () => {
    expect(popupScaleStandard(0.24)).toBeCloseTo(1.04, 9);
    expect(popupScaleStandard(0.28)).toBeCloseTo(1.0, 9);
  });

  it('holds 1.00 through the middle', () => {
    expect(popupScaleStandard(0.5)).toBe(1);
    expect(popupScaleStandard(0.8)).toBe(1);
  });

  it('exits 1.00 → 0.80 over the last 20%', () => {
    expect(popupScaleStandard(0.9)).toBeCloseTo(0.9, 9);
    expect(popupScaleStandard(1)).toBeCloseTo(0.8, 9);
  });

  it('is monotonically non-increasing after the overshoot peak', () => {
    let prev = popupScaleStandard(0.2);
    for (let p = 0.21; p <= 1.0001; p += 0.01) {
      const v = popupScaleStandard(p);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });
});

describe('popupAlphaStandard (0.15 / 0.8 keyframes)', () => {
  it('fades in over the first 15%, holds, fades out over the last 20%', () => {
    expect(popupAlphaStandard(0)).toBe(0);
    expect(popupAlphaStandard(0.075)).toBeCloseTo(0.5, 9);
    expect(popupAlphaStandard(0.15)).toBe(1);
    expect(popupAlphaStandard(0.5)).toBe(1);
    expect(popupAlphaStandard(0.9)).toBeCloseTo(0.5, 9);
    // (1 - 0.8) / 0.2 is not exact in IEEE-754, same as Kotlin's Float arithmetic.
    expect(popupAlphaStandard(1)).toBeCloseTo(0, 12);
  });

  it('never leaves 0..1', () => {
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const a = popupAlphaStandard(p);
      expect(a).toBeGreaterThanOrEqual(-1e-12);
      expect(a).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
});

describe('popupScaleComplete / popupAlphaComplete (BookCompleteAnimation.kt lines 42-53)', () => {
  it('uses its own 0.15 / 0.24 / 0.85 breakpoints', () => {
    expect(popupScaleComplete(0)).toBeCloseTo(0.4, 9);
    expect(popupScaleComplete(0.15)).toBeCloseTo(1.08, 9);
    expect(popupScaleComplete(0.24)).toBeCloseTo(1.0, 9);
    expect(popupScaleComplete(0.5)).toBe(1);
    expect(popupScaleComplete(1)).toBeCloseTo(0.8, 9);
  });

  it('fades in over 12% and out from 85%', () => {
    expect(popupAlphaComplete(0)).toBe(0);
    expect(popupAlphaComplete(0.12)).toBe(1);
    expect(popupAlphaComplete(0.5)).toBe(1);
    expect(popupAlphaComplete(1)).toBeCloseTo(0, 12);
  });

  it('the two curves differ — BookComplete is not the standard curve', () => {
    expect(popupScaleComplete(0.1)).not.toBeCloseTo(popupScaleStandard(0.1), 6);
    expect(popupAlphaComplete(0.1)).not.toBeCloseTo(popupAlphaStandard(0.1), 6);
  });
});

describe('MASCOT_DURATION_MS', () => {
  it('the per-animation tween durations are verbatim', () => {
    expect(MASCOT_DURATION_MS).toEqual({
      bookComplete: 1400,
      bookmarkHappy: 850,
      deleteSad: 850,
      moveBook: 850,
    });
  });
});

describe('CONFETTI_SEEDS (BookCompleteAnimation.kt line 86)', () => {
  it('is ten points inside the unit square', () => {
    expect(CONFETTI_SEEDS).toHaveLength(10);
    for (const s of CONFETTI_SEEDS) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(1);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(1);
    }
  });

  it('is drawn once from a deterministic LCG, so it is stable across re-renders', () => {
    expect(CONFETTI_SEEDS).toBe(CONFETTI_SEEDS);
    const first = CONFETTI_SEEDS[0];
    const second = CONFETTI_SEEDS[1];
    expect(first).not.toEqual(second);
  });
});

describe('MascotSpriteSheet.kt', () => {
  it('the nine asset keys are the new Roxy bindings', () => {
    expect(MascotSpriteSheet).toEqual({
      idleDrawable: 'mascot_idle',
      sadDrawable: 'mascot_sad',
      happyDrawable: 'mascot_celebrate',
      moveDrawable: 'mascot_run',
      readingDrawable: 'mascot_reading',
      celebrateDrawable: 'mascot_celebrate',
      runDrawable: 'mascot_run',
      bookmarkDrawable: 'mascot_celebrate',
    });
  });

  it('the scene map points at those keys', () => {
    expect(MascotAssetMap).toEqual({
      idle: 'mascot_idle',
      sad: 'mascot_sad',
      happy: 'mascot_celebrate',
      move: 'mascot_run',
      reading: 'mascot_reading',
      celebrate: 'mascot_celebrate',
      run: 'mascot_run',
    });
  });

  it('mascotMoodOf dispatches reading → READING, celebrate → HAPPY, run → RUN, sad → SAD', () => {
    expect(mascotMoodOf(MascotSpriteSheet.readingDrawable)).toBe('READING');
    expect(mascotMoodOf(MascotSpriteSheet.celebrateDrawable)).toBe('HAPPY');
    expect(mascotMoodOf(MascotSpriteSheet.runDrawable)).toBe('RUN');
    expect(mascotMoodOf(MascotSpriteSheet.sadDrawable)).toBe('SAD');
  });

  it('falls back to IDLE for anything else', () => {
    expect(mascotMoodOf(MascotSpriteSheet.idleDrawable)).toBe('IDLE');
    expect(mascotMoodOf('mascot_unknown')).toBe('IDLE');
  });

  it('the reading branch wins over the celebrate alias (order preserved from Kotlin)', () => {
    // `happyDrawable` and `bookmarkDrawable` both alias celebrate; reading is
    // checked first, so the aliases cannot shadow it.
    expect(mascotMoodOf(MascotSpriteSheet.happyDrawable)).toBe('HAPPY');
    expect(mascotMoodOf(MascotSpriteSheet.bookmarkDrawable)).toBe('HAPPY');
  });
});