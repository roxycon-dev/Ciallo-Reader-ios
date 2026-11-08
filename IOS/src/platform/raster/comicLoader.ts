import { ComicPageLoader } from '@core/comic/comicPageLoader';
import type { PageSource } from '@core/comic/comicPageLoader';
import { RectF, type ComicPageRef as CorePage } from '@core/comic/comicPortTypes';
import type { ComicPageLoaderPort, ComicPageRef, ComicBitmap, ComicSizeInfo } from '@core/comic/comicReaderCore';
import type { PixImage } from '@core/comic/comicPixOps';
import { detectCenterGutterDetail, process } from '@core/comic/comicImagePipeline';
import { probeImageSize } from '@core/parser/imageBytes';
import { encode } from 'fast-png';
import type { PlatformBundle } from '@platform/index';
import { referencePixOps } from './pixCodec';
import { RasterProcessor } from './processor';

const refOf = (ref: ComicPageRef): CorePage => ref.kind === 'LOCAL'
  ? { ...ref, kind: 'Local' } : { ...ref, kind: 'Remote' };

export function rgbaOf(image: PixImage): Uint8Array {
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let i = 0; i < image.data.length; i++) {
    const pixel = image.data[i]!;
    rgba[i * 4] = pixel >>> 16 & 255; rgba[i * 4 + 1] = pixel >>> 8 & 255;
    rgba[i * 4 + 2] = pixel & 255; rgba[i * 4 + 3] = pixel >>> 24;
  }
  return rgba;
}
async function decode(bytes: Uint8Array, edge: number): Promise<PixImage> {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale)); const height = Math.max(1, Math.round(image.naturalHeight * scale));
    if (width * height * 4 > 64 * 1024 * 1024) throw new Error('页面尺寸超过内存预算');
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法解码漫画页面');
    context.drawImage(image, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const data = new Uint32Array(width * height);
    for (let i = 0; i < data.length; i++) data[i] = (rgba[i * 4 + 3]! << 24 | rgba[i * 4]! << 16 | rgba[i * 4 + 1]! << 8 | rgba[i * 4 + 2]!) >>> 0;
    return { width, height, data };
  } finally { URL.revokeObjectURL(url); }
}
function png(image: PixImage): Uint8Array {
  return encode({ width: image.width, height: image.height, data: rgbaOf(image), channels: 4, depth: 8 });
}

/** Production adapter for the complete geometry/filter/cache pipeline. */
export function createAppComicLoader(platform: PlatformBundle, options: {
  fetchRemote?: (url: string, headers: Record<string, string>) => Promise<Uint8Array>;
} = {}): ComicPageLoaderPort {
  const processor = new RasterProcessor();
  const ops = referencePixOps();
  const fs = platform.fs;
  const localPath = (path: string): string => path.replace(/^file:\/\//, '');
  const read = (path: string): Promise<Uint8Array> => fs.readFile(localPath(path));
  const fetchRemote = options.fetchRemote ?? (async (url, headers) => {
    const response = await platform.http.request({ url, headers, method: 'GET', timeoutMs: 30_000 });
    if (response.status < 200 || response.status >= 300) throw new Error(`图片加载失败：HTTP ${response.status}`);
    return response.body;
  });
  let wifi = true; let wifiOnly = false;
  void platform.network.wifiConnectedOrUnmetered().then((value) => { wifi = value; }).catch(() => {});
  void import('@core/settings/settingsRepository').then(async ({ PreferencesManager, SettingsRepository }) => {
    wifiOnly = await new PreferencesManager(new SettingsRepository(platform.db)).preloadWifiOnly();
  }).catch(() => {});
  const source: PageSource = {
    normalizedLocalCoordinates: true,
    decodeLocal: async (path, edge) => decode(await read(path), edge),
    decodeRemote: async (ref, edge) => ref.kind === 'Remote'
      ? decode(await fetchRemote(ref.url, { ...ref.headers, ...(ref.referer ? { Referer: ref.referer } : {}) }), edge) : null,
    async probeBoundsLocal(path) {
      const bytes = await read(path);
      const bounds = probeImageSize(bytes);
      if (!bounds) return null;
      // Browser image decoders already apply EXIF. Probe through the same decoder
      // for oriented JPEGs, otherwise the header avoids allocating a full raster.
      if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        const { parseJpegExifOrientation, exifSwappedSize } = await import('@core/comic/comicPageLoader');
        const size = exifSwappedSize(bounds.width, bounds.height, parseJpegExifOrientation(bytes, Math.min(bytes.length, 1 << 20)));
        return { left: 0, top: 0, right: size.width, bottom: size.height };
      }
      return { left: 0, top: 0, right: bounds.width, bottom: bounds.height };
    },
    readFileHead: async (path, count) => (await read(path)).subarray(0, count),
    async openRegion(path) {
      const image = await decode(await read(path), 8192);
      return { width: image.width, height: image.height,
        async decodeRegion(rect, sample) {
          const crop = ops.codec.createBitmapRegion(image, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
          return sample <= 1 ? crop : ops.codec.createScaledBitmap(crop, Math.max(1, Math.floor(crop.width / sample)), Math.max(1, Math.floor(crop.height / sample)));
        }, recycle() {} };
    },
    transformExif: async (image) => image,
    scaleTo: (image, width, height) => ops.codec.createScaledBitmap(image, width, height),
    wifiConnectedOrUnmetered: () => wifi, clearRemoteMemoryCache() {},
  };
  const directory = 'comic_processed_v1';
  const cachePath = (name: string): string => `${directory}/${name}`;
  const loader = new ComicPageLoader({ source, maxHeapBytes: 192 * 1024 * 1024,
    policy: { preloadWifiOnly: () => wifiOnly }, tasks: { run: (task) => { void task().catch(() => {}); } }, io: { run: (task) => task() },
    diskStore: {
      losslessExt: '.png', ensureDir: async () => true, nowMs: Date.now,
      async list() { const files = await fs.list(directory); const result = []; for (const name of files) result.push({ name, bytes: (await fs.readFile(cachePath(name))).length, lastModified: Number(platform.keyValue.get(`comicCache.${name}`) ?? 0) }); return result; },
      isFile: (name) => fs.exists(cachePath(name)), read: async (name) => await fs.exists(cachePath(name)) ? decode(await fs.readFile(cachePath(name)), 3200) : null,
      async encodeTmp(name, image) { await fs.writeFile(cachePath(name), png(image)); return true; },
      async publish(from, to) { await fs.writeFile(cachePath(to), await fs.readFile(cachePath(from))); await fs.delete(cachePath(from)); return true; },
      async remove(name) { await fs.delete(cachePath(name)); return true; },
      async touch(name, time) { platform.keyValue.set(`comicCache.${name}`, String(time)); },
    },
  });
  loader.processor = (image, geometry, tone) => processor.process(image, geometry, tone);
  loader.previewProcessor = (image, geometry, tone) => process(image, geometry, tone, ops);
  loader.probeGutter = (image) => detectCenterGutterDetail(image, ops);
  const bitmaps = new Map<PixImage, ComicBitmap>();
  let urlBytes = 0;
  const rendered = (image: PixImage | null): ComicBitmap | null => image ? bitmaps.get(image) ?? null : null;
  const render = (image: PixImage): ComicBitmap => {
    const cached = rendered(image); if (cached) return cached;
    const bytes = png(image);
    const bitmap = { src: URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' })), width: image.width, height: image.height };
    bitmaps.set(image, bitmap); urlBytes += image.data.byteLength;
    while (urlBytes > 48 * 1024 * 1024 && bitmaps.size > 1) {
      const oldest = bitmaps.keys().next().value!;
      URL.revokeObjectURL(bitmaps.get(oldest)!.src); bitmaps.delete(oldest); urlBytes -= oldest.data.byteLength;
    }
    return bitmap;
  };
  const clear = (): void => { for (const bitmap of bitmaps.values()) URL.revokeObjectURL(bitmap.src); bitmaps.clear(); urlBytes = 0; };
  let sizes: Readonly<Record<string, ComicSizeInfo>> = {};
  const listeners = new Set<(value: Readonly<Record<string, ComicSizeInfo>>) => void>();
  const unsubscribe = loader.onSizesChanged((values) => {
    sizes = Object.fromEntries([...values].map(([id, size]) => [id, { ...size, gutter: size.gutter ?? null, gutterPos: size.gutterPos ?? null }]));
    for (const listener of listeners) listener(sizes);
  });
  return {
    peekProcessed: (key) => rendered(loader.peekProcessed(key)), peekReadingPreview: (key) => rendered(loader.peekReadingPreview(key)),
    async loadForDisplay(request) { const result = await loader.loadForDisplay(refOf(request.ref), request.cacheKey, request.geometry, request.tone, request.visible); return render(result.bitmap); },
    async decodeRegion(ref, rect, tag) { const result = await loader.decodeRegion(refOf(ref), new RectF(rect.left, rect.top, rect.right, rect.bottom), 2800, tag); return result ? render(result) : null; },
    preloadWindow: (entries, tone) => loader.preloadWindow(entries.map((entry) => ({ ...entry, ref: refOf(entry.ref), geo: entry.geometry })), tone),
    replaceProcessed() { throw new Error('译文位图必须通过翻译协调器提交'); },
    evictProcessed: (key) => { loader.evictProcessed(key); },
    async probeSizes(pages) { loader.probeSizes(pages.map(refOf)); },
    clearProcessedCache: () => { loader.clearProcessedCache(); clear(); },
    shutdown: () => { loader.shutdown(); processor.close(); unsubscribe(); clear(); listeners.clear(); },
    sizes: () => sizes, subscribeSizes(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
