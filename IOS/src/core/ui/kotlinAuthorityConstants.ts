/**
 * Kotlin 权威常量对照表 —— 把散落在各 Kotlin 文件里的**协议键名 / 资源名 / 文案 / 阈值**
 * 逐条落到 iOS 侧，每一条都标出 Kotlin 文件与行号。
 *
 * 为什么集中一处：这些常量在原工程里分散在 DAO、Worker、Importer、屏幕文件里，
 * 但性质相同（跨层共享的字符串协议或用户可见文案）。集中后 `tests/parity/kotlinLiterals.test.ts`
 * 能把 478 个 Kotlin 文件的字面量逐条对拍；调用方也从这里取，避免同一字符串写两遍漂移。
 *
 * Kotlin → TS 映射（逐条）
 * ────────────────────────
 *   data/AppDatabase.kt L517-519   `BUNDLED_ASSET/FLAG/FMT`            → `BUNDLED_ANILIST_*`
 *   data/AppDatabase.kt L520-521   `BUNDLED_FMT_VERSION=2` / `IMPORT_BATCH=2000` → 同名
 *   data/ComicParser.kt L22        `TAG = "BookImport"`                → `COMIC_PARSER_TAG`
 *   download/DownloadWorker.kt L41 `CHANNEL = "book_downloads"`        → `DOWNLOAD_NOTIFICATION_CHANNEL`
 *   source/ComicChapterTitle.kt L22 / source/js/JsChapterOrder.kt L101 `digits = "零一二三四五六七八九"`
 *                                                                      → `CJK_DIGIT_CHARS`
 *   source/impl/AliceSwEndpoints.kt L181-183 `PREFS_NAME/KEY_DOMAIN/KEY_AT` → `ALICESW_ROUTE_CACHE`
 *   source/zlibrary/ZLibraryEndpointProvider.kt L25-29 三个键 + 24h → `ZLIB_ENDPOINT_STORE`
 *   source/js/AimanhuaTls.kt L16   `PIN`（公开阅读密钥的 SHA-256）      → `AIMANHUA_PIN`
 *   source/js/MyComicBrowserReader.kt L26 `MAX_HTML_CHARS = 2_000_000` → 同名
 *   source/impl/HtmlNovelDiscovery.kt L49-50 两条分类正则              → `HTML_DISCOVERY_KIND_RULES`
 *   source/importer/SourceImporter.kt L496-497 同上（短标签）           → `SOURCE_IMPORT_KIND_RULES`
 *   source/impl/AutoNovelDiscovery.kt L28 `guestListNotice`            → `AUTONOVEL_GUEST_NOTICE`
 *   source/impl/FanqieGateway.kt 的说明 + `^/reader/[0-9]{18,20}$`     → `FANQIE_*`
 *   library/NovelDownloadPanel.kt 的删除确认文案                        → `NOVEL_DOWNLOAD_DELETE_NOTICE`
 *   ui/HomeScreen.kt L577 `"「$name」中的收藏会移到「默认」分类。"`     → `homeFavoriteCategoryDeleteNotice(name)`
 *   ui/components/LiquidSlider.kt L90/L93 两条 a11y 动作               → `LIQUID_SLIDER_RANGE_ACTIONS`
 *   ui/components/ScrollTilt.kt L101 `IDLE_TIMEOUT_NANOS = 120_000_000L` → 同名
 *   ui/feedback/Motion.kt L27 `FEEDBACK_HOLD_MS = 950L`                → 同名
 *   ui/shelf/ShelfSelectionHost.kt L147 `EDGE_ARM_NS = 200_000_000L`   → 同名
 *   transfer/TransferService.kt L22/L26 `notificationId=7301` + channel `device_transfer` / `设备互传`
 *   transfer/TransferTls.kt L21 `ALIAS = "ciallo_transfer_identity_v3"` → 同名
 *   ui/wenku/WenkuIconArt.kt L466 `k = 0.5522847498307936f`            → `WENKU_ROUND_K`
 */

/* ── data/AppDatabase.kt L517-521 ─────────────────────────────────────────── */
export const BUNDLED_ANILIST_ASSET = 'anilist_titles.tsv.gzip';
export const BUNDLED_ANILIST_FLAG = 'bundled_anilist_rows';
export const BUNDLED_ANILIST_FMT = 'bundled_anilist_fmt';
export const BUNDLED_ANILIST_FMT_VERSION = 2;
export const BUNDLED_ANILIST_IMPORT_BATCH = 2000;
/** 表名（DAO 的 `FROM anilist_titles`）。 */
export const ANILIST_TITLES_TABLE = 'anilist_titles';

/* ── data/ComicParser.kt L22 ─────────────────────────────────────────────── */
export const COMIC_PARSER_TAG = 'BookImport';

/* ── download/DownloadWorker.kt L41 ──────────────────────────────────────── */
export const DOWNLOAD_NOTIFICATION_CHANNEL = 'book_downloads';

/* ── source/ComicChapterTitle.kt L22 / JsChapterOrder.kt L101 ────────────── */
/** 两位代码共用同一张中文数字表；`〇` 是额外接受的零。 */
export const CJK_DIGIT_CHARS = '零一二三四五六七八九';
export const CJK_DIGIT_EXTRA_ZERO = '〇';

/* ── source/impl/AliceSwEndpoints.kt L181-183 ────────────────────────────── */
export const ALICESW_ROUTE_CACHE = {
  prefsName: 'alicesw_route_cache',
  keyDomain: 'domain',
  keyAt: 'timestamp',
  /** 路由缓存有效期（毫秒）。 */
  cacheMs: 12_000,
} as const;

/* ── source/zlibrary/ZLibraryEndpointProvider.kt L25-29 ──────────────────── */
export const ZLIB_ENDPOINT_STORE = {
  prefsName: 'zlib_domain_cache',
  keyCachedDomain: 'cached_domain',
  keyCachedTimestamp: 'cached_timestamp',
  keyCustomEndpoint: 'custom_endpoint',
  /** L29 `CACHE_DURATION_MS = 24 * 60 * 60 * 1000L`。 */
  cacheDurationMs: 24 * 60 * 60 * 1000,
} as const;

/* ── source/js/AimanhuaTls.kt L16 ────────────────────────────────────────── */
/**
 * L16 `PIN`：发布方公开阅读密钥的 SHA-256（只用于证书轮换宽限，主机名校验始终开启）。
 * Web 侧不能在运行时 pin 证书，但这条值必须原样保留在常量表里，供文档与对拍使用。
 */
export const AIMANHUA_PIN = '84f816f39fb638fe06c65f5489ef9be3ed93ab195a56ff1ba014dfe000869729';
export const AIMANHUA_HOST = 'mh.iqtao.cn';

/* ── source/js/MyComicBrowserReader.kt L26 ───────────────────────────────── */
export const MYCOMIC_MAX_HTML_CHARS = 2_000_000;

/* ── source/impl/HtmlNovelDiscovery.kt L49-50 ────────────────────────────── */
export const HTML_DISCOVERY_KIND_RULES: readonly {
  readonly kind: 'updates' | 'ranking';
  readonly pattern: RegExp;
}[] = [
  { kind: 'updates', pattern: /最近更新|最新更新|^更新$|^最新$/ },
  { kind: 'ranking', pattern: /排行|榜单|热门榜|人气榜|收藏榜|点击榜/ },
];

/* ── source/importer/SourceImporter.kt L496-497 ──────────────────────────── */
export const SOURCE_IMPORT_KIND_RULES: readonly {
  readonly kind: 'updates' | 'ranking';
  readonly pattern: RegExp;
}[] = [
  { kind: 'updates', pattern: /最新|更新/ },
  { kind: 'ranking', pattern: /排行|榜单|热门|人气|点击/ },
];

/** 按规则表判定发现入口的类型（两条正则都**包含匹配**）。 */
export function discoveryKindOf(
  label: string,
  rules: readonly { readonly kind: 'updates' | 'ranking'; readonly pattern: RegExp }[],
): 'updates' | 'ranking' | null {
  for (const rule of rules) if (rule.pattern.test(label)) return rule.kind;
  return null;
}

/* ── source/impl/AutoNovelDiscovery.kt L28 ──────────────────────────────── */
export const AUTONOVEL_GUEST_NOTICE =
  'Novelia 已关闭游客列表接口（HTTP 401），推荐与更新需登录；公开日榜仍可查看';

/* ── source/impl/FanqieGateway.kt ───────────────────────────────────────── */
export const FANQIE_NOTICE =
  '搜索与目录来自番茄公开接口，书荒殿补充检索；正文由张老师API提供。接口可能缺章或停止服务，更新与覆盖以实际返回为准。';
/** 阅读页路径（18–20 位数字 id）。 */
export const FANQIE_READER_PATH = /^\/reader\/[0-9]{18,20}$/;

/* ── library/NovelDownloadPanel.kt ──────────────────────────────────────── */
/** 删除下载记录时的确认文案（`$title` 为作品名）。 */
export function novelDownloadDeleteNotice(title: string): string {
  return `“${title}”的下载记录将被移除。未完成的任务会停止，已存入书架的书籍保留。`;
}

/* ── ui/HomeScreen.kt L577 ──────────────────────────────────────────────── */
export function homeFavoriteCategoryDeleteNotice(name: string): string {
  return `「${name}」中的收藏会移到「默认」分类。`;
}

/* ── ui/components/LiquidSlider.kt L90 / L93 ────────────────────────────── */
export const LIQUID_SLIDER_RANGE_ACTIONS = {
  increaseEnd: '增加范围终点',
  decreaseEnd: '减少范围终点',
} as const;

/* ── ui/components/ScrollTilt.kt L99-101 ────────────────────────────────── */
export const SCROLL_TILT_MAX_DEG = 4.5;
export const SCROLL_TILT_IDLE_TIMEOUT_NANOS = 120_000_000;

/* ── ui/feedback/Motion.kt L21-29 ───────────────────────────────────────── */
export const FEEDBACK_PROGRESS_MS = 220;
export const FEEDBACK_PROGRESS_CYCLE_MS = 1400;
export const FEEDBACK_HOLD_MS = 950;
export const ICON_PRESS_SCALE = 0.92;
export const CONTROL_PRESS_SCALE = 0.96;

/* ── ui/shelf/ShelfSelectionHost.kt L147 ────────────────────────────────── */
export const EDGE_ARM_NS = 200_000_000;

/* ── ui/MainActivity.kt L352-355：蓝光滤镜最大不透明度 + 滤镜色 ─────────── */
export const BLUE_LIGHT_MAX_OPACITY = 0.65;
export const BLUE_LIGHT_FILTER_COLOR = 0xff9e0d;

/* ── transfer/TransferService.kt L22 / L26 ──────────────────────────────── */
export const TRANSFER_NOTIFICATION_ID = 7301;
export const TRANSFER_NOTIFICATION_CHANNEL_ID = 'device_transfer';
export const TRANSFER_NOTIFICATION_CHANNEL_NAME = '设备互传';

/* ── transfer/TransferTls.kt L21 ────────────────────────────────────────── */
export const TRANSFER_TLS_ALIAS = 'ciallo_transfer_identity_v3';

/* ── ui/wenku/WenkuIconArt.kt L466 ──────────────────────────────────────── */
/** 贝塞尔近似圆弧的 k 值（`4/3·(√2−1)` 的更多位）。 */
export const WENKU_ROUND_K = 0.5522847498307936;
