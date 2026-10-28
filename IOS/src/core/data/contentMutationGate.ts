/**
 * Content mutation gate — port of Android `ContentMutationGate.kt`.
 *
 * Lock order: download controls -> worker task lock -> content gate -> Room transaction.
 *
 * kotlinx.coroutines.sync.Mutex is replaced with a minimal FIFO async mutex
 * (single-threaded JS still needs interleaving-safe lock sections around awaits).
 */

export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  /** Acquire; resolve to a release function (Mutex.withLock parity). */
  lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.tail;
    this.tail = prev.then(() => next);
    return prev.then(() => release);
  }

  async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.lock();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const ContentMutationGate = {
  mutex: new AsyncMutex(),
  /** @Volatile var epoch = 0L (private set). */
  epoch: 0,
  /** Caller holds mutex. */
  invalidatePendingWrites(): void {
    this.epoch += 1;
  },
};
