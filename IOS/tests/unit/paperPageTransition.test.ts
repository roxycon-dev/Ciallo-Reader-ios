import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computePaperGeometry,
  createPaperPageTransitionController,
  type PaperRect,
} from '@ui/shared/paperPageTransition';

const surface: PaperRect = { left: 0, top: 0, width: 390, height: 844 };
const origin: PaperRect = { left: 22, top: 84, width: 76, height: 40 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('paper page transition', () => {
  it('uses the Kotlin source and full-page endpoint geometry', () => {
    const closed = computePaperGeometry(0, origin, surface);
    expect(closed.frame).toEqual({ left: 22, top: 84, width: 76, height: 40 });
    expect(closed.contour).toHaveLength(64);

    const open = computePaperGeometry(1, origin, surface);
    expect(open.frame).toEqual({ left: 0, top: 0, width: 390, height: 844 });
    expect(open.contour.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);

    const mid = computePaperGeometry(0.5, origin, surface);
    expect(mid.frame.width).toBeGreaterThan(closed.frame.width);
    expect(mid.frame.height).toBeGreaterThan(closed.frame.height);
    expect(mid.contour.some((point) => point.halfWidth > origin.width / 2)).toBe(true);
  });

  it('snaps under reduced motion and restores owned styles on dispose', async () => {
    const element = document.createElement('div');
    element.style.transform = 'rotate(1deg)';
    element.style.opacity = '0.7';
    document.body.append(element);
    const controller = createPaperPageTransitionController(element, { origin, reducedMotion: true });

    await expect(controller.open()).resolves.toBe('finished');
    expect(controller.progress).toBe(1);
    expect(element.style.transform).toBe('rotate(1deg)');
    expect(element.style.opacity).toBe('0.7');

    await expect(controller.close()).resolves.toBe('finished');
    expect(controller.progress).toBe(0);
    expect(element.style.opacity).toBe('0');

    controller.dispose();
    expect(element.style.transform).toBe('rotate(1deg)');
    expect(element.style.opacity).toBe('0.7');
    element.remove();
  });

  it('retargets an active spring, resolves the canceled request, and stops RAF when settled', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    const pendingFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const originalRequest = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      pendingFrames.set(id, callback);
      return id;
    });
    window.cancelAnimationFrame = vi.fn((id: number) => { pendingFrames.delete(id); });
    const controller = createPaperPageTransitionController(element, { origin, reducedMotion: false });

    try {
      const opening = controller.open();
      stepFrame(pendingFrames, 0);
      stepFrame(pendingFrames, 16);
      expect(controller.progress).toBeGreaterThan(0);

      const closing = controller.close();
      await expect(opening).resolves.toBe('interrupted');
      expect(controller.targetOpen).toBe(false);
      drainFrames(pendingFrames);
      await expect(closing).resolves.toBe('finished');
      expect(controller.progress).toBe(0);
      expect(pendingFrames.size).toBe(0);
      expect(element.style.willChange).toBe('');

      const openingAgain = controller.open();
      drainFrames(pendingFrames);
      await expect(openingAgain).resolves.toBe('finished');
      expect(controller.progress).toBe(1);
      expect(pendingFrames.size).toBe(0);
    } finally {
      controller.dispose();
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
      element.remove();
    }
  });

  it('lands within the wall-clock budget when frames arrive far apart', async () => {
    const element = document.createElement('div');
    document.body.append(element);
    const pendingFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const originalRequest = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      pendingFrames.set(id, callback);
      return id;
    });
    window.cancelAnimationFrame = vi.fn((id: number) => { pendingFrames.delete(id); });
    // 5 fps: every delivered frame advances 200 ms of wall clock.
    let wall = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => wall);
    const controller = createPaperPageTransitionController(element, { origin, reducedMotion: false });
    try {
      const opening = controller.open();
      let frames = 0;
      while (pendingFrames.size > 0 && frames < 20) {
        wall += 200;
        stepFrame(pendingFrames, wall);
        frames += 1;
      }
      await expect(opening).resolves.toBe('finished');
      expect(controller.progress).toBe(1);
      // 1.2 s budget sampled at 5 fps: the first frame starts the clock, so the
      // transition must land within a handful of frames instead of tens.
      expect(frames).toBeLessThanOrEqual(9);
      expect(pendingFrames.size).toBe(0);
    } finally {
      nowSpy.mockRestore();
      controller.dispose();
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
      element.remove();
    }
  });
});

function stepFrame(frames: Map<number, FrameRequestCallback>, time: number): void {
  const current = [...frames.entries()];
  frames.clear();
  current.forEach(([, callback]) => callback(time));
}

function drainFrames(frames: Map<number, FrameRequestCallback>): void {
  for (let frame = 0; frame < 500 && frames.size > 0; frame += 1) stepFrame(frames, frame * 16);
}
