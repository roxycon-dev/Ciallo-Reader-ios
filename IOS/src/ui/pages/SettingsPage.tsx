import { PrivacyManageOverlay as ActualManageOverlay } from '@ui/components/privacy/PrivacyWindows';
import { PrivacyPinOverlay as ActualPinOverlay } from '@ui/components/privacy/PrivacyWindows';
import { getPrivacyService } from '@platform/privacyRuntime';
/**
 * Settings page — EXTEND pass over Android `ui/SettingsTabScreen.kt`
 * (1691 lines total / 1615 non-blank / 1528 code).
 *
 * The 1845-line `SettingsPage.tsx` that predates this pass already covered the bulk of
 * the card list. This pass closes the remaining gaps against the Kotlin, verbatim:
 * the restore-backup confirm dialog, the whole 检查更新 block inside the About card,
 * the 新建分类 dialog, the back `leading` button, `onAdultSourcesChange`,
 * `onOpenSourceManager`, `extraBottomPadding`, `focusGodSettings`, the shared
 * `cardTweaksState`, and the `CardTweakSlider` drag/bubble two-state animation.
 *
 * Every composable parameter of `SettingsTabScreen` (L89–133) and where it lands here:
 *   prefs                     → `SettingsRepository` (created by `createServices()`)
 *   backupManager             → `BackupService`
 *   categories                → `useAppStore(s => s.categories)`
 *   onAddCategory             → props.onAddCategory (optional; store insert by default)
 *   onBack                    → props.onBack → the `leading` button (L332–343)
 *   onOpenSourceManager       → props.onOpenSourceManager (the help sheet's 书源管理 row)
 *   extraBottomPadding        → props.extraBottomPadding (px on `.settings-list`)
 *   autoNightModeVal / onAutoNightModeChange   → local state + `auto_night_mode`
 *   blueLightFilterVal / onBlueLightFilterChange → local state + `blue_light_filter`
 *   blueLightAlphaVal / onBlueLightAlphaChange   → local state + `blue_light_alpha`
 *   colorPrimaryIndexVal / colorSecondaryIndexVal → `useAppStore` primary/secondary
 *   onColorThemeChange        → `setPrimaryIndex` / `setSecondaryIndex` + persist
 *   onAdultSourcesChange      → props.onAdultSourcesChange (L735)
 *   orientationLockVal / onOrientationLockChange → local state + `screen_orientation_lock`
 *   hapticsEnabledVal / onHapticsChange           → local state + `haptics_enabled`
 *   renderQualityVal / onRenderQualityChange      → local state + `render_quality`
 *   cardTweaksState            → props.sharedCardTweaks / props.onSharedCardTweaksChange
 *   godSettings / onOpenGodRanking → `<GodSettingsSection />` (already owned elsewhere)
 *   focusGodSettings           → props.focusGodSettings → the GodStyleSettingsJump beacon
 *   privacyModeEnabled + the five `suspend` privacy callbacks → local stand-ins
 *   incognitoBrowsingEnabled / favoritesProtected + setters → local state + persist
 *
 * FULL-LINE MAP (Kotlin line → this file):
 *   1–85    package + imports → the file header + the injected interfaces below.
 *   86      `@OptIn(ExperimentalMaterial3Api::class)` → SKIPPED (Compose opt-in marker).
 *   87–133  the composable signature → `SettingsPageProps` + `SettingsPage`.
 *   134–142 `LocalContext` / `rememberCoroutineScope` / `updateChecker` /
 *            `appUpdate.state.collectAsStateWithLifecycle()` / `backupBusy` / `restoreUri`
 *          → the injected `SettingsUpdateIo` + `backupBusy` + `restoreFile` state.
 *   143–159 the `CreateDocument("application/zip")` export launcher → the `导出备份`
 *            button calling `BackupService.exportBackup()`.
 *   160–162 the `OpenDocument()` import launcher → a hidden `<input type="file">` that
 *            sets `restoreFile` (which opens the confirm dialog).
 *   163–198 the restore `AlertDialog` → `<RestoreBackupDialog/>`.
 *   200–222 the 14 `remember { mutableStateOf }` fields → the same `useState` calls.
 *   224–234 the privacy-mode window state (7 flags + `changePinOld` + the optimistic
 *            `privacySwitchPending`) → same.
 *   236–244 `showCardPanel` + `updateCardTweaks()` (write prefs → read back the coerced
 *            truth into the shared state) → `updateCardTweaks()`.
 *   246–274 `posterLauncher` → the hidden poster `<input type="file">`.
 *   276–308 `bgLauncher` → the hidden background `<input type="file">`.
 *   310–317 the root `Box` + `LocalAppBackgroundActive` branch → `.settings-page`.
 *   319     `rememberLazyListState()` → the document scroll container.
 *   324–328 `LaunchedEffect(focusGodSettings)` + `godIndex = 14 + showAdultSourceCard`
 *          → props.focusGodSettings → `setGodStyleSettingsJumpPending(true)`.
 *   329–330 `scrollTiltSource()` + `rememberHeaderCollapsedSource(...)` → SKIPPED
 *            (see "SKIPPED LINES" below).
 *   331–343 `settingsLeading` → the `leading` prop of `TabScreenHeader`.
 *   344–356 `Scaffold` (containerColor = Transparent, the `AnimatedVisibility` glass host)
 *          → the `.settings-page` wrapper.
 *   357–366 `Box(TopCenter)` + `LazyColumn(widthIn(max = 720.dp), contentPadding
 *            start/top/end 16.dp, bottom 16.dp + extraBottomPadding, spacedBy(16.dp))`
 *          → `.settings-list` (max-width 720px is on `.settings-page`).
 *   369–450 开屏海报设置 card → unchanged.
 *   452–591 软件背景设置 card → unchanged.
 *   593–707 外观与主题 card → unchanged.
 *   709–743 高级内容 (the 6-tap easter egg) → unchanged + `onAdultSourcesChange(it)`.
 *   745–777 屏幕方向 card → unchanged.
 *   779–810 画面与性能 card → unchanged.
 *   812–848 触控反馈 card → unchanged.
 *   850–964 自定义卡片参数 card → unchanged; `CardTweakSlider` now animates (L1628–1691).
 *   966–994 翻页效果 card → unchanged.
 *   996–1005 `GodSettingsSection` item → `<GodSettingsSection />`.
 *   1007–1182 护眼与提醒 card → unchanged.
 *   1184–1254 隐私与安全 card → unchanged + the `AnimatedContent` two-state tail.
 *   1256–1283 存储管理 entry row → unchanged.
 *   1285–1299 数据备份 header + card → unchanged + the restore confirm dialog.
 *   1301–1339 帮助手册 entry row → unchanged; `onOpenSourceManager` is now a prop.
 *   1341–1435 the About card → RESTORED: 检查更新 / `updateMessage` / GitHub 发布页 /
 *            the `appUpdateState` button row / the 10.sp hint.
 *   1440–1443 `CacheManagementScreen(onBack)` → SKIPPED (separate module, already ported).
 *   1445–1451 `LibraryHelpBottomSheet` → SKIPPED (separate module); the stub keeps
 *            `onOpenSourceManager` wired.
 *   1453–1463 `CustomMinutesDialog` → unchanged.
 *   1465–1502 the 新建分类 `AlertDialog` → `<AddCategoryDialog/>`.
 *   1504–1601 the five privacy overlays → the existing local stand-ins, unchanged.
 *   1604–1620 `SettingsSectionHeader` → unchanged + the colour corrected to
 *            `adaptiveTitleColor().copy(alpha = 0.62f)` (see settings.css).
 *   1622–1691 `CardTweakSlider` → the drag/bubble two-state animation now implemented.
 *
 * SKIPPED LINES (every one, with the reason):
 *   L86    `@OptIn(ExperimentalMaterial3Api::class)` — Compose opt-in marker, no TS analogue.
 *   L138   `GithubUpdateChecker(context.applicationContext)` — OkHttp + JSONObject +
 *          `SystemProxyResolver`. Not implemented here: declared on `SettingsUpdateIo`.
 *          (The checker's verdict strings live in `data/GithubUpdateChecker.kt`, a file
 *          outside Module A, so they are not part of this line map.)
 *   L139–140 `AppUpdateManager.get(context)` + `appUpdate.state.collectAsStateWithLifecycle()`
 *          — APK download/verify/install via `PackageManager`. Declared on
 *          `SettingsUpdateIo` (`appUpdateState` / `onAppUpdateState` / `offer` /
 *          `showAppUpdateSheet`); the default impl reports "no update available".
 *   L143–159 the export launcher body — `java.io.File(cacheDir, "backup_${UUID}.zip")`,
 *          `contentResolver.openOutputStream(uri)`, `Dispatchers.IO`, the `64*1024`
 *          `copyTo` buffer, `finally { temp.delete(); backupBusy = false }`.
 *          Web adaptation: the browser's file system is reached through
 *          `platform.fs` inside `BackupService.exportBackup()`; there is no SAF
 *          destination URI and no cache temp file.
 *          2026-10-11（E79 接线）：`BackupService.exportBackup` 产出对齐
 *          `BackupManager.exportBackupJson`（BackupManager.kt L50-80）的 JSON 信封，
 *          暂存路径为 `backups/novel_reader_backup.json`（Kotlin L77 文件名）；恢复入口
 *          按内容分发 ZIP / 信封，入口行为（按钮、对话框、toast）不变。
 *   L160–162 `ActivityResultContracts.OpenDocument()` with
 *          `arrayOf("application/zip","application/octet-stream")` → a hidden
 *          `<input type="file" accept="application/zip,application/octet-stream">`.
 *   L167–195 the restore body — the manual `ByteArray(64*1024)` read loop,
 *          `require(total <= 4L*1024*1024*1024) { "备份文件过大" }`,
 *          `check(backupManager.restoreBackupArchive(temp)) { "备份恢复失败" }`.
 *          Web adaptation: `BackupService.importBackup()` does the streaming; the 4 GiB
 *          guard is re-implemented in TS over `File.size` and throws "备份文件过大",
 *          and a falsy result throws "备份恢复失败".
 *   L172    `context.contentResolver.openInputStream(uri) ?: error("无法打开备份")`
 *          — no `contentResolver` on the web. The `<input type="file">` either yields a
 *          `File` or yields nothing at all, so this branch cannot fail; the string is
 *          kept in the catch arms for parity.
 *   L184–190 `restoreUri = null` + `AppToast("恢复完成")` + the relaunch intent
 *          (`FLAG_ACTIVITY_NEW_TASK or FLAG_ACTIVITY_CLEAR_TASK`) → `restoreFile = null`,
 *          `showToast('恢复完成')`, `io.relaunchApp()`.
 *   L187–190 `context.packageManager.getLaunchIntentForPackage(...)` — Android-only.
 *   L246–274 `posterLauncher` body — copying the picked stream into
 *          `filesDir/custom_poster_${System.currentTimeMillis()}.jpg` and deleting the
 *          previous `custom_poster*` file (the fresh-name fix for Coil's stale-URI cache).
 *          Web adaptation: `URL.createObjectURL(file)`; object URLs are unique per File,
 *          so there is no cache to bust and no private directory to sweep.
 *   L276–308 `bgLauncher` body — identical reasoning for
 *          `filesDir/custom_app_bg_${System.currentTimeMillis()}.jpg`.
 *   L302    `AppBackgroundController.update(1, localUriStr, appBgDim)` — the Android
 *          global-wallpaper singleton (`ui/AppBackground.kt`, not owned). The web build
 *          drives the wallpaper from CSS variables in the shell; `prefs` still receives
 *          `app_background_mode` / `app_background_dim` / `custom_app_background_uri`.
 *   L304    the `catch (e: Exception) → "背景设置失败"` toast — unreachable on the web
 *          (`URL.createObjectURL` does not throw); the string is retained in the
 *          catch arm for parity with L271's "图片设置失败".
 *   L310–317 `Box(Modifier.fillMaxSize().background(if (LocalAppBackgroundActive.current)
 *            Color.Transparent else MaterialTheme.colorScheme.background))` — the app's
 *          wallpaper is a CSS layer in this port, so the settings page is transparent
 *          over its scroll container unconditionally and the luminance probe is dropped.
 *   L319    `rememberLazyListState()` — no lazy item recycling on the web; the list is
 *          one scroll container. The `godIndex` arithmetic that depended on item
 *          indices (L326) is therefore replaced by a DOM-id scroll
 *          (`GodSettingsSection` owns `id="god_settings"`).
 *   L329    `settingsListState.scrollTiltSource()` — the 3D page-tilt driver is an
 *          Android pointer/rotation effect; no analogue (CSS `perspective` lives in the
 *          shell, which this page does not own).
 *   L330    `rememberHeaderCollapsedSource(settingsListState)` — the 20.dp collapse
 *          threshold. Every ported page in this codebase passes `collapsed={false}` to
 *          `TabScreenHeader` and lets the shell own the scroll-to-collapse linkage;
 *          doing it here alone would desync the settings header from the other tabs.
 *   L344–355 `Scaffold(containerColor = Color.Transparent, topBar = …)` + the
 *          `AnimatedVisibility` glass host → the plain `.settings-page` wrapper.
 *   L367–368 two blank `LazyColumn` items (Compose quirk) → nothing.
 *   L401    `AppActionButton(text = "选择相册图片")` → `<AppButton size="sm">`.
 *   L421–426 `AsyncImage(model = splashPosterUri, contentScale = ContentScale.Crop)` →
 *          `<img src>` + CSS `object-fit: cover`; Coil's failure state → `onError`.
 *   L466–473 / L493–498 the same `AsyncImage` for the background preview → same.
 *   L471–475 `AppBackgroundController.update(mode, uri, dim)` → CSS variables (see L302).
 *   L502–503 `Color.Black.copy(alpha = appBgDim / 100f)` → the `.bg-preview__dim` overlay
 *          with `opacity: appBgDim / 100`.
 *   L518–519 `previewCardColor.onColor()` (WCAG contrast helper) → fixed light-theme
 *          values: `.bg-preview__card` is `rgba(255,255,255,0.92)`, so the title is
 *          `#1A1A1E` and the sub-label is that at 65% alpha.
 *   L605 / 618 / 639 / 657 / 673 / 691 / 717 / 762 / 791 / 830 / 863 / 1024 / 1075 /
 *   1098 / 1126 / 1197 / 1273 / 1321 / 1333 / 1424 — `Icon(Icons.Filled.*)` /
 *   `Icons.Default.ChevronRight` / `Icons.AutoMirrored.Filled.ArrowBack` → the inline
 *   Material SVG paths already present in this file (`IconPalette`, `IconLock`,
 *   `IconScreenRotation`, `IconAutoAwesome`, `IconVibration`, `IconTimer`,
 *   `IconNightlight`, `IconRemoveRedEye`, `IconWifi`, `IconShield`,
 *   `IconCleaningServices`, `IconHelpCenter`, `IconStar`, `IconChevronRight`,
 *   `IconCheck`, `IconArrowBack` — the last one is new, from L337).
 *   L617    the comment recording that a `colorNames` list used to exist at the primary
 *          swatch row → kept as a comment, nothing to port.
 *   L639    `val colorNames = listOf("蓝", "紫", "绿", "粉", "橙")` — declared inside the
 *          secondary swatch loop and never read (the swatches carry no label). Kept as
 *          the `SECONDARY_COLOR_NAMES` constant so the palette order is documented;
 *          it is intentionally not rendered.
 *   L678–683 the `Surface(RoundedCornerShape(8.dp), colorScheme.secondary)` chip →
 *          `.preview-secondary-chip`.
 *   L686–702 `AppLiquidButton` → `.liquid-button` (the 6-tap / 3000 ms easter egg window
 *          and the `>= 6 → showAdultSourceCard` reset are kept verbatim).
 *   L875–879 `AnimatedVisibility(visible = showCardPanel, expandVertically + fadeIn /
 *            shrinkVertically + fadeOut)` → `.card-tweak-panel--open` (max-height +
 *            opacity transitions).
 *   L884    `val tw = tweaksState?.value ?: prefs.readCardTweaks()` → the loaded
 *          `cardTweaks` state, seeded from `prefs` in the load effect.
 *   L893    `updateCardTweaks { CardTweaks() }` → `updateCardTweaks(() => DEFAULT_CARD_TWEAKS)`.
 *   L900–957 the eight `CardTweakSlider(...)` calls with their label / `valueText` /
 *           `position` / `startText` / `endText` / inverse-mapping lambdas → unchanged,
 *           including `sqrt(tiltMaxDeg / 15f)`, `v * v * 15f`, `(12f - cameraDistMult) / 9f`,
 *           `"%.1f°"`, `"×%.1f"`.
 *   L928–929 the comment about the removed ripple slider → kept as a comment.
 *   L980–991 `PageTurnType.entries.forEach { PageTurnSelectorRow(…) }` → the
 *          `PAGE_TURN_TYPES.map(...)` projection derived from the single source
 *          `PageTurnType` in `PageTurnContainer.tsx` (local copy removed).
 *   L998–1005 `if (godSettings != null) item(key = "god_settings") { GodSettingsSection(…) }`
 *          → `<GodSettingsSection />`, already imported and rendered unconditionally
 *          (the store is always present in this build).
 *   L1116   `var preloadWifiOnly by remember { mutableStateOf(prefs.preloadWifiOnly) }`
 *           declared INSIDE the `item {}` lambda → hoisted to the page body. Same
 *           behaviour (an `item` lambda's `remember` is keyed to that slot), but a
 *           `useState` inside `.map()`/JSX children is a React hook-order hazard.
 *   L1117–1144 the 仅 Wi-Fi 预加载漫画 row → unchanged.
 *   L1146–1179 the 护眼强度 block (`if (blueLightFilter)`) → unchanged.
 *   L1155   `"${(blueLightAlpha * 100).toInt()}%"` → `Math.round(blueLightAlpha * 100)}%`.
 *   L1213–1222 `AnimatedContent(targetState = privacyModeEnabled, fadeIn(tween(220)) +
 *            scaleIn(0.96f, tween(220)) togetherWith fadeOut(tween(160)))` →
 *            `.settings-privacy-tail` with the same 220 / 160 ms durations and the
 *            `scale(0.96)` entrance.
 *   L1245–1248 `Modifier.clip(RoundedCornerShape(14.dp)).clickableWithFeedback { … }
 *            .padding(horizontal = 12.dp, vertical = 6.dp)` → `.settings-link-btn`.
 *   L1285   `item(key = "user_backup")` wrapping BOTH a `SettingsSectionHeader` and a
 *           `GlassCard` (one LazyColumn item, two composables) → the two siblings are
 *           rendered separately, since the web list is not a keyed item list.
 *   L1291   `text = if (backupBusy) "正在处理…" else "导出备份"` → unchanged.
 *   L1358–1362 `context.packageManager.getPackageInfo(context.packageName, 0)
 *            ?.versionName ?: BuildConfig.VERSION_NAME` with a `catch` fallback →
 *            `platform.appInfo.versionName()` (AppInfoPort). The web has no PackageManager
 *            and no `BuildConfig`; the port throws explicitly until wired.
 *   L1369–1384 the 检查更新 `AppActionButton` (`"检查中…"`, `enabled = !updateChecking`)
 *            + `updateChecker.check(versionName)` + `result.release?.let { appUpdate.offer(it) }`
 *            + `finally { updateChecking = false }` → RESTORED, calling
 *            `updateIo.check(appVersion)` then `updateIo.offer(...)`.
 *   L1389   `val updateUriHandler = LocalUriHandler.current` → `updateIo.openUri`.
 *   L1392–1393 `runCatching { updateUriHandler.openUri(UPDATE_REPOSITORY +
 *            "/releases/latest") }.onFailure { toast("无法打开发布页，请检查浏览器。") }`
 *           → try/catch around `updateIo.openUri(`${UPDATE_REPOSITORY}/releases/latest`)`.
 *   L1398   `appUpdate::show` → `updateIo.showAppUpdateSheet()`.
 *   L1402–1403 `Text("检查正式版本，确认后下载并打开系统安装页面。")` → RESTORED.
 *   L1411   `val githubUriHandler = LocalUriHandler.current` (a second, independent read)
 *           → the same `updateIo.openUri`.
 *   L1417–1419 the star row's `clickable { runCatching { githubUriHandler.openUri(
 *            "https://github.com/roxycon-dev/Ciallo-Reader/releases") }.onFailure { … } }`
 *           → `<button>` + `updateIo.openUri(GITHUB_RELEASES_URL).catch(…)`（走
 *           `externalBrowser` 端口：iOS = `SFSafariViewController`），保留 the
 *           `/releases` suffix that the previous port was missing。
 *   L1440–1443 `if (showCacheManager) { CacheManagementScreen(onBack = …); return }`
 *           → SKIPPED. `CacheManagementScreen.kt` is explicitly out of this module's
 *           scope and `CacheManagementPage.tsx` already exists (owned by another
 *           module). The entry row and its toast stay; the screen is not mounted here.
 *   L1445–1451 `LibraryHelpBottomSheet(onDismissRequest, onOpenSourceManager)` →
 *           SKIPPED for the same reason (`ui/help/LibraryHelpBottomSheet.kt` is not an
 *           owned file). The stub dialog below keeps the 书源管理 action and now routes
 *           it through `props.onOpenSourceManager` when provided.
 *   L1465–1502 the 新建分类 `AlertDialog` → `<AddCategoryDialog/>`. ⚠️ Android has NO
 *           trigger for `showAddCategoryDialog` either (the flag is only ever set to
 *           `false`), so the ported dialog is likewise unreachable; it is kept verbatim
 *           rather than silently dropped. `newCategoryText` follows.
 *   L1470–1476 `OutlinedTextField(label = { Text("名称") }, singleLine = true)` →
 *           `<input class="settings-dialog__field">` with `aria-label="名称"`.
 *   L1479–1493 the `DialogLiquidGlass(fillMaxSize = false) { AppActionButton(…) }`
 *           inside M3's `confirmButton` slot → the `.settings-dialog` glass shell's
 *           action row (the same shell `CustomMinutesDialog` already uses).
 *   L1506–1526 / 1528–1545 / 1547–1563 / 1585–1601
 *           `com.example.ui.privacy.PrivacyPinOverlay(SETUP | VERIFY | CHANGE_OLD)` →
 *           the existing local `<PrivacyPinOverlay/>` stand-in (`mode="setup" | "verify"`).
 *   L1566–1583 `com.example.ui.privacy.PrivacyManageOverlay(...)` → the existing local
 *           `<PrivacyManageOverlay/>` stand-in. (`ui/privacy/*` is not an owned file.)
 *   L1548–1562 `CHANGE_OLD` + `changePinOld` → the stand-in's two-step
 *           verify → setup sequence; `changePinOld` itself is dropped (documented in the
 *           overlay) because the stand-in does not expose the captured old PIN.
 *   L1609–1620 `SettingsSectionHeader` → unchanged; the colour is corrected in
 *           settings.css from the green the previous pass used to
 *           `rgba(26, 26, 30, 0.62)` (`adaptiveTitleColor()` on a light background).
 *   L1636–1641 `var dragging by remember { mutableStateOf(false) }` +
 *           `animateFloatAsState(if (dragging) 0f else 1f, tween(140))` →
 *           `useState` + a CSS `opacity` transition on `.card-tweak-slider__label-row`
 *           (`transition: opacity 140ms`), driven by the range input's pointer events.
 *   L1656    `.offset(y = (-30).dp)` — the label row is overlaid 30px above the track so
 *           it shares the slider's 1.5×barH bubble airspace. Reproduced with a negative
 *           margin in CSS so the two states never overlap, exactly as in Kotlin.
 *   L1687–1688 `barHeightDp = 28, onDraggingChange = { dragging = it }` → the
 *           `dragging` prop threaded into `SettingsSlider`.
 *   L1618    `adaptiveTitleColor()` needs `LocalBackgroundTone`, which is derived from
 *           the decoded wallpaper bitmap (`ui/AppBackground.kt`) — Android-only. The
 *           LIGHT-theme value `Color(0xFF1A1A1E)` is hard-coded, per the light-theme
 *           constraint for this port.
 *
 * DEFAULT THEME IS LIGHT: white background, body text #18191C, primary green #059669,
 * MediumGray #61666D, DividerGray #E3E5E7.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GlassCard } from '@ui/components/GlassCard';
import { TabScreenHeader } from '@ui/components/TabScreenHeader';
import { AppButton } from '@ui/components/AppButton';
import { showToast } from '@ui/toast';
import { useAppStore } from '@ui/state/appStore';
import { openExternalUrl } from '@ui/lib/openExternalUrl';
import { getPlatform } from '@platform/index';
import { BackupService } from '@core/backup/backupService';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { GodMomentRepository } from '@core/god/godMomentRepository';
import { setGodStyleSettingsJumpPending } from '@core/god/godRankingSettings';
import {
  BASE_PRIMARY_COLORS,
  BASE_SECONDARY_COLORS,
  resolveAccent,
  themeColorTransitionCss,
} from '@core/ui-theme';
import { PageTurnType } from '@ui/components/pageturn/PageTurnContainer';
import { GodSettingsSection } from '@ui/components/god/GodSettingsSection';
import { LibraryHelpBottomSheet } from '@ui/components/help/LibraryHelpBottomSheet';
import { UPDATE_REPOSITORY } from '@ui/components/source/sourceCapabilities';
import '../../styles/settings.css';

/* ── Theme.kt L16–30 `BasePrimaryColors` / `BaseSecondaryColors` ──
 * ⚠️ 本文件原先自己抄了一份 5×5 色值（L301–302）。真源是
 * `@core/ui-theme/theme.ts` 的 `BASE_PRIMARY_COLORS` / `BASE_SECONDARY_COLORS`
 * （即 Kotlin `Theme.kt` L16–30 的逐行移植），本轮改为 import，
 * 避免「两处色值各自漂移」。`resolveAccent` 同时给出 Kotlin
 * `BaseColors.getOrElse(index) { BaseColors[2] }`（L43/L44）的越界回落。 */

/**
 * Kotlin L639: `val colorNames = listOf("蓝", "紫", "绿", "粉", "橙")` — declared inside
 * the secondary swatch loop and never read (the swatches carry no label in Kotlin
 * either). Kept so the palette order is documented; intentionally not rendered.
 */
export const SECONDARY_COLOR_NAMES = ['蓝', '紫', '绿', '粉', '橙'] as const;

/** Kotlin L1424–L1428: the GitHub release list opened by the About card's star pill. */
const GITHUB_RELEASES_URL = 'https://github.com/roxycon-dev/Ciallo-Reader/releases';
/** Kotlin L1392: `UPDATE_REPOSITORY + "/releases/latest"`. */
const GITHUB_LATEST_URL = `${UPDATE_REPOSITORY}/releases/latest`;
/** Kotlin L179: `require(total <= 4L * 1024 * 1024 * 1024) { "备份文件过大" }`. */
const MAX_BACKUP_BYTES = 4 * 1024 * 1024 * 1024;

/* ═══════════════════════════════════════════════════════════════════════════
 * Injected update-check surface (Android `GithubUpdateChecker` + `AppUpdateManager`).
 * Declared, not implemented — see SKIPPED LINES L138–140 in the file header.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin `UpdateRelease`. */
export interface UpdateRelease {
  /** Kotlin `UpdateRelease.version` — the tag with its `v` / `V` prefix removed. */
  readonly version: string;
  readonly tag: string;
  readonly releaseUrl: string;
  readonly notes: string;
}

/** Kotlin `UpdateCheckResult`. */
export interface UpdateCheckResult {
  /** Kotlin `UpdateCheckResult.message` — shown verbatim under the 检查更新 button. */
  readonly message: string;
  readonly releaseUrl?: string | null;
  readonly release?: UpdateRelease | null;
}

/**
 * Kotlin `AppUpdateState`, reduced to the three fields the About card actually reads:
 * `appUpdateState.release != null` (L1397), `.transferring` (L1399) and `.hasPackage`
 * (L1399). The remaining fields (`stage`, `visible`, `downloaded`, `total`, `message`,
 * `autoInstall`) belong to the download sheet, which is not part of Module A.
 */
export interface AppUpdateState {
  readonly release: UpdateRelease | null;
  /** Kotlin `AppUpdateState.transferring` — DOWNLOADING or VERIFYING. */
  readonly transferring: boolean;
  /** Kotlin `AppUpdateState.hasPackage` — READY / NEED_PERMISSION / INSTALLING. */
  readonly hasPackage: boolean;
}

/** Android `GithubUpdateChecker` + `AppUpdateManager` — the About card's whole I/O surface. */
export interface SettingsUpdateIo {
  /** Kotlin `updateChecker.check(versionName)` (L1378). */
  check(currentVersion: string): Promise<UpdateCheckResult>;
  /** Kotlin `appUpdate.offer(release)` (L1380). */
  offer(release: UpdateRelease): Promise<void>;
  /** Kotlin `appUpdate.state.collectAsStateWithLifecycle()` (L140). */
  appUpdateState(): Promise<AppUpdateState>;
  /** Kotlin `collectAsStateWithLifecycle` → a subscribe/unsubscribe pair. */
  onAppUpdateState(listener: (state: AppUpdateState) => void): () => void;
  /** Kotlin `appUpdate::show` (L1398). */
  showAppUpdateSheet(): void;
  /**
   * Kotlin `LocalUriHandler.openUri(uri)` (L1392, L1418)。
   *
   * ⚠️ 返回 Promise 而非 void：Android 的 `runCatching { openUri }` 是**同步**
   * try/catch，但本项目的失败只能以 rejection 表达（iOS 侧
   * `SFSafariViewController` 要等 present 结束）。返回 Promise 才能让调用点的
   * `.catch()` 真的抓到失败 —— 留 `try/catch` 会永远走不到。
   */
  openUri(uri: string): Promise<void>;
  /** Kotlin L187–190: relaunch the app through a cleared task. */
  relaunchApp(): void;
}

/**
 * The default no-op used when `App.tsx` mounts `<SettingsPage />` without a wired
 * provider. `check` reports the same verdict the Kotlin checker emits when GitHub is
 * unreachable, so the button, the `updateMessage` slot and the GitHub 发布页 link all
 * still exercise their real code paths. ⚠️ Android always has a live checker here.
 */
export const NULL_SETTINGS_UPDATE_IO: SettingsUpdateIo = {
  check: async () => ({
    message: '检查更新失败：无法读取 GitHub 更新信息。可稍后重试或打开 GitHub 发布页。',
    releaseUrl: null,
    release: null,
  }),
  offer: async () => {},
  appUpdateState: async () => ({ release: null, transferring: false, hasPackage: false }),
  onAppUpdateState: () => () => {},
  showAppUpdateSheet: () => {},
  /**
   * Kotlin L1392 `runCatching { updateUriHandler.openUri(url) }.onFailure { toast(...) }`
   * —— Compose 的 `LocalUriHandler` 最终落到 `Intent(ACTION_VIEW, uri)` + `startActivity`。
   *
   * ⚠️ 原来这里是裸 `window.open(uri,'_blank')` 且**不检查返回值**：WKWebView
   * 拦截 `_blank` 后既不报错也不打开（用户点了完全没反应），而同步 `try/catch`
   * 又永远抓不到 —— 双重静默失败。现走 `externalBrowser` 端口
   * （iOS = `SFSafariViewController`），失败以 rejection 表达，由调用点 `.catch`。
   */
  openUri: (uri) => openExternalUrl(uri),
  relaunchApp: () => {
    if (typeof window !== 'undefined') window.location.reload();
  },
};

/** Kotlin L90 `onAddCategory` — the store insert used when the prop is absent. */
function nextCategoryId(categories: ReadonlyArray<{ id: number }>): number {
  let max = 0;
  for (const category of categories) {
    if (category.id > max) max = category.id;
  }
  return max + 1;
}

/** Kotlin L89–133: `SettingsTabScreen`'s parameter list, as an optional React props object. */
export interface SettingsPageProps {
  /** Kotlin L94 `onBack` — renders the back `leading` button (L332–343). */
  onBack?: () => void;
  /** Kotlin L95 `onOpenSourceManager` — the help sheet's 书源管理 action (L1448). */
  onOpenSourceManager?: () => void;
  /** Kotlin L96 `extraBottomPadding` — extra px under the last item (L364). */
  extraBottomPadding?: number;
  /** Kotlin L90 `onAddCategory` — the 新建分类 dialog's confirm action (L1484). */
  onAddCategory?: (name: string) => void;
  /** Kotlin L106 `onAdultSourcesChange` — invoked with the 成人源 switch value (L735). */
  onAdultSourcesChange?: (enabled: boolean) => void;
  /** Kotlin L119 `focusGodSettings` — scroll to the 神回 section on open (L324–328). */
  focusGodSettings?: boolean;
  /** Kotlin L114 `cardTweaksState` — the MainActivity-owned shared tweak state (L238–244). */
  sharedCardTweaks?: CardTweaks;
  /** Kotlin L243 `tweaksState?.value = prefs.readCardTweaks()` — the write-back. */
  onSharedCardTweaksChange?: (tweaks: CardTweaks) => void;
  /** The `GithubUpdateChecker` / `AppUpdateManager` surface (L138–140). */
  updateIo?: SettingsUpdateIo;
}

/* ── PageTurnContainer.kt PageTurnType ──
 * Single source: `src/ui/components/pageturn/PageTurnContainer.tsx` 的
 * `PageTurnType`（逐字段等价于本节原先的本地副本：id 0–4、标题、描述、顺序一致）。
 * 此处只做投影，不再各自抄一份。 */
const PAGE_TURN_TYPES: ReadonlyArray<{ id: number; title: string; description: string }> = (
  Object.keys(PageTurnType) as Array<keyof typeof PageTurnType>
).map((name) => PageTurnType[name]);

/* ── CardTweaks.kt defaults ── */
interface CardTweaks {
  blurRadiusDp: number;
  cornerRadiusDp: number;
  tiltMaxDeg: number;
  cameraDistMult: number;
  tintMix: number;
  pressStrength: number;
  pressRadius: number;
  cardAlpha: number;
}

const DEFAULT_CARD_TWEAKS: CardTweaks = {
  blurRadiusDp: 22,
  cornerRadiusDp: 16,
  tiltMaxDeg: 6,
  cameraDistMult: 5,
  tintMix: 0.08,
  pressStrength: 1.25,
  pressRadius: 1.1,
  cardAlpha: 1,
};

// 2026-10-11（E79 接线）：导出产物改为 Kotlin `BackupManager.exportBackupJson` 的 JSON
// 兼容信封，落盘文件名对齐 Kotlin L77 `File(context.filesDir, "novel_reader_backup.json")`。
const BACKUP_PATH = 'backups/novel_reader_backup.json';
const PRESET_REST_MINUTES = [0, 15, 30, 45, 60];

interface AppServices {
  settings: SettingsRepository;
  backup: BackupService;
}

function createServices(): AppServices {
  const platform = getPlatform();
  const settings = new SettingsRepository(platform.db);
  // 2026-10-11（E79 接线）：对齐 Kotlin MainViewModel 的装配
  // `BackupManager(application, prefs, godRepository)`（BackupManager.kt L16-20 +
  // MainViewModel.kt L25）—— 神回仓库注入 BackupService，信封导出才带 14 字段 godMoments、
  // 轻量恢复才导入神回。
  const backup = new BackupService(
    platform.db,
    platform.fs,
    settings,
    '',
    new GodMomentRepository(platform.db),
  );
  return { settings, backup };
}

/* ── Material icon SVGs ── */
function IconPalette() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3C6.48 3 2 6.92 2 11.74c0 2.7 1.42 5.1 3.63 6.62.2.14.37.34.48.57l.73 1.6c.2.45.79.62 1.23.37 2.05-1.15 3.4-1.55 4.93-1.55.28 0 .55.02.82.06C16.4 18.9 19 16.4 19 12.9 19 7.4 15.52 3 12 3zm-5.5 10.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm3-4a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm4 1a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm2.5 4a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
    </svg>
  );
}


function IconScreenRotation() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7.47 21.49C4.2 19.93 1.86 16.76 1.5 13H0c.51 6.16 5.66 11 11.95 11 .23 0 .44-.02.66-.03L8.8 20.15l-1.33 1.34zM12.05 0c-.23 0-.44.02-.66.04l3.81 3.81 1.33-1.33C19.8 4.07 22.14 7.24 22.5 11H24c-.51-6.16-5.66-11-11.95-11zM16 14h2V8c0-1.11-.9-2-2-2h-6v2h6v6zm-8-2V6H6v2H4v2h2v2h2v-2h2v-2z" />
    </svg>
  );
}

function IconAutoAwesome() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z" />
    </svg>
  );
}

function IconVibration() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M0 15h2V9H0v6zm3 2h2V7H3v10zm19-8v6h2V9h-2zm-3 8h2V7h-2v10zM16.5 3h-9C6.67 3 6 3.67 6 4.5v15c0 .83.67 1.5 1.5 1.5h9c.83 0 1.5-.67 1.5-1.5v-15c0-.83-.67-1.5-1.5-1.5zM16 19H8V5h8v14z" />
    </svg>
  );
}

function IconTimer() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
    </svg>
  );
}

function IconNightlight() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.34 2.02C6.59 1.82 2 6.42 2 12c0 5.52 4.48 10 10 10 3.71 0 6.93-2.02 8.66-5.02-7.51-.25-12.09-8.43-8.32-14.96z" />
    </svg>
  );
}

function IconRemoveRedEye() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </svg>
  );
}

function IconWifi() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
    </svg>
  );
}

function IconCleaningServices() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.36 2.72l1.42 1.42-2.2 2.2a8.02 8.02 0 01-1.76 8.36c1.23 1.92.78 4.49-1.06 5.9-1.5 1.17-3.49 1.2-5.02.12l5.1-5.1c.26-.26.4-.61.4-.99s-.14-.73-.4-.99l-2.72-2.72c-.55-.55-1.45-.55-2 0l-2.72 2.72c-.55.55-.55 1.45 0 2l2.72 2.72c.26.26.61.4.99.4s.73-.14.99-.4l5.1-5.1c-1.08-1.53-1.05-3.52.12-5.02 1.36-1.36 3.35-2.01 5.14-1.76l2.2-2.2zM5 20h14v2H5v-2z" />
    </svg>
  );
}

function IconHelpCenter() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27z" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/* ── Icons.AutoMirrored.Filled.ArrowBack — Kotlin L337 (contentDescription "返回") ── */
function IconArrowBack() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    </svg>
  );
}

/* ── SettingsSectionHeader (SettingsTabScreen.kt:1563–1575) ── */
function SettingsSectionHeader({ text }: { text: string }) {
  return <h2 className="settings-section-header">{text}</h2>;
}

/* ── AppSwitch — AppSwitch.kt: 60×32 / circle 24 / pad 4 / MintPrimary ── */
function AppSwitch(props: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={props.checked ? 'app-switch app-switch--on' : 'app-switch'}
      onClick={() => props.onCheckedChange(!props.checked)}
      role="switch"
      aria-checked={props.checked}
      aria-label={props.ariaLabel ?? 'switch'}
    >
      <span className="app-switch__thumb" />
    </button>
  );
}

/* ── ColorMorphSwatch — ColorMorph.kt:122–191 ── */
function ColorMorphSwatch(props: {
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={props.selected ? 'color-swatch color-swatch--selected' : 'color-swatch'}
      style={{ background: props.color }}
      onClick={props.onClick}
      aria-pressed={props.selected}
    >
      <span className="color-swatch__check">
        <IconCheck />
      </span>
    </button>
  );
}

/* ── SegmentedPillSelector — SettingsControls.kt:80–212 ── */
function SettingsSegmented(props: {
  options: ReadonlyArray<{ value: number; label: string }>;
  selected: number;
  onSelect: (value: number) => void;
}) {
  const count = props.options.length;
  const index = Math.max(
    0,
    props.options.findIndex((opt) => opt.value === props.selected),
  );
  return (
    <div className="settings-segmented">
      {count > 0 ? (
        <div
          className="settings-segmented__indicator"
          style={{
            width: `calc(100% / ${count})`,
            transform: `translateX(${index * 100}%)`,
          }}
        />
      ) : null}
      {props.options.map((opt) => {
        const active = opt.value === props.selected;
        return (
          <button
            key={opt.value}
            type="button"
            className={
              active
                ? 'settings-segmented__option settings-segmented__option--active'
                : 'settings-segmented__option'
            }
            onClick={() => props.onSelect(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── SettingsSlider — FluidSlider stand-in ──
 * Kotlin `FluidSlider.onDraw` (L375–395) always paints the bar, both end texts and the
 * bubble oval; `showLabel` / `hideLabel` (L570–597) only animate the bubble's vertical
 * offset with a 400 ms `OvershootInterpolator`. `dragging` drives that offset here so
 * `CardTweakSlider` can hand the airspace to its label row (see L1636–1656). */
function SettingsSlider(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  startText: string;
  endText: string;
  bubbleText: string;
  /** Kotlin `FluidSlider.onDraggingChange` (L1688). */
  dragging?: boolean;
  /** Kotlin `hideLabel()` at rest — keeps the bubble behind the bar's top edge. */
  bubbleSunk?: boolean;
  /** Kotlin `beginTrackingListener` → `showLabel()` (L411–412). */
  onDragStart?: () => void;
  /** Kotlin `endTrackingListener` → `hideLabel()` (L430–431). */
  onDragEnd?: () => void;
}) {
  const range = props.max - props.min || 1;
  const pct = Math.max(0, Math.min(1, (props.value - props.min) / range));
  return (
    <div
      className={
        props.bubbleSunk === true
          ? 'settings-slider settings-slider--sunk'
          : 'settings-slider'
      }
      data-dragging={props.dragging === true ? 'true' : 'false'}
    >
      <div className="settings-slider__bubble" style={{ left: `${8 + pct * 84}%` }}>
        {props.bubbleText}
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
        onPointerDown={props.onDragStart}
        onPointerUp={props.onDragEnd}
        onPointerCancel={props.onDragEnd}
        onBlur={props.onDragEnd}
      />
      <div className="settings-slider__ends">
        <span>{props.startText}</span>
        <span>{props.endText}</span>
      </div>
    </div>
  );
}

/* ── CardTweakSlider — SettingsTabScreen.kt:1622–1691 ──
 * Kotlin KDoc: "标签行与滑条容器零间距、共用同一左右内边距" and "静止时标签可见；拖动开始
 * 整行淡出、让数值气泡独占该区域（不遮任何文字），松手后淡回 —— 两态互斥永不叠印".
 * `dragging` (L1636) + `animateFloatAsState(tween(140))` (L1646–1650) become a
 * `data-dragging` attribute; the 140 ms fade is the CSS transition on the label row and
 * the bubble's sink/rise is `settings-slider--sunk`. */
function CardTweakSlider(props: {
  label: string;
  valueText: string;
  position: number;
  startText: string;
  endText: string;
  onChange: (position: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="card-tweak-slider" data-dragging={dragging ? 'true' : 'false'}>
      <div className="card-tweak-slider__label-row">
        <span className="card-tweak-slider__label">{props.label}</span>
        <span className="card-tweak-slider__value">{props.valueText}</span>
      </div>
      <SettingsSlider
        value={Math.max(0, Math.min(1, props.position))}
        min={0}
        max={1}
        step={0.01}
        onChange={props.onChange}
        startText={props.startText}
        endText={props.endText}
        bubbleText={props.valueText}
        bubbleSunk
        dragging={dragging}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}
      />
    </div>
  );
}

/* ── PageTurnPreview — SettingsControls.kt:605–742 (static visual stand-in) ── */
function PageTurnPreview({ type, selected }: { type: number; selected: boolean }) {
  const lines = [0, 1, 2, 3];
  return (
    <div className="page-turn-android-row__preview" aria-hidden="true">
      {lines.map((i) => (
        <span
          key={i}
          className="page-turn-android-row__preview-line"
          style={{
            top: `${8 + i * 10}px`,
            width: i === 3 ? '55%' : '70%',
            opacity: type === 3 ? (selected ? 1 : 0.55) : 1,
          }}
        />
      ))}
    </div>
  );
}

/* ── PageTurnSelectorRow — SettingsControls.kt:214–320 ── */
function AndroidPageTurnRow(props: {
  title: string;
  description: string;
  type: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={
        props.selected
          ? 'page-turn-android-row page-turn-android-row--selected'
          : 'page-turn-android-row'
      }
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <PageTurnPreview type={props.type} selected={props.selected} />
      <span className="page-turn-android-row__text">
        <span className="page-turn-android-row__title">{props.title}</span>
        <span className="page-turn-android-row__desc">{props.description}</span>
      </span>
      <span className="page-turn-android-row__check" aria-hidden="true">
        {props.selected ? <IconCheck /> : null}
      </span>
    </button>
  );
}

/* ── CustomMinutesDialog — SettingsControls.kt:322–421 + AcrylicDialog.kt ── */
function CustomMinutesDialog(props: {
  current: number;
  onConfirm: (minutes: number) => void;
  onDismiss: () => void;
}) {
  const initial = Math.max(1, Math.min(180, props.current));
  const [value, setValue] = useState(initial);
  const [text, setText] = useState(String(initial));

  return (
    <div className="settings-dialog-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="自定义休息时间"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="settings-dialog__title">自定义休息时间</h3>
        <div className="settings-dialog__body">
          <input
            className="minutes-input"
            inputMode="numeric"
            value={text}
            placeholder="输入分钟数"
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, '').slice(0, 3);
              setText(digits);
              const parsed = Number(digits);
              if (digits !== '' && Number.isFinite(parsed) && parsed >= 1 && parsed <= 180) {
                setValue(parsed);
              }
            }}
            aria-label="输入分钟数"
          />
          <div className="settings-spacer-14" />
          <div className="minutes-stepper">
            <button
              type="button"
              className="stepper-icon-btn"
              onClick={() => setValue((v) => Math.max(1, v - 1))}
              aria-label="减少"
            >
              −
            </button>
            <div className="minutes-value">{value} 分钟</div>
            <button
              type="button"
              className="stepper-icon-btn"
              onClick={() => setValue((v) => Math.min(180, v + 1))}
              aria-label="增加"
            >
              +
            </button>
          </div>
        </div>
        <div className="settings-dialog__actions">
          <button type="button" className="settings-link-btn" onClick={props.onDismiss}>
            取消
          </button>
          <AppButton
            size="sm"
            variant="primary"
            onClick={() => {
              const parsed = Number(text);
              const finalValue =
                text !== '' && Number.isFinite(parsed)
                  ? Math.max(1, Math.min(180, Math.round(parsed)))
                  : Math.max(1, Math.min(180, value));
              props.onConfirm(finalValue);
            }}
          >
            确定
          </AppButton>
        </div>
      </div>
    </div>
  );
}

/* ── Privacy manage overlay stand-in (PrivacyManageOverlay visuals) ── */
function PrivacyManageOverlay(props: {
  categories: ReadonlyArray<{ id: number; name: string; isProtected: boolean }>;
  incognitoEnabled: boolean;
  favoritesProtected: boolean;
  onToggleIncognito: (enabled: boolean) => void;
  onToggleFavoritesProtected: (enabled: boolean) => void;
  onToggleCategoryProtected: (id: number, protectedFlag: boolean) => void;
  onChangePin: () => void;
  onDisablePrivacy: () => void;
  onDismiss: () => void;
}) {
  return <ActualManageOverlay categories={props.categories} privacyModeEnabled pinVerified
    onToggleProtected={(category, flag) => props.onToggleCategoryProtected(category.id, flag)}
    incognitoBrowsingEnabled={props.incognitoEnabled} onToggleIncognito={props.onToggleIncognito}
    favoritesProtected={props.favoritesProtected} onToggleFavoritesProtected={props.onToggleFavoritesProtected}
    onChangePin={props.onChangePin} onDisablePrivacy={props.onDisablePrivacy} onDismiss={props.onDismiss} />;
}

/* ── Restore-backup confirm — Kotlin SettingsTabScreen.kt:163–198 ──
 * Kotlin chains `importBackupLauncher` → `restoreUri` → this `AlertDialog`; on the web
 * the hidden file input hands us a `File` directly, so `restoreUri` is the picked file
 * and the dialog's confirm button runs the restore. Every string is verbatim. */
function RestoreBackupDialog(props: {
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="settings-dialog-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="恢复备份"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="settings-dialog__title">恢复备份</h3>
        <div className="settings-dialog__body">
          <p className="settings-dialog__text">
            恢复将替换当前书架、标注、收藏和阅读记录，暂停正在下载的任务，并重新打开应用。
          </p>
        </div>
        <div className="settings-dialog__actions">
          <button
            type="button"
            className="settings-link-btn"
            disabled={props.busy}
            onClick={props.onDismiss}
          >
            取消
          </button>
          <AppButton size="sm" variant="primary" disabled={props.busy} onClick={props.onConfirm}>
            {props.busy ? '正在恢复…' : '恢复并重新打开'}
          </AppButton>
        </div>
      </div>
    </div>
  );
}

/* ── 新建分类 — Kotlin SettingsTabScreen.kt:1465–1502 ──
 * ⚠️ Android never sets `showAddCategoryCard = true`, so this dialog is unreachable in
 * the Kotlin app too; it is ported verbatim rather than dropped. See the file header. */
function AddCategoryDialog(props: {
  value: string;
  onValueChange: (value: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="settings-dialog-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="新建分类"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="settings-dialog__title">新建分类</h3>
        <div className="settings-dialog__body">
          <input
            className="settings-dialog__field"
            value={props.value}
            onChange={(event) => props.onValueChange(event.target.value)}
            aria-label="名称"
          />
        </div>
        <div className="settings-dialog__actions">
          <button type="button" className="settings-link-btn" onClick={props.onDismiss}>
            取消
          </button>
          <AppButton size="sm" variant="primary" onClick={props.onConfirm}>
            新建
          </AppButton>
        </div>
      </div>
    </div>
  );
}

/* ── PIN setup overlay stand-in ── */
function PrivacyPinOverlay(props: { mode: 'setup' | 'verify' | 'change-new' | 'change-old'; onPinSet?(pin: string): Promise<void> | void; onPinVerified?(pin: string): Promise<boolean> | boolean; onDismiss(): void }) {
  const accepted = useRef(false);
  return <ActualPinOverlay mode={props.mode === 'setup' ? 'SETUP' : props.mode === 'change-new' ? 'CHANGE_NEW' : props.mode === 'change-old' ? 'CHANGE_OLD' : 'VERIFY'} onPinSet={props.onPinSet ?? (() => {})} onPinVerified={async (pin) => { const ok = await props.onPinVerified?.(pin) ?? false; accepted.current = ok; return ok; }} onDismiss={() => { if (!accepted.current) props.onDismiss(); }} />;
}

export function SettingsPage(props: SettingsPageProps = {}) {
  const primaryIndex = useAppStore((s) => s.primaryIndex);
  const setPrimaryIndex = useAppStore((s) => s.setPrimaryIndex);
  const setAutoNightModePreference = useAppStore((s) => s.setAutoNightModePreference);
  const secondaryIndex = useAppStore((s) => s.secondaryIndex);
  const setSecondaryIndex = useAppStore((s) => s.setSecondaryIndex);
  const pageTurnMode = useAppStore((s) => s.pageTurnMode);
  const setPageTurnMode = useAppStore((s) => s.setPageTurnMode);
  const categories = useAppStore((s) => s.categories);
  const setRoute = useAppStore((s) => s.setRoute);

  const [backupBusy, setBackupBusy] = useState(false);
  const servicesRef = useRef<AppServices | null>(null);
  const loadedRef = useRef(false);

  /* ── SettingsTabScreen.kt local state ── */
  const [splashPosterUri, setSplashPosterUri] = useState('');
  const [splashPureMode, setSplashPureMode] = useState(false);
  const [appBgMode, setAppBgMode] = useState(0);
  const [appBgUri, setAppBgUri] = useState('');
  const [appBgDim, setAppBgDim] = useState(20);
  const [orientationLock, setOrientationLock] = useState(0);
  const [renderQuality, setRenderQuality] = useState(2);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [restReminderMinutes, setRestReminderMinutes] = useState(30);
  const [autoNightMode, setAutoNightMode] = useState(false);
  const [blueLightFilter, setBlueLightFilter] = useState(false);
  const [blueLightAlpha, setBlueLightAlpha] = useState(0.15);
  const [preloadWifiOnly, setPreloadWifiOnly] = useState(false);
  const [showCardPanel, setShowCardPanel] = useState(false);
  const [cardTweaks, setCardTweaks] = useState<CardTweaks>(DEFAULT_CARD_TWEAKS);
  const [showCustomMinutes, setShowCustomMinutes] = useState(false);
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [showManageVerify, setShowManageVerify] = useState(false);
  const [showManageWindow, setShowManageWindow] = useState(false);
  const [showChangePin, setShowChangePin] = useState(false);
  // Kotlin L1551-1555：`onPinSet` 里弹「密码已更新」的前提是这次设置新 PIN 走的是
  // **改密** 流程（CHANGE_OLD），而非首次开启隐私模式。用 ref 而非 state —— 它只在
  // 事件回调里读写，不参与渲染（React 19 的 `react-hooks/refs` 不允许渲染期读 ref）。
  const changingPinRef = useRef(false);
  const changingPinOld = useRef<string | null>(null);
  const [newPinMode, setNewPinMode] = useState<'setup' | 'change-new'>('setup');
  const [showDisableVerify, setShowDisableVerify] = useState(false);
  const [privacyModeEnabled, setPrivacyModeEnabled] = useState(() => getPrivacyService().getSnapshot().enabled);
  useEffect(() => {
    const service = getPrivacyService();
    const update = (): void => { const state = service.getSnapshot(); if (state.loaded) { setPrivacyModeEnabled(state.enabled); useAppStore.getState().setPrivacyEnabled(state.enabled); } };
    const unsubscribe = service.subscribe(update);
    void service.ready().then(update).catch((error: unknown) => showToast(error instanceof Error ? error.message : '无法读取隐私保护状态'));
    return unsubscribe;
  }, []);
  const [privacySwitchPending, setPrivacySwitchPending] = useState(false);
  useEffect(() => getPlatform().appLifecycle.subscribe((foreground) => {
    if (foreground) return;
    setShowManageWindow(false); setShowManageVerify(false); setShowChangePin(false); setShowPinSetup(false); setShowDisableVerify(false); setPrivacySwitchPending(false);
    changingPinOld.current = null; changingPinRef.current = false;
  }), []);
  const [incognitoBrowsingEnabled, setIncognitoBrowsingEnabled] = useState(false);
  const [favoritesProtected, setFavoritesProtected] = useState(false);
  // Kotlin L222 `showCacheManager` — the flag is GONE: 缓存管理 now pushes the
  // `cacheManagement` route (`CacheManagementPage.tsx` already exists), which is the web
  // equivalent of Kotlin's `if (showCacheManager) { CacheManagementScreen(…); return }`.
  const [showHelpBottomSheet, setShowHelpBottomSheet] = useState(false);

  /* ── Kotlin L136–137: updateChecking / updateMessage ── */
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState>({
    release: null,
    transferring: false,
    hasPackage: false,
  });

  /* ── Kotlin L1358–1362: versionName 经 `AppInfoPort` 读取（未接线时显式抛错，
        不再硬编码 / 不再有 PackageManager 旁路）。 ── */
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [appVersionError, setAppVersionError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getPlatform()
      .appInfo.versionName()
      .then((name) => {
        if (!cancelled) setAppVersion(name);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAppVersionError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Kotlin L142 `restoreUri`: the picked file awaiting the confirm dialog ── */
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  /* ── Kotlin L219–220: showAddCategoryDialog / newCategoryText ── */
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [newCategoryText, setNewCategoryText] = useState('');

  const posterFileRef = useRef<HTMLInputElement | null>(null);
  const bgFileRef = useRef<HTMLInputElement | null>(null);
  const restoreFileRef = useRef<HTMLInputElement | null>(null);

  const updateIo = props.updateIo ?? NULL_SETTINGS_UPDATE_IO;

  const getServices = useCallback((): AppServices => {
    if (servicesRef.current === null) {
      servicesRef.current = createServices();
    }
    return servicesRef.current;
  }, []);

  const persist = useCallback(
    async (write: (settings: SettingsRepository) => Promise<void>): Promise<void> => {
      try {
        await write(getServices().settings);
      } catch {
        /* UI already applied the optimistic update */
      }
    },
    [getServices],
  );

  /* Load prefs — PreferencesManager defaults mirrored in SettingsRepository.SETTING_SPECS */
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const { settings } = getServices();
        const state = useAppStore.getState();
        const [
          primary,
          secondary,
          turn,
          splashPure,
          appBgModeVal,
          appBgDimVal,
          appBgUriVal,
          posterUriVal,
          orientation,
          quality,
          haptics,
          restMinutes,
          night,
          blueFilter,
          blueAlpha,
          wifiOnly,
          incognito,
          favorites,
          blurDp,
          cornerDp,
          tiltDeg,
          camMult,
          tintMix,
          pressS,
          pressR,
          cardAlpha,
        ] = await Promise.all([
          settings.getInt('color_primary_index', state.primaryIndex),
          settings.getInt('color_secondary_index', state.secondaryIndex),
          settings.getInt('page_turn_mode', state.pageTurnMode),
          settings.getBoolean('splash_pure_mode', false),
          settings.getInt('app_background_mode', 0),
          settings.getInt('app_background_dim', 20),
          settings.getString('custom_app_background_uri', ''),
          settings.getString('custom_splash_poster_uri', ''),
          settings.getInt('screen_orientation_lock', 0),
          settings.getInt('render_quality', 2),
          settings.getBoolean('haptics_enabled', true),
          settings.getInt('rest_reminder_minutes', 30),
          settings.getBoolean('auto_night_mode', false),
          settings.getBoolean('blue_light_filter', false),
          settings.getFloat('blue_light_alpha', 0.15),
          settings.getBoolean('preload_wifi_only', false),
          settings.getBoolean('incognito_browsing_enabled', false),
          settings.getBoolean('favorites_protected', false),
          settings.getFloat('card_blur_dp', DEFAULT_CARD_TWEAKS.blurRadiusDp),
          settings.getFloat('card_corner_dp', DEFAULT_CARD_TWEAKS.cornerRadiusDp),
          settings.getFloat('card_tilt_deg', DEFAULT_CARD_TWEAKS.tiltMaxDeg),
          settings.getFloat('card_cam_mult', DEFAULT_CARD_TWEAKS.cameraDistMult),
          settings.getFloat('card_tint_mix', DEFAULT_CARD_TWEAKS.tintMix),
          settings.getFloat('card_press_s', DEFAULT_CARD_TWEAKS.pressStrength),
          settings.getFloat('card_press_r', DEFAULT_CARD_TWEAKS.pressRadius),
          settings.getFloat('card_alpha', DEFAULT_CARD_TWEAKS.cardAlpha),
        ]);
        if (cancelled) return;
        useAppStore.setState({ primaryIndex: primary, secondaryIndex: secondary, pageTurnMode: turn });
        setSplashPureMode(splashPure);
        setAppBgMode(appBgModeVal);
        setAppBgDim(appBgDimVal);
        setAppBgUri(appBgUriVal);
        setSplashPosterUri(posterUriVal);
        setOrientationLock(orientation);
        setRenderQuality(Math.max(0, Math.min(3, quality)));
        setHapticsEnabled(haptics);
        setRestReminderMinutes(restMinutes);
        setAutoNightMode(night);
        setBlueLightFilter(blueFilter);
        setBlueLightAlpha(blueAlpha);
        setPreloadWifiOnly(wifiOnly);
        setIncognitoBrowsingEnabled(incognito);
        setFavoritesProtected(favorites);
        setCardTweaks({
          blurRadiusDp: blurDp,
          cornerRadiusDp: cornerDp,
          tiltMaxDeg: tiltDeg,
          cameraDistMult: camMult,
          tintMix,
          pressStrength: pressS,
          pressRadius: pressR,
          cardAlpha,
        });
      } catch {
        /* keep in-memory defaults when storage is unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getServices]);

  const handleExport = useCallback(async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      await getServices().backup.exportBackup(BACKUP_PATH);
      const platform = getPlatform();
      await platform.documents.saveFile({
        fileName: BACKUP_PATH.split('/').pop() ?? 'ciallo_backup.json',
        mime: 'application/json', bytes: await platform.fs.readFile(BACKUP_PATH),
      });
      showToast('备份已保存');
    } catch (error) {
      showToast(error instanceof Error ? `备份失败：${error.message}` : '备份失败');
    } finally {
      setBackupBusy(false);
    }
  }, [backupBusy, getServices]);

  /* ── Kotlin L160–162: `OpenDocument()` → `restoreUri = uri` (opens the confirm dialog) ── */
  const onRestorePicked = useCallback(
    (file: File | undefined) => {
      if (file === undefined || backupBusy) return;
      setRestoreFile(file);
    },
    [backupBusy],
  );

  /* ── Kotlin L167–195: the restore `AlertDialog`'s confirmButton body ── */
  const handleImport = useCallback(async () => {
    const file = restoreFile;
    if (backupBusy || file === null) return;
    setBackupBusy(true);
    try {
      // Kotlin L179: `require(total <= 4L * 1024 * 1024 * 1024) { "备份文件过大" }`
      if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件过大');
      const { settings, backup } = getServices();
      // Kotlin L172–183 streams the picked Uri into a cache temp file first; the web port
      // stages the same bytes through `platform.fs` so `BackupService` keeps reading a
      // path. (Kotlin L184's `check(...) { "备份恢复失败" }` is not reachable here:
      // `BackupService.importBackup` signals failure by throwing, not by returning
      // false — the message survives only in the catch arm below.)
      await getPlatform().fs.writeFile(BACKUP_PATH, new Uint8Array(await file.arrayBuffer()));
      await backup.importBackup(BACKUP_PATH);
      const state = useAppStore.getState();
      const [primary, secondary, turn] = await Promise.all([
        settings.getInt('color_primary_index', state.primaryIndex),
        settings.getInt('color_secondary_index', state.secondaryIndex),
        settings.getInt('page_turn_mode', state.pageTurnMode),
      ]);
      useAppStore.setState({ primaryIndex: primary, secondaryIndex: secondary, pageTurnMode: turn });
      // Kotlin L185–190: `restoreUri = null` → toast → relaunch through a cleared task
      setRestoreFile(null);
      showToast('恢复完成');
      updateIo.relaunchApp();
    } catch (error) {
      // Kotlin L193: `AppToast.makeText(context, "恢复失败：${e.message}", LENGTH_LONG)`
      showToast(error instanceof Error ? `恢复失败：${error.message}` : '恢复失败：无法打开备份');
    } finally {
      setBackupBusy(false);
    }
  }, [backupBusy, getServices, restoreFile, updateIo]);

  const dismissRestore = useCallback(() => {
    if (backupBusy) return;
    setRestoreFile(null);
  }, [backupBusy]);

  /* ── Kotlin L1369–1384: 检查更新 ── */
  const onCheckUpdate = useCallback(() => {
    if (updateChecking) return;
    setUpdateChecking(true);
    setUpdateMessage(null);
    void (async () => {
      try {
        if (appVersion === null) {
          setUpdateMessage(appVersionError ?? '版本号尚未读取完成，请稍后重试。');
          return;
        }
        const result = await updateIo.check(appVersion);
        setUpdateMessage(result.message);
        if (result.release !== null && result.release !== undefined) {
          await updateIo.offer(result.release);
        }
      } catch (error) {
        setUpdateMessage(error instanceof Error ? error.message : '无法读取 GitHub 更新信息');
      } finally {
        setUpdateChecking(false);
      }
    })();
  }, [updateChecking, updateIo, appVersion, appVersionError]);

  /* ── Kotlin L140: `appUpdate.state.collectAsStateWithLifecycle()` ── */
  useEffect(() => {
    let cancelled = false;
    void updateIo.appUpdateState().then((state) => {
      if (!cancelled) setAppUpdateState(state);
    });
    const unsubscribe = updateIo.onAppUpdateState((state) => {
      if (!cancelled) setAppUpdateState(state);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [updateIo]);

  /* ── Kotlin L324–328: `LaunchedEffect(focusGodSettings)` scroll to the 神回 section ── */
  const focusGodPendingRef = useRef(false);
  useEffect(() => {
    if (props.focusGodSettings !== true || focusGodPendingRef.current) return;
    focusGodPendingRef.current = true;
    setGodStyleSettingsJumpPending(true);
  }, [props.focusGodSettings]);

  /* Poster picker — GetContent("image/*") + copy to private dir */
  const onPosterFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const url = URL.createObjectURL(file);
      setSplashPosterUri(url);
      void persist((settings) => settings.setString('custom_splash_poster_uri', url));
      showToast('海报已设置');
    },
    [persist],
  );

  const clearPoster = useCallback(() => {
    setSplashPosterUri('');
    void persist((settings) => settings.setString('custom_splash_poster_uri', ''));
    showToast('已还原默认海报');
  }, [persist]);

  /* App background picker */
  const onBgFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const url = URL.createObjectURL(file);
      setAppBgUri(url);
      setAppBgMode(1);
      void persist(async (settings) => {
        await settings.setString('custom_app_background_uri', url);
        await settings.setInt('app_background_mode', 1);
      });
      showToast('背景已设置（横竖屏自动裁剪填充）');
    },
    [persist],
  );

  const restoreDefaultBg = useCallback(() => {
    setAppBgUri('');
    setAppBgMode(0);
    void persist(async (settings) => {
      await settings.setString('custom_app_background_uri', '');
      await settings.setInt('app_background_mode', 0);
    });
    showToast('已恢复默认背景');
  }, [persist]);

  /* Theme color change — 600ms easeOut morph via CSS on swatches */
  const onPrimaryColorChange = useCallback(
    (index: number) => {
      setPrimaryIndex(index);
      void persist((settings) => settings.setInt('color_primary_index', index));
    },
    [persist, setPrimaryIndex],
  );

  const onSecondaryColorChange = useCallback(
    (index: number) => {
      setSecondaryIndex(index);
      void persist((settings) => settings.setInt('color_secondary_index', index));
    },
    [persist, setSecondaryIndex],
  );

  // Theme preview button remains available without a hidden source-unlock gesture.
  const onLiquidButtonClick = useCallback(() => {}, []);

  /* ── Kotlin L239–244: `updateCardTweaks(transform)` — write prefs, then read the
     coerced truth back so the shared state never holds an out-of-range raw value.
     The web repository clamps inside its setters, so the read-back is the value the
     setter round-tripped. ── */
  const onSharedCardTweaksChange = props.onSharedCardTweaksChange;
  const updateCardTweaks = useCallback(
    (transform: (prev: CardTweaks) => CardTweaks) => {
      setCardTweaks((prev) => {
        const next = transform(prev);
        void persist(async (settings) => {
          await settings.setFloat('card_blur_dp', next.blurRadiusDp);
          await settings.setFloat('card_corner_dp', next.cornerRadiusDp);
          await settings.setFloat('card_tilt_deg', next.tiltMaxDeg);
          await settings.setFloat('card_cam_mult', next.cameraDistMult);
          await settings.setFloat('card_tint_mix', next.tintMix);
          await settings.setFloat('card_press_s', next.pressStrength);
          await settings.setFloat('card_press_r', next.pressRadius);
          await settings.setFloat('card_alpha', next.cardAlpha);
        });
        onSharedCardTweaksChange?.(next);
        return next;
      });
    },
    [persist, onSharedCardTweaksChange],
  );

  // Kotlin L884: `val tw = tweaksState?.value ?: prefs.readCardTweaks()` — the
  // MainActivity-owned shared value wins over the local load.
  const tw = props.sharedCardTweaks ?? cardTweaks;

  return (
    <div className="page settings-page">
      {/* ── Kotlin L331–343: `settingsLeading`, shown only when `onBack != null` ── */}
      <TabScreenHeader
        title="设置"
        subtitle="SETTINGS & PREFERENCES"
        collapsed={false}
        leading={
          props.onBack !== undefined ? (
            <button
              type="button"
              className="settings-header-back"
              onClick={props.onBack}
              aria-label="返回"
            >
              <IconArrowBack />
            </button>
          ) : undefined
        }
      />

      {/* ── Kotlin L364: `contentPadding bottom = 16.dp + extraBottomPadding` ── */}
      <div
        className="settings-list"
        style={
          props.extraBottomPadding !== undefined && props.extraBottomPadding !== 0
            ? { paddingBottom: props.extraBottomPadding }
            : undefined
        }
      >
        {/* ── Section 1: Splash Poster (开屏海报设置) ── */}
        <SettingsSectionHeader text="开屏海报设置" />
        <GlassCard>
          <div className="settings-card-title-row">
            <div className="settings-card-title-row__left">
              <span className="settings-card-title-row__label">自定义开屏海报</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {splashPosterUri ? (
                <button type="button" className="settings-link-btn" onClick={clearPoster}>
                  清除
                </button>
              ) : null}
              <AppButton size="sm" variant="primary" onClick={() => posterFileRef.current?.click()}>
                选择相册图片
              </AppButton>
            </div>
          </div>
          <input
            ref={posterFileRef}
            className="settings-file-input"
            type="file"
            accept="image/*"
            onChange={(event) => onPosterFile(event.target.files?.[0])}
          />
          {splashPosterUri ? (
            <>
              <div className="settings-spacer-12" />
              <div className="poster-preview">
                <img src={splashPosterUri} alt="海报预览" />
              </div>
            </>
          ) : null}
          <div className="settings-spacer-12" />
          <hr className="settings-divider" />
          <div className="settings-spacer-12" />
          <div className="settings-card-title-row">
            <span className="settings-card-title-row__label settings-card-title-row__label--semibold">
              纯净模式
            </span>
            <AppSwitch
              checked={splashPureMode}
              onCheckedChange={(next) => {
                setSplashPureMode(next);
                void persist((settings) => settings.setBoolean('splash_pure_mode', next));
              }}
              ariaLabel="纯净模式"
            />
          </div>
        </GlassCard>

        {/* ── Section: 软件背景设置 ── */}
        <SettingsSectionHeader text="软件背景设置" />
        <GlassCard>
          <span className="settings-card-title-row__label">软件背景</span>
          <div className="settings-spacer-10" />
          <SettingsSegmented
            options={[
              { value: 0, label: '默认' },
              { value: 1, label: '自定义' },
            ]}
            selected={appBgMode}
            onSelect={(mode) => {
              setAppBgMode(mode);
              void persist((settings) => settings.setInt('app_background_mode', mode));
            }}
          />
          {appBgMode === 1 ? (
            <>
              <div className="settings-spacer-12" />
              {appBgUri ? (
                <>
                  <div className="bg-preview">
                    <img className="bg-preview__image" src={appBgUri} alt="背景预览" />
                    <div
                      className="bg-preview__dim"
                      style={{ opacity: appBgDim / 100 }}
                    />
                    <div className="bg-preview__card">
                      <p className="bg-preview__card-title">预览</p>
                      <p className="bg-preview__card-sub">背景遮罩 {appBgDim}%</p>
                    </div>
                  </div>
                  <div className="settings-spacer-10" />
                  <div className="settings-value-row">
                    <span className="settings-value-row__label">背景遮罩强度</span>
                    <span className="settings-value-row__value">{appBgDim}%</span>
                  </div>
                  <SettingsSlider
                    value={appBgDim}
                    min={0}
                    max={50}
                    onChange={(next) => {
                      setAppBgDim(next);
                      void persist((settings) => settings.setInt('app_background_dim', next));
                    }}
                    startText="0%"
                    endText="50%"
                    bubbleText={`${appBgDim}%`}
                  />
                  <div className="settings-spacer-8" />
                </>
              ) : null}
              <div className="settings-button-row">
                <AppButton
                  size="sm"
                  variant="primary"
                  fullWidth
                  onClick={() => bgFileRef.current?.click()}
                >
                  {appBgUri ? '更换图片' : '选择背景图片'}
                </AppButton>
                {appBgUri ? (
                  <AppButton size="sm" variant="secondary" fullWidth onClick={restoreDefaultBg}>
                    恢复默认
                  </AppButton>
                ) : null}
              </div>
              <input
                ref={bgFileRef}
                className="settings-file-input"
                type="file"
                accept="image/*"
                onChange={(event) => onBgFile(event.target.files?.[0])}
              />
            </>
          ) : null}
        </GlassCard>

        {/* ── Section: 外观与主题 ── */}
        <SettingsSectionHeader text="外观与主题" />
        <GlassCard>
          <div className="settings-card-title-row__left">
            <span className="settings-card-icon">
              <IconPalette />
            </span>
            <span className="settings-card-title-row__label">主题配色方案</span>
          </div>
          <div className="settings-spacer-14" />

          <p className="settings-sublabel">主色调 (Primary)</p>
          <div className="settings-spacer-8" />
          <div className="color-swatch-row">
            {BASE_PRIMARY_COLORS.map((color, index) => (
              <ColorMorphSwatch
                key={color}
                color={color}
                selected={primaryIndex === index}
                onClick={() => onPrimaryColorChange(index)}
              />
            ))}
          </div>

          <div className="settings-spacer-16" />

          <p className="settings-sublabel">强调色 / 副色 (Secondary)</p>
          <div className="settings-spacer-8" />
          <div className="color-swatch-row">
            {BASE_SECONDARY_COLORS.map((color, index) => (
              <ColorMorphSwatch
                key={color}
                color={color}
                selected={secondaryIndex === index}
                onClick={() => onSecondaryColorChange(index)}
              />
            ))}
          </div>

          <div className="settings-spacer-20" />

          <p className="settings-sublabel">实时配色预览卡片</p>
          <div className="settings-spacer-8" />
          <div className="settings-preview-card">
            <div className="preview-room-row">
              <div className="preview-room-left">
                <div
                  className="preview-room-dot"
                  style={{
                    background: resolveAccent(BASE_PRIMARY_COLORS, primaryIndex),
                    transition: `background ${themeColorTransitionCss}`,
                  }}
                />
                <span
                  className="preview-room-title"
                  style={{
                    color: resolveAccent(BASE_PRIMARY_COLORS, primaryIndex),
                    transition: `color ${themeColorTransitionCss}`,
                  }}
                >
                  Ciallo 阅览室
                </span>
              </div>
              <span
                className="preview-secondary-chip"
                style={{
                  background: resolveAccent(BASE_SECONDARY_COLORS, secondaryIndex),
                  transition: `background ${themeColorTransitionCss}`,
                }}
              >
                副色标签
              </span>
            </div>
            <div className="settings-spacer-10" />
            <button type="button" className="liquid-button" onClick={onLiquidButtonClick}>
              主色按钮实时联动效果
            </button>
          </div>
        </GlassCard>

        {/* ── Section: 屏幕方向 ── */}
        <SettingsSectionHeader text="屏幕方向" />
        <GlassCard>
          <div className="settings-card-title-row__left">
            <span className="settings-card-icon">
              <IconScreenRotation />
            </span>
            <span className="settings-card-title-row__label settings-card-title-row__label--semibold">
              方向锁定
            </span>
          </div>
          <div className="settings-spacer-12" />
          <SettingsSegmented
            options={[
              { value: 0, label: '跟随系统' },
              { value: 1, label: '锁定竖屏' },
              { value: 2, label: '锁定横屏' },
            ]}
            selected={orientationLock}
            onSelect={(next) => {
              setOrientationLock(next);
              void persist((settings) => settings.setInt('screen_orientation_lock', next));
            }}
          />
        </GlassCard>

        {/* ── Section: 画面与性能 ── */}
        <SettingsSectionHeader text="画面与性能" />
        <GlassCard>
          <div className="settings-card-title-row__left">
            <span className="settings-card-icon">
              <IconAutoAwesome />
            </span>
            <span className="settings-card-title-row__label settings-card-title-row__label--semibold">
              渲染画质
            </span>
          </div>
          <div className="settings-spacer-10" />
          <SettingsSegmented
            options={[
              { value: 0, label: '流畅' },
              { value: 1, label: '均衡' },
              { value: 2, label: '高' },
              { value: 3, label: '极致' },
            ]}
            selected={renderQuality}
            onSelect={(next) => {
              setRenderQuality(next);
              void persist((settings) => settings.setInt('render_quality', next));
            }}
          />
        </GlassCard>

        {/* ── Haptics (触控反馈) — no section header in Android ── */}
        <GlassCard>
          <div className="settings-card-title-row">
            <div className="settings-card-title-row__left">
              <span className="settings-card-icon">
                <IconVibration />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="settings-card-title-row__label settings-card-title-row__label--semibold">
                  触控反馈
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-medium-gray)' }}>
                  点按与滑动时的震动确认
                </div>
              </div>
            </div>
            <AppSwitch
              checked={hapticsEnabled}
              onCheckedChange={(next) => {
                setHapticsEnabled(next);
                void persist((settings) => settings.setBoolean('haptics_enabled', next));
                if (next && typeof navigator !== 'undefined' && navigator.vibrate) {
                  navigator.vibrate(12);
                }
              }}
              ariaLabel="触控反馈"
            />
          </div>
        </GlassCard>

        {/* ── Card tweaks (自定义卡片参数) ── */}
        <GlassCard>
          <div className="settings-card-title-row">
            <div className="settings-card-title-row__left">
              <span className="settings-card-icon">
                <IconPalette />
              </span>
              <span className="settings-card-title-row__label settings-card-title-row__label--semibold">
                自定义卡片参数
              </span>
            </div>
            <AppSwitch
              checked={showCardPanel}
              onCheckedChange={setShowCardPanel}
              ariaLabel="自定义卡片参数"
            />
          </div>
          <div className={showCardPanel ? 'card-tweak-panel card-tweak-panel--open' : 'card-tweak-panel'}>
            <div className="card-tweak-panel__reset-row">
              <button
                type="button"
                className="settings-link-btn"
                style={{ fontWeight: 700 }}
                onClick={() => {
                  // Kotlin L893: `updateCardTweaks { CardTweaks() }` — goes through the
                  // same persist + shared-state write-back as every slider.
                  updateCardTweaks(() => DEFAULT_CARD_TWEAKS);
                  // Kotlin L894: the toast
                  showToast('已恢复默认卡片参数');
                }}
              >
                重置默认
              </button>
            </div>

            <CardTweakSlider
              label="毛玻璃模糊强度"
              valueText={`${Math.round(tw.blurRadiusDp)}dp`}
              position={(tw.blurRadiusDp - 8) / 32}
              startText="8"
              endText="40"
              onChange={(v) => updateCardTweaks((prev) => ({ ...prev, blurRadiusDp: 8 + v * 32 }))}
            />
            <CardTweakSlider
              label="卡片圆角"
              valueText={`${Math.round(tw.cornerRadiusDp)}dp`}
              position={(tw.cornerRadiusDp - 2) / 46}
              startText="2"
              endText="48"
              onChange={(v) => updateCardTweaks((prev) => ({ ...prev, cornerRadiusDp: 2 + v * 46 }))}
            />
            <CardTweakSlider
              label="3D 倾斜最大角度"
              valueText={`${tw.tiltMaxDeg.toFixed(1)}°`}
              position={Math.sqrt(tw.tiltMaxDeg / 15)}
              startText="0°"
              endText="15°"
              onChange={(v) => updateCardTweaks((prev) => ({ ...prev, tiltMaxDeg: v * v * 15 }))}
            />
            <CardTweakSlider
              label="立体透视强度（越大越立体）"
              valueText={`${Math.round(((12 - tw.cameraDistMult) / 9) * 100)}%`}
              position={(12 - tw.cameraDistMult) / 9}
              startText="平面"
              endText="立体"
              onChange={(v) =>
                updateCardTweaks((prev) => ({ ...prev, cameraDistMult: 12 - v * 9 }))
              }
            />
            <CardTweakSlider
              label="主题色叠加浓度"
              valueText={`${Math.round(tw.tintMix * 100)}%`}
              position={tw.tintMix / 0.3}
              startText="0%"
              endText="30%"
              onChange={(v) => updateCardTweaks((prev) => ({ ...prev, tintMix: v * 0.3 }))}
            />
            <CardTweakSlider
              label="压力形变强度"
              valueText={`${Math.round(tw.pressStrength * 100)}%`}
              position={tw.pressStrength / 2}
              startText="0%"
              endText="200%"
              onChange={(v) => updateCardTweaks((prev) => ({ ...prev, pressStrength: v * 2 }))}
            />
            <CardTweakSlider
              label="压力形变半径"
              valueText={`×${tw.pressRadius.toFixed(1)}`}
              position={(tw.pressRadius - 0.5) / 2}
              startText="0.5×"
              endText="2.5×"
              onChange={(v) => updateCardTweaks((prev) => ({ ...prev, pressRadius: 0.5 + v * 2 }))}
            />
            <CardTweakSlider
              label="卡片不透明度"
              valueText={`${Math.round(tw.cardAlpha * 100)}%`}
              position={(tw.cardAlpha - 0.4) / 0.6}
              startText="40%"
              endText="100%"
              onChange={(v) => updateCardTweaks((prev) => ({ ...prev, cardAlpha: 0.4 + v * 0.6 }))}
            />
            <div className="settings-spacer-8" />
          </div>
        </GlassCard>

        {/* ── Section: 翻页效果 ── */}
        <SettingsSectionHeader text="翻页效果" />
        <GlassCard>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PAGE_TURN_TYPES.map((turnType) => (
              <AndroidPageTurnRow
                key={turnType.id}
                title={turnType.title}
                description={turnType.description}
                type={turnType.id}
                selected={pageTurnMode === turnType.id}
                onClick={() => {
                  setPageTurnMode(turnType.id);
                  void persist((settings) => settings.setInt('page_turn_mode', turnType.id));
                }}
              />
            ))}
          </div>
        </GlassCard>

        {/* ── Section: 神回（GodMoment）设置分组 ── */}
        <GodSettingsSection />

        {/* ── Section: 护眼与提醒 ── */}
        <SettingsSectionHeader text="护眼与提醒" />
        <GlassCard>
          <div className="settings-card-title-row__left">
            <span className="settings-card-icon">
              <IconTimer />
            </span>
            <span className="settings-card-title-row__label settings-card-title-row__label--semibold">
              定时休息
            </span>
          </div>
          <div className="settings-spacer-8" />
          <SettingsSegmented
            options={[
              { value: 0, label: '关' },
              { value: 15, label: '15分' },
              { value: 30, label: '30分' },
              { value: 45, label: '45分' },
              { value: 60, label: '60分' },
            ]}
            selected={
              PRESET_REST_MINUTES.includes(restReminderMinutes) ? restReminderMinutes : -1
            }
            onSelect={(next) => {
              setRestReminderMinutes(next);
              void persist((settings) => settings.setInt('rest_reminder_minutes', next));
            }}
          />
          <div className="settings-spacer-12" />
          <div className="settings-value-row">
            <span style={{ fontSize: 13, color: 'var(--color-medium-gray)' }}>
              {PRESET_REST_MINUTES.includes(restReminderMinutes)
                ? '自定义提醒时间'
                : `当前自定义：${restReminderMinutes} 分钟`}
            </span>
            <AppButton size="sm" variant="secondary" onClick={() => setShowCustomMinutes(true)}>
              自定义
            </AppButton>
          </div>

          <div className="settings-spacer-12" />
          <hr className="settings-divider" />
          <div className="settings-spacer-12" />
          <div className="settings-card-title-row">
            <div className="settings-card-title-row__left">
              <span className="settings-card-icon">
                <IconNightlight />
              </span>
              <span className="settings-card-title-row__label settings-card-title-row__label--semibold">
                夜间模式
              </span>
            </div>
            <AppSwitch
              checked={autoNightMode}
              onCheckedChange={(next) => {
                setAutoNightMode(next);
                // 走 store 的单一入口：写 `data-theme` + 落库（App.tsx 监听 store 换肤）
                void setAutoNightModePreference(next);
                void persist((settings) => settings.setBoolean('auto_night_mode', next));
              }}
              ariaLabel="夜间模式"
            />
          </div>

          <div className="settings-spacer-12" />
          <hr className="settings-divider" />
          <div className="settings-spacer-12" />
          <div className="settings-card-title-row">
            <div className="settings-card-title-row__left">
              <span className="settings-card-icon">
                <IconRemoveRedEye />
              </span>
              <span className="settings-card-title-row__label settings-card-title-row__label--semibold">
                护眼滤镜
              </span>
            </div>
            <AppSwitch
              checked={blueLightFilter}
              onCheckedChange={(next) => {
                setBlueLightFilter(next);
                void persist((settings) => settings.setBoolean('blue_light_filter', next));
              }}
              ariaLabel="护眼滤镜"
            />
          </div>

          <div className="settings-spacer-12" />
          <hr className="settings-divider" />
          <div className="settings-spacer-12" />
          <div className="settings-card-title-row">
            <div className="settings-card-title-row__left">
              <span className="settings-card-icon">
                <IconWifi />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="settings-card-title-row__label settings-card-title-row__label--semibold">
                  仅 Wi-Fi 预加载漫画
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-medium-gray)' }}>
                  开启后移动网络不会提前下载后面的页，更省流量
                </div>
              </div>
            </div>
            <AppSwitch
              checked={preloadWifiOnly}
              onCheckedChange={(next) => {
                setPreloadWifiOnly(next);
                void persist((settings) => settings.setBoolean('preload_wifi_only', next));
              }}
              ariaLabel="仅 Wi-Fi 预加载漫画"
            />
          </div>

          {blueLightFilter ? (
            <>
              <div className="settings-spacer-10" />
              <div className="settings-value-row">
                <span className="settings-value-row__label">当前强度</span>
                <span className="settings-value-row__value">
                  {Math.round(blueLightAlpha * 100)}%
                </span>
              </div>
              <div className="settings-spacer-6" style={{ height: 6 }} />
              <SettingsSlider
                value={blueLightAlpha}
                min={0}
                max={1}
                step={0.01}
                onChange={(next) => {
                  setBlueLightAlpha(next);
                  void persist((settings) => settings.setFloat('blue_light_alpha', next));
                }}
                startText="0"
                endText="100"
                bubbleText={`${Math.round(blueLightAlpha * 100)}%`}
              />
            </>
          ) : null}
        </GlassCard>

        {/* ── Section: 隐私与安全 ── */}
        <SettingsSectionHeader text="隐私与安全" />
        <GlassCard>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              marginLeft: -16,
              marginRight: -16,
              marginTop: -16,
            }}
          >
            <span className="settings-card-icon" style={{ width: 24, height: 24 }}>
              <IconShield />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="settings-card-title-row__label settings-card-title-row__label--semibold"
                style={{ fontSize: 15 }}
              >
                隐私模式
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-medium-gray)' }}>
                {privacyModeEnabled
                  ? '已开启 · 分类密码保护与无痕阅读'
                  : '设置 6 位密码，为分类加锁'}
              </div>
            </div>
            {!privacyModeEnabled ? (
              <AppSwitch
                checked={privacySwitchPending}
                onCheckedChange={(wantOn) => {
                  if (wantOn) {
                    setNewPinMode('setup');
                    setPrivacySwitchPending(true);
                    setShowPinSetup(true);
                  } else {
                    setPrivacySwitchPending(false);
                  }
                }}
                ariaLabel="隐私模式"
              />
            ) : (
              <button
                type="button"
                className="settings-link-btn"
                onClick={() => setShowManageVerify(true)}
              >
                管理
              </button>
            )}
          </div>
        </GlassCard>

        {/* ── Section: 存储管理 ── */}
        <SettingsSectionHeader text="存储管理" />
        {/* Kotlin L1260–1283 + L1440–1443 — `GlassCard(clickableWithFeedback {
           showCacheManager = true })` then `if (showCacheManager) {
           CacheManagementScreen(onBack = { showCacheManager = false }); return }`.
           FIXED: the port used to pop a placeholder dialog ("完整缓存管理页面…
           将在后续移植中接入。"). `CacheManagementPage` and the `cacheManagement`
           route now both exist, so the row navigates there — the same "replace this
           screen" semantics Kotlin gets from the early `return`. The placeholder
           dialog and its invented string are gone. */}
        <GlassCard
          padding={0}
          onClick={() => {
            setRoute('cacheManagement');
          }}
        >
          <button
            type="button"
            className="settings-nav-row"
            onClick={() => {
              setRoute('cacheManagement');
            }}
          >
            <span className="settings-nav-row__left">
              <span className="settings-card-icon">
                <IconCleaningServices />
              </span>
              <span>
                <span className="settings-nav-row__title settings-nav-row__title--15">
                  缓存管理
                </span>
                <span className="settings-nav-row__desc settings-nav-row__desc--12">
                  查看应用占用，清理缓存与离线数据
                </span>
              </span>
            </span>
            <span className="settings-chevron">
              <IconChevronRight />
            </span>
          </button>
        </GlassCard>

        {/* ── Section: 数据备份 ── */}
        <SettingsSectionHeader text="数据备份" />
        <GlassCard><h3 style={{ margin: '0 0 8px' }}>设备互传</h3><p style={{ margin: '0 0 12px', fontSize: 14 }}>向附近设备迁移书籍、收藏、标注和设置。</p><AppButton size="sm" onClick={() => setRoute('deviceTransfer')}>打开设备互传</AppButton></GlassCard>
        <GlassCard>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
              备份书籍、原文件、标注、收藏、阅读记录与设置。登录凭据不包含在备份中。
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <AppButton
                size="sm"
                variant="primary"
                disabled={backupBusy}
                onClick={() => {
                  void handleExport();
                }}
              >
                {backupBusy ? '正在处理…' : '导出备份'}
              </AppButton>
              {/* Kotlin L1293–1295: `importBackupLauncher.launch(arrayOf(...))` —
                  picking a file only sets `restoreFile`; the restore itself waits for
                  the confirm dialog's 恢复并重新打开 button (L163–198). */}
              <AppButton
                size="sm"
                variant="secondary"
                disabled={backupBusy}
                onClick={() => {
                  void getPlatform().documents.pickFile({ accept: '.json,.zip,.ciallo', multiple: false })
                    .then((files) => {
                      const file = files[0];
                      if (file !== undefined) onRestorePicked(new File([file.bytes as Uint8Array<ArrayBuffer>], file.name, { type: file.mime }));
                    }).catch((error: unknown) => showToast(error instanceof Error ? error.message : '无法打开备份文件'));
                }}
              >
                恢复备份
              </AppButton>
            </div>
          </div>
        </GlassCard>

        {/* ── Section: 帮助手册 ── */}
        <SettingsSectionHeader text="帮助手册" />
        {/* Kotlin L1306–1339 + L1445–1451 — `GlassCard(testTag("library_help_entry_card"),
           clickableWithFeedback { showHelpBottomSheet = true })` then
           `if (showHelpBottomSheet) LibraryHelpBottomSheet(onDismissRequest = …,
           onOpenSourceManager = { onOpenSourceManager?.invoke() })`.
           FIXED: the port used to pop a placeholder dialog; the real
           `LibraryHelpBottomSheet` is a completed port, so it is mounted here with the
           same two callbacks. */}
        <GlassCard
          padding={0}
          onClick={() => {
            setShowHelpBottomSheet(true);
          }}
        >
          <button
            type="button"
            className="settings-nav-row"
            data-testid="library_help_entry_card"
            // Kotlin L1332-1336 `Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight,
            // contentDescription = "打开帮助")` —— Compose 的 contentDescription
            // 对应 Web 的 aria-label（E85）。
            aria-label="打开帮助"
            onClick={() => {
              setShowHelpBottomSheet(true);
            }}
          >
            <span className="settings-nav-row__left">
              {/* Kotlin L1320-1324 `Icon(Icons.Filled.HelpCenter,
                  contentDescription = "书库帮助中心", tint = MintPrimary)`（E85） */}
              <span className="settings-card-icon" aria-label="书库帮助中心" role="img">
                <IconHelpCenter />
              </span>
              <span>
                <span className="settings-nav-row__title">书库使用手册</span>
                <span className="settings-nav-row__desc">书源说明、下载管理与常见问题</span>
              </span>
            </span>
            <span className="settings-chevron">
              <IconChevronRight />
            </span>
          </button>
        </GlassCard>

        {/* ── Kotlin L1341–1435: Section 8 — About + 检查更新 ── */}
        <GlassCard>
          <div className="settings-about">
            {/* Kotlin L1351–1356 */}
            <h3 className="settings-about__name">Ciallo Reader</h3>
            <div className="settings-spacer-4" />
            {/* Kotlin L1358–1367: `packageManager.getPackageInfo(...).versionName
                ?: BuildConfig.VERSION_NAME` with a catch fallback — 此处由
                `platform.appInfo.versionName()`（AppInfoPort）提供，未接线时
                显式抛错而不是退回硬编码字面量。 */}
            <p className="settings-about__version">
              {appVersion !== null
                ? `版本 ${appVersion}`
                : appVersionError !== null
                  ? `版本读取失败：${appVersionError}`
                  : '版本读取中…'}
            </p>
            <div className="settings-spacer-10" />

            {/* Kotlin L1369–1384 */}
            <AppButton
              size="sm"
              disabled={updateChecking}
              onClick={() => {
                onCheckUpdate();
              }}
            >
              {updateChecking ? '检查中…' : '检查更新'}
            </AppButton>

            {/* Kotlin L1385–1388: `updateMessage?.let { Spacer(6.dp); Text(it, 10.sp) }` */}
            {updateMessage !== null ? (
              <>
                <div className="settings-spacer-6" style={{ height: 6 }} />
                <p className="settings-about__update">{updateMessage}</p>
              </>
            ) : null}

            {/* Kotlin L1390–1396: shown when a check ran, no APK is being handled, and the
                verdict is NOT "已是最新版本" (`!updateMessage.contains("最新版本")`). */}
            {updateMessage !== null &&
            appUpdateState.release === null &&
            !updateMessage.includes('最新版本') ? (
              <button
                type="button"
                className="settings-about__textbtn"
                onClick={() => {
                  // Kotlin L1392-1393 `runCatching { … }.onFailure { toast("无法打开发布页，请检查浏览器。") }`
                  void updateIo.openUri(GITHUB_LATEST_URL).catch(() => {
                    showToast('无法打开发布页，请检查浏览器。');
                  });
                }}
              >
                GitHub 发布页
              </button>
            ) : null}

            {/* Kotlin L1397–1401 */}
            {appUpdateState.release !== null ? (
              <button
                type="button"
                className="settings-about__textbtn"
                onClick={() => {
                  updateIo.showAppUpdateSheet();
                }}
              >
                {appUpdateState.transferring
                  ? '查看下载进度'
                  : appUpdateState.hasPackage
                    ? '继续安装更新'
                    : '查看更新'}
              </button>
            ) : null}

            {/* Kotlin L1402–1403 */}
            <p className="settings-about__hint-strong">检查正式版本，确认后下载并打开系统安装页面。</p>
            {/* Kotlin L1404–1409: Spacer(2.dp) before the tagline */}
            <div className="settings-spacer-2" />
            <p className="settings-about__tagline">轻量级本地 / 在线小说阅读器</p>
            <div className="settings-spacer-14" />

            {/* Kotlin L1412–1429: the Surface(50) star pill — the URL keeps the
                `/releases` suffix the previous port was missing. */}
            <button
              type="button"
              className="settings-about__star"
              onClick={() => {
                // Kotlin L1417-1419 `runCatching { githubUriHandler.openUri(...) }.onFailure { … }`
                void updateIo.openUri(GITHUB_RELEASES_URL).catch(() => {
                  showToast('暂时打不开 GitHub，稍后再来喵～');
                });
              }}
            >
              <IconStar />
              狗修金，给颗 Star 好不好喵～
            </button>
            {/* Kotlin L1430–1432: Spacer(5.dp) before the hint */}
            <p className="settings-about__hint">点这里，去 GitHub 摸摸小项目 ฅ^•ﻌ•^ฅ</p>
          </div>
        </GlassCard>
      </div>

      {/* ── Kotlin L160–162: the hidden `OpenDocument()` target. Picking a file sets
          `restoreFile`, which opens the confirm dialog above. ── */}
      <input
        ref={restoreFileRef}
        className="settings-file-input"
        type="file"
        accept="application/zip,application/octet-stream"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          onRestorePicked(file);
        }}
      />

      {/* ── Kotlin L163–198: the 恢复备份 confirm AlertDialog ── */}
      {restoreFile !== null ? (
        <RestoreBackupDialog
          busy={backupBusy}
          onConfirm={() => {
            void handleImport();
          }}
          onDismiss={dismissRestore}
        />
      ) : null}

      {/* ── Kotlin L1465–1502: the 新建分类 AlertDialog. Android never sets
          `showAddCategoryDialog = true`; kept verbatim (see the file header). ── */}
      {showAddCategoryDialog ? (
        <AddCategoryDialog
          value={newCategoryText}
          onValueChange={setNewCategoryText}
          onConfirm={() => {
            if (newCategoryText.trim() === '') return;
            const name = newCategoryText.trim();
            if (props.onAddCategory !== undefined) {
              props.onAddCategory(name);
            } else {
              useAppStore.setState((state) => ({
                categories: [
                  ...state.categories,
                  { id: nextCategoryId(state.categories), name, isProtected: false },
                ],
              }));
            }
            setNewCategoryText('');
            setShowAddCategoryDialog(false);
            showToast('新建成功');
          }}
          onDismiss={() => setShowAddCategoryDialog(false)}
        />
      ) : null}

      {/* ── Overlays ── */}
      {showCustomMinutes ? (
        <CustomMinutesDialog
          current={
            PRESET_REST_MINUTES.includes(restReminderMinutes)
              ? 15
              : restReminderMinutes
          }
          onConfirm={(minutes) => {
            setRestReminderMinutes(minutes);
            void persist((settings) => settings.setInt('rest_reminder_minutes', minutes));
            setShowCustomMinutes(false);
          }}
          onDismiss={() => setShowCustomMinutes(false)}
        />
      ) : null}

      {showPinSetup ? (
        <PrivacyPinOverlay
          mode={newPinMode}
          onPinSet={async (pin) => {
            const changed = changingPinRef.current;
            const ok = changed && changingPinOld.current !== null ? await getPrivacyService().change(changingPinOld.current, pin) : await getPrivacyService().enable(pin);
            if (ok) {
              setPrivacyModeEnabled(true);
              setPrivacySwitchPending(false);
              setShowPinSetup(false);
              setShowManageWindow(getPlatform().appLifecycle.isForeground());
              // Kotlin L1551-1555：只有「改密」这条路径在设置新 PIN 成功后弹
              // `AppToast.makeText(context, "密码已更新", LENGTH_SHORT)`。
              // 首次开启隐私模式（Kotlin 的 SETUP 模式）没有这句 toast。
              if (changingPinRef.current) showToast('密码已更新');
              changingPinRef.current = false;
              changingPinOld.current = null;
            } else {
              throw new Error('密码设置失败，请重新验证原密码');
            }
          }}
          onDismiss={() => {
            // 同上：放弃这次「设置新 PIN」⇒ 改密流程未完成，清标记。
            changingPinRef.current = false;
            changingPinOld.current = null;
            setShowPinSetup(false);
            setPrivacySwitchPending(false);
          }}
        />
      ) : null}

      {showManageVerify ? (
        <PrivacyPinOverlay
          mode="verify"
          onPinVerified={async (pin) => {
            if (await getPrivacyService().verify(pin)) {
              setShowManageVerify(false);
              setShowManageWindow(true);
              return true;
            }
            return false;
          }}
          onDismiss={() => setShowManageVerify(false)}
        />
      ) : null}

      {showChangePin ? (
        <PrivacyPinOverlay
          mode="change-old"
          onPinVerified={async (pin) => {
            if (!(await getPrivacyService().verify(pin))) return false;
            changingPinOld.current = pin;
            setShowChangePin(false);
            // 接下来的「设置新 PIN」属于改密流程（Kotlin L1551-1556 的 `onPinSet`）。
            changingPinRef.current = true;
            setNewPinMode('change-new');
            setShowPinSetup(true);
            return true;
          }}
          onDismiss={() => {
            // 取消改密的**验证**步 ⇒ 后面的「设置新 PIN」不会发生，清掉标记，
            // 否则下次首次开启隐私模式会误弹「密码已更新」。
            changingPinRef.current = false;
            changingPinOld.current = null;
            setShowChangePin(false);
          }}
        />
      ) : null}

      {showDisableVerify ? (
        <PrivacyPinOverlay
          mode="verify"
          onPinVerified={async (pin) => {
            if (await getPrivacyService().disable(pin)) {
              setPrivacyModeEnabled(false);
              setShowDisableVerify(false);
              setShowManageWindow(false);
              showToast('隐私模式已关闭');
              return true;
            }
            return false;
          }}
          onDismiss={() => setShowDisableVerify(false)}
        />
      ) : null}

      {showManageWindow ? (
        <PrivacyManageOverlay
          categories={categories}
          incognitoEnabled={incognitoBrowsingEnabled}
          favoritesProtected={favoritesProtected}
          onToggleIncognito={(enabled) => {
            void getServices().settings.setBoolean('incognito_browsing_enabled', enabled).then(() => setIncognitoBrowsingEnabled(enabled))
              .catch(() => showToast('无痕设置保存失败，请重试'));
          }}
          onToggleFavoritesProtected={(enabled) => {
            void getServices().settings.setBoolean('favorites_protected', enabled).then(() => setFavoritesProtected(enabled))
              .catch(() => showToast('收藏保护设置保存失败，请重试'));
          }}
          onToggleCategoryProtected={(id, protectedFlag) => {
            void (async () => {
              const { getBookRepository } = await import('@ui/state/appStore');
              const repository = getBookRepository(); if (!repository) throw new Error('分类尚未准备好，请重试');
              await repository.setCategoryProtectedFlag(id, protectedFlag);
              useAppStore.setState((state) => ({
              categories: state.categories.map((category) =>
                category.id === id ? { ...category, isProtected: protectedFlag } : category,
              ),
              }));
            })().catch((error: unknown) => showToast(error instanceof Error ? error.message : '分类保护保存失败'));
          }}
          onChangePin={() => {
            setShowManageWindow(false);
            setShowChangePin(true);
          }}
          onDisablePrivacy={() => {
            setShowManageWindow(false);
            setShowDisableVerify(true);
          }}
          onDismiss={() => setShowManageWindow(false)}
        />
      ) : null}

      {/* ── Kotlin L1445–1451: `if (showHelpBottomSheet) { LibraryHelpBottomSheet(
            onDismissRequest = { showHelpBottomSheet = false },
            onOpenSourceManager = { onOpenSourceManager?.invoke() }) }` ──
          The real port replaced the old placeholder dialog (and its two invented
          "将在后续移植中接入" strings). `deleteStaleDownloadTemps` is left undefined,
          which is exactly the Kotlin path where the sheet has no platform IO injected —
          the 清除临时文件 action then stays inert instead of faking a deletion count. */}
      {showHelpBottomSheet ? (
        <LibraryHelpBottomSheet
          onDismissRequest={() => {
            setShowHelpBottomSheet(false);
          }}
          onOpenSourceManager={() => {
            setShowHelpBottomSheet(false);
            if (props.onOpenSourceManager !== undefined) {
              props.onOpenSourceManager();
            } else {
              setRoute('sourceManagement');
            }
          }}
        />
      ) : null}
    </div>
  );
}
