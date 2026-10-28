/**
 * Content mutation gate — port of Android `ContentMutationGate.kt`.
 * Lock order: download controls -> worker task lock -> content gate -> Room transaction.
 */

/** Simple async mutex (FIFO). */
export class AsyncMutex {
  private chain: Promise<void> = Promise.resolve()
  private locked = false

  async lock(): Promise<void> {
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const prev = this.chain
    this.chain = prev.then(() => next)
    await prev
    this.locked = true
    this.releaseCurrent = release
  }

  unlock(): void {
    if (!this.locked) return
    this.locked = false
    this.releaseCurrent?.()
    this.releaseCurrent = undefined
  }

  private releaseCurrent: (() => void) | undefined

  /** Run fn while holding the lock. */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.lock()
    try {
      return await fn()
    } finally {
      this.unlock()
    }
  }
}

/** ContentMutationGate — mutex + volatile epoch. */
export const contentMutationGate = {
  mutex: new AsyncMutex(),
  get epoch(): number {
    return this._epoch
  },
  _epoch: 0,
  /** Caller holds mutex. */
  invalidatePendingWrites(): void {
    this._epoch += 1
  },
}
