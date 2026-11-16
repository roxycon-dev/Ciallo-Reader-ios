import { useSyncExternalStore } from 'react';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { getPlatform } from '@platform/index';

type VisualKind = 'poster' | 'wallpaper';
const SETTINGS = { poster: 'custom_splash_poster_uri', wallpaper: 'custom_app_background_uri' } as const;
const PREFIX = { poster: 'custom_poster_', wallpaper: 'custom_app_bg_' } as const;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 48 * 1024 * 1024;

interface VisualImage { path: string; url: string; tone: number }
interface VisualAssets { poster: VisualImage | null; wallpaper: VisualImage | null; mode: number; dim: number; ready: boolean }

let snapshot: VisualAssets = { poster: null, wallpaper: null, mode: 0, dim: 20, ready: false };
const listeners = new Set<() => void>();
let queued = Promise.resolve<unknown>(undefined);
let hydrating: Promise<void> | null = null;

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = queued.catch(() => {}).then(operation);
  queued = result;
  return result;
}

function publish(next: VisualAssets): void {
  const previous = snapshot;
  snapshot = next;
  for (const listener of listeners) listener();
  if (previous.poster?.url && previous.poster.url !== next.poster?.url) URL.revokeObjectURL(previous.poster.url);
  if (previous.wallpaper?.url && previous.wallpaper.url !== next.wallpaper?.url) URL.revokeObjectURL(previous.wallpaper.url);
}

function safePath(kind: VisualKind, raw: string): string | null {
  const relative = raw.replace(/^@FILES@\/+|^\/+/, '');
  if (/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+){0,3}$/.test(relative) &&
      relative.split('/').every((part) => part !== '.' && part !== '..') &&
      relative.split('/').at(-1)?.startsWith(PREFIX[kind])) return relative;
  return null;
}

function format(bytes: Uint8Array): { ext: string; mime: string } | null {
  const id = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (bytes[0] === 0x89 && id(1, 3) === 'PNG') return { ext: 'png', mime: 'image/png' };
  if (id(0, 4) === 'RIFF' && id(8, 4) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (/^GIF8[79]a$/.test(id(0, 6))) return { ext: 'gif', mime: 'image/gif' };
  if (id(0, 2) === 'BM') return { ext: 'bmp', mime: 'image/bmp' };
  if (id(4, 4) === 'ftyp') {
    const brands = id(8, 40);
    if (/avif|avis/.test(brands)) return { ext: 'avif', mime: 'image/avif' };
    if (/heic|heix|hevc|mif1/.test(brands)) return { ext: 'heic', mime: 'image/heic' };
  }
  return null;
}

async function loadDecoded(path: string, bytes: Uint8Array, mime: string, measure: boolean): Promise<VisualImage> {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth < 1 || image.naturalHeight < 1 ||
        image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) throw new Error('图片尺寸过大');
    let tone = 1;
    if (measure) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        context.fillStyle = '#fff';
        context.fillRect(0, 0, 64, 64);
        context.drawImage(image, 0, 0, 64, 64);
        const data = context.getImageData(0, 0, 64, 64).data;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) total += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
        tone = total / (64 * 64 * 255);
      }
    }
    return { path, url, tone };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function readAsset(kind: VisualKind, raw: string): Promise<VisualImage | null> {
  const path = safePath(kind, raw);
  if (!path) return null;
  const current = snapshot[kind];
  if (current?.path === path) return current;
  try {
    const { fs } = getPlatform();
    if (fs.size && await fs.size(path) > MAX_IMAGE_BYTES) return null;
    const bytes = await fs.readFile(path);
    if (bytes.byteLength > MAX_IMAGE_BYTES) return null;
    const type = format(bytes);
    return type ? await loadDecoded(path, bytes, type.mime, kind === 'wallpaper') : null;
  } catch { return null; }
}

export function reloadVisualAssets(): Promise<void> {
  return serial(async () => {
    try {
      const settings = new SettingsRepository(getPlatform().db);
      const [posterPath, wallpaperPath, mode, dim] = await Promise.all([
        settings.getString(SETTINGS.poster, ''), settings.getString(SETTINGS.wallpaper, ''),
        settings.getInt('app_background_mode', 0), settings.getInt('app_background_dim', 20),
      ]);
      const [poster, wallpaper] = await Promise.all([readAsset('poster', posterPath), readAsset('wallpaper', wallpaperPath)]);
      publish({ poster, wallpaper, mode, dim, ready: true });
    } catch { publish({ ...snapshot, ready: true }); }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  hydrating ??= reloadVisualAssets();
  return () => { listeners.delete(listener); };
}
const getSnapshot = () => snapshot;
export function useVisualAssets(): VisualAssets {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function replaceVisualAsset(kind: VisualKind, file: File): Promise<void> {
  return serial(async () => {
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) throw new Error('请选择 24 MB 以内的图片');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = format(bytes);
    if (!type) throw new Error('无法读取此图片，请选择常用照片格式');
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const path = `${PREFIX[kind]}${id}.${type.ext}`;
    const { fs, db } = getPlatform();
    const previous = safePath(kind, await new SettingsRepository(db).getString(SETTINGS[kind], ''));
    const image = await loadDecoded(path, bytes, type.mime, kind === 'wallpaper');
    try {
      await fs.writeFile(path, bytes);
      const persist = async (settings: SettingsRepository) => {
        await settings.setString(SETTINGS[kind], path);
        if (kind === 'wallpaper') await settings.setInt('app_background_mode', 1);
      };
      if (db.transaction) await db.transaction((tx) => persist(new SettingsRepository(tx)));
      else await persist(new SettingsRepository(db));
    } catch (error) {
      URL.revokeObjectURL(image.url);
      await fs.delete(path).catch(() => {});
      throw error;
    }
    publish({ ...snapshot, [kind]: image, mode: kind === 'wallpaper' ? 1 : snapshot.mode });
    if (previous && previous !== path) await fs.delete(previous).catch(() => {});
  });
}

export function clearVisualAsset(kind: VisualKind): Promise<void> {
  return serial(async () => {
    const { db, fs } = getPlatform();
    const previous = safePath(kind, await new SettingsRepository(db).getString(SETTINGS[kind], ''));
    const persist = async (settings: SettingsRepository) => {
      await settings.setString(SETTINGS[kind], '');
      if (kind === 'wallpaper') await settings.setInt('app_background_mode', 0);
    };
    if (db.transaction) await db.transaction((tx) => persist(new SettingsRepository(tx)));
    else await persist(new SettingsRepository(db));
    publish({ ...snapshot, [kind]: null, mode: kind === 'wallpaper' ? 0 : snapshot.mode });
    if (previous) await fs.delete(previous).catch(() => {});
  });
}

export function setWallpaperMode(mode: number): Promise<void> {
  return serial(async () => {
    await new SettingsRepository(getPlatform().db).setInt('app_background_mode', mode);
    publish({ ...snapshot, mode });
  });
}

export function setWallpaperDim(dim: number): void {
  publish({ ...snapshot, dim: Math.max(0, Math.min(50, dim)) });
  void serial(() => new SettingsRepository(getPlatform().db).setInt('app_background_dim', dim)).catch(() => {});
}
