# iOS 完整移植工作记录（进行中）

2026-10-28。用户明确要求：iOS 完整移植后才能结束任务。以相邻当前 Android 工程为功能和视觉依据，不以 10 月 4 日的旧移植范围替代当前要求。尚未完成，不作整体验收结论。

## 已修改和验证

- 原生 SQLite：补齐必需 values、关闭隐式逐语句事务、去除 ios_columns 元数据、并发打开合并和连接释放。以真正 SQLite 验证建表、事务、回滚及重试。
- 原生桥：新增 ReaderBridgeViewController，注册朗读、方向、Keychain、设备、文件插件；复用 SceneDelegate 已创建窗口。
- Keychain：实现读写删除，旧 Preferences 单向迁移、逐键并发排队、失败不回落明文。
- 原生设备端口：常亮、剪贴板、分享、磁盘容量、应用版本和系统文件选择/保存；补磁盘访问声明。
- 启动：初始化成功后挂载路由；失败显示重试。修复开屏动画与 ViewTransition 阻塞导航；标题种子灌库去重、批量让出线程，避免与本地导入事务冲突。
- 书源：现有 Novelia、Wenku8、爱下、MangaDex 类已注册；书库与书源管理共享管理器。自定义 JSON 导入、原生 HTTP 注入、持久化恢复、启停和选中源恢复已测试。
- 阅读：生产在线路由改用真实目录所选章节；上一章/下一章、迟到请求丢弃、图片请求原生 HTTP、漫画进度写入。旧演示包装器不再用于生产在线路由。
- 本地导入：HomePage 的按钮已从 importSampleBook 改为真实文件选择与解析。TXT、EPUB、FB2、DOCX、CBZ/ZIP 路径已装配；测试覆盖 TXT、EPUB、损坏文件、下载后入库和并发灌库。插图增加私有文件解析器。
- 备份导出改为真正调系统保存端口；恢复调文件选择器。
- 与现行 Android 对齐固定启用成人源、移除旧六次点击入口。修复公开详情链接仅允许 HTTP(S)。
- 基线 4557 测试有 5 个失败；修复真实链接缺陷及过期断言/文案/CRLF 对照后，最近全量 typecheck + lint + 194 文件 / 4588 测试通过。较早生产 WebKit 冒烟 8/8 通过。

## 正在处理与尚未验收

### 2026-10-28 接力进展（以下更新优先于旧条目）

- Venera 生产装配已接通：完整引擎在独立 Worker 内执行，DOM/编码/摘要/AES/存储同步，HTTP/验证码/站点验证异步 RPC。加载内置与缓存六源、远端刷新、登录、注册、Keychain 数据落盘。原始六脚本在真实 Chromium Worker 的初始化、DOM、GBK、MD5、持久化、网络桥和外部模块阻断测试通过。WebKit Worker 检查正在跑。
- JS Worker 与像素 Worker 改用构建时打包的内联 Blob，避免 iOS 自定义 URL scheme 下跨模块脚本加载的限制；这次变更后尚在重新跑全部检查。
- Z-Library 已注册并装配节点持久化/选择、Cookie、DiamWall、EAPI、搜索/详情/登录/下载、节点探测和原生交互式网页兜底。还缺实际登录下载验收、完整 DNS/代理/IP 回退及 WebView 登录状态双向同步验收。修复 PoW 毫秒预算误乘百万的问题。
- 更新合并已实现：保留原书 ID，按章节标题与出现顺序重映射进度、书签和高亮；缺章拒绝替换，失败回滚；新增两项回归测试通过。修复高亮 upsert 遗失 ID 导致重复批注的问题。
- 本地新增 MOBI/AZW/AZW3，PDF 原生逐页 JPEG 渲染已写入 ReaderDocuments。PDF 与所有 Swift 修改尚未经 Xcode 验证。导入器跟踪解析产生的文件，失败清理。
- 生产本地漫画路由已移除演示页入口，读取真实 CBZ/PDF 页面。生产在线漫画也接入同一 ComicReaderPage，接通真实几何/滤镜/增强/内存和磁盘缓存，重像素处理移至 Worker。区域解码、预加载预算和源站图片解密已接入，尚需设备性能验收。旧 WebCurlGl 集成仍有双页合成/手势和 GPU 纹理预算等问题须继续审计。
- 实际流程抓到并修复书架 bootstrap 依赖环和 ReaderPage 保存进度依赖环；修复路由动画保留 identity transform 压缩 fixed 阅读器、卷页 canvas 挤占分页宽度，以及 GL ARGB/RGBA 字节序错误。
- 最近一次完成的 gates 为 194 文件 / 4590 测试通过，生产构建通过。22 个 Chromium/WebKit E2E 通过 21 个；WebKit TXT 打开时剩一个导航卡住，已调整导航立即提交，正在重跑。Chromium TXT、JSON 书源和真实 CBZ 导入显示/翻页已通过。
- 增加 9 个只读 Android 权威快照和跨平台路径解析，CI 不再依赖开发者 C 盘；本地仍优先对照当前 Android 源。当前 Android 文件未改动。
- 新增根目录 `.github/workflows/native-ios.yml`，在 macOS 上编译全部 Swift、安装模拟器并留启动截图。尚未创建开发分支/推送/PR，原生 CI 尚未触发。

下列旧“尚未接入”的条目已有部分进展，但**剩余发现页、新小说源、设备互传、翻译、完整下载/分享、原生验收及逐项视觉审计仍未完成**，不作完整移植结论。

- 新增真实操作 E2E `reading-flow.spec.ts` 尚失败：需继续调查 Windows WebKit 的点击/开屏卡住，不能用单元测试代替流程验收；日志 `.tmp/takeover-reading-e2e.log`，现有 8 项冒烟之后仍需统一重跑。
- Venera/JS 源没有生产装配，旧 Worker 桥把同步 DOM/Convert getter 改为 Promise，不能满足原脚本同步语义。下一步应把完整 JsSourceEngine + JsMessageHandler 放在 Worker 内，让同步 DOM/crypto/storage 在同一 Worker 执行；HTTP/UI 走主线程异步 RPC。保持主页面与第三方脚本隔离，主线程可终止超时 Worker。
- Z-Library 类型和实现已有，尚未完整装配登录、Cookie、节点、远端 EAPI、WebView 验证及书库入口。
- 当前 Android 后增的 SF、话本、全本、书阁等小说源，发现页及设备互传尚无完整 TS 模块。
- 下载更新合并暂显式拒绝覆盖已有书；须补完保留进度和注释的更新导入，不能以该提示作为完成。
- 本地解析仍需补 MOBI/PDF/图片、封面、完整插图和失败回滚/大文件验收。CBZ 阅读器实际文件加载、神回相册/裁剪、隐私验证、阅读统计等逐个审计。
- 旧计划豁免了漫画翻译；当前“完整移植”要求不能自动沿用该豁免，需补对应 iOS 实现与验证。
- Swift 修改尚未在 Xcode 编译；本机 Windows 无 Xcode。已确认 GitHub 连接可读写用户的公开 `roxycon-dev/Ciallo-Reader-ios`，可后续通过隔离开发分支和现有 macOS CI 验证，当前尚未提交/推送。
- 原生朗读已修复不存在的 AVSpeechUtterance.identifier 和替换朗读时旧 Promise 未结算；需继续做 Swift 编译和真机验证。

## 工作区约束

- Android 工程只读，不覆盖用户现有 Android 书源修改与根目录 PROJECT_GUIDE.md 修改。
- IOS 整个目录在当前 Git 状态为未跟踪（仓库 HEAD 曾撤回旧移植）。不能把“git diff 为空”误认为没有本轮工作。
- 未经明确要求不创建新的用户聊天，不发送外部消息。当前没有启用子代理。
- 工具命令使用 PowerShell；异步工具只在返回 session_id 后轮询。不要同时改源文件并跑依赖这些源文件的多套验收，避免测试读取不同状态。
