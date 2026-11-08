# Ciallo阅读（EASYREADER）iOS 移植计划 · 阶段 0

| 项 | 值 |
|---|---|
| 状态 | 阶段 1-3 并行实施中（子代理推进） |
| Android 仓库 | `novel-reader/`（HEAD `322657b`，versionName 1.2.0，versionCode 201） |
| Android appId | `com.aistudio.novelreader.kxmpzq` |
| 新工程目录 | `IOS/`（当前仅 `docs/PORT_PLAN.md`） |
| 计划产出日 | 2026-10-04 |
| 依据 | `PROJECT_GUIDE.md` 全文通读 + Android 源码/schema/测试实查 + 外部版本查证 |

> 铁律回顾：不凭记忆写库 API；精确算法必须权威移植并用测试向量验证；没运行过不得说"已验证"；不静默砍功能（差异记 `docs/PARITY_EXCEPTIONS.md`）；阶段门槛不过不进下一阶段；CI 日志看全量；第三方依赖精确锁版本；维护 `docs/WEB_PORT_GUIDE.md`。**绝不修改 Android 现有代码。**

---

## 1. 审计结论摘要

- Android 侧是成熟完成品：Room v12（14 表，identityHash `4edcea8e99eeed709b4f4497a5cc18a0`）、97 个 JVM 测试文件（509 个 `@Test`）、完整备份/隐私/下载/书源/神回/漫画管线。
- 仓库内**几乎没有可复用的解析语料**：`app/src/test/resources` 基本是漫画图片和封面图；`RealEpubPipelineTest.kt` 引用的是开发者本机路径（不在仓库）。对拍 fixture 必须**新建导出器**产出，这是本项目最大工程风险之一。
- 外部版本查证（2026-10-04）：Capacitor 8.5.2 要求 Node 22+ / **Xcode 26.0+** / iOS Deployment Target 15.0+；GitHub `macos-15` 默认 Xcode 16.4，但已安装 26.x（需显式 `xcode-select`）；`macos-26` 已 GA 且为 `macos-latest`，默认 Xcode 26.4.1。→ **CI 可行，但必须在 workflow 里写死 Xcode 版本。**
- PBKDF2 已定位并读到实现：`PrivacyManager.kt:112-119`，`PBKDF2WithHmacSHA1` + 120_000 迭代 + 256-bit + 16 字节盐 + `pin_kdf_version=1` + 旧 SHA-256 验证后升级 + 常数时间比较 + 5 次失败冷却 30s。
- 设计令牌、玻璃参数、路由、测试文件清单、算法文件行数、assets 内容均已实查入档（见附录）。

---

## 2. Android 规格快照（唯一裁判）

### 2.1 平台与构建

| 项 | Android 值 |
|---|---|
| minSdk / compileSdk | 24 / 35 |
| Kotlin / AGP | 2.0.21 / 8.7.3 |
| Compose BOM | 2024.11.00 |
| namespace | `com.example` |

### 2.2 关键依赖（`libs.versions.toml` 实查）

| 依赖 | 版本 | iOS 对应策略（见第 5 节） |
|---|---|---|
| Room | 2.6.1 | Capacitor SQLite（schema 12 原样） |
| OkHttp | 4.12.0 | 原生 HTTP 插件 |
| Cronet | 119.6045.31 | 原生 HTTP 插件（HTTP/3 不保证一致，记例外） |
| WorkManager | 2.9.1 | core 下载状态机 + URLSession 后台任务 |
| Jsoup | 1.18.3 | parse5 / 自研 DOM（对拍验证） |
| Coil | 2.7.0 | 自研图片加载器 |
| Moshi | 1.15.2 | JSON.parse + 手写序列化层（对拍） |
| QuickJS | 1.0.0-alpha13 | Web Worker + 官方 `_venera_.js` |
| DataStore / SharedPreferences | 1.1.1 | SQLite 设置表 / 原生（不用 localStorage） |
| security-crypto | 1.0.0 | Keychain |
| Brotli | 0.1.2 | brotli-wasm 或 fflate |
| Haze | 1.1.1 | `backdrop-filter` |
| liquidglass | 1.0.0 | CSS / WebGL 近似 |
| pagecurl（harism + wewox） | — | Canvas / WebGL 近似，像素差异记录 |
| ONNX / manga-translate | — | **不移植** |
| splashscreen | 1.0.1 | 原生启动屏 / Capacitor Splash |
| roborazzi | 1.36.0 | iOS 不用（用 Playwright 视觉对拍） |

### 2.3 导航路由（`MainActivity.kt` 实查）

`splash` → `onboarding` → `home`（底部 4 Tab：书库 / 书架 / 统计 / 设置）；独立路由：`settings`、`god_ranking`、`god_editor`、`reader`、`comic_reader`、`comic_chapters`、`comic_reader_online`、`novel_reader_online`、`source_management`。

### 2.4 设计令牌（`DesignTokens.kt` / `Color.kt` / `IosMotion.kt` 实查）

| 类别 | 值 |
|---|---|
| 圆角 | 8 / 12 / 16 / 20 / 24 dp |
| 间距 | 4 / 8 / 12 / 16 / 20 / 24 |
| 阴影 | CardElevation 2dp，FloatingElevation 8dp |
| 主色 | MintPrimary（动态） |
| 语义色 | MintGold `#E8C97A`，DarkCharcoal `#18191C`，MediumGray `#61666D`，DividerGray `#E3E5E7` |
| 阅读主题 | Sepia `#FBF0D9`/`#5F4B32`，EyeGreen `#E8F5E9`/`#1B5E20`，Night `#18191C`/`#D4D4D4`，Oled `#000000`/`#E0E0E0` |
| 玻璃 | Tab 栏 blur 8dp / surface alpha 0.45；GlassCard blur 24dp / alpha 0.78 |
| Tab 指示条 | 顶部 3dp 竖条，宽度 40% |
| 字体 | `noto_sans_sc_regular.otf`、`noto_serif_sc_regular.otf`（必须打包内置） |
| 动效 | `IosMotion.kt` spring 参数（damping 0.85 / stiffness 320 等）直接参考 |
| 神回 | gold/silver/bronze 参数在 `GodMotion.kt`，生成脚本提取 |
| 源管理 | 参数在 `SourceManagementScreen`（PROJECT_GUIDE 第 14.1 节） |

### 2.5 隐私 PIN（`PrivacyManager.kt` 122 行全文实读）

| 项 | 实现 |
|---|---|
| PIN 格式 | 6 位数字（`PIN_LENGTH=6`） |
| 盐 | 16 字节 `SecureRandom` → 32 位 hex（`newSaltHex`） |
| 现代 KDF | `PBKDF2WithHmacSHA1`，`PBEKeySpec(pin, saltBytes, 120_000, 256)`，`pin_kdf_version=1` |
| 旧版 KDF | `SHA-256(salt \|\| pin)` hex（`hashPin`），验证成功后自动升级写回 |
| 比较 | 常数时间 OR 比较 |
| 失败冷却 | ≥5 次失败 → 30_000ms 内 `verifyPin` 直接 false（`pin_retry_after`） |
| 存储键 | `privacy_mode_enabled`、`privacy_pin_hash`、`privacy_pin_salt`、`pin_kdf_version`、`pin_failures`、`pin_retry_after`，SharedPreferences 名 `privacy_prefs` |
| 关闭语义 | 分类 `isProtected` 保留在 DB，仅开关关闭期间不生效 |
| 无痕判定 | 由 MainViewModel 判定："隐私模式开启 且 书籍所在分类受保护" |

**iOS 实现要求**：Web Crypto `PBKDF2` 算法选 `SHA-1`（与 `PBKDF2WithHmacSHA1` 一致），iterations 120000，length 256，salt hex 解码后传入；兼容旧 SHA-256 路径并升级；存储放 Keychain 或 SQLite（不用 localStorage）；UI 线程外计算。

### 2.6 Room v12 数据模型（schema 12.json 实查）

identityHash `4edcea8e99eeed709b4f4497a5cc18a0`，version 12，**全部 14 表无外键**。

| 表 | PK | 列 | 索引 |
|---|---|---|---|
| books | id (auto) | id, title, author, filePath, coverUri, category, currentChapterIndex, scrollOffset, isFinished, totalChapters, contentType, addedTime, lastReadTime, sourceId, comicId | — |
| chapters | id (auto) | id, bookId, chapterOrder, title, content, startCharIndex, endCharIndex | —（content 校验 ≤256_000） |
| bookmarks | id (auto) | id, bookId, chapterIndex, scrollOffset, title, snippet, createdTime | UNIQUE(bookId, chapterIndex) |
| highlights | id (auto) | id, bookId, chapterIndex, selectedText, note, colorHex, createdTime | — |
| categories | id (auto) | id, name, isProtected | — |
| reading_records | id (auto) | id, bookId, bookTitle, dateStr, durationSeconds | — |
| reading_sessions | id (auto) | id, bookId, bookTitle, dateStr, startTimeMs, endTimeMs, durationSeconds, startHour | — |
| download_tasks | id (TEXT) | id, sourceId, title, author, coverUrl, downloadUrl, format, status, downloadedBytes, totalBytes, filePath, errorMessage, updatedAt | — |
| anilist_titles | rowId (auto) | rowId, mediaId, titleType, rawTitle, normalizedTitle, compactTitle | idx normalizedTitle；idx compactTitle；UNIQUE(mediaId,titleType,rawTitle) |
| favorites | (sourceId, comicId) | sourceId, comicId, title, author, coverUrl, localThumbPath, serialStatus, latestChapterId, latestChapterTitle, latestChapterUpdateAt, lastCheckedAt, sourceAlive, categoryName, favoritedAt, sortOrder | idx categoryName；favoritedAt；lastCheckedAt |
| comic_progress | (sourceId, comicId) | sourceId, comicId, lastChapterId, lastChapterIndex, lastPageIndex, lastPageCount, lastReadAt, seenTopChapterId, seenChapterCount | idx lastReadAt |
| comic_chapter_read | (sourceId, comicId, chapterId) | sourceId, comicId, chapterId, status, pageIndex, pageCount, chapterIndex, updatedAt, bookmarked | idx (sourceId, comicId) |
| favorite_categories | (name) | name, sortOrder, createdAt | — |
| god_moments | id (auto) | id, contentType, bookId, chapterId, bookTitle, chapterTitle, chapterNumber, title, titleIsCustom, rating, note, coverPath, coverSource, cropParams, createdAt, updatedAt | UNIQUE(bookId, chapterId)；rating；createdAt |

**备份范围**：只含上述 12 表（**不含** `download_tasks`、`anilist_titles`）+ 设置 + 私有原书 + 图片 + 神回封面目录。排除凭据 / 模型 / 活跃下载 / 认证信息。格式：流式 ZIP / NDJSON，恢复先提取校验再事务替换。

**对拍要求**：建表 SQL、索引、`identityHash` 必须逐字节对齐；恢复 Android 备份到 iOS 应能打开，反之亦然。

### 2.7 核心算法文件（定位 + 行数）

| 文件 | 行数 | 用途 |
|---|---|---|
| `source/parser/LegadoRule.kt` | 291 | 阅读规则 |
| `source/parser/JsonPathResolver.kt` | 183 | JSONPath 解析 |
| `source/zlibrary/DiamWallInterceptor.kt` | 233 | PoW 拦截 |
| `source/zlibrary/network/ZLibraryDns.kt` | 310 | DNS-SNI |
| `data/PrivacyManager.kt` | 122 | PIN（见 2.5） |
| `data/ChapterMerger.kt` | 81 | 章节合并 |
| `data/BackupArchive.kt` | 202 | 备份/恢复 |
| `ui/ReaderPagination.kt` | 353 | 阅读分页 |
| `ComicImagePipeline.kt` | 1239 | 漫画图片管线 |
| `SourceManagementScreen` 相关 | — | 源管理视觉 |

其余精确算法（须逐个移植并测试向量验证）：MobiParser（PalmDOC LZ77 + HUFF/CDIC + KF8 BOUNDARY）、EpubParser（BOM→声明→UTF-8→GBK 检测、HTML→纯文本、封面三级兜底）、JsSourceEngine + Acorn AST 45s guard、ComicReadingLogic、TitleNormalizer/CjkFoldMap、ReadingTimeSlices、SearchLocator、DownloadFileValidator、CharsetSniffer、naturalOrderCompare、fadeCancelOffset。

### 2.8 assets（复制来源）

| 路径 | iOS 处理 |
|---|---|
| `js_safety/instrument.js` | 原样打包（Acorn 插桩） |
| `js_extra/`、`venera/` | 原样打包；Worker 化运行 `_venera_.js` |
| `anilist_titles.tsv.gzip`（1.64MB） | 必须打包，解压后灌入 `anilist_titles` |
| `ambient/`（CC0，.ogg） | **WKWebView 不播 OGG** → 需转 m4a/AAC 或原生音频插件（风险项） |
| `mt/`（漫画翻译） | **跳过** |

### 2.9 书源与阅读行为要点

- 书源配置：Legado JSON 规则；源管理页含启用/停用/排序/编辑/导入导出。
- 成人源开关：主色按钮连点 6 次（隐藏入口，与 Android 一致）。
- MockBookSource：生产环境隐藏。
- 漫画翻译入口：**隐藏**（功能不移植）。
- 下载：多任务、并发限制、断点、完整性校验（`DownloadFileValidator`）。
- 排版：Compose 文本度量 → DOM/Canvas；语义一致，像素差异记 `PARITY_EXCEPTIONS`。

---

## 3. 全部页面与功能清单（对拍母本）

### 3.1 启动与引导

| 页面 | 功能 | Android 参考 |
|---|---|---|
| splash | 启动屏 + 数据加载 | SplashActivity |
| onboarding | 首次引导 | OnboardingActivity |

### 3.2 Home（4 Tab）

| Tab | 功能 |
|---|---|
| 书库 | 书籍列表、分类、搜索、排序、封面网格/列表、添加本地/在线、长按操作 |
| 书架 | 收藏（favorites）、更新检查、分类管理（favorite_categories） |
| 统计 | 阅读时长/记录（reading_records / reading_sessions）、图表 |
| 设置 | 全局设置入口（下挂设置子页） |

### 3.3 设置子页

| 项 | 内容 |
|---|---|
| 阅读设置 | 主题（Sepia/EyeGreen/Night/Oled）、字号、行距、边距、翻页方式、滚动/翻页 |
| 外观 | 玻璃效果、动效开关、字体 |
| 下载 | 并发、仅 Wi-Fi、存储位置 |
| 书源 | 跳转 source_management |
| 隐私模式 | PIN 设置/验证/关闭、分类保护、无痕浏览 |
| 备份与恢复 | 导出 ZIP、导入校验、差异提示 |
| 帮助 / 关于 | 版本、开源许可、反馈 |
| 成人源开关 | 隐藏（连点 6 次） |

### 3.4 阅读器

| 场景 | 功能 |
|---|---|
| novel_reader_online / reader | 分页/滚动、翻页动画、目录、书签、高亮、朗读（TTS）、搜索定位、夜间模式、进度同步、章节合并展示、图片内嵌 |
| comic_reader | 页翻、连续滚动、缩放、目录、进度、封面 |
| comic_chapters | 漫画章节列表、已读标记、书签 |
| comic_reader_online | 在线漫画阅读 |

### 3.5 神回（God Moment）

| 页 | 功能 |
|---|---|
| god_ranking | 神回榜单（rating 排序） |
| god_editor | 神回编辑/封面生成/裁剪（GodCoverEngine） |

### 3.6 书源管理

| 项 | 功能 |
|---|---|
| source_management | 列表、启用、排序、编辑 Legado JSON、导入导出、连通测试 |

### 3.7 下载层（无独立 UI 页，但为全功能）

下载任务管理（download_tasks）、并发限制、断点续传、完整性校验、失败重试、文件路径管理。

---

## 4. 技术选型与版本锁定

### 4.1 栈（与用户指定一致）

| 层 | 选型 |
|---|---|
| 语言 | TypeScript（strict） |
| 构建 | Vite |
| UI | React 18+（建议 React 19，见异议） |
| 壳 | Capacitor（版本见异议） |
| 测试 | Vitest（单元）+ Playwright（视觉/集成） |
| 状态 | Zustand |
| 纯逻辑 | core/ 禁止 import DOM 与 Capacitor（lint 强制） |

### 4.2 建议锁定版本（2026-10-04 查证）

| 包 | 版本 | 说明 |
|---|---|---|
| @capacitor/core / cli / ios | **8.5.2**（若走 Capacitor 8） | GitHub Latest 标签 2026-09-11；要求 Node 22+、Xcode 26+、iOS deployment target 15.0+ |
| @capacitor/sqlite、filesystem、app、device、keyboard、splash-screen、preferences、haptics | 同 8.x 线，**在 scaffold 时 `npm view` 精确锁定** | |
| Node | 22.x（CI 上 `macos-15` 默认 22.23.2） | |
| Vite | scaffold 时 `npm view vite version` 后锁定（Vitest 5 peer：`^6\|\|^7\|\|^8`） | **不凭记忆写死** |
| vitest | **5.0.2** | |
| @vitejs/plugin-react | **5.1.0** | |
| Playwright | **1.62.1** stable | |
| react / react-dom | 19.x（或按用户定的 18.x） | 见异议 |
| zustand | 5.x（scaffold 时精确锁定） | |
| parse5 / linkedom | 对拍后择一并锁定 | |
| jsdom | 测试环境 | |
| fflate / brotli-wasm | 锁定后用于压缩流 | |
| @capacitor-community/... | 若启用，必须与 Capacitor 主版本匹配 | |

### 4.3 目录结构（IOS/）

```
IOS/
├─ docs/PORT_PLAN.md          ← 本文档
├─ docs/PARITY_EXCEPTIONS.md  ← 建（空模板，阶段 1 填）
├─ docs/WEB_PORT_GUIDE.md     ← 建（空模板，阶段 1 填）
├─ parity/                    ← 阶段 0 只建目录，不建导出器（待批准）
│  ├─ fixtures/
│  └─ android-export/         ← 见第 8 节，待用户批准
├─ src/
│  ├─ ui/                     ← React 组件 + 页面
│  ├─ core/                   ← 纯 TS：规则/分页/合并/PIN KDF/备份/压缩
│  └─ platform/               ← 接口 + web-mock + ios-native（Capacitor）
├─ ios/                       ← Capacitor 原生壳与插件
├─ tests/unit/  tests/parity/  tests/e2e/
└─ package.json  vite.config.ts  tsconfig.json
```

---

## 5. 依赖映射表（Android → Web/iOS）

| Android | Web/iOS 替代 | 对拍/风险 |
|---|---|---|
| Room 2.6.1 | @capacitor/sqlite（原生） | identityHash/建表 SQL 逐字节对齐；迁移测试 |
| WorkManager 2.9.1 | core 下载状态机 + URLSession 后台任务 | iOS 后台限制；状态机用 Android 测试向量验证 |
| OkHttp 4.12.0 / Cronet | 原生 HTTP Capacitor 插件（非 WKWebView fetch） | 请求头、重定向、超时、HTTP/3 差异记例外 |
| Jsoup 1.18.3 | parse5 或 linkedom + 自研清洗 | HTML→纯文本对拍 |
| Coil 2.7.0 | 自研缓存/解码/缩放 | 缓存键、失败重试、磁盘限额 |
| Moshi 1.15.2 | JSON.parse + 手写 DTO 层 | 数值精度、缺字段默认值 |
| QuickJS alpha13 | Web Worker + 官方 `_venera_.js` + Acorn 插桩 | 45s guard、隔离、无 DOM 泄漏 |
| DataStore / SharedPreferences | SQLite 设置 / Keychain（敏感） | 禁止 localStorage/IndexedDB 存业务数据 |
| security-crypto | Keychain + PBKDF2(Web Crypto, SHA-1) | 与 PrivacyManager 参数完全一致 |
| Brotli 0.1.2 | brotli-wasm / fflate | 备份解压对拍 |
| Haze 1.1.1 / liquidglass | backdrop-filter / CSS / WebGL 近似 | 视觉近似，参数全量提取 |
| pagecurl | Canvas / WebGL 近似 | 像素差异记录 |
| ONNX / manga-translate | **不移植** | 入口隐藏，记 PARITY_EXCEPTIONS |
| AGSL 自定义着色 | CSS / SVG / WebGL 近似 | 参数提取 + 截图对比 |
| 字体度量（Compose） | DOM / Canvas | 语义一致优先，像素差异记录 |

---

## 6. 架构分层与规则

| 层 | 约束 |
|---|---|
| `core/` | 纯 TS；禁止 import `react`、DOM、Capacitor；所有算法从 Kotlin 权威移植；配 Vitest 向量测试 |
| `platform/` | `interface`（HTTP、DB、FS、Keychain、Audio、TTS、Clipboard、Haptics…）+ `web-mock`（开发/测试）+ `ios-native`（Capacitor 插件实现） |
| `ui/` | React 页面与组件；视觉参数来自设计令牌脚本（由 DesignTokens/Color/IosMotion 生成） |
| 朗读 | 建议原生 `AVSpeechSynthesizer` 插件（见异议） |
| 环境音 | 见异议（ogg→m4a） |

---

## 7. 风险清单

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | Compose 排版 vs DOM 文字度量不一致 | 分页页码/行数可能偏差 | 语义级对拍（章节完整性、书签定位、进度）；像素差异记例外 |
| R2 | WKWebView 大漫画内存峰值 | 瓦解/杀进程 | 分页加载、分辨率降级、后台释放；对拍内存峰值 |
| R3 | 卷页/玻璃 WebGL 性能 | 卡顿 | 先近似后精修；低端机降级路径 |
| R4 | Venera Worker + 45s guard | 源执行超时行为不一致 | 移植 guard 逻辑；用同一批源脚本对拍 |
| R5 | Z-Library PoW / DNS-SNI | 源不可达 | 移植 DiamWallInterceptor / ZLibraryDns；PoW 计算验证 |
| R6 | iOS 后台下载限制 | 下载中断 | 状态机可恢复；前台优先；记例外 |
| R7 | Cookie / Keychain 与 Android 不互通 | 登录态 | 客户端内自洽；不承诺跨平台迁移凭据（BackupArchive 已排除） |
| R8 | 备份 ZIP 格式互通 | 用户迁移失败 | 用 Android 真实备份做 fixture 对拍 |
| R9 | identityHash 不一致 | 无法声明同 schema | 建表 SQL + migration 12.json 逐字节校验脚本 |
| R10 | 字体度量差异 | 阅读页行高/分页 | 内置 Noto 字体；对拍分页样本 |
| R11 | 环境音 OGG 不可播 | 功能缺失 | 转 m4a 或原生插件 |
| R12 | 无 Mac 无 iPhone | 无法本地 iOS 验证 | CI macOS runner 出未签名 IPA；Sideloadly/AltStore 侧载 |
| R13 | Capacitor 8 ↔ macos-15 Xcode 默认 16.4 | CI 构建失败 | workflow 显式选 Xcode 26.x，或改用 macos-26；见异议 |
| R14 | fixture 语料缺失 | 无法对拍 | 自建导出器（待批准）+ 自造最小语料 |
| R15 | TTS 行为差异 | 朗读体验 | 用原生 AVSpeechSynthesizer 插件；记录 SSML/断句差异 |
| R16 | 复制 Kotlin 纯逻辑到导出工程 | 维护双份 | 只读复制 + 生成脚本；禁止手改副本 |

---

## 8. 对拍体系设计（fixture 导出器 · 需用户批准）

### 8.1 现状

- 仓库测试引用的真实 EPUB 不在库内；`test/resources` 几乎无解析语料。
- 97 个 JVM 测试文件 / 509 个 `@Test` 可作为 **spec**，但不能直接在 iOS 跑。

### 8.2 方案（推荐 A，待批准）

**方案 A · 独立 JVM 导出器（不改 Android）**

```
IOS/parity/android-export/          ← 独立 Gradle JVM 工程（新建目录）
├─ settings.gradle.kts
├─ build.gradle.kts
├─ src/main/kotlin/                 ← 从 novel-reader 只读复制的纯逻辑 Kotlin + shim
└─ src/main/resources/
IOS/parity/fixtures/                ← 导出 JSON 测试向量
IOS/parity/expected.json            ← 对拍期望
```

规则：
1. **绝不修改** `novel-reader/` 任何文件。
2. 复制仅限纯逻辑源（LegadoRule、JsonPathResolver、ChapterMerger、BackupArchive 算法部分、PIN KDF、naturalOrderCompare、CharsetSniffer、TitleNormalizer、Mobi/Epub 解析核心等）；Android API 用最小 shim 替换（日志、SharedPreferences 存储接口）。
3. 由脚本同步副本，**禁止手改** `android-export/src` 下的 Kotlin。
4. 运行后写 `IOS/parity/fixtures/*.json`（输入→输出向量）。
5. iOS `core/` 的 Vitest 读取同一 fixtures 断言。
6. CI 两步：先跑 JVM 导出器（产出 fixtures）→ 再跑 iOS 单元对拍。

**方案 B · 手写向量**：仅对无法复制的加密/压缩/二进制格式（PBKDF2、Brotli、PalmDOC）用官方文档向量 + 从 Android 源码逻辑手推。作为 A 的补充，不作为主路径。

**方案 C · 用户提供语料**：若用户可提供真实 EPUB/MOBI/漫画样本，放入 `IOS/parity/corpus/`（需用户确认来源与授权）。

### 8.3 首批对拍向量（阶段 1 必须齐）

| 模块 | 向量 |
|---|---|
| PIN KDF | 明文 PIN + 盐 hex → PBKDF2 hex；旧 SHA-256 hex；升级路径 |
| Legado 规则 | 规则 JSON + HTML/JSON 输入 → 书名/作者/章节列表 |
| JsonPath | 表达式 + 文档 → 值/缺省 |
| Epub | 最小 EPUB → 元数据/章节/纯文本 |
| Mobi | 最小 MOBI → 同上 |
| BackupArchive | 12 表行 → ZIP 字节（或结构树） |
| 章节合并 | 多章输入 → 合并文本 |
| 排序 | 书名列表 → natural order 序 |
| 字符集 | 混合编码字节 → 解码文本 |
| 下载校验 | 字节流 + 大小/哈希 → valid/invalid |
| 书源 | 一组规则 + mock 响应 → 书/章 |

### 8.4 CI 对拍流程

```
ios-unit (vitest) ──┐
parity-jvm (gradle export) ──► fixtures ──► parity-compare (vitest) ──► 必须全绿
```

---

## 9. 分阶段计划（对齐用户阶段 0–7）

| 阶段 | 目标 | 门槛（不过不进下一阶段） |
|---|---|---|
| 0 | 本文档 + 疑问/异议 | **用户确认** |
| 1 | 工程脚手架：Vite+React+Capacitor+TS+lint+vitest+playwright；令牌生成脚本；PARITY_EXCEPTIONS/WEB_PORT_GUIDE 模板；目录骨架 | `npm run build` 绿；单元测试跑通空壳；`parity/` 建好 |
| 2 | platform 接口 + web-mock + 14 表 SQLite 建表（schema 12 原样）；PIN KDF 对拍；设计令牌全量提取 | 建表 SQL 对齐脚本绿；PIN 向量对拍绿 |
| 3 | 纯逻辑移植：Legado/JsonPath/章节合并/备份/排序/字符集/下载校验/Mobi/Epub 核心；fixture 导出器就绪 | 所有 core Vitest 向量绿（fixture 驱动） |
| 4 | UI 复刻：splash/onboarding/home 4 Tab/设置子页/书源管理 | Playwright 截图 vs Android 参考图；PARITY_EXCEPTIONS 更新 |
| 5 | 阅读器（novel + comic）：分页/滚动/主题/书签/高亮/进度/目录/朗读 | 分页语义对拍绿；视觉差异记录 |
| 6 | 下载层、书源网络（原生 HTTP、PoW/SNI、Venera Worker）、备份互通 | 单元+集成绿；用 Android 真备份恢复成功 |
| 7 | 发布：CI macOS 出 IPA、文档、真机侧载清单 | CI 绿；文档齐；无未记录例外 |

每轮汇报格式：已落地（附证据）/ 未做与差异 / 踩到的坑 / 下一步需用户决策。

---

## 10. 疑问与技术异议（待用户决策）

### 10.1 已确认决策（2026-10-04 用户批准）

| # | 问题 | 决定 |
|---|------|------|
| Q1 | Capacitor 版本 | **8.5.2**（+ 社区 SQLite `@capacitor-community/sqlite@8.1.1`，官方无 `@capacitor/sqlite`） |
| Q2 | CI runner | **macos-26**（workflow 断言 `Xcode 26.x`） |
| Q3 | 最低 iOS | **16.0**（pbxproj 已改 `IPHONEOS_DEPLOYMENT_TARGET = 16.0`） |
| Q4 | fixture 导出器 | **方案 A 批准**（`IOS/parity/android-export/` 独立 JVM，只读复制 Kotlin） |
| Q5 | React | **19.3.0** |
| Q6 | TTS | **原生 AVSpeechSynthesizer 插件**（阶段 5 实现） |
| Q7 | 环境音 OGG | **转 m4a 打包** |
| Q8 | Venera/QuickJS | **Web Worker + `_venera_.js`**，对拍 45s guard |

### 10.1b 阶段 1 实际锁定版本（2026-10-04 `npm view` 后安装）

| 包 | 版本 | 说明 |
|---|---|---|
| @capacitor/core / cli / ios | 8.5.2 | |
| @capacitor-community/sqlite | 8.1.1 | peer core>=8 |
| @capacitor/app | 8.1.2 | |
| @capacitor/browser | 8.0.5 | |
| @capacitor/device | 8.0.3 | |
| @capacitor/filesystem | 8.1.4 | |
| @capacitor/haptics | 8.0.2 | |
| @capacitor/keyboard | 8.0.6 | |
| @capacitor/network | 8.0.1 | |
| @capacitor/preferences | 8.0.1 | |
| @capacitor/splash-screen | 8.0.2 | |
| @capacitor/status-bar | 8.0.4 | |
| vite | 8.3.2 | plugin-react 6.1.1 peer 要求 ^8 |
| @vitejs/plugin-react | 6.1.1 | |
| react / react-dom | 19.3.0 | |
| zustand | 5.0.15 | |
| typescript | 6.0.3 | typescript-eslint peer `<6.1.0` |
| typescript-eslint | 8.71.0 | 元包（CLI 配置用 `typescript-eslint` 而非 `@typescript-eslint/*` 的 `defineConfig`） |
| eslint | 9.39.5 | eslint-plugin-react peer 不含 10；未用该插件，用 react-hooks |
| eslint-plugin-react-hooks | 7.1.1 | |
| vitest / @vitest/ui | 5.0.3 | |
| @playwright/test | 1.63.0 | |
| jsdom | 30.1.2 | |
| parse5 | 8.0.1 | 阶段 3 HTML 解析候选 |
| fflate | 0.8.3 | |
| prettier | 3.9.9 | |
| @types/node | 26.6.4 | |
| @types/react / react-dom | 19.3.0 | |
| Node | 24.16.0（本机）/ CI 22 | Capacitor 8 要求 22+ |

### 10.2 需确认（不阻塞阶段 1，但阻塞对应功能）

| # | 问题 | 备注 |
|---|---|---|
| Q9 | 是否需要 **iOS Apple Watch / iPad 专用布局**？ | Android 侧未见，建议不做。 |
| Q10 | **备份互通优先级**：iOS↔Android 备份互开必须做到什么程度？（行数据+设置+图片+封面；不做凭据） | 建议对齐 BackupArchive 的 12 表语义。 |
| Q11 | **AniList 标题库**（1.64MB gzip）打包后首启导入耗时是否可接受？ | 建议后台灌库 + 进度提示。 |
| Q12 | 是否允许 iOS 侧 **隐藏"漫画翻译"与"MockBookSource"** 后在 PARITY_EXCEPTIONS 一次性列清？ | 符合用户"明确不做"要求。 |
| Q13 | **签名/分发**：是否只走未签名 IPA + Sideloadly/AltStore，不需要 TestFlight/App Store 签名？ | 影响 CI 证书配置。 |
| Q14 | 仓库根 `PROJECT_GUIDE.md` 而非 `novel-reader/docs/` 下，是否以本文档路径为准继续协作？ | 事实确认，避免路径误用。 |

### 10.3 已锁定的事实（无需再问）

- PBKDF2 细节已核实：`PBKDF2WithHmacSHA1` + 120000 + 256-bit + 16B salt + SHA-256 旧路径升级 + 失败冷却，与提示词一致，**不需要再猜**。
- Room 14 表、无外键、复合主键与索引列已全部提取（见 2.6）。
- 版本查证结果见 4.2；Vite 具体版本将在 scaffold 时用 `npm view` 锁定，不凭记忆写。

---

## 11. 附录（已实查数据摘要）

### 11.1 仓库测试清单（对拍 spec 来源）

- 97 个 JVM `@Test` 文件，约 509 个 `@Test`；另有 27 个 androidTest / 95 个 `@Test`（不作为 iOS 单测，仅作行为参考）。
- 重点：`data/`（AppDatabaseMigrationTest, RealEpubPipelineTest, PaginationImageHeightTest…）、`source/`（LegadoRuleTest, JsonBookSourceTest, SourceManagerTest…）、`download/`（BackendDownloadPolicyTest, CorruptedFileTest…）、`integration/IntegrationChainTest`、`god/`、`library/`。
- **不移植**：`mangatranslate/` 全包。

### 11.2 主色/阅读主题（Color.kt）

- MintGold `#E8C97A`；DarkCharcoal `#18191C`；MediumGray `#61666D`；DividerGray `#E3E5E7`
- 阅读主题：Sepia `#FBF0D9`/`#5F4B32`；EyeGreen `#E8F5E9`/`#1B5E20`；Night `#18191C`/`#D4D4D4`；Oled `#000000`/`#E0E0E0`
- `luminance`/`onColor`/`glassTitleColor` 算法在 `Color.kt`，需生成 TS 等价函数并对拍。

### 11.3 备份排除项（BackupArchive）

正则排除键：`(?i)(cookie|token|password|credential|secret|api.?key|pin_|salt|auth)` → 这些设置不进备份。

### 11.4 视觉参考

- `docs/screenshots/shot1-5.jpg` 可作为 Playwright 截图对拍参考图。

### 11.5 阶段 0 完成检查表

- [x] PROJECT_GUIDE.md 全文通读
- [x] Room v12 14 表 + 索引 + 复合主键提取
- [x] PBKDF2 实现位置与参数核实
- [x] 路由清单、设计令牌、测试文件、assets 清单
- [x] 外部版本查证（Capacitor/GitHub Actions/Vitest/Playwright）
- [x] 风险清单、对拍方案、分阶段门槛
- [x] 疑问与异议汇总
- [x] 用户确认 Q1–Q8（Q9–Q14 未确认，不阻塞阶段 1）
- [x] 阶段 1 脚手架（已落地，见 WEB_PORT_GUIDE「已落地」）
- [x] 阶段 2 platform + SQLite 建表（`schemaV12.ts` 14 表 + identityHash 对齐）
- [x] 阶段 3 纯逻辑移植 + 对拍（核心算法已移植，`tests/parity` 38 例全绿）

---

## 12. 进度 note（2026-10-04）

**阶段 1-3 并行实施中（子代理推进）**：platform / core / ui / assets 四路并行。

- assets 路：已从 Android `novel-reader/app/src/main/` 复制字体（otf ×2）、js_safety（instrument/acorn）、venera、js_extra、anilist_titles.tsv.gzip 到 `IOS/public/`；环境音 OGG 暂不复制（Q7 待转 M4A）；`mt/` 不复制（E1）。详见 `docs/WEB_PORT_GUIDE.md`。
- 其余路径（platform/core/ui）进度由各子代理在各自模块内维护。

---

## 13. 进度 note（2026-10-07 · 续做）

本轮先纠正基线、再推 P0。详见 `WEB_PORT_GUIDE.md` 的「2026-10-07 续做」。

| 项 | 结果 |
|---|---|
| 门禁基线 | 文档原记「85 文件 / 2085 用例全过」不实；实为 **155 文件 / 4097 用例 / 7 失败**。已逐条回 Kotlin 判定并修完 |
| E59（JS 章节顺序归一化） | ✅ 已移植 118/118 行 + 16 例对拍测试（逐条移植 Kotlin `JsChapterOrderTest.kt`） |
| E60（关键词子系统） | ✅ 资源已补 `public/keyword/`（4 文件，字节数核对一致）+ 新增 `keywordAssembly.ts` 装配点 + 7 例测试 |
| E58（漫画 Sheets 接线） | 🟡 sheets 层组件已验证可用，并修掉被掩盖的 `ComicSettingsGestureTab` 移植缺口；**接线层未做** |
| **E94（新增，书库宿主装配）** | 🔴 `setLibraryRuntime()` 全仓零调用方 → 书库页永远跑空壳 ViewModel。**建议优先于 E58/E81 处理** |
| 门禁现状 | `tsc --noEmit` 0 errors · `eslint src tests` 0 problems · `vite build` 成功 · `tests/parity` 38/38 |

**下一轮优先级**（按「解锁的功能面」排序，不是按编号）：

1. **E94** — 装配 `LibraryViewModel` 宿主。解锁整个书库页：搜索 / 聚合搜索 / 关键词扩展 / 下载队列 / 设置读取。Android 的对照是 Hilt 注入的 `LibraryViewModel(application)`。
2. **E58** — 把 `ui/components/comic/sheets/**` 接进 `ComicReaderPage`，接掉 `PRESET` / `CROP` 占位文案。解锁漫画设置 7 Tab + 预设管理 + 手动裁边。
3. **E81/E82** — 神回编辑窗路由切到逐行移植版 `GodMomentSheet`。解锁封面裁剪入口。
4. **E62/E64/E65/E66/E67** — 接线 7 个已装未用的 Capacitor 插件；`Info.plist` 补 `NSAppTransportSecurity`（否则明文 HTTP 书源必失败）；`keep_screen_on` 接线。
