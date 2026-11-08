import { describe, expect, it, vi } from 'vitest';
import { httpResponseLimit, readHttpResponseBytes } from '@platform/httpResponseBytes';

describe('bounded HTTP stream reading', () => {
  it('preserves raw bytes in order across stream chunks', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([0, 255])); controller.enqueue(new Uint8Array([128, 42])); controller.close(); } });
    expect(Array.from(await readHttpResponseBytes(new Response(body), 4, new AbortController().signal))).toEqual([0, 255, 128, 42]);
  });
  it('rejects excessive data promptly even when stream cancellation never finishes', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {})), body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(10)); }, cancel });
    await expect(readHttpResponseBytes(new Response(body), 4, new AbortController().signal)).rejects.toThrow('超过大小限制'); expect(cancel).toHaveBeenCalledOnce();
  });
  it('interrupts a blocked read when the owning Worker is cancelled', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {})), response = new Response(new ReadableStream<Uint8Array>({ cancel })), controller = new AbortController();
    const reading = readHttpResponseBytes(response, 10, controller.signal); controller.abort(); await expect(reading).rejects.toMatchObject({ name: 'AbortError' }); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([0, -1, 1.5, Infinity, 512 * 1024 * 1024 + 1])('rejects invalid response budget %s', (budget) => { expect(() => httpResponseLimit(budget)).toThrow(); });
});
