import { Directory, Filesystem } from '@capacitor/filesystem';
import {
  createMediaPlayerPort,
  createMediaQueryPort,
  createViewportPort,
  createKeyValueStorePort,
  createOffscreenBitmapPort,
} from '@platform/capabilities';
import { createNativeAppLifecyclePort } from './appLifecyclePort';
import { createNativeExternalBrowserPort } from './browserPort';
import { createNativeDevicePort } from './devicePort';
import { createNativeHapticsPort } from './hapticsPort';
import { createNativeKeyboardPort } from './keyboardPort';
import { createNativeNetworkPort } from './networkPort';
import { createNativeOrientationLockPort } from './orientationPort';
import { createNativeStatusBarPort } from './statusBarPort';
import type {
  AppInfoPort,
  AppLifecyclePort,
  ClipboardPort,
  DevicePort,
  DocumentPort,
  ExternalBrowserPort,
  FileSystemApi,
  HapticsPort,
  HttpClient,
  KeyboardPort,
  KeyValueStore,
  MediaPlayerPort,
  MediaQueryPort,
  OffscreenBitmapPort,
  ViewportPort,
  NetworkPort,
  OrientationLockPort,
  ScreenAwakePort,
  SecureStore,
  ShareTextPort,
  StatusBarPort,
  SQLiteDatabase,
  StorageStatsPort,
  TtsEngine,
} from '@platform/interfaces';
import { CapacitorHttpClient } from './capacitorHttpClient';
import { CapacitorSqliteDatabase } from './capacitorDb';
import { withExclusiveDatabase } from '@platform/exclusiveDatabase';
import { writeNativeFileAtomic } from './atomicFiles';
import { CapacitorTtsEngine } from './ttsPlugin';
import { KeychainSecureStore } from './secureStore';
import { createNativeDocumentPort } from './documentPort';
import {
  createNativeAppInfoPort,
  createNativeClipboardPort,
  createNativeScreenAwakePort,
  createNativeShareTextPort,
  createNativeStorageStatsPort,
} from './readerDevicePort';

export { CapacitorHttpClient, createCapacitorHttpClient } from './capacitorHttpClient';
export { CapacitorSqliteDatabase, createCapacitorSqliteDatabase } from './capacitorDb';
export { CapacitorTtsEngine, createCapacitorTtsEngine } from './ttsPlugin';
export { createNativeKeyboardPort, IOS_KEYBOARD_RESIZE_MODE } from './keyboardPort';
export { createNativeDevicePort } from './devicePort';
export { createNativeExternalBrowserPort } from './browserPort';
export { createNativeOrientationLockPort } from './orientationPort';

export interface IosNativePlatform {
  media: MediaPlayerPort;
  mediaQuery: MediaQueryPort;
  viewport: ViewportPort;
  keyValue: KeyValueStore;
  offscreenBitmap: OffscreenBitmapPort;
  http: HttpClient;
  db: SQLiteDatabase;
  secure: SecureStore;
  fs: FileSystemApi;
  tts: TtsEngine;
  clipboard: ClipboardPort;
  haptics: HapticsPort;
  shareText: ShareTextPort;
  screenAwake: ScreenAwakePort;
  statusBars: StatusBarPort;
  appLifecycle: AppLifecyclePort;
  network: NetworkPort;
  keyboard: KeyboardPort;
  orientationLock: OrientationLockPort;
  externalBrowser: ExternalBrowserPort;
  device: DevicePort;
  storageStats: StorageStatsPort;
  documents: DocumentPort;
  appInfo: AppInfoPort;
}

class FilesystemApiAdapter implements FileSystemApi {
  async writeFileAtomic(path: string, data: Uint8Array): Promise<void> { await writeNativeFileAtomic(normalizeFsPath(path), data); }
  async readFile(path: string): Promise<Uint8Array> {
    const normalized = normalizeFsPath(path);
    const res = await Filesystem.readFile({ path: normalized, directory: Directory.Data });
    if (typeof res.data !== 'string') {
      throw new Error(`unexpected blob read for ${normalized}`);
    }
    return base64ToBytes(res.data);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const normalized = normalizeFsPath(path);
    await Filesystem.writeFile({
      path: normalized,
      data: bytesToBase64(data),
      directory: Directory.Data,
      recursive: true,
    });
  }

  async appendFile(path: string, data: Uint8Array): Promise<void> {
    await Filesystem.appendFile({ path: normalizeFsPath(path), data: bytesToBase64(data), directory: Directory.Data });
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizeFsPath(path);
    try {
      await Filesystem.stat({ path: normalized, directory: Directory.Data });
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    const normalized = normalizeFsPath(path);
    try {
      await Filesystem.deleteFile({ path: normalized, directory: Directory.Data });
    } catch {
      // missing files are not an error for delete
    }
  }

  async list(dir: string): Promise<string[]> {
    const normalized = normalizeFsPath(dir);
    try {
      const res = await Filesystem.readdir({ path: normalized, directory: Directory.Data });
      return res.files.map((f) => f.name).sort();
    } catch {
      return [];
    }
  }
}

export function createIosNativePlatform(): IosNativePlatform {
  return {
    media: createMediaPlayerPort(),
    mediaQuery: createMediaQueryPort(),
    viewport: createViewportPort(),
    keyValue: createKeyValueStorePort(),
    offscreenBitmap: createOffscreenBitmapPort(),
    http: new CapacitorHttpClient(),
    db: withExclusiveDatabase(new CapacitorSqliteDatabase()),
    secure: new KeychainSecureStore(),
    fs: new FilesystemApiAdapter(),
    tts: new CapacitorTtsEngine(),
    // WKWebView 与浏览器共用同一套 Web API 实现（见 platform/capabilities.ts）。
    clipboard: createNativeClipboardPort(),
    haptics: createNativeHapticsPort(),
    shareText: createNativeShareTextPort(),
    screenAwake: createNativeScreenAwakePort(),
    statusBars: createNativeStatusBarPort(),
    appLifecycle: createNativeAppLifecyclePort(),
    network: createNativeNetworkPort(),
    keyboard: createNativeKeyboardPort(),
    orientationLock: createNativeOrientationLockPort(),
    externalBrowser: createNativeExternalBrowserPort(),
    device: createNativeDevicePort(),
    storageStats: createNativeStorageStatsPort(),
    documents: createNativeDocumentPort(),
    appInfo: createNativeAppInfoPort(),
  };
}

function normalizeFsPath(path: string): string {
  const unified = path.replace(/\\/g, '/');
  const parts: string[] = [];
  for (const seg of unified.split('/')) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
