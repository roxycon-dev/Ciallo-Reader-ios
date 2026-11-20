# Ciallo Reader — IPA 安全性声明

> 适用范围：`com.aistudio.ciallo.reader`（Ciallo Reader）iOS 构建，bundle 内的
> `Info.plist`、`PrivacyInfo.xcprivacy`、`App.entitlements` 与本文档构成一套
> 可审计的安全声明。**任何一项改动都要同步本文件与
> `tests/unit/ipaSecurityDeclaration.test.ts`** —— 那个测试会读 plist 原文与本文档
> 逐条比对，任一侧漂移即红。
>
> 文档版本：2026-11-20 · 对应 Android 侧 `novel-reader/` 1.6.4（478 个 Kotlin 文件）

---

## 一、声明摘要

| 维度 | 结论 | 落地位置 |
|---|---|---|
| 出口合规 | **不使用需申报的非豁免加密**；`ITSAppUsesNonExemptEncryption = false` | `ios/App/App/Info.plist` |
| 跟踪 | **不做任何跟踪**，无 IDFA、无 ATT 弹窗、无跨 App 标识 | `PrivacyInfo.xcprivacy` → `NSPrivacyTracking = false` |
| 数据收集 | **不收集**：书库 / 书源 / 阅读记录 / 凭据全部留在设备沙箱 | `NSPrivacyCollectedDataTypes = []` |
| 必需原因 API | DiskSpace `85F4.1`、FileTimestamp `C617.1`、UserDefaults `CA92.1` | `PrivacyInfo.xcprivacy` |
| 权限用途 | 相册读写、相机、麦克风、本地网络各有一条中英文案；**未声明的能力不申请** | `Info.plist` 的 `NS*UsageDescription` |
| 明文传输 | 仅对**用户自填书源**开放 HTTP；`http://` 请求**永不携带**凭据 | `Info.plist` ATS + `src/core/source/networkCalls.ts` |
| 本地凭据 | Keychain / AES-GCM 加密 cookie jar；不写明文 | `ReaderKeychainPlugin.swift`、`src/core/source/zlibrary/encryptedCookieJar.ts` |
| 局域网传输 | 双向 TLS + 6 位配对码 + 证书指纹绑定 | `src/core/transfer/transferConnection.ts`、`transferTls.ts` |
| 第三方 SDK | **零**统计 / 广告 / 推送 SDK | `package.json` 依赖清单 |
| 动态代码 | 不下载可执行代码；用户书源脚本属「用户数据」，走 acorn 静态白名单 | `public/js_safety/*`、`src/core/source/js/*` |

---

## 二、出口合规（Encryption / Export Compliance）

### 2.1 声明值

`Info.plist` 中：

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

### 2.2 依据

App 内出现的密码学运算**全部属于豁免类别**（标准算法、不用于认证/DRM/数字版权限制，
且实现由操作系统提供）：

| 用途 | 算法 | 实现来源 | 是否自研 |
|---|---|---|---|
| 网络传输机密性 | TLS 1.2/1.3 | `URLSession` / `WKWebView`（系统） | 否 |
| 局域网互传 | TLS-PSK 之外的证书校验 + AES-GCM | WebCrypto / Network.framework | 否 |
| 本地 cookie jar 加密 | AES-GCM 256 | WebCrypto `crypto.subtle` | 否（仅调 API） |
| 口令派生 | PBKDF2-HMAC-SHA256 | WebCrypto | 否 |
| 内容摘要 | SHA-256 | `@noble/hashes`（纯 JS 实现，公开标准算法） | 否（算法标准，无专有设计） |
| 完整性校验 | CRC32 / SHA-256 | `fflate` / `@noble/hashes` | 否 |

结论：属于 15 CFR §740.17(b)(1) 的「mass market」豁免与 §734.4 的「standard
cryptography」范围，故申报 `false`。

> **不需要** `CCATS` 或年度自分类报告；若后续引入自研加密协议或 DRM，必须改为
> `true` 并重新走分类流程 —— 这是本文件第一条不可越过的红线。

---

## 三、隐私清单（Privacy Manifest）

文件：`ios/App/App/PrivacyInfo.xcprivacy`（随 bundle 打包，App Store Connect 会解析）。

### 3.1 跟踪

```xml
<key>NSPrivacyTracking</key><false/>
<key>NSPrivacyTrackingDomains</key><array/>
```

代码事实：

- 不引入 `AdSupport` / `AppTrackingTransparency`；
- 不生成 IDFA / IDFV 之外的任何持久标识（`DFV` 仅系统内部，App 不读取）；
- 传输层协议里唯一的长期标识是**用户本机的书源配置**，不上报。

### 3.2 收集的数据：无

```xml
<key>NSPrivacyCollectedDataTypes</key><array/>
```

说明：App 只作为**客户端**访问「用户自己填写的书源地址」。请求内容（搜索词、书号、
章节地址）由用户输入决定，直接发往用户指定的第三方站点，不经过开发者服务器 ——
开发者侧**没有任何接收端**。因此不构成「收集」。

本地产生并仅存本机的数据（不入清单，因为未离开设备）：

| 数据 | 位置 | 离开设备的方式 |
|---|---|---|
| 书库 / 章节 / 阅读进度 | SQLite（`Library/…/ciallo.db`） | 仅用户主动导出或局域网互传 |
| 书源定义 | SQLite + `book_sources_config` | 仅用户主动导出 |
| 登录凭据 / Cookie | Keychain + 加密 jar | **永不导出**（`PortableSettings` 显式排除） |
| 阅读统计 | SQLite | 仅用户主动导出 |
| 备份包 | 用户选择的文件位置 | 仅用户主动分享 |

### 3.3 必需原因 API

| 类别 | 原因码 | 用途 | 代码位置 |
|---|---|---|---|
| `NSPrivacyAccessedAPICategoryDiskSpace` | `85F4.1` | 下载/解包前预检可用空间（保留 16 MiB 余量） | `src/core/download/downloadWorker.ts`、`novelTextArchive.ts`、`transfer/transferSession.ts` |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | 缓存清理按 mtime 判新鲜度；模型文件指纹 | `src/core/cache/cacheManagement.ts`、`Plugins/ReaderMangaModelsPlugin.swift` |
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | App 自身偏好（`@capacitor/preferences`） | `src/core/settings/*` |

未声明 `SystemBootTime`（不用 `systemUptime`）、未声明 `ActiveKeyboards`
（不读键盘列表）—— 请勿因「顺手加一个」而扩大声明面。

---

## 四、权限用途（Usage Descriptions）

`Info.plist` 的每一条都与 Android 侧权限一一对照，且**没有声明 AndroidManifest 里
不存在的能力**（除两条按 CI 预置、运行期不触发弹窗的条目，见下）。

| Info.plist 键 | 触发场景 | 用户拒绝后的行为 | Android 对应 |
|---|---|---|---|
| `NSPhotoLibraryUsageDescription` | 导入本地图片作漫画封面/内页 | 导入入口隐藏，其余功能不受影响 | `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE` |
| `NSPhotoLibraryAddUsageDescription` | 导出漫画内页到相册 | 导出失败并给出可操作提示 | `MediaStore` 写入 |
| `NSCameraUsageDescription` | 扫描封面 / 拍书页（**预置，当前无调用点**） | 不申请即不弹窗 | Android 未声明 `CAMERA` |
| `NSMicrophoneUsageDescription` | **预置，当前无调用点**（TTS 只播放不录音） | 不申请即不弹窗 | Android 未声明 `RECORD_AUDIO` |
| `NSLocalNetworkUsageDescription` | 局域网互传（发现同一 Wi-Fi 设备） | 互传入口提示需授权，扫码/文件导入仍可用 | Android 无对应（Wi-Fi 直连） |
| `NSBonjourServices` → `_ciallo-xfer._tcp` | 同上（Bonjour 发现） | 仅影响自动发现 | — |
| `UIBackgroundModes` → `audio` | 后台 TTS 朗读续播 | 退到后台即暂停朗读 | `FOREGROUND_SERVICE_MEDIA_PLAYBACK` |

**通知**：不使用 `POST_NOTIFICATIONS` 的 iOS 对等物在 `Info.plist` 里没有键，
权限由 `UNUserNotificationCenter.requestAuthorization` 在用户触发下载时申请。

**触感**：`@capacitor/haptics` 走 `UIFeedbackGenerator`，不弹权限框（对应 Android `VIBRATE`）。

---

## 五、传输安全（ATS 与凭据边界）

### 5.1 ATS 配置

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>
```

**为什么必须开**：书源是用户自己填的，其中相当一部分只提供 `http://`（个人站、
内网镜像、老旧图床）。若强制 ATS，这些源在 iOS 上会**整体不可用**，而 Android 侧
`usesCleartextTraffic="true"` 一直是放开的 —— 两侧行为会不一致。

**风险与缓解**（三重，缺一不可）：

1. **明文永不携带凭据**——`src/core/source/networkCalls.ts` 的
   `insecureCredentialViolation(url, headerOf)`：`http://` 且请求头含
   `Cookie` / `Authorization` / `Proxy-Authorization`（非空）时直接
   `IOException("非 HTTPS 图片或书源地址不能携带登录凭据")`。
   这条挂在**网络拦截器**上（每一跳都过），所以 `https → http` 重定向的最后一跳也拦住。
2. **跨主机/跨协议剥离**——`downloadWorker.ts` 的
   `stripSensitiveHeadersOnCrossHost`：重定向到不同 host 或降级到 http 时，
   剥掉 `Cookie`、`Authorization`、`Proxy-Authorization`、`X-Api-Key` 四个头。
3. **下载链路只对同源/子域发会话**——`allowSession` 判据：
   `host === sessionHost || host.endsWith("." + sessionHost)`，且四个 CDN 主机
   （`ncdn` / `cdn-zlib` / `s3proxy` / `dln`）一律不发 Cookie。

### 5.2 证书校验

不使用 `URLSessionDelegate` 的自定义信任评估，**不做 pinning**（书源域名由用户决定，
pinning 会随站点换证书而整体失效）。局域网互传是例外：自签证书 + 指纹绑定 + 6 位
配对码，见下节。

### 5.3 局域网互传（最近邻传输）

| 环节 | 机制 |
|---|---|
| 发现 | Bonjour `_ciallo-xfer._tcp`，仅同网段 |
| 身份 | 双向 TLS（`needClientAuth: !client`），双方各自生成自签证书 |
| 配对 | 6 位数字码 = `SHA-256(排序后的两个证书指纹 + 两个 nonce)` 的前若干位 |
| 校验 | 用户需在**两台设备上看到同一个码**并确认；不一致即中止 |
| 传输 | 分块 + 每块 SHA-256；断点续传按 offset 校验 |
| 超时 | 连接 2 s / 读 1.5 s / 握手 8 s（移动端对端） |

实现：`src/core/transfer/transferConnection.ts`、`transferTls.ts`、`nearbyConnector.ts`，
Swift 侧 `Plugins/ReaderTransferPlugin.swift` + `TransferIdentity.swift`。

---

## 六、本地数据保护

| 数据 | 保护方式 | 位置 |
|---|---|---|
| 登录凭据（Z-Library 等） | Keychain（`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`） | `Plugins/ReaderKeychainPlugin.swift` |
| Cookie jar | AES-GCM 256，密钥存 Keychain | `encryptedCookieJar.ts` |
| 备份包口令 | PBKDF2-HMAC-SHA256（迭代数随包写入头部） | `src/core/backup/*` |
| 私密书架 | 独立标记 + 列表脱敏；PIN 只存派生值 | `privacyService.ts` |
| 临时文件 | 下载/导入结束即删；`.part` / `.tmp` 有独立清理路径 | `downloadWorker.ts`、`cacheManagement.ts` |
| 文件共享 | `UIFileSharingEnabled = false`（沙箱不暴露给「文件」App） | `Info.plist` |
| 文档打开 | `LSSupportsOpeningDocumentsInPlace = true`（仅用户显式选择时） | `Info.plist` |

**不做**的：不写 `NSUserDefaults` 明文凭据、不把 token 放进 URL query、不在日志里打
完整 Cookie。

---

## 七、WebView 与用户书源脚本

App 的 UI 是 Web 技术栈（Capacitor + React），因此「WebView 安全」等同「App 安全」。

| 面 | 措施 |
|---|---|
| 内容来源 | 只加载 bundle 内 `public/index.html`；不加载远程页面到主 WebView |
| 外部浏览 | 走 `@capacitor/browser`（系统 SFSafariViewController，进程隔离） |
| JS 书源 | 用户粘贴的脚本先过 **acorn 静态白名单**（`public/js_safety/acorn.js` + `instrument.js`），禁用 `eval` / `Function` / 动态 import / 网络外发白名单外域 |
| 执行隔离 | 书源脚本在 Worker 内运行，不持有 DOM 与 Capacitor 桥 |
| 桥暴露面 | 只注册 8 个自定义插件（见 `Plugins/`），每个方法都做参数校验与路径规范化 |
| 文件路径 | 所有插件入口拒绝 `..`、绝对路径越界、符号链接逃逸 |
| 注入 | React 侧不使用 `dangerouslySetInnerHTML` 渲染书源返回的 HTML；解析走自研 DOM 子集 |

**明确不做**：不实现 `allowUniversalAccessFromFileURLs`，不开
`WKWebViewConfiguration.preferences.javaScriptCanOpenWindowsAutomatically`。

---

## 八、代码完整性与供应链

- **无热更新**：App 不下载可执行代码；OTA 只可能替换「书源脚本」（用户数据）。
- **依赖可审计**：`package.json` 的 19 个运行时依赖全部为公开包，无统计/广告/推送 SDK。
  逐条清单见 `docs/DEPENDENCIES.md`（若有）。
- **资源完整性**：模型文件（`public/comic/*.json`、`public/anilist/*.tsv.gzip`）随包分发，
  不做远程替换；局域网互传的包逐块 SHA-256。
- **构建**：CI 产出 `.ipa` 后用 `codesign -dvvv` 与 `security cms -D -i embedded.mobileprovision`
  复核 Team ID 与 `get-task-allow`（Release 必须为 `false`）。

---

## 九、日志与诊断

| 规则 | 实现 |
|---|---|
| 日志不含凭据 | `redactCoverCookieHeader()` 只保留键名；下载日志只打 host 与状态码 |
| 崩溃上报 | **不上报**（无第三方 SDK）；`StartupDiagnostics` 仅在用户主动导出时生成 |
| 诊断包 | 用户显式操作才生成，内容含设备型号/版本/最近 N 条本地日志，不含书库正文与凭据 |

---

## 十、App Store 审核问答（预置答案）

**Q：App 使用加密吗？**
A：使用系统提供的标准 TLS 与 WebCrypto 标准算法，仅用于传输与本地数据保护，
属豁免类别，`ITSAppUsesNonExemptEncryption = false`。

**Q：为什么 `NSAllowsArbitraryLoads = true`？**
A：App 是「书源客户端」，书源地址由用户自行填写，其中包含只提供 HTTP 的个人站点。
明文请求一律不携带任何登录凭据（见本文件 §5.1），跨域重定向会剥离四个敏感头。

**Q：为什么需要本地网络权限？**
A：设备间离线互传书库（同一 Wi-Fi 下），走双向 TLS + 6 位配对码确认，不经任何服务器。

**Q：是否收集用户数据？**
A：不收集。开发者侧没有接收端；所有数据留在设备，只有用户主动导出/互传时才离开。

**Q：App 内的书源脚本是否属于下载代码？**
A：属于用户数据（等价于用户导入的配置文件），执行前经静态白名单校验，
在 Worker 内运行，无 DOM 与原生桥访问权。

---

## 十一、已知限制与残余风险

| 项 | 说明 | 处置 |
|---|---|---|
| ATS 全开 | 理论上任何 http 请求都可发起 | 凭据禁令 + 跨域剥离（§5.1 三条） |
| 无证书 pinning | 依赖系统信任链 | 局域网互传另加指纹绑定；公网书源接受系统信任模型 |
| 相机/麦克风文案预置 | 当前无调用点 | 若永久不启用，发布前删除对应键（`ipaSecurityDeclaration.test.ts` 会提示） |
| 书源脚本能力较强 | 白名单需持续维护 | 新增原生桥方法必须同步 `jsUiDialogs` 与白名单 |
| 明文备份包 | 用户可选口令加密 | 导出界面明示「不设口令则明文」 |

---

## 十二、复核清单（发布前逐条勾选）

- [ ] `Info.plist`：`ITSAppUsesNonExemptEncryption = false` 且无自研加密
- [ ] `PrivacyInfo.xcprivacy`：`NSPrivacyTracking = false`、`NSPrivacyCollectedDataTypes` 为空、
      三个原因码与代码实际调用一致
- [ ] 每条 `NS*UsageDescription` 都有真实触发路径（或已标注「预置」）
- [ ] `UIBackgroundModes` 只含实际使用的 `audio`
- [ ] `UIFileSharingEnabled = false`
- [ ] Release 构建 `get-task-allow = false`，无 `CAPACITOR_DEBUG` 残留
- [ ] 依赖清单无新增统计/广告/推送 SDK
- [ ] `npx vitest run tests/unit/ipaSecurityDeclaration.test.ts` 全绿
- [ ] 本文件与 plist 一致（测试会比对）

---

## 十三、机器校验入口

```powershell
cd IOS
npx vitest run tests/unit/ipaSecurityDeclaration.test.ts
```

该测试读取：

- `ios/App/App/Info.plist` 原文（断言九个键与值）
- `ios/App/App/PrivacyInfo.xcprivacy` 原文（断言三类声明与三个原因码）
- 本文件的 `## 四、权限用途` 表格（断言文档提到的每个 `NS*` 键都在 plist 里存在，
  反之 plist 里每个 `NS*UsageDescription` 都在文档里有行）

任一侧漂移 → 红。**这是本声明的执行机制，不是装饰。**
