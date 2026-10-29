# 连通性审计报告（只读审计，未修改任何 `src/**` / `tests/**` / `.css`）

- 审计对象：`C:\Users\GuanXingRen\Downloads\novel-reader (1)\IOS`
- 快照时间：**2026-10-06 03:09:50**（工作树正在被其它代理并行修改，见 §9 诚实声明）
- 审计人角色：连通性审计子代理（**只读**）。本文件是本次审计唯一新增的文件。

---

## 0. 一句话结论

> **项目 447 个源文件里，只有 149 个进了产物。278 个文件 / 约 93.8k 行是"移植了、测试过、但用户在 App 里永远点不到"的死代码（占 62%）。**
> 并且这不是"忘了接线"这么简单——**绝大多数不可达文件都有同一个活着的替代品：一个在可达页面里手写的同名简化副本（stand-in）**。
> 所以现在的状态是：页面能打开，但里面是**手写半成品**，真正的逐行移植版在 `src/` 里躺着没人 import。

---

## 1. 入口定义（唯一顺序）

| # | 环节 | 文件 | 说明 |
|---|---|---|---|
| 1 | HTML 入口 | `index.html:14` | `<script type="module" src="/src/main.tsx">` |
| 2 | JS 入口 | `src/main.tsx` | `createRoot(...).render(<App/>)` + 导入 `styles/global.css`、`styles/theme.css` |
| 3 | 唯一应用根 | `src/App.tsx` | 导入 13 个页面 + `TabShell` + `appStore` + `Toast` |
| 4 | 状态根 | `src/ui/state/appStore.ts` | `useAppStore`（zustand）；`bootstrapLibrary()` 走 5 条 `await import()` 动态边 |
| 5 | 平台根 | `src/platform/index.ts` | `getPlatform()`，由 `appStore.ts:241/272/307/475` 动态 import |

**别名**（`vite.config.ts:10-15` / `tsconfig.json:23-28`）：`@`→`src`、`@core`→`src/core`、`@platform`→`src/platform`、`@ui`→`src/ui`。审计脚本已按此解析。

**动态导入必须计入**：本项目 7 条动态边全部有效（`appStore.ts` 的 `await import(...)`），已计入可达集合。

### 1.1 审计方法与自校验

审计脚本（放在系统临时目录，未污染仓库）：

1. 用 5 条正则抽取全部 `import…from` / `export…from` / `import 'x'` / `import('x')` / `require('x')` / CSS `@import`；
2. 按 Node/Vite 解析规则（精确名 → 补 `.ts`/`.tsx`/`.css` → `index.ts`）解析别名与相对路径；
3. 从 `src/main.tsx` 做 BFS。

**自校验（这一步是关键，否则结论不可信）**：把 `npx vite build` 的产物 sourcemap 里所有非 `node_modules` 模块抽出来，与脚本的可达集合做双向 diff：

```
BUILD modules (non node_modules): 149
MY reachable:                      189
=== In BUILD but NOT in my graph (my graph MISSED these) ===
（空 —— 零漏报）
=== In my graph but NOT in BUILD ===
  38 个，全部是 (a) CSS（Vite 把 CSS 合并进单个 `index-*.css`，不出现在 JS sourcemap）
            或 (b) 只被 `import type` 引用的纯类型模块（被 Rollup tree-shake）
```

**所以：脚本零漏报。多出来的 38 个是"CSS 合并"和"纯类型被摇掉"，不是脚本错。**
CSS 我另做了独立校验（§2.3）。

---

## 2. 不可达文件全表

### 2.1 总账

| 指标 | 数值 |
|---|---|
| `src/**` 文件总数（.ts/.tsx/.css） | **447** |
| 入口可达（import 图） | **189** |
| 真的进了产物 | **149** |
| **import 图不可达** | **258**（约 90.6k 行） |
| **图可达但被 tree-shake（等价于死）** | **20**（3,149 行） |
| **合计死代码** | **278 文件 / 93,760 行 / 62%** |

另有 20 个"图可达但 tree-shaken"的模块（`import type` 引入，运行时不产生任何代码）：

```
   637  src/core/god/godReaderBinding.ts        ← GodCoverCropPage.tsx:83 只 import type
   582  src/core/library/libraryBookShare.ts
   302  src/core/library/libraryImageBytes.ts
   292  src/core/download/novelTextArchive.ts
   241  src/core/source/sourceConfig.ts
   177  src/core/download/novelDownloadStore.ts
   170  src/core/parser/imageBytes.ts
   170  src/platform/interfaces.ts
    72  src/core/data/downloadTransferPolicy.ts
    69  src/core/data/archiveBudget.ts
    67  src/core/library/readingSessionTypes.ts
    65  src/core/source/searchBook.ts
    55  src/core/source/comicSource.ts
    53  src/core/data/readingSession.ts
    36  src/core/source/bookFormat.ts
    33  src/core/source/downloadInfo.ts
    32  src/core/source/comicChapter.ts
    15  src/core/source/authenticationState.ts
    72  src/core/source/bookSource.ts
     9  src/core/mascot/index.ts
```

### 2.2 按影响排序的不可达功能块（含 Kotlin 对应 + Android 入口行号 + 缺的那条接线）

排序依据：**"Android 上用户能点到，但 TS 里点不到"** 排最前。

---

#### 🔴 P0-1　书库/检索整屏（默认首页 tab 0）在真机上就是空状态

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/core/library/libraryBookShare.ts`(582)、`libraryImageBytes.ts`(302)、`readingSessionTypes.ts`(67) —— tree-shaken；`src/core/source/**` 全部 80 个文件 / 26,373 行 |
| 对应 Kotlin | `library/LibraryViewModel.kt`(L59 `SourceManager(SharedPreferencesSourceStorage(application))`、L15 `MangaDexSource`、L17 `ZLibrarySource`、L31 `KeywordRepository`)、`source/SourceManager.kt`、`source/impl/MangaDexSource.kt`、`source/zlibrary/ZLibrarySource.kt`、`ui/LibraryScreen.kt` |
| Android 入口 | `MainActivity.kt:444` `startDestination="splash"` → `:476 home` → `:500-507` tabItems → `MainActivity.kt:679` `HomeScreen`(tab1) / `LibraryScreen`(tab0)。搜索：`LibraryScreen.kt:199 onlineKeywordLookup`、`:1195-1198` 开关 |
| **缺的那条接线** | **`setLibraryRuntime()` 从来没被调用过。** 全仓库唯一调用点是它自己的注释 `libraryRuntime.ts:11`。于是 `LibraryPage.tsx:2470 getLibraryRuntime()` 恒为 `null`，走到 `LibraryPage.tsx:2940 if (runtime === null)` → 直接渲染 `MascotEmptyState`（"检索图书 / 在上方输入书名、作者或关键词"）。而 `appStore.ts:214 activeTab: 'library'` 是默认 tab ⇒ **App 一启动第一个 tab 就是这个空壳。** 搜索框打不出任何东西，因为 `SourceManager` 整棵树不可达。 |

**接线动作**：在 `appStore.ts bootstrapLibrary()` 里 `setLibraryRuntime({ viewModel: createLibraryViewModel(deps), … })`。

---

#### 🔴 P0-2　隐私 PIN 密码（设置页 + 书架页）：Android 键盘/PIN 圆点/锁定被换成一个 `<input type=password>`

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/core/privacy/privacyWindows.ts`(826)、`pinKdf.ts`(368)、`src/ui/components/privacy/PrivacyWindows.tsx`(894)、`src/styles/privacyWindows.css`(528，**未打进产物**) |
| 对应 Kotlin | `ui/privacy/PrivacyWindows.kt`(633 行) |
| Android 入口 | `SettingsTabScreen.kt:1507, 1530, 1549, 1567, 1587`（`PrivacyPinOverlay(SETUP|VERIFY|CHANGE_OLD)` + `PrivacyManageOverlay`）、`HomeScreen.kt:662, 2193` |
| 缺的那条接线 | `SettingsPage.tsx:256-263` 自己写明：Android 的四个 `PrivacyPinOverlay` 分支 → "the existing local `<PrivacyPinOverlay/>` **stand-in**"。实际代码在 `SettingsPage.tsx:929 PrivacyManageOverlay` 和 `SettingsPage.tsx:1078 PrivacyPinOverlay`，后者只是一个 `<input className="minutes-input" type="password" maxLength={6}>`。**`pinKdf.ts` 的 `derivePin`(PBKDF2, `PIN_KDF_ITERATIONS`)、`PIN_MAX_FAILURES`、`PIN_RETRY_AFTER_MS`、`PinVerifyWithLockout`、`newSaltHex` 一个都没用上** —— stand-in 通过 `onPinSet={(pin) => …}` 直接拿**明文** 6 位数字（`SettingsPage.tsx:1153`）。安全语义与 Android 不同。`HomePage.tsx` 同样有本地 `PrivacyPinOverlay` 副本。 |

---

#### 🔴 P0-3　书架多选 / 拖拽落位（长按多选、拖到分类/♡/＋新建）

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/ui/components/shelf/ShelfSelectionHost.tsx`(1,850)、`ShelfSelectionState.ts`(778)、`src/core/home/homeViewModel.ts` 里的 shelf 手势部分 |
| 对应 Kotlin | `ui/shelf/ShelfSelectionHost.kt`(1,471)、`ui/shelf/ShelfMultiSelect.kt`(670)、`ui/shelf/ShelfChips.kt`(291) |
| Android 入口 | `HomeScreen.kt:767` `ShelfSelectionHost(...)`、`HomeScreen.kt:1461` |
| 缺的那条接线 | `HomePage.tsx:2199` 注释："pointer drag host (**ShelfSelectionHost stand-in**)"。`HomePage` 只从 `@ui/components/shelf/CategoryPill` 取了 `CategoryPill` + `ShelfSelectBadge` 两个零散原语，`ShelfSelectionHost`/`ShelfSelectionState` 从未 import。多选手势逻辑（`HomePage.tsx:2235 onPointerDown`）是另写的一套简化版。 |
| 附带 | `src/ui/pages/BookshelfPage.tsx`(1,066) 是一份**重写版**书架页（含 `ShelfSegmentedTabs`/`FavoritesPanel`），`App.tsx` 从不路由到它。`HomePage.tsx:72-80` 的注释断言它"应当被删除"，但**文件还在**（1,066 行死代码）。 |

---

#### 🔴 P0-4　帮助中心（设置 → 书库使用手册）只弹 toast

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/ui/components/help/LibraryHelpBottomSheet.tsx`(272)、`FaqExpandableItem.tsx`(82)、`HelpSection.tsx`(80)、`JsonSourceGuideCard.tsx`(89)、`src/styles/help.css`(458，**未打进产物**，全仓库零 importer) |
| 对应 Kotlin | `ui/help/LibraryHelpBottomSheet.kt`(349)、`HelpSection.kt`(114)、`FaqExpandableItem.kt`(90)、`JsonSourceGuideCard.kt`(139) |
| Android 入口 | `SettingsTabScreen.kt:76` 声明、**`:1446` 真正打开** |
| 缺的那条接线 | `SettingsPage.tsx:243-246` 写明 "LibraryHelpBottomSheet → **SKIPPED** for the same reason"。实际运行代码 `SettingsPage.tsx:2308-2311`：点了只 `showToast('书库使用手册（完整面板见 LibraryHelpBottomSheet）')`。按钮在、点了没反应。 |

---

#### 🔴 P0-5　表情吉祥物动画（清缓存完成 / 书签 / 删书 / 移书）

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/core/mascot/`(3 文件 229 行)、`src/ui/components/mascot/`(5 文件 718 行)、`src/ui/components/MascotEmptyState.tsx`(221)、`src/styles/mascot.css`(105，**未打进产物**，零 importer) |
| 对应 Kotlin | `ui/mascot/BookCompleteAnimation.kt`(177)、`BookmarkHappyAnimation.kt`(151)、`DeleteSadAnimation.kt`(151)、`MoveBookAnimation.kt`(150)、`MascotAnimationController.kt`(94)、`MascotSpriteSheet.kt`(42) |
| Android 入口 | `CacheManagementScreen.kt:255, 282`（清理完成）、`ReaderScreen.kt:198, 1752`（阅读完成/书签）、`MainActivity.kt:715, 719, 1174` |
| 缺的那条接线 | `CacheManagementPage.tsx:60-61` 注释："`MascotAnimationController.play(MascotEvent.CleanComplete)` → **SKIPPED**: the `ui/mascot/**` animation subsystem has no TS port" —— **但 TS 移植版就在 `src/ui/components/mascot/` 里，718 行，只是没接线。** 注释是错的。 |

---

#### 🔴 P0-6　漫画阅读器设置面板（模式/方向/双页/裁剪/滤镜/翻译/预设/手势 8 个 Tab）

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/ui/components/comic/comicReaderChrome.tsx`(1,213)、`comic/sheets/*`(11 文件 2,432)、`comicPanelDesign.tsx`(539)、`comicReaderBackground.tsx`(477)、`comicStreamPreview.tsx`(359)、`comicChapterEdgeGesture.tsx`(311)、`src/core/comic/comicReaderSheets.ts`(970)、`src/styles/comicChrome.css`(817，**未打进产物**)、`comicSheets.css`(1,521，**未打进产物**) |
| 对应 Kotlin | `ui/comic/ComicReaderChrome.kt`、`ui/comic/ComicSettingsSheet.kt`(+8 个 tab)、`comicReaderCore/ComicReaderSheets.kt` |
| Android 入口 | `ComicReaderScreen.kt` 内 `ComicReaderChrome(...)`（对应 `ComicReaderPage.tsx:134` 注释里的 Kotlin **L694-748**），由阅读器长按/设置键呼出 |
| 缺的那条接线 | `ComicReaderPage.tsx:134` 注释："L694-748 ComicReaderChrome(...) → **本文件内的手写 Chrome**"。`ComicReaderPage.tsx:2372 function ComicReaderChrome` 是自己写的简化版，1,213 行的真移植版从不 import。结果：漫画设置面板的 CSS 一个字节都没进包。 |

---

#### 🔴 P0-7　漫画翻译（OCR / 气泡检测 / LLM 翻译 / 模型下载）整块

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/core/mangatranslate/` 全部 14 个文件 / **6,109 行** |
| 对应 Kotlin | `mangatranslate/` 12 个文件（`MangaTranslationCore.kt` 899、`PageRegionTiling.kt` 824、`TextBlockMerger.kt` 496、`MangaOcr.kt` 488、`BubbleDetector.kt` 401、`BubblePipeline.kt` 447、`TranslateModelManager.kt` 302…） |
| Android 入口 | `ComicReaderSettingsSheet` 的"翻译"tab（TS 侧对应 `ComicSettingsTranslationTab.tsx`，同样不可达） |
| 缺的那条接线 | `ComicSettingsTranslationTab.tsx` 不可达 ⇒ 翻译 tab 打不开 ⇒ `src/core/mangatranslate/**` 整棵树无人引用。**注意模型资源已经打进了包**（`dist/assets/anime4k_restore_s.json` 12KB、`anime4k_upscale_s.json` 12KB）——资源在，功能没有。 |

---

#### 🔴 P0-8　书源子系统（SourceManager / MangaDex / Z-Library / JSON 书源 / JS 书源引擎 / Venera / 关键词）

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/core/source/` 全部 **80 个文件 / 26,373 行** |
| 对应 Kotlin | `source/` 20 个文件 + `source/js/` 15 + `source/impl/` 6 + `source/zlibrary/` 13 + `source/zlibrary/parser/` 8 + `source/zlibrary/network/` 5 + `source/keyword/` 7 + `source/storage/` 2 + `source/anilist/` 2 + `source/importer/` 1 |
| Android 入口 | `MainActivity.kt:661/920/996/2951` 等 → `source_management` 路由（`MainActivity.kt:1737`）；`SourceManagementScreen.kt:118 sourceImporter`、`:303 ZLibrarySource`、`:663 PRESET_SOURCE_URLS`；`LibraryViewModel.kt:59 SourceManager` |
| 缺的那条接线 | `SourceManagementPage.tsx:70`："…are **not implemented here**"、`:111` "Z-Library…Declared, **not implemented**"。`LibraryPage.tsx:76-83` 对 `@core/source/*` **只 import type**（`BookSource`/`SearchBook`/`NovelInfo`/`BookFormat`），运行时只用到 `createLoginCredential` 和 `isComicSource/isNovelSource`。所以"书源管理"页能打开、能显示 UI 壳，但**没有真正能跑的书源引擎**。 |
| 附带 | `src/platform/web/jsSourcePlatform.ts`(921) 也在这棵树下不可达；它 `:916` 还有一句 `throw new Error('WebView 适配尚未接线（见 platform/ios-native/webView）')` —— 这是全仓库**唯一**一处显式的"未接线"抛错。 |

---

#### 🟠 P1-9　应用更新（GitHub 检查 / 下载 / 校验 / 安装）

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/core/update/` 7 文件 2,774 行 + `src/ui/components/AppUpdateDialog.tsx`(510) |
| 对应 Kotlin | `MainActivity.kt:115 AppUpdateManager`、`:83-84`、`:138-139` |
| Android 入口 | `SettingsTabScreen.kt:83-84`（检查更新入口）、`:138-139`（`AppUpdateManager` 调用） |
| 缺的那条接线 | `App.tsx` 从不 import `AppUpdateDialog`；`src/core/update/index.ts` 无 importer。设置页里"检查更新"要么没有、要么只是个 toast。 |

---

#### 🟠 P1-10　缓存管理页整屏（含存储明细弹窗）

| 项 | 内容 |
|---|---|
| 不可达状态 | **不是 import 图不可达，而是"路由死"**：`CacheManagementPage.tsx`(964) 进了包，但 `setRoute('cacheManagement')` **全仓库零调用** |
| 对应 Kotlin | `ui/CacheManagementScreen.kt`(903) |
| Android 入口 | `SettingsTabScreen.kt:1440-1443` `if (showCacheManager) { CacheManagementScreen(onBack = …) }`（**内联状态，不是 NavHost 路由**） |
| 缺的那条接线 | `SettingsPage.tsx:2244` 点了入口只 `showToast('…CacheManagementScreen')`；`SettingsPage.tsx:2599` 也承认"暂未接线"。⇒ 必须把 `setRoute('cacheManagement')` 挂到那个入口行上。 |

---

#### 🟠 P1-11　下载管理页（**且是假数据页**）

| 项 | 内容 |
|---|---|
| 不可达状态 | `DownloadManagerPage.tsx` 进了包，但 `setRoute('downloadManager')` **零调用** |
| 对应 Kotlin | **Android 没有这个界面** —— 这是 TS 侧凭空发明的（EXTRA）。Android 只有 `download/DownloadManager.kt`（Service 层，无 UI） |
| 缺的那条接线 | 两条问题：(a) 无人路由过去；(b) `DownloadManagerPage.tsx:140-257 DemoDownloadManager` 是**硬编码假数据**（`诡秘之主`、`便利店的夜班`、`HTTP 404`），`:327-333` 队列为空时就展示它并写"当前队列为空，展示示例下载任务"。 |

---

#### 🟠 P1-12　God Moment（神回）阅读端整套：随手记面板 / 星级 / 下拉 / 章节卡

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/ui/components/god/GodMomentSheet.tsx`(1,028)、`GodPull.tsx`(628)、`GodStarRatingEditable.tsx`(401)、`GodChapterCard.tsx`(272)、`src/core/god/godChapterCard.ts`(219)、`src/core/god/godPull.ts`、`src/core/god/godReaderBinding.ts`(637，tree-shaken) |
| 对应 Kotlin | `god/GodMomentSheet.kt`(1,334)、`GodPull.kt`(378)、`GodStarRating.kt`(313)、`GodChapterCard.kt`(257)、`GodReaderBinding.kt`(163) |
| Android 入口 | `GodReaderBinding.kt:112, 172`（在**阅读器里**弹 `GodMomentSheet`） |
| 缺的那条接线 | `godReaderBinding.ts` 只被 `GodCoverCropPage.tsx:83` 以 `import type` 引用 → 被 tree-shake。`GodMomentSheet` 只被 `GodMomentSheet.tsx:141` 自己 import。⇒ **整条阅读端神回链路无人 import。** |
| 连带 | `GodCoverCropPage`（631 行）+ `GodCoverCropPage.css` 也基本不可达：`setGodCropTarget()` **零调用**，所以 `App.tsx:111 if (target === null) { goBack(); return null }` 永远命中，`godCoverCrop` 路由永远返回 `null`。 |

---

#### 🟡 P2-13　翻页引擎（仿真卷页 / 页码拖动条 / 纸张配色）

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/core/pageturn/` 4 文件 626 行（`pageTurn.ts` 340、`pageScrubber.ts` 210、`paperPalette.ts` 65）；`src/ui/components/pageturn/` 4 文件 2,107 行（`PageTurnContainer.tsx` 1,050、`PageScrubber.tsx` 536、`PageCurlReaderContainer.tsx` 487、`PaperPalette.ts` 34） |
| 对应 Kotlin | `ui/pageturn/PageTurnContainer.kt`(1,129)、`PageScrubber.kt`(520)、`PageCurlReaderContainer.kt`(348)、`PaperPalette.kt`(83) + `eu.wewox.pagecurl/**`(11 文件) |
| Android 入口 | `ReaderScreen.kt:179, 193, 195, 391, 909, 911, 1960, 2500, 2504, 2553, 4135, 4145` |
| 说明 | **P0 审计期间这一项已被修复**：`ReaderPage.tsx:216-218` 现在已 import 三个容器，`:220` 也已 import `styles/pageturn.css`（构建实测 `pageturn.css` 100% 进包）。**这是我审计期间（03:0x）另一个代理的并行改动**，见 §9。 |

---

#### 🟡 P2-14　统计页三张卡片的真移植版（被页面内本地副本顶替）

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/ui/components/ReadingCalendarCard.tsx`(542)、`ReadingTrendCard.tsx`(451)、`ReadingStats.tsx`(280)、`ReadingRecordCover.tsx`(120) |
| 对应 Kotlin | `ui/StatisticsScreen.kt` L201-215、L262-275、L751-759 |
| Android 入口 | `StatisticsScreen.kt` 三个 `item(...)` |
| 缺的那条接线 | `StatisticsPage.tsx:640` "本地 ReadingCalendarCard 副本"、`:987` "本地 ReadingTrendCard 副本"、`:1276` 本地 `ReadingRecordCover`。只有 `WeeklyReadingChart.tsx`(388) 是真 import（`StatisticsPage.tsx:145`）。 |

---

#### 🟡 P2-15　书源管理页的 Z-Library 节点/登录对话框

| 项 | 内容 |
|---|---|
| 不可达文件 | `src/ui/components/source/ZLibraryNodeManagementScreen.tsx`(578→现 594)、`ZLibraryLoginDialog.tsx`(380)、`src/core/library/zLibraryNodeManager.ts`(766)、`zLibraryNativeSession.ts`(777)、`zLibraryCoverLoader.ts`(249)、`zLibraryNovelMetadata.ts`(192)、`zLibraryNodeConfig.ts`(102)、`comicFavoriteMatching.ts`(75) |
| 对应 Kotlin | `ui/source/ZLibraryNodeManagementScreen.kt`(516)、`ZLibraryLoginDialog.kt`(351)、`library/ZLibraryNodeManager.kt` |
| Android 入口 | `MainActivity.kt:1737 source_management` → `SourceManagementScreen.kt:303 ZLibrarySource` |
| 缺的那条接线 | `SourceManagementPage.tsx:188`："`ZLibraryNodeManager` **stand-in** with the Android defaults"；`:66` Z-Library 登录表单是"inlined verbatim (L699–730)"。真移植版从不 import。 |

---

#### 🟡 P2-16　其余不可达块（按目录汇总，无独立入口行号）

| 目录 | 文件数 | 行数 | 说明 |
|---|---|---|---|
| `src/core/app/` | 2 | 1,801 | `mainViewModel.ts`(1,807→现 1,735/1,807 波动) 是 Android `MainViewModel.kt` 的移植；`bootGuard.ts`(66) 无 importer |
| `src/core/data/` | 5 | 807 | `remote/appErrorInterceptor.ts`(378)、`importSafety.ts`(209)、`encryptedSecretStore.ts`(82) 等 |
| `src/core/db/` | 3 | 745 | `roomMigrations.ts`(348)、`legacyDatabaseMigration.ts`(245)、`anilistDao.ts`(152) |
| `src/core/parser/` | 7 | 2,740 | `mobiParser.ts`(830)、`epubParser.ts`(561)、`fb2Parser.ts`(438)、`docxParser.ts`(379)、`comicParser.ts`(291)、`jsonPathResolver.ts`(215) —— **EPUB/MOBI/FB2/DOCX 解析器全部不可达** |
| `src/core/ui-theme/` | 8 | 2,250 | `modifierExtensions.ts`(442)、`type.ts`(330)、`theme.ts`(281)、`color.ts`(275)、`appFonts.ts`(273)、`iosMotion.ts`(260)、`appInsets.ts`(207)、`index.ts`(182) —— **整个主题系统只经 CSS 生效，TS 侧全死** |
| `src/core/glass/` | 11 | 2,215 | `liquidGlass.ts`(438)、`motion.ts`(290)、`chasingDots.ts`(239)、`glassKit.ts`(235)、`color.ts`(208)、`adaptiveSpec.ts`(201)、`maxFx.ts`(201)、`scrollTilt.ts`(167)、`cardTweaks.ts`(100)、`renderQuality.ts`(71)、`liquidBlob.ts`(65) |
| `src/core/comic/` | 17 | 10,584 | `comicPageLoader.ts`(1,574)、`comicHarismCurl.ts`(1,518)、`comicImagePipeline.ts`(1,543)、`comicSceneFx.ts`(1,121)、`comicZoomGesture.ts`(1,113)、`anime4KCnn.ts`(344)、`anime4KCnnWeights.ts`(118)、`comicPortTypes.ts`(326)、`comicProcessedDiskCache.ts`(300)、`comicPixOps.ts`(174) 等 |
| `src/ui/components/` 其余 | 85 总 / 22,600 | — | `SettingsControls.tsx`(738，被 `SettingsPage.tsx:797` "static visual stand-in" 顶替)、`GlassCardLayers.tsx`(788)、`ColorMorph.tsx`(324，被 `SettingsPage.tsx` 本地副本顶替)、`AcrylicDialog.tsx`(237)、`PlayPauseMorph.tsx`(237)、`favorite/*`(1,376)、`god/*` 部分、`comicStreamPreview.tsx`(359) 等 |
| `src/ui/components/index.ts` | 1 | 12 | barrel 文件，**零 importer** |
| `src/ui/components/SettingsSection.tsx` | 1 | 2 | 纯 re-export `export { SettingsSection } from './SettingsRow'` |
| `src/ui/theme/appCss.ts` | 1 | 6 | 零 importer |
| `src/ui/shell/SnackbarHost.tsx` | 1 | 116 | 零 importer（`App.tsx` 不用它） |

### 2.3 CSS 单独校验（构建产物实测）

我用"每个 CSS 文件的类名在最终 `index-*.css` 里出现率"来判定是否真的进包（JS sourcemap 不含 CSS）：

| CSS 文件 | 行数 | 进包率 | 判定 | 谁 import 它 |
|---|---|---|---|---|
| `components.css` | 1,454 | 5% / 162 类 | ❌ **未进包** | **零 importer** |
| `mascot.css` | 105 | 0% / 10 类 | ❌ **未进包** | **零 importer** |
| `help.css` | 458 | 2% / 51 类 | ❌ **未进包** | **零 importer** |
| `comicSheets.css` | 1,521 | 2% / 196 类 | ❌ **未进包** | 只被不可达的 `comicSheetParts.tsx` import |
| `comicChrome.css` | 817 | 4% / 109 类 | ❌ **未进包** | 只被 4 个不可达的 comic 组件 import |
| `privacyWindows.css` | 528 | 6% / 47 类 | ❌ **未进包** | 只被不可达的 `PrivacyWindows.tsx` import |
| 其余 19 个 | — | 90–100% | ✅ 已进包 | 有可达 importer |

> **5,883 行 CSS 因为组件不可达而完全没进产物。** 这正是最初引号里那条线索的完整版：不只 5 个 CSS，是 **6 个**（多一个 `comicSheets.css` 和一个 `comicChrome.css`，漏了 `components.css` 和这两张漫画表）。

（`global.css` 显示 0% 是我检测脚本的假阴性 —— 它只用元素选择器，`.className` 计数为 0；它由 `main.tsx:4` import，实际已进包。）

---

## 3. `App.tsx` 逐条路由审计

`App.tsx:170-183` 共 **13 个路由分支**（Android `NavHost` 有 **12** 个 `composable`，见 `MainActivity.kt:450/465/476/985/1046/1091/1114/1203/1268/1568/1692/1737`）。

| # | `App.tsx` 路由 | 渲染组件 | 真的被 import? | 真的被渲染? | 有人 `setRoute` 过去? | 完整移植版还是半成品? |
|---|---|---|---|---|---|---|
| 1 | `splash` (L170) | `SplashPage` | ✅ | ✅ | 初始值 `appStore.ts:213` | ✅ 完整 |
| 2 | `onboarding` (L171) | `OnboardingPage` | ✅ | ✅ | `SplashPage.tsx:167` | ✅ 完整 |
| 3 | `main` (L172) | `MainShell` → `LibraryPage`/`HomePage`/`StatisticsPage`/`SettingsPage` | ✅ | ✅ | `SplashPage:167`、`OnboardingPage:94` | ⚠️ **默认 tab `library` 是空壳**（§2.2 P0-1）。`HomePage`(书架) 是完整版但手势被 stand-in 顶替(P0-3)；`SettingsPage` 隐私/帮助是 stand-in(P0-2/P0-4)；`StatisticsPage` 两张卡是本地副本(P2-14) |
| 4 | `reader` (L173) | `ReaderPage` | ✅ | ✅ | `LibraryPage:3319`、`HomePage:1969`、`BookshelfPage:565` | ✅ 基本完整（漫画像素解码器是注入式留空，见 `App.tsx:118-120`） |
| 5 | `comicReader` (L174) | `ComicReaderPage` | ✅ | ✅ | `HomePage:1969` | ⚠️ **Chrome/设置面板是本文件内手写副本**（`ComicReaderPage.tsx:134/2372`，P0-6） |
| 6 | `comicChapters` (L175) | `ComicChaptersPage` | ✅ | ✅ | `ComicReaderPage:2779`、`ComicReaderOnlinePage:1440/1515`、`GodRankingPage:126`、`StatisticsPage:1599` | ✅ 完整 |
| 7 | `sourceManagement` (L176) | `SourceManagementPage` | ✅ | ✅ | 6 处（`LibraryPage:2936/2959/2965/3029/3108/3168/3483`、`SettingsPage:2624`） | ❌ **空壳**：`SourceManagementPage.tsx:70/111` 自承 "not implemented"，`src/core/source/**` 26k 行全死（P0-8） |
| 8 | `downloadManager` (L177) | `DownloadManagerPage` | ✅ | ✅ | ❌ **零调用** | ❌ **死路由 + 假数据**（P1-11） |
| 9 | `novelReaderOnline` (L178) | `NovelReaderOnlinePage` | ✅ | ✅ | `ComicChaptersPage:1740/1966/2035` | ✅ 完整 |
| 10 | `comicReaderOnline` (L179) | `ComicReaderOnlinePage` | ✅ | ✅ | `ComicChaptersPage:1740/1966/2035` | ✅ 完整 |
| 11 | `godRanking` (L180) | `GodRankingPage` | ✅ | ✅ | `GodSettingsSection:224`、`StatisticsPage:1671` | ✅ 完整（`GodRankingBody`/`GodRankingShared`/`GodSettingsSection` 都在包里） |
| 12 | `godEditor` (L181) | `GodEditorPage` | ✅ | ✅ | `GodRankingPage:132`、`ComicChaptersPage:1983`（`as never` 强转）、`StatisticsPage:1605` | ✅ 完整（**但见下方类型问题**） |
| 13 | `godCoverCrop` (L182) | `GodCoverCropRoute` → `GodCoverCropPage` | ✅ | ⚠️ **永远返回 `null`** | ⚠️ `setGodCropTarget()` **零调用** ⇒ `App.tsx:111` 恒命中 ⇒ `goBack(); return null` | ❌ **事实上不可达**（P1-12） |
| 14 | `cacheManagement` (L183) | `CacheManagementPage` | ✅ | ⚠️ | ❌ **零调用** | ❌ **死路由**（P1-10） |
| — | `<Toast />` (L184) | `@ui/toast` | ✅ | ✅ | — | ✅ |

### 3.1 路由层的 3 个硬缺陷

1. **`RouteKey` 缺 `'godEditor'`** —— `appStore.ts:7-20` 的 13 个 `RouteKey` 里**没有** `'godEditor'`，但 `App.tsx:59/181` 渲染它。因此三处调用点必须强转：
   - `GodRankingPage.tsx:91` `as unknown as (…)`
   - `StatisticsPage.tsx:1585` `as unknown as (…)`
   - `ComicChaptersPage.tsx:1983` **`setRoute('godEditor' as never)`** ← 直接把非法值塞进 store，绕过类型系统。
   
   **修法**：把 `'godEditor'` 加进 `RouteKey`，删掉 3 处 `as unknown as` / `as never`（协议 §5 禁 `any`，强转虽然不是 `any` 但是同一类掩盖）。

2. **`App.tsx:57-63` 的 `AppRoute` 联合类型和 `RouteKey` 不一致** —— `AppRoute` 多出 `'godEditor' | 'downloadManager' | 'novelReaderOnline' | 'comicReaderOnline' | 'cacheManagement'`，其中后 4 个**已经在** `RouteKey` 里（重复），只有 `'godEditor'` 是新的。

3. **3 条路由（`downloadManager` / `cacheManagement` / `godCoverCrop`）是"渲染了但没人去"** —— 它们把页面代码拉进了 bundle（所以 `vite build` 看不到问题），但**运行时永远到不了**。这类"半成品"比纯不可达更隐蔽，因为它骗过了构建期检查。

---

## 4. 孤儿 export 清单

`src/**` 里导出但从未被任何 `src/**` 文件 import 的符号。我按"**整块功能的符号没人用**"筛，只列有意义的（纯工具常量如 `PI_F`、`PULLBACK_SPRING_MS` 不逐条列）。

### 4.1 整块功能级孤儿（最严重）

| 孤儿文件 | 孤儿 export 数 | 判定 |
|---|---|---|
| `src/core/privacy/pinKdf.ts` | **全部**（`PIN_LENGTH`,`PIN_KDF_ITERATIONS`,`PIN_KDF_BITS`,`PIN_SALT_BYTES`,`PIN_RETRY_AFTER_MS`,`PIN_MAX_FAILURES`,`isValidPin`,`newSaltHex`,`bytesToHex`,`hexToBytes`,`hashPinLegacy`,`derivePin`,`constantTimeEqual`,`PinStore`,`verifyPin`,`enableWithPin`,`pinLength`,`isEnabled`,`hasPin`,`changePin`,`disable`,`PRIVACY_PREFS_NAME`,`KEY_*`） | **MISSING —— 整块 PIN 密码学只有测试在用**。App 里用的是明文 `<input>`（P0-2） |
| `src/core/privacy/privacyWindows.ts` | **全部 40 个**（`PIN_ENTRY_MODE_ORDINAL`,`PIN_KEYPAD_BLANK`,`PIN_KEYPAD_BACKSPACE`,`canAppendPinDigit`,`PIN_DOTS_*`,`pinDotsShakeAmplitude`,`pinDotsShakeTargets`,`PinOverlayMetrics`,`PinFlowAction`,`PinVerifyWithLockout*`,`isPinSubmitReady` …） | **MISSING —— 键盘 / 圆点抖动 / 失败锁定全没接** |
| `src/ui/components/privacy/PrivacyWindows.tsx` | **全部**（`PrivacyPinOverlay`,`PrivacyManageOverlay`,`PIN_ENTRY_MODES`,`PIN_ERROR_*`,`PIN_KEYPAD_ROWS`,`pinDotsShakeSchedule`,`readPinLockout`,`resetPinFlow`,`settlePinFlow`,`verifyPinWithLockout` …） | **MISSING** |
| `src/ui/components/help/*` | **全部**（`LibraryHelpBottomSheet`,`HelpSection`,`FaqExpandableItem`,`JsonSourceGuideCard`） | **MISSING**（P0-4） |
| `src/ui/components/mascot/*` + `src/core/mascot/*` | **全部**（`MascotAnimationController`,`BookCompleteAnimation`,`BookmarkHappyAnimation`,`DeleteSadAnimation`,`MoveBookAnimation`,`mascotEvents`,`mascotSpriteSheet`） | **MISSING**（P0-5） |
| `src/ui/components/shelf/ShelfSelectionHost.tsx` | **全部 18 个导出**（`useShelfSelectionHost`,`ShelfSelectBadge`,`CategoryPill`,`AddCategoryPill`,`usePressScale`,`ShelfHostOverlayState`,`DragFlight*` …） | **MISSING**（P0-3） |
| `src/ui/components/god/*`（`GodMomentSheet`/`GodPull`/`GodStarRatingEditable`/`GodChapterCard`） | **全部** | **MISSING**（P1-12） |
| `src/ui/components/SettingsControls.tsx` | `PageTurnPreview`,`CustomMinutesDialog` 等全部 | **MISSING**（被 `SettingsPage.tsx:797` "static visual stand-in" 顶替） |
| `src/ui/components/ReadingCalendarCard.tsx` / `ReadingTrendCard.tsx` / `ReadingStats.tsx` / `ReadingRecordCover.tsx` | 各自组件 + 全部 helper（`HEAT_LEVELS`,`dailySeries`,`monthlySeries`,`streakEndingAt`,`longestStreakIn`,`formatReadDuration` …） | **MISSING**（P2-14） |
| `src/ui/components/GlassCardLayers.tsx` | **全部 34 个**（`glassDecoKey`,`buildIndentUnitPath`,`pressScale`,`pressLiftPx`,`glassShadowCss`,`auroraSecondary`,`prismBorderCss`,`crystalInnerBevelCss`,`cameraDistancePx`,`glassSurfaceCss`,`usePressTracking` …） | **MISSING** —— 788 行玻璃卡片渲染层完全没接 |
| `src/ui/components/LiquidGlass.tsx` / `LiquidBlob.tsx` / `LiquidGlassControls.tsx` / `MaxFx.tsx` / `MaxCardEffects.tsx` / `CardTweaks.tsx` / `ChasingDots.tsx` / `ScrollTilt.tsx` / `glasskit/GlassKit.tsx` / `adaptive/AdaptiveSpec.tsx` / `feedback/Motion.tsx` | 全部 | **MISSING** —— 整个"液态玻璃"视觉子系统（`src/core/glass/**` 2,215 行 + 对应 11 个组件）只以 orphan export 形式存在 |
| `src/core/ui-theme/index.ts` | **全部 70 个**（`READER_PRESETS`,`resolveMintPrimary`,`TYPOGRAPHY`,`SPRING*`,`easingCss`,`appInsetsPaddingBottomCss`,`BASE_SECONDARY_COLORS`,`lightColorScheme`,`darkColorScheme`,`themeColorTransitionCss`,`readingFontFamily`,`assertReadingFontIds` …） | **MISSING** —— 主题只有 CSS 生效 |
| `src/core/update/index.ts` + `appUpdateManager.ts` + `githubUpdateChecker.ts` + `appUpdateStore.ts` | **全部**（`getAppUpdateManager`,`resetAppUpdateManager`,`GithubUpdateChecker`,`classifyFailure`,`AppUpdateStore` …） | **MISSING**（P1-9） |
| `src/ui/components/index.ts` | barrel 全部 re-export | **零 importer 的 barrel** —— 说明组件包根本没有统一出口 |

### 4.2 "只被测试调用、src 里没人用"的高价值符号（单个符号级）

这些是最隐蔽的一类：**测试绿，但生产代码从来不调**。

| 符号 | 文件 | 含义 |
|---|---|---|
| `setGodCropTarget` / `takeGodCropResult` | `appStore.ts:36 / 54` | God 封面裁剪入口信号 —— **零调用**（P1-12） |
| `setLibraryRuntime` / `createLibraryViewModel` | `libraryRuntime.ts:51 / 60` | 书库整屏的接线闸门 —— **零调用**（P0-1） |
| `resetLibraryBootstrapForTest`, `setBookRepository`, `bookFromRow` | `appStore.ts:500/102/115` | 仅测试用 |
| `NAV_INTENTS`, `ROUTES`, `comicJump`, `sanitizeFileName`, `isChapterDownloadedLocally`, `formatShelfBytes`, `BOOT_GUARD_MAX_CRASHES`, `NAV_FADE_MS` | `src/core/app/navigation.ts`（仅 `ROUTES`/`TAB_ITEMS` 被 `TabShell.tsx:16` 用） | 其余全 orphan |
| `godBindingOpenEdit`, `godBindingEnabled`, `GodReaderBinding`, `createGodReaderBinding`, `godPageHeaders` | `godReaderBinding.ts` | 阅读端神回入口 —— **零调用** |
| `performDownloadTask`, `runDownloadWorker`, `DownloadWorkerResult` | `downloadWorker.ts` | 798 行下载执行器 —— **零调用** |
| `validateWithLockout` 族 / `PinVerifyWithLockout*` | `privacyWindows.ts` | 见 4.1 |
| `readingFontFamilies`, `assertReadingFontIds`, `NOTO_SANS_SC_FACES` | `appFonts.ts` | 字体栈 —— 字体资源在包里，TS 侧没注册 |
| `getAppUpdateManager` | `appUpdateManager.ts` | 见 4.1 |
| `importBatchFromUrl`, `importFromUri`, `importBatchFromUri`, `PRESET_SOURCE_URLS`, `parseBatch` | `importer/sourceImporter.ts` | 书源批量导入 —— **零调用**（P0-8） |

---

## 5. 空组件 / TODO / throw not-implemented 清单

### 5.1 `throw new Error('…未接线…')` —— 全仓库只有 1 处

| 位置 | 原文 | 对应 Kotlin | 判定 |
|---|---|---|---|
| `src/platform/web/jsSourcePlatform.ts:916` | `throw new Error('WebView 适配尚未接线（见 platform/ios-native/webView）')` | Android `WebView` + `cfWebViewSolver` 是真实现（`source/js/cfWebViewSolver.kt` 341 行已移植） | **该实现**（P0-8）。这是全仓库唯一诚实的"未接线"标记 ironically 被埋在 921 行不可达文件里 |

> 其余约 240 处 `throw new Error` 全是**参数校验 / 状态机断言**（如 `backupArchive.ts:69`、`ruleBudget.ts:8`、`mobiParser.ts:305`），**合理豁免**，不是 stub。

### 5.2 `showToast('…暂未接线…')` —— 6 处，全是半成品占位

| 位置 | 原文（UTF-8） | 对应 Kotlin 行号 | 判定 |
|---|---|---|---|
| `SettingsPage.tsx:2244` | `showToast('…CacheManagementScreen')` | `SettingsTabScreen.kt:1440-1443` | **该实现**（P1-10）—— 整屏已做好，只差 `setRoute('cacheManagement')` 一行 |
| `SettingsPage.tsx:2310` | `showToast('书库使用手册（完整面板见 LibraryHelpBottomSheet）')` | `SettingsTabScreen.kt:1446` | **该实现**（P0-4）—— 272 行组件已做好 |
| `SettingsPage.tsx:2599` | `'…帮助中心（LibraryHelpBottomSheet）暂未接线。'` | 同上 | 同上 |
| `SettingsPage.tsx:2560` 附近 | Z-Library 节点"暂未接线"文案 | `ZLibraryNodeManagementScreen.kt` | **该实现**（P2-15） |
| `LibraryPage.tsx:2891` | `showToast(next ? '已加入我喜欢的：…' : '已取消喜欢：…')` | `LibraryScreen.kt:190 onToggleFavorite` | **该实现** —— `runtime.onToggleFavorite` 未注入时的降级 |
| `DownloadManagerPage.tsx:180/187/193/300/305/310` | 硬编码假数据的 toast | Android **无此界面** | **该删**（P1-11，EXTRA） |

### 5.3 注释里自承的 "SKIPPED / stand-in / 本文件内手写" —— 14 处，全部是"该实现"

这些是**代码自己承认**的半成品，我逐条给出 Kotlin 行号：

| 位置 | 注释内容 | 对应 Kotlin | 判定 |
|---|---|---|---|
| `ComicReaderPage.tsx:134` | `L694-748 ComicReaderChrome(...) → 本文件内的手写 Chrome` | `ComicReaderScreen.kt:694-748` | **该实现**（1,213 行真移植版闲置） |
| `SettingsPage.tsx:257-258` | `PrivacyPinOverlay(SETUP|VERIFY|CHANGE_OLD) → 本地 stand-in` | `SettingsTabScreen.kt:1507-1563` | **该实现** |
| `SettingsPage.tsx:259-260` | `PrivacyManageOverlay → 本地 stand-in` | `SettingsTabScreen.kt:1566-1583` | **该实现** |
| `SettingsPage.tsx:261-263` | `CHANGE_OLD + changePinOld → stand-in 的两步；changePinOld 本身被丢弃` | `SettingsTabScreen.kt:1548-1562` | **该实现**（`CHANGE_OLD` 模式在 App 里**根本进不去**） |
| `SettingsPage.tsx:243-246` | `LibraryHelpBottomSheet → SKIPPED` | `SettingsTabScreen.kt:1445-1451` | **该实现** |
| `SettingsPage.tsx:239-242` | `CacheManagementScreen → SKIPPED` | `SettingsTabScreen.kt:1440-1443` | **该实现** |
| `SettingsPage.tsx:797` | `PageTurnPreview → SettingsControls.kt:605-742（static visual stand-in）` | `SettingsControls.kt:605-742` | **该实现**（738 行真移植版闲置） |
| `SettingsPage.tsx:701` | `SettingsSlider → FluidSlider stand-in` | `SettingsControls.kt` | 合理豁免（第三方库，Android 有 `ramotion/fluidslider`） |
| `HomePage.tsx:2199` | `pointer drag host (ShelfSelectionHost stand-in)` | `HomeScreen.kt:767` | **该实现**（1,850 行真移植版闲置） |
| `SourceManagementPage.tsx:70` | 书源管理部分 "are not implemented here" | `SourceManagementScreen.kt` | **该实现**（26k 行闲置） |
| `SourceManagementPage.tsx:111` | Z-Library `Declared, not implemented` | `SourceManagementScreen.kt:303` | **该实现** |
| `SourceManagementPage.tsx:188` | `ZLibraryNodeManager stand-in` | `library/ZLibraryNodeManager.kt` | **该实现** |
| `CacheManagementPage.tsx:60-61` | `MascotAnimationController.play(CleanComplete) → SKIPPED：ui/mascot/** 没有 TS 移植版` | `CacheManagementScreen.kt:255, 282` | **该实现** —— **注释是错的**，718 行 TS 移植版就在 `src/ui/components/mascot/` |
| `ReaderPage.tsx:85` | `buildAnnotatedWithImages → SKIPPED` | `reader/NovelInlineImages.kt:339-406` | 合理豁免（Compose `AnnotatedString` → DOM 无等价物，须登记 `PARITY_EXCEPTIONS`） |
| `StatisticsPage.tsx:119-120` | `WeeklyReadingChart(books, recordCovers, …) → NOT forwarded` | `StatisticsScreen.kt:262-270` | **该实现**（`ReadingRecordCover` 用了本地副本） |

### 5.4 "本地副本顶替 orphan 移植版" —— 系统性模式（脚本自动检出 60+ 例）

我写脚本对比"不可达文件的导出名"与"可达文件里的本地声明名"，检出 **60+ 个**孤儿移植版被同名本地副本顶替。最关键的几例：

| 真移植版（死） | 行数 | 顶替它的本地副本在 | 组件名 |
|---|---|---|---|
| `shelf/ShelfSelectionHost.tsx` | 1,850 | `HomePage.tsx:422/476` | `MultiSelectTopBar`, `MultiSelectActionBar`, `MoreActionSheet`, `CategoryPickerSheet` |
| `privacy/PrivacyWindows.tsx` | 894 | `SettingsPage.tsx:930/1078`、`HomePage.tsx` | `PrivacyPinOverlay`, `PrivacyManageOverlay` |
| `comic/comicReaderChrome.tsx` | 1,213 | `ComicReaderPage.tsx:2372` | `ComicReaderChrome` |
| `SettingsControls.tsx` | 738 | `SettingsPage.tsx:797` | `PageTurnPreview`, `CustomMinutesDialog` |
| `ReadingCalendarCard.tsx` | 542 | `StatisticsPage.tsx:889` | `ReadingCalendarCard` |
| `ReadingTrendCard.tsx` | 451 | `StatisticsPage.tsx:989` | `ReadingTrendCard` |
| `MascotEmptyState.tsx` | 221 | `LibraryPage.tsx:2303` | `MascotEmptyState` |
| `ColorMorph.tsx` | 324 | `SettingsPage.tsx` | `ColorMorphSwatch` |
| `favorite/ChapterStatusRow.tsx` | 490 | `ComicChaptersPage.tsx`、`ReaderPage.tsx` | `BookmarkRibbon`, `ChapterVisual` |

### 5.5 没有发现的问题（阴性结论）

- ❌ **没有** `.tsx` 渲染 `<>空</>` / 只返回 `null` 的空壳组件。
- ❌ **没有** 只有 TODO 注释的 `.tsx` 文件。
- ❌ **没有** `TODO` / `FIXME` 关键字（grep 0 命中）；仓库用中文注释描述跳过点，且**都在文件头映射表里**（这一条做得对，符合协议 §16）。

---

## 6. 测试只覆盖死代码的清单

`tests/**` 共 **132 个测试文件**。其中 **48 个测试文件只 import 不可达模块**，约 **1,272 / 3,272 ≈ 39% 的测试用例在给死代码背书**。

### 6.1 纯死代码测试（import 的 100% 是不可达模块）

| 测试文件 | 约用例数 | 被测的死模块 |
|---|---|---|
| `tests/unit/mangaTranslate.test.ts` | **91** | `core/mangatranslate/**` 13 个 |
| `tests/unit/zlibraryNetwork.test.ts` | **81** | `source/zlibrary/network/*` + `zlibraryHost` 等 15 个 |
| `tests/unit/comicCurlGeometry.test.ts` | 56 | `comicHarismCurl`, `comicPortTypes`, `comicPixOps` |
| `tests/unit/shelfSelectionState.test.ts` | 50 | `shelf/ShelfSelectionState.ts` |
| `tests/unit/comicReaderSheets.test.ts` | 48 | `core/comic/comicReaderSheets.ts` |
| `tests/unit/sourceStorageSharedPreferences.test.ts` | 48 | `source/storage/*` |
| `tests/unit/comicCacheKeys.test.ts` | 47 | `comicProcessedDiskCache`, `comicPageLoader`, `comicPixOps`, `comicImagePipeline`, `comicPortTypes` |
| `tests/unit/appUpdateManager.test.ts` | 46 | `core/update/**` 7 个 |
| `tests/unit/jsSourcePlatform.test.ts` | 45 | `platform/web/jsSourcePlatform.ts` |
| `tests/unit/readingStatsCalendar.test.ts` | 45 | `ReadingCalendarCard`, `ReadingTrendCard`, `GlassCardLayers` |
| `tests/unit/comicZoomTransform.test.ts` | 41 | `comicZoomGesture`, `comicPortTypes` |
| `tests/unit/tmpPixelParity.test.ts` | 36 | comic 死模块 3 个 |
| `tests/unit/zLibraryLibrarySideSession.test.ts` | 35 | `zLibraryNativeSession`, `zLibraryNodeConfig`, `zLibraryWebViewHelper` |
| `tests/unit/importSafetyAudit.test.ts` | 33 | `core/data/importSafety.ts` |
| `tests/unit/privacyWindows.test.ts` | 33 | `privacyWindows.ts`, `pinKdf.ts` |
| `tests/unit/appUpdateStore.test.ts` | 32 | `appUpdateStore.ts`, `githubUpdateChecker.ts` |
| `tests/unit/glassTokens.test.ts` | 32 | `glass/{adaptiveSpec,cardTweaks,motion,renderQuality}` |
| `tests/unit/glassChasingDotsAndKit.test.ts` | 31 | `glass/{chasingDots,glassKit}` |
| `tests/unit/comicPageLayout.test.ts` | 29 | `comicPageLayout.ts` |
| `tests/unit/zLibraryLibrarySideCoverMetadata.test.ts` | 28 | Z-Library 7 个 |
| `tests/unit/privacyWindowsFlow.test.ts` | 25 | `privacyWindows.ts`, `pinKdf.ts` |
| `tests/unit/zlibraryPure.test.ts` | 25 | `diamWall.ts`, `zlibraryDns.ts` |
| `tests/unit/zlibraryReviewRegression.test.ts` | 24 | Z-Library 13 个 |
| `tests/unit/comicChapterEdgeGesture.test.ts` | 22 | `comicChapterEdgeGesture.ts` |
| `tests/unit/comicStreamPreview.test.ts` | 22 | `comicStreamPreview.tsx` |
| `tests/unit/zlibraryHtmlDocument.test.ts` | 22 | `zlibrary/parser/htmlDocument.ts` |
| `tests/unit/appErrorInterceptor.test.ts` | 21 | `data/remote/appErrorInterceptor.ts` |
| `tests/unit/zlibraryDiamWall.test.ts` | 21 | `diamWallInterceptor`, `encryptedCookieJar`, `zLibraryHttpClient`, `zLibraryWebViewHelper` |
| `tests/unit/comicPanelDesign.test.ts` | 19 | `comicPanelDesign.tsx` |
| `tests/unit/glassScrollTilt.test.ts` | 19 | `glass/scrollTilt.ts` |
| `tests/unit/comicLoadSupport.test.ts` | 17 | `comicLoadSupport.ts` |
| `tests/unit/comicScrollMetrics.test.ts` | 16 | `comicScrollMetrics.tsx` |
| `tests/unit/pinKdfSecurity.test.ts` | 16 | `pinKdf.ts` |
| `tests/unit/readingTimeSlicesAudit.test.ts` | 16 | `data/readingTimeSlices.ts` |
| `tests/unit/importSafety.test.ts` | 15 | `importSafety.ts` |
| `tests/unit/uiThemeType.test.ts` | 15 | `ui-theme/{appFonts,type}` |
| `tests/unit/keywordExpansionFlow.test.ts` | 13 | `keyword/{keywordExpansion,keywordModels}` |
| `tests/unit/jsonPath.test.ts` | 8 | `parser/jsonPathResolver.ts` |
| `tests/unit/veneraBridge.test.ts` | 8 | `veneraTypes`, `veneraBridge` |
| `tests/unit/pinKdf.test.ts` | 7 | `pinKdf.ts` |
| `tests/unit/splitHtmlIntoChapters.test.ts` | 7 | `parser/mobiParser.ts` |
| `tests/unit/epubParser.test.ts` | 6 | `parser/epubParser.ts` |
| `tests/unit/veneraWorker.test.ts` | 6 | `veneraWorker`, `veneraTypes` |
| `tests/unit/naturalOrder.test.ts` | 4 | `data/naturalOrderCompare.ts` |
| `tests/unit/tmpDbg.test.ts` | 4 | 2 个死模块 |
| `tests/parity/pinKdfParity.test.ts` | 3 | `pinKdf.ts` |
| `tests/unit/mobiParser.test.ts` | 3 | `parser/mobiParser.ts` |
| `tests/unit/tmpKeyCheck.test.ts` | 1 | `comicPixOps`, `comicPageLoader` |
| `tests/unit/_scratch_net.test.ts` | 1 | `source/networkCalls.ts` |

### 6.2 混合测试（大部分 import 是死模块）

| 测试文件 | 约用例 | 死/活 import 数 |
|---|---|---|
| `tests/unit/jsSourceRepo.test.ts` | 68 | 13 / 1 |
| `tests/unit/zlibraryLayoutParsers.test.ts` | 43 | 11 / 1 |
| `tests/unit/sourceModulesPort.test.ts` | 47 | 8 / 1 |
| `tests/unit/zlibrarySource.test.ts` | 50 | 6 / 3 |
| `tests/unit/sourceContractPin.test.ts` | 80 | 4 / 14 |
| `tests/unit/zLibraryLibrarySideNodeManager.test.ts` | 49 | 4 / 1 |
| `tests/unit/appUpdateDownload.test.ts` | 33 | 3 / 1 |
| `tests/unit/roomMigrations.test.ts` | 25 | 3 / 2 |
| `tests/unit/uiThemeMotion.test.ts` | 28 | 3 / 2 |
| `tests/unit/uiThemeTheme.test.ts` | 28 | 3 / 3 |
| `tests/unit/mascotOverlay.test.tsx` | 8 | 5 / 2 |
| `tests/unit/appUpdateChecker.test.ts` | 48 | 1 / 1 |
| `tests/unit/comicConfig.test.ts` | 63 | 1 / 1 |
| `tests/unit/comicSceneParticles.test.ts` | 43 | 1 / 1 |
| `tests/unit/mainViewModel.test.ts` | 68 | 1 / 3（`mainViewModel.ts` 死） |
| `tests/unit/audioPlayers.test.ts` | 5 | 1 / 1 |
| 另有 ~15 个 | — | 各 1 个死 import |

### 6.3 顺带发现：疑似遗留的临时测试文件

`tests/unit/tmpDbg.test.ts`、`tests/unit/tmpKeyCheck.test.ts`、`tests/unit/tmpPixelParity.test.ts`、`tests/unit/_scratch_net.test.ts`、`IOS/.tmp_guide.ts`、`IOS/.tmp_guide.txt` —— 名字带 `tmp` / `_scratch`，应清理。

---

## 7. 建议的接线顺序（可并行，互不冲突）

我按**改动文件集合互不相交**分组。同一组内可并行派多个代理；组与组之间建议按序号推进（后面的组依赖前面的组建好的 seam）。

### 组 0 —— 零风险，先做（只改 `src/App.tsx` + `src/ui/state/appStore.ts`）

| # | 动作 | 涉及文件 | 阻塞谁 |
|---|---|---|---|
| 0.1 | `RouteKey` 加 `'godEditor'`；删 `App.tsx:104`、`GodRankingPage.tsx:91`、`StatisticsPage.tsx:1585` 的 `as unknown as`，删 `ComicChaptersPage.tsx:1983` 的 `as never` | `appStore.ts`、`App.tsx`、`GodRankingPage.tsx`、`StatisticsPage.tsx`、`ComicChaptersPage.tsx` | 组 1 的类型基础 |
| 0.2 | 在 `bootstrapLibrary()` 里 `setLibraryRuntime({ viewModel: createLibraryViewModel(deps) })` —— **一行改动点亮默认首页 tab** | `appStore.ts`、`libraryRuntime.ts`（只加 import） | P0-1；**必须先做，因为它会激活大量下游代码** |

> ⚠️ 0.2 有风险：一旦 `runtime !== null`，`LibraryPage` 会走真实分支，可能暴露 `libraryViewModel` 里对不可达 `src/core/source/**` 的引用。**先做 0.2 的 dry-run（tsc + 单跑 LibraryPage 测试），再决定是否连带组 6。**

### 组 1 —— 删死路由（只改 3 个文件，纯删除）

| # | 动作 | 涉及文件 |
|---|---|---|
| 1.1 | **删掉 `DownloadManagerPage.tsx` 整页**（Android 无此界面 + 全是假数据）并删 `App.tsx:30,177` | `DownloadManagerPage.tsx`(删)、`App.tsx` |
| 1.2 | `App.tsx` 删 `cacheManagement` 分支前，先按组 2 接好；否则先删 | `App.tsx` |

> 1.1 与 1.2 都改 `App.tsx`，**必须串行**。建议合并成一个代理做。

### 组 2 —— 三条死路由接上真页面（各自独立，可 3 个代理并行）

| # | 动作 | 涉及文件 | Kotlin 依据 |
|---|---|---|---|
| 2.1 | `SettingsPage.tsx:2244` 的 toast → `setRoute('cacheManagement')`；`CacheManagementPage` 已有 `onBack`（`:527`） | `SettingsPage.tsx` 单文件 | `SettingsTabScreen.kt:1440-1443` |
| 2.2 | `setGodCropTarget` 真正接线：`GodEditorPage`（或 `GodMomentSheet`）填 target → `setRoute('godCoverCrop')` | `GodEditorPage.tsx`、`GodRankingPage.tsx` | `GodMomentSheet.kt:588-598 showCrop` → `GodCoverCropScreen.kt` |
| 2.3 | `AppUpdateDialog.tsx` 接到 `SettingsPage` 的"检查更新"入口；`SettingsPage.tsx:83` 的 toast → 真检查 | `SettingsPage.tsx`、`AppUpdateDialog.tsx`、`core/update/index.ts` | `SettingsTabScreen.kt:83-84, 138-139`；`MainActivity.kt:115` |

### 组 3 —— 手写副本换回真移植版（**4 个代理并行，文件集合完全不重叠**）

| # | 代理 | 动作 | 只碰这些文件 | Kotlin 依据 |
|---|---|---|---|---|
| 3.1 | **隐私 PIN** | 删 `SettingsPage.tsx:930/1078` 的本地 `PrivacyManageOverlay`/`PrivacyPinOverlay`；改 import 为 `@ui/components/privacy/PrivacyWindows` + `@core/privacy/{privacyWindows,pinKdf}`；补 `CHANGE_OLD` 分支 | `SettingsPage.tsx`、`HomePage.tsx` | `SettingsTabScreen.kt:1507-1583`；`HomeScreen.kt:662,2193` |
| 3.2 | **书架手势** | 删 `HomePage.tsx:422/476` 及 `:2199` 的 drag host；改用 `ShelfSelectionHost.tsx` + `ShelfSelectionState.ts` | `HomePage.tsx` | `HomeScreen.kt:767`；`ShelfSelectionHost.kt` |
| 3.3 | **漫画 Chrome** | 删 `ComicReaderPage.tsx:2372` 的本地 `ComicReaderChrome`；改 import `@ui/components/comic/comicReaderChrome` + `comic/sheets/*`；接翻译 tab | `ComicReaderPage.tsx` | `ComicReaderScreen.kt:694-748` |
| 3.4 | **统计卡 + 设置控件 + 吉祥物** | 删 `StatisticsPage.tsx:889/989/1276` 本地副本改用真组件；删 `SettingsPage.tsx:797` `PageTurnPreview` stand-in 改用 `SettingsControls.tsx`；接 `MascotAnimationController` 到 `CacheManagementPage` | `StatisticsPage.tsx`、`SettingsPage.tsx`、`CacheManagementPage.tsx` | `StatisticsScreen.kt:201-275/751-759`；`SettingsControls.kt:605-742`；`CacheManagementScreen.kt:255,282`；`ReaderScreen.kt:198,1752` |

> 3.1 / 3.3 都会让对应 CSS（`privacyWindows.css` 528 行 / `comicChrome.css` 817 + `comicSheets.css` 1,521 行）**自动进包**——不需要单独动 CSS。
> 3.1 和 3.2 都改 `HomePage.tsx`？**不** —— 3.1 只改 `HomePage.tsx` 的 `PrivacyPinOverlay` 一处。若要彻底并行，把 3.1 拆成 3.1a（`SettingsPage.tsx`）和 3.1b（`HomePage.tsx`），3.1b 与 3.2 同文件 → **必须串行**。建议：**3.2 先做，3.1b 后做**。

### 组 4 —— 帮助中心（1 个代理）

| # | 动作 | 只碰这些文件 |
|---|---|---|
| 4.1 | `SettingsPage.tsx:2308-2311` toast → `<LibraryHelpBottomSheet>` 真实挂载 | `SettingsPage.tsx`、`ui/components/help/*`（不改）、`styles/help.css`（不改，靠 import 自动进包） |

> 4.1 与 3.4 都改 `SettingsPage.tsx` → **与 3.4 串行**，或合并给一个代理。

### 组 5 —— 书源子系统接线（**最大最难，建议单代理专攻**）

| # | 动作 | 涉及文件 |
|---|---|---|
| 5.1 | 在 `appStore.ts bootstrapLibrary()` 里 `new SourceManager(new SharedPreferencesSourceStorage(platform.fs))` 并注册 `MangaDexSource` / `ZLibrarySource` / `AutoNovelSource`；`setLibraryRuntime` 注入 `LibraryViewModel` | `appStore.ts`、`platform/**` |
| 5.2 | `SourceManagementPage.tsx` 删 "not implemented" 注释，import `sourceViewModel.ts` / `sourceImporter.ts` / `ZLibraryLoginDialog.tsx` / `ZLibraryNodeManagementScreen.tsx` | `SourceManagementPage.tsx`、`ui/components/source/*` |
| 5.3 | `jsSourcePlatform.ts:912-919 createUnwiredWebViewFactory` 的 throw → 走 `platform/ios-native` 的 WKWebView（或在 `PARITY_EXCEPTIONS` 登记豁免） | `platform/web/jsSourcePlatform.ts`、`platform/ios-native/**` |

> 组 5 会**同时**激活 26,373 行 + 库页面真实分支 → **必须独立一个代理**，且要在组 0.2 之后。
> 建议：组 5 完成后立刻跑 `npx tsc --noEmit` + 全量 vitest，因为一次性会有上千个符号第一次真正参与类型检查。

### 组 6 —— 清理（可与组 1-5 并行，只删不加）

| # | 动作 | 文件 |
|---|---|---|
| 6.1 | 删 `src/ui/pages/BookshelfPage.tsx`（1,066 行，`App.tsx` 从不路由；`HomePage.tsx:72-80` 已论证应删） | `BookshelfPage.tsx` |
| 6.2 | 删 `tests/unit/{tmpDbg,tmpKeyCheck,tmpPixelParity,_scratch_net}.test.ts`、`IOS/.tmp_guide.{ts,txt}` | 4+2 文件 |
| 6.3 | 决定 `src/components.css`(1,454 行，零 importer)：要么接线，要么删 | — |
| 6.4 | 把 `docs/PARITY_EXCEPTIONS.md` 补上：`createUnwiredWebViewFactory` throw、`buildAnnotatedWithImages` SKIPPED、`CHANGE_OLD` 模式 | 文档 |

### 组 7 —— 防回归（**强烈建议最后做，一次性**）

| # | 动作 |
|---|---|
| 7.1 | 在 `vitest.config.ts` 或加一个 `tests/unit/reachability.test.ts`：`src/main.tsx` 的可达集合必须覆盖全部非豁免文件。白名单机制（`tests/fixtures/reachabilityAllowlist.json`），每接一块就删一条。**这样"Vite 会不会 tree-shake 掉"就变成 CI 可捕获的失败，而不是靠人肉发现。** |

---

## 8. 判定口径小结

| 类别 | 数量 | 说明 |
|---|---|---|
| Android 能点到 / TS 完全不可达（import 图） | 258 文件 / 90.6k 行 | §2.2 |
| Android 能点到 / TS 图可达但 tree-shaken | 20 文件 / 3.1k 行 | §2.1 |
| Android 能点到 / TS 渲染了但路由没人去 | 3 条路由（`downloadManager`/`cacheManagement`/`godCoverCrop`） | §3 |
| Android 能点到 / TS 有手写简化替代品 | 60+ 例（脚本检出） | §5.4 |
| 合理豁免（平台无等价物 / Android 自身死代码 / 第三方库） | 约 15 处 | §5.3 已逐条标注 |

---

## 9. 诚实声明

1. **快照会过期。** 工作树正在被并行代理修改。我的两次相邻测量之间，`src/ui/pages/HomePage.tsx` 被改过（`LastWriteTime 2026/10/6 2:49:56`），`src/` 文件总数从 445 → 447，`pageturn.css` 和 `shelf.css` 在我审计期间**从"未进包"变成"已进包"**（`ReaderPage.tsx:220` 新增了 import，`HomePage.tsx:211-214` 新增了 `shelf/CategoryPill` import）。**本报告数字对应 2026-10-06 03:09:50。** §2.2 P2-13 的"已修复"就是这么发现的。复现请重跑我的脚本（附录里有逻辑说明）。

2. **我做了 0 处 `src/**` 修改。** 唯一写入是本文件 `docs/REACHABILITY_AUDIT.md`，以及 3 个临时 JSON（`.audit-reach.json` / `.audit-orphans.json` / `.audit-tests.json`）——**这 3 个是我造成的副作用，不属于交付物，已列在这里供清理**。构建产物我输出到了系统临时目录（`%TEMP%\opencode\auditchunk2`），**没有污染仓库的 `dist/`**。`../novel-reader/` 全程只读。

3. **我没有逐个 Kotlin 文件通读。** Kotlin 侧的定位全部靠 `Select-String` 抓 import/call 关系 + 读入口行号上下文。所以我给的 Kotlin 行号是**"这个功能在 Android 侧的调用点"**，是准确的；但我没有验证每个 Kotlin 文件内部的移植质量——那是逐行审查代理的活，不是连通性审计的活。

4. **我没有验证"接上之后能不能跑"。** 我只证明了"没接"和"缺哪一条 import / 哪一个事件"。组 5 尤其如此 —— `SourceManager` 那 26k 行接上后可能有第二层问题（平台 API 缺失等），我无法预判。

5. **正则抽 import 有理论上限。** 我用 5 条正则 + 与 Vite 构建产物 sourcemap 双向 diff 自校验，**实测零漏报**。但如果将来有人在 `src/` 里引入我没想到的 import 语法（如 `export * as ns from`、`require.resolve`），脚本需要同步更新。

6. **`dynamicEdges: 7`** —— 全部来自 `appStore.ts` 的 `await import(...)`。Vite 把它们警告为 `INEFFECTIVE_DYNAMIC_IMPORT`（因为目标也被静态 import），**没有生成独立 chunk**。也就是说这些"动态导入"目前没有起到代码分割作用。

7. **CSS 进包率检测有假阴性**：`global.css` 显示 0%，因为它只用元素选择器，脚本按 `.className` 计数得 0。我人工确认它由 `main.tsx:4` import 且已进包。同理 `theme.css` 等 19 个 >90% 的文件里可能有个别类名恰好重名，但"进包/未进包"的结论对 6 个 0-6% 的文件是**可靠**的（差距太明显，不是重名噪声）。

8. **我建议的接线顺序没有考虑其它代理的当前进度。** 报告写于 03:09:50；如果有人已经接了组 0/1/2 的某项，请以代码现状为准，不要照单执行造成重复改动。

---

## 附录：复现方法

1. 从 `src/main.tsx` 做 BFS，跟随：静态 `import/export…from`、`import 'x'`、CSS `@import`、动态 `import('x')`；别名按 `vite.config.ts:10-15` 解析；路径解析顺序 = 精确名 → `.ts`/`.tsx`/`.css` → `index.*`。
2. **自校验（必做）**：`npx vite build --outDir <临时目录>`，从所有 `.js.map` 的 `sources` 抽出非 `node_modules` 条目，与 BFS 结果双向 diff。要求 "In BUILD but NOT in my graph" 为空。
3. CSS 单独验证：对每个 `src/**/*.css` 抽 `.className`（≥7 字符），在最终 `index-*.css` 里数出现率。
4. 死代码测试：`tests/**` 的每个测试文件解析其 import，若解析出的 src 目标**全部**不在可达集合 → 判为"给死代码背书"。
5. 影子副本：对每个不可达文件取导出名，与可达文件里的 `function X` / `const X` / `class X` 本地声明求交集。