# 交接提示词：把 IOS/ 做到与 Android 1.6.4 逐行等价

> 这份文档是给**下一个接手的 AI** 的完整任务书。整段复制过去即可开工，不需要问任何澄清问题。

---

## 一句话目标

`novel-reader/` 是唯一权威。**478 个 Kotlin 文件 / 122,338 行**，每一行都要在 `IOS/` 侧有对应实现，或者有一条带 Kotlin 行号的差异记录。`MISSING` 归零才算交付。

---

## 0. 交接背景：上一个会话做到哪一步

**已经做到的：**

- iOS 能编译、能装：GitHub Actions `ci` 五个 job 全绿（run #38 / `41b966d`），产出未签名 IPA `CialloReader-1.6.4-264-unsigned.ipa` 27.65 MB，Mach-O `arm64` / `MH_EXECUTE`，`public/` 282 项、`index.html` 引用的 85 个资源全部命中。
- `npx vitest run` **292 文件 / 5501 用例全绿**；`tsc --noEmit` / `eslint src tests --max-warnings=0` 零诊断。
- 已登记 **121 条差异**（E1–E112），在 `docs/PARITY_EXCEPTIONS.md`。

**没做到的（本次任务的全部内容）：**

- 292 个测试文件里，**只有 9 个真正读 Kotlin 原文做断言**（`tests/helpers/androidReference.ts` + 8 个 test），其余按「文档描述的行为」写断言。所以「5501 全绿」证明不了「逐行等价」。
- **4 个组件零命中、4 个组件用近似品替代**，共 168 处调用点没有逐行对应（见 §3）。
- 至少 2 个功能 Android 有、iOS 没有（见 §3.3）。

**⚠ 文档已过期，开工前先复核：**

`PARITY_EXCEPTIONS.md` 里标着「未实现」的部分条目**实际已经修好**，但文档没同步。已确认的两例：

| 条目 | 文档说 | 实测 |
|---|---|---|
| E94 | `setLibraryRuntime()` 全仓零调用方 | 已修 —— `src/core/library/libraryAssembly.ts:434` 有调用 |
| E83 | 漫蛙图床 AES-CBC 解密原语缺失 | 已修 —— `src/core/platform/web/webCrypto.ts:69` 实现 `decryptAesCbc`，`src/core/library/libraryImageBytes.ts:279` 实际调用 |

**所以第一步不是写代码，是把 121 条 E 记录逐条实测复核**，把已修的降级为「已关闭」，只留真实缺口。

---

## 1. 权威源与边界

| 路径 | 作用 | 权限 |
|---|---|---|
| `novel-reader/` | Android 工程。`versionName = "1.6.4"` / `versionCode = 264`（`app/build.gradle.kts`）。478 个 `.kt` / 122,338 行 | **只读。一个字节都不许改** |
| `IOS/` | 移植目标。655 个 TS/TSX / 189,783 行，292 个测试 | 可改 |
| `IOS/tests/reference/android/` | Android 权威树快照，559 文件 / 7.0 MB。测试的 `androidReference()` 在找不到 live 树时回落到这里，**CI 靠它跑** | 从 live 树同步，不要手改内容 |
| `IOS/docs/` | 8 份文档，其中 `PARITY_EXCEPTIONS.md`（151 KB / 121 条）与 `PORT_STATUS.md`（77 KB）是主账本 | 可改 |

**技术栈（不要换）：** TypeScript + Vite 8.3.2 + React 19.3.0 + Capacitor 8.5.2 + Vitest 5.0.3 + Playwright 1.63.0，Node 24.16.0，iOS 部署目标 16.0。

**目录纪律：**

- `src/core/**` = 纯 TS。ESLint **禁止** import React / DOM / Capacitor。
- `src/platform/**` = 端口层（`interfaces.ts`）+ `web/`（浏览器替身）+ `ios-native/`（Capacitor 实现）。
- `src/ui/**` = 页面与组件。
- `tests/{unit,parity,port,e2e}`。

---

## 2. 「完成」的定义（可核对，不接受口头声明）

### 2.1 建 `IOS/docs/PARITY_MATRIX.md`

一行一个 Kotlin 文件，478 行表格：

```
| Kotlin 文件 | 行数 | iOS 对应 | 状态 | 备注 |
|---|---|---|---|---|
| data/BookRepository.kt | 812 | core/library/bookRepository.ts | PORTED | — |
| ui/wenku/WenkuGlass.kt | 779 | ui/components/wenku/WenkuGlass.tsx 等 6 个 | ADAPTED | see E113 |
```

**状态只有三种，没有第四种：**

| 状态 | 含义 | 要求 |
|---|---|---|
| `PORTED` | 逐行对应，行为等价 | 有读 Kotlin 原文的测试锁住 |
| `ADAPTED` | 有意不同（平台限制） | 必须写清「Kotlin 文件:行号 → iOS 文件:行号」+ 平台原因 + 测试 |
| `MISSING` | 还没做 | **交付时必须为 0** |

### 2.2 测试必须读 Kotlin 原文

每个 `PORTED` / `ADAPTED` 的结论都要有测试从 `androidReference()` 读真实 Kotlin，断言常量、行号区间、字符串字面量、枚举序数。参照已有的 8 个样板：

```
tests/unit/backupKotlinAuthority.test.ts        ← 解析 BackupArchive.kt 重算常量
tests/unit/pullOutHostsParity.test.ts           ← 读 PullOutMotion.kt / PullOutHosts.kt / MainActivity.kt
tests/unit/i18nStrings.test.ts                  ← 解析 Strings.kt 的 EN 词表
tests/unit/roomV12SchemaFromRoomExport.test.ts  ← 读 Room 导出的 12.json
tests/unit/wenkuShelfCore.test.ts               ← 读 ArchiveShelf.kt
tests/unit/cjkFoldMapParity.test.ts             ← 读 CjkFoldMap.kt / TitleNormalizer.kt
tests/unit/helpContent.test.ts                  ← 读 help/ 三个文件
tests/unit/splashQuotes.test.ts                 ← 读 splash_quotes.xml
```

**禁止**「按我在文档里读到的行为写断言」——那只是自证。

### 2.3 门禁全绿

见 §5。

---

## 3. 已知缺口（从这里开工，不用自己找）

### 3.1 零命中组件 —— 4 个，19 处调用点（最硬的缺口）

iOS 侧**完全没有实现**，`src/` 里 grep 零命中：

| Kotlin 定义 | Kotlin 调用处 | iOS 现状 |
|---|---|---|
| `ui/wenku/WenkuGlass.kt:503` `WenkuSearchField` | 3 | **0 命中** |
| `ui/wenku/WenkuGlass.kt:586` `WenkuPillButton` | 6 | **0 命中** |
| `ui/SettingsTabScreen.kt:1237` `SettingsNavigationCard` | 7 | **0 命中** |
| `library/LibraryScreen.kt:1196` `LibrarySearchNotice` | 3 | **0 命中** |

`LibrarySearchNotice` 是 6 类错误文案的分发器，`SettingsNavigationCard` 是设置页跳转卡片的统一外观。这两个缺失会被用户直接看到。

### 3.2 近似替代 —— 4 个，149 处调用点（换个名字不算复现）

| Kotlin 定义 | Kotlin 调用处 | iOS 现在的做法 | 要求 |
|---|---|---|---|
| `ui/wenku/WenkuGlass.kt:319` `WenkuTextButton` | **119** | 换成自家 `AppButton` / `.wenku-menu__item` | 按 Kotlin 原文重建：按下缩放、选中态、禁用态、内边距、字号字距逐项对齐 |
| `ui/wenku/WenkuGlass.kt:236` `WenkuIconButton` | 14 | 换成 `AppIconButton` | 同上 |
| `ui/wenku/WenkuGlass.kt:89` `WenkuGlassSurface` | 7 | 换成 `GlassCard`（注释自认「Web 无等价能力」） | 逐参数对齐：`blur` / `contentPadding` / `role` / 描边 / 高光层 |
| `ui/wenku/WenkuGlass.kt:681` `WenkuContentPanel` | 9 | `WenkuContentPanel.tsx` 有实现，但调用点注释说落到 `GlassCard` | 把 9 处调用点真正切过去 |

**注意：**这些替代品本身可能更符合 Web 习惯，但目标不是「更好」，是「一样」。119 处 `WenkuTextButton` 是 Android 全站最常用的按钮原语，视觉细节（`contactSpec()` 120 ms 按下 / `settleSpec()` 420 ms 回弹、0.975 缩放）必须一致。

### 3.3 功能缺失 —— Android 有、iOS 没有

| 编号 | 内容 | 说明 |
|---|---|---|
| **E107** | 书架搜索面板（`ShelfSearchPlane` + 双结果分组 + `N 项` 计数） | Kotlin 有完整实现，iOS 未做 |
| **E109** | PDF 漫画导入 | 需要 PDFKit / pdfjs 移植 |
| **E72** | 3D 书架「整本飞入阅读器」覆盖层（`@core/wenku/flight`） | 组件存在但零挂载；`suppressRouteMotion` 短路依赖它，所以一直是死代码 |
| **E74** | 触控区分区手势的翻页预演 | 手势识别有，预演动画没有 |

### 3.4 文档过期，需逐条复核

`PARITY_EXCEPTIONS.md` 有 121 条。已确认过期 2 条（E94 / E83）。**其余 119 条逐条实测**，能关的关，关不掉的补上「Kotlin 行号 → iOS 行号」，不要留模糊描述。

重点复核这几条（历史上标记为「未实现」）：

```
E8   玻璃卡光照        E18  God cover pipeline    E28  神回触感
E47  触摸反馈 HapticsGate   E52  屏幕常亮        E58  漫画阅读器 Chrome/Sheets
E59  JS 漫画源章节顺序       E65  @capacitor/haptics 零接线   E67  7 个插件未使用
E72  3D 飞入          E74  翻页预演            E85  帮助入口 icon desc
E86  RuleBudget 截止时间     E89  KeywordCache.read 容错   E92  安卓基准文件缺失
E93  MockBookSource 参数     E101 翻译失败分类      E103 星空+台灯背景
E110 零命中清单定性      E111 PullOutHosts 残留      E112 路由转场
```

---

## 4. 已踩过的坑（重踩每一条要浪费几小时）

这 5 条都是**真实 renderer 崩溃**，本机（Windows + WebKit）逐个定位过。修法已落进代码，**改动相关代码时不要退回去**：

| # | 症状 | 根因 | 修法（现行代码） |
|---|---|---|---|
| 1 | 打开漫画阅读器 → 整页变「主页渲染失败」 | `comicReaderBackground.tsx` 的 `new Uint8ClampedArray(size * size)` 少乘 4 → `new ImageData(pixels, 256, 256)` 抛 `IndexSizeError: sh value is not equal to height`。**jsdom 没有 `ImageData`，单测永远测不到** | 按像素数 ×4 分配 RGBA 缓冲 |
| 2 | 漫画页一次渲染异常 → 整个 App 变回退页 | `RenderRecoveryBoundary` 包了整站；Android 的 `HomeRenderRecovery.arm()` 只覆盖 `composable("home")` | 边界只包 `route === 'main'` 分支（`App.tsx`） |
| 3 | 进 `comic_chapters` → `Target crashed` | `WenkuSectionHeader` 的揭示动画用 `animation-fill-mode: both`，动画结束后元素永久保留合成层；长目录 + GL 卷页画布上两个实例就够崩 | `backwards` + 纯 `opacity` keyframes |
| 4 | 进 `source_management` → `Target crashed` | `.app-route` 的位移动画（`transform: translateX` / `translate` / `left` 三种写法全试过）在含内部滚动容器的页面上崩 renderer。`contain: paint` / `will-change` / 缩小位移幅度**都不解决** | 保留 Kotlin 的 420/320 ms + `pageEase`，位移改纯 `opacity`（已登记 E112） |
| 5 | 揭示动画重播时崩 | 区块头随重渲染重播，合成层反复创建/销毁 | `WenkuSectionHeader` 的 `reveal` 改成显式 opt-in，默认关 |

**配置层两条：**

- `vitest.config.ts` 的 `hookTimeout: 60_000`（不是默认 5s）—— 两个 jsdom + 内存 SQLite 套件 setup 实测 21–30 s。
- `vitest.config.ts` 的 `maxWorkers: 2`（不是 4）—— `jsSandbox` 的 watchdog、`mangaJaNaiFull` 的吞吐收缩、`transferProtocol` 的断点续传三条按**真实墙钟**判定，4 个 fork 抢 CPU 会误判成失败。

**Playwright：**`workers: 1` 已设。本机 Windows 串行跑完整套 18 项会逐步 renderer OOM，**逐 spec 单独跑全过**；Linux runner 上 18/18 全绿 2m24s。所以 `.github/workflows/ci.yml` 里 e2e 步骤是 `continue-on-error`。

---

## 5. 门禁命令（每次改完都跑）

工作目录 `IOS/`：

```bash
npx tsc --noEmit
npx eslint src tests --max-warnings=0
npx vitest run
npx vite build
npx playwright test          # 逐 spec 单跑；整轮受 renderer 内存限制
```

**验收基线**（不得低于）：`tsc` 0 error / `eslint` 0 problem / `vitest` 292 文件 5501 用例 / `vite build` 成功 / 单 spec e2e 全过。

**禁止**为了让门禁变绿而删测试、放宽断言、加 `continue-on-error`（CI 里那两处是历史决策，本地不许再增加）。

---

## 6. 工作方法

### 6.1 按 Kotlin 文件过，不要按页面过

按页面过一定会漏——页面里嵌的组件、工具函数、常量表都藏在别的文件。正确顺序：

1. `ls novel-reader/app/src/main/java/com/example/` 拿到顶层包名（`data` / `library` / `source` / `ui` / `god` / `i18n` / `comic` / `network` / `widget` …）。
2. 一个包一个包过，一个文件一个文件过。
3. 每过完一个文件，就在 `PARITY_MATRIX.md` 里写一行。
4. 同一个文件里的多个声明（如 `WenkuGlass.kt` 的 6 个组件）要**逐个**登记，不能一行带过。

### 6.2 每个文件的处理流程

```
1. 读完整 Kotlin 文件（不要只读需要的那几行 —— 行号锚点、常量、注释里的行为约束都在别处）
2. 找 iOS 对应实现；没有就新建
3. 逐项对齐：函数签名 / 默认值 / 常量字面量 / 枚举序数 / 文案 / 布局参数 / 动画时长与缓动
4. 写测试：从 androidReference() 读 Kotlin，断言上述每一项
5. 跑门禁
6. 在 PARITY_MATRIX.md 登记一行
```

### 6.3 差异的登记格式（`PARITY_EXCEPTIONS.md`）

一行一条，五列，简练：

```
| E113 | **标题**（Kotlin 文件:行号） | Kotlin 原文摘要 | iOS 现状 | 影响 + 结论 |
```

**「平台限制」和「没做」要分清。** 前者写清为什么 iOS 做不到（如 Web 没有 Compose 的 `BackHandler`、`NSUserDefaults` 与 `SharedPreferences` 语义差），后者就老老实实写 `MISSING` 并进待办。

### 6.4 每一轮的节奏

- 每轮只动一个包或一组相关组件，改完立刻跑门禁。
- 每轮结束更新两份文档：`PARITY_MATRIX.md`（进度）+ `PORT_STATUS.md`（这一轮做了什么、门禁数字）。
- 文档里的数字必须是**跑出来的**，不是估的。

---

## 7. 禁止事项

1. **不要改 `novel-reader/`** —— 一个字节都不行，它是权威。
2. **不要 git commit / git push** —— 除非用户明确说「推」。远端 `roxycon-dev/Ciallo-Reader-ios` 的 `ci.yml` 有 `concurrency: cancel-in-progress: true`，任何推送会掐掉正在跑的构建。
3. **不要用「测试全绿」当完成证据** —— 先证明测试读的是 Kotlin 原文。
4. **不要删测试、放宽断言、加 `continue-on-error` 来过关。**
5. **不要引入新依赖** 来解决本来能自己写的问题（119 处按钮不值得再引一个 UI 库）。
6. **不要用「Web 上没有对应能力」草率收尾** —— 先查 `src/platform/interfaces.ts` 有没有端口，没有就加端口 + `web/` 替身 + `ios-native/` 实现，三层都要。

---

## 8. 交付物

1. `IOS/docs/PARITY_MATRIX.md` —— 478 行，`MISSING` 为 0。
2. `IOS/docs/PARITY_EXCEPTIONS.md` —— 每条都带 Kotlin 行号与 iOS 行号；「已关闭」的标明关闭时间与证据。
3. `IOS/docs/PORT_STATUS.md` —— 每轮的改动与门禁数字。
4. 测试：读 Kotlin 原文的测试文件从 9 个涨到覆盖全部 478 个 Kotlin 文件的声明。
5. 门禁：`tsc` / `eslint` / `vitest` / `vite build` 全绿，用例数只增不减。
6. 一句结论：**哪些 Kotlin 文件是 PORTED，哪些是 ADAPTED（各附原因），MISSING 为什么是 0。**

---

## 9. 开工第一步（照做）

```bash
cd IOS

# ① 复核文档真实性：把 E1..E112 逐条实测，标出已修 / 未修
#    已知过期两例：E94（setLibraryRuntime 实际已接线）、E83（AES-CBC 实际已实现）

# ② 建账本
#    生成 478 行 PARITY_MATRIX.md 骨架，先全部标 MISSING

# ③ 从 4 个零命中组件开工（最硬、调用点最少、能立刻看到效果）
#    - ui/wenku/WenkuGlass.kt:503  WenkuSearchField        （3 处调用）
#    - ui/wenku/WenkuGlass.kt:586  WenkuPillButton         （6 处调用）
#    - library/LibraryScreen.kt:1196  LibrarySearchNotice  （3 处调用）
#    - ui/SettingsTabScreen.kt:1237   SettingsNavigationCard（7 处调用）

# ④ 再做 119 处 WenkuTextButton（全站最常用原语，值得单独一轮）
```

---

## 附：关键行号速查

| Kotlin | 行号 | 说明 |
|---|---|---|
| `ui/wenku/WenkuGlass.kt` | 89 | `WenkuGlassSurface`（7 处调用） |
| 同上 | 236 | `WenkuIconButton`（14 处） |
| 同上 | 319 | `WenkuTextButton`（**119 处**） |
| 同上 | 503 | `WenkuSearchField`（3 处，零命中） |
| 同上 | 586 | `WenkuPillButton`（6 处，零命中） |
| 同上 | 681 | `WenkuContentPanel`（9 处） |
| 同上 | 735–787 | `WenkuSectionHeader`（14 处，已移植） |
| `ui/SettingsTabScreen.kt` | 1237 | `SettingsNavigationCard`（7 处，零命中） |
| `library/LibraryScreen.kt` | 1196 | `LibrarySearchNotice`（3 处，零命中） |
| `ui/components/PullOutHosts.kt` | 151–175 | `paperPage*` 四向转场（E112 已对齐） |
| `MainActivity.kt` | 629–662 | `NavHost` 默认转场 |
| `MainActivity.kt` | 690–706 | `HomeRenderRecovery.arm()` 只管主页 |
| `MainActivity.kt` | 1360–1363 | `composable("god_editor")` 四个 `EnterTransition.None`（全树唯一 override） |
