import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookSource } from '@core/source/bookSource';
import { checkSourceUrl } from '@core/source/networkCalls';
import { getPlatform, getPlatformKind } from '@platform/index';
import { createFileInlineImageDecoder } from '@platform/readerImageResolver';

const MAX_COVER_BYTES = 8 * 1024 * 1024;

export function useSourceCover(url: string | null, source: BookSource | null) {
  const target = useRef<HTMLElement | null>(null);
  const attach = useCallback((node: HTMLElement | null) => { target.current = node; }, []);
  const [image, setImage] = useState<{ path: string; source: BookSource | null; url: string } | null>(null);
  useEffect(() => {
    const element = target.current;
    if (!url || !element) return;
    const controller = new AbortController();
    const platform = getPlatform();
    const decoder = createFileInlineImageDecoder(platform.fs);
    let started = false, objectUrl: string | undefined;
    const load = async () => {
      if (started || controller.signal.aborted) return;
      started = true;
      let resolved: string | null;
      if (/^https?:/i.test(url)) {
        checkSourceUrl(url);
        const headers = await source?.getCoverHeaders(url) ?? {};
        if (controller.signal.aborted) return;
        if (getPlatformKind() === 'web-mock' && !Object.keys(headers).length) resolved = url;
        else {
          const response = await platform.http.request({ url, headers, signal: controller.signal, timeoutMs: 15_000, maxResponseBytes: MAX_COVER_BYTES });
          if (controller.signal.aborted || response.status < 200 || response.status >= 300 || !response.body.length) return;
          const type = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.split(';')[0] ?? '';
          if (type === 'text/html') return;
          objectUrl = URL.createObjectURL(new Blob([response.body as Uint8Array<ArrayBuffer>], type.startsWith('image/') ? { type } : {}));
          resolved = objectUrl;
        }
      } else resolved = await decoder.resolve(url);
      if (!controller.signal.aborted && resolved) setImage({ path: url, source, url: resolved });
    };
    let observer: IntersectionObserver | undefined;
    const start = () => { void load().catch(() => {}); };
    if (typeof IntersectionObserver === 'undefined') start();
    else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); start(); }
      }, { rootMargin: '400px' });
      observer.observe(element);
    }
    return () => { controller.abort(); observer?.disconnect(); decoder.dispose(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, source]);
  return { attach, image: image?.path === url && image.source === source ? image.url : null };
}
