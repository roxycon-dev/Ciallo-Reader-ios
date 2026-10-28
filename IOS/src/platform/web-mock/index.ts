import {
  createAppLifecyclePort,
  createClipboardPort,
  createDevicePort,
  createDocumentPort,
  createExternalBrowserPort,
  createHapticsPort,
  createKeyboardPort,
  createMediaPlayerPort,
  createMediaQueryPort,
  createViewportPort,
  createKeyValueStorePort,
  createOffscreenBitmapPort,
  createNetworkPort,
  createOrientationLockPort,
  createScreenAwakePort,
  createShareTextPort,
  createStatusBarPort,
  createStorageStatsPort,
  createUnwiredAppInfoPort,
} from '@platform/capabilities';
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
import { FetchHttpClient } from './fetchHttpClient';
import { InMemorySqliteDatabase } from './inMemoryDb';
import { MemoryFileSystem } from './memoryFileSystem';
import { MemorySecureStore } from './memorySecureStore';
import { MockTtsEngine } from './mockTts';

export { FetchHttpClient, createFetchHttpClient } from './fetchHttpClient';
export { InMemorySqliteDatabase, openSchemaV12 } from './inMemoryDb';
export type { ColumnMeta, IndexMeta, TableMeta } from './inMemoryDb';
export { MemoryFileSystem, createMemoryFileSystem, normalizeFsPath } from './memoryFileSystem';
export { MemorySecureStore, createMemorySecureStore } from './memorySecureStore';
export { MockTtsEngine, createMockTtsEngine } from './mockTts';

export interface WebMockPlatform {
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

export function createWebMockPlatform(): WebMockPlatform {
  return {
    media: createMediaPlayerPort(),
    mediaQuery: createMediaQueryPort(),
    viewport: createViewportPort(),
    keyValue: createKeyValueStorePort(),
    offscreenBitmap: createOffscreenBitmapPort(),
    http: new FetchHttpClient(),
    db: new InMemorySqliteDatabase(),
    secure: new MemorySecureStore(),
    fs: new MemoryFileSystem(),
    tts: new MockTtsEngine(),
    // 浏览器与 WKWebView 共用同一套 Web API 实现（见 platform/capabilities.ts）。
    clipboard: createClipboardPort(),
    haptics: createHapticsPort(),
    shareText: createShareTextPort(),
    screenAwake: createScreenAwakePort(),
    statusBars: createStatusBarPort(),
    appLifecycle: createAppLifecyclePort(),
    network: createNetworkPort(),
    keyboard: createKeyboardPort(),
    orientationLock: createOrientationLockPort(),
    externalBrowser: createExternalBrowserPort(),
    device: createDevicePort(),
    storageStats: createStorageStatsPort(),
    documents: createDocumentPort(),
    appInfo: createUnwiredAppInfoPort(),
  };
}
