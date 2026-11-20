/**
 * parityMatrix.mjs —— 从 `tests/fixtures/parityLedger.json` 生成 `docs/PARITY_MATRIX.md`。
 *
 * 一行一个 Kotlin 文件，状态只有三种：
 *   PORTED  —— 该文件全部声明都有对应实现，**且有读 Kotlin 原文的测试**（`TEST_COVERED`）
 *   ADAPTED —— 全部声明都有对应实现，但还缺「读 Kotlin 原文」的测试（或存在已登记的平台差异）
 *   MISSING —— 仍有声明没有对应实现（`gap > 0`）
 *
 * `TEST_COVERED` 是手写表：每个条目对应一个 `tests/**` 文件，该测试用 `androidReference()`
 * 读过这个 Kotlin 文件的原文并断言了常量。**没有测试就不许写 PORTED。**
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ledger = JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'parityLedger.json'), 'utf8'));

/** Kotlin 文件 → 读它原文的测试（`androidReference()`）。 */
const TEST_COVERED = {
  'com/example/ui/wenku/WenkuGlass.kt': 'tests/unit/wenkuGlassControls.test.tsx',
  'com/example/ui/wenku/WenkuTokens.kt': 'tests/parity/wenkuPackageParity.test.ts + tests/unit/wenkuGlassControls.test.tsx',
  'com/example/ui/wenku/WenkuIconArt.kt': 'tests/parity/wenkuPackageParity.test.ts',
  'com/example/ui/wenku/ArchiveShelf.kt': 'tests/parity/wenkuPackageParity.test.ts',
  'com/example/ui/components/AppButton.kt': 'tests/parity/buttonStyleParity.test.ts',
  'com/example/discover/DiscoverSettings.kt': 'tests/parity/discoverSettingsParity.test.ts',
  'com/example/data/ImportSafety.kt': 'tests/parity/discoverSettingsParity.test.ts',
  'com/example/transfer/ArchiveRows.kt': 'tests/parity/archiveRowsParity.test.ts',
  'com/example/transfer/BookBodyFingerprint.kt': 'tests/parity/archiveRowsParity.test.ts',
  'com/example/discover/DiscoverDesign.kt': 'tests/parity/smallDiscoverDesignCoverParity.test.ts',
  'com/example/source/zlibrary/parser/CoverExtractor.kt': 'tests/parity/smallDiscoverDesignCoverParity.test.ts',
  'com/example/ui/theme/IosMotion.kt': 'tests/parity/smallMotionMetadataGlassParity.test.ts',
  'com/example/source/js/JsComicMetadata.kt': 'tests/parity/smallMotionMetadataGlassParity.test.ts',
  'com/example/ui/wenku/WenkuGlassFilters.kt': 'tests/parity/smallMotionMetadataGlassParity.test.ts',
  'com/example/source/js/SourceDns.kt': 'tests/parity/smallDnsDaoBlobParity.test.ts',
  'com/example/god/GodMomentDao.kt': 'tests/parity/smallDnsDaoBlobParity.test.ts',
  'com/example/ui/components/LiquidBlob.kt': 'tests/parity/smallDnsDaoBlobParity.test.ts',
  'com/example/ui/components/StartupDiagnosticsExportButton.kt': 'tests/parity/smallExportMomentsTilesParity.test.ts',
  'com/example/god/GodMomentViewModel.kt': 'tests/parity/smallExportMomentsTilesParity.test.ts',
  'com/example/ui/comic/MangaJaNaiTiles.kt': 'tests/parity/smallExportMomentsTilesParity.test.ts',
  'com/example/source/zlibrary/ZLibraryCredentialStorage.kt': 'tests/parity/smallExportMomentsTilesParity.test.ts',
  'com/example/source/zlibrary/network/ZLibrarySessionManager.kt': 'tests/parity/smallSessionAndRecoveryParity.test.ts',
  'com/example/download/NovelDownloadStore.kt': 'tests/parity/smallSessionAndRecoveryParity.test.ts',
  'com/example/ui/comic/ComicLoadSupport.kt': 'tests/parity/smallSessionAndRecoveryParity.test.ts',
  'com/example/data/HomeRenderRecovery.kt': 'tests/parity/smallSessionAndRecoveryParity.test.ts',
  'com/example/data/favorite/ComicChapterMatching.kt': 'tests/parity/smallMatchingAndTlsParity.test.ts',
  'com/example/source/BookSource.kt': 'tests/parity/smallMatchingAndTlsParity.test.ts',
  'com/example/source/js/AimanhuaTls.kt': 'tests/parity/smallMatchingAndTlsParity.test.ts',
  'com/example/transfer/IncomingChapterIndex.kt': 'tests/parity/smallMatchingAndTlsParity.test.ts',
  'com/example/library/GenericCoverLoader.kt': 'tests/parity/genericCoverLoaderParity.test.ts',
  'com/example/transfer/TransferService.kt': 'tests/parity/smallTransferAndSearchParity.test.ts',
  'com/example/library/SourceSearchCoordinator.kt': 'tests/parity/smallTransferAndSearchParity.test.ts',
  'com/example/library/ReadingRecordMetadata.kt': 'tests/parity/smallTransferAndSearchParity.test.ts',
  'com/example/source/zlibrary/ZLibraryParser.kt': 'tests/parity/smallZlibAndFavoriteParity.test.ts',
  'com/example/source/js/JsImageProcessor.kt': 'tests/parity/smallZlibAndFavoriteParity.test.ts',
  'com/example/data/favorite/ComicFavoriteMatching.kt': 'tests/parity/smallZlibAndFavoriteParity.test.ts',
  'com/example/library/MhttuImageDecryptor.kt': 'tests/parity/smallImageAndDomainParity.test.ts',
  'com/example/data/BookImportBatch.kt': 'tests/parity/smallImageAndDomainParity.test.ts',
  'com/example/discover/DiscoverNovelDetails.kt': 'tests/parity/smallImageAndDomainParity.test.ts',
  'com/example/source/zlibrary/ZLibraryDomainResolver.kt': 'tests/parity/smallImageAndDomainParity.test.ts',
  'com/example/mangatranslate/TranslationFailure.kt': 'tests/parity/smallImageAndDomainParity.test.ts',
  'com/example/source/zlibrary/network/SystemProxyResolver.kt': 'tests/parity/smallImageAndDomainParity.test.ts',
  'com/example/data/ReaderChapterWindow.kt': 'tests/parity/smallReadingWindowParity.test.ts',
  'com/example/ui/source/SourceInfoDialog.kt': 'tests/parity/smallReadingWindowParity.test.ts',
  'com/example/data/TtsPlaybackService.kt': 'tests/parity/smallReadingWindowParity.test.ts',
  'com/example/data/ReadingSession.kt': 'tests/parity/smallReadingWindowParity.test.ts',
  'com/example/data/CharsetSniffer.kt': 'tests/parity/smallReadingWindowParity.test.ts',
  'com/example/source/anilist/TitleNormalizer.kt': 'tests/parity/smallReadingWindowParity.test.ts',
  'com/example/data/favorite/ChapterCatalog.kt': 'tests/parity/smallReadingWindowParity.test.ts',
  'com/example/source/zlibrary/ZLibraryBookReference.kt': 'tests/parity/smallReadingWindowParity.test.ts',
  'com/example/source/ComicSource.kt': 'tests/parity/smallSourcesAndInstallParity.test.ts',
  'com/example/data/AppUpdateInstaller.kt': 'tests/parity/smallSourcesAndInstallParity.test.ts',
  'com/example/data/EncryptedSecretStore.kt': 'tests/parity/smallSourcesAndInstallParity.test.ts',
  'com/ramotion/fluidslider/FluidSliderCompose.kt': 'tests/parity/smallSourcesAndInstallParity.test.ts',
  'com/example/ui/theme/AppInsets.kt': 'tests/parity/smallInsetsAndBudgetParity.test.ts',
  'com/example/mangatranslate/PageMemoryBudget.kt': 'tests/parity/smallInsetsAndBudgetParity.test.ts',
  'com/example/source/js/JsSourcePayload.kt': 'tests/parity/smallInsetsAndBudgetParity.test.ts',
  'com/example/source/NovelInfo.kt': 'tests/parity/smallInsetsAndBudgetParity.test.ts',
  'com/example/source/impl/AliceSwDiscovery.kt': 'tests/parity/smallInsetsAndBudgetParity.test.ts',
  'com/example/source/parser/RuleBudget.kt': 'tests/parity/smallInsetsAndBudgetParity.test.ts',
  'com/example/source/SourceLog.kt': 'tests/parity/smallInsetsAndBudgetParity.test.ts',
  'com/example/source/keyword/LocalKeywordIndex.kt': 'tests/parity/smallInsetsAndBudgetParity.test.ts',
  'com/example/data/ReadingStats.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/source/storage/SourceStorage.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/ReaderApplication.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/ui/comic/MangaJaNaiGpu.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/source/zlibrary/RemoteEndpointConfig.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/source/ComicChapter.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/source/DownloadInfo.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/download/DownloadRequest.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/library/LibraryError.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/data/AppUpdateCleanupReceiver.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/source/SourceResult.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/source/BookFormat.kt': 'tests/parity/smallTypesAndModelsParity.test.ts',
  'com/example/ui/feedback/NavigationMotion.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/mangatranslate/TranslationPrivacy.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/source/AuthenticationState.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/source/LoginCredential.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/data/ContentMutationGate.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/source/SourceException.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/transfer/TransferWire.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/data/ProcessExitDiagnostics.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/library/LibraryUiState.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/source/PufeiImageCacheRetry.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/source/anilist/CjkFoldMap.kt': 'tests/parity/smallCoreSemanticsParity.test.ts',
  'com/example/ui/components/OverlayTouchShield.kt': 'tests/parity/smallSourceNetworkParity.test.ts',
  'com/example/source/DetailLink.kt': 'tests/parity/smallSourceNetworkParity.test.ts',
  'com/example/source/zlibrary/network/ZLibraryNetworkLogger.kt': 'tests/parity/smallSourceNetworkParity.test.ts',
  'com/example/library/ZLibraryNodeConfig.kt': 'tests/parity/smallSourceNetworkParity.test.ts',
  'com/example/source/impl/GuestNovelTransport.kt': 'tests/parity/smallSourceNetworkParity.test.ts',
  'com/example/download/DownloadProgressBroadcaster.kt': 'tests/parity/smallSourceNetworkParity.test.ts',
  'com/example/source/zlibrary/parser/ZLibraryLayoutParser.kt': 'tests/parity/smallSourceNetworkParity.test.ts',
  'com/example/source/SearchBook.kt': 'tests/parity/smallSourceNetworkParity.test.ts',
  'com/example/download/DownloadState.kt': 'tests/parity/smallSourceAndDownloadParity.test.ts',
  'com/example/download/DownloadTransferPolicy.kt': 'tests/parity/smallSourceAndDownloadParity.test.ts',
  'com/example/ui/comic/ComicChapterResume.kt': 'tests/parity/smallSourceAndDownloadParity.test.ts',
  'com/example/source/SourceCapabilities.kt': 'tests/parity/smallSourceAndDownloadParity.test.ts',
  'com/example/data/ReadingTimeSlices.kt': 'tests/parity/smallSourceAndDownloadParity.test.ts',
  'com/example/library/SharedWorkLink.kt': 'tests/parity/smallSourceAndDownloadParity.test.ts',
  'com/example/ui/StatisticsScreen.kt': 'tests/parity/statisticsScreenParity.test.ts',
  'com/example/ui/CacheManagementScreen.kt': 'tests/parity/cacheManagementScreenParity.test.ts',
  'com/example/ui/components/WeeklyReadingChart.kt': 'tests/parity/weeklyReadingChartParity.test.ts',
  'com/example/library/NovelBookUi.kt': 'tests/parity/novelBookUiParity.test.ts',
  'com/example/god/GodRankingExhibits.kt': 'tests/parity/godRankingExhibitsParity.test.ts',
  'com/example/ui/components/ReadingTrendCard.kt': 'tests/parity/readingTrendCardParity.test.ts',
  'com/example/ui/ThemePaletteScreen.kt': 'tests/parity/themePaletteScreenParity.test.ts',
  'com/example/ui/components/ReadingCalendarCard.kt': 'tests/parity/readingCalendarCardParity.test.ts',
  'com/example/ui/components/AcrylicDialog.kt': 'tests/parity/acrylicDialogParity.test.ts',
  'com/example/library/NovelDownloadPanel.kt': 'tests/parity/novelDownloadPanelParity.test.ts',
  'com/example/god/GodSettingsSection.kt': 'tests/parity/godSettingsSectionParity.test.ts',
  'com/example/ui/glasskit/GlassKit.kt': 'tests/parity/glassKitParity.test.ts',
  'com/example/discover/DiscoverCards.kt': 'tests/parity/discoverCardsParity.test.ts',
  'com/example/god/GodStarRating.kt': 'tests/parity/godStarRatingParity.test.ts',
  'com/example/ui/favorite/FavoriteHeart.kt': 'tests/parity/favoriteHeartParity.test.ts',
  'com/example/ui/components/TabScreenHeader.kt': 'tests/parity/tabScreenHeaderParity.test.ts',
  'com/example/ui/wenku/ShelfCoverArt.kt': 'tests/parity/shelfCoverArtParity.test.ts',
  'com/example/ui/comic/ComicPanelDesign.kt': 'tests/parity/comicPanelDesignParity.test.ts',
  'com/example/god/GodReaderBinding.kt': 'tests/parity/godReaderBindingParity.test.ts',
  'com/example/ui/components/LiquidGlass.kt': 'tests/parity/liquidGlassParity.test.ts',
  'com/example/ui/components/ReadingStats.kt': 'tests/parity/readingStatsParity.test.ts',
  'com/example/library/ZLibraryNodeManager.kt': 'tests/parity/nodeManagerAndComicStoreParity.test.ts',
  'com/example/ui/comic/ComicSettingsStore.kt': 'tests/parity/nodeManagerAndComicStoreParity.test.ts',
  'com/example/ui/components/SourceAvatar.kt': 'tests/parity/sourceAvatarAndStatusScopeParity.test.ts',
  'com/example/discover/DiscoverStatusScope.kt': 'tests/parity/sourceAvatarAndStatusScopeParity.test.ts',
  'com/example/ui/components/AppSwitch.kt': 'tests/parity/switchAndCoverParity.test.ts',
  'com/example/ui/components/ReadingRecordCover.kt': 'tests/parity/switchAndCoverParity.test.ts',
  'com/example/ui/components/GradientActionButton.kt': 'tests/parity/switchAndCoverParity.test.ts',
  'com/example/ui/reader/ReadingGlass.kt': 'tests/parity/readingGlassAndActionSheetParity.test.ts',
  'com/example/ui/wenku/WenkuActionSheet.kt': 'tests/parity/readingGlassAndActionSheetParity.test.ts',
  'com/example/ui/components/CardTweaks.kt': 'tests/parity/cardTweaksAndShadowAnimationParity.test.ts',
  'me/trishiraj/shadowglow/Animation.kt': 'tests/parity/cardTweaksAndShadowAnimationParity.test.ts',
  'com/example/ui/theme/Color.kt': 'tests/parity/themeColorAndAnchorsParity.test.ts',
  'com/example/ui/wenku/WenkuAnchors.kt': 'tests/parity/themeColorAndAnchorsParity.test.ts',
  'com/example/ui/wenku/WenkuPageEntrance.kt': 'tests/parity/themeColorAndAnchorsParity.test.ts',
  'com/example/library/ZLibraryNovelMetadata.kt': 'tests/parity/zlibraryAndCatalogParity.test.ts',
  'com/example/source/zlibrary/ZLibraryNodeSelection.kt': 'tests/parity/zlibraryAndCatalogParity.test.ts',
  'com/example/ui/components/CatalogCoverMotion.kt': 'tests/parity/zlibraryAndCatalogParity.test.ts',
  'com/example/source/SourceRegistration.kt': 'tests/parity/smallModulesParity.test.ts',
  'eu/wewox/pagecurl/utils/RectUtils.kt': 'tests/parity/smallModulesParity.test.ts',
  'com/example/transfer/TransferRoutes.kt': 'tests/parity/smallModulesParity.test.ts',
  'com/example/ui/comic/ComicTurnGesture.kt': 'tests/parity/smallModulesParity.test.ts',
  'com/example/source/js/MxsSpacerPages.kt': 'tests/parity/smallModulesParity.test.ts',
  'com/example/source/NovelContentChecks.kt': 'tests/parity/smallModulesParity.test.ts',
  'com/example/ui/comic/ComicImagePipeline.kt': 'tests/parity/comicPipelineAndDetectorParity.test.ts',
  'com/example/ui/comic/ComicPageLoader.kt': 'tests/parity/comicPipelineAndDetectorParity.test.ts',
  'com/example/library/ZLibraryNativeSession.kt': 'tests/parity/comicPipelineAndDetectorParity.test.ts',
  'com/example/mangatranslate/BubbleDetector.kt': 'tests/parity/comicPipelineAndDetectorParity.test.ts',
  'com/example/ui/components/SettingsControls.kt': 'tests/parity/pageTurnPreviewParity.test.ts',
  'com/example/mangatranslate/MangaTranslationCore.kt': 'tests/parity/shelfSelectAndTranslationParity.test.ts',
  'com/example/ui/wenku/WenkuCoverFlight.kt': 'tests/parity/wenkuFlightVolumeParity.test.ts',
  'com/example/ui/wenku/WenkuReflow.kt': 'tests/parity/wenkuFlightVolumeParity.test.ts',
  'com/example/ui/wenku/ShelfVolumeRender.kt': 'tests/parity/wenkuFlightVolumeParity.test.ts',
  'com/example/ui/components/GlassCard.kt': 'tests/parity/wenkuFlightVolumeParity.test.ts',
  'com/example/god/GodCoverEngine.kt': 'tests/parity/tuningConstantsParity.test.ts',
  'com/example/god/GodMotion.kt': 'tests/parity/tuningConstantsParity.test.ts',
  'com/example/data/AutoBackupStore.kt': 'tests/parity/tuningConstantsParity.test.ts',
  'com/example/source/impl/AliceSwEndpoints.kt': 'tests/parity/tuningConstantsParity.test.ts',
  'com/example/source/zlibrary/ZLibraryEndpointProvider.kt': 'tests/parity/tuningConstantsParity.test.ts',
  'com/example/ui/comic/ComicSceneFx.kt': 'tests/parity/tuningConstantsParity.test.ts',
  'com/example/ui/comic/MangaJaNai.kt': 'tests/parity/tuningConstantsParity.test.ts',
  'com/example/mangatranslate/PageRegionTiling.kt': 'tests/parity/mangaTranslateTuningParity.test.ts',
  'com/example/mangatranslate/MangaOcr.kt': 'tests/parity/mangaTranslateTuningParity.test.ts',
  'com/example/mangatranslate/BubblePipeline.kt': 'tests/parity/mangaTranslateTuningParity.test.ts',
  'com/example/mangatranslate/PageRegionDetector.kt': 'tests/parity/mangaTranslateTuningParity.test.ts',
  'com/example/ui/components/ChasingDots.kt': 'tests/parity/skeletonProgressParity.test.ts',
  'com/example/ui/components/ShimmerBox.kt': 'tests/parity/skeletonProgressParity.test.ts',
  'com/example/ui/components/HazeProgress.kt': 'tests/parity/skeletonProgressParity.test.ts',
  'com/example/ui/components/AppProgressIndicator.kt': 'tests/parity/skeletonProgressParity.test.ts',
  'com/example/ui/components/CompletionGlyph.kt': 'tests/parity/skeletonProgressParity.test.ts',
  'com/example/ui/components/PlayPauseMorph.kt': 'tests/parity/skeletonProgressParity.test.ts',
  'com/example/ui/components/ProducedState.kt': 'tests/parity/skeletonProgressParity.test.ts',
  'com/example/ui/components/ScrollTilt.kt': 'tests/parity/glassFxParity.test.ts',
  'com/example/ui/components/MaxFx.kt': 'tests/parity/glassFxParity.test.ts',

  'com/example/data/AppUpdateManager.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/data/Book.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/data/favorite/FavoriteModels.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/discover/DiscoverModels.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/discover/DiscoverPartition.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/download/DownloadTaskEntity.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/god/GodMomentModels.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/god/GodPull.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/i18n/Strings.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/library/ComicDownloadManager.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/mangatranslate/TextBlockMerger.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/mangaTranslateTuningParity.test.ts',
  'com/example/source/impl/PublicNovelSource.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/ui/adaptive/AdaptiveSpec.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/ui/comic/ComicHarismCurl.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/ui/comic/ComicPageLayout.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/ui/comic/ComicReaderConfig.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/ui/comic/ComicReaderCore.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/ui/comic/MangaJaNaiRuntime.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/ui/components/AppSnackbar.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/ui/components/GlassQuality.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/glassFxParity.test.ts',
  'com/example/ui/favorite/ChapterStatusRow.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/ui/favorite/FavoritesPanel.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/example/ui/feedback/Motion.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/ui/mascot/MascotSpriteSheet.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/ui/pageturn/PageTurnContainer.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/ui/privacy/PrivacyWindows.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/ui/reader/TouchZones.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/ui/shelf/ShelfMultiSelect.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/shelfSelectAndTranslationParity.test.ts',
  'com/example/ui/source/SourceManagementScreen.kt': 'tests/parity/kotlinEnums.test.ts',
  'com/ramotion/fluidslider/FluidSlider.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/fluidSliderParity.test.ts',
  'me/trishiraj/shadowglow/ShadowBlurStyle.kt': 'tests/parity/kotlinEnums.test.ts',
  'net/engawapg/lib/zoomable/MouseWheelZoom.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'net/engawapg/lib/zoomable/ScrollGesturePrpagation.kt': 'tests/parity/kotlinEnums.test.ts + tests/parity/enumTablesParity.test.ts',
  'com/example/library/LibraryScreen.kt': 'tests/unit/wenkuGlassControls.test.tsx',
  'com/example/ui/SettingsTabScreen.kt': 'tests/unit/wenkuGlassControls.test.tsx',
  'me/trishiraj/shadowglow/ShadowGlow.kt': 'tests/unit/roundTwoParity.test.ts',
  'me/trishiraj/shadowglow/ShadowBlurEngine.kt': 'tests/unit/roundTwoParity.test.ts',
  'me/trishiraj/shadowglow/ShadowScratchPool.kt': 'tests/unit/roundTwoParity.test.ts',
  'com/example/transfer/NearbyHandshake.kt': 'tests/unit/roundTwoParity.test.ts',
  'com/example/source/ComicChapterTitle.kt': 'tests/unit/roundTwoParity.test.ts',
  'com/example/ui/wenku/WenkuMenuHost.kt': 'tests/unit/roundTwoParity.test.ts',
  'com/example/ui/ReaderPagination.kt': 'tests/unit/roundTwoParity.test.ts + tests/parity/tuningConstantsParity.test.ts',
  'com/example/data/AppUpdateAutoCheck.kt': 'tests/unit/roundTwoParity.test.ts',
  'com/example/data/AppUpdateDownload.kt': 'tests/unit/roundTwoParity.test.ts',
  'com/example/library/DownloadIndicatorState.kt': 'tests/unit/roundTwoParity.test.ts',
  'com/example/ui/components/LiquidSegmentPhysics.kt': 'tests/unit/roundTwoParity.test.ts',
  'com/example/ui/components/LiquidSegmentShader.kt': 'tests/unit/roundTwoParity.test.ts',
  'com/example/ui/components/PullOutMotion.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/components/PullOutRender.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/components/PullOutHosts.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/components/AppBottomTabBar.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/components/CardDentEffect.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/ReaderProgressEffect.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/OnboardingScreen.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/components/LiquidSlider.kt': 'tests/unit/roundThreeParity.test.ts',
  'net/engawapg/lib/zoomable/ZoomState.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/shelf/ShelfSearch.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/shelf/ShelfMotion.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/transfer/TransferModels.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/library/LibraryNavigation.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/design/DesignTokens.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/shelf/ShelfSelectionHost.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/favorite/FavoriteCover.kt': 'tests/unit/roundThreeParity.test.ts',
  'com/example/ui/comic/MangaJaNaiMobile.kt': 'tests/parity/mangaJaNaiMobileParity.test.ts',
  'com/example/source/js/JsDiscoverAdapter.kt': 'tests/parity/jsDiscoverAdapterParity.test.ts',
  'com/example/ui/components/StarryNightBackground.kt': 'tests/parity/starryNightBackgroundParity.test.ts',
  'com/example/library/LibraryLoginDialog.kt': 'tests/parity/libraryLoginDialogParity.test.ts',
  'com/example/transfer/TransferTls.kt': 'tests/parity/transferTlsParity.test.ts',
  'com/example/ui/source/ZLibraryLoginDialog.kt': 'tests/parity/zlibraryLoginDialogParity.test.ts',
  'com/example/ui/pageturn/PaperPalette.kt': 'tests/parity/paperPaletteStateIconsSettingsParity.test.ts',
  'com/example/ui/components/StateIcons.kt': 'tests/parity/paperPaletteStateIconsSettingsParity.test.ts',
  'com/example/ui/reader/ReadingSettingsPanel.kt': 'tests/parity/paperPaletteStateIconsSettingsParity.test.ts',
  'com/example/source/impl/MockBookSource.kt': 'tests/parity/paperPaletteStateIconsSettingsParity.test.ts',
  'com/example/ui/components/OverlayAnimations.kt': 'tests/parity/overlayEntranceAppBackgroundParity.test.ts',
  'com/example/ui/AppBackground.kt': 'tests/parity/overlayEntranceAppBackgroundParity.test.ts',
  'com/example/source/SourceConfig.kt': 'tests/parity/sourceConfigParity.test.ts',
  'com/example/data/ChapterMerger.kt': 'tests/parity/chapterMergerParity.test.ts',
  'com/example/ui/comic/ComicScrollMetrics.kt': 'tests/parity/comicScrollMetricsParity.test.ts',
  'com/example/ui/ComicMetadataUi.kt': 'tests/parity/comicMetadataAndFrozenGlassParity.test.ts',
  'com/example/ui/comic/ComicFrozenGlassBackdrop.kt': 'tests/parity/comicMetadataAndFrozenGlassParity.test.ts',
  'com/example/ui/components/LiquidGlassControls.kt': 'tests/parity/liquidGlassAndSourceStorageParity.test.ts',
  'com/example/source/storage/SharedPreferencesSourceStorage.kt': 'tests/parity/liquidGlassAndSourceStorageParity.test.ts',
  'com/example/ui/components/OrdinaryControls.kt': 'tests/parity/ordinaryControlsParity.test.ts',
  'com/example/source/storage/SourceStorage.kt': 'tests/parity/sourceStorageAndResponseParity.test.ts',
  'com/example/source/SourceResponse.kt': 'tests/parity/sourceStorageAndResponseParity.test.ts',
  'com/example/ui/comic/ComicNeuralBackend.kt': 'tests/parity/comicNeuralBackendAndLoadingHandoffParity.test.ts',
  'com/example/ui/wenku/WenkuLoadingHandoff.kt': 'tests/parity/comicNeuralBackendAndLoadingHandoffParity.test.ts',
  'com/example/source/impl/AutoNovelDiscovery.kt': 'tests/parity/autoNovelAndDragStartEndParity.test.ts',
  'eu/wewox/pagecurl/page/DragStartEnd.kt': 'tests/parity/autoNovelAndDragStartEndParity.test.ts',
  'eu/wewox/pagecurl/page/DragGesture.kt': 'tests/parity/dragGestureAndParallaxParity.test.ts',
  'me/trishiraj/shadowglow/Parallax.kt': 'tests/parity/dragGestureAndParallaxParity.test.ts',
  'com/example/source/keyword/KeywordCache.kt': 'tests/parity/keywordCacheAndRecordResolverParity.test.ts',
  'com/example/library/ReadingRecordResolver.kt': 'tests/parity/keywordCacheAndRecordResolverParity.test.ts',
  'com/example/transfer/TransferConnection.kt': 'tests/parity/transferConnectionAndGodSettingsParity.test.ts',
  'com/example/god/GodMomentSettingsStore.kt': 'tests/parity/transferConnectionAndGodSettingsParity.test.ts',
  'com/example/library/FavoriteShareHelper.kt': 'tests/parity/favoriteShareAndFaqParity.test.ts',
  'com/example/ui/help/FaqExpandableItem.kt': 'tests/parity/favoriteShareAndFaqParity.test.ts + tests/unit/helpContent.test.ts',
  'com/example/data/LegacyDatabaseMigration.kt': 'tests/parity/legacyMigrationAndImportJournalParity.test.ts',
  'com/example/transfer/ImportJournal.kt': 'tests/parity/legacyMigrationAndImportJournalParity.test.ts',
  'com/example/source/anilist/AniListModels.kt': 'tests/parity/anilistModelsAndNearbyConnectorParity.test.ts',
  'com/example/transfer/NearbyConnector.kt': 'tests/parity/anilistModelsAndNearbyConnectorParity.test.ts',
  'com/example/ui/mascot/MascotAnimationController.kt': 'tests/parity/mascotControllerAndNetworkCallsParity.test.ts + tests/unit/mascotEvents.test.ts + tests/unit/mascotOverlay.test.tsx',
  'com/example/source/NetworkCalls.kt': 'tests/parity/mascotControllerAndNetworkCallsParity.test.ts',
  'com/example/data/AppUpdateStore.kt': 'tests/parity/appUpdateStoreAndGlowDrawCacheParity.test.ts + tests/unit/appUpdateStore.test.ts',
  'me/trishiraj/shadowglow/GlowDrawCache.kt': 'tests/parity/appUpdateStoreAndGlowDrawCacheParity.test.ts',
  'com/example/source/zlibrary/parser/ZLibraryParserManager.kt': 'tests/parity/zlibraryParserManagerAndGuestCheckpointParity.test.ts',
  'com/example/download/GuestNovelCheckpoint.kt': 'tests/parity/zlibraryParserManagerAndGuestCheckpointParity.test.ts',
  'com/example/library/ComicDownloadWorker.kt': 'tests/parity/comicDownloadWorkerAndZlibCoverLoaderParity.test.ts + tests/unit/libraryModule.test.ts',
  'com/example/library/ZLibraryCoverLoader.kt': 'tests/parity/comicDownloadWorkerAndZlibCoverLoaderParity.test.ts',
  'com/example/transfer/PortableSettings.kt': 'tests/parity/portableSettingsParity.test.ts + tests/unit/portableSettings.test.ts',
};

/** 已登记的平台差异（`PARITY_EXCEPTIONS.md` 的 E1xx），在备注里点名。 */
const ADAPTED_NOTES = {
  'com/example/ui/wenku/WenkuGlass.kt': 'E113：lens/AGSL 边缘折射 → CSS backdrop-filter；按压走 `:active`',
  'me/trishiraj/shadowglow/ShadowGlow.kt': 'E118：绘制期贴图 → box-shadow / CSS 合成',
  'me/trishiraj/shadowglow/ShadowBlurEngine.kt': 'E124：Path 画进位图由 UI 层做，alpha 模糊在 core',
  'com/example/ui/components/LiquidSegmentedSelector.kt': 'E119：AGSL → WebGL2；不可用时退 Canvas2D',
  'com/example/ui/components/LiquidSegmentShader.kt': 'E119：AGSL → GLSL ES 3.00（数学逐值保留）',
  'com/example/ui/components/OrdinaryControls.kt': 'E120：Material3 → 原生 input / radiogroup',
  'com/example/ui/shelf/ShelfSearch.kt': 'E107 已落地：ShelfSearchPlane 的斜切降为纯透明度（HANDOFF §4 第 4 条）',
  'com/example/ui/shelf/ShelfMotion.kt': 'E121/E122：GraphicsLayer 快照 → <img> 贴图；随机源 mulberry32',
  'com/example/ui/components/WindowBackdrop.kt': 'E133：RenderEffect → CSS 变量（量化规则一致） + tests/parity/glassFxParity.test.ts',
  'com/example/ui/components/AppButton.kt': 'E132：GlassStyle → backdrop-filter + 渐变高光',
  'net/engawapg/lib/zoomable/SnapBackZoomableBox.kt': 'E130：Popup → position:fixed 覆盖层',
  'net/engawapg/lib/zoomable/Zoomable.kt': 'E129：Modifier → hook；Animatable → rAF',
  'net/engawapg/lib/zoomable/ZoomState.kt': 'E126：Animatable 交给调用方，纯计算在 core',
  'net/engawapg/lib/zoomable/DetectZoomableGestures.kt': 'E127：PointerEventPass → 单 pass + isConsumed',
  'eu/wewox/pagecurl/page/PageCurlState.kt': 'E134：Compose Modifier → 纯函数；网格渲染在 webPageCurl.ts',
  'eu/wewox/pagecurl/page/CurlDraw.kt': 'E134：DrawScope → 绘制计划，由 PageCurlRenderer 消费',
  'eu/wewox/pagecurl/config/PageCurlConfig.kt': 'E134：同上 + tests/parity/enumTablesParity.test.ts',
  'com/example/ui/wenku/WenkuIcon.kt': 'E128：CompositionLocal → Context；Animatable → 调用方时钟',
  'com/example/ui/wenku/WenkuIconArt.kt': 'E128：同文件；图形数据在 WenkuIcon.tsx 的 WENKU_ICON_ART',
  'com/example/discover/DiscoverTaxonomy.kt': 'E135：CjkFoldMap.fold + normalize 由同义 TS 实现提供',
  'com/example/discover/DiscoverPanels.kt': 'E136：ModalBottomSheet → 固定定位面板',
  'com/example/transfer/TransferModels.kt': 'E137：Model 类是纯数据，逐字段移植',
  'com/example/transfer/NearbyConnector.kt': 'E137：DataOutputStream.writeUTF → TextEncoder',

  'com/example/god/GodRankingShared.kt': 'E138：SensorManager → DeviceOrientationEvent（α=.15 / ±8°）',
  'com/example/download/GuestNovelEpub.kt': 'E139：ZipOutputStream → core/epub；Jsoup → htmlDocument 子集',
  'com/example/download/GuestNovelIntegrity.kt': 'E139：同上',
  'com/example/download/XbookcnEpub.kt': 'E139：同上',
  'com/example/ui/wenku/WenkuMotion.kt': 'E125：Modifier → CSS 变量 / 纯函数；位移动画只做局部 translate',
};

/* ══════════════════════════════════════════════════════════════════════════════
   「行为等价」判定：tests/** 直接 import 过该 iOS 归属文件

   口径变更（2026-11-20）：用户要求「前后端行为一致即可，无需严格逐行移植」。
   因此新增第四态 EQUIVALENT —— 实现存在且被测试**直接 import**（不要求逐符号
   逐常量的强断言）。PORTED 仍是更高一档（有读 Kotlin 原文的强断言），EQUIVALENT
   只证明「这个模块被测试执行过」，不证明「每个字面量都对」。
   ══════════════════════════════════════════════════════════════════════════════ */

/** 路径归一：POSIX 斜杠 + 小写（Windows 大小写不敏感）。 */
const normPath = (p) => p.replace(/\\/g, '/').toLowerCase();

/** 递归列出目录下的 .ts / .tsx。 */
function walkSources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 把 import 说明符解析成 src 下的真实文件；无法解析（第三方包）返回 null。 */
function resolveSpecifier(spec, fromDir) {
  let base;
  if (spec.startsWith('@core/')) base = path.join(ROOT, 'src', 'core', spec.slice('@core/'.length));
  else if (spec.startsWith('@ui/')) base = path.join(ROOT, 'src', 'ui', spec.slice('@ui/'.length));
  else if (spec.startsWith('@platform/')) base = path.join(ROOT, 'src', 'platform', spec.slice('@platform/'.length));
  else if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice('@/'.length));
  else if (spec.startsWith('.')) base = path.resolve(fromDir, spec);
  else return null;
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return normPath(candidate);
    } catch {
      // 试下一个候选
    }
  }
  return null;
}

/** 所有被 \`tests/**\` 直接 import 的 src 文件。 */
function collectTestedModules() {
  const tested = new Set();
  for (const testFile of walkSources(path.join(ROOT, 'tests'))) {
    const source = readFileSync(testFile, 'utf8');
    for (const match of source.matchAll(/\bfrom\s+'([^']+)'|\bimport\s*\(\s*'([^']+)'\s*\)/g)) {
      const resolved = resolveSpecifier(match[1] ?? match[2], path.dirname(testFile));
      if (resolved !== null) tested.add(resolved);
    }
  }
  return tested;
}

const TESTED_MODULES = collectTestedModules();

const rows = [];
const counts = { PORTED: 0, EQUIVALENT: 0, ADAPTED: 0, MISSING: 0 };

for (const file of ledger.scan) {
  const gaps = file.decls.filter((d) => d.status === 'gap');
  const rel = file.rel;
  const covered = TEST_COVERED[rel];
  const owners = [...new Set(file.owners ?? [])];
  const testedOwners = owners.filter((owner) => TESTED_MODULES.has(normPath(path.join(ROOT, owner))));
  let status;
  if (gaps.length > 0) status = 'MISSING';
  else if (covered !== undefined) status = 'PORTED';
  else if (testedOwners.length > 0) status = 'EQUIVALENT';
  else status = 'ADAPTED';
  counts[status] += 1;

  const iosFiles = owners;
  const ios = iosFiles.length === 0 ? '—' : iosFiles.map((f) => `\`${f}\``).join('<br>');
  const bits = [];
  if (gaps.length > 0) {
    bits.push(`${gaps.length}/${file.decls.length} 声明待实现：${gaps.slice(0, 6).map((g) => `\`${g.name}\``).join('、')}${gaps.length > 6 ? ' …' : ''}`);
  } else {
    bits.push(`${file.decls.length}/${file.decls.length} 声明有对应`);
  }
  if (covered !== undefined) bits.push(`强断言测试：\`${covered}\``);
  else if (testedOwners.length > 0) {
    const shown = testedOwners.slice(0, 3).map((f) => `\`${f}\``).join('、');
    bits.push(`行为等价（测试直接 import：${shown}${testedOwners.length > 3 ? ' …' : ''}）`);
  }
  const note = ADAPTED_NOTES[rel];
  if (note !== undefined) bits.push(note);
  rows.push(`| ${rel} | ${String(file.lines)} | ${ios} | ${status} | ${bits.join('；')} |`);
}

const header = `# 逐行等价矩阵（PARITY_MATRIX）

> **机器生成**：\`node scripts/parityMatrix.mjs\`。上游数据 \`tests/fixtures/parityLedger.json\`
> （由 \`node scripts/parityLedger.mjs\` 从 \`novel-reader/app/src/main/java/**\` 生成）。
> **不要手改本文件。**

## 实测口径（${new Date().toISOString().slice(0, 10)}）

| 项 | 值 | 依据 |
|---|---|---|
| Kotlin 文件 | **${String(ledger.files)}** | \`Get-ChildItem novel-reader/app/src/main/java -Recurse -Filter *.kt\` |
| Kotlin 物理行 | **${String(ledger.lines)}** | 逐文件 \`Measure-Object -Line\` 求和 |
| Kotlin 非空行 | **${String(ledger.nonBlank)}** | 去空行求和 |
| 顶层声明 | **${String(ledger.decls)}** | 词法器剥注释/字符串后按花括号深度 0 抓取 |
| \`port\`（有对应实现） | **${String(ledger.port)}** | 见下表判据 |
| \`adapt\` | **${String(ledger.adapt)}** | 手写归类表（当前为空） |
| \`gap\`（真缺口） | **${String(ledger.gap)}** | 仍无同名/改名实现 |

## 三态口径

| 状态 | 含义 | 本表判定 |
|---|---|---|
| \`PORTED\` | 逐行对应 + 有读 Kotlin 原文的测试 | 该文件 \`gap == 0\` **且** 在 \`TEST_COVERED\` 里登记了测试 |
| \`EQUIVALENT\` | **行为等价**：iOS 侧实现存在且被测试直接 import（不要求逐行逐符号） | 该文件 \`gap == 0\`、无强断言，但 \`owners\` 里至少一个文件被 \`tests/**\` 直接 import |
| \`ADAPTED\` | 有意不同（平台限制）或**尚缺读 Kotlin 的测试** | 该文件 \`gap == 0\` 但没有测试 |
| \`MISSING\` | 还没做 | 该文件仍有 \`gap\` 声明 |

**当前统计**：\`PORTED ${String(counts.PORTED)}\` / \`EQUIVALENT ${String(counts.EQUIVALENT)}\` / \`ADAPTED ${String(counts.ADAPTED)}\` / \`MISSING ${String(counts.MISSING)}\`
（合计 ${String(rows.length)} = ${String(ledger.files)} 个 Kotlin 文件）。

> **当前状态（如实记录）**
> - \`MISSING = ${String(counts.MISSING)}\` —— 声明级已归零：每个 Kotlin 顶层声明在 iOS 侧都有同名或改名后的实现。
> - \`PORTED = ${String(counts.PORTED)}\` —— 有**强断言**（逐符号、逐常量、逐文案对拍）测试覆盖的文件数。
> - \`EQUIVALENT = ${String(counts.EQUIVALENT)}\` —— **行为等价**：实现存在且被 \`tests/**\` 直接 import；
>   口径依据用户 2026-11-20 指令「前后端行为一致即可，无需严格逐行移植」。
>   它证明「模块被测试执行过」，不证明「每个字面量都对」—— 强断言仍归 PORTED。
> - \`ADAPTED = ${String(counts.ADAPTED)}\` —— 实现齐，但既无强断言也无任何测试触达。
>
> 另有两条**跨全量**的自动门禁（不改变三态判定，只做兜底）：
> \`tests/parity/kotlinLiterals.test.ts\`（478 文件的 const/枚举字面量必须出现在 iOS 侧归属文件里）
> 与 \`tests/parity/constNameBinding.test.ts\`（\`const val\` 的名字与数值**双对齐**，漂移即红）。
> 弱断言不能替代强断言 —— 它只能证明「值被搬过去了」，证明不了「行为等价」。

## 矩阵

| Kotlin 文件（相对 \`app/src/main/java\`） | 行数 | iOS 对应 | 状态 | 备注 |
|---|---|---|---|---|
`;

const footer = `
## 判据（\`scripts/parityLedger.mjs\`）

| 档 | 判据 | 结果 |
|---|---|---|
| S1 | iOS 侧 \`export\` 了同名符号 | \`port\` |
| S2 | 同名标识符出现在该文件的显式映射（\`FILE_MAP\`）或归属文件 | \`port\` |
| S3 | UPPER_SNAKE ↔ camelCase 改名后命中 | \`port\` |
| S4 | 都不中 | \`gap\` |

状态档（在 \`gap == 0\` 前提下）：

| 档 | 判据 |
|---|---|
| PORTED | 在 \`TEST_COVERED\` 里登记了读 Kotlin 原文的强断言测试 |
| EQUIVALENT | 至少一个 \`owners\` 被 \`tests/**\` 直接 import |
| ADAPTED | 两者都没有 |

\`FILE_MAP\` 是逐文件人工核对过的映射（每个条目都指向一个真实存在的实现文件）；
没有登记的文件走「含 ≥2 个有区分度声明名的 TS 文件」自动推断。
`;

writeFileSync(path.join(ROOT, 'docs', 'PARITY_MATRIX.md'), header + rows.join('\n') + footer, 'utf8');
console.log(`rows=${String(rows.length)} PORTED=${String(counts.PORTED)} EQUIVALENT=${String(counts.EQUIVALENT)} ADAPTED=${String(counts.ADAPTED)} MISSING=${String(counts.MISSING)}`);