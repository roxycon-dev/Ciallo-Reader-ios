import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebsiteVerificationResult } from '@platform/ios-native/websiteVerification';

const native = vi.hoisted(() => ({
  verify: vi.fn<(options: { requestId: string; url: string; userAgent: string; extractPage: boolean }) => Promise<WebsiteVerificationResult>>(),
  cancelVerify: vi.fn(async (_options: { requestId: string }) => {}),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: (name: string) => {
    if (name !== 'ReaderWebsite') throw new Error(`unexpected plugin ${name}`);
    return native;
  },
}));

import { verifySourceWebsite } from '@platform/ios-native/websiteVerification';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('native source website verification cancellation', () => {
  beforeEach(() => {
    native.verify.mockReset();
    native.cancelVerify.mockReset().mockResolvedValue(undefined);
  });

  it('cancels only the matching native verification and settles the caller promptly', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<WebsiteVerificationResult>>>();
    native.verify.mockImplementation(({ requestId }) => {
      const request = deferred<WebsiteVerificationResult>();
      pending.set(requestId, request);
      return request.promise;
    });
    native.cancelVerify.mockImplementation(async ({ requestId }) => {
      pending.get(requestId)?.resolve({ verified: false, cookies: [] });
    });

    const firstController = new AbortController();
    const first = verifySourceWebsite('https://first.test/', 'ua', false, firstController.signal);
    const second = verifySourceWebsite('https://second.test/', 'ua');
    await vi.waitFor(() => expect(native.verify).toHaveBeenCalledTimes(2));

    const firstId = native.verify.mock.calls[0]![0].requestId;
    const secondId = native.verify.mock.calls[1]![0].requestId;
    expect(firstId).not.toBe(secondId);

    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.cancelVerify).toHaveBeenCalledTimes(1);
    expect(native.cancelVerify).toHaveBeenCalledWith({ requestId: firstId });

    pending.get(secondId)!.resolve({ verified: true, cookies: [] });
    await expect(second).resolves.toEqual({ verified: true, cookies: [] });
  });

  it('does not open a native verification for an already-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(verifySourceWebsite('https://source.test/', 'ua', false, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(native.verify).not.toHaveBeenCalled();
    expect(native.cancelVerify).not.toHaveBeenCalled();
  });
});
