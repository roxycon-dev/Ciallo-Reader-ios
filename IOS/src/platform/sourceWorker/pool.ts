import type { CancellationSignal } from '@core/source/js/jsPlatform';

interface Slot { pins: number; used: number; evict(): void; }
interface Waiter { owner: object; evict(): void; signal: CancellationSignal; abort(): void; resolve(release: () => void): void; reject(reason: Error): void; }
/** Bound live JS realms. Busy workers stay pinned; an idle least-recently-used
 * realm can be rebuilt from its persisted preferences and initialization code. */
export class SourceWorkerPool {
  private readonly slots = new Map<object, Slot>();
  private readonly waiting: Waiter[] = [];
  private sequence = 0;
  constructor(private readonly maximum = 4) {}
  acquire(owner: object, evict: () => void, signal: CancellationSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { owner, evict, signal, resolve, reject, abort: () => {
        const index = this.waiting.indexOf(waiter); if (index >= 0) this.waiting.splice(index, 1); signal?.removeEventListener('abort', waiter.abort); reject(new DOMException('Aborted', 'AbortError'));
      } };
      signal?.addEventListener('abort', waiter.abort, { once: true }); this.waiting.push(waiter); this.drain();
    });
  }
  drop(owner: object, reason: Error): void {
    const changed = this.slots.delete(owner);
    for (let index = this.waiting.length - 1; index >= 0; index--) {
      const waiter = this.waiting[index]!; if (waiter.owner !== owner) continue;
      this.waiting.splice(index, 1); waiter.signal?.removeEventListener('abort', waiter.abort); waiter.reject(reason);
    }
    if (changed) this.drain();
  }
  private drain(): void {
    for (let index = 0; index < this.waiting.length;) {
      const waiter = this.waiting[index]!; let slot = this.slots.get(waiter.owner);
      if (!slot && this.slots.size >= this.maximum) {
        const idle = [...this.slots.entries()].filter(([, value]) => value.pins === 0).sort((a, b) => a[1].used - b[1].used)[0];
        if (!idle) { index++; continue; }
        this.slots.delete(idle[0]); idle[1].evict();
      }
      if (!slot) { slot = { pins: 0, used: ++this.sequence, evict: waiter.evict }; this.slots.set(waiter.owner, slot); }
      this.waiting.splice(index, 1); waiter.signal?.removeEventListener('abort', waiter.abort); slot.pins++;
      const granted = slot; let released = false;
      waiter.resolve(() => { if (released) return; released = true; if (this.slots.get(waiter.owner) !== granted) return; granted.pins--; granted.used = ++this.sequence; this.drain(); });
    }
  }
}
export const sourceWorkerPool = new SourceWorkerPool();
