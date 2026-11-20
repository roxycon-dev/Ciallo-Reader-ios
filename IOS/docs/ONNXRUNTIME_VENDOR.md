# ONNX Runtime SPM 包 vendoring 溯源（1.24.2）

> 2026-11-20 · 对应 CI run #39 失败修复。本文档与 `tests/unit/onnxruntimeVendor.test.ts`、
> `tests/fixtures/onnxruntimeVendorTree.json` 三方互锁：改任何一方都必须同步另外两方。

## 一、为什么要 vendor

微软在 2026-11-17/18 前后把以下仓库从 GitHub 下架（匿名 API 与网页均返回 404，
对照 `torvalds/linux` 返回 200，排除网络/限流因素）：

- `https://github.com/microsoft/onnxruntime`
- `https://github.com/microsoft/onnxruntime-swift-package-manager`

CI run #39（repo `roxycon-dev/Ciallo-Reader-ios`，run id 44733570114）的
`ios-build` 挂在 **Resolve Swift packages**、`ios-device` 挂在 **Release 构建**，
日志根因一致：

```
Fetching from https://github.com/microsoft/onnxruntime-swift-package-manager
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

git 对「不存在/私有」的仓库才会要求认证；同批的 capacitor-swift-pm / ZIPFoundation /
SQLCipher.swift 均 fetch 成功，故判定为该仓库被下架，而非 runner 网络问题。

## 二、vendor 了什么、没 vendor 什么

`ios/App/onnxruntime-swift-package-manager/` 是上游 tag **1.24.2** 的**完整源码树**
（75 个文件，含 objectivec 绑定源码、Package.swift、测试与文档），逐字节等于微软原始
commit：

| 锚点 | 值 |
|---|---|
| 原始 commit | `b7fb7f7dea8a2469e6335d95a61b8f36d0dc83b2` |
| 原始 tree | `59178cede37305e8725fd09d5907d872a55004f1` |
| commit 作者/日期 | Edward Chen · 2026-02-25T18:57:03Z |
| commit 信息 | Update ORT to 1.24.2 (#43) |

**二进制没有 vendor**。Package.swift 保持原样：`onnxruntime` binary target 仍从微软
官方 CDN 下载，SPM 用微软自己公布的 SHA256 校验：

| 项 | 值 |
|---|---|
| URL | `https://download.onnxruntime.ai/pod-archive-onnxruntime-c-1.24.2.zip` |
| SHA256 | `f7100a992d2a8135168c8afd831e6a58b465349101982aa58b3e11d36e600b54` |
| 字节数 | 52138597 |

该 CDN 在 2026-11-20 实测可达（HTTP 200，Content-Length 与上表一致），本机完整下载后
重算 SHA256 与微软公布值**完全一致**。构建链路里没有任何第三方镜像 URL。

## 三、源码完整性是怎么验证的

上游仓库已 404，无法直接 clone。验证链如下（每一步都可复现）：

1. GitHub 搜索 API 找到多个 2026-11-18/19 建立的独立镜像，其中
   `selim6167-lab/onnxruntime-swift-package-manager` 与
   `GuLP-AAC/onnxruntime-swift-package-manager` 保留了**原始 git 历史**：
   两者的 `refs/tags/1.24.2` 都指向 commit `b7fb7f7dea8a2469e6335d95a61b8f36d0dc83b2`
   （git commit SHA 是内容寻址的，SHA 一致即整棵树与微软原版密码学一致）。
2. 从两个镜像分别下载 tag 1.24.2 的 codeload tarball，**逐字节一致**
   （SHA256 均为 `2efe4fc48eb43400daa0caffd7d1e1289492d64a87f5a2b7a98dfdcb8176d703`）。
3. 通过 GitHub git/trees API 取原始 tree `59178ce…` 的递归清单（75 个 blob），
   对解压后的每个文件重算 git blob SHA1（`sha1("blob <len>\0" + content)`），
   **75/75 一致，0 缺失、0 多余**。清单固化在
   `tests/fixtures/onnxruntimeVendorTree.json`。
4. 门禁测试 `tests/unit/onnxruntimeVendor.test.ts` 每次运行都重算全部 75 个 blob SHA，
   并断言 vendor 目录无多余文件、pbxproj 是本地引用、Package.swift 的二进制 URL/校验和
   仍是官方值。任何篡改、损坏、回退远程 URL、换镜像地址都会红。

## 四、工程接线

- `ios/App/App.xcodeproj/project.pbxproj`：
  `A1000000000000000000001B` 由 `XCRemoteSwiftPackageReference`（exactVersion 1.24.2）
  改为 `XCLocalSwiftPackageReference`，`relativePath = "onnxruntime-swift-package-manager"`
  （与 CapApp-SPM 同级，相对 `.xcodeproj` 所在目录）。product 依赖
  `A1000000000000000000001C /* onnxruntime */` 不变，仍链接进 App target。
- 原生插件 `ios/App/App/Plugins/ReaderMangaModelsPlugin.swift` 的
  `import OnnxRuntimeBindings` 不变：模块来自包内 `objectivec/` 源码 target，
  版本与二进制 1.24.2 严格对应。
- `cap sync ios` 只重写 `CapApp-SPM/Package.swift`（Capacitor 管理），不触碰本包与
  pbxproj 的 packageReferences，CI 的 cap-sync → ios-build/ios-archive 链路不受影响。

## 五、如果官方 CDN 也失效了怎么办

按顺序升级，**不要**直接换第三方镜像 URL：

1. 重新核对 `download.onnxruntime.ai` 是否只是临时故障（对照其他版本 pod archive）。
2. 若 CDN 永久失效：从至少两个独立镜像取同一 zip，重算 SHA256，必须仍等于
   `f7100a99…`（微软公布值）才可用；把 zip 以 `ORT_POD_LOCAL_PATH` 环境变量或
   本地 binaryTarget 方式接入，并在本文档追加记录与新的校验证据。
3. 任何情况下都保持 `tests/unit/onnxruntimeVendor.test.ts` 的断言同步更新，
   不许用删测试/放宽断言的方式让门禁变绿。