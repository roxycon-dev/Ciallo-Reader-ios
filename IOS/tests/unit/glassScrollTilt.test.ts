/**
 * Kotlin → TS map
 * ──────────────
 * Tests for `src/core/glass/scrollTilt.ts` — the port of
 * `ui/components/ScrollTilt.kt`.
 *
 * Covers `scrollDeltaPx()` (lines 203-213) and the `ScrollTiltController` /
 * `ScrollTiltSampler` state machines (lines 29-68 / 115-195).
 * Nothing skipped.
 */
import { describe, expect, it } from 'vitest';

import {
  FOLLOW_TAU_MS,
  IDLE_TIMEOUT_MS,
  RELEASE_TAU_MS,
  SCROLL_TILT_MAX_DEG,
  SCROLL_VELOCITY_REFERENCE_PX_MS,
  ScrollTiltController,
  ScrollTiltSampler,
  TILT_EPSILON,
  scrollDeltaPx,
} from '../../src/core/glass/scrollTilt';

describe('ScrollTilt.kt constants', () => {
  it('are preserved verbatim (ns → ms conversion applied once)', () => {
    expect(SCROLL_VELOCITY_REFERENCE_PX_MS).toBe(2.2);
    expect(SCROLL_TILT_MAX_DEG).toBe(4.5);
    expect(IDLE_TIMEOUT_MS).toBe(120);
    expect(FOLLOW_TAU_MS).toBe(55);
    expect(RELEASE_TAU_MS).toBe(260);
    expect(TILT_EPSILON).toBe(0.02);
  });
});

describe('scrollDeltaPx (ScrollTilt.kt lines 203-213)', () => {
  it('returns null when the layout has no measurable size', () => {
    expect(scrollDeltaPx(0, 10, 100, 0)).toBeNull();
    expect(scrollDeltaPx(0, 10, 0, 100)).toBeNull();
  });

  it('same item → the raw offset delta', () => {
    expect(scrollDeltaPx(0, 42, 100, 100)).toBe(42);
    expect(scrollDeltaPx(0, -42, 100, 100)).toBe(-42);
  });

  it('scrolled forward one item → previous first-item height + offset delta', () => {
    expect(scrollDeltaPx(1, 5, 200, 50)).toBe(205);
  });

  it('scrolled backward one item → offset delta minus the new first-item height', () => {
    expect(scrollDeltaPx(-1, 90, 50, 200)).toBe(-110);
  });

  it('a multi-item jump is discarded (宁缺勿假 — no fake reverse spike)', () => {
    expect(scrollDeltaPx(2, 0, 100, 100)).toBeNull();
    expect(scrollDeltaPx(-3, 0, 100, 100)).toBeNull();
  });
});

describe('ScrollTiltController (ScrollTilt.kt lines 29-68)', () => {
  it('velocityToDeg saturates at the reference velocity', () => {
    const c = new ScrollTiltController();
    expect(c.velocityToDeg(SCROLL_VELOCITY_REFERENCE_PX_MS)).toBeCloseTo(SCROLL_TILT_MAX_DEG, 9);
    expect(c.velocityToDeg(0)).toBe(0);
  });

  it('submitVelocity low-passes consecutive samples (new/old half each)', () => {
    const c = new ScrollTiltController();
    c.submitVelocity(1.1, 0); // target = 0.5 * velocityToDeg(1.1) = 1.125
    expect(c.targetDeg).toBeCloseTo(1.125, 9);
    c.submitVelocity(1.1, 16);
    // 0.5 * 1.125 + 0.5 * 2.25 = 1.6875
    expect(c.targetDeg).toBeCloseTo(1.6875, 9);
    expect(c.lastEmitMs).toBe(16);
  });

  it('clamps the target to ±SCROLL_TILT_MAX_DEG however hard you flick', () => {
    const c = new ScrollTiltController();
    for (let i = 0; i < 20; i++) c.submitVelocity(50, i * 16);
    expect(c.targetDeg).toBe(SCROLL_TILT_MAX_DEG);
    for (let i = 0; i < 40; i++) c.submitVelocity(-50, i * 16);
    expect(c.targetDeg).toBe(-SCROLL_TILT_MAX_DEG);
  });

  it('isIdle only after IDLE_TIMEOUT_MS without a new sample', () => {
    const c = new ScrollTiltController();
    c.submitVelocity(1, 1000);
    expect(c.isIdle(1000 + IDLE_TIMEOUT_MS)).toBe(false);
    expect(c.isIdle(1000 + IDLE_TIMEOUT_MS + 1)).toBe(true);
  });

  it('step() approaches the target with the follow tau while scrolling', () => {
    const c = new ScrollTiltController();
    c.targetDeg = 4;
    c.lastEmitMs = 0;
    c.step(1000, 0);
    const k = 1 - Math.exp(-1000 / FOLLOW_TAU_MS);
    expect(c.tiltDeg).toBeCloseTo(4 * k, 6);
    // One 1000ms step with τ=55ms is essentially converged.
    expect(c.tiltDeg).toBeGreaterThan(3.9);
  });

  it('step() uses the release tau once idle, so the tilt eases back with no overshoot', () => {
    const c = new ScrollTiltController();
    c.tiltDeg = 4;
    c.targetDeg = 0;
    c.lastEmitMs = 0;
    c.step(50, 10_000); // idle
    const k = 1 - Math.exp(-50 / RELEASE_TAU_MS);
    expect(c.tiltDeg).toBeCloseTo(4 * (1 - k), 6);
    expect(c.tiltDeg).toBeGreaterThan(0); // monotonic decay, never negative
    expect(c.tiltDeg).toBeLessThan(4);
  });

  it('step() parks the value at exactly 0 once below TILT_EPSILON (stops invalidating)', () => {
    const c = new ScrollTiltController();
    c.tiltDeg = 0.01;
    c.targetDeg = 0;
    c.lastEmitMs = 0;
    for (let i = 0; i < 5; i++) c.step(16, 10_000);
    expect(c.tiltDeg).toBe(0);
  });

  it('reset() clears target, output and the emit timestamp', () => {
    const c = new ScrollTiltController();
    c.submitVelocity(2, 500);
    c.step(16, 500);
    c.reset();
    expect(c.tiltDeg).toBe(0);
    expect(c.targetDeg).toBe(0);
    expect(c.lastEmitMs).toBe(0);
  });
});

describe('ScrollTiltSampler (ScrollTilt.kt lines 115-195)', () => {
  it('the first sample only primes the previous state — no velocity is emitted', () => {
    const sampler = new ScrollTiltSampler();
    const controller = new ScrollTiltController();
    sampler.sample({ idx: 3, offset: 10, itemSize: 100 }, controller, 0);
    expect(controller.targetDeg).toBe(0);
  });

  it('a conservative delta emits px/ms velocity', () => {
    const sampler = new ScrollTiltSampler();
    const controller = new ScrollTiltController();
    sampler.sample({ idx: 0, offset: 0, itemSize: 100 }, controller, 0);
    sampler.sample({ idx: 0, offset: 32, itemSize: 100 }, controller, 10);
    // 32px in 10ms = 3.2px/ms → half-passed into the low-pass filter.
    expect(controller.targetDeg).toBeCloseTo(0.5 * 3.2 * (4.5 / 2.2), 6);
    expect(controller.lastEmitMs).toBe(10);
  });

  it('an unmeasurable jump drops the frame but still advances the cursor', () => {
    const sampler = new ScrollTiltSampler();
    const controller = new ScrollTiltController();
    sampler.sample({ idx: 0, offset: 0, itemSize: 100 }, controller, 0);
    // idx jumped by 9 → scrollDeltaPx returns null (|dIdx| > 1) → frame dropped.
    sampler.sample({ idx: 9, offset: 0, itemSize: 100 }, controller, 10);
    expect(controller.targetDeg).toBe(0);
    // The next sample is measured against the *jumped-to* index, not the old one.
    sampler.sample({ idx: 9, offset: 8, itemSize: 100 }, controller, 20);
    expect(controller.targetDeg).toBeGreaterThan(0);
  });

  it('clamps dt to at least 1ms so a same-timestamp pair cannot divide by zero', () => {
    const sampler = new ScrollTiltSampler();
    const controller = new ScrollTiltController();
    sampler.sample({ idx: 0, offset: 0, itemSize: 100 }, controller, 500);
    sampler.sample({ idx: 0, offset: 20, itemSize: 100 }, controller, 500);
    expect(Number.isFinite(controller.targetDeg)).toBe(true);
    expect(controller.targetDeg).toBeGreaterThan(0);
  });

  it('reset() restores the un-primed state', () => {
    const sampler = new ScrollTiltSampler();
    const controller = new ScrollTiltController();
    sampler.sample({ idx: 0, offset: 0, itemSize: 100 }, controller, 0);
    sampler.sample({ idx: 0, offset: 50, itemSize: 100 }, controller, 10);
    expect(controller.targetDeg).toBeGreaterThan(0);
    sampler.reset();
    controller.reset();
    sampler.sample({ idx: 0, offset: 50, itemSize: 100 }, controller, 20);
    expect(controller.targetDeg).toBe(0);
  });
});