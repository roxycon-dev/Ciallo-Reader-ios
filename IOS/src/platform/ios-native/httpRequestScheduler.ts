interface Waiter { host: string; signal: AbortSignal; resolve(release: () => void): void; reject(error: Error): void; abort(): void; }
/** Android NetworkCalls dispatcher: 32 overall, 4 per host. Scan past a busy
 * host so one source cannot hold up unrelated sources; cancelled waiters leave
 * without starting a socket or consuming a permit. */
export class HttpRequestScheduler {
  private active = 0;
  private readonly hosts = new Map<string, number>();
  private readonly waiters: Waiter[] = [];
  constructor(private readonly maximum = 32, private readonly perHost = 4) {}
  acquire(host: string, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new DOMException('HTTP 请求已取消', 'AbortError'));
    if (this.waiters.length >= 1024) return Promise.reject(new Error('等待中的 HTTP 请求过多'));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { host, signal, resolve, reject, abort: () => {
        const index = this.waiters.indexOf(waiter); if (index < 0) return;
        this.waiters.splice(index, 1); signal.removeEventListener('abort', waiter.abort); reject(new DOMException('HTTP 请求已取消', 'AbortError'));
      } };
      signal.addEventListener('abort', waiter.abort, { once: true }); this.waiters.push(waiter); this.drain();
    });
  }
  private drain(): void {
    while (this.active < this.maximum) {
      const index = this.waiters.findIndex((waiter) => (this.hosts.get(waiter.host) ?? 0) < this.perHost); if (index < 0) return;
      const [waiter] = this.waiters.splice(index, 1); if (!waiter) return;
      waiter.signal.removeEventListener('abort', waiter.abort); this.active++; this.hosts.set(waiter.host, (this.hosts.get(waiter.host) ?? 0) + 1);
      let released = false; waiter.resolve(() => {
        if (released) return; released = true; this.active--; const count = (this.hosts.get(waiter.host) ?? 1) - 1;
        if (count) this.hosts.set(waiter.host, count); else this.hosts.delete(waiter.host); this.drain();
      });
    }
  }
}
export const nativeHttpScheduler = new HttpRequestScheduler();
