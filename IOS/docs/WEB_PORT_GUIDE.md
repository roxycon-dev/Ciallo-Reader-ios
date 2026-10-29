# WEB 移植指南（Web Port Guide）

> 维护规则：每完成一个模块，更新"已落地"；每踩一个坑，更新"踩到的坑"。**没跑过的不得写已验证。**

## 已落地

### 阶段 1 脚手架
- Vite 8.3.2 + React 19.3.0 + Capacitor 8.5.2 + TS 6.0.3 + Vitest 5.0.3 + Playwright 1.63.0
- ESLint flat config（core 层禁止 React/DOM/Capacitor import）
- `src/ui/tokens.ts` + `npm run tokens` 校验（Phase-0 Android 提取值）
- Capacitor iOS 工程已生成，`IPHONEOS_DEPLOYMENT_TARGET = 16.0`
- CI：`.github/workflows/ios.yml`（ubuntu web-ci + macos-26 ios-build）
- 文档：`docs/PORT_PLAN.md` / `PARITY_EXCEPTIONS.md` / 本文档

### Core 算法层（`src/core/`）
- `privacy/pinKdf.ts` — PBKDF2-HMAC-SHA1 120k + 旧 SHA-256 升级 + 常数时间比较 + 失败冷却
- `db/schemaV12.ts` — 14 表 + 索引 + CREATE SQL + identityHash `4edcea8e99eeed709b4f4497a5cc18a0`
- `db/openDatabase.ts` — 平台 DB 打开封装
- `parser/` — ruleBudget、jsonPathResolver、legadoRule（HTML parser + CSS 子集）、charsetSniffer、htmlToText、epubParser（DRM/OPF/NCX/spine/封面）、mobiParser（PDB/EXTH/LZ77/HUFF-CDIC）、epubImageTokens、splitHtmlIntoChapters
- `data/` — naturalOrderCompare、titleNormalizer/cjkFoldMap、chapterMerger（续N 合并≤4 部分）、archiveBudget（zipSlipSafe）、splitChapterText、downloadFileValidator、downloadTransferPolicy、anilistSeeding（gzip TSV 解压 + INSERT OR IGNORE）
- `backup/` — safeSetting、settingTypes、backupArchiveFormat（NDJSON 头 `{"version":1,"schema":12}`）、backupArchive（fflate ZIP）、backupService（导出/导入编排）
- `reader/` — pagination（splitChunks/paginateChapter/LRU cache）、novelInlineImages
- `source/` — zlibraryDns（CIDR 黑名单/DoH）、diamWall（SHA256 PoW）、bookSourceTypes（parse/serialize/merge/enable/move）
- `library/` — bookTypes（Book/Chapter/ReadingProgress/Bookmark）、bookRepository（CRUD + 进度 + 书签 + 400ms debounce）
- `download/downloadQueue.ts` — 队列 + 暂停/恢复/取消/重试 + 进度事件
- `settings/settingsRepository.ts` — SQLite `app_settings` 表 + 类型化 get/set + 安全过滤
- `god/` — godTypes（GodMoment/rating 0.5-5.0/coverSource/cropParams）、godMoments（CRUD + 排序 + 编辑信标）、godMomentRepository（SQLite 持久化）、godCoverEngine（tag 序列化/裁剪参数/预览计划，纯函数移植）
- `download/downloadTaskRepository.ts` — SQLite `download_tasks` 持久化，对齐 Android `DownloadTaskDao`
- `source/veneraWorker.ts` + `veneraBridge.ts` + `veneraTypes.ts` — Venera Web Worker 集成（45s 超时守卫、消息协议、单例 bridge）
- `startup/bootstrapAnilist.ts` — AniList 种子编排（行数指纹 + 格式版本守卫，对齐 Android `AppDatabase.ensureBundledTitlesImported`）
- `audio/` — ambientAudio（循环环境音，对齐 `ComicAmbientAudio`）、pageFlipSound（2 流翻页声，对齐 `PaperFlipPlayer`）、sceneTypes（场景枚举/标签/资产映射）

### Platform 层（`src/platform/`）
- `interfaces.ts` — Database/FileSystem/HttpClient/SecureStore/TtsEngine 抽象
- `web-mock/` — inMemoryDb（含 openSchemaV12）、memorySecureStore、fetchHttpClient、memoryFileSystem、mockTts
- `ios-native/` — capacitorDb（动态 import @capacitor-community/sqlite）、capacitorHttpClient、ttsPlugin（CapacitorTtsEngine → registerPlugin('Tts')）
- `ios/App/App/Plugins/TtsPlugin.swift` — AVSpeechSynthesizer 原生插件（speak/stop/pause/resume/getVoices + 进度事件）

### UI 层（`src/ui/`）
- `tokens.ts` + `theme/tokens.ts` — DESIGN_TOKENS、COLORS、luminance、onColor、readerTheme、MOTION
- `styles/theme.css` — font-face/CSS 变量/玻璃/按钮/芯片/设置行/阅读主题类
- `components/` — GlassCard、TabScreenHeader、AppBottomTabBar、AppButton、Chips、SegmentedPillSelector、PageTurnSelectorRow、SettingsRow/Section、EmptyState、Toast
- `state/appStore.ts` — Zustand + bootstrapLibrary（DB 加载）+ 进度保存协调器 + 书签
- `pages/` — SplashPage、OnboardingPage、BookshelfPage（DB 书架）、LibraryPage（搜索）、StatisticsPage、SettingsPage（DB 持久化 + 备份导出/导入）、SourceManagementPage（源导入/启用/排序）、ReaderPage（进度/书签/分页）、ComicChaptersPage、ComicReaderPage（横向翻页+缩放）、GodRankingPage、GodEditorPage、DownloadManagerPage（队列 UI）、NovelReaderOnlinePage、ComicReaderOnlinePage
- `App.tsx` — 路由壳（含所有新页面路由）

### Tests

> 2026-10-08 实测修正：本节原先写的「85 文件 / 2085 用例全过」与真实规模不符 ——
> 全量实跑是 **167 文件 / 4227 用例**。历史基线曾有 7 个失败
> （`mobiPalmDocParity` 5 个、`comicSheetsWiring` 2 个），已逐条回到 Kotlin 源码
> 判定并修完，详见「2026-10-07 续做」。

- parity：`tests/parity`（3 文件）—— pinKdfParity、chapterMergerParity、harness
- port：`tests/port`（12 文件）—— 端口契约测试
- unit：`tests/unit`（152 文件）

### 门禁实跑

| 日期 | typecheck | lint | vitest | vite build |
|---|---|---|---|---|
| 2026-10-06（文档原记录） | ✓ 0 errors | ✓ 0 problems | ✗ **记为「2085 全过」，实为 4097 用例 / 7 失败** | ✓ |
| 2026-10-07 | ✓ 0 errors | ✓ 0 problems（`eslint src tests`） | ✓ 0 失败 | ✓ |
| 2026-10-08（最新） | ✓ 0 errors | ✓ 0 problems | ✓ **167 文件 / 4227 用例 / 0 失败** | ✓ |

门禁命令（`package.json` 的 `gates`）：

```
npx tsc --noEmit                          → 0 errors
npx eslint src tests --max-warnings=0     → 0 problems（lint 范围含 tests）
npx vitest run                            → 167 文件 / 4227 用例 / 0 失败
npx vite build                            → 成功
```

> 本机 shell 的 PATH 被 WorkBuddy shim 覆盖（`ls`/`mkdir`/`grep` 等 coreutils 全部
> `command not found`），且全量 vitest 单进程会被 OOM/SIGTERM 杀掉。实测可行的跑法：
> 用 `spawnSync` 包一层调 `node_modules/vitest/vitest.mjs`，按文件分批执行
> （`node .tmp/run-batches.mjs 0 13`）。
>
> **`vitest.config.ts` 已把 `testTimeout` 提到 20s、`maxWorkers` 限到 4、`pool: 'forks'`。**
> 原因：重数据测试（`anilistSeeding` 解压解析 94252 行、`importSafetyAudit` 读 200KB）
> 单跑都在 1.5s 内通过，但与同批 11 个 jsdom 文件并发时被饿死、超过 Vitest 默认
> 5s 误判失败。实测该配置让全量回归从 6m40s 降到 1m06s 且零失败。

**本轮实跑覆盖范围（诚实声明）**：

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx eslint src tests --max-warnings=0` | ✅ 0 problems |
| `npx vite build` | ✅ 成功 |
| **全量 vitest（167 文件，分 14 批）** | ✅ **4227 用例 / 0 失败**（无「未跑完」残留） |


Android com.example 下 200 个 Kotlin 文件已全部逐行移植，或按 E1–E39 显式登记为「有意排除 / 平台不可移植」。

### Android assets 已复制到 `IOS/public/`

| 目标 | 源文件 | 状态 |
|---|---|---|
| `public/fonts/` | `noto_sans_sc_regular.otf`（859,944 B）、`noto_serif_sc_regular.otf`（1,202,520 B） | ✅ 已复制 |
| `public/js_safety/` | `instrument.js`、`acorn.js`、`ACORN_LICENSE.txt` | ✅ 已复制 |
| `public/venera/` | `_venera_.js`、`comic_metadata.js`、`README.txt` | ✅ 已复制 |
| `public/js_extra/` | `bilimanga.js`、`pufei.js`、`vomic.js` | ✅ 已复制 |
| `public/anilist/` | `anilist_titles.tsv.gzip`（1,644,547 B，94,252 行） | ✅ 已复制 + 种子逻辑 + 启动接入 |
| `public/audio/` | 7 个场景 m4a + page_flip.m4a（ffmpeg AAC 转码） | ✅ 已转换 + 播放器接入 |
| `public/keyword/` | `keyword_ehtag.tsv.gzip`（647,255 B）、`keyword_dictionary_version.txt`（41 B）、`keyword_dictionary_notice.txt`（950 B）、`keyword_seed.tsv`（6,254 B） | ✅ 已复制（本轮补，闭合 E60 资源侧） |
| `public/mt/` | — | ❌ 不复制（E1） |

## 未做 / 待接入

- God cover 裁剪屏 + 位图合成 UI（纯函数已就绪，需 Canvas/Photo Picker）
- 真机/IPA 构建验证（需 Mac + GitHub Actions macos-26）

## 差异总览（差异的唯一真相在 `docs/PARITY_EXCEPTIONS.md`，此处只做索引）

登记表现有 **68 条**（E1–E68）。按处理优先级排：

| 优先级 | 条目 | 一句话 |
|---|---|---|
| 🔴 P0 | **E58** | 漫画阅读器 `ComicReaderChrome.kt`（741 行）+ `ComicReaderSheets.kt`（1800 行）整层**零调用方**；运行的是内联精简版，预设管理 / 手动裁边 / 目录缩略图 / 7 个设置 Tab 全部拿不到，`ComicReaderPage.tsx:2490` 直接渲染占位文案 |
| 🔴 P0 | **E59** | `source/js/JsChapterOrder.kt`（120 行章节顺序归一化）**一行未移植**，JS 漫画源分卷/降序书章节顺序会错 |
| 🔴 P0 | **E60** | `core/source/keyword/` 6 个文件全部移植但**零实例化**；`keyword_ehtag.tsv.gzip`(647 KB) 等 3 个资源 `public/` 里也没有 |
| 🟠 P1 | **E62** | 沉浸式系统栏（隐藏状态栏）未移植；`@capacitor/status-bar` 装了没用 |
| 🟠 P1 | **E65 / E67** | `@capacitor/haptics` 等 7 个 `@capacitor/*` 插件**全仓零 import**；iOS 上触感反馈实为 0 |
| 🟠 P1 | **E66 / E52** | `keep_screen_on` 是空开关：端口齐了没人调用 |
| 🟠 P1 | **E33 / E34 / E38** | 书源沙箱隔离 / AES·RSA 原生 / 内嵌 WKWebView —— 三处端口齐全但**未接线**，其中 `evaluateInWorker` 零调用方 |
| 🟡 P2 | **E55 / E57** | 夜间模式基座已通，组件级深色变体未逐文件移植 |
| 🟡 P2 | **E61** | `src/core/**` 有 6 处直接摸 DOM 全局（音频 / glass / godRankingSettings），违反 REVIEW_PROTOCOL 硬规则 3 |
| 🟡 P2 | **E12 / E13 / E14 / E15 / E16 / E63 / E64 / E68** | 备份、进度、TTS 前台服务、明文 HTTP、局部重解码等已知差异 |

**读表约定**（2026-10-06 审计写入）：

- E2、E23 已**作废**（Android 侧也没有那个行为，豁免不成立），编号保留占位不重排。
- E4/E9、E28/E47、E33/E40、E34/E41、E35/E45、E38/E42 各是同一件事的两个编号，文件末尾有「重复登记对照」表。
- 写新条目前先自问：**是不是其实已经实现了？**（E20「段落切分待实现」、E23「只有 3 种翻页模式」都是这么变成假豁免的。）

## 神回排行榜模块（2026-10-05 逐行移植完成）

| Android 源 | iOS 目标 | 说明 |
|---|---|---|
| `god/GodRankingShared.kt` | `src/ui/components/god/GodRankingShared.tsx` | GodTilt / GodCoverImage / GodItemMenu / GodEmptyState / GodRankStamp |
| `god/GodMotion.kt` | 同上（GodGold / godIsDark） | 金/银/铜调色板 + WCAG 亮度判定 |
| `god/GodStarRating.kt` | 同上（GodStarsReadonly） | 五角星路径（内半径 0.46R）+ 金渐变 clip |
| `god/GodRankingStyles.kt` | 同上（GodItemCard）+ `GodRankingBody.tsx` | 按压缩放/3D 倾斜/长按菜单/删除确认/随笔弹窗 |
| `god/GodRankingExhibits.kt` | `src/ui/components/god/GodRankingBody.tsx` | 领奖台 / 唱片架 / 照片墙三种陈列 |
| `god/GodRankingCard.kt` | 同上（GodRankingCard + GodRankingScreen） | 统计页卡片 + 全屏排行榜页 |
| `god/GodMomentModels.kt` | `src/core/god/godRankingSettings.ts` | GodRankingStyle 枚举 + 两个跳转信标 |
| `god/GodMomentSettingsStore.kt` | 同上 | ranking_style / last_page_hint / gyro_parallax（localStorage 守卫读写） |
| `god/GodSettingsSection.kt` | `src/ui/components/god/GodSettingsSection.tsx` | 设置页神回分组（风格三选一含 Canvas 示意 + 陀螺仪开关 + 入口） |
| `ui/SettingsTabScreen.kt`（神回分区） | `src/ui/pages/SettingsPage.tsx` | 插在「翻页效果」之后、「护眼与提醒」之前（与 Android item 顺序一致） |
| `ui/StatisticsScreen.kt`（L187-199） | `src/ui/pages/StatisticsPage.tsx` | GodRankingCard 插在周期总览之后、日历视图之前 |
| `MainActivity.kt`（L1046-1062） | `src/ui/pages/GodRankingPage.tsx` | onItemClick 信标跳转 + onOpenStyleSettings 信标滚动 |

样式：`src/styles/god.css`（全部 dp/sp/色值照抄 Kotlin）

## 踩到的坑

| 日期 | 坑 | 处理 |
|------|----|------|
| 2026-10-04 | `@capacitor/sqlite` 不是官方包（npm 404） | 改用 `@capacitor-community/sqlite@8.1.1` |
| 2026-10-04 | `@vitejs/plugin-react@5.1.0` peer 不含 Vite 8 | 锁定 Vite `8.3.2` + plugin-react `6.1.1` |
| 2026-10-04 | `typescript-eslint@8.71.0` peer 要求 TS `<6.1.0` | 锁定 TypeScript `6.0.3` |
| 2026-10-04 | ESLint flat config 扫描 `public/` 第三方 JS（acorn/venera/js_extra）报大量 no-undef | `eslint.config.js` ignores 加 `public/**` |
| 2026-10-04 | 正则字符类中 U+3000（表意空格）触发 `no-irregular-whitespace`；`\\u3000` 双反斜杠变成字面 `u` 字符吞掉所有 `u` | 用 `\u3000` 单反斜杠转义 |
| 2026-10-04 | React 19 `react-hooks/set-state-in-effect` / `react-hooks/refs` 新规则拒绝 effect 内同步 setState / render 中访问 ref | 用 `useState` lazy initializer 替代；异步初始化用 `setTimeout(…, 0)` 或 async callback |
| 2026-10-04 | `inMemoryDb` WHERE+params 在多行表上共享 bind cursor 导致结果错误 | 仓库层 fetch-all + JS filter 绕过；真机 Capacitor SQLite 无此问题 |
| 2026-10-04 | Vite 8 构建警告 `INEFFECTIVE_DYNAMIC_IMPORT`（Capacitor 插件静态+动态同时 import） | 非阻塞警告，功能正常，暂不处理 |
| 2026-10-04 | Windows PowerShell 通配符 `Copy-Item -LiteralPath "...\*"` 静默失败 | 改用 `Get-ChildItem -File` 逐个复制 |
| 2026-10-04 | `ffmpeg-static` npm 包安装超时（下载 ffmpeg 二进制） | 改用 `@ffmpeg-installer/ffmpeg`（成功） |
| 2026-10-04 | godMoments.ts 中 `GodMomentRepository` 仅作类型使用但用 `import` 导入 | 改为 `import type` |
| 2026-10-05 | React 19 `react-hooks/refs` 禁止渲染期读 `ref.current`；把 ref 回调当 prop 传（`tiltTarget`）会连带把整个 props 判为 ref 污染，属性访问全部报错 | 视差改为「根节点 `--god-tilt-x` CSS 变量 + 元素侧 `--god-tilt-factor`」，`calc(var(--god-tilt-x) * var(--god-tilt-factor))`；每传感器事件只写一次根变量 |
| 2026-10-05 | `useState(loader)` 泛型写死 `boolean` 会把 `GodRankingStyleCode` 误推为 boolean | 泛型显式写 `useState<GodRankingStyleCode>(getGodRankingStyle)` |
| 2026-10-05 | `setRoute('settings')` 白屏：设置页是 MainShell 里的 **tab**，不在 App.tsx 的 route 分支里 | 改用 `setTab('settings')`（排行榜「陈列方式」→ 设置页神回分区） |

## 关键对拍入口

- PIN KDF：`src/core/privacy/pinKdf.ts` ↔ Android `PrivacyManager.derivePin/hashPin`
- 建表 SQL：`src/core/db/schemaV12.ts` ↔ `app/schemas/.../12.json`
- 章节合并：`src/core/data/chapterMerger.ts` ↔ Android 章节合并逻辑（fixture 对拍）
- 自然排序：`src/core/data/naturalOrderCompare.ts` ↔ Android 排序（fixture 对拍）
- 设计令牌：`npm run tokens` ↔ Android `DesignTokens.kt`/`Color.kt`

## 平台注意

- 业务数据禁止 `localStorage` / `IndexedDB`；用 SQLite（Capacitor）或原生。
- `src/core/` 禁止 import React/DOM/Capacitor（ESLint 强制）。
- Capacitor 8 要求：Node 22+、Xcode 26+、iOS deployment target ≥15（我们定 16）。
- CI：GitHub Actions `macos-26`（默认 Xcode 26.x），workflow 中断言 `xcodebuild -version`。
- Android 原始源码只读，绝不修改；parity 导出器用 Node fallback 生成 fixtures。

## 全量模块移植表（2026-10-06 完成）

按 Android 包逐个对照。「ported」= 逐行改写；「declared」= 平台能力不可移植，
在 iOS 侧声明了注入接口 + 装配点，未接线时**显式抛错**而非静默降级。

| Android 包 | 文件数 / 体积 | iOS 目标 | 状态 |
|---|---|---|---|
| `MainActivity.kt` (121KB) + `MainViewModel.kt` (52KB) | 2 / 173KB | `src/core/app/navigation.ts` + `mainViewModel.ts` + `bootGuard.ts` + `src/ui/shell/TabShell.tsx` + `SnackbarHost.tsx` + `src/App.tsx` | ported |
| `data/`（29 文件）+ `data/remote/` | 30 / 325KB | `src/core/db/roomMigrations.ts` + `legacyDatabaseMigration.ts` + `anilistDao.ts` + `data/remote/appErrorInterceptor.ts` + 既有 `src/core/data` | ported（audit 发现 7 处真实缺口已补） |
| `data/favorite/` | 7 / 61KB | `src/core/library/favorite*.ts` + `src/ui/components/favorite/**` | ported |
| `download/` | 11 / 63KB | `src/core/download/**` | ported |
| `god/` | 18 / 240KB | `src/core/god/**` + `src/ui/components/god/**` + `src/ui/pages/GodCoverCropPage.tsx` | ported |
| `library/`（25 文件，去掉 ZLibrary\*） | 20 / 312KB | `src/ui/pages/LibraryPage.tsx` (3495) + `src/core/library/library*.ts` (12 文件) | ported（仅 `GenericCoverLoader.kt` 45 行留给 source 层） |
| `source/` + `impl/` + `importer/` + `parser/` + `keyword/` + `anilist/` | 41 / 251KB | `src/core/source/{impl,importer,keyword,anilist,parser}/` | ported |
| `source/js/` | 14 / 231KB | `src/core/source/js/` (14 文件, 7200 行) + `src/platform/web/jsSourcePlatform.ts` | ported（QuickJS 隔离差异见 E33） |
| `source/zlibrary/` | 18 / 116KB | `src/core/source/zlibrary/`（含自建 jsoup 替代 `parser/htmlDocument.ts` 897 行 + MD5） | ported |
| `ui/`（18 文件） | 18 / 742KB | `src/ui/pages/{Library,Home,Reader,ComicChapters,ComicReader,Settings,Statistics,SourceManagement,CacheManagement,Splash,Onboarding,GodRanking,GodEditor,GodCoverCrop,NovelReaderOnline,ComicReaderOnline,DownloadManager}.tsx` | ported |
| `ui/comic/` | 21 / 600KB | `src/core/comic/` (18) + `src/ui/components/comic/**` (23) + `src/styles/comic*.css` | ported（HarismCurl GL 面 / Anime4K 权重表走 declared） |
| `ui/components/` | 35 / 332KB | `src/ui/components/**` + `src/core/{glass,pageturn,mascot}/` | ported |
| `ui/shelf/` | 3 / 108KB | `src/ui/components/shelf/**` + `src/ui/pages/BookshelfPage.tsx` | ported |
| `ui/favorite/` | 7 / 83KB | `src/ui/components/favorite/**` + `src/core/favorite/favoriteUi.ts` | ported |
| `ui/source/` | 4 / 113KB | `src/ui/components/source/**` + `src/ui/pages/SourceManagementPage.tsx` | ported |
| `ui/pageturn/` + `help/` + `mascot/` + `privacy/` + `glasskit/` + `adaptive/` + `design/` + `feedback/` + `reader/` | 21 / 205KB | `src/ui/components/{pageturn,help,mascot,privacy,glasskit,adaptive,feedback}/` + `src/core/{glass,pageturn,mascot}/` | ported |
| `mangatranslate/` | 12 / 202KB | `src/core/mangatranslate/` (13 文件) | **有意排除** ONNX 推理；数据形状/常量/提示词全保留，推理入口抛 `MangaTranslateUnsupportedError` |

### App.tsx 路由表（对齐 `MainActivity.kt` 的 13 个 `composable`）

| Kotlin `composable("…")` | iOS route | 组件 |
|---|---|---|
| `splash` | `splash` | `SplashPage` |
| `onboarding` | `onboarding` | `OnboardingPage` |
| `home` | `main` | `MainShell`（4 tab：0 书库 `LibraryPage` / 1 书架 `HomePage` / 2 统计 `StatisticsPage` / 3 设置 `SettingsPage`） |
| `reader` | `reader` | `ReaderPage` |
| `comic_reader` | `comicReader` | `ComicReaderPage` |
| `comic_chapters` | `comicChapters` | `ComicChaptersPage` |
| `source_management` | `sourceManagement` | `SourceManagementPage` |
| `god_ranking` | `godRanking` | `GodRankingPage` |
| `god_editor` | `godEditor` | `GodEditorPage` |
| `cache_management` | `cacheManagement` | `CacheManagementPage` |
| `novel_reader_online` | `novelReaderOnline` | `NovelReaderOnlinePage` |
| `comic_reader_online` | `comicReaderOnline` | `ComicReaderOnlinePage` |
| （Android 独立 Activity） | `godCoverCrop` | `GodCoverCropPage`（走 `getGodCropTarget()` 信标进、回写 `takeGodCropResult()`） |

主壳 fade-through 时序（`MainActivity.kt` L646-650 的 M3 规范）：
出场 90ms 先走 → 入场 210ms 延迟 90ms 淡入，**两页永不同时可见**。
实现 `src/ui/shell/TabShell.tsx`（`TAB_FADE_OUT_MS` / `TAB_FADE_IN_MS` / `TAB_FADE_IN_DELAY_MS` 常量已单测锁定）。

启动看门狗（`MainActivity.kt` L119-140）：「极致」画质 20s 内连续 2 次崩溃 → 自动降回「高」，
存活满 20s 解除武装。纯函数在 `navigation.ts`，接线在 `bootGuard.ts`，常量/分支已单测。

提示条语义（`MainActivity.kt` L541-584 的注释原文）：
**成功 + 撤销**走 TOAST 皮肤，**绝不**渲染成红色错误卡
（用户原话：「操作总是出错，问题是操作根本没有出错」）。
分流函数 `classifyShelfMessage()`：只有含「失败」/「出错」才算 error。

## 本轮新增踩坑

| 日期 | 坑 | 处理 |
|------|----|------|
| 2026-10-06 | `appStore.ts` 在**模块加载时**自动跑 `void bootstrapLibrary()`，导致全量并行测试时别的文件先开好库，`importSampleBook`/`addCategory` 走异步分支 → 同步断言假失败（单跑该文件却通过） | 删掉模块级副作用，改由 `App` 挂载时显式调用；新增 `resetLibraryBootstrapForTest()` |
| 2026-10-06 | `SearchLocator` 导出的是**对象**（`SearchLocator.countOccurrences`）而非具名函数，照名字 import 会得到 `undefined` | 先读目标文件的 `^export` 行再写 import |
| 2026-10-06 | `PreferencesManager` 早期只移植了 getter，`MainViewModel` 接不上 11 个写路径 | 按 Android 的 `var` 属性补齐同名 setter（键名取 `SETTING_SPECS`） |
| 2026-10-06 | Kotlin `CryptoPort`/摘要全是**同步** API，WebCrypto 全部异步且**没有 MD5** | 摘要走注入的纯 TS 同步实现；AES/RSA 需原生实现，未注入时显式抛错（E34） |
| 2026-10-06 | `new Function` 只提供函数作用域，**仍能读到全局对象** —— 不能当 QuickJS 的真沙箱 | 如实标注隔离等级：同步 `evaluate` 走 inline（弱），另出 `evaluateInWorker` 走真隔离 Worker；45s tick 预算两条路径都在（E33） |
| 2026-10-06 | `JsRuntime.evaluate` 在 Kotlin 里是**同步**签名，JS 无法在同步调用里往返 Worker | 同步入口保持 inline，异步隔离路径单独暴露为一个方法 |
| 2026-10-06 | `solveSha256` 这类带 deadline 的 CPU 搜索测试，全量并行时被抢占 CPU → 默认预算误报失败（单跑通过） | 测试显式给足 `deadlineMs`，不再依赖默认值 |
| 2026-10-06 | PowerShell `> file` 是 UTF-16LE，`node JSON.parse` 直接炸；`Out-File -Encoding utf8` 又会被 CJK 源码内容污染 | 改用 `cmd /c "npx eslint … > out.json"` 拿到原始 UTF-8 |
| 2026-10-06 | `src/ui/toast.ts` 与 `toast.tsx` 并存时，`@ui/toast` 解析到旧的 `.ts`（无 options 参数）→ 报「Expected 1 arguments, but got 2」 | 删掉旧的 `toast.ts`，只留扩展后的 `toast.tsx` |
| 2026-10-06 | 全局字符串替换修类型错误时误伤了仓库 API 名（`getHighlightsForBook` → `getHighlightRowLikesForBook`） | 逐个还原；教训：批量替换前先 `console.log` 全部命中项 |
| 2026-10-06 | `bookTypes.ts` 不导出 `Highlight`（Android 里叫 `Highlight` 的实体在本项目按行存放改名 `HighlightRow`） | 在 `mainViewModel.ts` 做一次 `import type { HighlightRow as Highlight }` 别名，名字与 Android 对齐 |
| 2026-10-07 | 本机 shell 的 PATH 被 WorkBuddy shim 覆盖，`ls`/`mkdir`/`grep`/`head` 等 coreutils 全部 `command not found`；PowerShell 通道也不回显 stdout | 所有命令改用 `node -e "…require('child_process').execSync(…)"` 执行，输出写文件后用 Read 读；文件检索用 Grep/Glob 工具而非 shell |
| 2026-10-07 | 全量 `vitest run`（4097 用例）单进程跑 42 分钟后被 OOM/SIGTERM；`comicSheetsWiring` 与新写的 keyword 装配测试单跑也会被 SIGTERM | unit 测试按文件分批（每批 ~38 个文件）执行；单个 DOM 集成测试用 `-t "名称"` 过滤单跑可稳定通过 |
| 2026-10-07 | `tests/e2e/_scratch.*.mjs`、`tests/unit/tmpKeyCheck.test.ts`、根目录 14 个 `.tmp_*` 探针残留，使 `eslint tests` 报 89 个 `no-undef`（门禁原本只 lint `src`，一直掩盖着） | 删掉 22 个临时文件；把 `lint:ci` 从 `eslint src` 扩到 `eslint src tests`；`mascotOverlay.test.tsx` 的死变量 `done`（靠 `void done` 消音）改为直接删除 |

## 2026-10-07 续做（本轮）

上一轮留下 3 个 🔴 P0（E58 / E59 / E60）和一批「基线就没绿」的测试。本轮先把
**基线修绿**，再逐条推进 P0。

### 一、基线纠正：7 个失败逐条回到 Kotlin 判定

上轮文档记的是「85 文件 / 2085 用例全过」，实跑是 **155 文件 / 4097 用例 / 7 失败**。
7 个失败里有 **5 个是测试自己写错了期望值**，2 个是真实移植缺口：

| 用例 | 表面现象 | 回到 Kotlin 后的判定 | 处理 |
|---|---|---|---|
| `mobiPalmDocParity` `c >= 0xC0` 分支 | 期望 `" AV"`，实得 `" A V"` | **测试错**。Kotlin L421-425 每个扩展字节各自吐一个空格：0xc1→`' '+'A'`、0xd6→`' '+'V'`。按 Kotlin 逻辑复算确认权威值就是 `" A V"` | 改期望值 + 改注释（原文自称「手工从 Kotlin 推导」，实际推错了） |
| `mobiPalmDocParity` 重叠拷贝 | 期望 `"WXYZWXYZWX"`，实得 `"WXYZWXYZWXYZ"` | **测试错**。`match(4,8)` 的第二字节是 `0x25`，8 字节重叠拷贝正好重放两轮 WXYZ | 改期望值 |
| `mobiPalmDocParity` 0xC0 边界 | 期望 `"A @"`，实得 `"A @\t"` | **测试错**。尾部 `0x09` 是普通字面量，`decodeMobiText`（Kotlin L674-676）保留 `\t` | 改期望值 |
| `mobiPalmDocParity` multibyte 关闭 | 期望 `"BCA"`，实得 `"CDA"` | **测试错**。`multibyte=false` 时 `trimTrailing` 整段跳过（L464-469），原始字节 `02 43 44 41` 直解，前导 0x02 是控制字节被滤 | 改期望值 |
| `mobiPalmDocParity` skip-2 探测 | 期望 `"AAYZ"`，实得 `"CYZ"` | **测试错**。按 Kotlin L368-383 逐条复算（含 `scoreText` 只数可打印字节）得 `"CYZ"` | 改期望值 |
| `comicSheetsWiring` 手势 Tab | 区域标题与开关行数不符 | **真实缺口**。TS 把 Kotlin L1412-1423 的 `vertical`/`reverse` 三分支写死成「左 / 上区域」等固定文案，且丢了 `PanelHint`（L1408-1410）、「恢复默认点按动作」按钮（L1424-1427）、「侧边滑动关闭」副标题（L1435） | 按 Kotlin 重写 `ComicSettingsGestureTab.tsx`，新增 `PanelHint` 组件 + `.cmcs-hint` 样式，并补 6 组 mode/direction 的三分支回归测试 |
| `comicSheetsWiring` 手动裁边 | 保存后设置面板未回来 | **测试错**。Kotlin `ComicReaderChrome.kt:324-327` 的 `onApply` 写完配置即 `onDismissPanel()`，CROP 是 `when(panel)` 的**替换**分支，面板关闭后不会自动回来；且持久化有 250 ms 防抖（`ComicReaderCore.kt:244-251` `delay(250)`），同步断言读不到 | 改为断言 `store.loadGlobalConfig().manualCrop` 并显式等过防抖 |

判定纪律的教训：**对拍测试失败不等于实现有 bug**。这 5 个 Mobi 失败里，实现
（`decodePalmDoc` / `trimTrailing` / `decodeMobiText`）与 Kotlin 逐行一致，错的是期望值。
所以本轮对每一条都先按 Kotlin 原文复算出权威值，再决定改哪一侧。

### 二、E59：JS 漫画源章节顺序归一化（已闭合）

`source/js/JsChapterOrder.kt`（131 行 / 118 非空）**一行未移植**，唯一调用点
`JsComicSource.kt:397` 在 TS 侧直接 `return list`。

- 新增 `src/core/source/js/jsChapterOrder.ts`：`normalize` / `descending` /
  `reverseBlocks` / `clean` / `episodeNumber` / `volumeNumber` / `number` 全部逐句移植。
- 两处平台适配：`BigDecimal` → 规范化十进制**字符串**比较（复用 `@core/library/comicReadingLogic`
  已有的 `stripTrailingZeros().toPlainString()` 约定，`12`/`12.0`/`12.00` 等价）；
  `Normalizer.NFKC` → `String.prototype.normalize('NFKC')`（ECMAScript 内建，非 DOM 全局，
  与 `@core/data/titleNormalizer` 一致）。
- `json.ts` 补 `JSONObject.has()` / `isNull()`（Kotlin L373-374 的 `c.has("order") && !c.isNull("order")` 需要）。
- `jsComicSource.ts` 补 `hasExplicitOrder` 累加（原先完全缺失）并接上 `normalize`。
- 新增 `tests/unit/jsChapterOrder.test.ts`：**逐条移植 Kotlin 的 17 个 `@Test`**
  （`JsChapterOrderTest.kt`，含 `realManhuarenLilySweetheartCatalogue` 之外的 16 例）。
  16/16 通过。

### 三、E60：关键词子系统（代码侧已闭合，资源侧已补）

- **资源**：Android `app/src/main/assets/keyword_*` 四个文件复制到 `public/keyword/`
  （字节数逐个核对一致）。此前 `public/` 里一个都没有，而
  `keywordDictionary.ts:177/190` 的 `readAsset` 是必填端口 → 真机必然运行时失败。
- **代码**：六个 keyword 模块早已逐行移植，但**全仓零实例化** ——
  `LibraryViewModelDeps.keywordObserve` 永远 `undefined`。Android 的装配点是
  `LibraryViewModel.kt:413` `private val keywordRepository by lazy { KeywordRepository(app) }`。
  新增 `src/core/source/keyword/keywordAssembly.ts` 补上这个装配点
  （`createKeywordRepository` / `buildKeywordObserve`，后者保留 `by lazy` 的惰性语义）。
- 新增 `tests/unit/keywordAssembly.test.ts`：直接打**真实打包资源**
  （gunzip `keyword_ehtag.tsv.gzip` 并断言 >100 行），资源缺失会在单测里炸而不是等真机。

### 四、仍未闭合（下一轮的活）

- **E58**（🔴 P0）：`ComicReaderChrome.kt`(741 行) + `ComicReaderSheets.kt`(1800 行) 的
  整层实现都在 `ui/components/comic/` 里，但 `ComicReaderPage.tsx` 跑的是内联精简版，
  `PRESET` / `CROP` 面板在 `ComicReaderPage.tsx:2490` 仍是占位文案。本轮只修了
  `ComicSettingsGestureTab`（它在 sheets 层，被 E58 掩盖着，一并按 Kotlin 校正），
  **接线层（把 sheets 接进 ComicReaderPage）本轮未做**。
- **E81/E82**（🔴 P0）：`GodMomentSheet.tsx`（1057 行逐行移植版）零调用方，路由跑的是
  566 行重写版 `GodEditorPage.tsx`，神回编辑窗的裁剪入口完全不可达。
- E62 / E65 / E66 / E67：`@capacitor/status-bar`、`haptics`、`app`、`device`、`network`、
  `keyboard` 七个插件仍零 import；`keep_screen_on` 仍是空开关。
- E64：Info.plist 缺 `NSAppTransportSecurity`，明文 HTTP 书源必然失败。

## 新增对拍入口

- 导航图：`src/core/app/navigation.ts` ↔ `MainActivity.kt` L442-449 + 全部 23 处 `navigate()`
- 主壳：`src/ui/shell/TabShell.tsx` ↔ `MainActivity.kt` L500-507 / L638-653
- 提示条：`src/ui/shell/SnackbarHost.tsx` ↔ `MainActivity.kt` L541-584 / L603-629
- 全局状态：`src/core/app/mainViewModel.ts` ↔ `MainViewModel.kt`（收藏队列 / 400ms 进度防抖 / 300ms 检索防抖 / 8s 删除撤销 / 逻辑↔物理章节映射）
- JS 沙箱：`src/platform/web/jsSourcePlatform.ts` ↔ `quickjs-kt`（30 MiB / 512 KiB / 45s tick）
- 漫画卷页：`src/core/comic/comicHarismCurl.ts` ↔ `ComicHarismCurl.kt`（几何全移植，GL 面走 `CurlGL` 接口）
- 漫画缩放手势：`src/core/comic/comicZoomGesture.ts` ↔ `ComicZoomGesture.kt`（含 150/8000 dp·s⁻¹ fling 阈值、0.004 QuickZoom）
- 漫画场景特效：`src/core/comic/comicSceneFx.ts` ↔ `ComicSceneFx.kt`（7 种场景全部 step/draw 函数）
