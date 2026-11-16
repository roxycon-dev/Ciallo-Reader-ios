import { Capacitor, registerPlugin } from '@capacitor/core';
import { nonThenablePlugin } from './pluginProxy';

export interface ZLibraryDownloadHandoff {
  url: string;
  cookies: string;
}

interface ReaderWebsitePlugin {
  resolveDownload(options: {
    requestId: string;
    entryUrl: string;
    downloadUrl: string;
    cookies?: string | null;
  }): Promise<{ url?: string | null; cookies?: string | null }>;
  cancelResolveDownload(options: { requestId: string }): Promise<void>;
}

let nativePlugin: ReaderWebsitePlugin | undefined;
let requestSequence = 0;
const requestPrefix = Math.random().toString(36).slice(2);

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  requestSequence += 1;
  return `zlib-wk-${Date.now().toString(36)}-${requestPrefix}-${requestSequence.toString(36)}`;
}

/**
 * Run Android's bounded Z-Library WebView download handoff through native WKWebView.
 * Returns null when no downloadable response was reached, including outside iOS.
 */
export async function resolveZLibraryDownloadWithWebView(
  entryUrl: string,
  downloadUrl: string,
  cookies?: string | null,
  signal?: AbortSignal,
): Promise<ZLibraryDownloadHandoff | null> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios' || signal?.aborted) return null;

  let requestId: string | undefined;
  let cancelPromise: Promise<void> | undefined;
  const cancelNativeRequest = (): void => {
    if (!nativePlugin || requestId === undefined || cancelPromise !== undefined) return;
    cancelPromise = nativePlugin.cancelResolveDownload({ requestId }).catch(() => {});
  };
  const onAbort = (): void => cancelNativeRequest();

  try {
    nativePlugin ??= nonThenablePlugin(registerPlugin<ReaderWebsitePlugin>('ReaderWebsite'));
    requestId = createRequestId();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) cancelNativeRequest();

    const result = await nativePlugin.resolveDownload({
      requestId,
      entryUrl,
      downloadUrl,
      ...(cookies === undefined ? {} : { cookies }),
    });
    if (signal?.aborted) {
      cancelNativeRequest();
      await cancelPromise;
      return null;
    }
    if (typeof result.url !== 'string' || typeof result.cookies !== 'string') return null;
    return { url: result.url, cookies: result.cookies };
  } catch {
    if (signal?.aborted) {
      cancelNativeRequest();
      await cancelPromise;
    }
    return null;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted && cancelPromise !== undefined) await cancelPromise;
  }
}
