# SECURITY AUDIT — 第三方书源安全边界

**审计代理**：安全审计子代理（只读审计）
**日期**：2026-10-06
**审计对象**：`IOS/`（TS + Vite + React 19 + Capacitor 8.5.2）
**只读参照**：`../novel-reader/`（Android Compose 权威源）
**硬规则遵守**：本代理**未修改任何 `src/**` 文件**（`git status` 验证：仅 `PROJECT_GUIDE.md` 为既有改动，`IOS/` 未跟踪）。唯一新增文件为本报告。

---

## 0. 结论摘要（先看这里）

**生产路径不是 Worker，是 inline `new Function`。而且它连"能跑"都做不到。**

| # | 发现 | 严重度 |
|---|---|---|
| **P0-1** | Q8 批准的 **Worker 隔离是死代码**。`evaluateInWorker` 全仓 **0 个调用点**。`JsSourceEngine` 唯一的执行入口是 `JsRuntime.evaluate` → `evaluateInline` → `new Function`，跑在**主线程**，可见 `window`/`document`/`localStorage`/`fetch`/`indexedDB`。第三方书源 `@js:` 可读走整个 App 的 localStorage。 | **P0** |
| **P0-2** | inline 路径的 `evaluate` **不返回完成值**（`new Function` 的 body 不是 program，`JsSourceEngine` 也从不加 `return`），导致 `instrument()` 必抛 `'JS instrumentation failed'`。→ JS 书源引擎在 Web 平台**完全无法初始化**。 | **P0** |
| **P0-3** | inline 路径 `registerFunction` / `registerAsyncFunction` 是 **no-op**，因此 `sendMessageSync` / `sendMessage` / `__cialloTick` **从未被定义**。即便修好 P0-2，桥接层也不存在。 | **P0** |
| **P0-4** | 因为 P0-2，`instrument.js` 的**循环插桩从未生效**。inline 路径只把 `tick` 当**参数**绑上；书源不主动调 `tick` 就能 `while(true){}` **永久冻结主线程**（现有单测 `rt.evaluate('while (true) { tick(); }')` 恰好自己调了 `tick`，掩盖了这一点）。 | **P0** |
| **P1-1** | Z-Library 账号/cookie 存在 **Capacitor Preferences**（= iOS `NSUserDefaults` **明文**）。Android 侧是 `EncryptedSharedPreferences`（AES256_GCM MasterKey + AES256_SIV/GCM）。**这是安全等级的实质降级**，且与 `EncryptedSecretStore` 的注释承诺不符。 | **P1** |
| **P1-2** | 30 MiB 内存上限 / 512 KiB 栈上限是**只读常量，从不强制**。`memoryLimit`/`maxStackSize` 无人读取。 | **P1** |
| **P1-3** | `docs/PARITY_EXCEPTIONS.md` E33/E40 **陈述失实**：声称"提供 `evaluateInWorker` 可进入 Worker"，实际零调用点。已批准的 Q8 缓解措施**未落地**。 | **P1** |
| **P2-1** | 无 CSP。`index.html` 无 `Content-Security-Policy` meta。 | P2 |
| **P2-2** | 备份为**明文 ZIP**（与 Android 一致，非移植缺陷），但含隐私 PIN 哈希/盐以外的设置。 | P2（已接受） |
| **P2-3** | `JsComicSource` 对书源提供的封面/图片 URL **无 scheme 校验**。 | P2 |

**XSS / HTML 注入：全表核查完毕，未发现可执行注入路径。** 3 处 `dangerouslySetInnerHTML` 全部喂的是**编译期常量或纯数字 SVG 几何**，见 §3。
**书源导入面：无执行、无网络请求、无 `__proto__` 污染。** 见 §6。
**PIN KDF：与 Android 逐项一致，常数时间比较正确。** 见 §5。

---

## 1. 沙箱能力对照表

Android 侧权威定义：
- `JsSourceEngine.kt:48-51` — `QuickJs.create(Dispatchers.IO)`，`memoryLimit = 32 MiB`，`maxStackSize = 512 KiB`
- `JsSourceEngine.kt:31-39` — `beginBudget()` / `checkBudget()`，45 s deadline
- `JsSourceEngine.kt:190-262` — 只注册 5 个 native binding：`__cialloTick` / `__boundedRegex` / `__boundedRegexBatch` / `sendMessageSync` / `sendMessage`
- `JsSourceEngine.kt:250-271` — `acorn.js` + `instrument.js` + `comic_metadata.js` 载入，`instrument(sourceJs)` 后才执行书源
- `JsMessageHandler` — 全部能力（网络/存储/时钟/HTML/图片/UI）必须过 `sendMessage`

TS 侧实际定义：
- `src/core/source/js/jsPlatform.ts:147-161` — `JsRuntime` 接口
- `src/platform/web/jsSourcePlatform.ts:400-531` — `createWebJsRuntime()`，**唯一实现**
- `src/platform/web/jsSourcePlatform.ts:425-434` — `evaluateInline`（`new Function`）
- `src/platform/web/jsSourcePlatform.ts:436-485` — `evaluateInWorker`（真隔离，**零调用**）

| 能力 | Android 是否允许 | TS（inline 路径，生产实际） | TS（Worker 路径，死代码） | 差异后果 |
|---|---|---|---|---|
| **独立 JS realm（不共享全局）** | ✅ QuickJS 独立 context，与 App 的 JS 引擎完全隔离 | ❌ 同一 V8/JSC realm、同一 `globalThis` | ✅ 独立线程独立 realm | **书源代码与 App 同域同权** |
| **读 `localStorage`（PIN 哈希 / Z-Lib cookie）** | ❌ 无此能力 | ✅ `localStorage` 直接可读（已实测） | ❌ Worker 无 `localStorage` | **凭据全量泄露** |
| **读 `document.cookie`** | ❌ | ✅ | ❌ | 同上 |
| **任意 `fetch` / XHR 出网** | ⚠️ 仅能过 `sendMessage({method:'http'})`，受 OkHttp/Cronet + `insecureTls` 策略约束 | ✅ 原生 `fetch` 直连任意域，绕过所有封装（含超时/取消/代理/DNS 劫持防护） | ⚠️ Worker 内 `fetch` **仍存在** | 可直接外传上面读到的凭据 |
| **读 `indexedDB` / `caches` / `navigator` / `crypto`** | ❌ | ✅ | 部分（`crypto`/`caches` 有） | — |
| **DOM 操作** | ❌ 无 DOM | ✅ | ❌ | 书源可改 App 自身 DOM（含隐私遮罩） |
| **改写 App 自身状态** | ❌ | ✅ 同一 heap | ❌ | — |
| **内存上限 30/32 MiB** | ✅ QuickJS 硬限制 | ❌ **常量，从不强制** | ❌ | 恶意书源可 OOM |
| **栈上限 512 KiB** | ✅ | ❌ **常量，从不强制** | ❌ | 深递归打爆浏览器栈 |
| **45 s 执行预算** | ✅ `checkBudget()`（`SystemClock.elapsedRealtime`） | ⚠️ 仅当书源**主动调** `tick`/`__cialloTick` 时生效（实测 `while(true){}` 挂死） | ✅ 主线程 `setTimeout` + `terminate()` 兜底 | **主线程冻结 = UI 拒绝服务** |
| **循环/函数体自动插桩 `__cialloTick()`** | ✅ `instrument.js` 在执行前对 `sourceJs` 生效 | ❌ **插桩从未发生**（见 P0-2） | ❌（WORKER_BODY 无 acorn/instrument） | 预算可被绕过 |
| **`new Function` / `eval` 动态代码二次插桩** | ✅ `instrument.js:86-105` 包装 `Function` 四种形态 + `eval` | ❌（同上，插桩未装载） | ❌ | `new Function('while(1){}')` 同样挂死 |
| **正则回溯防护（4096 字符 / 2 MiB / 128 匹配 / 64 KiB 捕获）** | ✅ `__boundedRegex`+`__boundedRegexBatch` 是 native 绑定，**绕过不了** | ⚠️ 同左，但绑定是 no-op（P0-3）→ 实际失效 | ❌ | ReDoS |
| **脚本 512 KB / AST 10 万节点上限** | ✅ `instrument.js:46,53` | ❌ | ❌ | — |
| **Java 反射 / JNI 直达** | ❌ QuickJS 无 JVM 反射 | ❌/N/A | ❌ | — |
| **native 绑定面** | ✅ 仅 5 个，注册后 `writable:false,configurable:false`（`JsSourceEngine.kt:243-245`） | ⚠️ 0 个（no-op） | ❌ | 桥不存在 |

> **判定**：inline 路径在**每一行**都比 QuickJS 弱，且差距不是"程度"而是"类别"——
> 从"第三方代码被关在笼子里"变成"第三方代码与 App 平权"。

---

## 2. 书源 JS 的实际执行路径（调用链）

### 2.1 Android 权威链

```
用户导入/更新书源
  → JsSourceRepo.kt (脚本落盘)
  → JsComicSource.getEngine()
  → new JsSourceEngine(runtimeJs, sourceJs, sourceKey, context, insecureTls)
  → JsSourceEngine.call(jsCall)                       [JsSourceEngine.kt:79]
  → withRuntime { beginBudget(); … }                  [L56-64]
  → ensureReadyLocked() → initializeLocked()          [L181-358]
      → registerFunction('__cialloTick'|'__boundedRegex'|'__boundedRegexBatch')  [L190-238]
      → evaluate(acorn.js, instrument.js)             [L250-251]   ← 插桩装入
      → registerFunction('sendMessageSync'|'sendMessage')                       [L253-262]
      → evaluate(SYNC_OVERRIDE, PREAMBLE)
      → evaluate(instrument(sourceJs), 'source.js')   [L271]        ← ★书源在此执行
  → quickJs.evaluate(instrument(call.js))             [L138]        ← ★每次调用
```

★ 两处都在 **QuickJS 独立 context** 内。

### 2.2 TS 实际链（逐跳）

| 跳 | 文件:行 | 代码 |
|---|---|---|
| 1 | `src/core/source/js/jsComicSource.ts:222-244` | `getEngine()` → `deps.createEngine(veneraRuntime(), this.script, sourceKey, insecureTls)` |
| 2 | `src/core/source/js/jsComicSource.ts:109-115` | `JsComicSourceDeps.createEngine` — **端口，未接线** |
| 3 | `src/core/source/js/jsSourceEngine.ts:78` | `constructor(runtimeJs, sourceJs, sourceKey, deps, insecureTls)` |
| 4 | `src/core/source/js/jsSourceEngine.ts:164-181` | `call(jsCall, signal)` → `withRuntime(...)` |
| 5 | `src/core/source/js/jsSourceEngine.ts:126-140` | `withRuntime` → `mutex.acquire()` → `beginBudget()` → `block()` |
| 6 | `src/core/source/js/jsSourceEngine.ts:166` | `await this.ensureReadyLocked()` → `initializeLocked()` |
| 7 | `src/core/source/js/jsSourceEngine.ts:233-262` | `runtime.registerFunction('__cialloTick'…)` / `('sendMessageSync')` / `registerAsyncFunction('sendMessage')` |
| 8 | `src/platform/web/jsSourcePlatform.ts:496-502` | **`registerFunction(): void {}` / `registerAsyncFunction(): void {}`** → 全部丢弃 |
| 9 | `src/core/source/js/jsSourceEngine.ts:247-251` | `runtime.evaluate(acorn,'acorn.js')` / `evaluate(instrumentAsset,'instrument.js')` → **`evaluateInline`** |
| 10 | `src/platform/web/jsSourcePlatform.ts:504-508` | `evaluate(code)` → **`return evaluateInline(code)`** |
| 11 | `src/platform/web/jsSourcePlatform.ts:425-434` | **`const factory = new Function(TICK,'tick','"use strict";\n'+code); factory(inlineTick, inlineTick)`** ← **主线程、同一 realm** |
| 12 | `src/core/source/js/jsSourceEngine.ts:272` | `runtime.evaluate(this.instrument(this.sourceJs),'source.js')` |
| 13 | `src/core/source/js/jsSourceEngine.ts:116-123` | `instrument()` → `quickJs.evaluate('__cialloInstrument(...)')` → **返回 `null`** |
| 14 | `src/core/source/js/jsSourceEngine.ts:121` | **`throw new Error('JS instrumentation failed')`** ← 引擎在此终止 |

### 2.3 明确回答：**生产路径是 inline，不是 Worker。**

证据（全仓穷举，排除 `node_modules`/`dist`/`.git`/`ios/App/App/public`）：

```
evaluateInWorker 出现位置：
  docs/PARITY_EXCEPTIONS.md:39, :53      ← 文档
  docs/WEB_PORT_GUIDE.md:190             ← 文档
  src/platform/web/jsSourcePlatform.ts:321, 392, 436, 510, 513   ← 定义本身
  → 调用点：0
```

同时确认：
- `createWebJsRuntime` 全仓唯一调用者是 `tests/unit/jsSourcePlatform.test.ts`。
- `JsRuntime` 全仓唯一实现是 `createWebJsRuntime`。
- `JsSourceEngineDeps` / `deps.createEngine` 在 `src/` 内**没有任何实现**。
- `JsComicSource` / `JsSourceRepo` / `SourceViewModel` 在 `src/` 内**没有任何构造点**。
- `App.tsx:176` 挂载 `<SourceManagementPage />` **不传 `io`**，落到 `NULL_SOURCE_IO`（`SourceManagementPage.tsx:162-186`），`jsComicSource: () => null`。

**因此当前状态下书源 JS 尚不可达（P0-1 是"接线即爆发"的潜伏缺陷，不是正在被利用的漏洞）。** 但这不构成缓解——一旦有人按 Android 的样子把 `createEngine` 接上，下面 2.4 的三个缺陷会同时引爆。

### 2.4 inline 路径的三个独立致命缺陷（均已实测）

**(a) `evaluate` 丢失完成值 → 引擎无法初始化（P0-2）**

`new Function(args, body)` 产生的是**函数**，body 的完成值被丢弃；Kotlin 的 `quickJs.evaluate` 求的是**程序**的完成值。`JsSourceEngine` 全程 1:1 照抄 Kotlin，**从不加 `return`**。

实测：
```
new Function('"use strict";\nJSON.stringify({a:1})')()   →  undefined
new Function('"use strict";\nreturn JSON.stringify({a:1})')() → '{"a":1}'
```
→ `evaluateInline` L432-433 把 `undefined` 归一成 `null` → `instrument()` L121 必抛 → `initializeLocked()` 在 L272 终止。

受影响的还有 L299（`globalThis.__veneraDefaults`）、L277-289（类名发现 IIFE）、`call()` L169、`transformImage()` L198。

> 注意：`tests/unit/jsSourcePlatform.test.ts:62-67` 的断言写的是 `rt.evaluate('return 1 + 1;')` —— **调用方自带 `return`**。测试与 `JsSourceEngine` 的实际用法不一致，所以门禁全绿而实现是坏的。

**(b) `registerFunction` 是 no-op → 桥不存在（P0-3）**

`jsSourcePlatform.ts:496-502` 两个方法都是空实现。后果：`sendMessageSync`、`sendMessage`、`__cialloTick`、`__boundedRegex`、`__boundedRegexBatch` **全部未定义**。`SYNC_OVERRIDE` 里 `ComicSource.prototype.loadData` 一被调用就 `ReferenceError`。

**(c) 顶层 `await` 无法编译 → `call()` 永远不可能工作**

`CALL_WRAPPER`（`jsSourceEngine.ts:438`，首行即 `await`）与 `INIT_CALL`（L557，内部 `:559` 有 `await`）都用顶层 `await`。`jsSourcePlatform.ts:7` 的注释声称运行时"built from `new Function` / `AsyncFunction`"，但 `evaluateInline` **只用 `new Function`**，且 `JsRuntime.evaluate` 是同步签名。

实测：
```
new Function(body 含顶层 await)   → ReferenceError: await is not defined（编译期就挂）
new AsyncFunction(body 含顶层 await) → 编译通过
```

**(d) 附带：没有插桩 = 预算形同虚设（P0-4）**

`instrument.js`（`public/js_safety/instrument.js:56-68`）会往每个循环/函数/catch 的 body 首行插 `__cialloTick();`。inline 路径因 (a) 从未装载它。所以唯一的护栏是 `tick` 参数——**书源不调就不计费**。实测 `rt.evaluate('while (true) { }')` 会挂死主线程。现有单测 L71 `rt.evaluate('while (true) { tick(); }')` 自己调了 `tick`，把这个洞盖住了。

### 2.5 `public/venera/worker-entry.ts` 是另一条路，也不是生产路径

`veneraBridge.ts` + `veneraWorker.ts`（Q8 文字所指）同样是 **0 生产调用点**，且 `tests/unit/veneraBridge.test.ts:13` 把 `createVeneraWorker` mock 掉了——真实 Worker 在测试里也从未运行。

即使接上，`veneraWorker.ts:333-346` 用 `new Function(...)` 在 Worker realm 内建宿主函数，同样会继承 Worker 全局（Worker 有 `fetch`，只是没有 `localStorage`/`document`），且无 acorn/instrument 插桩。

---

## 3. XSS / HTML 注入全表

### 3.1 `dangerouslySetInnerHTML` — 全 `src/` 仅 3 处

| 文件:行 | 喂入内容 | 判定 | 理由 |
|---|---|---|---|
| `src/ui/components/comic/sheets/ComicIcon.tsx:109` | `GLYPHS[props.name] ?? '<circle …/>'` | ✅ **安全** | `GLYPHS` 是 `ComicIcon.tsx:19-91` 的**模块级字面量常量表**，`props.name` 只做查表，命中不了就是默认圆点。书源数据不参与。 |
| `src/ui/components/SourceAvatar.tsx:46`（`LiquidBlob`） | `liquidBlobSvg(...)` | ✅ **安全** | `src/core/glass/liquidBlob.ts:23-65` 只做 `Math.hypot` 与模板拼接，插入的 `from.x/to.x/radius/intensity` 全部是滑块位置的数字。 |
| `src/ui/components/SourceAvatar.tsx`（`SourceAvatar` 组件本体） | — | ✅ **安全** | 首字母走 `{letter}` 文本节点 + CSS `background`。**书源名不进 innerHTML。** |

### 3.2 书源 HTML → 渲染

- `src/core/parser/htmlToText.ts:3-16` — `extractCleanTextFromHtml` 只走 `parseHtml`（纯 TS DOM）+ `walkClean` 抽**文本节点**，`removeNodes` 先删掉 `script/style/head/rt/rp`。输出是纯文本。
- `src/ui/pages/NovelReaderOnlinePage.tsx:600,637` — 正文经 `extractWithRule(html, ruleContent, extractCleanTextFromHtml(html))` 后 `setText()`。
- `src/ui/pages/NovelReaderOnlinePage.tsx:313-321` — `text.split('\n\n')` 后作为 **JSX 文本节点**渲染。

**判定：书源 HTML 的 `<script>` / `onerror=` / `javascript:` 不会执行。** React 文本节点自动转义，全链无 `innerHTML`。

### 3.3 书源配置渲染

书源名、分组名、书名、章节名一律走 JSX `{expr}`：

| 位置 | 判定 |
|---|---|
| `src/ui/pages/SourceManagementPage.tsx:498`（书源日志 `{debugLogText}`） | ✅ 安全（文本节点）。`debugLogText` 来自 `io.sourceLog().dump()`，含书源 URL/HTML 片段，全转义 |
| `src/ui/pages/LibraryPage.tsx:1960`（登录 `{props.message}`） | ✅ 安全 |
| `src/ui/pages/NovelReaderOnlinePage.tsx:610`（`setError` → `{error}`） | ✅ 安全 |
| `src/ui/components/source/SourceAvatar.tsx:89`（书源名首字母） | ✅ 安全 |
| 章节名 / 书名 / 分组名（`ComicChaptersPage`、`LibraryPage`、`BookshelfPage` 等） | ✅ 安全，均为 JSX 文本节点 |

**结论：`src/` 内没有任何一处把书源配置字段喂进 `innerHTML`。**

### 3.4 书源头像 / 封面 URL

| 路径 | scheme 校验 | 判定 |
|---|---|---|
| `src/core/source/impl/jsonBookSource.ts:719-724` `validateUrl` | 拒 `javascript:` / `file:`；**未拒 `data:`** | ⚠️ `data:text/html` 可过，但只进 `<img src>` / `fetch`，**不执行** |
| `src/core/source/impl/jsonBookSource.ts:726-739` `resolveUrl` | L727-735 **原样返回** `javascript:` / `file:` | ⚠️ 若该路径未被 `validateUrl` 前置过滤，`javascript:` 可直达 `<img src>` / 导航 → **P2** |
| `src/core/source/js/jsSourceRepo.ts:631` | MXS 补丁里 `/^(data:|javascript:)/i` 过滤 | ✅ 仅覆盖 MXS |
| `src/core/source/js/jsComicSource.ts` | **全文无 scheme 校验** | ⚠️ JS 书源提供的封面/图片 URL 无过滤 → **P2** |

**关于 `javascript:` / `data:text/html` 的实际危害判定**：
- `<img src="javascript:…">` — 现代浏览器**不执行**（规范禁止非 http/https/data/blob 的 img 导航执行）。
- `<img src="data:text/html,…">` — 只当图片解码，**不执行**。
- 真正的执行向量是 `<a href>` / `<iframe>` / `window.open` / `location.href`。全 `src/` **零 `<iframe>` JSX、零 `srcdoc`、零 `location.assign`**。

**判定：无实际可执行注入路径。** 但缺 scheme 校验仍是纵深防御缺口，记 P2。

### 3.5 外链打开（`window.open`）3 处

| 文件:行 | URL 来源 | 判定 |
|---|---|---|
| `src/ui/components/source/ZLibraryLoginDialog.tsx:365` | `source.getRegistrationUrl()` | ✅ 安全。`JsComicSource.getRegistrationUrl()`（`jsComicSource.ts:180-195`）过 `validRegistrationUrl()`；`ZLibrarySource.getRegistrationUrl()`（`zLibrarySource.ts:256-259`）硬编码 `https://${domain}/registration` |
| `src/ui/pages/LibraryPage.tsx:1981` | `Z_LIBRARY_REGISTRATION_URL` 常量 | ✅ 安全 |
| `src/ui/pages/SettingsPage.tsx:389` | `GITHUB_LATEST_URL` / `GITHUB_RELEASES_URL` 常量 | ✅ 安全 |

`src/core/source/sourceRegistration.ts:8-21` `validRegistrationUrl` 只放行 `http:`/`https:` 且拒绝带 userinfo 的 URL —— 这正是 Kotlin `toHttpUrlOrNull()` 的等价物，做得对。

---

## 4. 凭据存储与加密评估

### 4.1 Z-Library 凭据链

```
ZLibraryCredentialStorage          [zLibraryCredentialStorage.ts:100-164]
  → ZLibraryCredentialStore         [同上 :74-98]
    → EncryptedSecretStore          [encryptedSecretStore.ts:22-81]
      → SecureStore                  [platform/interfaces.ts:38-42]
        ├─ ios-native: PreferencesSecureStore  ← NSUserDefaults 明文
        └─ web-mock:   MemorySecureStore        ← 内存
```

| 维度 | Android | iOS (TS) | 判定 |
|---|---|---|---|
| 存储后端 | `EncryptedSharedPreferences` | Capacitor `Preferences` | ❌ |
| 密钥 | `MasterKey(AES256_GCM)`，Android Keystore 硬件/安全区 | **无密钥** | ❌ |
| Key 加密 | `AES256_SIV` | 无 | ❌ |
| Value 加密 | `AES256_GCM` | 无 | ❌ |
| 落盘形态 | 密文 | `NSUserDefaults` 明文 plist | ❌ |
| 失败语义 | keystore 失败 → 读 null / 写抛 | ✅ `EncryptedSecretStore.ts:60-62` 已保留 | ✅ |
| 存储内容 | `userId` / `userKey` / `domain` / `cookies`（`zLibraryCredentialStorage.ts:171-177`） | 同 | — |

**P1-1**：`src/platform/ios-native/index.ts:20-33` `PreferencesSecureStore` 直连 `Preferences.get/set`。注释（`encryptedSecretStore.ts:4-5`）写的是"platform `SecureStore`（Capacitor Preferences / MemorySecureStore）"，**没有承认这是明文**，与 Android 的加密语义不等价却未登记为 parity exception。

> 注：登录**密码**本身不落盘（只存 `remix_userid`/`remix_userkey`/cookie），但 `remix_userkey` 等价于长期会话令牌，泄露即可直接冒用登录态。

### 4.2 PIN 哈希存储

`pinKdf.ts` 的 `PinStore` 走 `PrivacyPrefs`（`SharedPreferences` 形状），非 `EncryptedSecretStore`。
- Android：`context.getSharedPreferences("privacy_prefs", MODE_PRIVATE)` —— 同样明文。
- **判定：与 Android 一致，非降级。** 存的是 PBKDF2 输出，不是明文 PIN，可接受。

### 4.3 备份文件

`src/core/backup/backupArchive.ts:86-114` — `zipSync` 明文 ZIP，无密码、无加密。

- Android：`BackupArchive.kt` 同样用 `ZipOutputStream`，**明文**。
- **判定：一致，非移植缺陷。** 记 P2（已接受）。
- 缓解：`src/core/backup/safeSetting.ts:6-13` 导出前用 `/(cookie|token|password|credential|secret|api.?key|pin_|salt|auth)/i` 过滤设置项 —— 排除了 `pin_*`/`salt`，做得对。
- `validateRestoreHeader`（L116-120）锁 `version===1 && schema===12`；`validateRestoredRow`（L122-177）逐列校验类型 + 列数双向一致；`MAX_ROWS` 上限；SQL 用参数化 + `"${table}"` 白名单（`BACKUP_TABLES_ORDER`）。**未发现注入。**
- 缺口：`encodeSettingsPayload:61` `obj[entry.key] = …`，若 key 为 `__proto__` 会改原型；实际 key 来自 App 自身设置且过 `isSafeSettingKey`，风险极低，仍记 P2。

---

## 5. PIN KDF 评估（含常数时间比较）

### 5.1 逐项对照

| 项 | Android `PrivacyManager.kt` | TS `pinKdf.ts` | 判定 |
|---|---|---|---|
| PIN 长度 | `PIN_LENGTH = 6`（L24,121） | `PIN_LENGTH = 6`（L12,19-21） | ✅ |
| 格式 | `all { it in '0'..'9' }`（L121） | `/^[0-9]+$/` + 长度（L19-21） | ✅ |
| **PBKDF2 迭代** | `PBEKeySpec(pin, salt, 120_000, 256)`（L114） | `iterations: 120_000`（L90），`PIN_KDF_ITERATIONS = 120_000`（L13） | ✅ **120000 一致** |
| **PBKDF2 PRF** | `PBKDF2WithHmacSHA1`（L116） | `hash: 'SHA-1'`（L91） | ✅ **SHA-1 一致（照搬 Android）** |
| 输出位长 | `256`（L114） | `PIN_KDF_BITS = 256`（L14,94） | ✅ |
| **salt 长度** | `ByteArray(16)`（L38） | `PIN_SALT_BYTES = 16`（L15），且 `newSaltHex` 校验 `!== 16` 抛错（L25-27） | ✅ |
| **salt 随机源** | `SecureRandom().nextBytes`（L39） | `crypto.getRandomValues`（L31-35） | ✅ **真随机 CSPRNG** |
| 旧算法兼容 | `hashPin` = SHA-256(salt‖pin)（L29-35） | `hashPinLegacy`（L62-70），同拼接顺序 | ✅ |
| KDF 版本标记 | `pin_kdf_version`（L61,86,99） | `KEY_PIN_KDF_VERSION`（L246,294） | ✅ |
| 旧哈希升级 | 验证成功后重算（L86） | L158-161 | ✅ |
| 失败计数 | `pin_failures` ≥5 → `+30_000ms`（L80-82） | `PIN_MAX_FAILURES=5` / `PIN_RETRY_AFTER_MS=30_000`（L16-17,296-306） | ✅ |
| 冷却检查 | L73 | L141-143 | ✅ |
| salt 合法性 | `salt.length != 32 \|\| any { digitToIntOrNull(16) == null }`（L72） | `salt.length !== 32 \|\| !/^[0-9a-fA-F]+$/`（L138） | ✅ |

### 5.2 常数时间比较 — **通过**

`pinKdf.ts:100-109`：
```ts
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;      // 与 Kotlin L76 一致：长度不符提前返回
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;                              // 与 Kotlin L77-79 的 OR-diff 循环同构
}
```

- ✅ XOR 累积 + 末尾判定，无早退。
- ✅ 长度检查提前返回 —— 这**正是** Kotlin L76 的行为。`pinKdf.ts:146-153` 的注释说明第一版 TS 曾误把它记为一次失败尝试，已修正，与 Android 语义对齐。
- ⚠️ **残余（不可修，P2/P3）**：JS 引擎无法保证 `charCodeAt` / 位运算不被 JIT 特化，与所有 Web 实现的固有处境相同。Android 侧同样只是"基本形态"（Kotlin L67 注释原话）。**不作为发现登记**，仅记录评估。

### 5.3 密码学强度评估

- PBKDF2-HMAC-**SHA1** 120k 轮：OWASP 2023 建议 SHA-256 / 600k。但**必须与 Android 一致**才能让同一份备份/迁移跨平台可用。这是**已批准的一致性取舍**，不报为缺陷。
- 6 位数字 PIN = 10⁶ 密钥空间。即便 120k 轮，离线爆破成本约 10⁶ × PBKDF2 ≈ 数小时到数天（现代 GPU）。**Android 侧完全相同。** 建议在 `docs/PARITY_EXCEPTIONS.md` 登记为"继承性密码学弱点"，但不阻塞发布。
- ✅ salt 真随机、每次 `changePin`/`enableWithPin` 都重新生成（`pinKdf.ts:170,201`）。

**PIN KDF 结论：无发现，移植忠实。**

---

## 6. 书源导入面攻击评估

对照 `SourceImporter.kt` ↔ `src/core/source/importer/sourceImporter.ts`。

### 6.1 JSON 解析安全

| 攻击 | 防护 | 位置 | 判定 |
|---|---|---|---|
| **超深嵌套 → 栈溢出** | `validateJson` 先扫一遍字符串，深度 > `MAX_JSON_DEPTH = 64` 直接抛 | `src/core/parser/ruleBudget.ts:19-42`，被 `sourceImporter.ts:265` 调用 | ✅ 有防护 |
| **超大输入** | `MAX_JSON_CHARS = 2 MiB`（`ruleBudget.ts:3,20`）+ `MAX_SOURCE_BODY_BYTES` / `readBounded`（`sourceImporter.ts:186,211`） | ✅ |
| **批量数量爆炸** | `array.length > 1000` 抛错（`sourceImporter.ts:268`） | ✅ |
| **规则串过长** | `validateRule`：`MAX_RULE_LENGTH = 4096` / `MAX_NESTING = 128`（`ruleBudget.ts:6-17`） | ✅ |
| **`__proto__` 污染** | `parseBatch` 用 `JSON.parse`（自有属性，不改原型）→ `isJsonObject` 校验 → `parseRuleObject` 只 `JSON.parse` 子串成对象 → `optString`/`keys` 只读。全 `src/` **零** `Object.assign(…, untrusted)`、零 `constructor.prototype` 写法 | grep `__proto__` 仅命中 `sharedPreferencesSourceStorage.ts:114-116` 的**防御性注释** | ✅ **无污染路径** |
| 畸形 JSON | `parseJsonArrayOrThrow` / `parseJsonObjectOrThrow` + `SyntaxError` 分支（`sourceImporter.ts:264-302`） | ✅ |

### 6.2 导入时是否执行 `js:`？—— **不会**

`sourceImporter.ts:558-567`：
```ts
if (allRules.includes('@js:') || allRules.includes('{{java.') ||
    allRules.includes('webView')   || allRules.includes('@js') ||
    allRules.includes('webJs')    ||
    (optString(ruleContent,'sourceRegex','') ?? '').trim() !== '') {
  return { source: null, rawJson, name, reason: '包含 JS 脚本/WebView 嗅探，暂不支持' };
}
```
加上 `convertLegadoUrl:698` / `postUrl:716` 的 `url.includes('@js:') || url.includes('webView') → null`。

- ✅ 导入阶段**纯字符串/纯 JSON 处理**，零 `eval`、零 `new Function`、零 `Function()`。
- ✅ 整条 `importer/**` 不 import 任何 JS 引擎（无 `jsSourceEngine`、无 `veneraBridge` 引用）。

### 6.3 导入时是否会请求书源配置的 URL？—— **不会**

- `importFromJsonString`（L163）、`importBatchFromJsonString`（L172）、`importFromUri`（L177）、`importBatchFromUri`（L202）：**纯本地**，只读用户选的文件。
- 唯一发网络的入口是 `importBatchFromUrl`（L223-249），**必须用户显式输入/选择 URL** 才触发，且只请求那**一个** URL。
- `convertLegadoSource` 把 `searchUrl` 存进 `createHtmlSearchRule({url})` / `createSearchRule({url})`，**不在导入时求值**。

**判定：导入面无攻击。**

### 6.4 残余风险（已知设计）

书源 JSON 可以把 `searchUrl` / `bookSourceUrl` 指到 `http://127.0.0.1:…` 或内网地址（SSRF）。Android 侧同样不拦（靠 Android cleartext policy 默认阻断 http）。iOS ATS 默认也阻断 http（见 §7）。记 **P2**，不阻塞。

---

## 7. Capacitor / iOS 配置评估

### 7.1 `capacitor.config.json`

仓库里是 **`capacitor.config.json`**（不是任务描述里的 `.ts`）。根目录 `capacitor.config.json` 与 `ios/App/App/capacitor.config.json` 内容一致。

| 键 | 值 | 判定 |
|---|---|---|
| `appId` | `com.aistudio.ciallo.reader` | — |
| `webDir` | `dist` | ✅ 本地 bundle，非远程 URL（**关键**：若配 `server.url` 指向远端则整个 App 可被远程劫持） |
| **`server`** | **完全未配置** | ✅ **最好情况** |
| `server.allowNavigation` | 未配 | ✅ 无 `allowNavigation` → 不允许任意外域 |
| `server.androidScheme` | 未配 | ✅ iOS 默认 `capacitor://localhost` |
| `plugins.Browser` | 未配 | ✅ 无自动打开任意 URL 的插件配置 |
| `packageClassList`（仅 iOS 那份） | `CAPBrowserPlugin` 在列 | ⚠️ 插件已编入，但**代码里无 `Browser.open` 调用**（grep 无命中）→ 不可达 |

**判定：`capacitor.config.json` 无 `server` 配置 = 攻击面最小化，正确。**

### 7.2 iOS ATS（App Transport Security）

`ios/App/App/Info.plist` — **没有 `NSAppTransportSecurity` 键**。

| 判定 | 说明 |
|---|---|
| ✅ **默认严格 ATS 生效** | `NSAllowsArbitraryLoads` 未设 → 默认 `NO`。明文 HTTP 一律被拦。这是**优于**很多 Capacitor 模板的状态 |
| ✅ 无 `NSAllowsLocalNetworking` | 局域网例外也没开 |
| ⚠️ P2 功能缺口 | 书源普遍用 `http://`；Android 侧有 `insecureTls` 逃生门（`JsSourceEngine.kt:24`、`jsMessageHandler.ts`），iOS 侧无对应豁免 → 这类书源会全挂。**这是功能问题不是安全问题**，建议登记 parity exception |

其他 plist 项：`UIRequiredDeviceCapabilities` = `armv7`（过时，应为 `arm64`）；无 `NSLocalNetworkUsageDescription`；无后台模式声明。

### 7.3 外链跳转

见 §3.5 —— 3 处 `window.open` 全部 http/https 受控或常量。

`jsMessageHandler.ts:1215-1217` —— `UI.launchUrl` **被显式忽略**（只打日志），与 Kotlin 一致且是安全的默认。

### 7.4 CSP

`index.html:1-16` **无 `<meta http-equiv="Content-Security-Policy">`**，vite/tsconfig 也没注入。无 CSP 意味着即便未来引入 XSS 也没有第二道防线。记 **P2**，建议加：
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; img-src 'self' data: blob: https: http:; connect-src *; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'" />
```
（注：`blob:` 必须放行，否则 §2.4 的 Worker 路径与 Vite dev 都起不来；`script-src 'unsafe-inline'` 是现有内联 bootstrap 的现状所迫。）

---

## 8. 发现清单（按严重度排序）

### 🔴 P0-1 — Q8 Worker 隔离为死代码；书源 `@js:` 生产路径是主线程 inline `new Function`

**位置**：`src/platform/web/jsSourcePlatform.ts:425-434`（`evaluateInline`）、`:496-502`（no-op 注册）、`src/core/source/js/jsSourceEngine.ts:169,198,247-312`（全部走 `.evaluate`）
**现状**：`evaluateInWorker` 全仓 0 调用点；`JsSourceEngine` 唯一的求值入口是 `evaluate` → `new Function`，与 App 同 realm、同线程。
**危害**：第三方书源 `@js:` 可读 `localStorage`（含 `privacy_pin_hash`/salt、Z-Lib `userKey`/`cookies`）、`document.cookie`、`indexedDB`，可直接 `fetch` 外传；可改写 App 自身 DOM 绕过隐私遮罩。
**当前可达性**：**未接线**（`App.tsx:176` 传 `NULL_SOURCE_IO`）。属"接线即爆发"。
**修法**（精确到行）：
1. `src/core/source/js/jsPlatform.ts:149` — 把
   `evaluate(code: string, filename: string): string | null;`
   改成 `evaluate(code: string, filename: string): Promise<string | null>;`
2. `src/core/source/js/jsSourceEngine.ts:117`（`instrument`）、`:169`（`call`）、`:198`（`transformImage`）、`:247/:249/:251/:264/:265/:267/:269/:271/:272/:277/:297/:299/:312`（`initializeLocked` 的 13 处 `runtime.evaluate`）— 全部 `await`。
3. `src/core/source/js/jsSourceEngine.ts:230-313` `initializeLocked` 改为 `async`；`:312` `runtime.evaluate(INIT_CALL, …)` 加 `await`。
4. `src/platform/web/jsSourcePlatform.ts:504-508` `evaluate` — **删除 `evaluateInline` 调用**，改为：
   ```ts
   async evaluate(code, _filename = 'inline.js') {
     if (disposed) throw new Error('JS 书源运行时已释放');
     if (startedAt === null) startedAt = performance.now();
     return evaluateInWorker(code, _filename);   // 真隔离，Q8
   }
   ```
5. `src/platform/web/jsSourcePlatform.ts:496-502` `registerFunction/registerAsyncFunction` — 实现为把 `{name, fn}` 记入 pending 绑定表，在 `WORKER_BODY` 的 `{op:'register'}` 分支里**通过 `postMessage` 回主线程 RPC**（Worker 内不能持有主线程函数引用）。同步桥（`sendMessageSync`）无法跨线程 → **必须把 `SYNC_OVERRIDE` 改成 `AsyncFunction` + `await sendMessage(...)`**（见 P0-3 修法 3）。
6. **若无法完成 1-5**：至少在 `createWebJsRuntime` 里 `throw new Error('JS 书源运行时未接线')` 而不是静默走 inline，让"看起来能用其实没隔离"变成显式失败。
7. `tests/unit/jsSourcePlatform.test.ts:63-99` — 所有 `forceInlineFallback: true` 用例需改为断言"inline 路径已移除/抛错"，并补一条 Worker 隔离回归测试：`rt.evaluate('return typeof localStorage')` 必须返回 `'undefined'`。

### 🔴 P0-2 — inline `evaluate` 丢失程序完成值 → 引擎无法初始化

**位置**：`src/platform/web/jsSourcePlatform.ts:425-434`
**现状**：`new Function(args, body)` 产生函数，body 完成值被丢弃；返回 `undefined` → L432-433 归一为 `null` → `jsSourceEngine.ts:121` 抛 `'JS instrumentation failed'`。
**实测**：`new Function('"use strict";\nJSON.stringify({a:1})')()` → `undefined`。
**修法**（与 P0-1 合并修）：Worker 路径 `WORKER_BODY:361-371` 已经正确用 `postMessage({id, ok, value: encode(value)})` 回传完成值 —— 只要让 `evaluate` 走 Worker，本条自动消失。若必须保留 inline 兜底，最小修法是给 `evaluateInline` 的 body 末尾包一层 IIFE 显式 return：
```ts
const factory = new Function(JS_RUNTIME_TICK_NAME, 'tick',
  '"use strict";return (function(){' + code + '\n}).call(this);');
```
但这**不解决安全性**（P0-1），只解决可用性 —— 且顶层 `await` 仍不可编译（P0-3）。

### 🔴 P0-3 — `registerFunction` no-op + 顶层 `await` 无法编译 → 桥接层与 `call()` 均不存在

**位置**：`src/platform/web/jsSourcePlatform.ts:496-502`；`src/core/source/js/jsSourceEngine.ts:438`（`CALL_WRAPPER`，首行即 `await`）、`:559`（`INIT_CALL` 内的 `await`）
**实测**：`new Function(body 含顶层 await)` → `ReferenceError: await is not defined`（编译期）。
**修法**：
1. `jsSourcePlatform.ts:496-502` 实现真正的绑定注册（见 P0-1 修法 5）。
2. `src/core/source/js/jsPlatform.ts:147-161` `JsRuntime` 增加 `evaluateAsync(code, filename): Promise<string|null>`，或把 `evaluate` 直接改 async（见 P0-1 修法 1）。
3. `src/core/source/js/jsSourceEngine.ts:566-735` `SYNC_OVERRIDE` — `sendMessageSync` 跨线程不可行。把   `ComicSource.prototype.loadData = function (dataKey) { let raw = sendMessageSync({...}); ... }`
   改为 `async function` + `await sendMessage({...})`（`loadData`/`saveData`/`deleteData`/`loadSetting`/`isLogged` getter、`Convert.*`、`createUuid`/`randomInt`/`randomDouble`、`HtmlDocument.*`/`HtmlElement.*`/`HtmlNode.*`、`Image.*` 共约 45 处）。注意 `Object.defineProperty(ComicSource.prototype,'isLogged',{get(){...}})` 的 getter 不能 `await` → 改为在 `initializeLocked` 里 `await` 一次 `sendMessage({method:'isLogged'})` 后缓存到实例字段。
4. `jsSourceEngine.ts:438` `CALL_WRAPPER` 顶部 `await` 与 `:559` `INIT_CALL` 内的 `await` — 在 Worker 里 `new Function` 同样编译不过顶层 `await`。**修法**：把 `WORKER_BODY:363` 改成
   ```js
   const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
   const fn = new AsyncFunction('__cialloTick','tick','__fns','__asyncFns', d.code);
   const value = await fn(tick, tick, fns, asyncFns);
   ```
   并让 `encode` 之外再 `self.postMessage({id, ok:true, ticks, value: encode(value)})`（`await` 后再回传）。
5. `public/js_safety/instrument.js:99-102` 的 `wrapConstructor` 已经覆盖四种 `Function` 形态，但**没有**覆盖 `AsyncFunction` 构造器本身 —— 第 4 条改动会让 `new AsyncFunction` 绕过插桩。需在 `instrument.js:100` 后追加 `wrapConstructor` 的 async 变体包装，或在 `WORKER_BODY` 里显式把 `AsyncFunction` 指向已包装版本。

### 🔴 P0-4 — 无插桩 ⇒ 45 s 预算可绕过 ⇒ 主线程冻结

**位置**：`public/js_safety/instrument.js:56-68`（循环/函数插桩）；`src/platform/web/jsSourcePlatform.ts:416-423`（`inlineTick`）
**现状**：插桩依赖 `instrument()`，而 `instrument()` 因 P0-2 抛错；inline 只把 `tick` 当参数绑上。
**实测**：`rt.evaluate('while (true) { }')` 挂死。
**修法**：随 P0-1/P0-2/P0-3 一并解决（Worker 路径下插桩在 `WORKER_BODY` 内执行，且主线程 `setTimeout`+`terminate()` 兜底）。同时**补测试**：
```ts
it('an uninstrumented busy loop is terminated by the worker watchdog', async () => {
  const rt = createWebJsRuntime({ budgetMs: 50 });
  await expect(rt.evaluate('while (true) {}', 'loop.js')).rejects.toThrow(/书源脚本执行超时/);
  rt.dispose();
});
```
并**修正** `tests/unit/jsSourcePlatform.test.ts:71` —— 现有 `rt.evaluate('while (true) { tick(); }')` 自己调了 `tick`，掩盖了真实缺口。

### 🟠 P1-1 — Z-Library 凭据落 iOS `NSUserDefaults` 明文（Android 为 `EncryptedSharedPreferences`）

**位置**：`src/platform/ios-native/index.ts:20-33` `PreferencesSecureStore`
**现状**：`Preferences.set` 直写 UserDefaults。Android 侧 `EncryptedSecretStore.kt` 用 `MasterKey(AES256_GCM)` + `AES256_SIV`(key) + `AES256_GCM`(value)。
**危害**：设备备份/iTunes 拷贝/越狱/文件系统取证可直接读出 `userKey` 与 `cookies`（`zLibraryCredentialStorage.ts:171-177`），等价于长期会话令牌。
**修法（推荐）**：`src/platform/ios-native/index.ts` 新增 `KeychainSecureStore implements SecureStore`，用 Capacitor 自定义插件调 Security.framework：
- key：`kSecClassGenericPassword`，`kSecAttrService = "app_secure_secrets"`（与 Android `EncryptedSharedPreferences.create(app,"app_secure_secrets",…)` 对齐），`kSecAttrAccessible = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`（**必须 `ThisDeviceOnly`**，避免进 iCloud 备份）。
- `createIosNativePlatform():89` 把 `secure: new PreferencesSecureStore()` 换成 `new KeychainSecureStore()`。
- 参考已有 Swift 插件范式 `ios/App/App/Plugins/TtsPlugin.swift`。
**修法（次选，若不做原生）**：立即在 `docs/PARITY_EXCEPTIONS.md` 登记新条目，把 `PreferencesSecureStore` 标为"⚠️ 明文，弱于 Android"，并把 `encryptedSecretStore.ts:4-5` 的注释改成如实描述。

### 🟠 P1-2 — 30 MiB / 512 KiB 上限是死常量，从不强制

**位置**：`src/platform/web/jsSourcePlatform.ts:298-300`（常量）、`:487-488`（暴露为 `memoryLimit`/`maxStackSize`）；`jsSourceEngine.ts:38-41`（同名常量同样未使用）
**现状**：全仓无任何读取点做判定。
**修法**：Worker 路径下于 `WORKER_BODY` 内加配额：主线程用 `{op:'eval', bytes: code.length}` 传字节数，Worker 内 `if (bytes > MAX) throw`；运行期用 `performance.memory`（Chrome 限定）做软监控，超限即 `terminate()`。栈深则在 `instrument.js` 的 `visit` 里对 AST 深度计数（Android 侧靠 `maxStackSize`，浏览器无等价物 → 至少记 P2）。**或在 E33 里如实写明"内存/栈上限未强制"。**

### 🟠 P1-3 — `PARITY_EXCEPTIONS.md` E33/E40 陈述失实

**位置**：`docs/PARITY_EXCEPTIONS.md:39`（E33）、`:53`（E40）
**现状**：两处都写"并提供 `evaluateInWorker` 可进入 Worker"、"如需真正隔离请强制走 `evaluateInWorker`"，暗示该缓解可用。实测 0 调用点。
**修法**：在 P0-1 修复前，把两处的缓解措施列改为「⚠️ **未接线**：`evaluateInWorker` 无调用点；`JsSourceEngine` 全部经 `evaluate` → inline `new Function`」；修复后改为「✅ 已接线，`JsRuntime.evaluate` 直接走 Worker」。

### 🟡 P2-1 — 无 CSP
**位置**：`index.html:1-16`
**修法**：加 §7.4 的 `<meta http-equiv="Content-Security-Policy" …>`。必须含 `worker-src 'self' blob:`（Worker 路径）与 `script-src 'unsafe-inline'`（现有内联 bootstrap）。

### 🟡 P2-2 — 备份明文 ZIP
**位置**：`src/core/backup/backupArchive.ts:86-114`
**现状**：与 Android `BackupArchive.kt` 一致，**非移植缺陷**。
**修法**：不改代码。建议在 `docs/PARITY_EXCEPTIONS.md` 登记一条"备份包明文 ZIP，两端一致；若未来加密码需同步设计"。

### 🟡 P2-3 — `JsComicSource` 对书源 URL 无 scheme 校验
**位置**：`src/core/source/js/jsComicSource.ts`（全文）、`src/core/source/impl/jsonBookSource.ts:726-739` `resolveUrl`
**现状**：`JsonBookSource.validateUrl:722` 拒 `javascript:`/`file:` 但 `resolveUrl:727-735` 又**原样放行**；`JsComicSource` 完全无校验。
**危害**：**当前不可执行**（`<img src="javascript:">` 不执行，且全 `src/` 无 `<a href>`/`<iframe>`/`<iframe srcdoc>` 吃书源 URL）。属纵深防御缺口 + 未来回归雷。
**修法**：`jsonBookSource.ts:727-735` `resolveUrl` 的白名单改为只放行 `http:`/`https:`（其余走 `baseUrl` 拼接）；`jsComicSource.ts` 新增私有 `assertHttpUrl(u: string): string`，在所有图片/封面 URL 进 `imageConfigCache` 前调用。

### 🟡 P2-4 — 书源可配 SSRF / 内网 URL
**位置**：`src/core/source/importer/sourceImporter.ts:637-649`（`baseUrl` / `searchUrl` 无 host 校验）
**现状**：与 Android 一致；iOS ATS 默认阻断明文 http，可缓解但非完整。
**修法**：可加 `sourceImporter.ts` 内对 `bookSourceUrl`/`searchUrl` 的 host 做私网段拒绝（`10./172.16-31./192.168./127./169.254./::1`）—— 但这会**改变行为**（Android 允许），按 `REVIEW_PROTOCOL` 第 3 条须登记 exception 后再改。

### 🟡 P2-5 — `Info.plist` 无 ATS 例外导致 `insecureTls` 书源全挂
**位置**：`ios/App/App/Info.plist`（无 `NSAppTransportSecurity`）
**现状**：功能缺口，非安全问题。**不要**为修它加 `NSAllowsArbitraryLoads`（那会把 P2-4 的 SSRF 面直接放大到全协议）。建议登记 exception 而非改配置。

---

## 9. 门禁原始输出（诚实声明）

本代理**未修改任何 `src/**` 文件**，以下为审计时点的工作区状态，用于说明"现存红灯非本代理引入"。

### `git status --porcelain`
```
 M PROJECT_GUIDE.md
?? .github/
?? IOS/
```

### `npx tsc --noEmit`
**FAIL（既有）** —— `src/core/parser/epubParser.ts` 出现 200+ 个 `TS1005: ';' expected` / `TS1109`，文件在 243-262 行语法不完整：
```
src/core/parser/epubParser.ts(243,15): error TS1005: ';' expected.
…
src/core/parser/epubParser.ts(262,1): error TS1109: Expression expected.
```
该文件**不属于**本审计范围，且本代理未触碰；判断为并行代理正在编辑中的中间态。

### `npx eslint src`
**FAIL（既有）** —— `8 problems (7 errors, 1 warning)`，全部落在本审计范围外的文件（`src/ui/pages/StatisticsPage.tsx:1605` `react-hooks/set-state-in-effect`、`:1642` `react-hooks/exhaustive-deps` 等）。

### `npx vitest run`（本审计相关子集）
```
Test Files  3 passed (3)
     Tests  59 passed (59)
```
（`tests/unit/jsSourcePlatform.test.ts`、`veneraBridge.test.ts`、`veneraWorker.test.ts`）

> ⚠️ **这三个文件全绿不代表 P0-1/2/3/4 不存在**。它们绿是因为：(a) 测试用 `forceInlineFallback: true` 主动选 inline；(b) 断言里**自带 `return`**（`rt.evaluate('return 1 + 1;')`），与 `JsSourceEngine` 的实际用法相反；(c) 死循环用例**自己调了 `tick()`**；(d) `veneraBridge.test.ts:13` 把 `createVeneraWorker` 整个 mock 掉。**这正是 P0 缺陷能通过门禁的原因**，报告中的修法已逐条给出对应的回归测试。

### `npx vite build`
未执行（`tsc` 已红，且与本审计结论无关）。

---

## 10. 诚实声明

- **未读到字节的文件**：`JsMessageHandler.kt`（49 KB）我只 grep 了 `case` 分支清单与 `launchUrl` 上下文，没有逐行读完；§1 表中「Android 能力」一列对 `JsMessageHandler` 的描述基于该清单 + `jsMessageHandler.ts` 的 TS 对照，**可能遗漏个别 native binding**。
- **`js_safety/acorn.js`（245 KB）** 未读内容，只确认它被 `readAsset('js_safety/acorn.js')` 装载。
- **`public/venera/worker-entry.ts`（46 KB）** 未读，只确认它无生产调用点。
- **`src/core/source/impl/mangaDexSource.ts`（53 KB）** 未读；§3 的 XSS 结论覆盖的是**渲染路径**（已穷举 `dangerouslySetInnerHTML`/`innerHTML`/`insertAdjacentHTML`/`document.write`/`srcdoc`/`iframe`/`javascript:`/`data:text/html`），不依赖逐行读该源。
- **P0-1 的"当前不可达"判定**基于 `src/` 全仓穷举（`createEngine`/`JsSourceRepo`/`SourceViewModel`/`JsComicSource` 均无构造点；`App.tsx:176` 传 `NULL_SOURCE_IO`）。若存在本代理未见的动态接线（如 `scripts/` 下的构建期注入、`.audit-reach.json` 之类可达性配置），此判定需复核 —— 我检查过 `scripts/` 目录名但未逐个读其内容。
- **§5.2 常数时间比较**：JS 层的 `charCodeAt` XOR 循环是**尽力而为**，无法像 JVM `int` 运算那样保证不被 JIT 特化。这是所有 Web 实现的共同处境，Android 侧注释（L67）也只称"基本形态"，故未列为发现，仅记录。
- **P2-4 / P2-5 涉及"要不要改行为"**：按 `REVIEW_PROTOCOL` 第 3 条，建议先登记 `PARITY_EXCEPTIONS.md` 再改，本报告只给方向不代为决策。

---

## 11. 给后续修复代理的执行顺序建议

1. **先修 P0-3.4 + P0-1 + P0-2 + P0-3**（同一批，互相耦合，分开修会引入中间坏态）。
   核心：`JsRuntime.evaluate` 改 async → `JsSourceEngine` 全链路 `await` → `WebJsRuntime.evaluate` 直接走 `evaluateInWorker` → `WORKER_BODY` 用 `AsyncFunction` → `registerFunction` 改成 postMessage RPC → `SYNC_OVERRIDE` 的 45 处同步桥改异步。
2. **同步补 4 条回归测试**（当前门禁对 P0 缺陷完全无感）。
3. **修 P1-1**（Keychain）—— 这是唯一一处"用户数据明文落盘"的真实问题。
4. **修 P1-3**（例外文档失实）—— 1 分钟，但不做会持续误导后续审计。
5. **P1-2 / P2-1 / P2-3** 各自独立，可并行。
6. **P2-2 / P2-4 / P2-5** 只登记 exception，不改代码。
