import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withSharedElementTransition } from '@ui/shared/viewTransitions';

describe('navigation while WebKit snapshots are suspended', () => {
  const original = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    if (original) Object.defineProperty(document, 'startViewTransition', original);
    else Reflect.deleteProperty(document, 'startViewTransition');
    vi.useRealTimers();
  });
  it('updates the route once even when the snapshot callback never starts', async () => {
    let delayed!: () => Promise<void>;
    let rejectSnapshot!: (reason: Error) => void;
    const snapshot = new Promise<void>((_resolve, reject) => {
      rejectSnapshot = reject;
    });
    const skip = vi.fn(() => rejectSnapshot(new Error('snapshot skipped')));
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (callback: () => Promise<void>) => {
        delayed = callback;
        return {
          ready: Promise.resolve(),
          updateCallbackDone: snapshot,
          finished: Promise.resolve(),
          skipTransition: skip,
        };
      },
    });
    const update = vi.fn();
    const navigation = withSharedElementTransition(update);
    await vi.advanceTimersByTimeAsync(500);
    await navigation;
    expect(skip).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    await delayed();
    expect(update).toHaveBeenCalledOnce();
  });
  it('still navigates when the browser throws while creating a transition', async () => {
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: () => {
        throw new Error('snapshot unavailable');
      },
    });
    const update = vi.fn();
    await withSharedElementTransition(update);
    expect(update).toHaveBeenCalledOnce();
  });
});
