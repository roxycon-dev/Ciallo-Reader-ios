import { Capacitor, registerPlugin } from '@capacitor/core';

export interface WebsiteVerificationResult {
  verified: boolean;
  html?: string;
  url?: string;
  cookies: Array<{ domain: string; name: string; value: string; path: string; secure: boolean; expires?: number }>;
}
interface WebsitePlugin {
  verify(options: { requestId: string; url: string; userAgent: string; extractPage: boolean }): Promise<WebsiteVerificationResult>;
  cancelVerify(options: { requestId: string }): Promise<void>;
}

let requestSequence = 0;

function nextRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  requestSequence++;
  return `${Date.now().toString(36)}-${requestSequence.toString(36)}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

export async function verifySourceWebsite(
  url: string,
  userAgent: string,
  extractPage = false,
  signal?: AbortSignal,
): Promise<WebsiteVerificationResult> {
  if (!Capacitor.isNativePlatform()) throw new Error('站点验证需要在 iOS 应用中完成；浏览器预览无法回传站点登录状态。');
  if (signal?.aborted) throw abortError(signal);
  const plugin = registerPlugin<WebsitePlugin>('ReaderWebsite');
  const requestId = nextRequestId();
  const verification = plugin.verify({ requestId, url, userAgent, extractPage });
  if (!signal) return verification;

  return await new Promise<WebsiteVerificationResult>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try { void plugin.cancelVerify({ requestId }).catch(() => {}); } catch { /* Settle even if the bridge is unavailable. */ }
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void verification.then(
      (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}
