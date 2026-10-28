import { useEffect, useRef, useState } from 'react';
import type { BookSource } from '@core/source/bookSource';
import { ComicSource } from '@core/source/comicSource';
import { checkSourceUrl } from '@core/source/networkCalls';
import { getPlatform } from '@platform/index';
import { createFileInlineImageDecoder } from '@platform/readerImageResolver';

/** Load covers only near the viewport, retaining the source's cookies/referer. */
export function SourceCover({ url, title, source }: { url: string | null; title: string; source: BookSource | null }) {
  const container = useRef<HTMLDivElement | null>(null);
  const [image, setImage] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    const element = container.current; if (!element) return;
    let cancelled = false, started = false, objectUrl: string | null = null;
    const decoder = createFileInlineImageDecoder(getPlatform().fs);
    const load = async (): Promise<void> => {
      if (started || cancelled) return; started = true;
      if (/^https?:/i.test(url)) {
        checkSourceUrl(url);
        const headers = source instanceof ComicSource ? await source.getCoverHeaders(url) : {};
        if (cancelled) return;
        const response = await getPlatform().http.request({ url, headers, timeoutMs: 15_000 });
        if (cancelled || response.status < 200 || response.status >= 300 || response.body.length > 8 * 1024 * 1024) return;
        objectUrl = URL.createObjectURL(new Blob([response.body as Uint8Array<ArrayBuffer>]));
        setImage({ path: url, url: objectUrl });
      } else {
        const resolved = await decoder.resolve(url);
        if (!cancelled && resolved) setImage({ path: url, url: resolved });
      }
    };
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'undefined') void load().catch(() => {});
    else { observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); void load().catch(() => {}); } }, { rootMargin: '400px' }); observer.observe(element); }
    return () => { cancelled = true; observer?.disconnect(); decoder.dispose(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, source]);
  return <div className="discover-cover" ref={container}>{image?.path === url ? <img src={image.url} alt={title} loading="lazy" /> : <span aria-hidden="true">{title.slice(0, 12)}</span>}</div>;
}
