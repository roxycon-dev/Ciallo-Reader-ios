/**
 * Platform interfaces — implementations live in platform/web-mock and platform/ios-native.
 * core/ depends only on these types.
 *
 * 铁律（项目约定）：平台不可移植能力一律「声明注入接口 + 未接线时显式抛错」，
 * **不静默降级**。下面每个接口都标了它对应的 Android 调用点，便于对拍。
 */

/* ══════════════ 设备能力端口（Android 侧逐条对应，见下方注释） ══════════════ */

/**
 * Android `javax.crypto.Cipher` / `SecretKeySpec` / `IvParameterSpec`
 * —— `library/MhttuImageDecryptor.kt:23-29`（`AES/CBC/PKCS5Padding`）。
 *
 * ⚠️ 与 `@core/source/js/jsPlatform` 里那个**同步** `CryptoPort` 是两回事：
 * 那个对应书源 JS 运行时（Kotlin `MessageDigest`/`Mac` 全同步），本接口是给 core 的
 * 图片/数据解密用的，WebCrypto 天然异步。两者名字相似但语义与消费方都不同，故分开命名。
 *
 * 为什么不直接用 WebCrypto：`src/core/**` 禁止 import 平台模块（见本文件顶部铁律与
 * `eslint.config.js` 的 `no-restricted-imports`），所以 core 只声明这个端口，由
 * `platform/web/webCrypto.ts` 提供实现。WKWebView 与浏览器都原生带 `crypto.subtle`，
 * 因此**一份实现通吃 web 与 iOS**，不需要 Capacitor 插件。
 *
 * ⚠️ 与 Kotlin 的差异：Java 的 `Cipher.doFinal` 是**同步**的，而 `subtle.decrypt` 是
 * Promise。因此调用链（`libraryImageBytes.decryptIfNeeded` → `ComicLocalImporter` 逐页管线
 * → `OnlineComicReaderScreen` 的图片处理）在本项目里是 async 的。这是平台 API 的必然差异，
 * 不是行为差异 —— 见 `docs/PARITY_EXCEPTIONS.md` E83。
 *
 * Java 的 `PKCS5Padding` 对 AES 而言就是 PKCS#7，正是 WebCrypto `AES-CBC` 自动去填充的语义。
 */
export interface AsyncCryptoPort {
  /**
   * Android `Cipher.getInstance("AES/CBC/PKCS5Padding")` +
   * `cipher.init(DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))` +
   * `cipher.doFinal(ciphertext)`。
   *
   * @param key 16 / 24 / 32 字节（AES-128/192/256）。漫蛙图床用 32 字节 → AES-256。
   * @param iv 恰好 16 字节。
   * @returns 解密后的字节；**失败必须 reject 或抛错，不许静默返回密文**
   *         （Kotlin 的 `catch { data }` 由调用方的 `catch` 负责，见 `decryptIfNeeded`）。
   */
  decryptAesCbc(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
  ): Promise<Uint8Array>;
}

/**
 * Android `android.content.ClipboardManager.setText` / Compose
 * `LocalClipboardManager.current.setText(AnnotatedString(text))`
 * —— `ui/components/AppErrorSnackbar.kt:40`、
 * `ui/source/SourceManagementScreen.kt:516`、`ui/help/LibraryHelpBottomSheet.kt:254`。
 * ⚠️ 原先没有端口：`src/ui/**` 直接调 `navigator.clipboard`，绕过了注入约定。
 */
export interface ClipboardPort {
  /** Android `clipboard.setPrimaryClip(ClipData.newPlainText(null, text))`。 */
  writeText(text: string): Promise<void>;
}

/**
 * Android `Vibrator` / `HapticsGate` —— `ui/feedback/Motion.kt:119-163`
 * （`VibrationEffect.createOneShot` / `predefined(EFFECT_CLICK|HEAVY_CLICK|TICK)`）。
 * iOS Safari/WKWebView **没有**标准触感 API，`navigator.vibrate` 只在部分平台存在。
 * @returns 是否真的触发了触感（false = 本平台无此能力，差异已登记 E28/E47）。
 */
export interface HapticsPort {
  /** Android `HapticFeedbackType` 阶梯 → 时长（ms）。 */
  impact(millis: number): boolean;
}

/**
 * Android `Intent.ACTION_SEND` + `Intent.createChooser(intent, title)` + `startActivity`
 * —— `ui/StatisticsScreen.kt:524-528`（"分享阅读报告"）、
 * `ui/HomeScreen.kt:2292-2297`（"分享"）。
 * 文件分享（`BookShareHelper.kt:79-89`，带 FileProvider URI）走 `BookSharePort`。
 */
export interface ShareTextPort {
  /** Android `Intent.EXTRA_SUBJECT` / `EXTRA_TEXT` + chooser 标题。 */
  shareText(options: { title: string; text: string }): Promise<void>;
}

/**
 * Android `activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)`
 * —— `ui/ReaderScreen.kt:686-706`（`DisposableEffect(prefs.keepScreenOn)`）。
 * Web 无标准常亮 API 的等价物是 Screen Wake Lock API（iOS 需 16.4+）。
 * ⚠️ 原先**只有** `ReaderPrefs.keepScreenOn` 这个设置项，没有任何接入点，
 * `docs/PARITY_EXCEPTIONS.md` 的 E52「已声明接入点」与事实不符。
 */
export interface ScreenAwakePort {
  /** Android `addFlags` / `clearFlags(FLAG_KEEP_SCREEN_ON)`. */
  setEnabled(enabled: boolean): Promise<void>;
}

/**
 * Android `WindowCompat.getInsetsController(window, decorView)` →
 * `controller.hide(WindowInsetsCompat.Type.systemBars() / statusBars())`
 * （`ui/ReaderScreen.kt:709-726` 退出恢复 + `ui/comic/ComicReaderCore.kt:400-423`
 * `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` + `hide(systemBars())`）。
 * ⚠️ 原先**只有** `ReaderScreen.kt` 的「退出恢复」一行 `show()`、`ComicReaderCore` 的
 * `hide()` 语义，**没有任何 iOS 调用方**，且 `@capacitor/status-bar@8.0.4`
 * 全仓零 import（见 E62）。`setHidden(true)` 在浏览器/WKWebView 的「网页标签」语境里
 * 没有 OS 状态栏可隐藏 —— web-mock 显式抛错（不静默降级），沉浸由 CSS `safe-area` 提供。
 */
export interface StatusBarPort {
  /** Android `controller.hide(statusBars())` / `show(statusBars())`。 */
  setHidden(hidden: boolean): Promise<void>;
}

/**
 * Android `ProcessLifecycleOwner` + `LifecycleEventObserver`
 * —— `ui/ReadingTimerEffect.kt:91-107`（`ON_START` → `active = true`；
 * `ON_STOP` → `active = false` + `endCurrentSession()`）。
 *
 * 权威落点**不是** `document.visibilityState`：Kotlin 依赖的是
 * `androidx.lifecycle` 的进程级 ON_START/ON_STOP 观察者。在 WKWebView 里
 * `visibilityState` 只反映「页面标签是否可见」，**不覆盖** iOS 的
 * 「控制中心下拉 / 来电 / 锁屏 / 切到别的 App 再回来」这一整类原生
 * 前后台切换 —— 那是 `@capacitor/app` 的 `appStateChange`
 * （iOS 侧接 `UIApplication.willResignActive` / `didBecomeActive`）。
 *
 * ⚠️ 未接线前 `src/ui/pages/ReaderPage.tsx` 的 `useReadingTimer` 直接读
 * `document.visibilityState`，与 Kotlin 生命周期语义不等价（见 E67）。
 */
export interface AppLifecyclePort {
  /** 当前是否在前台（等价 Kotlin `Lifecycle.currentState.isAtLeast(STARTED)`）。 */
  isForeground(): boolean;
  /**
   * 订阅前后台切换，返回退订函数。
   * 回调参数 `true` = 前台（Kotlin `ON_START`），`false` = 后台（`ON_STOP`）。
   * 对应 Kotlin `lifecycle.addObserver(observer)` / `removeObserver(observer)`。
   */
  subscribe(onChange: (foreground: boolean) => void): () => void;
}

/**
 * Android `ConnectivityManager` + `NetworkCapabilities` —— `ui/comic/ComicPageLoader.kt:696-703`
 * ```kotlin
 * private fun wifiConnectedOrUnmetered(): Boolean {
 *     val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return true
 *     val net = cm.activeNetwork ?: return false
 *     val caps = cm.getNetworkCapabilities(net) ?: return true
 *     return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
 *         caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
 * }
 * ```
 * 落点是「仅 Wi-Fi 预加载」开关（`preload_wifi_only`）——开启后非 Wi-Fi/计费网络下
 * 不预取在线页，本地页不受影响，当前页永远加载（Kotlin L719-722 的过滤语义）。
 *
 * ⚠️ 逐条保留 Kotlin 的三个兜底默认值（`?: true` / `?: false` / `?: true`），
 * 它们决定「拿不到系统信息时到底放行还是拦截」，不能统一成一种。
 */
export interface NetworkPort {
  /**
   * 是否处于 Wi-Fi 或**不计费**网络。
   * 无法探测时按 Kotlin 的兜底语义返回 `true`（放行，宁可多下也不卡住阅读）。
   */
  wifiConnectedOrUnmetered(): Promise<boolean>;
}

/**
 * Android `StatFs(filesDir)` + `StorageManager.getAllocatableBytes`
 * —— `ui/CacheManagementScreen.kt:347`（`Build.VERSION.SDK_INT >= O` 时的系统总量）
 * 与 `:360`（`StatFs` 拿 `availableBytes` / `totalBytes`）。
 */
export interface StorageStatsPort {
  /** 返回卷的可用/总字节数；平台拿不到时**抛错**（不返回 0，避免 UI 静默隐藏整行）。 */
  volumeStats(): Promise<{ freeBytes: number; totalBytes: number }>;
}

/**
 * Android `context.packageManager.getPackageInfo(context.packageName, 0).versionName`
 * —— `ui/SettingsTabScreen.kt:1360`（"关于"里的版本号 + `updateChecker.check(versionName)`）。
 * iOS 侧的 `CFBundleShortVersionString` 由 `MARKETING_VERSION` 决定，与安卓的
 * `versionName` 是两套号，必须显式接线。
 */
export interface AppInfoPort {
  /** Android `PackageInfo.versionName`（kotlin：`BuildConfig.VERSION_NAME` 兜底）。 */
  versionName(): Promise<string>;
}

/**
 * Android `ActivityResultContracts.CreateDocument(mime)` / `OpenDocument()` /
 * `GetContent()` / `PickVisualMedia()` —— `ui/SettingsTabScreen.kt:143/160/246/280`、
 * `ui/ReaderScreen.kt:408/432`、`MainActivity.kt:388`、
 * `ui/source/SourceManagementScreen.kt:313`、`god/GodMomentSheet.kt:326`、
 * `ui/AppUpdateDialog.kt:74`。
 * ⚠️ 原先**没有端口**：`src/ui/**` 每处各自手搓一个隐藏 `<input type="file">`，
 * 导出路径（`CreateDocument`）根本没有对应实现。
 */
export interface DocumentPort {
  /** Android `GetContent()` / `OpenDocument()` / `PickVisualMedia(ImageOnly)`。 */
  pickFile(options: { accept?: string; multiple?: boolean }): Promise<PickedFile[]>;
  /** Android `CreateDocument(mime)` —— 导出（备份 ZIP、APK…）。 */
  saveFile(file: { fileName: string; mime: string; bytes: Uint8Array }): Promise<void>;
}

/** `DocumentPort.pickFile` 返回的一条记录（对齐 SAF 的 uri + DISPLAY_NAME 查询）。 */
export interface PickedFile {
  /** Android `OpenableColumns.DISPLAY_NAME` 的查询结果。 */
  name: string;
  /** Android `content://` URI 的替代物：一条已经 read 出来的字节。 */
  bytes: Uint8Array;
  /** Android `contentResolver.getType(uri)`。 */
  mime: string;
}

export interface HttpHeader {
  [name: string]: string;
}

export interface HttpRequest {
  signal?: AbortSignal | undefined;
  redirect?: 'follow' | 'manual' | 'error';
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  headers?: HttpHeader;
  body?: string | Uint8Array;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: HttpHeader;
  body: Uint8Array;
  url: string;
}

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export type SqlValue = string | number | null | Uint8Array;

export interface SQLiteDatabase {
  open(options: { name: string }): Promise<void>;
  execute(sql: string, params?: SqlValue[]): Promise<{ rowsAffected: number; lastInsertRowId?: number }>;
  query<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  close(): Promise<void>;
  transaction?<T>(operation: (database: SqliteExecutor) => Promise<T>): Promise<T>;
}
export type SqliteExecutor = Pick<SQLiteDatabase, 'execute' | 'query'>;

/* ══════════════ 软键盘 / 屏幕方向 / 外部浏览器 / 设备信息 ══════════════ */

/**
 * Android `WindowInsets.ime` —— `library/LibraryScreen.kt:626-632`：
 * ```kotlin
 * // ── 键盘避让：用 imeAnimationTarget（动画的**目标值**）而不是 ime（逐帧插值）──
 * // ime 在输入法升起/收起的 ~250ms 里逐帧变化，于是下方内容每帧都要重新测量与布局
 * // —— 这正是「点搜索框弹键盘卡」的根因：卡的不是玻璃，是每帧重排。
 * // 目标值只在动画开始/结束各变一次，**最终布局与 imePadding 完全一致**（视觉零差异），
 * // 代价仅是不再跟随键盘做逐帧位移。
 * .windowInsetsPadding(WindowInsets.imeAnimationTarget)
 * ```
 *
 * ⚠️ 端口的形状就是照这句注释设计的：回调只在**动画开始/结束**各触发一次
 * （`willShow` / `willHide`），**不提供逐帧插值**，从类型层面杜绝调用方写逐帧重排。
 * 另有 `AndroidManifest.xml` 的 `android:windowSoftInputMode="adjustResize"`
 * （注释明确点名 `adjustPan` 的 OEM ROM 会盖住底部面板输入框）→
 * iOS 对应 `KeyboardResize.Body`。
 */
export interface KeyboardPort {
  /** 当前是否可见（等价 Kotlin `WindowInsets.isImeVisible`）。未订阅时按 0 高度推断。 */
  isVisible(): boolean;
  /**
   * 键盘高度（px/dp）。等价 Kotlin `WindowInsets.ime.getBottom(density)`，
   * 键盘不可见时为 `0`。**只在动画开始/结束变化**（见类注释）。
   */
  height(): number;
  /**
   * 订阅键盘显隐，返回退订函数。
   * 回调参数 = 变化**之后**的 `{ visible, height }`。
   * 对应 Kotlin 的 `Modifier.imePadding()` 随 `imeAnimationTarget` 变化而重组。
   */
  subscribe(onChange: (state: { visible: boolean; height: number }) => void): () => void;
  /**
   * Android `android:windowSoftInputMode="adjustResize"`。
   * iOS 侧 `KeyboardResize.Body` 是等价物；Web 侧抛错（浏览器不提供此控制）。
   */
  setResizeMode(mode: 'body' | 'native' | 'none'): Promise<void>;
}

/**
 * Android `Activity.requestedOrientation` —— `MainActivity.kt:398-405`：
 * ```kotlin
 * DisposableEffect(orientationLock) {
 *     requestedOrientation = when (orientationLock) {
 *         1 -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
 *         2 -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
 *         else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
 *     }
 *     onDispose {}
 * }
 * ```
 * 设置项来自 `MainViewModel.kt:411 updateScreenOrientationLock(mode)`，
 * 键 `screen_orientation_lock`（`SettingsPage` 的「方向锁定」三选一：
 * 0 跟随系统 / 1 锁定竖屏 / 2 锁定横屏）。
 *
 * ⚠️ iOS **没有**公开的「按值锁方向」API：`Info.plist` 的
 * `UISupportedInterfaceOrientations` 是**静态**声明，必须用
 * `UIWindowScene.requestGeometryUpdate(UIWindowScene.GeometryPreferences.iOS(…))`
 * （iOS 16+，CapApp-SPM 的 deployment target 正是 iOS 16）才能运行时改。
 * 因此原生实现走自写插件（`ios-native/orientationPlugin.swift`），
 * 而不是 `@capacitor/device`（它只提供 `getInfo`，没有方向控制）—— 见 `DevicePort`。
 */
export interface OrientationLockPort {
  /**
   * 设置方向锁。`0` = 跟随系统（= `SCREEN_ORIENTATION_UNSPECIFIED`），
   * `1` = 竖屏，`2` = 横屏。**逐条保留 Kotlin 的三个分支**。
   */
  setLock(mode: 0 | 1 | 2): Promise<void>;
}

/**
 * Android `Intent(Intent.ACTION_VIEW, Uri.parse(url))` + `startActivity` ——
 * `library/LibraryLoginDialog.kt:246`（「去注册」）、
 * `source/ZLibraryLoginDialog.kt:328`（「去注册」）、
 * `SettingsTabScreen.kt` 的 `LocalUriHandler.openUri`（GitHub 发布页 / 项目主页）。
 * iOS 对应 `@capacitor/browser`（`SFSafariViewController`）。
 *
 * ⚠️ **不要**继续用 `window.open(url, '_blank')`：WKWebView 里它被
 * `WKUIDelegate` 拦截后**既不报错也不导航**（用户点了没反应），
 * 是静默失败 —— 违反「不静默降级」铁律。web-mock 仍用 `window.open`
 * （浏览器语境下它是真能力），但会检查返回的 `Window | null`，
 * 被拦截时**显式抛错**由调用方 toast（Kotlin 的「无法打开注册页面」）。
 */
export interface ExternalBrowserPort {
  /** Android `startActivity(Intent(ACTION_VIEW, uri))`。 */
  open(url: string): Promise<void>;
  /** Android 无对应物（`CustomTabsIntent` 不由本App 发起）；仅用于关掉可能残留的浏览器页。 */
  close(): Promise<void>;
}

/**
 * Android `android.os.Build` —— 分散在 `AppUpdateDownload.kt:131/137/147/152`
 * （`SDK_INT >= 28` → `GET_SIGNING_CERTIFICATES` / `signingInfo`；`>= 26` → `canRequestPackageInstalls`）、
 * `AppUpdateInstaller.kt:20/24`（`>= 26` 未知来源安装开关）、
 * `Motion.kt:140/157`（`>= O` `VibrationEffect` / `>= S` `HapticFeedbackConstants`）、
 * `ui/components/LiquidGlass.kt:69`（`>= S` 实时模糊 / 液态玻璃）、
 * `ui/reader/NovelImageFullscreen.kt:182`（`>= Q`）。
 *
 * iOS 对应 `@capacitor/device` 的 `getInfo()`：`osVersion` / `platform` /
 * `model` / `manufacturer` / `isVirtual`，另有把 iOS 版本压成整数的
 * `iOSVersion`（`"16.3.1"` → `160301`），便于做 `>= 16` 这类门槛判断。
 *
 * ⚠️ 这里**不**把 Android 的 `SDK_INT` 语义原样搬过来：`SDK_INT` 是 API level，
 * 与 iOS 版本号不是同一条刻度，跨平台比较会得出错误结论。端口只暴露
 * 「本机的 OS 版本 + 平台 + 型号」，由调用方按**本平台**的刻度判断。
 */
export interface DevicePort {
  /**
   * 对应 Android `Build.VERSION.SDK_INT` 系列判断在**本平台**的等价物：
   * `osVersion` 是原始版本串（iOS `"16.3.1"`），
   * `osVersionCode` 是压平的整数（`"16.3.1"` → `160301`），
   * 两者都提供是因为 Kotlin 的门槛判断（如 `>= 26`）需要整数比较。
   */
  info(): Promise<{
    /** Android `Build.MODEL`。 */
    model: string;
    /** Android `Build.MANUFACTURER`。Web 恒为 `''`。 */
    manufacturer: string;
    /** Android `Build.VERSION.RELEASE`（如 `"14"`）的等价物。 */
    osVersion: string;
    /** 压平成整数，便于做门槛比较（见类注释）。Web 恒为 `0`。 */
    osVersionCode: number;
    /** `'ios' | 'android' | 'web'`。 */
    platform: string;
    /** Android `Build.FINGERPRINT` 语义的模拟器判定。 */
    isVirtual: boolean;
  }>;
}

export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface FileSystemApi {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Atomic replacement for small, irreplaceable user configuration files. */
  writeFileAtomic?(path: string, data: Uint8Array): Promise<void>;
  /** Append bytes without reading the existing file back into JavaScript memory. */
  appendFile?(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
}

export interface TtsVoice {
  identifier: string;
  name: string;
  language: string;
}

export interface TtsSpeakOptions {
  rate?: number;
  pitch?: number;
  lang?: string;
  voice?: string;
}

export interface TtsEngine {
  speak(text: string, options?: TtsSpeakOptions): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getVoices(): Promise<TtsVoice[]>;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 以下 5 个端口为 E61 新增。
 *
 * 背景（`docs/PARITY_EXCEPTIONS.md` E61）：`src/core/**` 此前直接使用
 * `window` / `document` / `localStorage` / `new Audio()` / `HTMLAudioElement`，
 * 违反「core 是纯 TypeScript、不依赖任何宿主」的硬约定 —— 后果是
 * ① 核心层单测**必须**依赖 jsdom 才跑得起来；② core 无法移植到
 * Node worker / 小程序壳等非浏览器宿主。
 *
 * 之所以能补：Kotlin 侧这些能力都有**明确的 Android API 落点**
 * （`MediaPlayer`、`AccessibilityManager`、`Configuration.screenWidthDp`、
 * `SharedPreferences`），落点写在各端口的 JSDoc 里。
 *
 * 注意 `new Set()` 之类的「无主集合」也必须提为模块级常量 ——
 * 见 `MediaQueryPort` 说明里关于引用语义的坑。
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 音频播放句柄（Android `android.media.MediaPlayer` / `SoundPool` 的抽象）。
 *
 * Android 落点：
 *   - 环境音：`ComicSceneEngine.kt:70` `MediaPlayer()` 循环播放 assets
 *   - 翻页音：`GlassKit.kt` / `ui/reader/**` 的音效池
 *
 * 刻意**不用** `HTMLAudioElement`：core 不能引用 DOM 类型。
 * 端口实现方（`capabilities.ts` 的 Web 版）自行持有 `HTMLAudioElement`，
 * core 只看到下面这几个纯 TS 成员。
 */
export interface MediaHandle {
  /** 是否已可播放（Web 侧对应 `readyState >= 2`）。 */
  isReady(): boolean;
  /** 开始/恢复到播放。失败以 rejection 表达（Android 的 `start()` 会抛）。 */
  play(): Promise<void>;
  /** 暂停。 */
  pause(): void;
  /** 循环播放开关。 */
  setLoop(loop: boolean): void;
  /** 音量，`0..1`。Android 侧两端都做 clamp。 */
  setVolume(volume: number): void;
  /** 播放头（秒）。翻页音每次重置为 0。 */
  setPosition(seconds: number): void;
  /** 释放底层资源。对应 Android `release()`。 */
  release(): void;
}

/** 资源是否已加载完成（翻页音靠它决定「预热是否结束」）。 */
export type MediaReadyListener = (ready: boolean) => void;

/**
 * 音频资源工厂（Android `MediaPlayer.create` / `SoundPool.load` 的抽象）。
 */
export interface MediaPlayerPort {
  /**
   * `url: null` 表示「该资源不存在」，此时返回 `null` 而**不抛错** ——
   * 对应 Kotlin `ComicSceneEngine.kt:45 assetOf(scene)` 返回 `null` 的分支。
   */
  create(url: string, options?: { loop?: boolean; volume?: number }): MediaHandle | null;
}

/**
 * 媒体查询（Android `AccessibilityManager` / Compose `LocalConfiguration` 的抽象）。
 *
 * Android 落点：`GlassKit.kt:300 flag("reduce_transparency")`、
 * `Motion.kt` 的 reduce-motion 判定。
 */
export interface MediaQueryPort {
  /**
   * 查询是否命中。`query` 用标准媒体查询语法（`'(prefers-reduced-motion: reduce)'`）。
   *
   * 宿主不支持时返回 `false`（不是抛错）—— 对应 Kotlin
   * `catch (e: Throwable) { 1f }` 那一支的错误兜底。
   */
  matches(query: string): boolean;
}

/**
 * 视口尺寸（Android `Configuration.screenWidthDp / screenHeightDp` 的抽象）。
 */
export interface ViewportPort {
  /** 宽度（CSS px ≈ dp）。 */
  width(): number;
  /** 高度（CSS px ≈ dp）。 */
  height(): number;
}

/**
 * 极简键值存储（Android `SharedPreferences` 的同步语义抽象）。
 *
 * 只给 core 提供**同步**读写 —— 现有调用方（`godRankingSettings.ts`）是
 * 同步的 Kotlin `DataStore` 替代实现，改成 async 会牵动 UI 同步更新逻辑。
 */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * 离屏 2D 位图（Android `Bitmap.createBitmap` + `Canvas` 的抽象）。
 *
 * 只暴露 `filmGrainDataUrl` 真正需要的能力：生成 `ImageData`、逐像素写入、
 * 导出成 data URL。刻意**不做**通用画布 API —— core 用不上，
 * 端口越小越不容易被 core 反向污染。
 */
export interface OffscreenBitmapPort {
  /**
   * 用 `rgba` 回调逐像素填充一张正方形位图，返回可直接放进 CSS 的 data URL。
   * 宿主无法提供（如 Node worker）时返回 `null`。
   */
  createDataUrl(size: number, fill: (set: (x: number, y: number, r: number, g: number, b: number, a: number) => void) => void): string | null;
}

