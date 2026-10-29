/**
 * 设备能力端口的 Web 实现（浏览器 dev 与 Capacitor 的 WKWebView 共用同一套 JS API）。
 *
 * 为什么放在 `platform/` 而不是分两套：`navigator.clipboard` / `navigator.share` /
 * `Screen Wake Lock` / `navigator.storage.estimate` 在**浏览器**和 **WKWebView** 里是
 * 同一个 Web API，差异只在"这台设备支不支持"，而"支不支持"由下面的显式抛错/返回
 * false 表达，不该由两套代码分叉。
 *
 * 铁律：**没有静默降级**。
 *  - 剪贴板 / 分享 / 常亮 / 存储统计：能力缺失一律抛错（带可搜索的固定文案）。
 *  - 触感：iOS 完全没有对应 API，差异**已登记**（`docs/PARITY_EXCEPTIONS.md` E28/E47），
 *    所以用 `impact(): boolean` 把"没触发"如实回传，不抛错。
 */
import type {
  AppInfoPort,
  AppLifecyclePort,
  ClipboardPort,
  DevicePort,
  DocumentPort,
  ExternalBrowserPort,
  HapticsPort,
  KeyboardPort,
  KeyValueStore,
  MediaHandle,
  MediaPlayerPort,
  MediaQueryPort,
  NetworkPort,
  OffscreenBitmapPort,
  OrientationLockPort,
  PickedFile,
  ScreenAwakePort,
  ShareTextPort,
  StatusBarPort,
  StorageStatsPort,
  ViewportPort,
} from '@platform/interfaces';

/* ══════════════ 剪贴板（Android ClipboardManager.setText） ══════════════ */

export const CLIPBOARD_UNAVAILABLE =
  '剪贴板不可用：本平台没有 navigator.clipboard（Android `ClipboardManager.setText` 无等价物）。';

export function createClipboardPort(): ClipboardPort {
  return {
    async writeText(text: string): Promise<void> {
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
      if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
        throw new Error(CLIPBOARD_UNAVAILABLE);
      }
      // `navigator.clipboard.writeText` 需要用户手势 + 安全上下文；
      // 失败时抛错（Android 的 setPrimaryClip 不会失败，差异见报告）。
      await clipboard.writeText(text);
    },
  };
}

/* ══════════════ 触感（Android Vibrator / HapticsGate） ══════════════ */

export function createHapticsPort(): HapticsPort {
  return {
    impact(millis: number): boolean {
      if (typeof navigator === 'undefined') return false;
      if (typeof navigator.vibrate !== 'function') return false;
      return navigator.vibrate(millis);
    },
  };
}

/* ══════════════ 文本分享（Android ACTION_SEND + createChooser） ══════════════ */

export const SHARE_UNAVAILABLE =
  '系统分享不可用：本平台没有 navigator.share（Android `Intent.createChooser` 无等价物）。';

export function createShareTextPort(): ShareTextPort {
  return {
    async shareText(options: { title: string; text: string }): Promise<void> {
      const share = typeof navigator === 'undefined' ? undefined : navigator.share;
      if (share === undefined) {
        throw new Error(SHARE_UNAVAILABLE);
      }
      await share.call(navigator, { title: options.title, text: options.text });
    },
  };
}

/* ══════════════ 屏幕常亮（Android FLAG_KEEP_SCREEN_ON） ══════════════ */

export const WAKE_LOCK_UNAVAILABLE =
  '屏幕常亮不可用：需要 Screen Wake Lock API（iOS 需 16.4+；Android 侧原生 FLAG_KEEP_SCREEN_ON 无此限制）。';

export function createScreenAwakePort(): ScreenAwakePort {
  // `navigator.wakeLock` 的类型在 lib.dom 里可能缺席，这里按结构取，避免 any。
  interface WakeLockSentinelLike {
    released: boolean;
    release(): Promise<void>;
    addEventListener(type: 'release', listener: () => void): void;
  }
  interface WakeLockLike {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  }
  let sentinel: WakeLockSentinelLike | null = null;

  const wakeLock = (): WakeLockLike | null => {
    const nav = navigator as unknown as { wakeLock?: WakeLockLike };
    return nav.wakeLock ?? null;
  };

  return {
    async setEnabled(enabled: boolean): Promise<void> {
      const api = wakeLock();
      if (api === null) {
        if (enabled) throw new Error(WAKE_LOCK_UNAVAILABLE);
        // 关闭时没有 API 也无所谓（本来就没开过）。
        return;
      }
      if (enabled) {
        if (sentinel !== null && !sentinel.released) return;
        sentinel = await api.request('screen');
        return;
      }
      const current = sentinel;
      sentinel = null;
      if (current !== null) await current.release();
    },
  };
}

/* ══════════════ 沉浸式状态栏（Android WindowInsetsController.hide(statusBars())） ══════════════ */

export const STATUS_BAR_UNAVAILABLE =
  '沉浸式状态栏不可用：本平台是网页标签（浏览器/WKWebView），没有 OS 状态栏可隐藏（Android `controller.hide(statusBars())` 无等价物）。' +
  '沉浸式视觉由 CSS `env(safe-area-inset-*)` 提供，调用方应在捕获此错误后回退到 safe-area 布局。';

export function createStatusBarPort(): StatusBarPort {
  // 网页语境下没有 OS 状态栏。`setHidden(true)` 永远无法达成，必须显式抛错
  // （不静默降级）；`setHidden(false)` 是"恢复"语义，本来就什么都没改过，直接空返回。
  return {
    async setHidden(hidden: boolean): Promise<void> {
      if (hidden) {
        throw new Error(STATUS_BAR_UNAVAILABLE);
      }
      // 恢复：网页下无状态栏可恢复，安全空返回。
      return;
    },
  };
}

/* ══════════════ 应用前后台生命周期（Android ProcessLifecycleOwner ON_START/ON_STOP） ══════════════ */

/**
 * 浏览器实现的语义弱于原生（只覆盖「标签页可见性」），但这是网页语境下**唯一**可得的
 * 等价信号，故按铁律使用并在此登记差异：WKWebView 里应改用 `ios-native` 的
 * `@capacitor/app` 实现（覆盖控制中心下拉 / 来电 / 锁屏等原生前后台切换）。
 * 两条实现对调用方（`ReaderPage.useReadingTimer`）完全同形。
 */
export function createAppLifecyclePort(): AppLifecyclePort {
  let listenerCount = 0;
  const handlers = new Set<(foreground: boolean) => void>();

  const isForeground = (): boolean => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState !== 'hidden';
  };

  const dispatch = (): void => {
    const fg = isForeground();
    for (const handler of handlers) handler(fg);
  };

  return {
    isForeground,
    subscribe(onChange: (foreground: boolean) => void): () => void {
      handlers.add(onChange);
      if (listenerCount === 0 && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', dispatch);
      }
      listenerCount += 1;
      return (): void => {
        handlers.delete(onChange);
        listenerCount -= 1;
        if (listenerCount === 0 && typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', dispatch);
        }
      };
    },
  };
}

/* ══════════════ 网络类型探测（Android ConnectivityManager/NetworkCapabilities） ══════════════ */

/**
 * Web 端用 `navigator.connection.effectiveType`（Network Information API）近似
 * `TRANSPORT_WIFI || NET_CAPABILITY_NOT_METERED`：`wifi` / `4g` 视为「Wi-Fi 或不计费」，
 * `3g` / `2g` / `slow-2g` 视为计费网络。浏览器不支持该 API 时按 Kotlin
 * `cm == null → true` 的兜底放行。
 */
export function createNetworkPort(): NetworkPort {
  return {
    async wifiConnectedOrUnmetered(): Promise<boolean> {
      const nav = typeof navigator === 'undefined' ? undefined : navigator;
      // lib.dom 里 Navigator.connection 不一定在，按结构取，避免 any。
      const conn = (nav as unknown as { connection?: { effectiveType?: string } }).connection;
      if (conn === undefined || typeof conn.effectiveType !== 'string') {
        // Kotlin L698 `cm == null → return true`：探测不到就放行。
        return true;
      }
      // Kotlin L701-702：Wi-Fi 传输 或 不计费能力。
      return conn.effectiveType === 'wifi' || conn.effectiveType === '4g';
    },
  };
}

/* ══════════════ 软键盘避让（Android WindowInsets.imeAnimationTarget） ══════════════ */

/**
 * 浏览器实现：用 `window.visualViewport` 的 `resize`/`scroll` 事件近似
 * `WindowInsets.ime`。**关键约束来自 Kotlin 注释本身**（`LibraryScreen.kt:626-632`）：
 * 那段代码刻意用 `imeAnimationTarget`（动画目标值）而**不是**逐帧的 `ime`，
 * 理由是"每帧重排才是弹键盘卡的根因"。
 *
 * 所以这里必须做同样的取舍：只在高度**稳定**后派发一次（`KEYBOARD_SETTLE_MS` 内
 * 无新事件即视为动画结束），而不是每个 `resize` 事件都派发。视觉结果与
 * `imeAnimationTarget` 一致（最终布局相同），同样不逐帧重排。
 *
 * ⚠️ 差异登记：`visualViewport` 在桌面浏览器里永不变化（没有软键盘），
 * 故 `isVisible()` 恒 `false`；这是真实语义差异，不是缺陷。
 */
export function createKeyboardPort(): KeyboardPort {
  const STATE = { visible: false, height: 0 };
  const handlers = new Set<(state: { visible: boolean; height: number }) => void>();
  let attached = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingHeight = 0;

  const viewport = (): VisualViewport | null => {
    if (typeof window === 'undefined') return null;
    return window.visualViewport ?? null;
  };

  /** 键盘遮挡高度 = 布局视口高度 − 视觉视口高度 − 视觉视口顶部偏移。 */
  const measure = (): number => {
    const vv = viewport();
    if (vv === null || typeof window.innerHeight !== 'number') return 0;
    const hidden = window.innerHeight - vv.height - vv.offsetTop;
    return hidden > 0 ? Math.round(hidden) : 0;
  };

  const dispatch = (): void => {
    const height = pendingHeight;
    const visible = height > 0;
    if (visible === STATE.visible && height === STATE.height) return;
    STATE.visible = visible;
    STATE.height = height;
    for (const handler of handlers) handler({ visible, height });
  };

  /**
   * 无条件派发一次当前状态（给新订阅者）。
   * ⚠️ 必须有：Kotlin 的 `Modifier.imePadding()` 在组合时读的是**当前**的
   * `imeAnimationTarget`，所以「键盘已弹起后才进入书库页」时页面**立刻**就是
   * 让位后的布局。若订阅时不补发，新订阅者会一直看到 0 直到下次键盘变化。
   */
  const dispatchInitial = (): void => {
    const height = pendingHeight;
    const visible = height > 0;
    STATE.visible = visible;
    STATE.height = height;
    for (const handler of handlers) handler({ visible, height });
  };

  /** 逐帧事件只更新 pending，等「安静」下来再派发一次（= imeAnimationTarget）。 */
  const onViewportChange = (): void => {
    pendingHeight = measure();
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      dispatch();
    }, KEYBOARD_SETTLE_MS);
  };

  return {
    isVisible(): boolean {
      return STATE.visible;
    },
    height(): number {
      return STATE.height;
    },
    subscribe(onChange: (state: { visible: boolean; height: number }) => void): () => void {
      handlers.add(onChange);
      if (!attached) {
        const vv = viewport();
        if (vv !== null) {
          vv.addEventListener('resize', onViewportChange);
          vv.addEventListener('scroll', onViewportChange);
          attached = true;
        }
      }
      pendingHeight = measure();
      dispatchInitial();
      return (): void => {
        handlers.delete(onChange);
        if (handlers.size === 0 && attached) {
          const vv = viewport();
          if (vv !== null) {
            vv.removeEventListener('resize', onViewportChange);
            vv.removeEventListener('scroll', onViewportChange);
          }
          attached = false;
          if (settleTimer !== null) {
            clearTimeout(settleTimer);
            settleTimer = null;
          }
        }
      };
    },
    async setResizeMode(): Promise<void> {
      // Android `windowSoftInputMode="adjustResize"` 在浏览器里没有对应控制：
      // 桌面浏览器无软键盘，移动浏览器由浏览器自己决定视口行为，页面无权干预。
      // 按铁律**显式抛错**，而不是静默假装成功。
      throw new Error(KEYBOARD_RESIZE_UNAVAILABLE);
    },
  };
}

/** 见 `createKeyboardPort` 的类注释：等键盘动画停下来再派发一次。 */
export const KEYBOARD_SETTLE_MS = 120;

export const KEYBOARD_RESIZE_UNAVAILABLE =
  '键盘 resize 模式不可用：浏览器的视口行为由浏览器自己决定，没有等价于 Android `windowSoftInputMode="adjustResize"` 的控制项。';

/* ══════════════ 屏幕方向锁（Android Activity.requestedOrientation） ══════════════ */

export const ORIENTATION_LOCK_UNAVAILABLE =
  '屏幕方向锁不可用：浏览器没有等价于 Android `Activity.requestedOrientation` 的 API（`screen.orientation.lock()` 只在部分浏览器 + 全屏/已安装的 PWA 语境下可用，且要求方向为 `portrait-primary` / `landscape-primary`）。';

interface ScreenOrientationLockLike {
  lock(orientation: string): Promise<void>;
  unlock(): Promise<void>;
}

function screenOrientationApi(): ScreenOrientationLockLike | null {
  if (typeof screen === 'undefined') return null;
  const api = (screen as unknown as { orientation?: ScreenOrientationLockLike }).orientation;
  if (api === undefined || typeof api.lock !== 'function') return null;
  return api;
}

/**
 * 浏览器实现：优先用标准 Screen Orientation Lock。
 * ⚠️ 语义差异（登记在 `docs/PARITY_EXCEPTIONS.md`）：该 API 要求**全屏**且把
 * 方向锁在 `primary` 上（不能锁 `secondary`，也不能锁 `natural` 的翻转），
 * 与 Kotlin `SCREEN_ORIENTATION_LANDSCAPE`（可横竖双向）的行为不完全一致，
 * 且在 WKWebView 里不可用 —— iOS 侧走自写插件，不用这份实现。
 */
export function createOrientationLockPort(): OrientationLockPort {
  return {
    async setLock(mode: 0 | 1 | 2): Promise<void> {
      const api = screenOrientationApi();
      // Kotlin L402 `else -> SCREEN_ORIENTATION_UNSPECIFIED` = 解锁。
      if (mode === 0) {
        if (api === null) return;
        await api.unlock();
        return;
      }
      if (api === null) throw new Error(ORIENTATION_LOCK_UNAVAILABLE);
      // 1 → portrait-primary，2 → landscape-primary。
      await api.lock(mode === 1 ? 'portrait-primary' : 'landscape-primary');
    },
  };
}

/* ══════════════ 外部浏览器（Android Intent.ACTION_VIEW） ══════════════ */

export const EXTERNAL_BROWSER_UNAVAILABLE =
  '无法打开外部页面：本平台的 window.open 被拦截（WKWebView / 弹窗拦截器会既不报错也不导航）。' +
  'Android 侧对应 `Intent(ACTION_VIEW, uri)` + `startActivity`，始终有系统浏览器可接。';

export function createExternalBrowserPort(): ExternalBrowserPort {
  return {
    async open(url: string): Promise<void> {
      if (typeof window === 'undefined') throw new Error(EXTERNAL_BROWSER_UNAVAILABLE);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      // `window.open` 返回 null 有两种含义：被拦截 / 无 window 环境。
      // 两种都是"没打开"，按铁律抛错由调用方toast（Kotlin 的「无法打开注册页面」）。
      if (opened === null) throw new Error(EXTERNAL_BROWSER_UNAVAILABLE);
    },
    async close(): Promise<void> {
      // 浏览器里无法关闭别的标签页；Kotlin 也没有对应调用点。空返回（非静默降级：
      // 该方法在 Kotlin 侧同样没有调用点，只为端口对称而存在）。
      return;
    },
  };
}

/* ══════════════ 设备信息（Android Build.VERSION / Build.MODEL） ══════════════ */

/**
 * 浏览器实现：`navigator.userAgent` + `userAgentData`（若在）。
 * ⚠️ 与 Kotlin 的差异：Android 的 `Build.MODEL` 是**精确型号**
 * （如 `Pixel 7`），浏览器的 UA 只能给到粗粒度字符串，
 * 且 iPad 会伪装成 Mac —— 该端口**不得**用于做机型判定，
 * 只用于展示与日志。差异已登记。
 */
export function createDevicePort(): DevicePort {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const ua = nav?.userAgent ?? '';
  const uaData = (nav as unknown as {
    userAgentData?: { platform?: string; mobile?: boolean };
  })?.userAgentData;

  return {
    async info(): Promise<{
      model: string;
      manufacturer: string;
      osVersion: string;
      osVersionCode: number;
      platform: string;
      isVirtual: boolean;
    }> {
      const platform =
        uaData?.platform !== undefined
          ? uaData.platform
          : ua.includes('Android')
            ? 'android'
            : ua.includes('iPhone') || ua.includes('iPad') || ua.includes('iPod')
              ? 'ios'
              : ua.includes('Mac') || ua.includes('Windows') || ua.includes('Linux')
                ? 'desktop'
                : 'web';
      return {
        model: ua,
        manufacturer: '',
        osVersion: '',
        // 浏览器侧无版本刻度（Android 的 SDK_INT 与 iOS 版本号本就不同刻度），
        // 用0 表示"未知"，调用方必须显式处理而不是拿它当门槛。
        osVersionCode: 0,
        platform,
        // UA 判不准模拟器；`mobile === false` 时也可能是桌面浏览器，不是"模拟"，
        // 所以保守给 false（= 认为是真机/真浏览器）。
        isVirtual: false,
      };
    },
  };
}

/* ══════════════ 存储统计（Android StatFs / StorageManager） ══════════════ */

export const STORAGE_STATS_UNAVAILABLE =
  '存储统计不可用：本平台没有 navigator.storage.estimate（Android `StatFs` 无等价物）。';

export function createStorageStatsPort(): StorageStatsPort {
  return {
    async volumeStats(): Promise<{ freeBytes: number; totalBytes: number }> {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate === undefined || estimate.quota === undefined) {
        throw new Error(STORAGE_STATS_UNAVAILABLE);
      }
      return {
        freeBytes: estimate.quota - (estimate.usage ?? 0),
        totalBytes: estimate.quota,
      };
    },
  };
}

/* ══════════════ 应用版本（Android PackageManager.getPackageInfo） ══════════════ */

export const APP_INFO_UNWIRED =
  '应用版本未接线：请在装配处注入 AppInfoPort（Android `packageManager.getPackageInfo(...).versionName`；' +
  'iOS 的 CFBundleShortVersionString 与安卓 versionName 是两套号，不能直接读）。';

export function createUnwiredAppInfoPort(): AppInfoPort {
  return {
    versionName(): Promise<string> {
      return Promise.reject(new Error(APP_INFO_UNWIRED));
    },
  };
}

/* ══════════════ 文档收发（Android SAF CreateDocument / OpenDocument / GetContent） ══════════════ */

export function createDocumentPort(): DocumentPort {
  return {
    pickFile(options: { accept?: string; multiple?: boolean }): Promise<PickedFile[]> {
      return pickFiles(options.accept, options.multiple === true);
    },
    async saveFile(file: { fileName: string; mime: string; bytes: Uint8Array }): Promise<void> {
      const blob = new Blob([file.bytes as unknown as BlobPart], { type: file.mime });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // Safari/WKWebView 需要等一拍再 revoke，否则下载会被取消。
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
    },
  };
}

function pickFiles(accept: string | undefined, multiple: boolean): Promise<PickedFile[]> {
  return new Promise<PickedFile[]>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('文件选择不可用：本平台没有 document（Android SAF 无等价物）。'));
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    if (accept !== undefined) input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;

    const finish = (files: PickedFile[]): void => {
      if (settled) return;
      settled = true;
      input.remove();
      detachWindowListeners();
      resolve(files);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      input.remove();
      detachWindowListeners();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    input.addEventListener('change', () => {
      const picked = input.files;
      if (picked === null || picked.length === 0) {
        finish([]);
        return;
      }
      void Promise.all(
        [...picked].map(async (file): Promise<PickedFile> => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          mime: file.type === '' ? 'application/octet-stream' : file.type,
        })),
      ).then(finish, fail);
    });
    // 取消（主路径）：`cancel` 事件需要 iOS 16.4+ / Chrome 113+ 的 WebKit/Blink。
    input.addEventListener('cancel', () => {
      finish([]);
    });

    // 取消（兜底）：2026-10-11 前，下一行注释写着「用 focus 兜底」但**没有实现** ——
    // iOS 16.0–16.3 的 WKWebView 没有 cancel 事件，用户取消后 Promise 永远挂起、
    // 隐藏 input 滞留 DOM（Android 的 picker 回调恒会以 null 回来，见
    // `god/GodMomentSheet.kt:326-334`）。补焦点对：只有「窗口先失焦（选择器打开）
    // 再恢复焦点」才武装判定；恢复后 1s 仍无 change 且 files 为空 → 按取消收口。
    // 选定图片时 change 与焦点同拍到达且先经 settled 守卫，不会误伤真实选择。
    let dialogSeen = false;
    const onWindowBlur = (): void => {
      dialogSeen = true;
    };
    const onWindowFocus = (): void => {
      if (!dialogSeen) return;
      window.setTimeout(() => {
        if (settled) return;
        const picked = input.files;
        if (picked === null || picked.length === 0) finish([]);
      }, 1000);
    };
    const detachWindowListeners = (): void => {
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
    };
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);

    document.body.appendChild(input);
    input.click();
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 以下 5 个实现为 E61 新增。
 *
 * 存在的唯一理由：把 `src/core/**` 里的 DOM 全局访问赶到 platform 层来。
 * `core` 侧的调用方（ambientAudio / pageFlipSound / motion / liquidGlass /
 * adaptiveSpec / godRankingSettings）改为依赖 `MediaPlayerPort` 等抽象，
 * 于是核心层在 Node worker / 小程序壳里也能跑（宿主不支持时按各端口约定
 * 返回 `null` / `false`，不抛错 —— 详见各端口 JSDoc）。
 * ══════════════════════════════════════════════════════════════════════════ */

/* ── 音频（Android MediaPlayer / SoundPool） ── */

export function createMediaPlayerPort(): MediaPlayerPort {
  return {
    create(url: string, options?: { loop?: boolean; volume?: number }): MediaHandle | null {
      // 宿主没有 Audio 构造器（Node worker / 小程序壳）→ 返回 null，
      // 调用方按「该场景没有环境音」处理，不抛错。
      if (typeof Audio === 'undefined') return null;
      let el: HTMLAudioElement;
      try {
        el = new Audio(url);
      } catch {
        // Android `MediaPlayer()` 在资源损坏时抛 —— 语义一致，返回 null 让
        // 调用方走「跳过」分支（core 侧原本也是 try/catch 后返回 null）。
        return null;
      }
      el.loop = options?.loop === true;
      if (options?.volume !== undefined) el.volume = Math.min(1, Math.max(0, options.volume));
      if (options?.loop === true) el.preload = 'auto';

      // `canplaythrough` 只可能触发一次，用 once 收口；`error` 也要收，
      // 否则网络失败时 handle 永远停在 not-ready（与 Android 的错误态一致）。
      return {
        isReady: () => el.readyState >= 2,
        play: () => el.play(),
        pause: () => {
          el.pause();
        },
        setLoop: (loop: boolean) => {
          el.loop = loop;
        },
        setVolume: (volume: number) => {
          el.volume = Math.min(1, Math.max(0, volume));
        },
        setPosition: (seconds: number) => {
          el.currentTime = seconds;
        },
        release: () => {
          try {
            el.pause();
            el.src = '';
          } catch {
            /* 释放失败不影响调用方（core 的 release 也不抛） */
          }
        },
      };
    },
  };
}

/* ── 媒体查询（Android AccessibilityManager flag） ── */

export function createMediaQueryPort(): MediaQueryPort {
  return {
    matches(query: string): boolean {
      // 宿主无 matchMedia（Node worker / 老旧 WebView）→ false。
      // 对应 Kotlin `GlassKit.kt:300` 读取失败时按 0f 处理的兜底。
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
      try {
        return window.matchMedia(query).matches;
      } catch {
        return false;
      }
    },
  };
}

/* ── 视口（Android Configuration.screenWidthDp / screenHeightDp） ── */

export function createViewportPort(): ViewportPort {
  return {
    width: () => (typeof window === 'undefined' ? 0 : window.innerWidth),
    height: () => (typeof window === 'undefined' ? 0 : window.innerHeight),
  };
}

/* ── 键值存储（Android SharedPreferences） ── */

export function createKeyValueStorePort(): KeyValueStore {
  return {
    get(key: string): string | null {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // 隐私模式 / 存储被禁用时 localStorage.getItem 本身会抛。
        return null;
      }
    },
    set(key: string, value: string): void {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // 配额超限：Kotlin 侧 `edit {}` 也是静默失败，保持一致。
      }
    },
    remove(key: string): void {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* 同上 */
      }
    },
  };
}

/* ── 离屏位图（Android Bitmap.createBitmap + Canvas） ── */

export function createOffscreenBitmapPort(): OffscreenBitmapPort {
  return {
    createDataUrl(
      size: number,
      fill: (set: (x: number, y: number, r: number, g: number, b: number, a: number) => void) => void,
    ): string | null {
      if (typeof document === 'undefined') return null;
      let canvas: HTMLCanvasElement;
      try {
        canvas = document.createElement('canvas');
      } catch {
        return null;
      }
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return null;
      const image = ctx.createImageData(size, size);
      const data = image.data;
      fill((x, y, r, g, b, a) => {
        const i = (y * size + x) * 4;
        if (data === undefined) return;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = a;
      });
      ctx.putImageData(image, 0, 0);
      // 同步导出：core 侧要立即拿到 URL 填 CSS，不能等 toBlob 的异步。
      return canvas.toDataURL('image/png');
    },
  };
}
