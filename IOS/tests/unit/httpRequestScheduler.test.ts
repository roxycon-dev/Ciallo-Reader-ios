import { describe, expect, it } from 'vitest';
import { HttpRequestScheduler } from '@platform/ios-native/httpRequestScheduler';

describe('shared native HTTP dispatcher', () => {
  it('enforces global and per-host concurrency without starving another host', async () => {
    const scheduler = new HttpRequestScheduler(2, 1), signal = new AbortController().signal, order: string[] = [];
    const first = await scheduler.acquire('a.test', signal);
    const second = scheduler.acquire('a.test', signal).then((release) => { order.push('a2'); return release; });
    const other = await scheduler.acquire('b.test', signal); expect(order).toEqual([]);
    const third = scheduler.acquire('c.test', signal).then((release) => { order.push('c1'); return release; });
    other(); const releaseThird = await third; expect(order).toEqual(['c1']); first(); const releaseSecond = await second; expect(order).toEqual(['c1', 'a2']); releaseThird(); releaseSecond(); releaseSecond();
    (await scheduler.acquire('a.test', signal))();
  });
  it('removes cancelled queued requests and never grants them a socket permit', async () => {
    const scheduler = new HttpRequestScheduler(1, 1), first = await scheduler.acquire('a.test', new AbortController().signal), controller = new AbortController();
    const queued = scheduler.acquire('a.test', controller.signal); controller.abort(); await expect(queued).rejects.toMatchObject({ name: 'AbortError' }); first();
    (await scheduler.acquire('a.test', new AbortController().signal))(); await expect(scheduler.acquire('b.test', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
