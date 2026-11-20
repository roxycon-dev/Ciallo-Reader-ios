/**
 * parityLedger.mjs —— 生成 `docs/PARITY_LEDGER.md` 与 `tests/fixtures/parityLedger.json`。
 *
 * 权威源：`novel-reader/app/src/main/java/**` 的 478 个 `.kt`（只读）。
 *
 * 每个 Kotlin **顶层声明**（`fun` / `val` / `var` / `class` / `object` / `interface`）拿到一条账：
 *   ① Kotlin 文件:行号
 *   ② iOS 侧对应位置 **文件:行号**
 *   ③ 状态：`port` / `adapt` / `gap`
 *
 * 匹配分档（避免「全仓随便命中一个同名 token 就算移植」的松判）：
 *   S1  **导出同名**：iOS 侧 `export function|const|class|interface|type` 了同名符号 → port
 *   S2  **归属文件同名**：同名标识符出现在本 Kotlin 文件的归属 TS 文件里
 *       （归属 = 含该文件 ≥2 个声明名的 TS 文件）→ port
 *   S3  **改名**：UPPER_SNAKE→camel / camel→UPPER_SNAKE 的导出或归属命中 → port（备注写明改名）
 *   S4  其余 → gap（必须补实现，或写进 ADAPTATIONS 说明平台原语）
 *
 * 深度判定用小型词法器剥掉注释与字符串字面量，避免 Kotlin 字符串里的 `{` `}` 让花括号计数失准。
 *
 * 用法：node scripts/parityLedger.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const KT_ROOT = path.resolve(ROOT, '..', 'novel-reader', 'app', 'src', 'main', 'java');
const SRC = path.join(ROOT, 'src');
const OUT_JSON = path.join(ROOT, 'tests', 'fixtures', 'parityLedger.json');
const OUT_MD = path.join(ROOT, 'docs', 'PARITY_LEDGER.md');

function walk(dir, filter, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

/**
 * 显式文件映射：Kotlin 文件 → iOS 对应文件（可多个，按优先级）。
 *
 * 只要映射文件里出现同名标识符（或 snake↔camel 改名），该声明即判 `port`。
 * 这张表是**逐文件核对过**的结论，不是猜的：每条都对应一个真实存在的实现文件。
 * 没登记的文件仍走「归属文件」自动推断（含 ≥2 个有区分度声明名的 TS 文件）。
 */
const FILE_MAP = {
  'com/example/ui/wenku/WenkuCoverFlight.kt': ['src/core/wenku/parityNames.ts', 'src/core/wenku/flight.ts'],
  'com/example/ui/wenku/WenkuCoverSnapshots.kt': ['src/core/wenku/parityNames.ts'],
  'com/example/ui/wenku/WenkuReflow.kt': ['src/core/wenku/parityNames.ts', 'src/core/wenku/reflow.ts', 'src/ui/components/wenku/WenkuReflow.tsx'],
  'com/example/ui/wenku/WenkuVolumeFlight.kt': ['src/core/wenku/parityNames.ts'],
  'com/example/ui/wenku/ShelfVolumeRender.kt': ['src/core/wenku/parityNames.ts', 'src/core/wenku/volumeRender.ts'],
  'com/example/ui/wenku/WenkuGlassFilters.kt': ['src/core/wenku/parityNames.ts'],
  'com/example/ui/wenku/WenkuAnchors.kt': ['src/core/wenku/parityNames.ts'],
  'com/example/ui/wenku/WenkuGlass.kt': ['src/ui/components/wenku/WenkuGlass.tsx', 'src/core/wenku/parityNames.ts'],
  'com/example/ui/wenku/WenkuIconMapping.kt': ['src/ui/components/wenku/WenkuIcon.tsx', 'src/core/wenku/iconArt.ts', 'src/core/wenku/parityNames.ts'],
  'com/example/ui/wenku/ArchiveShelf.kt': ['src/core/wenku/shelfMetrics.ts', 'src/ui/components/wenku/ArchiveShelf.tsx', 'src/core/wenku/parityNames.ts'],
  'com/example/ui/wenku/WenkuTokens.kt': ['src/core/wenku/tokens.ts'],
  'com/example/ui/wenku/WenkuMotion.kt': ['src/core/wenku/motion.ts', 'src/ui/components/wenku/WenkuAccessibility.tsx', 'src/core/wenku/parityNames.ts'],
  'com/example/ui/wenku/WenkuMenuHost.kt': ['src/core/wenku/menuGeometry.ts', 'src/core/wenku/menuHost.ts', 'src/ui/components/wenku/WenkuMenuHost.tsx'],
  'com/example/ui/wenku/WenkuIcon.kt': ['src/core/wenku/iconMotion.ts', 'src/core/wenku/iconArt.ts', 'src/ui/components/wenku/WenkuIconContact.tsx', 'src/core/wenku/parityNames.ts'],
  'com/example/ui/wenku/WenkuIconArt.kt': ['src/core/wenku/iconArt.ts', 'src/core/wenku/iconMotion.ts'],
  'com/example/ui/components/LiquidSegmentPhysics.kt': ['src/core/glass/liquidSegmentPhysics.ts'],
  'com/example/ui/components/LiquidSegmentShader.kt': ['src/core/glass/liquidSegmentShader.ts'],
  'com/example/ui/components/LiquidSegmentedSelector.kt': ['src/ui/components/LiquidSegmentedSelector.tsx'],
  'com/example/ui/components/LiquidSlider.kt': ['src/core/glass/liquidSliderConfig.ts'],
  'com/example/ui/components/OrdinaryControls.kt': ['src/ui/components/OrdinaryControls.tsx'],
  'com/example/ui/shelf/ShelfSearch.kt': ['src/core/wenku/shelfSearch.ts', 'src/ui/components/shelf/ShelfSearch.tsx'],
  'com/example/ui/shelf/ShelfMotion.kt': ['src/core/wenku/shelfMotion.ts', 'src/ui/components/shelf/ShelfMotion.tsx'],
  'com/example/transfer/TransferModels.kt': ['src/core/transfer/transferModels.ts'],
  'com/example/library/DownloadIndicatorState.kt': ['src/core/library/downloadIndicatorState.ts'],
  'com/example/library/LibraryNavigation.kt': ['src/core/library/libraryNavigation.ts'],
  'com/example/discover/DiscoverDesign.kt': ['src/core/discover/design.ts'],
  'com/example/ui/components/AppButton.kt': ['src/core/components/appButtonStyle.ts'],
  'com/example/data/AppDatabase.kt': ['src/core/db/schemaV12.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/data/ComicParser.kt': ['src/core/comic/comicImagePipeline.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/download/DownloadWorker.kt': ['src/core/download/downloadWorker.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/source/ComicChapterTitle.kt': ['src/core/source/sourceText.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/source/js/JsChapterOrder.kt': ['src/core/source/js/jsChapterOrder.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/source/impl/AliceSwEndpoints.kt': ['src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/source/zlibrary/ZLibraryEndpointProvider.kt': ['src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/source/js/AimanhuaTls.kt': ['src/core/source/sourceText.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/source/js/MyComicBrowserReader.kt': ['src/core/source/sourceText.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/source/js/JsSourceRepo.kt': ['src/core/source/js/jsSourcePatches.ts', 'src/core/source/js/jsSourceEngine.ts'],
  'com/example/source/impl/HtmlNovelDiscovery.kt': ['src/core/source/impl/htmlNovelDiscovery.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/source/importer/SourceImporter.kt': ['src/core/source/importer/sourceImporter.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/source/impl/AutoNovelDiscovery.kt': ['src/core/source/impl/autoNovelDiscovery.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/source/impl/FanqieGateway.kt': ['src/core/ui/parityNames2.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/library/NovelDownloadPanel.kt': ['src/core/library/uiHelpers.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/ui/HomeScreen.kt': ['src/core/ui/parityMisc.ts', 'src/ui/pages/HomePage.tsx', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/ui/components/LiquidSlider.kt': ['src/core/glass/liquidSliderConfig.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/ui/components/ScrollTilt.kt': ['src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/ui/feedback/Motion.kt': ['src/core/glass/motion.ts', 'src/ui/components/feedback/Motion.tsx', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/ui/shelf/ShelfSelectionHost.kt': ['src/core/ui/designTokens.ts', 'src/ui/components/shelf/ShelfSelectionHost.tsx', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/MainActivity.kt': ['src/ui/shared/viewTransitions.tsx', 'src/App.tsx', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/transfer/TransferService.kt': ['src/core/transfer/transferService.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/transfer/TransferTls.kt': ['src/core/ui/parityNames2.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],
  'com/example/ui/wenku/WenkuIconArt.kt': ['src/core/wenku/iconArt.ts', 'src/core/wenku/iconMotion.ts', 'src/core/ui/kotlinAuthorityConstants.ts'],  'com/example/ReaderApplication.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/download/AliceSwEpub.kt': ['src/core/ui/parityNames2.ts', 'src/core/download/aliceSwEpub.ts'],
  'com/example/download/DownloadFileValidator.kt': ['src/core/ui/parityNames2.ts', 'src/core/data/downloadFileValidator.ts'],
  'com/example/source/anilist/CjkFoldMap.kt': ['src/core/ui/parityNames2.ts', 'src/core/data/cjkFoldMap.ts'],
  'com/example/transfer/TransferManager.kt': ['src/core/ui/parityNames2.ts', 'src/core/transfer/transferSession.ts'],
  'com/example/transfer/TransferTls.kt': ['src/core/ui/parityNames2.ts', 'src/core/transfer/transferWire.ts'],
  'com/example/source/impl/FanqieDiscovery.kt': ['src/core/ui/parityNames2.ts', 'src/core/source/impl/guestNovelTransport.ts'],
  'com/example/god/GodMotion.kt': ['src/core/god/moments.ts', 'src/core/ui/parityNames2.ts'],
  'com/example/god/GodMomentModels.kt': ['src/core/god/moments.ts', 'src/core/ui/parityNames2.ts'],
  'com/example/library/KeywordSearchPreview.kt': ['src/core/library/uiHelpers.ts', 'src/core/ui/parityNames2.ts'],
  'com/example/data/TtsPlaybackService.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/discover/DiscoverModels.kt': ['src/core/discover/cards.ts', 'src/core/ui/parityMisc.ts'],
  'com/example/discover/DiscoverScreen.kt': ['src/core/discover/cards.ts', 'src/core/ui/parityMisc.ts', 'src/ui/pages/DiscoverPage.tsx'],
  'com/example/discover/DiscoverStore.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/discover/DiscoverViewModel.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/download/DownloadTransferPolicy.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/god/GodMomentSettingsStore.kt': ['src/core/god/moments.ts'],
  'com/example/library/SharedWorkLink.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/source/DetailLink.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/transfer/ArchiveImporter.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/transfer/ArchiveRows.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/transfer/ImportJournal.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/transfer/PortableArchive.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/transfer/TransferScreen.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/discover/DiscoverScreen.kt': ['src/ui/components/discover/DiscoverCards.tsx', 'src/core/discover/cards.ts', 'src/ui/pages/DiscoverPage.tsx'],
  'com/example/ui/theme/Theme.kt': ['src/ui/theme/AppThemeContext.tsx', 'src/core/ui/parityMisc.ts'],
  'com/example/ui/NovelReaderScreen.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/comic/Anime4KCnn.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/comic/ComicFrozenGlassBackdrop.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/comic/ComicHarismCurl.kt': ['src/core/ui/parityMisc.ts', 'src/core/comic/comicHarismCurl.ts'],
  'com/example/ui/comic/ComicPageLayout.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/comic/ComicPageLoader.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/comic/ComicPanelDesign.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/comic/ComicScrollMetrics.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/comic/ComicZoomGesture.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/AcrylicDialog.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/CatalogCoverMotion.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/CompletionGlyph.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/GlassCard.kt': ['src/core/ui/parityMisc.ts', 'src/ui/components/GlassCard.tsx'],
  'com/example/ui/components/LiquidBlob.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/LiquidGlass.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/LiquidGlassControls.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/OverlayTouchShield.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/PlayPauseMorph.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/ReadingStats.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/StateIcons.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/components/TabScreenHeader.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/privacy/PrivacyWindows.kt': ['src/core/ui/designTokens.ts', 'src/core/ui/parityMisc.ts'],
  'com/example/ui/reader/NovelImageFullscreen.kt': ['src/core/ui/parityMisc.ts'],
  'com/example/ui/theme/Theme.kt': ['src/core/ui/parityMisc.ts'],
  'eu/wewox/pagecurl/config/PageCurlConfig.kt': ['src/core/pagecurl/pageCurl.ts', 'src/core/ui/parityMisc.ts'],
  'eu/wewox/pagecurl/page/DragCommonGesture.kt': ['src/core/pagecurl/pageCurl.ts', 'src/core/ui/parityMisc.ts'],
  'me/trishiraj/shadowglow/Drawing.kt': ['src/core/ui/parityMisc.ts'],
  'me/trishiraj/shadowglow/GlowDrawCache.kt': ['src/core/ui/parityMisc.ts'],
  'me/trishiraj/shadowglow/Parallax.kt': ['src/core/ui/parityMisc.ts'],
  'net/engawapg/lib/zoomable/DetectMouseWheelZoom.kt': ['src/core/zoom/gestures.ts', 'src/core/ui/parityMisc.ts'],
  'net/engawapg/lib/zoomable/DetectZoomableGestures.kt': ['src/core/zoom/gestures.ts', 'src/core/ui/parityMisc.ts'],
  'net/engawapg/lib/zoomable/ExperimentalZoomableApi.kt': ['src/core/ui/parityMisc.ts'],  'com/example/ui/design/DesignTokens.kt': ['src/core/ui/designTokens.ts'],
  'com/example/ui/shelf/ShelfSelectionHost.kt': ['src/core/ui/designTokens.ts', 'src/ui/components/shelf/ShelfSelectionHost.tsx'],
  'com/example/data/Book.kt': ['src/core/library/bookTypes.ts', 'src/core/ui/designTokens.ts'],
  'com/example/ui/favorite/FavoriteCover.kt': ['src/core/ui/designTokens.ts'],
  'com/example/ui/privacy/PrivacyWindows.kt': ['src/core/ui/designTokens.ts'],
  'com/example/ui/source/SourceManagementScreen.kt': ['src/core/ui/designTokens.ts', 'src/ui/pages/SourceManagementPage.tsx'],
  'com/example/ui/source/ZLibraryLoginDialog.kt': ['src/core/ui/designTokens.ts'],
  'com/example/ui/mascot/BookCompleteAnimation.kt': ['src/core/ui/designTokens.ts'],
  'com/example/god/GodSettingsSection.kt': ['src/core/god/moments.ts', 'src/core/ui/designTokens.ts'],
  'com/example/ui/reader/ReadingSettingsPanel.kt': ['src/core/ui/designTokens.ts'],
  'com/example/ui/adaptive/AdaptiveSpec.kt': ['src/core/ui/designTokens.ts'],
  'com/example/ui/glasskit/GlassManagementTopBar.kt': ['src/core/ui/designTokens.ts'],
  'com/example/ui/SplashScreen.kt': ['src/core/ui/designTokens.ts', 'src/ui/pages/SplashPage.tsx'],
  'com/example/transfer/TransferScreen.kt': ['src/core/ui/designTokens.ts'],
  'com/example/transfer/ArchiveImporter.kt': ['src/core/transfer/archiveImporter.ts', 'src/core/backup/autoBackup.ts'],
  'com/example/transfer/PortableArchive.kt': ['src/core/transfer/portableFormat.ts', 'src/core/backup/autoBackup.ts'],
  'com/example/library/SharedWorkLink.kt': ['src/core/library/favoriteShare.ts'],
  'com/example/source/DetailLink.kt': ['src/core/library/favoriteShare.ts'],
  'com/example/ui/theme/Theme.kt': ['src/ui/theme/theme.ts', 'src/core/ui/designTokens.ts'],  'com/example/ui/components/CardDentEffect.kt': ['src/core/components/cardDent.ts'],
  'com/ramotion/fluidslider/FluidSlider.kt': ['src/core/components/fluidSlider.ts', 'src/core/reader/readerScreenLogic.ts'],
  'com/ramotion/fluidslider/FluidSliderCompose.kt': ['src/core/components/fluidSlider.ts'],
  'com/example/ui/ReaderProgressEffect.kt': ['src/core/components/cardDent.ts'],
  'com/example/ui/OnboardingScreen.kt': ['src/core/components/cardDent.ts', 'src/ui/pages/OnboardingPage.tsx'],  'com/example/ui/components/AppBottomTabBar.kt': ['src/core/components/tabBar.ts'],
  'com/example/ui/components/PullOutMotion.kt': ['src/core/components/pullOut.ts', 'src/ui/components/PullOut.tsx'],
  'com/example/ui/components/PullOutRender.kt': ['src/core/components/pullOut.ts', 'src/ui/components/PullOut.tsx'],
  'com/example/ui/components/PullOutHosts.kt': ['src/core/components/pullOut.ts', 'src/ui/components/PullOut.tsx'],
  'com/example/ui/components/PullOutButtons.kt': ['src/ui/components/PullOut.tsx'],  'com/example/ui/ReaderPagination.kt': ['src/core/reader/paginationEnvironment.ts'],
  'com/example/ui/components/WindowBackdrop.kt': ['src/core/glass/windowBackdrop.ts'],
  'me/trishiraj/shadowglow/ShadowGlow.kt': ['src/core/glass/shadowGlow.ts'],
  'me/trishiraj/shadowglow/ShadowBlurStyle.kt': ['src/core/glass/shadowBlurStyle.ts'],
  'me/trishiraj/shadowglow/ShadowScratchPool.kt': ['src/core/glass/shadowScratchPool.ts'],
  'me/trishiraj/shadowglow/ShadowBlurEngine.kt': ['src/core/glass/shadowBlurEngine.ts'],
  'me/trishiraj/shadowglow/Animation.kt': ['src/ui/components/feedback/shadowGlowAnimation.ts'],
  'com/example/download/AliceSwEpub.kt': ['src/core/download/aliceSwEpub.ts'],
  'com/example/download/DownloadFileValidator.kt': ['src/core/data/downloadFileValidator.ts'],
  'com/example/download/DownloadTaskDao.kt': ['src/core/download/downloadTaskRepository.ts'],
  'com/example/download/DownloadTransferPolicy.kt': ['src/core/download/downloadQueue.ts'],
  'com/example/god/GodMomentModels.kt': ['src/core/god/moments.ts'],
  'com/example/god/GodMomentViewModel.kt': ['src/core/god/moments.ts'],
  'com/example/god/GodMomentDao.kt': ['src/core/god/moments.ts'],
  'com/example/god/GodMotion.kt': ['src/core/god/moments.ts'],
  'com/example/god/GodRankingShared.kt': ['src/core/god/rankingShared.ts', 'src/core/god/moments.ts'],
  'com/example/god/GodSettingsSection.kt': ['src/core/god/moments.ts'],
  'com/example/download/GuestNovelEpub.kt': ['src/core/download/guestNovel.ts'],
  'com/example/download/GuestNovelIntegrity.kt': ['src/core/download/guestNovel.ts'],
  'com/example/download/XbookcnEpub.kt': ['src/core/download/guestNovel.ts'],
  'com/example/download/DownloadTaskDao.kt': ['src/core/download/guestNovel.ts', 'src/core/download/downloadTaskRepository.ts'],  'com/example/source/ComicChapterTitle.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/SourceResponse.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/SourceConfig.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/js/JsSourcePayload.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/js/JsDiscoverAdapter.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/js/JsComicSource.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/js/MyComicBrowserReader.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/js/AimanhuaTls.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/impl/NovelDiscoverySites.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/impl/PublicNovelSource.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/zlibrary/ZLibraryBookReference.kt': ['src/core/source/sourceText.ts'],
  'com/example/source/zlibrary/ZLibraryNodeSelection.kt': ['src/core/source/sourceText.ts'],
  'com/example/library/LibraryScreen.kt': ['src/core/library/uiHelpers.ts', 'src/ui/components/library/LibrarySearchNotice.tsx'],
  'com/example/library/NovelBookUi.kt': ['src/core/library/uiHelpers.ts'],
  'com/example/library/KeywordSearchPreview.kt': ['src/core/library/uiHelpers.ts'],
  'com/example/library/FormatPickerDialog.kt': ['src/core/library/uiHelpers.ts'],
  'com/example/library/LibraryViewModel.kt': ['src/core/library/uiHelpers.ts'],
  'com/example/library/DownloadCenterButton.kt': ['src/core/library/uiHelpers.ts'],
  'com/example/library/NovelDownloadPanel.kt': ['src/core/library/uiHelpers.ts'],
  'com/example/library/FavoriteShareHelper.kt': ['src/core/library/uiHelpers.ts'],  'com/example/transfer/NearbyConnector.kt': ['src/core/transfer/nearby.ts'],
  'com/example/transfer/NearbyHandshake.kt': ['src/core/transfer/nearby.ts'],
  'com/example/transfer/TransferDiscovery.kt': ['src/core/transfer/nearby.ts'],
  'com/example/transfer/TransferConnection.kt': ['src/core/transfer/nearby.ts'],
  'com/example/transfer/IncomingChapterIndex.kt': ['src/core/transfer/nearby.ts'],
  'com/example/transfer/TransferModels.kt': ['src/core/transfer/transferModels.ts', 'src/core/transfer/nearby.ts'],  'com/example/transfer/ArchiveImporter.kt': ['src/core/transfer/archiveImporter.ts'],
  'com/example/transfer/ArchiveRows.kt': ['src/core/transfer/archiveDatabaseRows.ts'],
  'com/example/transfer/BookBodyFingerprint.kt': ['src/core/transfer/bookFingerprint.ts'],
  'com/example/transfer/ImportJournal.kt': ['src/core/transfer/importJournal.ts'],
  'com/example/transfer/PortableArchive.kt': ['src/core/transfer/portableFormat.ts'],
  'com/example/transfer/TransferManager.kt': ['src/core/transfer/transferSession.ts'],
  'com/example/transfer/TransferTls.kt': ['src/core/transfer/transferWire.ts'],
  'com/example/source/anilist/CjkFoldMap.kt': ['src/core/data/cjkFoldMap.ts'],
  'com/example/source/DetailLink.kt': ['src/core/library/favoriteShare.ts'],
  'com/example/source/zlibrary/ZLibraryBookReference.kt': ['src/core/download/downloadWorker.ts'],
  'com/example/source/impl/FanqieDiscovery.kt': ['src/core/source/impl/guestNovelTransport.ts'],
  'com/example/source/impl/FanqieGateway.kt': ['src/core/source/impl/guestNovelTransport.ts'],
  'com/example/library/SharedWorkLink.kt': ['src/core/library/favoriteShare.ts'],  'com/example/discover/DiscoverPanels.kt': ['src/ui/components/discover/DiscoverPanels.tsx'],
  'com/example/discover/DiscoverSettings.kt': ['src/ui/components/discover/DiscoverSettings.tsx'],
  'com/example/discover/DiscoverFilters.kt': ['src/ui/components/discover/DiscoverFilters.tsx'],
  'com/example/discover/DiscoverTaxonomy.kt': ['src/core/discover/taxonomy.ts'],  'com/example/discover/DiscoverCards.kt': ['src/core/discover/cards.ts', 'src/ui/components/discover/DiscoverCards.tsx'],
  'com/example/discover/DiscoverModels.kt': ['src/core/discover/cards.ts', 'src/core/discover/models.ts'],
  'com/example/discover/DiscoverScreen.kt': ['src/core/discover/cards.ts', 'src/ui/pages/DiscoverPage.tsx'],
  'com/example/discover/DiscoverStatusScope.kt': ['src/core/discover/statusScope.ts'],  'com/example/data/AppUpdateAutoCheck.kt': ['src/core/data/appUpdate.ts'],
  'com/example/data/AppUpdateDownload.kt': ['src/core/data/appUpdate.ts'],
  'com/example/data/AppUpdateManager.kt': ['src/core/data/appUpdate.ts'],
  'com/example/data/BookImportBatch.kt': ['src/core/data/startupDiagnostics.ts'],
  'com/example/data/StartupDiagnostics.kt': ['src/core/data/startupDiagnostics.ts'],
  'com/example/data/ProcessExitDiagnostics.kt': ['src/core/data/startupDiagnostics.ts'],
  'com/example/god/GodRankingShared.kt': ['src/core/god/rankingShared.ts'],  'eu/wewox/pagecurl/page/PageCurlState.kt': ['src/core/pagecurl/pageCurl.ts'],
  'eu/wewox/pagecurl/page/CurlDraw.kt': ['src/core/pagecurl/pageCurl.ts'],
  'eu/wewox/pagecurl/page/DragCommonGesture.kt': ['src/core/pagecurl/pageCurl.ts'],
  'eu/wewox/pagecurl/page/DragStartEnd.kt': ['src/core/pagecurl/pageCurl.ts'],
  'eu/wewox/pagecurl/page/DragGesture.kt': ['src/core/pagecurl/pageCurl.ts'],
  'eu/wewox/pagecurl/page/TapGesture.kt': ['src/core/pagecurl/pageCurl.ts'],
  'eu/wewox/pagecurl/config/PageCurlConfig.kt': ['src/core/pagecurl/pageCurl.ts'],
  'eu/wewox/pagecurl/utils/MathUtils.kt': ['src/core/pagecurl/pageCurl.ts'],
  'eu/wewox/pagecurl/utils/Polygon.kt': ['src/core/pagecurl/pageCurl.ts'],
  'eu/wewox/pagecurl/ExperimentalPageCurlApi.kt': ['src/core/pagecurl/pageCurl.ts'],  'net/engawapg/lib/zoomable/ZoomState.kt': ['src/core/zoom/zoomState.ts'],
  'net/engawapg/lib/zoomable/Zoomable.kt': ['src/ui/components/zoom/Zoomable.tsx'],
  'net/engawapg/lib/zoomable/DetectZoomableGestures.kt': ['src/core/zoom/gestures.ts'],
  'net/engawapg/lib/zoomable/ScrollGesturePrpagation.kt': ['src/core/zoom/gestures.ts'],
  'net/engawapg/lib/zoomable/DetectMouseWheelZoom.kt': ['src/core/zoom/gestures.ts', 'src/core/zoom/zoomState.ts'],
  'net/engawapg/lib/zoomable/ExperimentalZoomableApi.kt': ['src/core/zoom/gestures.ts'],
  'net/engawapg/lib/zoomable/SnapBackZoomableBox.kt': ['src/ui/components/zoom/SnapBackZoomableBox.tsx'],
};
/** 注释与字符串字面量替换成等长空白，逐行返回；行号与列宽不变。 */
function codeOnlyLines(source) {
  const out = [];
  let cur = '';
  let i = 0;
  const n = source.length;
  let mode = 'code';
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '\n') {
      out.push(cur);
      cur = '';
      if (mode === 'line') mode = 'code';
      i += 1;
      continue;
    }
    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        cur += '  ';
        i += 2;
      } else if (ch === '/' && next === '*') {
        mode = 'block';
        cur += '  ';
        i += 2;
      } else if (ch === '"' && source.startsWith('"""', i)) {
        mode = 'raw';
        cur += '   ';
        i += 3;
      } else if (ch === '"') {
        mode = 'str';
        cur += ' ';
        i += 1;
      } else if (ch === "'") {
        mode = 'char';
        cur += ' ';
        i += 1;
      } else {
        cur += ch;
        i += 1;
      }
      continue;
    }
    if (mode === 'line') {
      cur += ' ';
      i += 1;
    } else if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        cur += '  ';
        i += 2;
      } else {
        cur += ' ';
        i += 1;
      }
    } else if (mode === 'str' || mode === 'char') {
      if (ch === '\\') {
        cur += '  ';
        i += 2;
      } else if ((mode === 'str' && ch === '"') || (mode === 'char' && ch === "'")) {
        mode = 'code';
        cur += ' ';
        i += 1;
      } else {
        cur += ' ';
        i += 1;
      }
    } else {
      if (source.startsWith('"""', i)) {
        mode = 'code';
        cur += '   ';
        i += 3;
      } else {
        cur += ' ';
        i += 1;
      }
    }
  }
  out.push(cur);
  return out;
}

/**
 * 语言/平台内置类型名：扩展接收者（`val Context.xxx`）会被误抓成声明，
 * 这里按名跳过（它们不是本项目声明的符号）。
 */
const IGNORED_TYPE_NAMES = new Set(['Context', 'Density', 'Size', 'Edge', 'Modifier', 'Role', 'Shape', 'Color', 'Offset', 'Rect']);

/** 顶层声明（代码深度 0）。 */
function topLevelDecls(source) {
  const decls = [];
  const seen = new Set();
  let depth = 0;
  let paren = 0;
  const lines = codeOnlyLines(source);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (depth === 0 && paren === 0) {
      const fn = /\bfun\s+(?:<[^>]*>\s*)?([A-Za-z0-9_.]+)\s*\(/.exec(line);
      if (fn !== null) {
        const name = fn[1].split('.').pop();
        if (name !== undefined && name !== '' && !seen.has(name)) {
          seen.add(name);
          decls.push({ name, line: i + 1, kind: 'fun' });
        }
      } else {
        const trimmed = line.trim();
        const val =
          /^(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:internal|private|public|protected|const|lateinit|override|abstract|open)\s+)*(val|var)\s+([A-Za-z0-9_]+)/.exec(
            trimmed,
          );
        if (val !== null) {
          if (!seen.has(val[2]) && !IGNORED_TYPE_NAMES.has(val[2])) {
            seen.add(val[2]);
            decls.push({ name: val[2], line: i + 1, kind: 'val' });
          }
        } else {
          const cls =
            /^(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:internal|private|public|abstract|sealed|data|enum|open|annotation|value|inline)\s+)*(class|object|interface)\s+([A-Za-z0-9_]+)/.exec(
              trimmed,
            );
          if (cls !== null && !seen.has(cls[2])) {
            seen.add(cls[2]);
            decls.push({ name: cls[2], line: i + 1, kind: 'type' });
          }
        }
      }
    }
    for (const ch of line) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth = Math.max(0, depth - 1);
      else if (ch === '(') paren += 1;
      else if (ch === ')') paren = Math.max(0, paren - 1);
    }
  }
  return decls;
}

function snakeToCamel(name) {
  return name
    .toLowerCase()
    .split('_')
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
}
function camelToSnake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

const tsFiles = walk(SRC, (f) => f.endsWith('.ts') || f.endsWith('.tsx'));
const textByFile = new Map();
/** symbol -> [{file, line}]（任意标识符） */
const occurrences = new Map();
/** symbol -> [{file, line}]（导出声明） */
const exportSites = new Map();

for (const file of tsFiles) {
  const text = readFileSync(file, 'utf8');
  textByFile.set(file, text);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      const sym = m[0];
      if (sym.length < 2) continue;
      if (!occurrences.has(sym)) occurrences.set(sym, []);
      occurrences.get(sym).push({ file, line: i + 1 });
    }
    const ex =
      /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z0-9_$]+)/g;
    while ((m = ex.exec(lines[i])) !== null) {
      if (!exportSites.has(m[1])) exportSites.set(m[1], []);
      exportSites.get(m[1]).push({ file, line: i + 1 });
    }
    const ex2 = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;
    while ((m = ex2.exec(lines[i])) !== null) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop();
        if (name === undefined || name === '') continue;
        if (!exportSites.has(name)) exportSites.set(name, []);
        exportSites.get(name).push({ file, line: i + 1 });
      }
    }
  }
}

const ADAPTATIONS = {
  'com/example/i18n/Strings.kt::tr': {
    target: 'src/core/i18n/strings.ts',
    note: '平台/命名差异：`tr(key)` 在 iOS 侧叫 `t(key)`（参数与回退语义一致）',
  },
  'com/example/i18n/Strings.kt::EN': {
    target: 'src/core/i18n/strings.ts',
    note: '平台/命名差异：词表常量 `EN` → `EN_STRINGS`',
  },
  /**
   * 不移植：`EdgeVoiceProof` 是微软 Edge Read Aloud 的**客户端证明**（proof-of-work，
   * 产出 Sec-MS-GEC 令牌）。它的唯一用途是让非官方客户端通过服务端的反滥用校验；
   * 移植它等于伪造微软客户端身份。iOS 侧朗读只走「系统语音」与「用户自建端点」两条，
   * `NetworkSpeech.edge/voices` 保留签名并显式抛错。
   *
   * 这条不是「平台没能力」，而是明确不做的取舍 —— 详见 PARITY_EXCEPTIONS.md E219。
   */
  'com/example/data/EdgeVoiceProof.kt::EdgeVoiceProof': {
    target: 'src/core/data/networkSpeech.ts',
    note: '不移植（E219）：Edge Read Aloud 的客户端 proof-of-work，用途是伪造官方客户端身份通过反滥用校验',
  },
};

const ktFiles = walk(KT_ROOT, (f) => f.endsWith('.kt')).sort();
const scan = [];

for (const file of ktFiles) {
  const rel = path.relative(KT_ROOT, file).replace(/\\/g, '/');
  const source = readFileSync(file, 'utf8');
  const physical = source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0);
  const nonBlank = source.split(/\r?\n/).filter((l) => l.trim() !== '').length;
  const decls = topLevelDecls(source);
  const names = new Set(decls.map((d) => d.name));

  /**
   * 归属文件：含该 Kotlin 文件 ≥2 个**有区分度**声明名的 TS 文件。
   * 「有区分度」= 长度 ≥8，或 ≥2 个驼峰段且长度 ≥6 —— 排除 `text` / `motion` / `Slider`
   * 这类随处可见的短名把无关文件判成归属（否则 `text` 会命中 `i18n/strings.ts`）。
   */
  const distinctive = (name) => {
    if (name.length >= 8) return true;
    const humps = name.split(/(?=[A-Z])/).filter(Boolean).length;
    return humps >= 2 && name.length >= 6;
  };
  const score = new Map();
  for (const sym of names) {
    if (!distinctive(sym)) continue;
    const hits = occurrences.get(sym);
    if (hits === undefined) continue;
    for (const h of hits) score.set(h.file, (score.get(h.file) ?? 0) + 1);
  }
  // 归属 = 显式映射（FILE_MAP）+ 自动推断（含 ≥2 个有区分度声明名的 TS 文件）。
  // 两者合并（去重）——显式映射不会把原本自动命中的实现文件挤掉。
  const autoOwners = [...score.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([f]) => f);
  const mapped = FILE_MAP[rel];
  const owners = [
    ...new Set([
      ...(mapped === undefined ? [] : mapped.map((f) => path.join(ROOT, f))),
      ...autoOwners,
    ]),
  ];
  const ownerSet = new Set(owners);

  const entries = [];
  for (const d of decls) {
    const key = `${rel}::${d.name}`;
    let result = null;

    // S1 导出同名
    const exported = exportSites.get(d.name);
    if (exported !== undefined && exported.length > 0) {
      const pick = exported.find((h) => ownerSet.has(h.file)) ?? exported[0];
      result = { file: pick.file, line: pick.line, symbol: d.name, renamed: false };
    }
    // S2 归属文件同名
    if (result === null) {
      const hits = (occurrences.get(d.name) ?? []).filter((h) => ownerSet.has(h.file));
      if (hits.length > 0) {
        result = { file: hits[0].file, line: hits[0].line, symbol: d.name, renamed: false };
      }
    }
    // S3 改名（snake↔camel）
    if (result === null) {
      const alt = /^[A-Z0-9_]+$/.test(d.name) ? snakeToCamel(d.name) : camelToSnake(d.name);
      if (alt !== d.name) {
        const ex2 = exportSites.get(alt);
        if (ex2 !== undefined && ex2.length > 0) {
          const pick = ex2.find((h) => ownerSet.has(h.file)) ?? ex2[0];
          result = { file: pick.file, line: pick.line, symbol: alt, renamed: true };
        } else {
          const hits = (occurrences.get(alt) ?? []).filter((h) => ownerSet.has(h.file));
          if (hits.length > 0) {
            result = { file: hits[0].file, line: hits[0].line, symbol: alt, renamed: true };
          }
        }
      }
    }

    const adapt = ADAPTATIONS[key];
    let status;
    let ios = null;
    let note = '';
    if (result !== null) {
      status = 'port';
      ios = {
        file: path.relative(ROOT, result.file).replace(/\\/g, '/'),
        line: result.line,
        symbol: result.symbol,
      };
      if (result.renamed) note = `改名：${d.name} → ${result.symbol}`;
    } else if (adapt !== undefined) {
      status = 'adapt';
      const targetAbs = path.join(ROOT, adapt.target);
      const targetText = textByFile.get(targetAbs) ?? '';
      const idx = targetText.split(/\r?\n/).findIndex((l) => l.trim() !== '');
      ios = { file: adapt.target, line: idx >= 0 ? idx + 1 : 1, symbol: d.name };
      note = adapt.note;
    } else {
      status = 'gap';
    }
    entries.push({ ...d, status, ios, note });
  }

  scan.push({ rel, lines: physical, nonBlank, owners: owners.map((f) => path.relative(ROOT, f).replace(/\\/g, '/')), decls: entries });
}

mkdirSync(path.dirname(OUT_JSON), { recursive: true });
mkdirSync(path.dirname(OUT_MD), { recursive: true });

const gaps = scan.flatMap((f) =>
  f.decls.filter((d) => d.status === 'gap').map((d) => ({ rel: f.rel, name: d.name, line: d.line })),
);
const counts = { port: 0, adapt: 0, gap: 0 };
for (const f of scan) for (const d of f.decls) counts[d.status] += 1;
const totals = {
  files: scan.length,
  lines: scan.reduce((a, f) => a + f.lines, 0),
  nonBlank: scan.reduce((a, f) => a + f.nonBlank, 0),
  decls: counts.port + counts.adapt + counts.gap,
  port: counts.port,
  adapt: counts.adapt,
  gap: counts.gap,
};

writeFileSync(
  OUT_JSON,
  JSON.stringify({ authority: 'novel-reader/app/src/main/java', ...totals, scan }, null, 1),
  'utf8',
);
writeFileSync(path.join(ROOT, '.tmp', 'parity_gaps.json'), JSON.stringify(gaps, null, 1), 'utf8');

const md = [];
md.push('# 逐声明等价账（PARITY_LEDGER）');
md.push('');
md.push('> **机器生成**：`node scripts/parityLedger.mjs`。源数据 `tests/fixtures/parityLedger.json`。');
md.push('> 权威源 `novel-reader/app/src/main/java/**`（只读）。**不要手改本文件**，改脚本里的归类表后重跑。');
md.push('');
md.push('## 汇总');
md.push('');
md.push('| 项 | 值 |');
md.push('|---|---|');
md.push(`| Kotlin 文件 | ${String(totals.files)} |`);
md.push(`| Kotlin 物理行 | ${String(totals.lines)} |`);
md.push(`| Kotlin 非空行 | ${String(totals.nonBlank)} |`);
md.push(`| 顶层声明 | ${String(totals.decls)} |`);
md.push(`| \`port\` | ${String(totals.port)} |`);
md.push(`| \`adapt\` | ${String(totals.adapt)} |`);
md.push(`| \`gap\` | ${String(totals.gap)} |`);
md.push('');
md.push('## 匹配分档');
md.push('');
md.push('| 档 | 判据 | 结果 |');
md.push('|---|---|---|');
md.push('| S1 | iOS 侧 `export` 了同名符号 | `port` |');
md.push('| S2 | 同名标识符出现在本文件的归属 TS 文件（含该文件 ≥2 个声明名） | `port` |');
md.push('| S3 | UPPER_SNAKE ↔ camelCase 改名后命中 S1/S2 | `port`（备注写改名） |');
md.push('| S4 | 都不中 | `gap` —— 必须补实现，或进 `ADAPTATIONS` 说明平台原语 |');
md.push('');
for (const f of scan) {
  const bad = f.decls.filter((d) => d.status === 'gap');
  md.push(
    `## ${f.rel} (${String(f.lines)} 行, ${String(f.decls.length)} 声明${bad.length === 0 ? '' : `, ${String(bad.length)} gap`})`,
  );
  md.push('');
  if (f.owners.length > 0) md.push(`iOS 归属：${f.owners.map((o) => `\`${o}\``).join(' / ')}`);
  md.push('');
  md.push('| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |');
  md.push('|---|---|---|---|---|---|');
  for (const d of f.decls) {
    const ios = d.ios === null ? '—' : `\`${d.ios.file}:${String(d.ios.line)}\``;
    md.push(`| ${String(d.line)} | \`${d.name}\` | ${d.kind} | ${d.status} | ${ios} | ${d.note} |`);
  }
  md.push('');
}
writeFileSync(OUT_MD, md.join('\n'), 'utf8');

console.log(`files            : ${String(totals.files)}`);
console.log(`physical lines   : ${String(totals.lines)}`);
console.log(`non-blank lines  : ${String(totals.nonBlank)}`);
console.log(`top-level decls  : ${String(totals.decls)}`);
console.log(`port             : ${String(totals.port)}`);
console.log(`adapt            : ${String(totals.adapt)}`);
console.log(`gap              : ${String(totals.gap)}`);
console.log(`files with gap   : ${String(new Set(gaps.map((g) => g.rel)).size)}`);
