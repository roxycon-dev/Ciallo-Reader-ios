import { Capacitor } from '@capacitor/core';
import { setAudioSource } from '@core/audio/audioSource';
import { setBitmapSource } from '@core/glass/bitmapSource';
import { setMediaQuerySource } from '@core/glass/mediaQuerySource';
import { setViewportSource } from '@core/glass/adaptiveSpec';
import { setKeyValueStore } from '@core/god/keyValueStore';
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
  StatusBarPort,
  ShareTextPort,
  SQLiteDatabase,
  StorageStatsPort,
  TtsEngine,
} from '@platform/interfaces';
import { createIosNativePlatform } from '@platform/ios-native';
import { createWebMockPlatform } from '@platform/web-mock';

export type PlatformKind = 'web-mock' | 'ios-native';

/**
 * 全平台能力包。
 *
 * 后 6 个端口（clipboard / haptics / shareText / screenAwake / storageStats /
 * documents）是本次审查补上的 —— 它们在Android 侧都有明确的 API 调用点
 * （每个端口的 JSDoc 里标了 Kotlin 文件:行号），此前 `src/ui/**` 直接调
 * `navigator.*` / 手搓 `<input type="file">`，绕过了注入约定。
 * `appInfo` 默认**显式抛错**，必须由装配处注入（见 `createUnwiredAppInfoPort`）。
 *
 * 再往后 4 个（statusBars / appLifecycle / network / keyboard / orientation /
 * externalBrowser / device）是 E67「`@capacitor/*` 插件真实接线」的产物，
 * 落点同为Kotlin API（见各端口 JSDoc 的文件:行号）。
 */
export interface PlatformBundle {
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

export type {
  AppInfoPort,
  AppLifecyclePort,
  ClipboardPort,
  DevicePort,
  DocumentPort,
  ExternalBrowserPort,
  FileSystemApi,
  HapticsPort,
  HttpClient,
  KeyValueStore,
  KeyboardPort,
  MediaHandle,
  MediaPlayerPort,
  MediaQueryPort,
  NetworkPort,
  OffscreenBitmapPort,
  OrientationLockPort,
  PickedFile,
  ScreenAwakePort,
  SecureStore,
  StatusBarPort,
  ShareTextPort,
  SQLiteDatabase,
  StorageStatsPort,
  TtsEngine,
  ViewportPort,
} from '@platform/interfaces';

let cached: PlatformBundle | null = null;

/**
 * 把 E61 新增的 5 个 core 注入源接到实际端口上。
 *
 * 为什么在这里（而不是各页面/组件里各自调）：`src/core/**` 里的
 * `motion.ts` / `liquidGlass.ts` / `adaptiveSpec.ts` / `ambientAudio.ts` /
 * `pageFlipSound.ts` / `godRankingSettings.ts` 都在**模块顶层或纯函数**里
 * 读这些能力，没有「某个组件负责初始化」的概念。`getPlatform()` 是全 App
 * 唯一可靠的「平台已就绪」时刻，所以集中在这里接一次。
 *
 * 幂等：`getPlatform()` 每次都返回同一个 `cached`，但 `resetPlatformCache()`
 * 会清空它，所以本函数必须能安全重跑（`setXxxSource` 都是幂等赋值）。
 */
function injectCoreSources(bundle: PlatformBundle): PlatformBundle {
  // 音频：Android `MediaPlayer` 的 Web 等价（capabilities.ts 内部才碰 `new Audio`）
  setAudioSource(bundle.media);
  // 媒体查询：Android `AccessibilityManager` 的 reduce-transparency / reduce-motion
  setMediaQuerySource(bundle.mediaQuery);
  // 视口：Android `Configuration.screenWidthDp / screenHeightDp`
  setViewportSource(bundle.viewport);
  // 键值存储：Android `SharedPreferences`（神回设置）
  setKeyValueStore(bundle.keyValue);
  // 离屏位图：Android `Bitmap.createBitmap` + `Canvas`（liquid glass 噪点）
  setBitmapSource(bundle.offscreenBitmap);
  return bundle;
}

export function getPlatform(): PlatformBundle {
  if (cached === null) {
    const bundle = Capacitor.isNativePlatform() ? createIosNativePlatform() : createWebMockPlatform();
    cached = injectCoreSources(bundle);
  }
  return cached;
}

export function getPlatformKind(): PlatformKind {
  return Capacitor.isNativePlatform() ? 'ios-native' : 'web-mock';
}

export function resetPlatformCache(): void {
  cached = null;
}
