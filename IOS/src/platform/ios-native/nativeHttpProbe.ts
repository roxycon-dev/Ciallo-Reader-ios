import { registerPlugin } from '@capacitor/core';
import type { PlatformBundle } from '@platform/index';

interface FixtureStatus { slowStarted: number; cancelledSlowConnections: number; activeRequests: number; }
interface FixtureNative { fixture(value: { action: 'start' }): Promise<{ url: string }>; fixture(value: { action: 'status' }): Promise<FixtureStatus>; fixture(value: { action: 'stop' }): Promise<void>; }
const assert = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
/** Actual HTTP/1.1 over loopback, through the app's production HttpClient. */
export async function probeNativeHttp(platform: PlatformBundle): Promise<void> {
  const fixture = registerPlugin<FixtureNative>('ReaderHttp'), { url } = await fixture.fixture({ action: 'start' });
  const bytes = new Uint8Array([0, 255, 128, 0xd6, 0xd0, 0xce, 0xc4]);
  const equal = (actual: Uint8Array, expected: Uint8Array) => actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
  const wait = async (predicate: (status: FixtureStatus) => boolean) => {
    const end = Date.now() + 5000;
    do { if (predicate(await fixture.fixture({ action: 'status' }))) return; await new Promise((resolve) => setTimeout(resolve, 25)); } while (Date.now() < end);
    throw new Error('HTTP loopback socket state timed out');
  };
  try {
    const json = await platform.http.request({ url: `${url}/json`, timeoutMs: 5000 });
    assert(json.status === 200 && equal(json.body, new TextEncoder().encode(' { "z":1, "a":2, "a":3 }\r\n')), 'Native JSON bytes were reserialized');
    assert(equal((await platform.http.request({ url: `${url}/binary`, timeoutMs: 5000 })).body, bytes), 'Native binary or GBK bytes changed');
    const echo = Uint8Array.from({ length: 1024 * 1024 - 1 }, (_, index) => index % 251);
    assert(equal((await platform.http.request({ url: `${url}/echo`, method: 'POST', body: echo, timeoutMs: 10000 })).body, echo), 'Native binary upload or chunked bridge read differs');
    const manual = await platform.http.request({ url: `${url}/redirect`, redirect: 'manual', timeoutMs: 5000 }); assert(manual.status === 302 && new TextDecoder().decode(manual.body) === 'redirect', 'Manual redirect was followed');
    const followed = await platform.http.request({ url: `${url}/redirect`, redirect: 'follow', timeoutMs: 5000 }); assert(followed.url.endsWith('/binary') && equal(followed.body, bytes), 'Redirect response bytes or final URL differ');
    let rejected = false; try { await platform.http.request({ url: `${url}/redirect`, redirect: 'error', timeoutMs: 5000 }); } catch { rejected = true; } assert(rejected, 'Error redirect policy accepted a redirect');
    rejected = false; try { await platform.http.request({ url: `${url}/large`, timeoutMs: 5000 }); } catch { rejected = true; } assert(rejected, 'Oversized declared response accepted');
    const controller = new AbortController();
    const cancelled = platform.http.request({ url: `${url}/slow`, timeoutMs: 10000, signal: controller.signal }).then(() => false, () => true);
    await wait((status) => status.slowStarted >= 1); controller.abort(); assert(await cancelled, 'Caller cancellation did not reject'); await wait((status) => status.cancelledSlowConnections >= 1);
    const timed = platform.http.request({ url: `${url}/slow`, timeoutMs: 1000 }).then(() => false, () => true);
    assert(await timed, 'Native call timeout did not reject'); await wait((status) => status.cancelledSlowConnections >= 2);
    await wait((status) => status.activeRequests === 0);
  } finally { await fixture.fixture({ action: 'stop' }); }
}
