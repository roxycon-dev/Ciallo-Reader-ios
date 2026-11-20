# 打 iOS 安装包（IPA）

本文件只讲「怎么把当前源码变成一个能装到 iPhone 上的包」，以及**为什么 Windows 上做不到最后一步**。

---

## 先说结论

| 你的机器 | 能做什么 | 产物 |
|---|---|---|
| **macOS + Xcode 26+** | 全部 | `build/ipa/CialloReader-1.6.4-264-unsigned.ipa` 或 `-signed.ipa` |
| **Windows / Linux** | web 构建 + 工程同步 + 打包源码快照 | `build/CialloReader-iOS-1.6.4-264-src.zip`（拷到 Mac 上一条命令出 IPA） |
| **都没有 Mac** | 推一个私有仓库，跑 GitHub Actions 的 `ios-ipa` job | 从 Actions 页面下载 IPA artifact |

**Windows 上无法生成 IPA 的原因**（不是配置问题，是工具链缺失）：

1. IPA 里是 `Payload/App.app/App` —— 一个 **arm64 Mach-O** 可执行文件，由 `swiftc`/`clang` + iOS SDK 交叉编译产出。Windows 上没有这条链路。
2. 资源编译（`actool` 把 `Assets.xcassets` 编成 `Assets.car`、`ibtool` 编 storyboard）只有 Xcode 提供。
3. `onnxruntime-swift-package-manager`（MangaJaNai 推理用）的源码已 vendor 进仓库（`ios/App/onnxruntime-swift-package-manager/`），二进制仍走微软官方 CDN `download.onnxruntime.ai`；SPM resolve 与 xcframework 嵌入只能在 macOS 上完成。详见 `ONNXRUNTIME_VENDOR.md`。
4. `codesign` / 描述文件 / 权限绑定是 Apple 独占签名体系。

任何声称「Windows 上生成 iOS 安装包」的做法，产出的都是不含二进制的空壳，装不上。

---

## 方式一：在 Mac 上一条命令（推荐）

```bash
# 1. 把源码包解压（Windows 侧已生成）
unzip CialloReader-iOS-1.6.4-264-src.zip -d ~/CialloReader
cd ~/CialloReader/IOS

# 2. 赋予执行权限（zip 跨平台传输会丢 mode）
chmod +x scripts/build-ipa.sh

# 3. 安装依赖（约 2 分钟）
npm ci

# 4. 出包
./scripts/build-ipa.sh
```

`build-ipa.sh` 做的事，逐条对应手工命令：

1. 校验 `xcodebuild` 存在且是 **Xcode 26+**（Capacitor 8 要求；Xcode 25 及以下会因 Swift 6 与 SPM 清单版本报错）。
2. `npm run build:web` → `dist/`（Vite 产物，`target: safari16`，对应部署目标 iOS 16）。
3. `npx cap sync ios` → 把 `dist/` 拷进 `ios/App/App/public/`，并重写 `ios/App/CapApp-SPM/Package.swift`（11 个 Capacitor 插件）。
4. 校验 `ios/App/App/public/index.html` 里引用的入口 JS 真的存在（cap sync 静默失败时真机是一片白屏，很难查）。
5. `xcodebuild -resolvePackageDependencies` 拉 `capacitor-swift-pm` 8.5.2 和 `onnxruntime` 1.24.2（第一次约 3–8 分钟，之后走 `build/SourcePackages` 缓存）。
6. `xcodebuild archive -configuration Release -sdk iphoneos`。
7. `ditto` 把 `App.app` 搬进 `Payload/`，`zip -qry` 打成 IPA（`-y` 必须保留，否则 framework 里的 `Versions/Current` 符号链接会被展开成实体文件，体积翻倍且签名后校验失败）。

产物：

```
build/ipa/CialloReader-1.6.4-264-unsigned.ipa      # 默认
build/ipa/CialloReader-1.6.4-264-device.ipa        # --device
build/ipa/CialloReader-1.6.4-264-signed.ipa        # --manual / --device 额外导出
```

### 三种签名模式

```bash
# ① 未签名（默认）。不需要 Apple 账号，任何机器都能出。
./scripts/build-ipa.sh

# ② 本机自动签名。前提：Xcode → Settings → Accounts 已登录 Apple ID（免费账号即可）。
export CIALLO_TEAM_ID=ABCDE12345        # developer.apple.com → Membership 里的 Team ID
./scripts/build-ipa.sh --device

# ③ 手动签名（CI 用）。需要导出好的证书 p12 + 描述文件。
export CIALLO_TEAM_ID=ABCDE12345
export CIALLO_PROFILE_UUID=12345678-1234-1234-1234-123456789012
export CIALLO_SIGNING_IDENTITY="Apple Development"
./scripts/build-ipa.sh --manual
```

描述文件 UUID 的取法：

```bash
security cms -D -i ~/Downloads/Ciallo_Dev.mobileprovision | /usr/libexec/PlistBuddy -c 'Print :UUID' /dev/stdin
```

强制 Debug 配置（带 Web 调试、体积更大）：`./scripts/build-ipa.sh --debug`。

---

## 方式二：GitHub Actions 出包（没有 Mac 时）

`.github/workflows/ios.yml` 的 `ios-ipa` job 跑在 `macos-26` 上：

1. 把 `IOS/` 目录提交进一个仓库的 `IOS/` 子目录（workflow 的 `working-directory` 就是 `IOS`）。
2. 手动触发：Actions → `ios` → Run workflow。
3. 跑完在 Artifacts 里下载 `ciallo-ios-ipa`。

**只出未签名 IPA**：什么都不用配。
**要出已签名 IPA**：在仓库 Settings → Secrets and variables → Actions 里加四个：

| Secret | 内容 |
|---|---|
| `CIALLO_CERT_P12_BASE64` | `base64 -i Certificates.p12 \| pbcopy` |
| `CIALLO_CERT_PASSWORD` | 导出 p12 时设的密码 |
| `CIALLO_PROFILE_BASE64` | `base64 -i xxx.mobileprovision \| pbcopy` |
| `CIALLO_TEAM_ID` | 10 位 Team ID |

workflow 里的导入步骤走的是标准的临时 keychain 路径：`security create-keychain` → `security import -T /usr/bin/codesign` → `security set-key-partition-list` → 描述文件放进 `~/Library/Developer/Xcode/UserData/Provisioning Profiles/<UUID>.mobileprovision`。

> `macos-26` 需要该 runner 镜像在你的账号计划里可用。用不了就换成 `macos-15`，同时把 Xcode 断言放宽——但 Capacitor 8 在 Xcode 25 上编译不过，所以实际等价于「必须 Xcode 26」。

---

## 方式三：安装到设备

| 产物 | 装法 |
|---|---|
| `-unsigned.ipa` | **Sideloadly**（拖进 ipa、填 Apple ID、直接装）、**AltStore / SideStore**（可 7 天自动续签）、**TrollStore**（仅限支持的系统版本，永久） |
| `-signed.ipa`（开发证书） | `xcrun devicectl device install app --device <UDID> build/ipa/xxx.ipa`，或 Xcode → Window → Devices and Simulators 把 ipa 拖进去 |
| 模拟器 `.app` | `xcrun simctl install booted <App.app>` |

未签名 IPA 装不上的典型报错是 `Unable to Install "Ciallo Reader"` / `ApplicationVerificationFailed`——那不是包坏了，是签名缺失，用 Sideloadly 重签一次即可。

---

## 已知的构建坑

| 现象 | 原因 | 处理 |
|---|---|---|
| `The project named "App" does not contain a scheme named "App"` | shared scheme 缺失（scheme 平时只写进 `xcuserdata`，不进版本库） | 本仓库已补 `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` |
| `App.xcworkspace does not exist` | Capacitor 8 走 SPM，没有 CocoaPods workspace | 用 `-project App.xcodeproj`，不要用 `-workspace` |
| `Missing package product 'onnxruntime'` | `project.pbxproj` 的 target 依赖了 project-level 的 SPM 包，但 `packageReferences` 被删了 | 确认 `PBXProject` 段里有 `A1000000000000000000001B /* XCLocalSwiftPackageReference "onnxruntime-swift-package-manager" */`，且 `ios/App/onnxruntime-swift-package-manager/` 目录存在 |
| 真机白屏、控制台无报错 | `ios/App/App/public/` 里是旧的 `dist` 或空目录 | 重新 `npx cap sync ios`；`build-ipa.sh` 第 4 步会直接 fail |
| `Signing for "App" requires a development team` | 未签名归档漏传参数 | 必须同时传 `CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM=""` |
| IPA 体积异常大（>200 MB） | 用 `cp -R` 而不是 `ditto` 打包，framework 符号链接被展开 | 用 `ditto`，zip 加 `-y` |
| 装到设备后闪退（只有调试版） | `debug.xcconfig` 的 `CAPACITOR_DEBUG = true` 让 WebView 连 dev server | Release 归档前确认 `CAPACITOR_DEBUG` 为 `false` 或未定义 |

---

## 版本号

IPA 里的 `CFBundleShortVersionString` / `CFBundleVersion` 来自 `ios/App/App.xcodeproj/project.pbxproj`：

```
MARKETING_VERSION = 1.6.4;        # → CFBundleShortVersionString
CURRENT_PROJECT_VERSION = 264;    # → CFBundleVersion
```

这两个值与 Android `novel-reader` 1.6.4 / versionCode 264 对齐。**改版本只改这两处**（Debug 与 Release 各一份），`build-ipa.sh` 会从 pbxproj 读出来用于命名产物。

---

## Windows 侧能做到哪一步

```powershell
cd IOS
npm run build:web            # 构建 dist
npx cap sync ios             # 同步进 ios/App/App/public
node scripts/pack-ios-bundle.mjs   # 打源码快照
```

第三条产出 `build/CialloReader-iOS-1.6.4-264-src.zip`（2228 个文件、压缩后约 37 MB），其中已经包含**同步好的** `ios/App/App/public/`，因此解压后即使不重新构建 web，也能直接 `xcodebuild archive`。
