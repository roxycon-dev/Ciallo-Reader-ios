/**
 * `KOTLIN_ENUMS` —— 478 个 Kotlin 文件里**全部** `enum class` 的项名、序数、文案集中表。
 *
 * **机器生成**：`node scripts/genKotlinEnums.mjs`。不要手改。
 * 键是 `文件路径（相对 app/src/main/java）::枚举名`，因此零重名、零冲突；
 * `line` 是该 `enum class` 在 Kotlin 文件里的行号，便于逐条回查。
 *
 * 为什么需要它：iOS 侧原有的枚举表命名不统一（`COMIC_MODE_LABEL` /
 * `SHELF_SEARCH_FIELD_TITLES` / `HAPTIC_TABLE` / `SHADOW_BLUR_STYLE_ORDINAL` …），
 * 无法机械核对「Kotlin 的 5 个项 ↔ iOS 的 5 个项、序数与文案是否一致」。
 * 本表把这件事变成可断言的数据：`tests/parity/kotlinEnums.test.ts` 逐项比对。
 */

export interface KotlinEnumItem {
  readonly name: string;
  /** 构造器里第一个字符串参数；没有则为 `null`（Kotlin `name` 的等价物）。 */
  readonly label: string | null;
  /** 构造器里第二个字符串参数（如 `ComicEnhanceMode` 的描述）；没有则为 `null`。 */
  readonly desc: string | null;
}

export interface KotlinEnum {
  /** `enum class` 在 Kotlin 文件里的行号（1-based）。 */
  readonly line: number;
  readonly items: readonly KotlinEnumItem[];
}

export const KOTLIN_ENUMS: Readonly<Record<string, KotlinEnum>> = {
  "com/example/data/AppUpdateManager.kt::AppUpdateSource": {
    line: 23,
    items: [
      { name: "GITHUB", label: null, desc: null },
      { name: "MIRROR", label: null, desc: null },
    ],
  },
  "com/example/data/AppUpdateManager.kt::AppUpdateStage": {
    line: 25,
    items: [
      { name: "AVAILABLE", label: null, desc: null },
      { name: "DOWNLOADING", label: null, desc: null },
      { name: "VERIFYING", label: null, desc: null },
      { name: "READY", label: null, desc: null },
      { name: "NEED_PERMISSION", label: null, desc: null },
      { name: "INSTALLING", label: null, desc: null },
      { name: "FAILED", label: null, desc: null },
    ],
  },
  "com/example/data/Book.kt::ContentType": {
    line: 13,
    items: [
      { name: "NOVEL", label: null, desc: null },
      { name: "COMIC", label: null, desc: null },
    ],
  },
  "com/example/data/favorite/FavoriteModels.kt::ChapterReadState": {
    line: 17,
    items: [
      { name: "UNREAD", label: null, desc: null },
      { name: "READING", label: null, desc: null },
      { name: "READ", label: null, desc: null },
    ],
  },
  "com/example/data/favorite/FavoriteModels.kt::SerialStatus": {
    line: 28,
    items: [
      { name: "UNKNOWN", label: "unknown", desc: null },
      { name: "ONGOING", label: "ongoing", desc: null },
      { name: "COMPLETED", label: "completed", desc: null },
      { name: "HIATUS", label: "hiatus", desc: null },
    ],
  },
  "com/example/discover/DiscoverModels.kt::DiscoverDimension": {
    line: 19,
    items: [
      { name: "UPDATES", label: "更新", desc: "最新" },
      { name: "DISCUSSION", label: "热议", desc: "24h" },
      { name: "RANKING", label: "榜单", desc: "热门" },
      { name: "CLICKS", label: "点击", desc: "日" },
    ],
  },
  "com/example/discover/DiscoverModels.kt::DiscoverLayout": {
    line: 34,
    items: [
      { name: "LIST", label: "列表", desc: null },
      { name: "GRID", label: "双列网格", desc: null },
      { name: "LARGE", label: "大图", desc: null },
    ],
  },
  "com/example/discover/DiscoverPartition.kt::DiscoverPartition": {
    line: 6,
    items: [
      { name: "COMIC", label: "漫画", desc: "" },
      { name: "NOVEL", label: "小说", desc: "_novel" },
    ],
  },
  "com/example/download/DownloadTaskEntity.kt::DownloadStatus": {
    line: 6,
    items: [
      { name: "PENDING", label: null, desc: null },
      { name: "DOWNLOADING", label: null, desc: null },
      { name: "PAUSED", label: null, desc: null },
      { name: "COMPLETED", label: null, desc: null },
      { name: "FAILED", label: null, desc: null },
      { name: "CANCELLED", label: null, desc: null },
    ],
  },
  "com/example/god/GodMomentModels.kt::GodContentType": {
    line: 21,
    items: [
      { name: "COMIC", label: "comic", desc: "漫画" },
      { name: "NOVEL", label: "novel", desc: "小说" },
    ],
  },
  "com/example/god/GodMomentModels.kt::GodRankingStyle": {
    line: 34,
    items: [
      { name: "PODIUM", label: "podium", desc: "领奖台" },
      { name: "VINYL_SHELF", label: "vinyl", desc: "唱片架" },
      { name: "POLAROID_WALL", label: "polaroid", desc: "照片墙" },
    ],
  },
  "com/example/god/GodMomentModels.kt::GodSort": {
    line: 50,
    items: [
      { name: "RATING", label: "rating", desc: "评分" },
      { name: "RECENT", label: "recent", desc: "最近添加" },
      { name: "BOOK", label: "book", desc: "书籍" },
    ],
  },
  "com/example/god/GodPull.kt::GodPullEdge": {
    line: 53,
    items: [
      { name: "LEFT", label: null, desc: null },
      { name: "RIGHT", label: null, desc: null },
      { name: "TOP", label: null, desc: null },
      { name: "BOTTOM", label: null, desc: null },
    ],
  },
  "com/example/i18n/Strings.kt::AppLanguage": {
    line: 24,
    items: [
      { name: "ZH", label: "zh", desc: null },
      { name: "EN", label: "en", desc: null },
    ],
  },
  "com/example/library/ComicDownloadManager.kt::ComicDownloadStatus": {
    line: 24,
    items: [
      { name: "DOWNLOADING", label: null, desc: null },
      { name: "PAUSED", label: null, desc: null },
      { name: "FAILED", label: null, desc: null },
      { name: "SUCCESS", label: null, desc: null },
    ],
  },
  "com/example/library/DownloadIndicatorState.kt::DownloadIndicatorStatus": {
    line: 5,
    items: [
      { name: "Idle", label: null, desc: null },
      { name: "Running", label: null, desc: null },
      { name: "Paused", label: null, desc: null },
      { name: "Failed", label: null, desc: null },
    ],
  },
  "com/example/mangatranslate/TextBlockMerger.kt::TextLineOrientation": {
    line: 14,
    items: [
      { name: "HORIZONTAL", label: null, desc: null },
      { name: "VERTICAL", label: null, desc: null },
      { name: "AMBIGUOUS", label: null, desc: null },
    ],
  },
  "com/example/source/impl/PublicNovelSource.kt::PublicNovelSite": {
    line: 42,
    items: [
      { name: "CZBOOKS", label: "czbooks", desc: "小说狂人" },
      { name: "QUANBEN", label: "quanben", desc: "全本小说网" },
      { name: "IHUABEN", label: "ihuaben", desc: "话本小说" },
      { name: "SFACG", label: "sfacg", desc: "SF轻小说" },
      { name: "LINOVEL", label: "linovel", desc: "轻之文库" },
      { name: "FANQIE", label: "fanqie", desc: "番茄小说（公开聚合）" },
    ],
  },
  "com/example/transfer/TransferModels.kt::TransferCategory": {
    line: 10,
    items: [
      { name: "BOOKS", label: "书籍与离线原文件", desc: null },
      { name: "FAVORITES", label: "收藏与分类", desc: null },
      { name: "ANNOTATIONS", label: "书签、标注与神回", desc: null },
      { name: "HISTORY", label: "阅读进度与记录", desc: null },
      { name: "SETTINGS", label: "阅读设置与预设", desc: null },
      { name: "RESOURCES", label: "自定义背景与字体", desc: null },
      { name: "SOURCES", label: "书源", desc: null },
    ],
  },
  "com/example/transfer/TransferModels.kt::ImportMode": {
    line: 16,
    items: [
      { name: "MERGE", label: null, desc: null },
      { name: "REPLACE", label: null, desc: null },
    ],
  },
  "com/example/transfer/TransferModels.kt::TransferPhase": {
    line: 33,
    items: [
      { name: "IDLE", label: "准备互传", desc: null },
      { name: "PREPARING", label: "正在准备数据", desc: null },
      { name: "DISCOVERING", label: "正在发现设备", desc: null },
      { name: "CONNECTING", label: "正在连接", desc: null },
      { name: "AWAITING_CONFIRMATION", label: "等待确认", desc: null },
      { name: "TRANSFERRING", label: "正在传输", desc: null },
      { name: "WAITING_TO_RESUME", label: "等待继续传输", desc: null },
      { name: "VERIFYING", label: "正在校验", desc: null },
      { name: "RECEIVED", label: "数据已收到", desc: null },
      { name: "IMPORTING", label: "正在导入", desc: null },
      { name: "COMPLETED", label: "已完成", desc: null },
      { name: "CANCELLED", label: "已取消", desc: null },
      { name: "FAILED", label: "传输未完成", desc: null },
    ],
  },
  "com/example/transfer/TransferModels.kt::TransferError": {
    line: 41,
    items: [
      { name: "PERMISSION", label: null, desc: null },
      { name: "WIFI_DISABLED", label: null, desc: null },
      { name: "UNSUPPORTED", label: null, desc: null },
      { name: "BUSY", label: null, desc: null },
      { name: "CONNECTION", label: null, desc: null },
      { name: "REJECTED", label: null, desc: null },
      { name: "SPACE", label: null, desc: null },
      { name: "CORRUPT", label: null, desc: null },
      { name: "VERSION", label: null, desc: null },
      { name: "IMPORT", label: null, desc: null },
      { name: "UNKNOWN", label: null, desc: null },
    ],
  },
  "com/example/ui/adaptive/AdaptiveSpec.kt::WindowWidthClass": {
    line: 57,
    items: [
      { name: "COMPACT", label: null, desc: null },
      { name: "MEDIUM", label: null, desc: null },
      { name: "EXPANDED", label: null, desc: null },
    ],
  },
  "com/example/ui/comic/ComicHarismCurl.kt::CurlSyncPlan": {
    line: 1193,
    items: [
      { name: "IMMEDIATE_PRELOAD", label: null, desc: null },
      { name: "DEBOUNCE_MERGE", label: null, desc: null },
      { name: "NOOP", label: null, desc: null },
    ],
  },
  "com/example/ui/comic/ComicPageLayout.kt::ComicSplitHalf": {
    line: 35,
    items: [
      { name: "FULL", label: null, desc: null },
      { name: "LEFT", label: null, desc: null },
      { name: "RIGHT", label: null, desc: null },
    ],
  },
  "com/example/ui/comic/ComicReaderConfig.kt::ComicMode": {
    line: 295,
    items: [
      { name: "SINGLE", label: "单页", desc: null },
      { name: "DOUBLE", label: "双页", desc: null },
      { name: "WEBTOON", label: "条漫", desc: null },
      { name: "CONTINUOUS", label: "无缝滚动", desc: null },
      { name: "MAGNETIC", label: "磁吸", desc: null },
    ],
  },
  "com/example/ui/comic/ComicReaderConfig.kt::ComicDirection": {
    line: 305,
    items: [
      { name: "LTR", label: "左 → 右", desc: null },
      { name: "RTL", label: "右 → 左", desc: null },
      { name: "TTB", label: "上 → 下", desc: null },
    ],
  },
  "com/example/ui/comic/ComicReaderConfig.kt::ComicFit": {
    line: 324,
    items: [
      { name: "FIT_WIDTH", label: "适应宽度", desc: null },
      { name: "FIT_HEIGHT", label: "适应高度", desc: null },
      { name: "ORIGINAL", label: "原始大小", desc: null },
      { name: "FILL", label: "铺满裁切", desc: null },
      { name: "STRETCH", label: "拉伸铺满", desc: null },
      { name: "FIT_PAGE", label: "整页", desc: null },
      { name: "CUSTOM", label: "自定义", desc: null },
    ],
  },
  "com/example/ui/comic/ComicReaderConfig.kt::ComicDoubleAlign": {
    line: 335,
    items: [
      { name: "TOP", label: "顶部对齐", desc: null },
      { name: "CENTER", label: "居中对齐", desc: null },
      { name: "BOTTOM", label: "底部对齐", desc: null },
    ],
  },
  "com/example/ui/comic/ComicReaderConfig.kt::ComicCropMode": {
    line: 345,
    items: [
      { name: "OFF", label: "关闭", desc: null },
      { name: "WHITE", label: "裁白边", desc: null },
      { name: "BLACK", label: "裁黑边", desc: null },
      { name: "AUTO", label: "自动识别", desc: null },
    ],
  },
  "com/example/ui/comic/ComicReaderConfig.kt::ComicEnhanceMode": {
    line: 355,
    items: [
      { name: "OFF", label: "关闭", desc: "" },
      { name: "CAS", label: "锐化", desc: "线条更清晰" },
      { name: "ANIME4K", label: "线条", desc: "轻量修复" },
      { name: "WAIFU2X", label: "旧版超分", desc: "兼容旧设置" },
      { name: "SUPER_RES", label: "超分", desc: "轻量放大" },
      { name: "MANGAJANAI", label: "JaNai 极速", desc: "轻量修复 · 预生成" },
      { name: "MANGAJANAI_FULL", label: "MangaJaNai", desc: "完整版 · 首次下载 76 MB" },
    ],
  },
  "com/example/ui/comic/ComicReaderConfig.kt::ComicBgType": {
    line: 377,
    items: [
      { name: "BLACK", label: "纯黑", desc: null },
      { name: "WHITE", label: "纯白", desc: null },
      { name: "GRAY", label: "深灰", desc: null },
      { name: "PAPER", label: "纸张纹理", desc: null },
      { name: "DYNAMIC", label: "沉浸动态", desc: null },
    ],
  },
  "com/example/ui/comic/ComicReaderConfig.kt::ComicScene": {
    line: 387,
    items: [
      { name: "NONE", label: "关闭", desc: null },
      { name: "RAIN", label: "雨夜", desc: null },
      { name: "SNOW", label: "落雪", desc: null },
      { name: "SAKURA", label: "樱花", desc: null },
      { name: "FIREFLY", label: "萤火", desc: null },
      { name: "OCEAN", label: "海边", desc: null },
      { name: "CAMPFIRE", label: "篝火", desc: null },
      { name: "NIGHT", label: "夏夜", desc: null },
    ],
  },
  "com/example/ui/comic/ComicReaderConfig.kt::ComicPageAnim": {
    line: 399,
    items: [
      { name: "NONE", label: "无动画", desc: null },
      { name: "SLIDE", label: "平移", desc: null },
      { name: "FADE", label: "渐变", desc: null },
      { name: "CURL", label: "仿真翻页", desc: null },
    ],
  },
  "com/example/ui/comic/ComicReaderConfig.kt::ComicGestureAction": {
    line: 409,
    items: [
      { name: "NONE", label: "无操作", desc: null },
      { name: "PREV", label: "上一页", desc: null },
      { name: "NEXT", label: "下一页", desc: null },
      { name: "TOGGLE_CONTROLS", label: "呼出/隐藏控制", desc: null },
      { name: "TOC", label: "目录", desc: null },
      { name: "SETTINGS", label: "设置", desc: null },
      { name: "EXIT", label: "退出", desc: null },
    ],
  },
  "com/example/ui/comic/ComicReaderCore.kt::ComicPanel": {
    line: 131,
    items: [
      { name: "NONE", label: null, desc: null },
      { name: "SETTINGS", label: null, desc: null },
      { name: "TOC", label: null, desc: null },
      { name: "PRESET", label: null, desc: null },
      { name: "CROP", label: null, desc: null },
    ],
  },
  "com/example/ui/comic/MangaJaNaiRuntime.kt::Backend": {
    line: 17,
    items: [
      { name: "CPU", label: null, desc: null },
      { name: "CPU_BALANCED", label: null, desc: null },
      { name: "XNNPACK", label: null, desc: null },
    ],
  },
  "com/example/ui/components/AppButton.kt::AppButtonVariant": {
    line: 81,
    items: [
      { name: "Primary", label: null, desc: null },
      { name: "Secondary", label: null, desc: null },
      { name: "Tertiary", label: null, desc: null },
      { name: "Destructive", label: null, desc: null },
    ],
  },
  "com/example/ui/components/AppButton.kt::AppButtonSize": {
    line: 88,
    items: [
      { name: "Small", label: null, desc: null },
      { name: "Medium", label: null, desc: null },
      { name: "Large", label: null, desc: null },
    ],
  },
  "com/example/ui/components/AppSnackbar.kt::AppSnackKind": {
    line: 50,
    items: [
      { name: "ERROR", label: null, desc: null },
      { name: "TOAST", label: null, desc: null },
    ],
  },
  "com/example/ui/components/GlassQuality.kt::RenderQuality": {
    line: 17,
    items: [
      { name: "MINIMAL", label: "极简", desc: null },
      { name: "LOW", label: "流畅", desc: null },
      { name: "MID", label: "均衡", desc: null },
      { name: "HIGH", label: "高", desc: null },
      { name: "MAX", label: "极致", desc: null },
    ],
  },
  "com/example/ui/favorite/ChapterStatusRow.kt::ChapterVisual": {
    line: 70,
    items: [
      { name: "UNREAD", label: null, desc: null },
      { name: "READING", label: null, desc: null },
      { name: "READ", label: null, desc: null },
    ],
  },
  "com/example/ui/favorite/FavoritesPanel.kt::FavoriteSort": {
    line: 75,
    items: [
      { name: "RECENT_FAVORITE", label: "最近收藏", desc: null },
      { name: "RECENT_READ", label: "最近阅读", desc: null },
      { name: "RECENT_UPDATE", label: "最近更新", desc: null },
      { name: "TITLE", label: "书名", desc: null },
      { name: "CUSTOM", label: "自定义", desc: null },
    ],
  },
  "com/example/ui/feedback/Motion.kt::HapticKind": {
    line: 132,
    items: [
      { name: "SELECTION", label: null, desc: null },
      { name: "LIGHT", label: null, desc: null },
      { name: "MEDIUM", label: null, desc: null },
      { name: "HEAVY", label: null, desc: null },
      { name: "SUCCESS", label: null, desc: null },
    ],
  },
  "com/example/ui/mascot/MascotSpriteSheet.kt::MascotMood": {
    line: 39,
    items: [
      { name: "IDLE", label: null, desc: null },
      { name: "READING", label: null, desc: null },
      { name: "RUN", label: null, desc: null },
      { name: "HAPPY", label: null, desc: null },
      { name: "SAD", label: null, desc: null },
    ],
  },
  "com/example/ui/pageturn/PageTurnContainer.kt::PageTurnType": {
    line: 71,
    items: [
      { name: "SIMULATE", label: "仿真3D卷页", desc: "真实书本折角弯曲与纸张阴影" },
      { name: "COVER", label: "覆盖翻页", desc: "无缝推开上页，经典质感" },
      { name: "SLIDE", label: "平移翻页", desc: "左右双页平滑滑移" },
      { name: "FADE", label: "渐变淡出", desc: "优雅透明度切换" },
      { name: "SCROLL", label: "上下滚动", desc: "连续纵向滚动阅读" },
    ],
  },
  "com/example/ui/privacy/PrivacyWindows.kt::PinEntryMode": {
    line: 54,
    items: [
      { name: "SETUP", label: null, desc: null },
      { name: "CONFIRM", label: null, desc: null },
      { name: "VERIFY", label: null, desc: null },
      { name: "CHANGE_OLD", label: null, desc: null },
      { name: "CHANGE_NEW", label: null, desc: null },
    ],
  },
  "com/example/ui/reader/TouchZones.kt::TouchAction": {
    line: 10,
    items: [
      { name: "NONE", label: "不执行操作", desc: null },
      { name: "PREVIOUS", label: "上一页", desc: null },
      { name: "NEXT", label: "下一页", desc: null },
      { name: "CONTROLS", label: "呼出 / 收起状态栏", desc: null },
      { name: "SETTINGS", label: "打开设置", desc: null },
      { name: "CONTENTS", label: "打开目录", desc: null },
      { name: "LISTEN", label: "听书", desc: null },
      { name: "EXIT", label: "退出阅读", desc: null },
    ],
  },
  "com/example/ui/reader/TouchZones.kt::SwipeAction": {
    line: 17,
    items: [
      { name: "NONE", label: "不执行操作", desc: null },
      { name: "PAGE", label: "滑动翻页", desc: null },
      { name: "CONTROLS", label: "呼出状态栏", desc: null },
      { name: "SETTINGS", label: "打开设置", desc: null },
    ],
  },
  "com/example/ui/shelf/ShelfMultiSelect.kt::ShelfPhase": {
    line: 35,
    items: [
      { name: "BROWSE", label: null, desc: null },
      { name: "SELECTING", label: null, desc: null },
      { name: "DRAGGING", label: null, desc: null },
    ],
  },
  "com/example/ui/shelf/ShelfMultiSelect.kt::ShelfSelectionScope": {
    line: 47,
    items: [
      { name: "BOOK", label: null, desc: null },
      { name: "FAV", label: null, desc: null },
    ],
  },
  "com/example/ui/shelf/ShelfSearch.kt::ShelfSearchField": {
    line: 194,
    items: [
      { name: "Any", label: "全部", desc: null },
      { name: "Title", label: "书名", desc: null },
      { name: "Author", label: "作者", desc: null },
    ],
  },
  "com/example/ui/shelf/ShelfSelectionHost.kt::DragFlightKind": {
    line: 164,
    items: [
      { name: "MOVE", label: null, desc: null },
      { name: "FAVORITE", label: null, desc: null },
      { name: "RETURN", label: null, desc: null },
    ],
  },
  "com/example/ui/source/SourceManagementScreen.kt::SourceGroupKind": {
    line: 988,
    items: [
      { name: "NOVEL", label: null, desc: null },
      { name: "COMIC", label: null, desc: null },
      { name: "CUSTOM", label: null, desc: null },
      { name: "OTHER", label: null, desc: null },
    ],
  },
  "com/example/ui/wenku/WenkuIconArt.kt::WenkuSymbol": {
    line: 22,
    items: [
      { name: "Discover", label: "发现", desc: "导航" },
      { name: "Shelf", label: "书架", desc: "导航" },
      { name: "Book", label: "阅读", desc: "导航" },
      { name: "Folder", label: "本地书库", desc: "导航" },
      { name: "FolderOpen", label: "打开文件夹", desc: "导航" },
      { name: "Profile", label: "我的", desc: "导航" },
      { name: "Back", label: "返回", desc: "导航" },
      { name: "Forward", label: "前进", desc: "导航" },
      { name: "Up", label: "收起", desc: "导航" },
      { name: "Down", label: "展开", desc: "导航" },
      { name: "ArrowLeft", label: "上一项", desc: "导航" },
      { name: "ArrowRight", label: "下一项", desc: "导航" },
      { name: "ArrowUp", label: "向上", desc: "导航" },
      { name: "ArrowDown", label: "向下", desc: "导航" },
      { name: "External", label: "打开链接", desc: "导航" },
      { name: "Close", label: "关闭", desc: "导航" },
      { name: "More", label: "更多", desc: "导航" },
      { name: "Contents", label: "目录", desc: "阅读" },
      { name: "Bookmark", label: "书签", desc: "阅读" },
      { name: "Bookmarked", label: "已收藏", desc: "阅读" },
      { name: "Location", label: "定位章节", desc: "阅读" },
      { name: "LocationFilled", label: "跟随朗读", desc: "阅读" },
      { name: "Typography", label: "字体", desc: "阅读" },
      { name: "Sliders", label: "阅读设置", desc: "阅读" },
      { name: "Image", label: "插图", desc: "阅读" },
      { name: "Brightness", label: "亮度", desc: "阅读" },
      { name: "Moon", label: "夜间阅读", desc: "阅读" },
      { name: "Layers", label: "合并卷", desc: "阅读" },
      { name: "Quotes", label: "摘录", desc: "阅读" },
      { name: "Language", label: "双语", desc: "阅读" },
      { name: "Portrait", label: "强制竖屏", desc: "阅读" },
      { name: "Headphones", label: "听书", desc: "听书" },
      { name: "Play", label: "播放", desc: "听书" },
      { name: "Pause", label: "暂停", desc: "听书" },
      { name: "Stop", label: "停止", desc: "听书" },
      { name: "Previous", label: "上一段", desc: "听书" },
      { name: "Next", label: "下一段", desc: "听书" },
      { name: "Waveform", label: "声音", desc: "听书" },
      { name: "Voice", label: "音色", desc: "听书" },
      { name: "Volume", label: "音量", desc: "听书" },
      { name: "Speed", label: "速度", desc: "听书" },
      { name: "Timer", label: "历史与定时", desc: "听书" },
      { name: "Search", label: "搜索", desc: "操作" },
      { name: "Filter", label: "筛选排序", desc: "操作" },
      { name: "Layout", label: "视图布局", desc: "操作" },
      { name: "Grid", label: "网格视图", desc: "操作" },
      { name: "DotsGrid", label: "布局", desc: "操作" },
      { name: "Add", label: "添加", desc: "操作" },
      { name: "AddCircle", label: "添加项目", desc: "操作" },
      { name: "RemoveCircle", label: "移出", desc: "操作" },
      { name: "Check", label: "完成", desc: "操作" },
      { name: "CheckCircle", label: "勾选", desc: "操作" },
      { name: "Selected", label: "已选择", desc: "操作" },
      { name: "Circle", label: "未选择", desc: "操作" },
      { name: "Edit", label: "编辑", desc: "操作" },
      { name: "Delete", label: "删除", desc: "操作" },
      { name: "Copy", label: "复制", desc: "操作" },
      { name: "Share", label: "分享", desc: "操作" },
      { name: "Link", label: "关联原文件", desc: "操作" },
      { name: "Refresh", label: "刷新重试", desc: "操作" },
      { name: "Sync", label: "同步", desc: "文件" },
      { name: "Download", label: "下载", desc: "文件" },
      { name: "CloudDownload", label: "离线缓存", desc: "文件" },
      { name: "Upload", label: "更新", desc: "文件" },
      { name: "ImportFile", label: "导入", desc: "文件" },
      { name: "Document", label: "文档", desc: "文件" },
      { name: "FolderAdd", label: "添加目录", desc: "文件" },
      { name: "Wand", label: "整理修复", desc: "文件" },
      { name: "Settings", label: "设置", desc: "系统" },
      { name: "Info", label: "关于", desc: "系统" },
      { name: "Warning", label: "异常", desc: "系统" },
      { name: "Wifi", label: "无线连接", desc: "系统" },
      { name: "WifiOff", label: "离线", desc: "系统" },
      { name: "WifiWarning", label: "连接异常", desc: "系统" },
      { name: "Cloud", label: "云书库", desc: "系统" },
      { name: "Globe", label: "官网", desc: "系统" },
      { name: "Phone", label: "手机", desc: "系统" },
      { name: "Laptop", label: "电脑", desc: "系统" },
      { name: "Branch", label: "同步冲突", desc: "系统" },
      { name: "PersonAdd", label: "注册账号", desc: "系统" },
      { name: "Eye", label: "显示", desc: "系统" },
      { name: "EyeOff", label: "隐藏", desc: "系统" },
      { name: "CloseCircle", label: "清空", desc: "系统" },
      { name: "Battery", label: "电量", desc: "系统" },
      { name: "Charging", label: "充电", desc: "系统" },
      { name: "Tools", label: "故障排查", desc: "系统" },
      { name: "Shield", label: "安全", desc: "系统" },
      { name: "Help", label: "帮助", desc: "系统" },
      { name: "Touch", label: "触摸", desc: "阅读" },
    ],
  },
  "com/example/ui/wenku/WenkuMotion.kt::WenkuRevealAxis": {
    line: 125,
    items: [
      { name: "Vertical", label: null, desc: null },
      { name: "Horizontal", label: null, desc: null },
    ],
  },
  "com/example/ui/wenku/WenkuMotion.kt::WenkuReaderChromePart": {
    line: 431,
    items: [
      { name: "Header", label: null, desc: null },
      { name: "Progress", label: null, desc: null },
      { name: "Dock", label: null, desc: null },
    ],
  },
  "com/ramotion/fluidslider/FluidSlider.kt::Size": {
    line: 31,
    items: [
      { name: "NORMAL", label: null, desc: null },
      { name: "SMALL", label: null, desc: null },
    ],
  },
  "eu/wewox/pagecurl/config/PageCurlConfig.kt::PointerBehavior": {
    line: 296,
    items: [
      { name: "Default", label: null, desc: null },
      { name: "PageEdge", label: null, desc: null },
    ],
  },
  "me/trishiraj/shadowglow/ShadowBlurEngine.kt::ShadowCacheBucket": {
    line: 84,
    items: [
      { name: "STATIC", label: null, desc: null },
      { name: "ANIMATED", label: null, desc: null },
    ],
  },
  "me/trishiraj/shadowglow/ShadowBlurStyle.kt::ShadowBlurStyle": {
    line: 8,
    items: [
      { name: "NORMAL", label: null, desc: null },
      { name: "SOLID", label: null, desc: null },
      { name: "OUTER", label: null, desc: null },
      { name: "INNER", label: null, desc: null },
    ],
  },
  "net/engawapg/lib/zoomable/MouseWheelZoom.kt::MouseWheelZoom": {
    line: 12,
    items: [
      { name: "Disabled", label: null, desc: null },
      { name: "Enabled", label: null, desc: null },
      { name: "EnabledWithCtrlKey", label: null, desc: null },
      { name: "EnabledWithShiftKey", label: null, desc: null },
      { name: "EnabledWithAltKey", label: null, desc: null },
      { name: "EnabledWithMetaKey", label: null, desc: null },
    ],
  },
  "net/engawapg/lib/zoomable/ScrollGesturePrpagation.kt::ScrollGesturePropagation": {
    line: 9,
    items: [
      { name: "ContentEdge", label: null, desc: null },
      { name: "NotZoomed", label: null, desc: null },
    ],
  },
};

/** 按 Kotlin 文件与枚举名取表（找不到返回 null）。 */
export function kotlinEnum(rel: string, name: string): KotlinEnum | null {
  return KOTLIN_ENUMS[`${rel}::${name}`] ?? null;
}

/** 枚举项名数组（序数即下标），Kotlin `entries.map { it.name }` 的等价物。 */
export function kotlinEnumValues(rel: string, name: string): readonly string[] {
  const e = kotlinEnum(rel, name);
  return e === null ? [] : e.items.map((i) => i.name);
}

/** 项名 → 文案；label 为 null 时回落项名（对齐 Kotlin `name` 属性）。 */
export function kotlinEnumLabels(rel: string, name: string): Readonly<Record<string, string>> {
  const e = kotlinEnum(rel, name);
  if (e === null) return {};
  const out: Record<string, string> = {};
  for (const i of e.items) out[i.name] = i.label ?? i.name;
  return out;
}
