import type { FileSystemApi } from '@platform/interfaces';
import type { InlineImageDecoder } from '@core/reader/readerScreenLogic';

/** Resolve app-private illustration paths without treating them as web URLs. */
export function createFileInlineImageDecoder(
  fs: FileSystemApi,
): InlineImageDecoder & { dispose(): void } {
  const cache = new Map<string, Promise<string | null>>();
  const urls = new Set<string>();
  let disposed = false;
  const resolve = (path: string): Promise<string | null> => {
    if (/^(https?:|data:|blob:|capacitor:)/i.test(path)) return Promise.resolve(path);
    const existing = cache.get(path);
    if (existing) return existing;
    const pending = (async () => {
      try {
        if (path.startsWith('epzip:')) return null;
        const bytes = await fs.readFile(path.replace(/^file:\/\//, ''));
        if (disposed) return null;
        const extension = path.split('.').pop()?.toLowerCase();
        const type =
          extension === 'png'
            ? 'image/png'
            : extension === 'webp'
              ? 'image/webp'
              : extension === 'gif'
                ? 'image/gif'
                : 'image/jpeg';
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
        urls.add(url);
        if (cache.size > 32) {
          const key = cache.keys().next().value;
          if (key !== undefined && key !== path) {
            void cache.get(key)?.then((oldUrl) => {
              if (oldUrl) {
                URL.revokeObjectURL(oldUrl);
                urls.delete(oldUrl);
              }
            });
            cache.delete(key);
          }
        }
        return url;
      } catch {
        cache.delete(path);
        return null;
      }
    })();
    cache.set(path, pending);
    return pending;
  };
  return {
    resolve,
    prewarm: (paths) => {
      for (const path of paths.slice(0, 4)) void resolve(path);
    },
    dispose() {
      disposed = true;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      cache.clear();
    },
  };
}
