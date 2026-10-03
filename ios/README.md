# Ciallo阅读 · iOS 版（EASYREADER for iOS）

本项目是 `novel-reader/`（Android）的 **iOS 原生移植版**，目标：**前后端行为与安卓版完全一致，体验完全一致**。

## 目录

```
ios/
  CialloReader.xcodeproj/        # Xcode 16+ 工程（Xcode 直接打开即可）
  CialloReader/                  # 全部 Swift 源码（按安卓包结构镜像）
    App/                         # MainActivity + Navigation 对应物
    Design/                      # ui/theme + ui/components + ui/feedback 对应物
    Data/                        # data/ 数据层（SQLite 直连，表结构镜像 Room v12）
      Parsers/                   # EPUB/MOBI/DOCX/FB2/CBZ/TXT 解析器
    Source/                      # source/ 书源体系（接口签名与安卓一致）
      ZLibrary/                  # Z-Library 深度集成（DiamWall PoW/eapi/端点容灾/DoH 抗污染 DNS + SNI 传输）
      JS/                        # Venera JS 漫画源（JavaScriptCore 替代 QuickJS）
    Download/                    # download/ 下载层（断点续传 + 真实格式校验）
    Library/                     # 书库聚合搜索
    Home/                        # 书架（正在阅读 → 我的书架 → 我喜欢的 → 统计入口）
    Reader/                      # 文字阅读器（分页引擎/五主题/五种翻页/书签/TTS/内嵌图）
    Comic/                       # 漫画阅读器（翻页/条漫/缩放/设置面板/章节页）
    God/                         # 神回 GodMoment 全链路
    Statistics/                  # 阅读统计（周/月/年/热力图/神回排行榜）
    Settings/                    # 设置（隐私 PIN/缓存管理/书源管理）
    Resources/                   # Assets（Logo 等）
  Support/Info.plist             # 工程级 Info.plist
```

> 按用户要求，**iOS 版不包含漫画翻译模块**（Android 的 mangatranslate/ 与 iOS 的 MangaTranslate 均不在交付范围）。

## 构建

1. **macOS + Xcode 16.0+**（首次打开会自动通过 SPM 拉取 SwiftSoup / ZIPFoundation）。
2. 打开 `CialloReader.xcodeproj`，选 `CialloReader` target，连上 iPhone / 起模拟器，⌘R。
3. 最低系统 iOS 17.0；Bundle ID 与安卓版一致：`com.aistudio.novelreader.kxmpzq`；版本 1.2.0 (201)。
4. App 图标：仓库根的手绘 LOGO 为 1976×1608，加图标时在 Mac 上执行
   `sips -z 1024 1024 "生成“ciallo阅读”手绘风格透明LOGO.png" --out CialloReader/Resources/AppIcon1024.png`
   并在 Assets 的 AppIcon（Single Size）里指定它。

## 与安卓版的移植映射（保真策略）

| Android | iOS | 说明 |
| --- | --- | --- |
| Kotlin + Compose M3 | Swift + SwiftUI | 单入口 + 4 Tab，导航/转场对齐 |
| Room（v12，`app/schemas/12.json`） | **libsqlite3 直连，同一套建表 SQL** | 表/列/索引与 Room v12 逐字段镜像 |
| OkHttp + Cronet | URLSession + **Network.framework SNI 直连** | Z-Library 走 DoH 解析 + 自定义 SNI 传输，其余走系统栈 |
| QuickJS（Venera JS 源） | **JavaScriptCore（系统内置）** | Venera 运行时桥 + 消息协议逐条实现 |
| Jsoup | SwiftSoup（SPM，Jsoup 的 Swift 移植） | 规则语法一致 |
| WorkManager 下载 | URLSession 下载任务 + resume data | 断点续传语义一致 |
| PdfRenderer | CGPDFDocument / PDFKit | 逐页栅格化入库 |
| harism GL 卷页（OpenGL 网格） | **同公式条带渲染**（Canvas 逐条带圆柱投影 `x′ = F + R·sin(s/R)` + 镜像背面透纸 + 折缝阴影） | 数学同源，每帧 ~110 条带 |
| MOBI HUFF/CDIC 压缩 | **KindleUnpack 同款解码器逐行移植**（HuffCdicDecoder） | AZW3/HUFF 类 Kindle 文件可导入 |
| TTS TextToSpeech | AVSpeechSynthesizer（zh-CN） | 段落级 startReading/pause/next/previous |
| PBKDF2 PIN（120000 次） | CommonCrypto PBKDF2，同参数 | 随机盐 + 失败冷却一致 |
| AGSL 液态玻璃 shader | iOS 材质（.ultraThinMaterial 等）+ 自绘高光/描边 | `GlassCard` 复刻按压跷跷板与法线压痕观感 |
| ZLibraryDns 抗污染 DNS | **完整移植**（DoH 四家并行 + 黑名单 + TCP 探测 + 三级缓存 + SNI 裸 HTTP/1.1 客户端） | Network.framework 实现 IP 直连 + SNI 指定 |
| SharedPreferences | UserDefaults（同名键） | 偏好语义一致 |
| ZIP 备份 | ZIPFoundation | 备份结构一致 |

## 产品语义红线（与安卓 6.4 节一致，不许改）

1. 三套数据互不干涉：书架（本地下载制）/ 我喜欢的（在线收藏制）/ 阅读进度（两边共用）。
2. 底部主 Tab 选中指示 = **顶部 3pt 小横条**（宽 40%、居中、自动对比色），不许换成气泡药丸。
3. 「我喜欢的」是书架 Tab 内与「我的书架」平行的板块，顺序：正在阅读 → 我的书架 → 我喜欢的 → 阅读统计。
4. 心形美工一套：`HeartMid = #FF4D6D`，渐变 + 高光 + 发光。
5. 反馈发生在被按的控件自己身上，不做跨屏飞行动效。

## 已知实现差异（诚实清单）

- 漫画翻译模块按用户要求整体移除（Android 端 mangatranslate/ 不在 iOS 交付范围）；
- GL 卷页改为 Canvas 条带渲染：圆柱投影公式、镜像背面与阴影与 harism 同源，但逐顶点光照/非水平折线未复刻；
- 漫画 OCR / 气泡分割随翻译模块一并移除；
- Cronet 的 HTTP/3 语义由 URLSession（Apple 栈）承担；
- 字体：安卓打包 Noto 子集；iOS 用系统苹方 + 支持用户导入自定义字体。
