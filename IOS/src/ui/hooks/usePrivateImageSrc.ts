import { useEffect, useState } from 'react';
import { getPlatform } from '@platform/index';
import { createFileInlineImageDecoder } from '@platform/readerImageResolver';

/** App-private paths need byte access; WKWebView cannot load them as relative URLs. */
export function usePrivateImageSrc(path: string | null): string | null {
  const [resolved, setResolved] = useState<{ path: string | null; url: string | null }>({ path: null, url: null });
  const publicPath = path !== null && /^(https?:|data:|blob:|capacitor:|\/)/i.test(path);
  useEffect(() => {
    if (path === null || publicPath) return;
    let cancelled = false;
    const decoder = createFileInlineImageDecoder(getPlatform().fs);
    void decoder.resolve(path).then((url) => { if (!cancelled) setResolved({ path, url }); });
    return () => { cancelled = true; decoder.dispose(); };
  }, [path, publicPath]);
  return publicPath ? path : resolved.path === path ? resolved.url : null;
}
