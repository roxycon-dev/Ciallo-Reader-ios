# 逐声明等价账（PARITY_LEDGER）

> **机器生成**：`node scripts/parityLedger.mjs`。源数据 `tests/fixtures/parityLedger.json`。
> 权威源 `novel-reader/app/src/main/java/**`（只读）。**不要手改本文件**，改脚本里的归类表后重跑。

## 汇总

| 项 | 值 |
|---|---|
| Kotlin 文件 | 497 |
| Kotlin 物理行 | 136650 |
| Kotlin 非空行 | 126899 |
| 顶层声明 | 2108 |
| `port` | 2062 |
| `adapt` | 0 |
| `gap` | 46 |

## 匹配分档

| 档 | 判据 | 结果 |
|---|---|---|
| S1 | iOS 侧 `export` 了同名符号 | `port` |
| S2 | 同名标识符出现在本文件的归属 TS 文件（含该文件 ≥2 个声明名） | `port` |
| S3 | UPPER_SNAKE ↔ camelCase 改名后命中 S1/S2 | `port`（备注写改名） |
| S4 | 都不中 | `gap` —— 必须补实现，或进 `ADAPTATIONS` 说明平台原语 |

## com/example/MainActivity.kt (2115 行, 4 声明)

iOS 归属：`src/ui/shared/viewTransitions.tsx` / `src/App.tsx` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/app/navigation.ts` / `src/ui/state/appStore.ts` / `src/ui/pages/HomePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 100 | `LocalSharedTransitionScope` | val | port | `src/ui/shared/viewTransitions.tsx:29` |  |
| 103 | `ComicJumpState` | type | port | `src/core/app/navigation.ts:338` |  |
| 108 | `LocalNavAnimatedVisibilityScope` | val | port | `src/ui/shared/viewTransitions.tsx:32` |  |
| 111 | `MainActivity` | type | port | `src/App.tsx:2` |  |

## com/example/MainViewModel.kt (1215 行, 1 声明)

iOS 归属：`src/core/app/mainViewModel.ts` / `src/core/library/favoriteAddController.ts` / `src/ui/state/appStore.ts` / `src/ui/pages/HomePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `MainViewModel` | type | port | `src/core/app/mainViewModel.ts:752` |  |

## com/example/ReaderApplication.kt (11 行, 1 声明)

iOS 归属：`src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `ReaderApplication` | type | port | `src/core/ui/parityMisc.ts:26` |  |

## com/example/data/AppDatabase.kt (643 行, 4 声明)

iOS 归属：`src/core/db/schemaV12.ts` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/db/anilistDao.ts` / `src/core/library/bookRepository.ts` / `src/core/db/roomMigrations.ts` / `src/core/source/keyword/keywordRepository.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `BookDao` | type | port | `src/core/db/anilistDao.ts:54` |  |
| 193 | `AniListDao` | type | port | `src/core/db/anilistDao.ts:81` |  |
| 247 | `AniListTitleEntity` | type | port | `src/core/db/anilistDao.ts:66` |  |
| 262 | `AppDatabase` | type | port | `src/core/db/anilistDao.ts:3` |  |

## com/example/data/AppUpdateAutoCheck.kt (108 行, 6 声明)

iOS 归属：`src/core/data/appUpdate.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 17 | `UPDATE_MIRROR_PREFIX` | val | port | `src/core/data/appUpdate.ts:23` |  |
| 18 | `UPDATE_MIRROR_HOST` | val | port | `src/core/data/appUpdate.ts:25` |  |
| 21 | `mirrorDownloadUrl` | fun | port | `src/core/data/appUpdate.ts:74` |  |
| 28 | `officialDownloadUrl` | fun | port | `src/core/data/appUpdate.ts:82` |  |
| 36 | `UpdateCheckCoordination` | type | port | `src/core/data/appUpdate.ts:96` |  |
| 82 | `AppUpdateAutoCheck` | type | port | `src/core/data/appUpdate.ts:2` |  |

## com/example/data/AppUpdateCleanupReceiver.kt (17 行, 1 声明)

iOS 归属：`src/core/update/appUpdateCleanupReceiver.ts` / `src/core/update/index.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `AppUpdateCleanupReceiver` | type | port | `src/core/update/appUpdateCleanupReceiver.ts:69` |  |

## com/example/data/AppUpdateDownload.kt (184 行, 4 声明)

iOS 归属：`src/core/data/appUpdate.ts` / `src/core/update/appUpdateDownload.ts` / `src/core/update/appUpdateManager.ts` / `src/core/update/index.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 29 | `GITHUB_DOWNLOAD_HOSTS` | val | port | `src/core/data/appUpdate.ts:27` |  |
| 32 | `AppUpdateDownload` | type | port | `src/core/update/appUpdateDownload.ts:214` |  |
| 134 | `updateFileSha256` | fun | port | `src/core/update/appUpdateDownload.ts:390` |  |
| 148 | `UpdateApkVerifier` | type | port | `src/core/update/appUpdateDownload.ts:453` |  |

## com/example/data/AppUpdateInstaller.kt (37 行, 1 声明)

iOS 归属：`src/core/update/appUpdateInstaller.ts` / `src/ui/components/AppUpdateDialog.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `AppUpdateInstaller` | type | port | `src/core/update/appUpdateInstaller.ts:3` |  |

## com/example/data/AppUpdateManager.kt (168 行, 4 声明)

iOS 归属：`src/core/data/appUpdate.ts` / `src/core/update/appUpdateManager.ts` / `src/ui/components/AppUpdateDialog.tsx` / `src/ui/pages/SettingsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `AppUpdateSource` | type | port | `src/core/data/appUpdate.ts:35` |  |
| 25 | `AppUpdateStage` | type | port | `src/core/data/appUpdate.ts:47` |  |
| 27 | `AppUpdateState` | type | port | `src/core/update/appUpdateManager.ts:108` |  |
| 42 | `AppUpdateManager` | type | port | `src/core/update/appUpdateManager.ts:243` |  |

## com/example/data/AppUpdateStore.kt (81 行, 2 声明)

iOS 归属：`src/core/update/appUpdateStore.ts` / `src/core/update/appUpdateManager.ts` / `src/core/update/index.ts` / `src/core/update/appUpdateCleanupReceiver.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `PendingAppUpdate` | type | port | `src/core/update/appUpdateStore.ts:104` |  |
| 13 | `AppUpdateStore` | type | port | `src/core/update/appUpdateStore.ts:403` |  |

## com/example/data/AutoBackup.kt (101 行, 1 声明)

iOS 归属：`src/platform/autoBackupRuntime.ts` / `src/core/backup/autoBackup.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 17 | `AutoBackup` | type | port | `src/core/backup/autoBackup.ts:136` |  |

## com/example/data/AutoBackupStore.kt (176 行, 1 声明)

iOS 归属：`src/core/backup/autoBackupStore.ts` / `src/platform/autoBackupRuntime.ts` / `src/core/backup/autoBackup.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 19 | `AutoBackupStore` | type | port | `src/core/backup/autoBackupStore.ts:92` |  |

## com/example/data/BackupArchive.kt (208 行, 1 声明)

iOS 归属：`src/core/backup/backupArchive.ts` / `src/core/backup/backupService.ts` / `src/core/backup/backupArchiveFormat.ts` / `src/core/transfer/archiveJournalRows.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `BackupArchive` | type | port | `src/core/backup/backupArchive.ts:19` |  |

## com/example/data/BackupManager.kt (151 行, 2 声明)

iOS 归属：`src/core/backup/backupService.ts` / `src/core/backup/backupManagerJson.ts` / `src/core/backup/autoBackup.ts` / `src/ui/pages/SettingsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `BackupPayload` | type | port | `src/core/backup/backupManagerJson.ts:26` |  |
| 18 | `BackupManager` | type | port | `src/core/backup/autoBackup.ts:18` |  |

## com/example/data/Book.kt (121 行, 12 声明)

iOS 归属：`src/core/library/bookTypes.ts` / `src/core/ui/designTokens.ts` / `src/core/app/mainViewModel.ts` / `src/ui/pages/StatisticsPage.tsx` / `src/core/library/bookRepository.ts` / `src/ui/pages/ReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `UNSUPPORTED_CHAPTER_TITLE` | val | port | `src/core/library/bookTypes.ts:8` |  |
| 11 | `MAX_CHAPTER_LENGTH` | val | port | `src/core/data/importSafety.ts:24` |  |
| 13 | `ContentType` | type | port | `src/core/library/bookTypes.ts:1` |  |
| 19 | `Book` | type | port | `src/ui/state/appStore.ts:139` |  |
| 49 | `DownloadedComicCount` | type | port | `src/core/ui/designTokens.ts:11` |  |
| 52 | `Chapter` | type | port | `src/core/data/chapterMerger.ts:10` |  |
| 68 | `Bookmark` | type | port | `src/core/library/bookTypes.ts:63` |  |
| 79 | `Highlight` | type | port | `src/core/app/mainViewModel.ts:44` |  |
| 94 | `DEFAULT_CATEGORY` | val | port | `src/core/app/mainViewModel.ts:80` |  |
| 97 | `CategoryEntity` | type | port | `src/core/library/bookTypes.ts:131` |  |
| 105 | `ReadingRecord` | type | port | `src/ui/components/ReadingStats.tsx:33` |  |
| 113 | `SearchResultItem` | type | port | `src/core/data/searchLocator.ts:26` |  |

## com/example/data/BookImportBatch.kt (47 行, 3 声明)

iOS 归属：`src/core/data/startupDiagnostics.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `BookImportProgress` | type | port | `src/core/data/startupDiagnostics.ts:29` |  |
| 9 | `BookImportReport` | type | port | `src/core/data/startupDiagnostics.ts:36` |  |
| 18 | `importBookBatch` | fun | port | `src/core/data/startupDiagnostics.ts:70` |  |

## com/example/data/BookRepository.kt (911 行, 1 声明)

iOS 归属：`src/core/library/bookRepository.ts` / `src/core/library/libraryAssembly.ts` / `src/ui/state/appStore.ts` / `src/core/library/bookRepositoryDisk.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `BookRepository` | type | port | `src/core/library/bookRepository.ts:258` |  |

## com/example/data/ChapterMerger.kt (92 行, 3 声明)

iOS 归属：`src/core/app/mainViewModel.ts` / `src/core/data/chapterMerger.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `CONTINUATION_TITLE` | val | port | `src/core/data/chapterMerger.ts:39` |  |
| 9 | `LogicalChapterBook` | type | port | `src/core/data/chapterMerger.ts:29` |  |
| 33 | `ChapterMerger` | type | port | `src/core/data/chapterMerger.ts:2` |  |

## com/example/data/CharsetSniffer.kt (44 行, 1 声明)

iOS 归属：`src/core/parser/charsetSniffer.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `CharsetSniffer` | type | port | `src/core/parser/charsetSniffer.ts:42` |  |

## com/example/data/ComicParser.kt (162 行, 1 声明)

iOS 归属：`src/core/comic/comicImagePipeline.ts` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/data/naturalOrderCompare.ts` / `src/core/parser/comicParser.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `ComicParser` | type | port | `src/core/data/naturalOrderCompare.ts:2` |  |

## com/example/data/ContentMutationGate.kt (9 行, 1 声明)

iOS 归属：`src/core/app/mainViewModel.ts` / `src/core/data/contentMutationGate.ts` / `src/core/library/contentMutationGate.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 4 | `ContentMutationGate` | type | port | `src/core/app/mainViewModel.ts:1842` |  |

## com/example/data/DocxBookLayout.kt (128 行, 8 声明)

iOS 归属：`src/core/data/docxBookLayout.ts` / `src/core/parser/docxParser.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `DocxParagraph` | type | port | `src/core/data/docxBookLayout.ts:21` |  |
| 10 | `wordTag` | fun | port | `src/core/data/docxBookLayout.ts:28` |  |
| 11 | `childNamed` | fun | port | `src/core/data/docxBookLayout.ts:35` |  |
| 12 | `wordValue` | fun | port | `src/core/data/docxBookLayout.ts:47` |  |
| 15 | `wordDocument` | fun | port | `src/core/data/docxBookLayout.ts:58` |  |
| 17 | `docxParagraphs` | fun | port | `src/core/data/docxBookLayout.ts:63` |  |
| 97 | `tableSpans` | fun | port | `src/core/data/docxBookLayout.ts:212` |  |
| 107 | `wordRunFlags` | fun | port | `src/core/data/docxBookLayout.ts:225` |  |

## com/example/data/DocxParser.kt (180 行, 1 声明)

iOS 归属：`src/core/parser/docxParser.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `DocxParser` | type | port | `src/core/parser/docxParser.ts:2` |  |

## com/example/data/EdgeVoiceProof.kt (188 行, 1 声明)

iOS 归属：`src/core/data/networkSpeech.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `EdgeVoiceProof` | type | port | `src/core/data/networkSpeech.ts:8` |  |

## com/example/data/EncryptedSecretStore.kt (37 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/zLibraryCredentialStorage.ts` / `src/core/library/bookRepository.ts` / `src/core/mangatranslate/llmTranslator.ts` / `src/core/data/encryptedSecretStore.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `EncryptedSecretStore` | type | port | `src/core/data/encryptedSecretStore.ts:22` |  |

## com/example/data/EpubParser.kt (1023 行, 1 声明)

iOS 归属：`src/core/parser/epubImageTokens.ts` / `src/core/parser/epubParser.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 22 | `EpubParser` | type | port | `src/core/parser/epubImageTokens.ts:2` |  |

## com/example/data/Fb2Parser.kt (203 行, 1 声明)

iOS 归属：`src/core/parser/fb2Parser.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `Fb2Parser` | type | port | `src/core/parser/fb2Parser.ts:2` |  |

## com/example/data/FormattedBookText.kt (264 行, 22 声明)

iOS 归属：`src/core/data/formattedBookText.ts` / `src/core/data/docxBookLayout.ts` / `src/ui/reader/bookSpanLayout.ts` / `src/core/data/legacyEpubLayout.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `BookTextSpan` | type | port | `src/core/data/formattedBookText.ts:27` |  |
| 9 | `BookTextStyle` | type | port | `src/core/data/formattedBookText.ts:34` |  |
| 22 | `FormattedBookText` | type | port | `src/core/data/formattedBookText.ts:51` |  |
| 42 | `encodeBookSpans` | fun | port | `src/core/data/formattedBookText.ts:103` |  |
| 45 | `decodeBookSpans` | fun | port | `src/core/data/formattedBookText.ts:111` |  |
| 55 | `spansIn` | fun | port | `src/core/data/formattedBookText.ts:143` |  |
| 61 | `mergeChapterParts` | fun | port | `src/core/data/formattedBookText.ts:170` |  |
| 75 | `htmlFormatRule` | val | port | `src/core/data/formattedBookText.ts:185` | 改名：htmlFormatRule → HTML_FORMAT_RULE |
| 76 | `bookImageToken` | val | port | `src/core/data/formattedBookText.ts:186` | 改名：bookImageToken → BOOK_IMAGE_TOKEN |
| 77 | `horizontalSpace` | val | port | `src/core/data/formattedBookText.ts:187` | 改名：horizontalSpace → HORIZONTAL_SPACE |
| 78 | `cssComment` | val | port | `src/core/data/formattedBookText.ts:188` | 改名：cssComment → CSS_COMMENT |
| 79 | `cssDisplayNone` | val | port | `src/core/data/formattedBookText.ts:189` | 改名：cssDisplayNone → CSS_DISPLAY_NONE |
| 80 | `cssWritingMode` | val | port | `src/core/data/formattedBookText.ts:190` | 改名：cssWritingMode → CSS_WRITING_MODE |
| 82 | `normalizeWritingMode` | fun | port | `src/core/data/formattedBookText.ts:197` |  |
| 89 | `readBookHtml` | fun | port | `src/core/data/formattedBookText.ts:217` |  |
| 145 | `collapseBookWhitespace` | fun | port | `src/core/data/formattedBookText.ts:343` |  |
| 158 | `tableCells` | val | port | `src/core/data/formattedBookText.ts:308` | 改名：tableCells → TABLE_CELLS |
| 159 | `compactBlocks` | val | port | `src/core/data/formattedBookText.ts:308` | 改名：compactBlocks → COMPACT_BLOCKS |
| 161 | `tagFlags` | fun | port | `src/core/data/formattedBookText.ts:389` |  |
| 177 | `cssFlags` | fun | port | `src/core/data/formattedBookText.ts:436` |  |
| 206 | `StyledTextBuilder` | type | port | `src/core/data/formattedBookText.ts:476` |  |
| 256 | `compatibleReaderColumns` | fun | port | `src/core/data/formattedBookText.ts:537` |  |

## com/example/data/GithubUpdateChecker.kt (213 行, 8 声明)

iOS 归属：`src/core/update/githubUpdateChecker.ts` / `src/ui/pages/SettingsPage.tsx` / `src/core/update/appUpdateDownload.ts` / `src/core/update/appUpdateStore.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 19 | `UpdateCheckResult` | type | port | `src/core/update/githubUpdateChecker.ts:122` |  |
| 25 | `UpdateApkAsset` | type | port | `src/core/update/githubUpdateChecker.ts:134` |  |
| 27 | `UpdateRelease` | type | port | `src/core/update/githubUpdateChecker.ts:152` |  |
| 31 | `UPDATE_REPOSITORY` | val | port | `src/core/update/githubUpdateChecker.ts:189` |  |
| 32 | `MAX_UPDATE_BYTES` | val | port | `src/core/update/githubUpdateChecker.ts:191` |  |
| 33 | `checksumLine` | val | port | `src/core/update/githubUpdateChecker.ts:350` |  |
| 36 | `officialUpdateAsset` | fun | port | `src/core/update/githubUpdateChecker.ts:352` |  |
| 49 | `GithubUpdateChecker` | type | port | `src/core/update/githubUpdateChecker.ts:608` |  |

## com/example/data/HomeRenderRecovery.kt (62 行, 1 声明)

iOS 归属：`src/core/app/homeRenderRecovery.ts` / `src/ui/shell/RenderRecoveryBoundary.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `HomeRenderRecovery` | type | port | `src/core/app/homeRenderRecovery.ts:2` |  |

## com/example/data/ImportSafety.kt (74 行, 3 声明)

iOS 归属：`src/core/data/importSafety.ts` / `src/core/parser/docxParser.ts` / `src/core/source/impl/sourceHttp.ts` / `src/core/update/githubUpdateChecker.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `ArchiveBudget` | type | port | `src/core/data/importSafety.ts:111` |  |
| 48 | `readImportBytes` | fun | port | `src/core/data/importSafety.ts:164` |  |
| 55 | `splitChapterText` | fun | port | `src/core/data/importSafety.ts:183` |  |

## com/example/data/LegacyDatabaseMigration.kt (80 行, 1 声明)

iOS 归属：`src/core/db/legacyDatabaseMigration.ts` / `src/core/db/roomMigrations.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `LegacyDatabaseMigration` | type | port | `src/core/db/legacyDatabaseMigration.ts:104` |  |

## com/example/data/LegacyEpubLayout.kt (120 行, 2 声明)

iOS 归属：`src/core/data/legacyEpubLayout.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 16 | `recoverArchivedEpubLayout` | fun | port | `src/core/data/legacyEpubLayout.ts:154` |  |
| 100 | `transferBookStyles` | fun | port | `src/core/data/legacyEpubLayout.ts:28` |  |

## com/example/data/ListeningChapter.kt (42 行, 7 声明, 1 gap)

iOS 归属：`src/core/data/listeningChapter.ts` / `src/ui/reader/listeningHighlight.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `SpokenParagraph` | type | port | `src/core/data/listeningChapter.ts:17` |  |
| 5 | `ListeningChapter` | type | port | `src/core/data/listeningChapter.ts:24` |  |
| 13 | `ListeningState` | type | port | `src/core/data/listeningChapter.ts:33` |  |
| 25 | `inlineImage` | val | port | `src/core/data/listeningChapter.ts:9` |  |
| 26 | `paragraphLine` | val | gap | — |  |
| 28 | `spokenParagraphs` | fun | port | `src/core/data/listeningChapter.ts:72` |  |
| 39 | `formatNovelReadingText` | fun | port | `src/core/data/listeningChapter.ts:111` |  |

## com/example/data/MarkupBookImporter.kt (100 行, 6 声明, 6 gap)


| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `markdownExtensions` | val | gap | — |  |
| 15 | `markdownParser` | val | gap | — |  |
| 16 | `markdownRenderer` | val | gap | — |  |
| 18 | `importMarkupBook` | fun | gap | — |  |
| 47 | `renderBookMarkdown` | fun | gap | — |  |
| 49 | `recognizeBookMarkup` | fun | gap | — |  |

## com/example/data/MdxDictionary.kt (164 行, 6 声明, 6 gap)


| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `MAX_BLOCK` | val | gap | — |  |
| 16 | `MAX_KEYS` | val | gap | — |  |
| 17 | `MAX_EXPANDED` | val | gap | — |  |
| 18 | `MdxKey` | type | gap | — |  |
| 19 | `MdxBlock` | type | gap | — |  |
| 21 | `extractMdxEntries` | fun | gap | — |  |

## com/example/data/MobiDictionary.kt (131 行, 6 声明, 6 gap)


| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `extractMobiEntries` | fun | gap | — |  |
| 30 | `OrthTag` | type | gap | — |  |
| 31 | `OrthValue` | type | gap | — |  |
| 33 | `readMobiOrthIndex` | fun | gap | — |  |
| 113 | `mobiDictionaryEncoding` | fun | gap | — |  |
| 120 | `mobiVariableInt` | fun | gap | — |  |

## com/example/data/MobiParser.kt (974 行, 1 声明)

iOS 归属：`src/core/parser/mobiParser.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 29 | `MobiParser` | type | port | `src/core/parser/mobiParser.ts:2` |  |

## com/example/data/NetworkSpeech.kt (191 行, 5 声明)

iOS 归属：`src/core/data/networkSpeech.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 26 | `SpeechSource` | type | port | `src/core/data/networkSpeech.ts:23` |  |
| 28 | `CustomVoiceService` | type | port | `src/core/data/networkSpeech.ts:31` |  |
| 37 | `EdgeVoice` | type | port | `src/core/data/networkSpeech.ts:67` |  |
| 39 | `NetworkSpeech` | type | port | `src/core/data/networkSpeech.ts:85` |  |
| 183 | `automaticEdgeVoice` | fun | port | `src/core/data/networkSpeech.ts:137` |  |

## com/example/data/PreferencesManager.kt (358 行, 1 声明)

iOS 归属：`src/ui/state/appStore.ts` / `src/core/settings/settingsRepository.ts` / `src/core/library/libraryAssembly.ts` / `src/ui/pages/ReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `PreferencesManager` | type | port | `src/core/settings/settingsRepository.ts:363` |  |

## com/example/data/PrivacyManager.kt (122 行, 1 声明)

iOS 归属：`src/core/privacy/pinKdf.ts` / `src/core/privacy/privacyWindows.ts` / `src/core/app/mainViewModel.ts` / `src/core/mangatranslate/translationPrivacy.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 16 | `PrivacyManager` | type | port | `src/core/privacy/pinKdf.ts:287` |  |

## com/example/data/ProcessExitDiagnostics.kt (27 行, 1 声明)

iOS 归属：`src/core/data/startupDiagnostics.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `ProcessExitDiagnostics` | type | port | `src/core/data/startupDiagnostics.ts:273` |  |

## com/example/data/ReaderChapterWindow.kt (39 行, 2 声明)

iOS 归属：`src/ui/pages/ReaderPage.tsx` / `src/core/data/chapterMerger.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `ReaderChapterWindow` | type | port | `src/core/data/chapterMerger.ts:201` |  |
| 12 | `loadReaderChapterWindow` | fun | port | `src/core/data/chapterMerger.ts:227` |  |

## com/example/data/ReaderDictionaryStore.kt (345 行, 5 声明, 5 gap)


| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `OfflineDictionary` | type | gap | — |  |
| 24 | `DictionaryResult` | type | gap | — |  |
| 26 | `ReaderDictionaryStore` | type | gap | — |  |
| 316 | `dictionaryKey` | fun | gap | — |  |
| 319 | `decodeDefinition` | fun | gap | — |  |

## com/example/data/ReadingSession.kt (44 行, 4 声明)

iOS 归属：`src/core/reader/readingTimer.ts` / `src/core/data/readingSession.ts` / `src/ui/pages/StatisticsPage.tsx` / `src/ui/components/ReadingStats.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `ReadingSession` | type | port | `src/core/data/readingSession.ts:16` |  |
| 29 | `DailyReadingTotal` | type | port | `src/core/data/readingSession.ts:30` |  |
| 35 | `MonthlyReadingTotal` | type | port | `src/core/data/readingSession.ts:36` |  |
| 41 | `YearlyReadingTotal` | type | port | `src/core/data/readingSession.ts:42` |  |

## com/example/data/ReadingStats.kt (1 行, 0 声明)


| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|

## com/example/data/ReadingTimeSlices.kt (32 行, 2 声明)

iOS 归属：`src/core/data/readingTimeSlices.ts` / `src/core/app/mainViewModel.ts` / `src/core/library/readingTimeSlices.ts` / `src/core/reader/readingStatisticsWriter.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `ReadingTimeSlice` | type | port | `src/core/data/readingTimeSlices.ts:9` |  |
| 10 | `ReadingTimeSlices` | type | port | `src/core/app/mainViewModel.ts:1840` |  |

## com/example/data/SearchLocator.kt (102 行, 1 声明)

iOS 归属：`src/core/app/mainViewModel.ts` / `src/ui/pages/ReaderPage.tsx` / `src/core/data/searchLocator.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 13 | `SearchLocator` | type | port | `src/core/app/mainViewModel.ts:1841` |  |

## com/example/data/StartupDiagnostics.kt (220 行, 3 声明)

iOS 归属：`src/core/data/startupDiagnostics.ts` / `src/platform/ios-native/startupDiagnostics.ts` / `src/ui/components/StartupDiagnosticsExportButton.tsx` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `StartupDiagnostics` | type | port | `src/core/data/startupDiagnostics.ts:2` |  |
| 202 | `diagnosedStartupTask` | fun | port | `src/core/data/startupDiagnostics.ts:119` |  |
| 216 | `optionalStartupTask` | fun | port | `src/core/data/startupDiagnostics.ts:147` |  |

## com/example/data/TtsManager.kt (666 行, 3 声明)

iOS 归属：`src/ui/pages/ReaderPage.tsx` / `src/core/reader/readerScreenLogic.ts` / `src/platform/web/ttsMediaSession.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 30 | `TtsManager` | type | port | `src/core/reader/readerScreenLogic.ts:73` |  |
| 647 | `speechChunkEnd` | fun | port | `src/core/reader/readerScreenLogic.ts:1228` |  |
| 657 | `speechLocale` | fun | port | `src/core/reader/readerScreenLogic.ts:1252` |  |

## com/example/data/TtsPlaybackService.kt (155 行, 1 声明)

iOS 归属：`src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `TtsPlaybackService` | type | port | `src/core/ui/parityMisc.ts:51` |  |

## com/example/data/favorite/ChapterCatalog.kt (45 行, 1 声明)

iOS 归属：`src/core/library/favoriteRepository.ts` / `src/ui/pages/ComicChaptersPage.tsx` / `src/core/library/chapterCatalog.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `ChapterCatalog` | type | port | `src/core/library/chapterCatalog.ts:23` |  |

## com/example/data/favorite/ComicChapterMatching.kt (53 行, 2 声明)

iOS 归属：`src/core/library/favoriteTypes.ts` / `src/core/library/favoriteAddController.ts` / `src/core/library/favoriteDao.ts` / `src/core/library/favoriteRepository.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `ComicChapterMatching` | type | port | `src/core/library/favoriteTypes.ts:292` |  |
| 53 | `FavoriteMigrationReport` | type | port | `src/core/library/favoriteTypes.ts:293` |  |

## com/example/data/favorite/ComicFavoriteMatching.kt (51 行, 3 声明)

iOS 归属：`src/core/library/favoriteTypes.ts` / `src/core/app/mainViewModel.ts` / `src/core/library/favoriteAddController.ts` / `src/core/library/comicFavoriteMatching.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `DuplicateComicCandidate` | type | port | `src/core/library/comicFavoriteMatching.ts:77` |  |
| 11 | `FavoriteAddRequest` | type | port | `src/core/library/favoriteTypes.ts:271` |  |
| 21 | `ComicFavoriteMatching` | type | port | `src/core/app/mainViewModel.ts:26` |  |

## com/example/data/favorite/ComicReadingLogic.kt (205 行, 2 声明)

iOS 归属：`src/core/comic/comicChapters.ts` / `src/core/library/comicReadingLogic.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 19 | `OrderedChapter` | type | port | `src/core/library/comicReadingLogic.ts:11` |  |
| 30 | `ComicReadingLogic` | type | port | `src/core/comic/comicChapters.ts:475` |  |

## com/example/data/favorite/FavoriteDao.kt (251 行, 1 声明)

iOS 归属：`src/core/library/favoriteRepository.ts` / `src/core/library/favoriteDao.ts` / `src/core/library/libraryAssembly.ts` / `src/ui/pages/ComicChaptersPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `FavoriteDao` | type | port | `src/core/library/favoriteDao.ts:43` |  |

## com/example/data/favorite/FavoriteModels.kt (158 行, 10 声明)

iOS 归属：`src/core/library/favoriteRepository.ts` / `src/core/library/favoriteTypes.ts` / `src/core/library/favoriteDao.ts` / `src/core/home/homeViewModel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `FAV_DEFAULT_CATEGORY` | val | port | `src/core/library/favoriteTypes.ts:8` |  |
| 17 | `ChapterReadState` | type | port | `src/core/library/favoriteTypes.ts:17` |  |
| 28 | `SerialStatus` | type | port | `src/core/library/favoriteTypes.ts:33` |  |
| 48 | `FavoriteEntity` | type | port | `src/core/library/favoriteTypes.ts:57` |  |
| 78 | `ComicProgressEntity` | type | port | `src/core/library/favoriteTypes.ts:135` |  |
| 110 | `FavoriteCategoryEntity` | type | port | `src/core/library/favoriteTypes.ts:171` |  |
| 122 | `ChapterReadEntity` | type | port | `src/core/library/favoriteTypes.ts:184` |  |
| 140 | `FavoriteItem` | type | port | `src/core/library/favoriteTypes.ts:237` |  |
| 152 | `ComicKey` | type | port | `src/core/library/favoriteTypes.ts:252` |  |
| 158 | `favoriteKey` | fun | port | `src/core/library/favoriteTypes.ts:266` |  |

## com/example/data/favorite/FavoriteRepository.kt (519 行, 4 声明)

iOS 归属：`src/core/library/favoriteRepository.ts` / `src/core/library/favoriteTypes.ts` / `src/core/library/libraryAssembly.ts` / `src/core/favorite/favoriteUi.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `UPDATE_CHECK_INTERVAL_MS` | val | port | `src/core/library/favoriteTypes.ts:14` |  |
| 28 | `ALL_FAV_CATEGORY_NAME` | val | port | `src/core/favorite/favoriteUi.ts:626` |  |
| 39 | `FavoriteRepository` | type | port | `src/core/library/favoriteRepository.ts:59` |  |
| 514 | `serialStatusOf` | fun | port | `src/core/library/favoriteTypes.ts:42` |  |

## com/example/data/remote/AppErrorInterceptor.kt (153 行, 4 声明)

iOS 归属：`src/core/data/remote/appErrorInterceptor.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `NetworkErrorMessage` | type | port | `src/core/data/remote/appErrorInterceptor.ts:157` |  |
| 80 | `ServerMessageExtractor` | type | port | `src/core/data/remote/appErrorInterceptor.ts:257` |  |
| 120 | `AppErrorInterceptor` | type | port | `src/core/data/remote/appErrorInterceptor.ts:322` |  |
| 149 | `isNonRetryableError` | fun | port | `src/core/data/remote/appErrorInterceptor.ts:371` |  |

## com/example/discover/DiscoverCards.kt (338 行, 10 声明)

iOS 归属：`src/core/discover/cards.ts` / `src/ui/components/discover/DiscoverCards.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 48 | `DiscoverCard` | fun | port | `src/ui/components/discover/DiscoverCards.tsx:56` |  |
| 147 | `Cover` | fun | port | `src/ui/components/discover/DiscoverCards.tsx:98` |  |
| 234 | `SourceBadge` | fun | port | `src/ui/components/discover/DiscoverCards.tsx:123` |  |
| 239 | `FollowButton` | fun | port | `src/ui/components/discover/DiscoverCards.tsx:128` |  |
| 248 | `TagRow` | fun | port | `src/ui/components/discover/DiscoverCards.tsx:151` |  |
| 258 | `cardCompact` | fun | port | `src/core/discover/cards.ts:38` |  |
| 265 | `CardDataLine` | fun | port | `src/core/discover/cards.ts:8` |  |
| 288 | `metric` | fun | port | `src/core/discover/cards.ts:106` |  |
| 305 | `Trend` | fun | port | `src/ui/components/discover/DiscoverCards.tsx:195` |  |
| 323 | `DiscoverSkeleton` | fun | port | `src/ui/components/discover/DiscoverCards.tsx:211` |  |

## com/example/discover/DiscoverDesign.kt (69 行, 13 声明)

iOS 归属：`src/core/discover/design.ts` / `src/core/comic/comicImagePipeline.ts` / `src/core/glass/liquidGlass.ts` / `src/ui/components/wenku/WenkuIcon.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 27 | `DiscoverRise` | val | port | `src/core/discover/design.ts:6` |  |
| 28 | `DiscoverFall` | val | port | `src/core/discover/design.ts:7` |  |
| 29 | `DiscoverWarning` | val | port | `src/core/discover/design.ts:8` |  |
| 30 | `DiscoverStopped` | val | port | `src/core/discover/design.ts:9` |  |
| 31 | `DiscoverMedals` | val | port | `src/core/discover/design.ts:10` |  |
| 32 | `contrast` | fun | port | `src/core/discover/design.ts:54` |  |
| 34 | `contrastInk` | fun | port | `src/core/discover/design.ts:61` |  |
| 35 | `themeText` | fun | port | `src/core/discover/design.ts:79` |  |
| 47 | `discoverInk` | fun | port | `src/core/discover/design.ts:14` |  |
| 49 | `discoverTint` | fun | port | `src/core/discover/design.ts:15` |  |
| 51 | `discoverAccentText` | fun | port | `src/core/discover/design.ts:104` |  |
| 55 | `DiscoverGlass` | fun | port | `src/core/discover/design.ts:17` |  |
| 61 | `DiscoverEmptyState` | fun | port | `src/core/discover/design.ts:18` |  |

## com/example/discover/DiscoverFilters.kt (148 行, 2 声明)

iOS 归属：`src/ui/components/discover/DiscoverFilters.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 43 | `DiscoverFilters` | fun | port | `src/ui/components/discover/DiscoverFilters.tsx:69` |  |
| 133 | `discoverPressSelect` | fun | port | `src/ui/components/discover/DiscoverFilters.tsx:173` |  |

## com/example/discover/DiscoverModels.kt (200 行, 11 声明)

iOS 归属：`src/core/discover/cards.ts` / `src/core/discover/models.ts` / `src/core/source/impl/aliceSwDiscover.ts` / `src/core/discover/controller.ts` / `src/core/source/impl/htmlNovelDiscovery.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 19 | `DiscoverDimension` | type | port | `src/core/discover/cards.ts:16` |  |
| 29 | `discoverRangeLabel` | fun | port | `src/core/ui/parityMisc.ts:61` |  |
| 34 | `DiscoverLayout` | type | port | `src/core/discover/models.ts:25` |  |
| 39 | `DiscoverQuery` | type | port | `src/core/discover/models.ts:34` |  |
| 43 | `DiscoverFeed` | type | port | `src/core/discover/models.ts:43` |  |
| 44 | `DiscoverNativeCategory` | type | port | `src/core/discover/models.ts:44` |  |
| 47 | `DiscoverCatalog` | type | port | `src/core/discover/models.ts:45` |  |
| 65 | `DiscoverEntry` | type | port | `src/core/discover/models.ts:59` |  |
| 83 | `DiscoverPage` | type | port | `src/core/discover/models.ts:70` |  |
| 86 | `DiscoverWork` | type | port | `src/core/discover/models.ts:77` |  |
| 92 | `DiscoverEngine` | type | port | `src/core/discover/cards.ts:32` |  |

## com/example/discover/DiscoverNovelDetails.kt (48 行, 1 声明)

iOS 归属：`src/ui/pages/DiscoverPage.tsx` / `src/ui/sharedNovelTarget.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `DiscoverNovelDetails` | fun | port | `src/ui/components/discover/DiscoverNovelDetails.tsx:13` |  |

## com/example/discover/DiscoverPanels.kt (184 行, 5 声明)

iOS 归属：`src/ui/components/discover/DiscoverPanels.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 26 | `DiscoverSourceStatusSheet` | fun | port | `src/ui/components/discover/DiscoverPanels.tsx:37` |  |
| 61 | `DiscoverSourcePicker` | fun | port | `src/ui/components/discover/DiscoverPanels.tsx:89` |  |
| 79 | `SourceOption` | fun | port | `src/ui/components/discover/DiscoverPanels.tsx:107` |  |
| 92 | `DiscoverCategorySheet` | fun | port | `src/ui/components/discover/DiscoverPanels.tsx:142` |  |
| 173 | `CategorySearchHeader` | fun | port | `src/ui/components/discover/DiscoverPanels.tsx:205` |  |

## com/example/discover/DiscoverPartition.kt (21 行, 3 声明)

iOS 归属：`src/core/library/libraryViewModel.ts` / `src/ui/pages/LibraryPage.tsx` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/core/library/libraryReadingRecords.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `DiscoverPartition` | type | port | `src/core/discover/models.ts:12` |  |
| 15 | `SearchBook` | val | port | `src/core/app/mainViewModel.ts:1846` |  |
| 20 | `BookSource` | val | port | `src/core/source/bookSource.ts:23` |  |

## com/example/discover/DiscoverScreen.kt (484 行, 7 声明)

iOS 归属：`src/core/discover/cards.ts` / `src/ui/pages/DiscoverPage.tsx` / `src/ui/components/discover/DiscoverCards.tsx` / `src/core/discover/status.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 81 | `DiscoverScreen` | fun | port | `src/core/discover/cards.ts:46` |  |
| 100 | `DiscoverPartitionContent` | fun | port | `src/ui/components/discover/DiscoverCards.tsx:254` |  |
| 444 | `DiscoverChip` | fun | port | `src/ui/components/discover/DiscoverCards.tsx:269` |  |
| 469 | `serialLabel` | fun | port | `src/core/discover/status.ts:3` |  |
| 475 | `filterWorkStatus` | fun | port | `src/core/discover/status.ts:10` |  |
| 479 | `workStatus` | fun | port | `src/core/discover/cards.ts:56` |  |
| 483 | `dateLabel` | fun | port | `src/core/discover/cards.ts:47` |  |

## com/example/discover/DiscoverSettings.kt (75 行, 2 声明)

iOS 归属：`src/ui/components/discover/DiscoverSettings.tsx` / `src/core/discover/settingsModel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `DiscoverSettings` | fun | port | `src/ui/components/discover/DiscoverSettings.tsx:155` |  |
| 66 | `DiscoverSettingToggle` | fun | port | `src/ui/components/discover/DiscoverSettings.tsx:109` |  |

## com/example/discover/DiscoverStatusScope.kt (34 行, 2 声明)

iOS 归属：`src/core/discover/statusScope.ts` / `src/ui/pages/DiscoverPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `DiscoverStatusScope` | type | port | `src/core/discover/statusScope.ts:21` |  |
| 20 | `discoverStatusScope` | fun | port | `src/core/discover/statusScope.ts:61` |  |

## com/example/discover/DiscoverStore.kt (124 行, 2 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/components/discover/DiscoverSettings.tsx` / `src/core/discover/settingsModel.ts` / `src/core/discover/controller.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 13 | `DiscoverStore` | type | port | `src/core/discover/store.ts:12` |  |
| 114 | `rememberDiscoverStore` | fun | port | `src/core/ui/parityMisc.ts:86` |  |

## com/example/discover/DiscoverTaxonomy.kt (138 行, 3 声明)

iOS 归属：`src/core/discover/taxonomy.ts` / `src/ui/components/discover/DiscoverPanels.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `isAdultDiscoverSource` | fun | port | `src/core/discover/taxonomy.ts:91` |  |
| 6 | `DiscoverCategory` | type | port | `src/core/discover/taxonomy.ts:5` |  |
| 10 | `DiscoverTaxonomy` | type | port | `src/core/discover/taxonomy.ts:68` |  |

## com/example/discover/DiscoverViewModel.kt (315 行, 2 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/discover/controller.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `DiscoverState` | type | port | `src/core/discover/controller.ts:12` |  |
| 23 | `DiscoverViewModel` | type | port | `src/core/ui/parityMisc.ts:73` |  |

## com/example/download/AliceSwEpub.kt (132 行, 1 声明)

iOS 归属：`src/core/download/aliceSwEpub.ts` / `src/core/ui/parityNames2.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `AliceSwEpub` | type | port | `src/core/ui/parityNames2.ts:30` |  |

## com/example/download/DownloadFileValidator.kt (267 行, 1 声明)

iOS 归属：`src/core/data/downloadFileValidator.ts` / `src/core/ui/parityNames2.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 13 | `DownloadFileValidator` | type | port | `src/core/ui/parityNames2.ts:41` |  |

## com/example/download/DownloadManager.kt (320 行, 1 声明)

iOS 归属：`src/core/library/libraryAssembly.ts` / `src/core/download/downloadManager.ts` / `src/ui/components/cache/StorageDetailDialog.tsx` / `src/core/library/bookRepository.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `DownloadManager` | type | port | `src/core/download/downloadManager.ts:198` |  |

## com/example/download/DownloadProgressBroadcaster.kt (23 行, 1 声明)

iOS 归属：`src/core/download/downloadProgressBroadcaster.ts` / `src/core/library/libraryAssembly.ts` / `src/core/download/downloadManager.ts` / `src/core/download/downloadWorker.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `DownloadProgressBroadcaster` | type | port | `src/core/download/downloadProgressBroadcaster.ts:14` |  |

## com/example/download/DownloadRequest.kt (13 行, 1 声明)

iOS 归属：`src/core/download/downloadRequest.ts` / `src/core/library/libraryViewModel.ts` / `src/core/download/downloadManager.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `DownloadRequest` | type | port | `src/core/download/downloadRequest.ts:84` |  |

## com/example/download/DownloadState.kt (20 行, 1 声明)

iOS 归属：`src/ui/pages/LibraryPage.tsx` / `src/core/library/libraryViewModel.ts` / `src/core/library/libraryDisplay.ts` / `src/core/download/downloadState.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `DownloadState` | type | port | `src/core/download/downloadState.ts:7` |  |

## com/example/download/DownloadTaskDao.kt (48 行, 2 声明)

iOS 归属：`src/core/download/guestNovel.ts` / `src/core/download/downloadTaskRepository.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `DownloadTypeConverters` | type | port | `src/core/download/guestNovel.ts:91` |  |
| 19 | `DownloadTaskDao` | type | port | `src/core/download/guestNovel.ts:90` |  |

## com/example/download/DownloadTaskEntity.kt (31 行, 2 声明)

iOS 归属：`src/core/library/bookTypes.ts` / `src/core/download/downloadQueue.ts` / `src/core/enums/kotlinEnums.ts` / `src/ui/components/cache/StorageDetailDialog.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `DownloadStatus` | type | port | `src/core/download/downloadQueue.ts:11` |  |
| 16 | `DownloadTaskEntity` | type | port | `src/core/enums/kotlinEnums.ts:96` |  |

## com/example/download/DownloadTransferPolicy.kt (27 行, 1 声明)

iOS 归属：`src/core/download/downloadQueue.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `DownloadTransferPolicy` | type | port | `src/core/ui/parityMisc.ts:95` |  |

## com/example/download/DownloadWorker.kt (484 行, 1 声明)

iOS 归属：`src/core/download/downloadWorker.ts` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/library/libraryComicDownload.ts` / `src/core/source/sourceText.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 37 | `DownloadWorker` | type | port | `src/core/download/downloadWorker.ts:9` |  |

## com/example/download/GuestNovelCheckpoint.kt (85 行, 1 声明)

iOS 归属：`src/core/download/sourceNovelEpub.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 13 | `GuestNovelCheckpoint` | type | port | `src/core/download/guestNovelCheckpoint.ts:20` |  |

## com/example/download/GuestNovelEpub.kt (117 行, 1 声明)

iOS 归属：`src/core/download/guestNovel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `GuestNovelEpub` | type | port | `src/core/download/guestNovel.ts:28` |  |

## com/example/download/GuestNovelIntegrity.kt (127 行, 1 声明)

iOS 归属：`src/core/download/guestNovel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 17 | `GuestNovelIntegrity` | type | port | `src/core/download/guestNovel.ts:53` |  |

## com/example/download/NovelDownloadStore.kt (53 行, 1 声明)

iOS 归属：`src/core/download/downloadManager.ts` / `src/core/library/libraryAssembly.ts` / `src/core/download/downloadWorker.ts` / `src/core/download/novelDownloadStore.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `NovelDownloadStore` | type | port | `src/core/download/novelDownloadStore.ts:126` |  |

## com/example/download/NovelTextArchive.kt (142 行, 1 声明)

iOS 归属：`src/core/download/novelTextArchive.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 19 | `NovelTextArchive` | type | port | `src/core/download/novelTextArchive.ts:2` |  |

## com/example/download/XbookcnEpub.kt (134 行, 1 声明)

iOS 归属：`src/core/download/guestNovel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `XbookcnEpub` | type | port | `src/core/download/guestNovel.ts:76` |  |

## com/example/god/GodChapterCard.kt (267 行, 2 声明)

iOS 归属：`src/core/god/godChapterCard.ts` / `src/ui/components/god/GodChapterCard.tsx` / `src/core/god/godEasing.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 67 | `GodChapterCard` | fun | port | `src/ui/components/god/GodChapterCard.tsx:132` |  |
| 249 | `GodBadge` | fun | port | `src/ui/components/god/GodChapterCard.tsx:115` |  |

## com/example/god/GodCoverCropScreen.kt (436 行, 3 声明)

iOS 归属：`src/ui/pages/GodCoverCropPage.tsx` / `src/App.tsx` / `src/core/god/godCoverEngine.ts` / `src/ui/components/comic/sheets/ComicCropSheet.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 59 | `MIN_CROP` | val | port | `src/ui/pages/GodCoverCropPage.tsx:8` |  |
| 71 | `GodCoverCropScreen` | fun | port | `src/App.tsx:27` |  |
| 306 | `CropOverlay` | fun | port | `src/ui/components/comic/sheets/ComicCropSheet.tsx:203` |  |

## com/example/god/GodCoverEngine.kt (479 行, 1 声明)

iOS 归属：`src/core/god/godReaderBinding.ts` / `src/core/god/godCoverEngine.ts` / `src/ui/pages/GodCoverCropPage.tsx` / `src/platform/web/webGodCoverComposer.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 48 | `GodCoverEngine` | type | port | `src/core/god/godCoverEngine.ts:4` |  |

## com/example/god/GodMomentDao.kt (68 行, 1 声明)

iOS 归属：`src/core/god/moments.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 17 | `GodMomentDao` | type | port | `src/core/god/moments.ts:198` |  |

## com/example/god/GodMomentModels.kt (341 行, 17 声明)

iOS 归属：`src/core/god/moments.ts` / `src/core/god/godReaderBinding.ts` / `src/core/god/godTypes.ts` / `src/ui/components/god/GodMomentSheet.tsx` / `src/ui/pages/GodEditorPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `GodContentType` | type | port | `src/core/god/godTypes.ts:43` |  |
| 34 | `GodRankingStyle` | type | port | `src/core/god/godTypes.ts:6` |  |
| 50 | `GodSort` | type | port | `src/core/god/godTypes.ts:50` |  |
| 65 | `CoverSource` | type | port | `src/core/god/godTypes.ts:100` |  |
| 86 | `toTag` | fun | port | `src/core/ui/parityNames2.ts:125` |  |
| 92 | `parseCoverSource` | fun | port | `src/core/god/godTypes.ts:226` |  |
| 123 | `CropParams` | type | port | `src/core/god/godTypes.ts:105` |  |
| 180 | `round3` | fun | port | `src/core/ui/parityNames2.ts:99` |  |
| 200 | `GodMomentEntity` | type | port | `src/core/app/mainViewModel.ts:196` |  |
| 244 | `GodMomentItem` | type | port | `src/core/god/godTypes.ts:77` |  |
| 256 | `GodMomentContext` | type | port | `src/core/god/godReaderBinding.ts:134` |  |
| 272 | `GodMomentRequest` | type | port | `src/core/god/godReaderBinding.ts:151` |  |
| 287 | `GodPageRef` | type | port | `src/core/god/godReaderBinding.ts:96` |  |
| 297 | `godPageHeaders` | fun | port | `src/core/god/godReaderBinding.ts:117` |  |
| 308 | `GodMomentEditTarget` | type | port | `src/core/god/moments.ts:24` |  |
| 318 | `GodMomentJumpState` | type | port | `src/core/god/moments.ts:188` |  |
| 327 | `GodStyleSettingsJump` | type | port | `src/core/god/moments.ts:193` |  |

## com/example/god/GodMomentRepository.kt (159 行, 1 声明)

iOS 归属：`src/core/backup/backupService.ts` / `src/core/god/godMoments.ts` / `src/core/god/godMomentRepository.ts` / `src/core/backup/backupManagerJson.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `GodMomentRepository` | type | port | `src/core/god/godMomentRepository.ts:137` |  |

## com/example/god/GodMomentSettingsStore.kt (84 行, 1 声明)

iOS 归属：`src/core/god/moments.ts` / `src/core/god/godRankingSettings.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `GodMomentSettingsStore` | type | port | `src/core/god/godRankingSettings.ts:2` |  |

## com/example/god/GodMomentSheet.kt (1390 行, 21 声明)

iOS 归属：`src/ui/components/god/GodMomentSheet.tsx` / `src/core/god/godReaderBinding.ts` / `src/ui/pages/GodEditorPage.tsx` / `src/core/god/godEasing.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 135 | `rememberGodPrismColors` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:13` |  |
| 157 | `godAcrylicPanel` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:14` |  |
| 226 | `TITLE_MAX` | val | port | `src/core/god/godReaderBinding.ts:49` |  |
| 227 | `NOTE_MAX` | val | port | `src/core/god/godReaderBinding.ts:49` |  |
| 228 | `SHEET_HEIGHT_FRACTION` | val | port | `src/core/god/godReaderBinding.ts:49` |  |
| 239 | `GodMomentSheet` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:769` |  |
| 615 | `GodSheetTitle` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:42` |  |
| 715 | `GodSheetBlock` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:53` |  |
| 746 | `GodCoverSection` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:43` |  |
| 806 | `GodTiltCover` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:55` |  |
| 898 | `GodThumbCache` | type | port | `src/ui/components/god/GodMomentSheet.tsx:56` |  |
| 907 | `GodPageThumb` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:57` |  |
| 999 | `SectionLabel` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:1252` |  |
| 1008 | `GodFormSection` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:9` |  |
| 1050 | `GodTitleField` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:45` |  |
| 1095 | `GodNoteField` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:9` |  |
| 1144 | `GodActionBar` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:48` |  |
| 1190 | `GodShineButton` | fun | port | `src/core/god/godEasing.ts:85` |  |
| 1284 | `GodChipButton` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:64` |  |
| 1330 | `GodBurstOverlay` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:49` |  |
| 1379 | `GodConfirmCloseDialog` | fun | port | `src/ui/components/god/GodMomentSheet.tsx:50` |  |

## com/example/god/GodMomentViewModel.kt (60 行, 1 声明)

iOS 归属：`src/core/god/moments.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 22 | `GodMomentViewModel` | type | port | `src/core/god/moments.ts:217` |  |

## com/example/god/GodMotion.kt (191 行, 7 声明)

iOS 归属：`src/core/god/moments.ts` / `src/ui/components/god/GodMomentSheet.tsx` / `src/core/god/godEasing.ts` / `src/ui/components/god/GodRankingShared.tsx` / `src/ui/components/god/GodPull.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 29 | `GodMotion` | type | port | `src/core/god/godEasing.ts:2` |  |
| 88 | `GodGold` | type | port | `src/core/comic/comicChapters.ts:110` |  |
| 143 | `godIsDark` | fun | port | `src/ui/components/god/GodRankingShared.tsx:100` |  |
| 150 | `rememberReduceMotion` | fun | port | `src/core/god/moments.ts:267` |  |
| 164 | `godSpec` | fun | port | `src/core/ui/parityNames2.ts:104` |  |
| 171 | `godPress` | fun | port | `src/core/ui/parityNames2.ts:114` |  |
| 191 | `staggerDelay` | fun | port | `src/core/ui/parityNames2.ts:119` |  |

## com/example/god/GodPull.kt (397 行, 10 声明)

iOS 归属：`src/ui/components/god/GodPull.tsx` / `src/core/god/godPull.ts` / `src/core/god/godReaderBinding.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 53 | `GodPullEdge` | type | port | `src/core/god/godPull.ts:51` |  |
| 65 | `GodPullState` | type | port | `src/ui/components/god/GodPull.tsx:153` |  |
| 133 | `rememberGodPullState` | fun | port | `src/core/god/godPull.ts:29` |  |
| 172 | `GodPullOverlay` | fun | port | `src/ui/components/god/GodPull.tsx:486` |  |
| 297 | `GodHintCapsule` | fun | port | `src/ui/components/god/GodPull.tsx:713` |  |
| 331 | `godPullConnection` | fun | port | `src/core/god/godPull.ts:19` |  |
| 372 | `godPullScroll` | fun | port | `src/core/god/godPull.ts:33` |  |
| 385 | `dampedToRaw` | fun | port | `src/core/god/godPull.ts:22` |  |
| 394 | `isAtEnd` | fun | port | `src/core/god/godPull.ts:250` |  |
| 397 | `godAbs` | fun | port | `src/core/god/godPull.ts:255` |  |

## com/example/god/GodRankingCard.kt (358 行, 4 声明)

iOS 归属：`src/ui/pages/GodRankingPage.tsx` / `src/ui/components/god/GodRankingBody.tsx` / `src/ui/components/god/GodRankingShared.tsx` / `src/ui/pages/StatisticsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 69 | `GodRankingCard` | fun | port | `src/ui/components/god/GodRankingBody.tsx:632` |  |
| 147 | `GodCountPill` | fun | port | `src/ui/components/god/GodRankingShared.tsx:670` |  |
| 187 | `GodRankingScreen` | fun | port | `src/ui/pages/GodRankingPage.tsx:3` |  |
| 305 | `GodRankingHero` | fun | port | `src/ui/components/god/GodRankingShared.tsx:688` |  |

## com/example/god/GodRankingExhibits.kt (480 行, 5 声明)

iOS 归属：`src/ui/components/god/GodRankingBody.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 53 | `GodPodiumStyle` | fun | port | `src/ui/components/god/GodRankingBody.tsx:3` |  |
| 116 | `GodPodiumTopThree` | fun | port | `src/ui/components/god/GodRankingBody.tsx:3` |  |
| 236 | `GodVinylStyle` | fun | port | `src/ui/components/god/GodRankingBody.tsx:3` |  |
| 352 | `GodRecordDisc` | fun | port | `src/ui/components/god/GodRankingBody.tsx:4` |  |
| 369 | `GodPolaroidStyle` | fun | port | `src/ui/components/god/GodRankingBody.tsx:4` |  |

## com/example/god/GodRankingShared.kt (343 行, 13 声明)

iOS 归属：`src/core/god/rankingShared.ts` / `src/ui/components/god/GodRankingShared.tsx` / `src/core/god/moments.ts` / `src/ui/components/god/GodRankingBody.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 60 | `GodTilt` | type | port | `src/core/god/moments.ts:241` |  |
| 68 | `hasRotationSensor` | fun | port | `src/core/god/moments.ts:273` |  |
| 77 | `rememberGodTilt` | fun | port | `src/core/god/moments.ts:306` |  |
| 119 | `GodCoverImage` | fun | port | `src/ui/components/god/GodRankingShared.tsx:214` |  |
| 149 | `GodCoverPlaceholder` | fun | port | `src/ui/components/god/GodRankingShared.tsx:184` |  |
| 191 | `GodItemMenu` | fun | port | `src/ui/components/god/GodRankingShared.tsx:401` |  |
| 213 | `GodMenuItem` | fun | port | `src/core/god/rankingShared.ts:6` |  |
| 230 | `clickableItem` | fun | port | `src/core/god/rankingShared.ts:27` |  |
| 240 | `GodEmptyState` | fun | port | `src/ui/components/god/GodRankingShared.tsx:332` |  |
| 314 | `GodRankStamp` | fun | port | `src/ui/components/god/GodRankingShared.tsx:318` |  |
| 330 | `centerCropRatio` | fun | port | `src/core/god/rankingShared.ts:32` |  |
| 333 | `stableRandom` | fun | port | `src/core/god/rankingShared.ts:39` |  |
| 343 | `stableTiltDeg` | fun | port | `src/core/god/rankingShared.ts:50` |  |

## com/example/god/GodRankingStyles.kt (285 行, 3 声明)

iOS 归属：`src/ui/components/god/GodRankingBody.tsx` / `src/ui/components/god/GodRankingShared.tsx` / `src/ui/pages/GodRankingPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 95 | `GodRankingInteractions` | type | port | `src/ui/components/god/GodRankingShared.tsx:493` |  |
| 109 | `GodRankingBody` | fun | port | `src/ui/components/god/GodRankingBody.tsx:529` |  |
| 217 | `GodItemCard` | fun | port | `src/ui/components/god/GodRankingShared.tsx:516` |  |

## com/example/god/GodReaderBinding.kt (183 行, 6 声明)

iOS 归属：`src/core/god/godReaderBinding.ts` / `src/ui/pages/ComicReaderOnlinePage.tsx` / `src/core/comic/comicChapters.ts` / `src/ui/pages/ComicChaptersPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `GodMomentBinding` | type | port | `src/core/god/godReaderBinding.ts:8` |  |
| 57 | `rememberGodMomentBinding` | fun | port | `src/core/god/godReaderBinding.ts:12` |  |
| 91 | `GodMomentHost` | fun | port | `src/ui/pages/ComicReaderOnlinePage.tsx:30` |  |
| 126 | `godContextWithLoader` | fun | port | `src/core/god/godReaderBinding.ts:296` |  |
| 133 | `rememberGodEditBinding` | fun | port | `src/core/comic/comicChapters.ts:22` |  |
| 142 | `GodMomentEditHost` | fun | port | `src/core/comic/comicChapters.ts:44` |  |

## com/example/god/GodSettingsSection.kt (269 行, 4 声明)

iOS 归属：`src/core/god/moments.ts` / `src/ui/components/god/GodSettingsSection.tsx` / `src/core/ui/designTokens.ts` / `src/ui/pages/SettingsPage.tsx` / `src/core/god/godSettingsSection.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 56 | `GodSettingsSection` | fun | port | `src/ui/components/god/GodSettingsSection.tsx:175` |  |
| 141 | `GodSettingSwitchRow` | fun | port | `src/core/ui/designTokens.ts:155` |  |
| 173 | `GodStyleCard` | fun | port | `src/core/ui/designTokens.ts:168` |  |
| 260 | `drawRoundRectStyleStep` | fun | port | `src/core/god/moments.ts:309` |  |

## com/example/god/GodStarRating.kt (319 行, 9 声明)

iOS 归属：`src/core/god/godReaderBinding.ts` / `src/ui/components/god/GodStarRatingEditable.tsx` / `src/core/god/godStarRating.ts` / `src/core/god/godTypes.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 52 | `GOD_RATING_MIN` | val | port | `src/core/god/godStarRating.ts:22` |  |
| 53 | `GOD_RATING_MAX` | val | port | `src/core/god/godStarRating.ts:22` |  |
| 54 | `GOD_RATING_STEP` | val | port | `src/core/god/godStarRating.ts:22` |  |
| 56 | `coerceRating` | fun | port | `src/core/god/godStarRating.ts:37` |  |
| 69 | `GodStarRating` | fun | port | `src/core/god/godReaderBinding.ts:2` |  |
| 177 | `GodStar` | fun | port | `src/core/god/godReaderBinding.ts:43` |  |
| 244 | `GodSparks` | fun | port | `src/core/god/godReaderBinding.ts:44` |  |
| 271 | `starPath` | fun | port | `src/core/god/godStarRating.ts:7` |  |
| 287 | `GodStarsReadonly` | fun | port | `src/ui/components/god/GodRankingShared.tsx:255` |  |

## com/example/i18n/Strings.kt (3307 行, 81 声明)

iOS 归属：`src/core/i18n/locale.ts` / `src/core/i18n/strings.ts` / `src/ui/pages/HomePage.tsx` / `src/core/home/homeViewModel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `AppLanguage` | type | port | `src/core/i18n/locale.ts:31` |  |
| 38 | `AppLocale` | type | port | `src/core/i18n/locale.ts:11` |  |
| 54 | `tr` | fun | port | `src/core/i18n/locale.ts:83` |  |
| 57 | `StringTable` | type | port | `src/core/i18n/locale.ts:91` |  |
| 219 | `LocalStrings` | val | port | `src/core/i18n/locale.ts:16` |  |
| 225 | `table` | fun | port | `src/core/home/homeViewModel.ts:21` |  |
| 227 | `chapterCounter` | fun | port | `src/core/i18n/locale.ts:385` |  |
| 228 | `chapterLabel` | fun | port | `src/core/i18n/locale.ts:389` |  |
| 229 | `pageLabel` | fun | port | `src/core/i18n/locale.ts:393` |  |
| 230 | `pageCounter` | fun | port | `src/core/i18n/locale.ts:397` |  |
| 231 | `stepCounter` | fun | port | `src/core/i18n/locale.ts:401` |  |
| 232 | `dayReadLog` | fun | port | `src/core/i18n/locale.ts:405` |  |
| 233 | `weekMinutes` | fun | port | `src/core/i18n/locale.ts:409` |  |
| 234 | `restReminder` | fun | port | `src/core/i18n/locale.ts:413` |  |
| 235 | `expandAll` | fun | port | `src/core/i18n/locale.ts:417` |  |
| 236 | `clearSearchHistory` | fun | port | `src/core/i18n/locale.ts:421` |  |
| 237 | `totalOf` | fun | port | `src/core/i18n/locale.ts:425` |  |
| 238 | `itemsOfTotal` | fun | port | `src/core/i18n/locale.ts:429` |  |
| 239 | `remainingOfTotal` | fun | port | `src/core/i18n/locale.ts:433` |  |
| 240 | `pagesTotal` | fun | port | `src/core/i18n/locale.ts:437` |  |
| 243 | `sourcesReadable` | fun | port | `src/core/i18n/locale.ts:441` |  |
| 244 | `filterCount` | fun | port | `src/core/i18n/locale.ts:445` |  |
| 245 | `titleDisabled` | fun | port | `src/core/i18n/locale.ts:449` |  |
| 246 | `sourcesSubmitted` | fun | port | `src/core/i18n/locale.ts:453` |  |
| 247 | `filesTotal` | fun | port | `src/core/i18n/locale.ts:457` |  |
| 248 | `downloadChapters` | fun | port | `src/core/i18n/locale.ts:461` |  |
| 249 | `categoryName` | fun | port | `src/core/i18n/locale.ts:465` |  |
| 250 | `categorySelected` | fun | port | `src/core/i18n/locale.ts:469` |  |
| 251 | `categoryLocked` | fun | port | `src/core/i18n/locale.ts:473` |  |
| 252 | `categoryCreated` | fun | port | `src/core/i18n/locale.ts:477` |  |
| 253 | `categoryEmpty` | fun | port | `src/core/i18n/locale.ts:481` |  |
| 254 | `favouritesAdded` | fun | port | `src/core/i18n/locale.ts:485` |  |
| 255 | `favouritesAddedPartial` | fun | port | `src/core/i18n/locale.ts:489` |  |
| 256 | `comicIdLabel` | fun | port | `src/core/i18n/locale.ts:493` |  |
| 257 | `highlightOf` | fun | port | `src/core/i18n/locale.ts:497` |  |
| 258 | `closeNamed` | fun | port | `src/core/i18n/locale.ts:501` |  |
| 259 | `yearLabel` | fun | port | `src/core/i18n/locale.ts:505` |  |
| 260 | `minutesValue` | fun | port | `src/core/i18n/locale.ts:509` |  |
| 261 | `dailyAverage` | fun | port | `src/core/i18n/locale.ts:513` |  |
| 263 | `migrateIntro` | fun | port | `src/core/i18n/locale.ts:517` |  |
| 264 | `expandRest` | fun | port | `src/core/i18n/locale.ts:521` |  |
| 265 | `switchedTo` | fun | port | `src/core/i18n/locale.ts:525` |  |
| 266 | `homeHttpCode` | fun | port | `src/core/i18n/locale.ts:529` |  |
| 270 | `rememberStrings` | fun | port | `src/core/i18n/locale.ts:538` |  |
| 276 | `EN` | val | port | `src/core/i18n/strings.ts:2672` |  |
| 3154 | `compactCount` | fun | port | `src/core/i18n/strings.ts:2695` |  |
| 3171 | `modelDownloadFailed` | fun | port | `src/core/i18n/strings.ts:2708` |  |
| 3176 | `modelSizeMb` | fun | port | `src/core/i18n/strings.ts:2714` |  |
| 3180 | `enhanceProgress` | fun | port | `src/core/i18n/strings.ts:2720` |  |
| 3183 | `fullEnhanceProgress` | fun | port | `src/core/i18n/strings.ts:2726` |  |
| 3186 | `weekdayName` | fun | port | `src/core/i18n/strings.ts:2732` |  |
| 3197 | `dayRecordSummary` | fun | port | `src/core/i18n/strings.ts:2754` |  |
| 3201 | `minutesTotal` | fun | port | `src/core/i18n/strings.ts:2760` |  |
| 3205 | `readDateOf` | fun | port | `src/core/i18n/strings.ts:2766` |  |
| 3208 | `durationOf` | fun | port | `src/core/i18n/strings.ts:2772` |  |
| 3211 | `pinFilled` | fun | port | `src/core/i18n/strings.ts:2778` |  |
| 3215 | `monthName` | fun | port | `src/core/i18n/strings.ts:2784` |  |
| 3221 | `yearMonthLabel` | fun | port | `src/core/i18n/strings.ts:2791` |  |
| 3225 | `weekdayShort` | fun | port | `src/core/i18n/strings.ts:2797` |  |
| 3236 | `archiveMissingBook` | fun | port | `src/core/i18n/strings.ts:2819` |  |
| 3240 | `minutesShort` | fun | port | `src/core/i18n/strings.ts:2827` |  |
| 3244 | `peerWantsToSend` | fun | port | `src/core/i18n/strings.ts:2833` |  |
| 3248 | `isBusyStatus` | fun | port | `src/core/i18n/strings.ts:2842` |  |
| 3252 | `isFailureStatus` | fun | port | `src/core/i18n/strings.ts:2854` |  |
| 3257 | `scalePresetName` | fun | port | `src/core/i18n/strings.ts:2867` |  |
| 3260 | `lastPageRead` | fun | port | `src/core/i18n/strings.ts:2873` |  |
| 3264 | `readDurationOf` | fun | port | `src/core/i18n/strings.ts:2879` |  |
| 3267 | `daysCount` | fun | port | `src/core/i18n/strings.ts:2885` |  |
| 3270 | `streakLine` | fun | port | `src/core/i18n/strings.ts:2891` |  |
| 3273 | `periodDaysLine` | fun | port | `src/core/i18n/strings.ts:2902` |  |
| 3277 | `periodReadOnly` | fun | port | `src/core/i18n/strings.ts:2908` |  |
| 3280 | `shareReportTitle` | fun | port | `src/core/i18n/strings.ts:2914` |  |
| 3283 | `findWhatYouWant` | fun | port | `src/core/i18n/strings.ts:2920` |  |
| 3286 | `allOf` | fun | port | `src/core/i18n/strings.ts:2926` |  |
| 3289 | `itemsCount` | fun | port | `src/core/i18n/strings.ts:2932` |  |
| 3292 | `applyFilters` | fun | port | `src/core/i18n/strings.ts:2938` |  |
| 3293 | `sourcesOf` | fun | port | `src/core/i18n/strings.ts:2947` |  |
| 3297 | `pageOf` | fun | port | `src/core/i18n/strings.ts:2953` |  |
| 3300 | `loadingPercent` | fun | port | `src/core/i18n/strings.ts:2959` |  |
| 3303 | `receivedKb` | fun | port | `src/core/i18n/strings.ts:2965` |  |
| 3306 | `preparingOcr` | fun | port | `src/core/i18n/strings.ts:2971` |  |

## com/example/library/BookShareHelper.kt (368 行, 1 声明)

iOS 归属：`src/core/library/libraryBookShare.ts` / `src/core/library/libraryRuntime.ts` / `src/platform/libraryContentServices.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 42 | `BookShareHelper` | type | port | `src/core/library/libraryBookShare.ts:195` |  |

## com/example/library/ComicAggregateSearch.kt (139 行, 2 声明)

iOS 归属：`src/core/library/libraryViewModel.ts` / `src/core/library/libraryAggregateSearch.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 28 | `ComicAggregateSearch` | type | port | `src/core/library/libraryAggregateSearch.ts:182` |  |
| 133 | `withComicSearchGroup` | fun | port | `src/core/library/libraryAggregateSearch.ts:351` |  |

## com/example/library/ComicDownloadManager.kt (212 行, 3 声明)

iOS 归属：`src/core/library/libraryComicDownload.ts` / `src/core/library/libraryViewModel.ts` / `src/core/library/libraryRuntime.ts` / `src/platform/libraryContentServices.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `ComicDownloadStatus` | type | port | `src/core/library/libraryComicDownload.ts:88` |  |
| 25 | `ComicDownloadTask` | type | port | `src/core/library/libraryComicDownload.ts:98` |  |
| 29 | `ComicDownloadManager` | type | port | `src/core/library/libraryComicDownload.ts:238` |  |

## com/example/library/ComicDownloadWorker.kt (66 行, 1 声明)

iOS 归属：`src/core/library/libraryComicDownload.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `ComicDownloadWorker` | type | port | `src/core/library/libraryComicDownload.ts:3` |  |

## com/example/library/ComicLocalImporter.kt (367 行, 1 声明)

iOS 归属：`src/core/library/libraryComicLocalImporter.ts` / `src/core/library/libraryComicDownload.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 44 | `ComicLocalImporter` | type | port | `src/core/library/libraryComicDownload.ts:50` |  |

## com/example/library/DownloadCenterButton.kt (190 行, 3 声明)

iOS 归属：`src/core/library/uiHelpers.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 44 | `DownloadCenterEntry` | fun | port | `src/core/library/uiHelpers.ts:89` |  |
| 55 | `DownloadCenterButton` | fun | port | `src/core/library/uiHelpers.ts:98` |  |
| 174 | `AttentionMarker` | fun | port | `src/core/library/uiHelpers.ts:105` |  |

## com/example/library/DownloadIndicatorState.kt (82 行, 4 声明)

iOS 归属：`src/core/library/downloadIndicatorState.ts` / `src/core/enums/kotlinEnums.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 5 | `DownloadIndicatorStatus` | type | port | `src/core/library/downloadIndicatorState.ts:21` |  |
| 8 | `DownloadIndicatorState` | type | port | `src/core/library/downloadIndicatorState.ts:23` |  |
| 30 | `downloadIndicatorState` | fun | port | `src/core/library/downloadIndicatorState.ts:70` |  |
| 74 | `DownloadCompletionTracker` | type | port | `src/core/library/downloadIndicatorState.ts:138` |  |

## com/example/library/FavoriteShareHelper.kt (80 行, 1 声明)

iOS 归属：`src/core/library/uiHelpers.ts` / `src/core/library/favoriteShare.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `FavoriteShareHelper` | type | port | `src/core/library/uiHelpers.ts:264` |  |

## com/example/library/FormatPickerDialog.kt (213 行, 2 声明)

iOS 归属：`src/core/library/uiHelpers.ts` / `src/ui/pages/LibraryPage.tsx` / `src/core/library/libraryDisplay.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 50 | `FormatPickerDialog` | fun | port | `src/core/library/libraryDisplay.ts:5` |  |
| 164 | `FormatRow` | fun | port | `src/core/library/uiHelpers.ts:66` |  |

## com/example/library/GenericCoverLoader.kt (49 行, 1 声明)

iOS 归属：`src/core/library/genericCoverLoader.ts` / `src/ui/components/ReadingRecordCover.tsx` / `src/ui/pages/LibraryPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `GenericCoverLoader` | type | port | `src/core/library/genericCoverLoader.ts:156` |  |

## com/example/library/ImageBytes.kt (155 行, 1 声明)

iOS 归属：`src/core/library/libraryImageBytes.ts` / `src/ui/pages/ComicReaderOnlinePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `ImageBytes` | type | port | `src/core/library/libraryImageBytes.ts:314` |  |

## com/example/library/KeywordSearchPreview.kt (179 行, 3 声明)

iOS 归属：`src/core/library/uiHelpers.ts` / `src/ui/pages/LibraryPage.tsx` / `src/core/library/libraryDisplay.ts` / `src/core/ui/parityNames2.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 47 | `keywordSearchPreviewItem` | fun | port | `src/core/library/uiHelpers.ts:49` |  |
| 67 | `KeywordSearchPreview` | fun | port | `src/core/library/libraryDisplay.ts:4` |  |
| 160 | `KeywordSearchOptions` | fun | port | `src/core/ui/parityNames2.ts:131` |  |

## com/example/library/LibraryError.kt (13 行, 1 声明)

iOS 归属：`src/core/library/libraryTypes.ts` / `src/core/library/libraryDisplay.ts` / `src/core/library/libraryViewModel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `LibraryError` | type | port | `src/core/library/libraryTypes.ts:102` |  |

## com/example/library/LibraryLoginDialog.kt (71 行, 1 声明)

iOS 归属：`src/ui/pages/LibraryPage.tsx` / `src/ui/pages/SourceManagementPage.tsx` / `src/ui/lib/openExternalUrl.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `LibraryLoginDialog` | fun | port | `src/ui/lib/openExternalUrl.ts:5` |  |

## com/example/library/LibraryNavigation.kt (63 行, 9 声明)

iOS 归属：`src/core/library/libraryNavigation.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `LIBRARY_SESSION_ARGUMENT` | val | port | `src/core/library/libraryNavigation.ts:27` |  |
| 13 | `LIBRARY_SEARCH_ROUTE` | val | port | `src/core/library/libraryNavigation.ts:29` |  |
| 14 | `SEARCH_KEYWORD` | val | port | `src/core/library/libraryNavigation.ts:8` |  |
| 15 | `SEARCH_TEXT_MODE` | val | port | `src/core/library/libraryNavigation.ts:9` |  |
| 17 | `librarySessionArguments` | fun | port | `src/core/library/libraryNavigation.ts:43` |  |
| 25 | `libraryDestinationRoute` | fun | port | `src/core/library/libraryNavigation.ts:63` |  |
| 29 | `openDetailSearch` | fun | port | `src/core/library/libraryNavigation.ts:92` |  |
| 40 | `librarySearchViewModel` | fun | port | `src/core/library/libraryNavigation.ts:18` |  |
| 57 | `libraryViewModelForSession` | fun | port | `src/core/library/libraryNavigation.ts:155` |  |

## com/example/library/LibraryScreen.kt (3067 行, 29 声明)

iOS 归属：`src/core/library/uiHelpers.ts` / `src/ui/components/library/LibrarySearchNotice.tsx` / `src/ui/pages/LibraryPage.tsx` / `src/core/library/libraryDisplay.ts` / `src/ui/components/library/LibrarySearchSkeleton.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 199 | `LibraryScreen` | fun | port | `src/core/library/libraryDisplay.ts:3` |  |
| 1170 | `LibrarySearchSkeleton` | fun | port | `src/ui/components/library/LibrarySearchSkeleton.tsx:73` |  |
| 1196 | `LibrarySearchNotice` | fun | port | `src/ui/components/library/LibrarySearchNotice.tsx:89` |  |
| 1234 | `UnifiedSearchField` | fun | port | `src/ui/pages/LibraryPage.tsx:8` |  |
| 1366 | `glassEdge` | fun | port | `src/core/library/uiHelpers.ts:30` |  |
| 1393 | `SearchHistoryPanel` | fun | port | `src/ui/pages/LibraryPage.tsx:9` |  |
| 1544 | `HistoryChips` | fun | port | `src/ui/pages/LibraryPage.tsx:9` |  |
| 1611 | `HistoryChip` | fun | port | `src/ui/pages/LibraryPage.tsx:9` |  |
| 1705 | `SourcePickerSheet` | fun | port | `src/ui/pages/LibraryPage.tsx:10` |  |
| 1817 | `SourceSheetDivider` | fun | port | `src/ui/pages/LibraryPage.tsx:10` |  |
| 1827 | `SourceSectionLabel` | fun | port | `src/ui/pages/LibraryPage.tsx:10` |  |
| 1840 | `AggregateOptionItem` | fun | port | `src/ui/pages/LibraryPage.tsx:11` |  |
| 1918 | `SourceOptionItem` | fun | port | `src/ui/pages/LibraryPage.tsx:11` |  |
| 2005 | `LibraryWelcomeScreen` | fun | port | `src/ui/pages/LibraryPage.tsx:13` |  |
| 2153 | `rememberCoverHeaders` | fun | port | `src/ui/pages/LibraryPage.tsx:14` |  |
| 2173 | `SearchResultFavoriteButton` | fun | port | `src/ui/pages/LibraryPage.tsx:14` |  |
| 2219 | `LibraryBookCard` | fun | port | `src/core/library/libraryDisplay.ts:20` |  |
| 2495 | `BookCoverPlaceholder` | fun | port | `src/core/library/libraryDisplay.ts:18` |  |
| 2530 | `displayFormat` | fun | port | `src/core/library/libraryDisplay.ts:80` |  |
| 2548 | `STAGGER_RATIO_PALETTE` | val | port | `src/core/library/libraryDisplay.ts:110` |  |
| 2551 | `AGGREGATE_PREVIEW_COUNT` | val | port | `src/core/library/libraryDisplay.ts:113` |  |
| 2554 | `staggerRatio` | fun | port | `src/core/library/libraryDisplay.ts:120` |  |
| 2561 | `StaggeredComicCard` | fun | port | `src/core/library/libraryDisplay.ts:19` |  |
| 2729 | `AggregateSourceHeader` | fun | port | `src/ui/pages/LibraryPage.tsx:18` |  |
| 2808 | `AggregateExpandButton` | fun | port | `src/ui/pages/LibraryPage.tsx:19` |  |
| 2862 | `aggregateGroupItemCount` | fun | port | `src/core/library/libraryDisplay.ts:145` |  |
| 2876 | `groupHeaderIndex` | fun | port | `src/core/library/libraryDisplay.ts:158` |  |
| 2895 | `AggregateJumpSheet` | fun | port | `src/ui/pages/LibraryPage.tsx:20` |  |
| 3029 | `AggregateSourceError` | fun | port | `src/core/library/libraryDisplay.ts:21` |  |

## com/example/library/LibraryUiState.kt (27 行, 1 声明)

iOS 归属：`src/core/library/libraryTypes.ts` / `src/core/library/libraryAggregateSearch.ts` / `src/core/library/libraryViewModel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `LibraryUiState` | type | port | `src/core/library/libraryTypes.ts:31` |  |

## com/example/library/LibraryViewModel.kt (1381 行, 5 声明)

iOS 归属：`src/core/library/uiHelpers.ts` / `src/core/library/libraryViewModel.ts` / `src/core/library/libraryAssembly.ts` / `src/core/library/libraryDisplay.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 53 | `READER_UNSUPPORTED_FORMATS` | val | port | `src/core/library/libraryDisplay.ts:672` |  |
| 56 | `filterReadableFormats` | fun | port | `src/core/library/libraryDisplay.ts:681` |  |
| 59 | `OnlineNovelPage` | type | port | `src/core/library/uiHelpers.ts:73` |  |
| 61 | `OnlineNovelChapterState` | type | port | `src/core/library/uiHelpers.ts:81` |  |
| 68 | `LibraryViewModel` | type | port | `src/core/library/libraryViewModel.ts:413` |  |

## com/example/library/MhttuImageDecryptor.kt (47 行, 1 声明)

iOS 归属：`src/core/library/libraryImageBytes.ts` / `src/platform/web/webCrypto.ts` / `src/core/library/libraryComicLocalImporter.ts` / `src/ui/pages/ComicReaderOnlinePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `MhttuImageDecryptor` | type | port | `src/core/library/libraryImageBytes.ts:323` |  |

## com/example/library/NovelBookUi.kt (470 行, 10 声明)

iOS 归属：`src/core/library/uiHelpers.ts` / `src/ui/pages/LibraryPage.tsx` / `src/core/library/libraryDisplay.ts` / `src/core/source/impl/htmlNovelDiscovery.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 64 | `novelAccentColor` | fun | port | `src/core/library/libraryDisplay.ts:414` |  |
| 71 | `novelActionColors` | fun | port | `src/core/library/libraryDisplay.ts:425` |  |
| 78 | `NovelCover` | fun | port | `src/core/source/impl/htmlNovelDiscovery.ts:132` |  |
| 107 | `novelCoverRequest` | fun | port | `src/core/library/uiHelpers.ts:40` |  |
| 117 | `NovelLabels` | fun | port | `src/core/library/libraryDisplay.ts:28` |  |
| 128 | `NovelSearchCard` | fun | port | `src/ui/pages/LibraryPage.tsx:24` |  |
| 170 | `NovelDetailContent` | fun | port | `src/ui/pages/LibraryPage.tsx:24` |  |
| 301 | `NovelDetailSheet` | fun | port | `src/ui/pages/LibraryPage.tsx:1346` |  |
| 415 | `NovelUpdateSheet` | fun | port | `src/ui/pages/LibraryPage.tsx:24` |  |
| 458 | `NovelUpdatePanel` | fun | port | `src/core/library/libraryDisplay.ts:500` |  |

## com/example/library/NovelDownloadPanel.kt (283 行, 6 声明)

iOS 归属：`src/core/library/uiHelpers.ts` / `src/core/library/bookRepository.ts` / `src/ui/components/library/DownloadCenter.tsx` / `src/core/download/downloadTaskRepository.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 39 | `downloadBytes` | fun | port | `src/core/library/uiHelpers.ts:123` |  |
| 46 | `downloadStatusLabel` | fun | port | `src/ui/components/library/DownloadCenter.tsx:57` |  |
| 57 | `DownloadCenter` | fun | port | `src/ui/components/library/DownloadCenter.tsx:169` |  |
| 79 | `NovelDownloadPanel` | fun | port | `src/core/library/uiHelpers.ts:208` |  |
| 202 | `DownloadTaskRow` | fun | port | `src/core/library/bookRepository.ts:1942` |  |
| 258 | `downloadRing` | fun | port | `src/core/library/uiHelpers.ts:12` |  |

## com/example/library/ReadingRecordMetadata.kt (50 行, 1 声明)

iOS 归属：`src/core/library/libraryReadingRecords.ts` / `src/core/library/libraryViewModel.ts` / `src/core/library/libraryAssembly.ts` / `src/ui/pages/LibraryPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `ReadingRecordMetadata` | type | port | `src/core/library/libraryReadingRecords.ts:304` |  |

## com/example/library/ReadingRecordResolver.kt (81 行, 1 声明)

iOS 归属：`src/core/library/libraryReadingRecords.ts` / `src/core/library/libraryViewModel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `ReadingRecordResolver` | type | port | `src/core/library/libraryReadingRecords.ts:128` |  |

## com/example/library/SharedWorkLink.kt (32 行, 1 声明)

iOS 归属：`src/core/library/favoriteShare.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `SharedWorkLink` | type | port | `src/core/ui/parityMisc.ts:108` |  |

## com/example/library/SourceSearchCoordinator.kt (50 行, 1 声明)

iOS 归属：`src/core/library/libraryAggregateSearch.ts` / `src/core/library/libraryReadingRecords.ts` / `src/core/library/libraryViewModel.ts` / `src/core/library/librarySearchCoordinator.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `SourceSearchCoordinator` | type | port | `src/core/library/librarySearchCoordinator.ts:87` |  |

## com/example/library/ZLibraryCoverLoader.kt (66 行, 2 声明)

iOS 归属：`src/core/library/zLibraryCoverLoader.ts` / `src/ui/pages/LibraryPage.tsx` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/ui/components/ReadingRecordCover.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 17 | `ZLibraryCoverLoader` | type | port | `src/core/library/zLibraryCoverLoader.ts:24` |  |
| 64 | `rememberZLibraryImageLoader` | fun | port | `src/core/library/zLibraryCoverLoader.ts:239` |  |

## com/example/library/ZLibraryNativeSession.kt (371 行, 1 声明)

iOS 归属：`src/core/library/zLibraryNativeSession.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 30 | `ZLibraryNativeSession` | type | port | `src/core/library/zLibraryNativeSession.ts:382` |  |

## com/example/library/ZLibraryNodeConfig.kt (21 行, 1 声明)

iOS 归属：`src/core/library/zLibraryNodeConfig.ts` / `src/ui/pages/LibraryPage.tsx` / `src/core/source/zlibrary/encryptedCookieJar.ts` / `src/core/source/zlibrary/zLibraryEndpointProvider.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `ZLibraryNodeConfig` | type | port | `src/core/library/zLibraryNodeConfig.ts:10` |  |

## com/example/library/ZLibraryNodeManager.kt (221 行, 1 声明)

iOS 归属：`src/core/library/zLibraryNodeManager.ts` / `src/ui/components/source/ZLibraryNodeManagementScreen.tsx` / `src/core/source/zlibrary/zLibraryHost.ts` / `src/ui/pages/SourceManagementPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `ZLibraryNodeManager` | type | port | `src/core/library/zLibraryNodeManager.ts:22` |  |

## com/example/library/ZLibraryNovelMetadata.kt (21 行, 1 声明)

iOS 归属：`src/core/library/zLibraryNovelMetadata.ts` / `src/platform/zLibraryAssembly.ts` / `src/core/source/zlibrary/zLibraryHost.ts` / `src/core/source/zlibrary/zLibrarySource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `zLibraryNovelMetadata` | fun | port | `src/core/library/zLibraryNovelMetadata.ts:15` |  |

## com/example/mangatranslate/BubbleDetector.kt (402 行, 4 声明)

iOS 归属：`src/core/mangatranslate/bubbleDetector.ts` / `src/core/mangatranslate/index.ts` / `src/core/mangatranslate/pageRegionDetector.ts` / `src/core/mangatranslate/pageRegionTiling.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 34 | `BubbleDetector` | type | port | `src/core/mangatranslate/bubbleDetector.ts:3` |  |
| 364 | `letterboxInverseX` | fun | port | `src/core/mangatranslate/bubbleDetector.ts:169` |  |
| 367 | `letterboxInverseY` | fun | port | `src/core/mangatranslate/bubbleDetector.ts:174` |  |
| 371 | `retainLargestConnectedComponent` | fun | port | `src/core/mangatranslate/bubbleDetector.ts:392` |  |

## com/example/mangatranslate/BubblePipeline.kt (480 行, 1 声明)

iOS 归属：`src/core/mangatranslate/bubblePipeline.ts` / `src/core/mangatranslate/index.ts` / `src/platform/ios-native/mangaTranslationRuntime.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 33 | `BubblePipeline` | type | port | `src/core/mangatranslate/bubblePipeline.ts:879` |  |

## com/example/mangatranslate/LlmBubbleTranslator.kt (335 行, 1 声明)

iOS 归属：`src/core/mangatranslate/llmTranslator.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 29 | `LlmBubbleTranslator` | type | port | `src/core/mangatranslate/llmTranslator.ts:477` |  |

## com/example/mangatranslate/MangaOcr.kt (493 行, 3 声明)

iOS 归属：`src/core/mangatranslate/mangaOcr.ts` / `src/core/mangatranslate/bubbleDetector.ts` / `src/core/mangatranslate/index.ts` / `src/ui/pages/ComicReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 34 | `OrtSessions` | type | port | `src/core/mangatranslate/mangaOcr.ts:149` |  |
| 114 | `PaddleDetector` | type | port | `src/core/mangatranslate/mangaOcr.ts:483` |  |
| 358 | `PaddleRecognizer` | type | port | `src/core/mangatranslate/mangaOcr.ts:621` |  |

## com/example/mangatranslate/MangaTranslationCore.kt (985 行, 7 声明)

iOS 归属：`src/core/mangatranslate/translationCore.ts` / `src/platform/ios-native/mangaTranslationRuntime.ts` / `src/core/mangatranslate/bubblePipeline.ts` / `src/core/mangatranslate/translationNetwork.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 35 | `TranslatedRegion` | type | port | `src/core/mangatranslate/translationCore.ts:177` |  |
| 54 | `PageTranslation` | type | port | `src/core/mangatranslate/translationCore.ts:190` |  |
| 66 | `TranslationCache` | type | port | `src/core/mangatranslate/translationCore.ts:10` |  |
| 192 | `TextBlockGrouper` | type | port | `src/core/mangatranslate/translationCore.ts:455` |  |
| 282 | `OverlayRenderer` | type | port | `src/core/mangatranslate/translationCore.ts:648` |  |
| 424 | `MangaPageTranslator` | type | port | `src/core/mangatranslate/translationCore.ts:817` |  |
| 758 | `TranslationCoordinator` | type | port | `src/core/mangatranslate/translationCore.ts:991` |  |

## com/example/mangatranslate/PageMemoryBudget.kt (32 行, 1 声明)

iOS 归属：`src/core/mangatranslate/pageMemoryBudget.ts` / `src/platform/ios-native/mangaTranslationRuntime.ts` / `src/core/mangatranslate/index.ts` / `src/core/mangatranslate/translationFailure.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `PageMemoryBudget` | type | port | `src/core/mangatranslate/pageMemoryBudget.ts:83` |  |

## com/example/mangatranslate/PageRegionDetector.kt (273 行, 1 声明)

iOS 归属：`src/core/mangatranslate/pageRegionDetector.ts` / `src/core/mangatranslate/index.ts` / `src/core/mangatranslate/bubblePipeline.ts` / `src/core/mangatranslate/pageRegionTiling.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `PageRegionDetector` | type | port | `src/core/mangatranslate/pageRegionDetector.ts:284` |  |

## com/example/mangatranslate/PageRegionTiling.kt (831 行, 5 声明)

iOS 归属：`src/core/mangatranslate/pageRegionTiling.ts` / `src/core/mangatranslate/pageRegionDetector.ts` / `src/core/mangatranslate/index.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 16 | `DetectionTile` | type | port | `src/core/mangatranslate/pageRegionTiling.ts:155` |  |
| 24 | `TiledBubbleDetection` | type | port | `src/core/mangatranslate/pageRegionTiling.ts:181` |  |
| 32 | `DeduplicatedBubbleGroup` | type | port | `src/core/mangatranslate/pageRegionDetector.ts:553` |  |
| 40 | `BubblePriorityCandidate` | type | port | `src/core/mangatranslate/pageRegionTiling.ts:22` |  |
| 47 | `PageRegionTiling` | type | port | `src/core/mangatranslate/index.ts:21` |  |

## com/example/mangatranslate/TextBlockMerger.kt (499 行, 3 声明)

iOS 归属：`src/core/mangatranslate/textBlockMerger.ts` / `src/core/mangatranslate/pageRegionDetector.ts` / `src/core/enums/kotlinEnums.ts` / `src/platform/ios-native/nativeMangaOcr.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `TextLineOrientation` | type | port | `src/core/mangatranslate/textBlockMerger.ts:111` |  |
| 20 | `TextBlock` | type | port | `src/core/mangatranslate/textBlockMerger.ts:118` |  |
| 32 | `TextBlockMerger` | type | port | `src/core/mangatranslate/textBlockMerger.ts:661` |  |

## com/example/mangatranslate/TextTranslator.kt (176 行, 3 声明)

iOS 归属：`src/core/mangatranslate/scriptDetector.ts` / `src/platform/ios-native/mangaTranslationRuntime.ts` / `src/core/mangatranslate/translationCore.ts` / `src/platform/ios-native/nativeMangaOcr.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `TextTranslator` | type | port | `src/core/mangatranslate/scriptDetector.ts:113` |  |
| 36 | `ScriptDetector` | type | port | `src/core/mangatranslate/scriptDetector.ts:127` |  |
| 65 | `OnlineFallbackTranslator` | type | port | `src/core/mangatranslate/scriptDetector.ts:283` |  |

## com/example/mangatranslate/TranslateModelManager.kt (316 行, 1 声明)

iOS 归属：`src/core/mangatranslate/modelManager.ts` / `src/core/mangatranslate/translationCore.ts` / `src/ui/components/comic/sheets/ComicSettingsTranslationTab.tsx` / `src/core/mangatranslate/index.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 27 | `TranslateModelManager` | type | port | `src/core/mangatranslate/modelManager.ts:310` |  |

## com/example/mangatranslate/TranslationFailure.kt (49 行, 2 声明)

iOS 归属：`src/core/mangatranslate/translationFailure.ts` / `src/platform/ios-native/mangaTranslationRuntime.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `TranslationFailure` | type | port | `src/core/mangatranslate/translationFailure.ts:38` |  |
| 49 | `TranslationException` | type | port | `src/core/mangatranslate/translationFailure.ts:71` |  |

## com/example/mangatranslate/TranslationPrivacy.kt (8 行, 1 声明)

iOS 归属：`src/core/mangatranslate/translationPrivacy.ts` / `src/platform/ios-native/mangaTranslationRuntime.ts` / `src/core/mangatranslate/scriptDetector.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 5 | `TranslationPrivacy` | type | port | `src/core/mangatranslate/translationPrivacy.ts:35` |  |

## com/example/source/AuthenticationState.kt (8 行, 1 声明)

iOS 归属：`src/core/source/authenticationState.ts` / `src/core/source/bookSource.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/core/source/impl/aliceSwSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `AuthenticationState` | type | port | `src/core/source/authenticationState.ts:6` |  |

## com/example/source/BookFormat.kt (21 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/zLibraryEapiClient.ts` / `src/core/source/sourceTypes.ts` / `src/core/source/bookFormat.ts` / `src/core/source/zlibrary/zLibrarySource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `BookFormat` | type | port | `src/core/source/bookFormat.ts:7` |  |

## com/example/source/BookSource.kt (55 行, 1 声明)

iOS 归属：`src/core/library/libraryViewModel.ts` / `src/core/source/sourceManager.ts` / `src/ui/pages/SourceManagementPage.tsx` / `src/ui/components/source/SourceManagementParts.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 5 | `BookSource` | type | port | `src/core/source/bookSource.ts:23` |  |

## com/example/source/ComicChapter.kt (13 行, 1 声明)

iOS 归属：`src/core/comic/comicChapters.ts` / `src/core/source/js/jsChapterOrder.ts` / `src/core/library/comicReadingLogic.ts` / `src/core/library/chapterCatalog.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `ComicChapter` | type | port | `src/core/app/mainViewModel.ts:1846` |  |

## com/example/source/ComicChapterTitle.kt (46 行, 1 声明)

iOS 归属：`src/core/source/sourceText.ts` / `src/core/ui/kotlinAuthorityConstants.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `ComicChapterTitle` | type | port | `src/core/source/sourceText.ts:111` |  |

## com/example/source/ComicInfo.kt (40 行, 3 声明)

iOS 归属：`src/core/source/comicInfo.ts` / `src/core/library/comicSourceTypes.ts` / `src/core/source/sourceTypes.ts` / `src/core/source/impl/mangaDexSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 4 | `ComicInfo` | type | port | `src/core/library/comicSourceTypes.ts:64` |  |
| 22 | `isKnownComicAuthor` | fun | port | `src/core/library/comicSourceTypes.ts:97` |  |
| 27 | `withComicDetail` | fun | port | `src/core/source/comicInfo.ts:62` |  |

## com/example/source/ComicSource.kt (34 行, 1 声明)

iOS 归属：`src/core/library/libraryViewModel.ts` / `src/core/source/js/jsSourceEngine.ts` / `src/core/library/libraryComicDownload.ts` / `src/core/source/sourceTypes.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `ComicSource` | type | port | `src/core/source/sourceTypes.ts:52` |  |

## com/example/source/DetailLink.kt (19 行, 1 声明)

iOS 归属：`src/core/library/favoriteShare.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `DetailLink` | type | port | `src/core/ui/parityMisc.ts:115` |  |

## com/example/source/DownloadInfo.kt (13 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/zLibrarySource.ts` / `src/core/download/downloadWorker.ts` / `src/core/source/sourceTypes.ts` / `src/core/source/bookSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `DownloadInfo` | type | port | `src/core/source/sourceTypes.ts:55` |  |

## com/example/source/LoginCredential.kt (8 行, 1 声明)

iOS 归属：`src/core/source/sourceTypes.ts` / `src/ui/components/source/ZLibraryLoginDialog.tsx` / `src/core/source/loginCredential.ts` / `src/core/source/zlibrary/zLibrarySource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `LoginCredential` | type | port | `src/core/source/loginCredential.ts:5` |  |

## com/example/source/NetworkCalls.kt (81 行, 4 声明)

iOS 归属：`src/core/source/networkCalls.ts` / `src/core/update/githubUpdateChecker.ts` / `src/core/source/impl/sourceHttp.ts` / `src/core/mangatranslate/scriptDetector.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 13 | `executeCancellable` | fun | port | `src/core/source/networkCalls.ts:127` |  |
| 16 | `executeWithCancellation` | fun | port | `src/core/source/networkCalls.ts:5` |  |
| 39 | `SharedHttpTransport` | type | port | `src/core/source/networkCalls.ts:36` |  |
| 63 | `SourceNetworkPolicy` | type | port | `src/core/source/networkCalls.ts:10` |  |

## com/example/source/NovelContentChecks.kt (8 行, 1 声明)

iOS 归属：`src/core/download/sourceNovelEpub.ts` / `src/core/source/impl/fanqieSource.ts` / `src/core/source/impl/publicNovelSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 4 | `hasMissingNovelContent` | fun | port | `src/core/source/impl/novelParts.ts:5` |  |

## com/example/source/NovelInfo.kt (33 行, 3 声明)

iOS 归属：`src/core/source/novelInfo.ts` / `src/core/download/downloadRequest.ts` / `src/core/library/zLibraryNovelMetadata.ts` / `src/core/source/sourceTypes.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `NovelInfo` | type | port | `src/core/download/downloadRequest.ts:12` |  |
| 26 | `WholeBookNovelSources` | type | port | `src/core/source/novelInfo.ts:67` |  |
| 31 | `UpdatableNovelSource` | type | port | `src/core/source/novelInfo.ts:75` |  |

## com/example/source/PufeiImageCacheRetry.kt (27 行, 1 声明)

iOS 归属：`src/core/source/pufeiImageCacheRetry.ts` / `src/ui/pages/ComicReaderOnlinePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `PufeiImageCacheRetry` | type | port | `src/core/source/pufeiImageCacheRetry.ts:2` |  |

## com/example/source/SearchBook.kt (24 行, 1 声明)

iOS 归属：`src/core/library/libraryViewModel.ts` / `src/ui/pages/LibraryPage.tsx` / `src/core/library/libraryReadingRecords.ts` / `src/core/source/zlibrary/zLibrarySource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `SearchBook` | type | port | `src/core/app/mainViewModel.ts:1846` |  |

## com/example/source/SourceCapabilities.kt (29 行, 2 声明)

iOS 归属：`src/ui/pages/SourceManagementPage.tsx` / `src/core/library/libraryViewModel.ts` / `src/core/source/sourceManager.ts` / `src/core/source/sourceCapabilities.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `SourceCapabilities` | type | port | `src/core/source/sourceCapabilities.ts:8` |  |
| 24 | `BookSource` | val | port | `src/core/source/bookSource.ts:23` |  |

## com/example/source/SourceConfig.kt (89 行, 9 声明)

iOS 归属：`src/core/source/sourceText.ts` / `src/core/source/sourceConfig.ts` / `src/core/source/bookSourceTypes.ts` / `src/core/source/impl/jsonBookSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `BookFieldRule` | type | port | `src/core/source/sourceConfig.ts:7` |  |
| 13 | `SearchRule` | type | port | `src/core/source/sourceConfig.ts:30` |  |
| 22 | `DetailRule` | type | port | `src/core/source/sourceConfig.ts:57` |  |
| 30 | `DownloadRule` | type | port | `src/core/source/sourceConfig.ts:81` |  |
| 41 | `HtmlSearchRule` | type | port | `src/core/source/sourceConfig.ts:116` |  |
| 54 | `HtmlChapterRule` | type | port | `src/core/source/sourceConfig.ts:155` |  |
| 64 | `HtmlContentRule` | type | port | `src/core/source/sourceConfig.ts:183` |  |
| 70 | `HtmlExploreRule` | type | port | `src/core/source/sourceConfig.ts:210` |  |
| 72 | `SourceConfig` | type | port | `src/core/source/sourceConfig.ts:232` |  |

## com/example/source/SourceException.kt (9 行, 1 声明)

iOS 归属：`src/core/source/impl/mangaDexSource.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/core/source/sourceException.ts` / `src/core/source/impl/jsonBookSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `SourceException` | type | port | `src/core/source/sourceException.ts:6` |  |

## com/example/source/SourceLog.kt (38 行, 1 声明)

iOS 归属：`src/core/source/impl/jsonBookSource.ts` / `src/core/source/zlibrary/diamWallInterceptor.ts` / `src/core/source/sourceLog.ts` / `src/core/source/zlibrary/network/zLibrarySessionManager.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `SourceLog` | type | port | `src/core/source/sourceLog.ts:10` |  |

## com/example/source/SourceManager.kt (182 行, 1 声明)

iOS 归属：`src/core/library/libraryAssembly.ts` / `src/core/source/sourceViewModel.ts` / `src/platform/jsSourceAssembly.ts` / `src/platform/sourceAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `SourceManager` | type | port | `src/core/source/sourceManager.ts:90` |  |

## com/example/source/SourceRegistration.kt (7 行, 1 声明)

iOS 归属：`src/core/source/js/jsComicSource.ts` / `src/core/source/sourceTypes.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `validRegistrationUrl` | fun | port | `src/core/source/sourceTypes.ts:108` |  |

## com/example/source/SourceResponse.kt (77 行, 2 声明)

iOS 归属：`src/core/source/sourceText.ts` / `src/core/source/impl/aliceSwSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `readSourceText` | fun | port | `src/core/source/sourceText.ts:114` |  |
| 18 | `SourceResponse` | type | port | `src/core/source/impl/aliceSwSource.ts:38` |  |

## com/example/source/SourceResult.kt (18 行, 1 声明)

iOS 归属：`src/core/source/js/jsComicSource.ts` / `src/core/source/impl/jsonBookSource.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/core/source/impl/mangaDexSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `SourceResult` | type | port | `src/core/library/comicSourceTypes.ts:102` |  |

## com/example/source/SourceViewModel.kt (154 行, 1 声明)

iOS 归属：`src/core/source/sourceViewModel.ts` / `src/ui/pages/SourceManagementPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `SourceViewModel` | type | port | `src/core/source/sourceViewModel.ts:118` |  |

## com/example/source/anilist/AniListClient.kt (129 行, 1 声明)

iOS 归属：`src/core/source/anilist/anilistClient.ts` / `src/core/source/impl/jsonSupport.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 27 | `AniListClient` | type | port | `src/core/source/anilist/anilistClient.ts:107` |  |

## com/example/source/anilist/AniListModels.kt (100 行, 5 声明)

iOS 归属：`src/core/source/anilist/anilistModels.ts` / `src/core/source/keyword/keywordRepository.ts` / `src/core/source/anilist/anilistClient.ts` / `src/core/data/anilistSeeding.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 13 | `AniListTitleRow` | type | port | `src/core/data/anilistSeeding.ts:6` |  |
| 22 | `AniListTitleType` | type | port | `src/core/source/anilist/anilistModels.ts:51` |  |
| 30 | `AniListSyncPage` | type | port | `src/core/source/anilist/anilistModels.ts:61` |  |
| 36 | `AniListMediaTitles` | type | port | `src/core/source/anilist/anilistModels.ts:67` |  |
| 72 | `SearchVariantBuilder` | type | port | `src/core/source/anilist/anilistModels.ts:138` |  |

## com/example/source/anilist/CjkFoldMap.kt (28 行, 1 声明)

iOS 归属：`src/core/data/cjkFoldMap.ts` / `src/core/ui/parityNames2.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `CjkFoldMap` | type | port | `src/core/ui/parityNames2.ts:48` |  |

## com/example/source/anilist/TitleNormalizer.kt (45 行, 1 声明)

iOS 归属：`src/core/source/keyword/keywordModels.ts` / `src/core/app/mainViewModel.ts` / `src/core/library/libraryReadingRecords.ts` / `src/core/source/anilist/anilistModels.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `TitleNormalizer` | type | port | `src/core/app/mainViewModel.ts:449` |  |

## com/example/source/impl/AliceSwDiscover.kt (160 行, 1 声明)

iOS 归属：`src/core/source/impl/aliceSwDiscover.ts` / `src/core/source/impl/aliceSwSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 28 | `AliceSwDiscover` | type | port | `src/core/source/impl/aliceSwDiscover.ts:105` |  |

## com/example/source/impl/AliceSwDiscovery.kt (33 行, 1 声明)

iOS 归属：`src/core/source/impl/aliceSwEndpoints.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `AliceSwDiscovery` | type | port | `src/core/source/impl/aliceSwEndpoints.ts:53` |  |

## com/example/source/impl/AliceSwEndpoints.kt (192 行, 1 声明)

iOS 归属：`src/core/ui/kotlinAuthorityConstants.ts` / `src/core/source/impl/aliceSwEndpoints.ts` / `src/core/source/impl/aliceSwSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 30 | `AliceSwEndpoints` | type | port | `src/core/source/impl/aliceSwEndpoints.ts:157` |  |

## com/example/source/impl/AliceSwParser.kt (186 行, 1 声明)

iOS 归属：`src/core/source/impl/aliceSwParser.ts` / `src/core/source/impl/aliceSwSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `AliceSwParser` | type | port | `src/core/source/impl/aliceSwParser.ts:97` |  |

## com/example/source/impl/AliceSwSource.kt (257 行, 1 声明)

iOS 归属：`src/core/source/impl/aliceSwSource.ts` / `src/core/download/aliceSwEpub.ts` / `src/core/library/libraryAssembly.ts` / `src/core/source/impl/aliceSwEndpoints.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 41 | `AliceSwSource` | type | port | `src/core/source/impl/aliceSwSource.ts:101` |  |

## com/example/source/impl/AutoNovelDiscovery.kt (83 行, 1 声明)

iOS 归属：`src/core/source/impl/autoNovelDiscovery.ts` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/source/impl/autoNovelSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `AutoNovelDiscovery` | type | port | `src/core/source/impl/autoNovelDiscovery.ts:11` |  |

## com/example/source/impl/AutoNovelSource.kt (188 行, 1 声明)

iOS 归属：`src/core/source/impl/autoNovelSource.ts` / `src/core/source/impl/sourceHttp.ts` / `src/platform/sourceAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `AutoNovelSource` | type | port | `src/core/source/impl/autoNovelSource.ts:103` |  |

## com/example/source/impl/FanqieDiscovery.kt (113 行, 1 声明)

iOS 归属：`src/core/source/impl/guestNovelTransport.ts` / `src/core/ui/parityNames2.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `FanqieDiscovery` | type | port | `src/core/ui/parityNames2.ts:80` |  |

## com/example/source/impl/FanqieGateway.kt (155 行, 1 声明)

iOS 归属：`src/core/source/impl/guestNovelTransport.ts` / `src/core/ui/parityNames2.ts` / `src/core/ui/kotlinAuthorityConstants.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 16 | `FanqieGateway` | type | port | `src/core/ui/parityNames2.ts:89` |  |

## com/example/source/impl/GuestNovelTransport.kt (21 行, 1 声明)

iOS 归属：`src/core/source/impl/guestNovelTransport.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `guestNovelIoRetry` | fun | port | `src/core/source/impl/guestNovelTransport.ts:118` |  |

## com/example/source/impl/HtmlNovelDiscovery.kt (183 行, 1 声明)

iOS 归属：`src/core/source/impl/htmlNovelDiscovery.ts` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/source/impl/ixdzsSource.ts` / `src/core/source/impl/publicNovelSource.ts` / `src/core/source/impl/xbookcnSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `HtmlNovelDiscovery` | type | port | `src/core/source/impl/htmlNovelDiscovery.ts:9` |  |

## com/example/source/impl/IxdzsSource.kt (148 行, 1 声明)

iOS 归属：`src/core/source/impl/ixdzsSource.ts` / `src/platform/sourceAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `IxdzsSource` | type | port | `src/core/source/impl/ixdzsSource.ts:102` |  |

## com/example/source/impl/JsonBookSource.kt (667 行, 1 声明)

iOS 归属：`src/core/source/importer/sourceImporter.ts` / `src/core/source/sourceConfig.ts` / `src/core/source/impl/jsonBookSource.ts` / `src/core/source/impl/jsoup.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 33 | `JsonBookSource` | type | port | `src/core/source/impl/jsonBookSource.ts:111` |  |

## com/example/source/impl/MangaDexSource.kt (952 行, 1 声明)

iOS 归属：`src/core/source/impl/mangaDexSource.ts` / `src/core/source/impl/sourceHttp.ts` / `src/platform/sourceAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 45 | `MangaDexSource` | type | port | `src/core/source/impl/mangaDexSource.ts:143` |  |

## com/example/source/impl/MockBookSource.kt (95 行, 1 声明)

iOS 归属：`src/core/source/impl/mockBookSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `MockBookSource` | type | port | `src/core/source/impl/mockBookSource.ts:49` |  |

## com/example/source/impl/NovelDiscoverySites.kt (114 行, 1 声明)

iOS 归属：`src/core/source/sourceText.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `NovelDiscoverySites` | type | port | `src/core/source/sourceText.ts:431` |  |

## com/example/source/impl/PublicNovelSource.kt (420 行, 6 声明)

iOS 归属：`src/core/source/sourceText.ts` / `src/core/source/impl/publicNovelSource.ts` / `src/platform/sourceAssembly.ts` / `src/core/download/guestNovelCheckpoint.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 27 | `PublicNovelSources` | type | port | `src/core/source/sourceText.ts:457` |  |
| 42 | `PublicNovelSite` | type | port | `src/core/source/impl/publicNovelSource.ts:21` |  |
| 52 | `PublicNovelSource` | type | port | `src/core/source/impl/publicNovelSource.ts:25` |  |
| 380 | `NovelPart` | type | port | `src/core/source/impl/novelParts.ts:4` |  |
| 386 | `extractParts` | fun | port | `src/core/source/sourceText.ts:464` |  |
| 413 | `validateParts` | fun | port | `src/core/source/sourceText.ts:472` |  |

## com/example/source/impl/Wenku8Discovery.kt (103 行, 1 声明)

iOS 归属：`src/core/source/impl/wenku8LibrarySource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 19 | `Wenku8Discovery` | type | port | `src/core/source/impl/wenku8Discovery.ts:17` |  |

## com/example/source/impl/Wenku8LibrarySource.kt (113 行, 1 声明)

iOS 归属：`src/core/source/impl/wenku8LibrarySource.ts` / `src/platform/sourceAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `Wenku8LibrarySource` | type | port | `src/core/source/impl/wenku8LibrarySource.ts:85` |  |

## com/example/source/impl/XbookcnSource.kt (499 行, 2 声明)

iOS 归属：`src/core/source/impl/xbookcnSource.ts` / `src/platform/sourceAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 40 | `XbookcnSource` | type | port | `src/core/source/impl/xbookcnSource.ts:70` |  |
| 383 | `XbookcnParser` | type | port | `src/core/source/impl/xbookcnSource.ts:24` |  |

## com/example/source/importer/SourceImporter.kt (704 行, 1 声明)

iOS 归属：`src/core/source/importer/sourceImporter.ts` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/source/sourceManager.ts` / `src/core/source/sourceViewModel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 38 | `SourceImporter` | type | port | `src/core/source/importer/sourceImporter.ts:2` |  |

## com/example/source/js/AimanhuaTls.kt (54 行, 1 声明)

iOS 归属：`src/core/source/sourceText.ts` / `src/core/ui/kotlinAuthorityConstants.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `AimanhuaTls` | type | port | `src/core/source/sourceText.ts:422` |  |

## com/example/source/js/CfWebViewSolver.kt (304 行, 1 声明)

iOS 归属：`src/core/source/js/cfWebViewSolver.ts` / `src/core/source/js/jsMessageHandler.ts` / `src/core/source/js/jsSourceProxy.ts` / `src/platform/web/webViewFactory.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 37 | `CfWebViewSolver` | type | port | `src/core/source/js/cfWebViewSolver.ts:329` |  |

## com/example/source/js/JsChapterOrder.kt (122 行, 1 声明)

iOS 归属：`src/core/source/js/jsChapterOrder.ts` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/source/js/jsComicSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `JsChapterOrder` | type | port | `src/core/source/js/jsChapterOrder.ts:79` |  |

## com/example/source/js/JsComicMetadata.kt (68 行, 1 声明)

iOS 归属：`src/core/source/js/jsComicSource.ts` / `src/core/source/js/jsComicMetadata.ts` / `src/core/discover/jsAdapter.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `JsComicMetadata` | type | port | `src/core/source/js/jsComicMetadata.ts:156` |  |

## com/example/source/js/JsComicSource.kt (934 行, 4 声明)

iOS 归属：`src/core/source/sourceText.ts` / `src/core/source/js/jsComicSource.ts` / `src/core/source/js/jsSourceRepo.ts` / `src/core/library/libraryDisplay.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 27 | `friendlyJsSourceError` | fun | port | `src/core/source/js/jsComicSource.ts:79` |  |
| 60 | `jsSourceFailure` | fun | port | `src/core/source/sourceText.ts:329` |  |
| 69 | `JsComicSource` | type | port | `src/core/source/js/jsComicSource.ts:155` |  |
| 919 | `VeneraRuntime` | type | port | `src/core/source/js/jsComicSource.ts:989` |  |

## com/example/source/js/JsCookieJar.kt (114 行, 1 声明)

iOS 归属：`src/core/source/js/jsCookieJar.ts` / `src/core/library/genericCoverLoader.ts` / `src/core/library/libraryComicLocalImporter.ts` / `src/platform/jsSourceAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 13 | `JsCookieJar` | type | port | `src/core/source/js/jsCookieJar.ts:634` |  |

## com/example/source/js/JsDiscoverAdapter.kt (75 行, 1 声明)

iOS 归属：`src/core/source/sourceText.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `JsDiscoverAdapter` | type | port | `src/core/source/sourceText.ts:321` |  |

## com/example/source/js/JsHtmlStore.kt (187 行, 1 声明)

iOS 归属：`src/core/source/js/jsHtmlStore.ts` / `src/core/source/js/jsMessageHandler.ts` / `src/platform/sourceWorker/entry.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 16 | `JsHtmlStore` | type | port | `src/core/source/js/jsHtmlStore.ts:25` |  |

## com/example/source/js/JsImageProcessor.kt (50 行, 1 声明)

iOS 归属：`src/core/source/js/jsImageProcessor.ts` / `src/core/source/js/jsComicSource.ts` / `src/ui/pages/ComicReaderOnlinePage.tsx` / `src/core/library/libraryComicLocalImporter.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `JsImageProcessor` | type | port | `src/core/source/js/jsImageProcessor.ts:68` |  |

## com/example/source/js/JsMessageHandler.kt (1037 行, 1 声明)

iOS 归属：`src/core/source/js/jsMessageHandler.ts` / `src/core/source/js/jsSourceEngine.ts` / `src/core/crypto/aes.ts` / `src/platform/sourceWorker/engine.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 50 | `JsMessageHandler` | type | port | `src/core/source/js/jsMessageHandler.ts:378` |  |

## com/example/source/js/JsSourceEngine.kt (560 行, 1 声明)

iOS 归属：`src/platform/web/jsSandboxBody.ts` / `src/core/source/js/jsComicSource.ts` / `src/core/source/js/jsPlatform.ts` / `src/core/source/js/jsImageProcessor.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `JsSourceEngine` | type | port | `src/core/source/js/jsSourceEngine.ts:104` |  |

## com/example/source/js/JsSourcePayload.kt (33 行, 1 声明)

iOS 归属：`src/core/source/sourceText.ts` / `src/core/source/js/jsSourcePayload.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `JsSourcePayload` | type | port | `src/core/source/js/jsSourcePayload.ts:121` |  |

## com/example/source/js/JsSourceProxy.kt (227 行, 1 声明)

iOS 归属：`src/core/source/js/jsMessageHandler.ts` / `src/core/source/js/jsSourceProxy.ts` / `src/core/library/genericCoverLoader.ts` / `src/core/source/impl/sourceHttp.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 32 | `JsSourceProxy` | type | port | `src/core/source/js/jsSourceProxy.ts:317` |  |

## com/example/source/js/JsSourceRepo.kt (1552 行, 1 声明)

iOS 归属：`src/core/source/js/jsSourcePatches.ts` / `src/core/source/js/jsSourceEngine.ts` / `src/core/source/js/jsSourceRepo.ts` / `src/platform/jsSourceAssembly.ts` / `src/core/source/sourceViewModel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 26 | `JsSourceRepo` | type | port | `src/core/source/js/jsSourceRepo.ts:281` |  |

## com/example/source/js/JsUiDialogs.kt (181 行, 3 声明)

iOS 归属：`src/core/source/js/jsUiDialogs.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 30 | `JsActivityTracker` | type | port | `src/core/source/js/jsUiDialogs.ts:98` |  |
| 56 | `awaitJsInputDialog` | fun | port | `src/core/source/js/jsUiDialogs.ts:131` |  |
| 110 | `awaitWebsiteVerification` | fun | port | `src/core/source/js/jsUiDialogs.ts:164` |  |

## com/example/source/js/MxsSpacerPages.kt (32 行, 2 声明)

iOS 归属：`src/core/source/js/mxsSpacerPages.ts` / `src/core/source/js/jsComicSource.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `isMxsWhiteSpacer` | fun | port | `src/core/source/js/mxsSpacerPages.ts:15` |  |
| 19 | `stripLeadingMxsSpacers` | fun | port | `src/core/source/js/mxsSpacerPages.ts:45` |  |

## com/example/source/js/MyComicBrowserReader.kt (137 行, 1 声明)

iOS 归属：`src/core/source/sourceText.ts` / `src/core/ui/kotlinAuthorityConstants.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `MyComicBrowserReader` | type | port | `src/core/source/sourceText.ts:338` |  |

## com/example/source/js/QuickJsAsyncLifecycle.kt (39 行, 1 声明)

iOS 归属：`src/core/source/js/jsSourceEngine.ts` / `src/core/source/js/quickJsAsyncLifecycle.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `QuickJsAsyncLifecycle` | type | port | `src/core/source/js/quickJsAsyncLifecycle.ts:38` |  |

## com/example/source/js/SourceDns.kt (66 行, 1 声明)

iOS 归属：`src/core/source/js/sourceDns.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `SourceDns` | type | port | `src/core/source/js/sourceDns.ts:136` |  |

## com/example/source/js/WebViewPageLoader.kt (169 行, 1 声明, 1 gap)


| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 31 | `WebViewPageLoader` | type | gap | — |  |

## com/example/source/keyword/KeywordCache.kt (82 行, 1 声明)

iOS 归属：`src/core/source/keyword/keywordRepository.ts` / `src/core/source/keyword/keywordCache.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `KeywordCache` | type | port | `src/core/source/keyword/keywordCache.ts:78` |  |

## com/example/source/keyword/KeywordDictionary.kt (176 行, 1 声明)

iOS 归属：`src/core/source/keyword/keywordAssembly.ts` / `src/core/source/keyword/keywordRepository.ts` / `src/core/source/keyword/keywordDictionary.ts` / `src/platform/ios-native/nativeSelfTest.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `KeywordDictionary` | type | port | `src/core/source/keyword/keywordDictionary.ts:132` |  |

## com/example/source/keyword/KeywordExpansion.kt (126 行, 1 声明)

iOS 归属：`src/core/source/keyword/keywordRepository.ts` / `src/core/source/keyword/keywordExpansion.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `KeywordExpansion` | type | port | `src/core/source/keyword/keywordExpansion.ts:91` |  |

## com/example/source/keyword/KeywordModels.kt (158 行, 9 声明)

iOS 归属：`src/core/source/keyword/keywordModels.ts` / `src/core/source/keyword/keywordExpansion.ts` / `src/core/source/keyword/onlineKeywordLookup.ts` / `src/core/source/keyword/keywordRepository.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `KeywordName` | type | port | `src/core/source/keyword/keywordModels.ts:53` |  |
| 10 | `KeywordConcept` | type | port | `src/core/source/keyword/keywordModels.ts:58` |  |
| 25 | `KeywordProviderState` | type | port | `src/core/source/keyword/keywordModels.ts:97` |  |
| 36 | `OnlineKeywordResult` | type | port | `src/core/source/keyword/keywordModels.ts:122` |  |
| 42 | `KeywordUpdate` | type | port | `src/core/source/keyword/keywordModels.ts:129` |  |
| 50 | `KeywordConcepts` | type | port | `src/core/source/keyword/keywordModels.ts:400` |  |
| 81 | `KeywordKeys` | type | port | `src/core/source/keyword/keywordModels.ts:208` |  |
| 101 | `KeywordPersonNames` | type | port | `src/core/source/keyword/keywordModels.ts:256` |  |
| 118 | `KeywordVariants` | type | port | `src/core/source/keyword/keywordModels.ts:294` |  |

## com/example/source/keyword/KeywordRepository.kt (157 行, 1 声明)

iOS 归属：`src/core/source/keyword/keywordAssembly.ts` / `src/core/source/keyword/keywordRepository.ts` / `src/core/library/libraryViewModel.ts` / `src/ui/state/appStore.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `KeywordRepository` | type | port | `src/core/source/keyword/keywordRepository.ts:179` |  |

## com/example/source/keyword/LocalKeywordIndex.kt (29 行, 1 声明)

iOS 归属：`src/core/source/keyword/localKeywordIndex.ts` / `src/core/source/keyword/keywordRepository.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `LocalKeywordIndex` | type | port | `src/core/source/keyword/localKeywordIndex.ts:30` |  |

## com/example/source/keyword/OnlineKeywordLookup.kt (290 行, 1 声明)

iOS 归属：`src/core/source/keyword/keywordRepository.ts` / `src/core/source/keyword/onlineKeywordLookup.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 33 | `OnlineKeywordLookup` | type | port | `src/core/source/keyword/onlineKeywordLookup.ts:134` |  |

## com/example/source/parser/JsonPathResolver.kt (208 行, 1 声明)

iOS 归属：`src/core/parser/jsonPathResolver.ts` / `src/core/source/parser/index.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `JsonPathResolver` | type | port | `src/core/parser/jsonPathResolver.ts:2` |  |

## com/example/source/parser/LegadoRule.kt (323 行, 1 声明)

iOS 归属：`src/core/source/parser/index.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 22 | `LegadoRule` | type | port | `src/core/source/parser/index.ts:9` |  |

## com/example/source/parser/RuleBudget.kt (34 行, 1 声明)

iOS 归属：`src/core/source/js/boundedRegex.ts` / `src/core/parser/ruleBudget.ts` / `src/core/mangatranslate/llmTranslator.ts` / `src/core/source/js/jsSourceRepo.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `RuleBudget` | type | port | `src/core/mangatranslate/llmTranslator.ts:70` |  |

## com/example/source/storage/SharedPreferencesSourceStorage.kt (87 行, 1 声明)

iOS 归属：`src/core/source/storage/sourceStorage.ts` / `src/core/library/libraryAssembly.ts` / `src/core/source/storage/sharedPreferencesSourceStorage.ts` / `src/platform/web/platformAdapters.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `SharedPreferencesSourceStorage` | type | port | `src/core/source/storage/sharedPreferencesSourceStorage.ts:373` |  |

## com/example/source/storage/SourceStorage.kt (11 行, 1 声明)

iOS 归属：`src/core/source/storage/sourceStorage.ts` / `src/core/source/sourceManager.ts` / `src/core/source/sourceViewModel.ts` / `src/core/source/storage/sharedPreferencesSourceStorage.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `SourceStorage` | type | port | `src/core/source/sourceManager.ts:17` |  |

## com/example/source/zlibrary/DiamWallInterceptor.kt (247 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/diamWallInterceptor.ts` / `src/core/source/zlibrary/endpointHealthChecker.ts` / `src/core/source/zlibrary/network/zLibraryHttpClient.ts` / `src/core/source/diamWall.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `DiamWallInterceptor` | type | port | `src/core/source/zlibrary/diamWallInterceptor.ts:134` |  |

## com/example/source/zlibrary/EncryptedCookieJar.kt (124 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/encryptedCookieJar.ts` / `src/core/source/zlibrary/network/zLibraryHttpClient.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/platform/zLibraryAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `EncryptedCookieJar` | type | port | `src/core/source/zlibrary/encryptedCookieJar.ts:75` |  |

## com/example/source/zlibrary/EndpointHealthChecker.kt (214 行, 2 声明)

iOS 归属：`src/core/source/zlibrary/endpointHealthChecker.ts` / `src/core/source/zlibrary/zLibraryEndpointProvider.ts` / `src/core/source/zlibrary/zLibraryDomainResolver.ts` / `src/platform/zLibraryAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `EndpointHealthResult` | type | port | `src/core/source/zlibrary/endpointHealthChecker.ts:56` |  |
| 41 | `EndpointHealthChecker` | type | port | `src/core/source/zlibrary/endpointHealthChecker.ts:123` |  |

## com/example/source/zlibrary/RemoteEndpointConfig.kt (13 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/remoteEndpointProvider.ts` / `src/core/source/zlibrary/remoteEndpointConfig.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `RemoteEndpointConfig` | type | port | `src/core/source/zlibrary/remoteEndpointConfig.ts:15` |  |

## com/example/source/zlibrary/RemoteEndpointProvider.kt (179 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/remoteEndpointProvider.ts` / `src/core/source/zlibrary/zLibraryEndpointProvider.ts` / `src/platform/zLibraryAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 37 | `RemoteEndpointProvider` | type | port | `src/core/source/zlibrary/remoteEndpointProvider.ts:78` |  |

## com/example/source/zlibrary/ZLibraryAccessChecker.kt (38 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/parser/zLibraryParserManager.ts` / `src/core/source/zlibrary/zLibraryAccessChecker.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `ZLibraryAccessChecker` | type | port | `src/core/source/zlibrary/zLibraryAccessChecker.ts:11` |  |

## com/example/source/zlibrary/ZLibraryBookReference.kt (45 行, 4 声明)

iOS 归属：`src/core/download/downloadWorker.ts` / `src/core/source/sourceText.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/core/source/zlibrary/zLibraryBookReference.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `ZLibraryBookReference` | type | port | `src/core/source/sourceText.ts:478` |  |
| 24 | `shouldRetryZLibraryDownload` | fun | port | `src/core/source/zlibrary/zLibraryBookReference.ts:19` |  |
| 28 | `zLibraryDownloadPageError` | fun | port | `src/core/source/sourceText.ts:517` |  |
| 37 | `uniqueZLibraryEdition` | fun | port | `src/core/source/zlibrary/zLibraryBookReference.ts:25` |  |

## com/example/source/zlibrary/ZLibraryCredentialStorage.kt (64 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/network/zLibraryHttpClient.ts` / `src/core/source/zlibrary/network/zLibrarySessionManager.ts` / `src/core/source/zlibrary/zLibraryCredentialStorage.ts` / `src/core/source/zlibrary/encryptedCookieJar.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `ZLibraryCredentialStorage` | type | port | `src/core/source/zlibrary/zLibraryCredentialStorage.ts:101` |  |

## com/example/source/zlibrary/ZLibraryDomainResolver.kt (48 行, 2 声明)

iOS 归属：`src/core/source/zlibrary/zLibraryDomainResolver.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/platform/zLibraryAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `ZLibraryDomainResolver` | type | port | `src/core/source/zlibrary/zLibraryDomainResolver.ts:56` |  |
| 42 | `DomainHealthResult` | type | port | `src/core/source/zlibrary/zLibraryDomainResolver.ts:32` |  |

## com/example/source/zlibrary/ZLibraryEapiClient.kt (264 行, 2 声明)

iOS 归属：`src/core/source/zlibrary/zLibraryEapiClient.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/platform/zLibraryAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 28 | `ZLibraryEapiClient` | type | port | `src/core/source/zlibrary/zLibraryEapiClient.ts:91` |  |
| 261 | `DownloadLinkResult` | type | port | `src/core/source/zlibrary/zLibraryEapiClient.ts:71` |  |

## com/example/source/zlibrary/ZLibraryEndpointProvider.kt (278 行, 1 声明)

iOS 归属：`src/core/ui/kotlinAuthorityConstants.ts` / `src/core/source/zlibrary/zLibraryHost.ts` / `src/core/library/zLibraryNodeConfig.ts` / `src/core/library/zLibraryNodeManager.ts` / `src/core/source/zlibrary/zLibraryEndpointProvider.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `ZLibraryEndpointProvider` | type | port | `src/core/source/zlibrary/zLibraryEndpointProvider.ts:157` |  |

## com/example/source/zlibrary/ZLibraryNodeSelection.kt (27 行, 2 声明)

iOS 归属：`src/core/source/sourceText.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `isZLibraryPage` | fun | port | `src/core/source/sourceText.ts:533` |  |
| 13 | `selectHealthyNode` | fun | port | `src/core/source/sourceText.ts:539` |  |

## com/example/source/zlibrary/ZLibraryParser.kt (49 行, 3 声明)

iOS 归属：`src/core/source/zlibrary/zLibraryParser.ts` / `src/core/source/zlibrary/parsedBookDetail.ts` / `src/core/source/zlibrary/parser/bookcardLayoutParser.ts` / `src/core/source/zlibrary/parser/desktopLayoutParser.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `ParsedBookDetail` | type | port | `src/core/source/zlibrary/parsedBookDetail.ts:36` |  |
| 22 | `guessFileFormatFromUrl` | fun | port | `src/core/source/zlibrary/parsedBookDetail.ts:49` |  |
| 43 | `ZLibraryParser` | type | port | `src/core/source/zlibrary/zLibraryParser.ts:21` |  |

## com/example/source/zlibrary/ZLibrarySource.kt (829 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/zLibraryHost.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/core/library/libraryAssembly.ts` / `src/platform/zLibraryAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 26 | `ZLibrarySource` | type | port | `src/core/source/zlibrary/zLibrarySource.ts:232` |  |

## com/example/source/zlibrary/ZLibraryWebViewHelper.kt (252 行, 2 声明)

iOS 归属：`src/core/source/zlibrary/zLibraryWebViewHelper.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/core/library/zLibraryNodeManager.ts` / `src/core/library/zLibraryNativeSession.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 35 | `WebViewSearchResult` | type | port | `src/core/source/zlibrary/zLibraryWebViewHelper.ts:69` |  |
| 44 | `ZLibraryWebViewHelper` | type | port | `src/core/source/zlibrary/zLibrarySource.ts:1207` |  |

## com/example/source/zlibrary/network/SystemProxyResolver.kt (49 行, 1 声明)

iOS 归属：`src/core/library/zLibraryCoverLoader.ts` / `src/core/source/zlibrary/network/systemProxyResolver.ts` / `src/core/update/appUpdateDownload.ts` / `src/core/update/githubUpdateChecker.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `SystemProxyResolver` | type | port | `src/core/source/zlibrary/network/systemProxyResolver.ts:12` |  |

## com/example/source/zlibrary/network/ZLibraryDns.kt (332 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/endpointHealthChecker.ts` / `src/core/source/zlibrary/network/zLibraryDns.ts` / `src/core/library/zLibraryNodeManager.ts` / `src/core/library/zLibraryCoverLoader.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 22 | `ZLibraryDns` | type | port | `src/core/source/zlibrary/network/zLibraryDns.ts:183` |  |

## com/example/source/zlibrary/network/ZLibraryHttpClient.kt (178 行, 1 声明)

iOS 归属：`src/core/library/zLibraryNodeManager.ts` / `src/core/source/zlibrary/network/zLibraryHttpClient.ts` / `src/core/source/zlibrary/zLibraryEapiClient.ts` / `src/platform/zLibraryAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `ZLibraryHttpClient` | type | port | `src/core/source/zlibrary/network/zLibraryHttpClient.ts:183` |  |

## com/example/source/zlibrary/network/ZLibraryNetworkLogger.kt (19 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/zLibrarySource.ts` / `src/core/source/zlibrary/network/zLibraryNetworkLogger.ts` / `src/core/source/zlibrary/network/zLibraryHttpClient.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `ZLibraryNetworkLogger` | type | port | `src/core/source/zlibrary/network/zLibraryNetworkLogger.ts:10` |  |

## com/example/source/zlibrary/network/ZLibrarySessionManager.kt (52 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/network/zLibrarySessionManager.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/platform/zLibraryAssembly.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `ZLibrarySessionManager` | type | port | `src/core/source/zlibrary/network/zLibrarySessionManager.ts:46` |  |

## com/example/source/zlibrary/parser/BookcardLayoutParser.kt (153 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/parser/bookcardLayoutParser.ts` / `src/core/source/zlibrary/parser/zLibraryParserManager.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 17 | `BookcardLayoutParser` | type | port | `src/core/source/zlibrary/parser/bookcardLayoutParser.ts:63` |  |

## com/example/source/zlibrary/parser/CoverExtractor.kt (71 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/parser/coverExtractor.ts` / `src/core/source/zlibrary/parser/genericFallbackParser.ts` / `src/core/source/zlibrary/parser/desktopLayoutParser.ts` / `src/core/source/zlibrary/parser/mobileLayoutParser.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `CoverExtractor` | type | port | `src/core/source/zlibrary/parser/coverExtractor.ts:10` |  |

## com/example/source/zlibrary/parser/DesktopLayoutParser.kt (115 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/parser/desktopLayoutParser.ts` / `src/core/source/zlibrary/parsedBookDetail.ts` / `src/core/source/zlibrary/parser/zLibraryParserManager.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `DesktopLayoutParser` | type | port | `src/core/source/zlibrary/parser/desktopLayoutParser.ts:44` |  |

## com/example/source/zlibrary/parser/GenericFallbackParser.kt (164 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/parser/zLibraryParserManager.ts` / `src/core/source/zlibrary/parser/genericFallbackParser.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 13 | `GenericFallbackParser` | type | port | `src/core/source/zlibrary/parser/genericFallbackParser.ts:59` |  |

## com/example/source/zlibrary/parser/LegacyLayoutParser.kt (103 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/parser/legacyLayoutParser.ts` / `src/core/source/zlibrary/parser/zLibraryParserManager.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `LegacyLayoutParser` | type | port | `src/core/source/zlibrary/parser/legacyLayoutParser.ts:42` |  |

## com/example/source/zlibrary/parser/MobileLayoutParser.kt (108 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/parser/mobileLayoutParser.ts` / `src/core/source/zlibrary/parser/zLibraryParserManager.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `MobileLayoutParser` | type | port | `src/core/source/zlibrary/parser/mobileLayoutParser.ts:44` |  |

## com/example/source/zlibrary/parser/ZLibraryLayoutParser.kt (23 行, 2 声明)

iOS 归属：`src/core/source/zlibrary/parser/zLibraryLayoutParser.ts` / `src/core/source/zlibrary/parser/bookcardLayoutParser.ts` / `src/core/source/zlibrary/parser/desktopLayoutParser.ts` / `src/core/source/zlibrary/parser/genericFallbackParser.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `ZLibraryLayoutParser` | type | port | `src/core/source/zlibrary/parser/zLibraryLayoutParser.ts:26` |  |
| 20 | `firstRealDownloadLink` | fun | port | `src/core/source/zlibrary/parser/zLibraryLayoutParser.ts:13` |  |

## com/example/source/zlibrary/parser/ZLibraryParserManager.kt (77 行, 1 声明)

iOS 归属：`src/core/source/zlibrary/parser/zLibraryParserManager.ts` / `src/core/source/zlibrary/zLibraryParser.ts` / `src/core/source/zlibrary/zLibrarySource.ts` / `src/ui/components/source/ZLibraryNodeManagementScreen.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `ZLibraryParserManager` | type | port | `src/core/source/zlibrary/parser/zLibraryParserManager.ts:19` |  |

## com/example/transfer/ArchiveImporter.kt (225 行, 1 声明)

iOS 归属：`src/core/transfer/archiveImporter.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 17 | `ArchiveImporter` | type | port | `src/core/ui/parityMisc.ts:127` |  |

## com/example/transfer/ArchiveRows.kt (73 行, 1 声明)

iOS 归属：`src/core/transfer/archiveDatabaseRows.ts` / `src/core/transfer/archiveJournalRows.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `ArchiveRows` | type | port | `src/core/transfer/archiveJournalRows.ts:313` |  |

## com/example/transfer/BookBodyFingerprint.kt (72 行, 1 声明)

iOS 归属：`src/core/transfer/bookFingerprint.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `BookBodyFingerprint` | type | port | `src/core/transfer/bookFingerprint.ts:7` |  |

## com/example/transfer/ImportJournal.kt (80 行, 1 声明)

iOS 归属：`src/core/transfer/importJournal.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `ImportJournal` | type | port | `src/core/ui/parityMisc.ts:125` |  |

## com/example/transfer/IncomingChapterIndex.kt (60 行, 1 声明)

iOS 归属：`src/core/transfer/nearby.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `IncomingChapterIndex` | type | port | `src/core/transfer/nearby.ts:230` |  |

## com/example/transfer/NearbyConnector.kt (100 行, 3 声明)

iOS 归属：`src/core/transfer/nearby.ts` / `src/core/transfer/nearbyConnector.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `NearbyGroup` | type | port | `src/core/transfer/nearbyConnector.ts:64` |  |
| 12 | `NearbyPlatform` | type | port | `src/core/transfer/nearbyConnector.ts:72` |  |
| 21 | `NearbyConnector` | type | port | `src/core/transfer/nearbyConnector.ts:324` |  |

## com/example/transfer/NearbyHandshake.kt (33 行, 2 声明)

iOS 归属：`src/core/transfer/nearby.ts` / `src/core/transfer/transferConnection.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `NearbyOffer` | type | port | `src/core/transfer/nearby.ts:82` |  |
| 10 | `NearbyHandshake` | type | port | `src/core/transfer/nearby.ts:2` |  |

## com/example/transfer/PortableArchive.kt (317 行, 1 声明)

iOS 归属：`src/core/transfer/portableFormat.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `PortableArchive` | type | port | `src/core/ui/parityMisc.ts:194` |  |

## com/example/transfer/PortableSettings.kt (141 行, 1 声明)

iOS 归属：`src/core/transfer/portableSettings.ts` / `src/core/transfer/archiveImporter.ts` / `src/core/transfer/importJournalLayout.ts` / `src/platform/ios-native/archiveExportSettings.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 13 | `PortableSettings` | type | port | `src/core/transfer/portableSettings.ts:10` |  |

## com/example/transfer/TransferConnection.kt (84 行, 1 声明)

iOS 归属：`src/core/transfer/nearby.ts` / `src/core/transfer/transferConnection.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `TransferConnection` | type | port | `src/core/transfer/nearby.ts:23` |  |

## com/example/transfer/TransferDiscovery.kt (281 行, 1 声明)

iOS 归属：`src/core/transfer/nearby.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `TransferDiscovery` | type | port | `src/core/transfer/nearby.ts:73` |  |

## com/example/transfer/TransferManager.kt (603 行, 1 声明)

iOS 归属：`src/core/transfer/transferSession.ts` / `src/core/ui/parityNames2.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 28 | `TransferManager` | type | port | `src/core/ui/parityNames2.ts:57` |  |

## com/example/transfer/TransferModels.kt (76 行, 22 声明)

iOS 归属：`src/core/transfer/transferModels.ts` / `src/core/transfer/nearby.ts` / `src/core/transfer/transferRoutes.ts` / `src/core/backup/autoBackup.ts` / `src/core/transfer/transferSession.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `TransferCategory` | type | port | `src/core/transfer/transferModels.ts:46` |  |
| 16 | `ImportMode` | type | port | `src/core/transfer/transferModels.ts:64` |  |
| 17 | `ExportSelection` | type | port | `src/core/transfer/transferModels.ts:68` |  |
| 21 | `ArchivePreview` | type | port | `src/core/transfer/transferModels.ts:79` |  |
| 26 | `ImportResult` | type | port | `src/core/transfer/transferModels.ts:91` |  |
| 27 | `TransferEstimate` | type | port | `src/core/transfer/transferModels.ts:99` |  |
| 28 | `TransferProgress` | type | port | `src/core/transfer/transferModels.ts:147` |  |
| 33 | `TransferPhase` | type | port | `src/core/transfer/transferModels.ts:123` |  |
| 41 | `TransferError` | type | port | `src/core/transfer/transferModels.ts:182` |  |
| 42 | `TransferRoute` | type | port | `src/core/transfer/transferModels.ts:185` |  |
| 43 | `TransferPeer` | type | port | `src/core/transfer/transferModels.ts:194` |  |
| 47 | `TransferSessionState` | type | port | `src/core/transfer/transferModels.ts:213` |  |
| 59 | `TransferIdentityEntity` | type | port | `src/core/transfer/transferModels.ts:242` |  |
| 61 | `TransferReceiptEntity` | type | port | `src/core/transfer/transferModels.ts:248` |  |
| 63 | `TRANSFER_MIME` | val | port | `src/core/transfer/transferModels.ts:254` |  |
| 64 | `MAX_ARCHIVE_BYTES` | val | port | `src/core/transfer/transferModels.ts:256` |  |
| 65 | `TRANSFER_RETENTION` | val | port | `src/core/transfer/transferModels.ts:258` |  |
| 66 | `CHUNK_SIZE` | val | port | `src/core/transfer/transferModels.ts:260` |  |
| 67 | `sha256` | fun | port | `src/core/comic/comicProcessedDiskCache.ts:103` |  |
| 68 | `hex` | fun | port | `src/core/transfer/nearby.ts:343` |  |
| 69 | `fileHash` | fun | port | `src/core/transfer/transferModels.ts:263` |  |
| 76 | `stringOrNull` | fun | port | `src/core/transfer/transferModels.ts:270` |  |

## com/example/transfer/TransferRoutes.kt (17 行, 2 声明)

iOS 归属：`src/core/transfer/transferRoutes.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 3 | `mergePeer` | fun | port | `src/core/transfer/transferRoutes.ts:113` |  |
| 14 | `connectionRoutes` | fun | port | `src/core/transfer/transferRoutes.ts:153` |  |

## com/example/transfer/TransferScreen.kt (699 行, 8 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/core/ui/parityMisc.ts` / `src/ui/pages/SettingsPage.tsx` / `src/platform/autoBackupRuntime.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 101 | `TransferHost` | fun | port | `src/core/ui/parityMisc.ts:203` |  |
| 143 | `TransferScreen` | fun | port | `src/core/ui/designTokens.ts:207` |  |
| 577 | `matchesPrompt` | fun | port | `src/core/ui/designTokens.ts:208` |  |
| 582 | `TransferSheet` | fun | port | `src/core/ui/parityMisc.ts:210` |  |
| 615 | `TransferArtwork` | fun | port | `src/core/ui/parityMisc.ts:217` |  |
| 697 | `bytes` | fun | port | `src/platform/autoBackupRuntime.ts:247` |  |
| 698 | `summary` | fun | port | `src/core/ui/parityMisc.ts:224` |  |
| 699 | `permissionRequests` | fun | port | `src/core/ui/designTokens.ts:213` |  |

## com/example/transfer/TransferService.kt (50 行, 1 声明)

iOS 归属：`src/core/transfer/transferService.ts` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/transfer/transferNotification.ts` / `src/platform/interfaces.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 19 | `TransferService` | type | port | `src/core/transfer/transferNotification.ts:2` |  |

## com/example/transfer/TransferTls.kt (75 行, 1 声明)

iOS 归属：`src/core/transfer/transferWire.ts` / `src/core/ui/parityNames2.ts` / `src/core/transfer/transferTls.ts` / `src/core/ui/kotlinAuthorityConstants.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 19 | `TransferTls` | type | port | `src/core/ui/parityNames2.ts:70` |  |

## com/example/transfer/TransferWire.kt (26 行, 1 声明)

iOS 归属：`src/core/transfer/transferSession.ts` / `src/platform/ios-native/deviceTransferController.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `TransferWire` | type | port | `src/core/transfer/transferWire.ts:56` |  |

## com/example/ui/AppBackground.kt (91 行, 6 声明)

iOS 归属：`src/ui/components/AppBackground.tsx` / `src/ui/pages/SettingsPage.tsx` / `src/ui/pages/StatisticsPage.tsx` / `src/ui/components/StarryNightBackground.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 16 | `AppBackgroundConfig` | type | port | `src/ui/components/AppBackground.tsx:42` |  |
| 22 | `AppBackgroundController` | type | port | `src/ui/components/AppBackground.tsx:8` |  |
| 32 | `LocalAppBackgroundActive` | val | port | `src/ui/components/AppBackground.tsx:9` |  |
| 38 | `LocalBackgroundTone` | val | port | `src/ui/components/AppBackground.tsx:10` |  |
| 46 | `adaptiveTitleColor` | fun | port | `src/ui/components/AppBackground.tsx:134` |  |
| 53 | `loadBackgroundAvgLuminance` | fun | port | `src/ui/components/AppBackground.tsx:166` |  |

## com/example/ui/AppUpdateDialog.kt (276 行, 3 声明)

iOS 归属：`src/ui/components/AppUpdateDialog.tsx` / `src/core/update/appUpdateInstaller.ts` / `src/core/update/appUpdateManager.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 57 | `AppUpdateDialogHost` | fun | port | `src/ui/components/AppUpdateDialog.tsx:221` |  |
| 156 | `AppUpdateDialog` | fun | port | `src/ui/components/AppUpdateDialog.tsx:398` |  |
| 276 | `updateBytes` | fun | port | `src/ui/components/AppUpdateDialog.tsx:617` |  |

## com/example/ui/CacheManagementScreen.kt (855 行, 8 声明)

iOS 归属：`src/ui/pages/CacheManagementPage.tsx` / `src/core/cache/cacheManagement.ts` / `src/ui/pages/SettingsPage.tsx` / `src/core/mascot/mascotEvents.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 86 | `COVER_DIRS` | val | port | `src/core/cache/cacheManagement.ts:157` |  |
| 92 | `StorageRow` | type | port | `src/core/cache/cacheManagement.ts:250` |  |
| 122 | `CacheManagementScreen` | fun | port | `src/core/cache/cacheManagement.ts:3` |  |
| 681 | `segmentedBar` | fun | port | `src/core/cache/cacheManagement.ts:31` |  |
| 722 | `ScanningSkeleton` | fun | port | `src/core/cache/cacheManagement.ts:32` |  |
| 744 | `FileSweepIndicator` | fun | port | `src/core/cache/cacheManagement.ts:34` |  |
| 786 | `CleanSuccessBadge` | fun | port | `src/core/cache/cacheManagement.ts:36` |  |
| 824 | `AnimatedCheckMark` | fun | port | `src/core/cache/cacheManagement.ts:38` |  |

## com/example/ui/CardAppearanceScreen.kt (187 行, 2 声明)

iOS 归属：`src/ui/pages/CardAppearancePage.tsx` / `src/ui/pages/SettingsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 34 | `CardAppearanceScreen` | fun | port | `src/ui/pages/CardAppearancePage.tsx:3` |  |
| 164 | `CardTweakSlider` | fun | port | `src/ui/pages/CardAppearancePage.tsx:330` |  |

## com/example/ui/ComicChaptersScreen.kt (1421 行, 13 声明)

iOS 归属：`src/ui/pages/ComicChaptersPage.tsx` / `src/core/comic/comicChapters.ts` / `src/ui/components/comic/ComicChaptersSkeletons.tsx` / `src/core/god/godSettingsSection.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 110 | `GodGold` | val | port | `src/core/comic/comicChapters.ts:110` |  |
| 111 | `GodGoldStroke` | val | port | `src/core/comic/comicChapters.ts:112` |  |
| 113 | `GodScrimBase` | val | port | `src/core/comic/comicChapters.ts:114` |  |
| 116 | `LIST_HEADER_ITEMS` | val | port | `src/core/comic/comicChapters.ts:127` |  |
| 128 | `ComicChaptersScreen` | fun | port | `src/core/comic/comicChapters.ts:3` |  |
| 682 | `DirectoryHeadingSkeleton` | fun | port | `src/ui/components/comic/ComicChaptersSkeletons.tsx:69` |  |
| 689 | `ComicDirectorySkeleton` | fun | port | `src/ui/components/comic/ComicChaptersSkeletons.tsx:84` |  |
| 703 | `ChapterCardSpec` | fun | port | `src/core/comic/comicChapters.ts:511` |  |
| 977 | `GodCardSpec` | fun | port | `src/core/comic/comicChapters.ts:47` |  |
| 1159 | `CheckCircleSpec` | fun | port | `src/core/comic/comicChapters.ts:48` |  |
| 1167 | `ComicHeroHeader` | fun | port | `src/core/comic/comicChapters.ts:37` |  |
| 1317 | `DownloadProgressOverlay` | fun | port | `src/core/comic/comicChapters.ts:43` |  |
| 1397 | `longPressDetector` | fun | port | `src/core/comic/comicChapters.ts:52` |  |

## com/example/ui/ComicMetadataUi.kt (89 行, 3 声明)

iOS 归属：`src/ui/components/ComicMetadataUi.tsx` / `src/ui/pages/ComicChaptersPage.tsx` / `src/core/comic/comicChapters.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `comicSearchActions` | fun | port | `src/ui/components/ComicMetadataUi.tsx:70` |  |
| 29 | `ComicMetadataBlock` | fun | port | `src/ui/components/ComicMetadataUi.tsx:96` |  |
| 88 | `languageName` | fun | port | `src/ui/components/ComicMetadataUi.tsx:219` |  |

## com/example/ui/ComicReaderScreen.kt (145 行, 2 声明)

iOS 归属：`src/ui/pages/ComicReaderOnlinePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 32 | `ComicReaderScreen` | fun | port | `src/ui/pages/ComicReaderOnlinePage.tsx:5` |  |
| 144 | `comicOrNull` | fun | port | `src/ui/pages/ComicReaderOnlinePage.tsx:54` |  |

## com/example/ui/HomeScreen.kt (2473 行, 12 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/pages/HomePage.tsx` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/home/homeViewModel.ts` / `src/ui/components/Chips.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 146 | `HomeScreen` | fun | port | `src/core/home/homeViewModel.ts:3` |  |
| 2188 | `ShelfDragCover` | fun | port | `src/core/home/homeViewModel.ts:119` |  |
| 2255 | `favKeyOf` | fun | port | `src/core/home/homeViewModel.ts:120` |  |
| 2261 | `TodayReadTimeText` | fun | port | `src/core/home/homeViewModel.ts:110` |  |
| 2279 | `PendingCategoryMove` | type | port | `src/core/ui/parityMisc.ts:237` |  |
| 2282 | `CategoryNameSheet` | fun | port | `src/core/ui/parityMisc.ts:244` |  |
| 2317 | `todayReadMinutes` | fun | port | `src/core/home/homeViewModel.ts:716` |  |
| 2323 | `ShelfRegionHeading` | fun | port | `src/ui/pages/HomePage.tsx:2936` |  |
| 2348 | `ShelfViewControl` | fun | port | `src/ui/pages/HomePage.tsx:2310` |  |
| 2360 | `HomeActionChip` | fun | port | `src/core/home/homeViewModel.ts:125` |  |
| 2384 | `HomeCategoryChip` | fun | port | `src/core/home/homeViewModel.ts:126` |  |
| 2439 | `CategoryActionSheet` | fun | port | `src/core/home/homeViewModel.ts:117` |  |

## com/example/ui/NovelReaderScreen.kt (551 行, 5 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/pages/NovelReaderOnlinePage.tsx` / `src/ui/pages/OnlineReaderRoute.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 78 | `NovelReaderScreen` | fun | port | `src/ui/pages/NovelReaderOnlinePage.tsx:280` |  |
| 398 | `OnlineNovelBody` | fun | port | `src/core/ui/parityMisc.ts:252` |  |
| 467 | `OnlineNovelControls` | fun | port | `src/core/ui/parityMisc.ts:259` |  |
| 530 | `OnlineNovelSkeleton` | fun | port | `src/core/ui/parityMisc.ts:267` |  |
| 545 | `OnlineNovelFailure` | fun | port | `src/core/ui/parityMisc.ts:270` |  |

## com/example/ui/OnboardingScreen.kt (242 行, 4 声明)

iOS 归属：`src/core/components/cardDent.ts` / `src/ui/pages/OnboardingPage.tsx` / `src/App.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 45 | `OnboardingPage` | type | port | `src/core/components/cardDent.ts:148` |  |
| 57 | `onboardingPages` | val | port | `src/core/components/cardDent.ts:20` |  |
| 89 | `OnboardingScreen` | fun | port | `src/core/components/cardDent.ts:3` |  |
| 180 | `OnboardingStory` | fun | port | `src/core/components/cardDent.ts:203` |  |

## com/example/ui/OnlineComicReaderScreen.kt (436 行, 9 声明)

iOS 归属：`src/ui/pages/ComicReaderOnlinePage.tsx` / `src/core/library/libraryAssembly.ts` / `src/core/library/libraryViewModel.ts` / `src/core/god/godReaderBinding.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 51 | `OnlineComicReaderScreen` | fun | port | `src/ui/pages/ComicReaderOnlinePage.tsx:3` |  |
| 234 | `ComicLoaderLock` | val | port | `src/ui/pages/ComicReaderOnlinePage.tsx:14` |  |
| 235 | `sharedComicLoader` | val | port | `src/ui/pages/ComicReaderOnlinePage.tsx:14` |  |
| 236 | `sharedComicAppContext` | val | port | `src/ui/pages/ComicReaderOnlinePage.tsx:31` |  |
| 237 | `sharedResolveImage` | val | port | `src/ui/pages/ComicReaderOnlinePage.tsx:16` |  |
| 238 | `sharedResolveImageHeaders` | val | port | `src/ui/pages/ComicReaderOnlinePage.tsx:32` |  |
| 248 | `comicImageLoader` | fun | port | `src/core/god/godReaderBinding.ts:70` |  |
| 255 | `warmComicPage` | fun | port | `src/ui/pages/ComicReaderOnlinePage.tsx:230` |  |
| 272 | `buildComicImageLoader` | fun | port | `src/ui/pages/ComicReaderOnlinePage.tsx:35` |  |

## com/example/ui/ReaderPagination.kt (602 行, 24 声明)

iOS 归属：`src/core/reader/paginationEnvironment.ts` / `src/core/reader/readerPagination.ts` / `src/ui/pages/ReaderPage.tsx` / `src/core/reader/pagination.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 39 | `ReaderPaginationCache` | type | port | `src/core/reader/pagination.ts:241` |  |
| 68 | `PaginationKey` | type | port | `src/core/reader/paginationEnvironment.ts:41` |  |
| 83 | `PaginationTextLayout` | type | port | `src/core/reader/paginationEnvironment.ts:66` |  |
| 98 | `PaginationLayoutEnvironment` | type | port | `src/core/reader/paginationEnvironment.ts:114` |  |
| 106 | `PaginationFontEnvironments` | type | port | `src/core/reader/paginationEnvironment.ts:123` |  |
| 125 | `PAGE_VERTICAL_PADDING_DP` | val | port | `src/core/reader/paginationEnvironment.ts:156` |  |
| 128 | `PAGE_TEXT_BOTTOM_PADDING_DP` | val | port | `src/core/reader/paginationEnvironment.ts:158` |  |
| 131 | `shouldCelebrateAfterForwardTurn` | fun | port | `src/core/reader/pagination.ts:217` |  |
| 141 | `TITLE_BLOCK_PADDING_DP` | val | port | `src/core/reader/paginationEnvironment.ts:160` |  |
| 144 | `LARGE_CHAPTER_THRESHOLD` | val | port | `src/core/reader/pagination.ts:15` |  |
| 147 | `PAGINATION_CHUNK_CHARS` | val | port | `src/core/reader/pagination.ts:16` |  |
| 150 | `EAGER_CHAPTER_THRESHOLD` | val | port | `src/core/reader/pagination.ts:17` |  |
| 153 | `ChapterPageBuffer` | type | port | `src/core/reader/paginationEnvironment.ts:199` |  |
| 172 | `pageIndexAtOffset` | fun | port | `src/core/reader/paginationEnvironment.ts:235` |  |
| 182 | `ReaderPageAnchors` | type | port | `src/core/reader/paginationEnvironment.ts:245` |  |
| 205 | `rememberChapterPages` | fun | port | `src/core/reader/readerPagination.ts:3` |  |
| 290 | `LayoutParams` | type | port | `src/core/reader/paginationEnvironment.ts:278` |  |
| 310 | `paginateChunked` | fun | port | `src/core/reader/readerPagination.ts:218` |  |
| 333 | `paginationChunkRanges` | fun | port | `src/core/reader/paginationEnvironment.ts:298` |  |
| 385 | `paginationImageTokenRanges` | fun | port | `src/core/reader/paginationEnvironment.ts:359` |  |
| 437 | `PaginationItems` | type | port | `src/core/reader/paginationEnvironment.ts:418` |  |
| 468 | `paginateChunk` | fun | port | `src/core/reader/pagination.ts:141` |  |
| 566 | `measurePageHeightPx` | fun | port | `src/core/reader/readerPagination.ts:4` |  |
| 587 | `buildParagraph` | fun | port | `src/core/reader/readerPagination.ts:22` |  |

## com/example/ui/ReaderProgressEffect.kt (38 行, 2 声明)

iOS 归属：`src/core/components/cardDent.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 16 | `rememberReaderScrollTopVisible` | fun | port | `src/core/components/cardDent.ts:14` |  |
| 23 | `ReaderScrollProgressEffect` | fun | port | `src/core/components/cardDent.ts:16` |  |

## com/example/ui/ReaderScreen.kt (5026 行, 10 声明)

iOS 归属：`src/ui/pages/ReaderPage.tsx` / `src/core/reader/readerScreenLogic.ts` / `src/core/reader/touchZones.ts` / `src/platform/interfaces.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 307 | `ReaderScreen` | fun | port | `src/core/reader/readerScreenLogic.ts:2` |  |
| 4481 | `BookmarkHangingRibbon` | fun | port | `src/core/reader/readerScreenLogic.ts:41` |  |
| 4569 | `formatForReader` | fun | port | `src/core/reader/readerScreenLogic.ts:503` |  |
| 4574 | `chunkForScroll` | fun | port | `src/core/reader/readerScreenLogic.ts:521` |  |
| 4624 | `measureTitleReservePx` | fun | port | `src/core/reader/readerScreenLogic.ts:553` |  |
| 4688 | `RenderSinglePage` | fun | port | `src/core/reader/readerScreenLogic.ts:36` |  |
| 4877 | `ReaderThemePreview` | type | port | `src/core/reader/readerScreenLogic.ts:281` |  |
| 4884 | `ReaderThemePreviewCard` | fun | port | `src/ui/pages/ReaderPage.tsx:2235` |  |
| 4936 | `ReaderPageModeChip` | fun | port | `src/core/reader/readerScreenLogic.ts:62` |  |
| 4988 | `ReaderFontOptionRow` | fun | port | `src/core/reader/readerScreenLogic.ts:63` |  |

## com/example/ui/ReadingTimerEffect.kt (127 行, 1 声明)

iOS 归属：`src/core/reader/readingTimer.ts` / `src/ui/pages/ComicReaderOnlinePage.tsx` / `src/ui/pages/NovelReaderOnlinePage.tsx` / `src/core/reader/readerScreenLogic.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 37 | `ReadingTimerEffect` | fun | port | `src/core/reader/readerScreenLogic.ts:16` |  |

## com/example/ui/SettingsTabScreen.kt (1279 行, 4 声明)

iOS 归属：`src/ui/pages/SettingsPage.tsx` / `src/ui/components/settings/SettingsNavigationCard.tsx` / `src/platform/interfaces.ts` / `src/ui/components/index.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 96 | `SettingsTabScreen` | fun | port | `src/platform/interfaces.ts:173` |  |
| 1237 | `SettingsNavigationCard` | fun | port | `src/ui/components/settings/SettingsNavigationCard.tsx:81` |  |
| 1259 | `SettingsSection` | fun | port | `src/ui/components/index.ts:9` |  |
| 1267 | `SettingsSectionHeader` | fun | port | `src/ui/components/settings/SettingsNavigationCard.tsx:25` |  |

## com/example/ui/SplashScreen.kt (325 行, 4 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/ui/pages/SplashPage.tsx` / `src/core/mascot/splashQuotes.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 46 | `TAG` | val | port | `src/core/ui/designTokens.ts:204` |  |
| 49 | `SplashScreen` | fun | port | `src/core/mascot/splashQuotes.ts:6` |  |
| 233 | `decodeSplashBitmap` | fun | port | `src/ui/pages/SplashPage.tsx:251` |  |
| 268 | `ProceduralArtisticPoster` | fun | port | `src/core/mascot/splashQuotes.ts:173` |  |

## com/example/ui/StatisticsScreen.kt (811 行, 6 声明)

iOS 归属：`src/ui/pages/StatisticsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 96 | `StatisticsScreen` | fun | port | `src/ui/pages/StatisticsPage.tsx:2` |  |
| 325 | `PeriodOverviewCard` | fun | port | `src/ui/pages/StatisticsPage.tsx:37` |  |
| 632 | `PeriodRange` | type | port | `src/ui/pages/StatisticsPage.tsx:59` |  |
| 640 | `MiniStatCard` | fun | port | `src/ui/pages/StatisticsPage.tsx:60` |  |
| 674 | `DayDetailSheet` | fun | port | `src/ui/pages/StatisticsPage.tsx:53` |  |
| 797 | `mergeDuplicateReadingRecords` | fun | port | `src/ui/lib/readingStats.ts:228` |  |

## com/example/ui/StorageDetailDialog.kt (402 行, 3 声明)

iOS 归属：`src/ui/components/cache/StorageDetailDialog.tsx` / `src/ui/pages/CacheManagementPage.tsx` / `src/core/cache/cacheManagement.ts` / `src/ui/components/cache/TranslationCacheDetail.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 42 | `StorageFileEntry` | type | port | `src/ui/components/cache/StorageDetailDialog.tsx:78` |  |
| 50 | `StorageDetailIndex` | type | port | `src/ui/components/cache/StorageDetailDialog.tsx:10` |  |
| 220 | `StorageDetailDialog` | fun | port | `src/ui/components/cache/StorageDetailDialog.tsx:559` |  |

## com/example/ui/ThemePaletteScreen.kt (229 行, 5 声明)

iOS 归属：`src/ui/pages/ThemePalettePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 45 | `paletteLabels` | val | port | `src/ui/pages/ThemePalettePage.tsx:9` |  |
| 48 | `ThemePaletteScreen` | fun | port | `src/ui/pages/ThemePalettePage.tsx:3` |  |
| 95 | `ThemePalettePreview` | fun | port | `src/ui/pages/ThemePalettePage.tsx:15` |  |
| 129 | `PaletteOptions` | fun | port | `src/ui/pages/ThemePalettePage.tsx:23` |  |
| 175 | `PaletteSwatch` | fun | port | `src/ui/pages/ThemePalettePage.tsx:32` |  |

## com/example/ui/TranslationCacheDetail.kt (295 行, 4 声明)

iOS 归属：`src/ui/components/cache/TranslationCacheDetail.tsx` / `src/ui/components/cache/StorageDetailDialog.tsx` / `src/core/cache/cacheManagement.ts` / `src/platform/ios-native/mangaTranslationRuntime.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 62 | `TranslationCacheEntry` | type | port | `src/ui/components/cache/TranslationCacheDetail.tsx:68` |  |
| 69 | `TranslationCacheIndex` | type | port | `src/ui/components/cache/StorageDetailDialog.tsx:416` |  |
| 125 | `TranslationCacheDetailDialog` | fun | port | `src/ui/components/cache/TranslationCacheDetail.tsx:228` |  |
| 291 | `formatCacheSize` | fun | port | `src/core/cache/cacheManagement.ts:363` |  |

## com/example/ui/adaptive/AdaptiveSpec.kt (248 行, 11 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/core/glass/adaptiveSpec.ts` / `src/ui/components/adaptive/AdaptiveSpec.tsx` / `src/core/ui-theme/appInsets.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 57 | `WindowWidthClass` | type | port | `src/core/glass/adaptiveSpec.ts:103` |  |
| 61 | `rememberWindowWidthClass` | fun | port | `src/core/glass/adaptiveSpec.ts:8` |  |
| 72 | `AdaptiveSpec` | type | port | `src/core/glass/adaptiveSpec.ts:120` |  |
| 88 | `AdaptiveSizing` | type | port | `src/core/glass/adaptiveSpec.ts:132` |  |
| 104 | `rememberAdaptiveSizing` | fun | port | `src/core/glass/adaptiveSpec.ts:11` |  |
| 129 | `adaptiveDialogWidth` | fun | port | `src/core/glass/adaptiveSpec.ts:12` |  |
| 134 | `adaptiveSheetWidth` | fun | port | `src/core/glass/adaptiveSpec.ts:13` |  |
| 148 | `adaptivePageWidth` | fun | port | `src/core/glass/adaptiveSpec.ts:14` |  |
| 156 | `AdaptiveSheetContent` | fun | port | `src/ui/components/adaptive/AdaptiveSpec.tsx:101` |  |
| 180 | `AdaptivePageContent` | fun | port | `src/ui/components/adaptive/AdaptiveSpec.tsx:126` |  |
| 196 | `AdaptiveWorkspace` | fun | port | `src/core/ui/designTokens.ts:195` |  |

## com/example/ui/comic/Anime4KCnn.kt (257 行, 1 声明)

iOS 归属：`src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 22 | `Anime4KCnn` | type | port | `src/core/ui/parityMisc.ts:278` |  |

## com/example/ui/comic/Anime4KCnnWeights.kt (447 行, 1 声明)

iOS 归属：`src/core/comic/anime4KCnn.ts` / `src/core/comic/anime4KCnnWeights.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `Anime4KCnnWeights` | type | port | `src/core/comic/anime4KCnn.ts:107` |  |

## com/example/ui/comic/ComicChapterEdgeGesture.kt (109 行, 2 声明)

iOS 归属：`src/ui/components/comic/comicChapterEdgeGesture.tsx` / `src/core/comic/comicPortTypes.ts` / `src/core/comic/comicChapterEdgeGesture.ts` / `src/core/comic/comicHarismCurl.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `comicChapterEdgeTarget` | fun | port | `src/core/comic/comicChapterEdgeGesture.ts:40` |  |
| 28 | `comicChapterEdgeSwipe` | fun | port | `src/core/comic/comicChapterEdgeGesture.ts:13` |  |

## com/example/ui/comic/ComicChapterResume.kt (26 行, 1 声明)

iOS 归属：`src/core/comic/comicChapterResume.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `ComicChapterResume` | type | port | `src/core/comic/comicChapterResume.ts:33` |  |

## com/example/ui/comic/ComicEdgeUpscaler.kt (190 行, 1 声明)

iOS 归属：`src/core/comic/comicImagePipeline.ts` / `src/core/comic/anime4KCnn.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `ComicEdgeUpscaler` | type | port | `src/core/comic/anime4KCnn.ts:21` |  |

## com/example/ui/comic/ComicFrozenGlassBackdrop.kt (89 行, 1 声明)

iOS 归属：`src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 28 | `rememberComicGlassBackdrop` | fun | port | `src/core/ui/parityMisc.ts:287` |  |

## com/example/ui/comic/ComicHarismCurl.kt (1820 行, 21 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/comic/comicHarismCurl.ts` / `src/platform/web/webCurlGl.ts` / `src/ui/pages/ComicReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 88 | `ComicCurlView` | type | port | `src/core/comic/comicHarismCurl.ts:12` |  |
| 573 | `ComicHarismController` | type | port | `src/core/comic/comicHarismCurl.ts:612` |  |
| 1013 | `slotCacheKey` | fun | port | `src/core/comic/comicHarismCurl.ts:224` |  |
| 1018 | `pageBgInt` | fun | port | `src/core/comic/comicHarismCurl.ts:259` |  |
| 1040 | `applyCurlBackground` | fun | port | `src/core/comic/comicHarismCurl.ts:486` |  |
| 1084 | `ourIndexFor` | fun | port | `src/core/comic/comicHarismCurl.ts:282` |  |
| 1089 | `flatUnitIndexFor` | fun | port | `src/core/comic/comicHarismCurl.ts:287` |  |
| 1102 | `adjacentBackFlat` | fun | port | `src/core/comic/comicHarismCurl.ts:302` |  |
| 1118 | `curlPageRects` | fun | port | `src/core/comic/comicHarismCurl.ts:312` |  |
| 1190 | `harismIndexFor` | fun | port | `src/core/comic/comicHarismCurl.ts:291` |  |
| 1193 | `CurlSyncPlan` | type | port | `src/core/comic/comicHarismCurl.ts:407` |  |
| 1203 | `CURL_IMMEDIATE_WAIT_MS` | val | port | `src/core/comic/comicHarismCurl.ts:415` |  |
| 1205 | `curlSyncPlan` | fun | port | `src/core/comic/comicHarismCurl.ts:418` |  |
| 1217 | `buildCurlFlatUnits` | fun | port | `src/core/comic/comicHarismCurl.ts:436` |  |
| 1231 | `spreadToHarismTwo` | fun | port | `src/core/comic/comicHarismCurl.ts:454` |  |
| 1239 | `harismToSpreadTwo` | fun | port | `src/core/comic/comicHarismCurl.ts:461` |  |
| 1245 | `pagePaperInt` | fun | port | `src/core/comic/comicHarismCurl.ts:42` |  |
| 1252 | `CurlLayoutInputs` | type | port | `src/core/ui/parityMisc.ts:306` |  |
| 1263 | `curlLayoutInputs` | fun | port | `src/core/ui/parityMisc.ts:314` |  |
| 1273 | `ComicHarismCurlReader` | fun | port | `src/core/comic/comicHarismCurl.ts:43` |  |
| 1772 | `ComicCurlZoomOverlay` | fun | port | `src/core/comic/comicHarismCurl.ts:50` |  |

## com/example/ui/comic/ComicImagePipeline.kt (1207 行, 1 声明)

iOS 归属：`src/core/comic/comicReaderCore.ts` / `src/ui/pages/ComicReaderPage.tsx` / `src/core/comic/comicPageLoader.ts` / `src/core/comic/comicImagePipeline.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 35 | `ComicImagePipeline` | type | port | `src/core/comic/comicImagePipeline.ts:2` |  |

## com/example/ui/comic/ComicLoadSupport.kt (54 行, 4 声明)

iOS 归属：`src/core/comic/comicLoadSupport.ts` / `src/ui/pages/ComicReaderOnlinePage.tsx` / `src/ui/components/comic/comicLoadSupport.tsx` / `src/core/comic/comicPageLoader.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `comicRemoteCacheKey` | fun | port | `src/core/comic/comicLoadSupport.ts:72` |  |
| 26 | `ComicTransferProgress` | type | port | `src/core/comic/comicLoadSupport.ts:94` |  |
| 31 | `ComicTransfers` | type | port | `src/core/comic/comicLoadSupport.ts:118` |  |
| 44 | `ComicLoadLocks` | type | port | `src/core/comic/comicLoadSupport.ts:192` |  |

## com/example/ui/comic/ComicNeuralBackend.kt (77 行, 1 声明)

iOS 归属：`src/core/comic/comicNeuralBackend.ts` / `src/core/comic/anime4KCnn.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `ComicNeuralBackend` | type | port | `src/core/comic/comicNeuralBackend.ts:152` |  |

## com/example/ui/comic/ComicPageLayout.kt (284 行, 11 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/comic/comicPageLayout.ts` / `src/ui/pages/ComicReaderPage.tsx` / `src/core/comic/comicReaderCore.ts` / `src/core/comic/comicPortTypes.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `ComicPageRef` | type | port | `src/core/comic/comicPageLayout.ts:125` |  |
| 23 | `SizeI` | type | port | `src/core/comic/comicPageLayout.ts:158` |  |
| 35 | `ComicSplitHalf` | type | port | `src/core/comic/comicPageLayout.ts:189` |  |
| 38 | `ComicSlot` | type | port | `src/core/comic/comicPageLayout.ts:201` |  |
| 45 | `ComicSpread` | type | port | `src/core/comic/comicPageLayout.ts:215` |  |
| 53 | `ComicLayout` | type | port | `src/core/comic/comicPageLayout.ts:237` |  |
| 67 | `preloadSlots` | fun | port | `src/core/ui/parityMisc.ts:319` |  |
| 103 | `ComicScrollStrategy` | type | port | `src/core/comic/comicPageLayout.ts:275` |  |
| 146 | `verticalPreloadIndices` | fun | port | `src/core/comic/comicPageLayout.ts:334` |  |
| 158 | `engineFadeAlpha` | fun | port | `src/core/comic/comicPageLayout.ts:351` |  |
| 163 | `ComicPageLayout` | type | port | `src/core/comic/comicPageLayout.ts:3` |  |

## com/example/ui/comic/ComicPageLoader.kt (1118 行, 2 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/pages/ComicReaderPage.tsx` / `src/core/comic/comicPageLoader.ts` / `src/ui/components/comic/comicReaderChrome.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 47 | `ComicPageLoader` | type | port | `src/core/comic/comicPageLoader.ts:649` |  |
| 1114 | `comicDisplayLoadWithTimeout` | fun | port | `src/core/ui/parityMisc.ts:329` |  |

## com/example/ui/comic/ComicPanelDesign.kt (317 行, 17 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/components/comic/comicPanelDesign.tsx` / `src/core/comic/comicPanelDesign.ts` / `src/ui/components/comic/sheets/comicSheetParts.tsx` / `src/ui/components/comic/sheets/ComicSettingsTranslationTab.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 95 | `PanelCardBg` | val | port | `src/core/comic/comicPanelDesign.ts:8` |  |
| 96 | `PanelCardStroke` | val | port | `src/core/comic/comicPanelDesign.ts:9` |  |
| 101 | `selectedBg` | fun | port | `src/core/comic/comicPanelDesign.ts:10` |  |
| 104 | `selectedStroke` | fun | port | `src/core/comic/comicPanelDesign.ts:10` |  |
| 111 | `PanelSectionCard` | fun | port | `src/ui/components/comic/comicPanelDesign.tsx:110` |  |
| 140 | `PanelTabData` | type | port | `src/core/comic/comicPanelDesign.ts:81` |  |
| 147 | `PanelTabRow` | fun | port | `src/ui/components/comic/comicPanelDesign.tsx:157` |  |
| 169 | `PanelHint` | fun | port | `src/ui/components/comic/sheets/comicSheetParts.tsx:82` |  |
| 176 | `PanelTabRail` | fun | port | `src/core/ui/parityMisc.ts:337` |  |
| 186 | `PanelTab` | fun | port | `src/core/ui/parityMisc.ts:342` |  |
| 237 | `PanelSlider` | fun | port | `src/ui/components/comic/comicPanelDesign.tsx:221` |  |
| 254 | `PanelSwitch` | fun | port | `src/ui/components/comic/comicPanelDesign.tsx:500` |  |
| 290 | `lerpColor` | fun | port | `src/core/glass/color.ts:95` |  |
| 299 | `panelSelectedBg` | fun | port | `src/core/comic/comicPanelDesign.ts:71` |  |
| 303 | `panelSelectedStroke` | fun | port | `src/core/comic/comicPanelDesign.ts:76` |  |
| 306 | `PanelBgSwatch` | type | port | `src/core/comic/comicPanelDesign.ts:86` |  |
| 310 | `PanelDecorativeIcon` | fun | port | `src/core/ui/parityMisc.ts:346` |  |

## com/example/ui/comic/ComicProcessedDiskCache.kt (118 行, 1 声明)

iOS 归属：`src/core/comic/comicPageLoader.ts` / `src/core/comic/comicProcessedDiskCache.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 27 | `ComicProcessedDiskCache` | type | port | `src/core/comic/comicProcessedDiskCache.ts:209` |  |

## com/example/ui/comic/ComicReaderBackground.kt (164 行, 2 声明)

iOS 归属：`src/ui/components/comic/comicReaderBackground.tsx` / `src/ui/pages/ComicReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `ComicReaderBackgrounds` | type | port | `src/ui/components/comic/comicReaderBackground.tsx:201` |  |
| 76 | `ComicReaderBackground` | fun | port | `src/ui/components/comic/comicReaderBackground.tsx:19` |  |

## com/example/ui/comic/ComicReaderChrome.kt (875 行, 22 声明)

iOS 归属：`src/ui/components/comic/comicReaderChrome.tsx` / `src/ui/components/comic/sheets/comicSheetParts.tsx` / `src/ui/components/comic/sheets/ComicSettingsImageTab.tsx` / `src/ui/components/comic/sheets/ComicSettingsPageTab.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 143 | `PanelBg` | val | port | `src/ui/components/comic/comicReaderChrome.tsx:135` |  |
| 144 | `PanelBgGlass` | val | port | `src/ui/components/comic/comicReaderChrome.tsx:137` |  |
| 145 | `PanelChipBg` | val | port | `src/ui/components/comic/comicReaderChrome.tsx:139` |  |
| 146 | `PanelChipActiveBg` | val | port | `src/ui/components/comic/comicReaderChrome.tsx:141` |  |
| 147 | `StrokeColor` | val | port | `src/ui/components/comic/comicReaderChrome.tsx:143` |  |
| 148 | `TextPrimary` | val | port | `src/ui/components/comic/comicReaderChrome.tsx:145` |  |
| 150 | `TextSecondary` | val | port | `src/ui/components/comic/comicReaderChrome.tsx:147` |  |
| 158 | `comicPanelGlass` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:13` |  |
| 171 | `ENTER_MS` | val | port | `src/ui/components/comic/comicReaderChrome.tsx:152` |  |
| 172 | `EXIT_MS` | val | port | `src/ui/components/comic/comicReaderChrome.tsx:154` |  |
| 179 | `ComicReaderChrome` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:16` |  |
| 369 | `ComicTopBar` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:22` |  |
| 511 | `ComicBottomBar` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:23` |  |
| 630 | `ChapterNavButton` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:31` |  |
| 650 | `ComicThumbPreview` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:977` |  |
| 689 | `ChromeIconButton` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:1032` |  |
| 699 | `clickableNoRipple` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:26` |  |
| 712 | `SegmentRow` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:1108` |  |
| 765 | `SliderRow` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:1162` |  |
| 794 | `SwitchRow` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:1192` |  |
| 810 | `ComicSheetContainer` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:1214` |  |
| 870 | `SectionLabel` | fun | port | `src/ui/components/comic/comicReaderChrome.tsx:1252` |  |

## com/example/ui/comic/ComicReaderConfig.kt (466 行, 12 声明)

iOS 归属：`src/core/comic/comicReaderConfig.ts` / `src/core/comic/comicReaderSheets.ts` / `src/core/comic/comicPortTypes.ts` / `src/core/comic/comicReaderCore.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `ComicReaderConfig` | type | port | `src/core/comic/comicReaderConfig.ts:480` |  |
| 295 | `ComicMode` | type | port | `src/core/comic/comicReaderConfig.ts:123` |  |
| 305 | `ComicDirection` | type | port | `src/core/comic/comicReaderConfig.ts:153` |  |
| 324 | `ComicFit` | type | port | `src/core/comic/comicReaderConfig.ts:173` |  |
| 335 | `ComicDoubleAlign` | type | port | `src/core/comic/comicReaderConfig.ts:225` |  |
| 345 | `ComicCropMode` | type | port | `src/core/comic/comicReaderConfig.ts:245` |  |
| 355 | `ComicEnhanceMode` | type | port | `src/core/comic/comicReaderConfig.ts:267` |  |
| 377 | `ComicBgType` | type | port | `src/core/comic/comicReaderConfig.ts:335` |  |
| 387 | `ComicScene` | type | port | `src/core/comic/comicReaderConfig.ts:365` |  |
| 399 | `ComicPageAnim` | type | port | `src/core/comic/comicReaderConfig.ts:404` |  |
| 409 | `ComicGestureAction` | type | port | `src/core/comic/comicReaderConfig.ts:426` |  |
| 423 | `ComicBookState` | type | port | `src/core/comic/comicReaderConfig.ts:1039` |  |

## com/example/ui/comic/ComicReaderCore.kt (2409 行, 30 声明)

iOS 归属：`src/ui/pages/ComicReaderPage.tsx` / `src/core/comic/comicReaderCore.ts` / `src/ui/components/comic/comicReaderChrome.tsx` / `src/ui/pages/ComicReaderOnlinePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 128 | `ComicTocEntry` | type | port | `src/core/comic/comicReaderCore.ts:53` |  |
| 131 | `ComicPanel` | type | port | `src/core/comic/comicReaderCore.ts:59` |  |
| 139 | `LocalComicTranslationEpoch` | val | port | `src/core/comic/comicReaderCore.ts:26` |  |
| 150 | `curlEngineActive` | fun | port | `src/core/comic/comicReaderCore.ts:349` |  |
| 163 | `panelGlassSamplingActive` | fun | port | `src/core/comic/comicReaderCore.ts:369` |  |
| 176 | `ComicVolumeKeyBridge` | type | port | `src/core/comic/comicReaderCore.ts:416` |  |
| 200 | `ComicReaderCore` | fun | port | `src/core/comic/comicReaderCore.ts:2` |  |
| 952 | `toneOf` | fun | port | `src/core/comic/comicReaderCore.ts:447` |  |
| 970 | `effectiveSplitPosition` | fun | port | `src/core/comic/comicReaderCore.ts:550` |  |
| 988 | `resolveTapAction` | fun | port | `src/core/comic/comicReaderCore.ts:567` |  |
| 1023 | `PageBitmapState` | type | port | `src/core/comic/comicReaderCore.ts:654` |  |
| 1030 | `rememberPageBitmap` | fun | port | `src/core/comic/comicReaderCore.ts:63` |  |
| 1118 | `fadeCancelOffset` | fun | port | `src/core/comic/comicReaderCore.ts:673` |  |
| 1131 | `fadeCrossAlpha` | fun | port | `src/core/comic/comicReaderCore.ts:691` |  |
| 1135 | `ComicPagedReader` | fun | port | `src/core/comic/comicReaderCore.ts:347` |  |
| 1300 | `dampEdgeDrag` | fun | port | `src/core/comic/comicReaderCore.ts:702` |  |
| 1316 | `magneticTargetShift` | fun | port | `src/core/comic/comicReaderCore.ts:724` |  |
| 1336 | `ComicMagneticPager` | fun | port | `src/core/comic/comicReaderCore.ts:1225` |  |
| 1515 | `ComicVerticalList` | fun | port | `src/core/comic/comicReaderCore.ts:1226` |  |
| 1759 | `ComicVerticalItem` | fun | port | `src/core/comic/comicReaderCore.ts:1227` |  |
| 1835 | `ComicSpreadCell` | fun | port | `src/core/comic/comicReaderCore.ts:1228` |  |
| 1925 | `fittedSize` | fun | port | `src/core/comic/comicReaderCore.ts:744` |  |
| 1979 | `visibleIntrinsicRect` | fun | port | `src/core/comic/comicReaderCore.ts:822` |  |
| 2001 | `SinglePageContent` | fun | port | `src/core/comic/comicReaderCore.ts:1229` |  |
| 2165 | `DoubleSpreadContent` | fun | port | `src/core/comic/comicReaderCore.ts:1230` |  |
| 2293 | `ComicRefinementFeedback` | fun | port | `src/core/comic/comicReaderCore.ts:1231` |  |
| 2311 | `ZoomableImageLayer` | fun | port | `src/core/comic/comicReaderCore.ts:1232` |  |
| 2345 | `PagePlaceholder` | fun | port | `src/core/comic/comicReaderCore.ts:1233` |  |
| 2377 | `ComicLoadingFeedback` | fun | port | `src/core/comic/comicReaderCore.ts:933` |  |
| 2404 | `enhanceHintFor` | fun | port | `src/core/comic/comicReaderCore.ts:945` |  |

## com/example/ui/comic/ComicReaderSheets.kt (2128 行, 28 声明)

iOS 归属：`src/core/comic/comicReaderSheets.ts` / `src/ui/components/comic/sheets/index.ts` / `src/ui/components/comic/sheets/ComicSettingsSheet.tsx` / `src/ui/components/comic/sheets/ComicSettingsPageTab.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 180 | `AccentColor` | val | port | `src/core/comic/comicReaderSheets.ts:5` |  |
| 187 | `SettingsTabs` | val | port | `src/core/comic/comicReaderSheets.ts:5` |  |
| 198 | `ComicSettingsSheet` | fun | port | `src/ui/components/comic/sheets/ComicSettingsSheet.tsx:114` |  |
| 356 | `TranslationTab` | fun | port | `src/ui/components/comic/sheets/index.ts:15` |  |
| 645 | `ModeTab` | fun | port | `src/ui/components/comic/sheets/index.ts:18` |  |
| 691 | `ModeGrid` | fun | port | `src/core/comic/comicReaderSheets.ts:10` |  |
| 731 | `DirectionGrid` | fun | port | `src/core/comic/comicReaderSheets.ts:10` |  |
| 766 | `FitOptions` | val | port | `src/core/comic/comicReaderSheets.ts:11` |  |
| 776 | `fitLabel` | fun | port | `src/core/comic/comicReaderSheets.ts:300` |  |
| 780 | `PageTab` | fun | port | `src/ui/components/comic/sheets/ComicSettingsPageTab.tsx:77` |  |
| 935 | `ImageTab` | fun | port | `src/ui/components/comic/sheets/index.ts:24` |  |
| 1111 | `ActionChip` | fun | port | `src/ui/components/Chips.tsx:87` |  |
| 1125 | `FilterPreview` | fun | port | `src/core/comic/comicReaderSheets.ts:35` |  |
| 1198 | `BgSwatchRow` | fun | port | `src/core/comic/comicReaderSheets.ts:16` |  |
| 1265 | `SceneOptionFlow` | fun | port | `src/core/comic/comicReaderSheets.ts:17` |  |
| 1321 | `EngineCard` | fun | port | `src/ui/components/comic/sheets/comicSheetParts.tsx:262` |  |
| 1365 | `PanelRow` | fun | port | `src/ui/components/comic/sheets/comicSheetParts.tsx:296` |  |
| 1382 | `PanelTextField` | fun | port | `src/ui/components/comic/sheets/comicSheetParts.tsx:310` |  |
| 1413 | `EffectTab` | fun | port | `src/ui/components/comic/sheets/index.ts:27` |  |
| 1453 | `AutoTab` | fun | port | `src/ui/components/comic/sheets/index.ts:30` |  |
| 1473 | `GestureTab` | fun | port | `src/ui/components/comic/sheets/index.ts:33` |  |
| 1499 | `ComicTocSheet` | fun | port | `src/ui/components/comic/sheets/index.ts:36` |  |
| 1569 | `PageThumbCell` | fun | port | `src/core/comic/comicReaderSheets.ts:37` |  |
| 1615 | `ComicPresetSheet` | fun | port | `src/ui/components/comic/sheets/index.ts:39` |  |
| 1855 | `PresetNameDialog` | fun | port | `src/ui/components/comic/sheets/index.ts:42` |  |
| 1890 | `ComicCropSheet` | fun | port | `src/ui/components/comic/sheets/index.ts:44` |  |
| 1979 | `BoxWithImageLayout` | fun | port | `src/core/comic/comicReaderSheets.ts:40` |  |
| 2020 | `CropCanvas` | fun | port | `src/core/comic/comicReaderSheets.ts:21` |  |

## com/example/ui/comic/ComicSceneEngine.kt (274 行, 1 声明)

iOS 归属：`src/core/comic/comicSceneEngine.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 34 | `ComicAmbientAudio` | type | port | `src/core/comic/comicSceneEngine.ts:297` |  |

## com/example/ui/comic/ComicSceneFx.kt (629 行, 17 声明)

iOS 归属：`src/core/comic/comicSceneFx.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 57 | `FxParticle` | type | port | `src/core/comic/comicSceneFx.ts:198` |  |
| 73 | `FxRipple` | type | port | `src/core/comic/comicSceneFx.ts:212` |  |
| 76 | `WAVE_LAYERS` | val | port | `src/core/comic/comicSceneFx.ts:248` |  |
| 77 | `WAVE_BASE_FREQ` | val | port | `src/core/comic/comicSceneFx.ts:249` |  |
| 78 | `WAVE_FREQ_RAMP` | val | port | `src/core/comic/comicSceneFx.ts:250` |  |
| 79 | `WAVE_AMPL_FALL_OFF` | val | port | `src/core/comic/comicSceneFx.ts:251` |  |
| 80 | `WAVE_PHASE_RAMP` | val | port | `src/core/comic/comicSceneFx.ts:252` |  |
| 81 | `WAVE_PHASE_SPEED` | val | port | `src/core/comic/comicSceneFx.ts:253` |  |
| 82 | `WAVE_SECONDARY_RATIO` | val | port | `src/core/comic/comicSceneFx.ts:254` |  |
| 83 | `WAVE_SECONDARY_AMP` | val | port | `src/core/comic/comicSceneFx.ts:255` |  |
| 84 | `WaveFront` | val | port | `src/core/comic/comicSceneFx.ts:256` | 改名：WaveFront → WAVE_FRONT |
| 85 | `WaveBack` | val | port | `src/core/comic/comicSceneFx.ts:257` | 改名：WaveBack → WAVE_BACK |
| 87 | `waveY` | fun | port | `src/core/comic/comicSceneFx.ts:259` |  |
| 94 | `sakuraSwayDeg` | fun | port | `src/core/comic/comicSceneFx.ts:274` |  |
| 101 | `sakuraPetalShapes` | val | port | `src/core/comic/comicSceneFx.ts:17` |  |
| 113 | `ComicSceneEffectOverlay` | fun | port | `src/core/comic/comicSceneFx.ts:20` |  |
| 145 | `ComicSceneFxEngine` | type | port | `src/core/comic/comicSceneFx.ts:345` |  |

## com/example/ui/comic/ComicScrollMetrics.kt (90 行, 4 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/comic/comicScrollMetrics.ts` / `src/core/comic/comicReaderCore.ts` / `src/ui/components/comic/comicScrollMetrics.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `ComicScrollMetrics` | type | port | `src/core/comic/comicScrollMetrics.ts:97` |  |
| 59 | `ComicScrollGeometry` | type | port | `src/core/comic/comicScrollMetrics.ts:64` |  |
| 73 | `ComicScrollGeometryCache` | type | port | `src/core/comic/comicScrollMetrics.ts:223` |  |
| 90 | `ComicScrollTarget` | type | port | `src/core/comic/comicReaderCore.ts:904` |  |

## com/example/ui/comic/ComicSettingsStore.kt (347 行, 7 声明)

iOS 归属：`src/core/comic/comicSettingsStore.ts` / `src/ui/pages/ComicReaderPage.tsx` / `src/ui/components/comic/comicReaderChrome.tsx` / `src/core/comic/comicReaderConfig.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 19 | `ComicSettingsStore` | type | port | `src/core/comic/comicSettingsStore.ts:421` |  |
| 290 | `ComicPreset` | type | port | `src/core/comic/comicSettingsStore.ts:192` |  |
| 321 | `ComicCustomFitPreset` | type | port | `src/core/comic/comicSettingsStore.ts:234` |  |
| 344 | `KEY_GLOBAL_CONFIG` | val | port | `src/core/comic/comicSettingsStore.ts:129` |  |
| 345 | `KEY_PRESETS` | val | port | `src/core/comic/comicSettingsStore.ts:131` |  |
| 346 | `KEY_DEFAULT_PRESET` | val | port | `src/core/comic/comicSettingsStore.ts:133` |  |
| 347 | `KEY_CUSTOM_FIT_PRESETS` | val | port | `src/core/comic/comicSettingsStore.ts:135` |  |

## com/example/ui/comic/ComicStreamPreview.kt (115 行, 2 声明)

iOS 归属：`src/ui/components/comic/comicStreamPreview.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 17 | `ComicStreamPreview` | type | port | `src/ui/components/comic/comicStreamPreview.tsx:185` |  |
| 77 | `completeProgressiveScan` | fun | port | `src/ui/components/comic/comicStreamPreview.tsx:278` |  |

## com/example/ui/comic/ComicTurnGesture.kt (27 行, 3 声明)

iOS 归属：`src/core/comic/comicTurnGesture.ts` / `src/ui/pages/ComicReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `comicPagerThreshold` | fun | port | `src/core/comic/comicTurnGesture.ts:8` |  |
| 16 | `comicTurnTravel` | fun | port | `src/core/comic/comicTurnGesture.ts:49` |  |
| 19 | `comicTurnIntent` | fun | port | `src/core/comic/comicTurnGesture.ts:63` |  |

## com/example/ui/comic/ComicZoomGesture.kt (848 行, 6 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/pages/ComicReaderPage.tsx` / `src/core/comic/comicZoomGesture.ts` / `src/core/comic/comicReaderCore.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 58 | `ComicZoomState` | type | port | `src/core/comic/comicZoomGesture.ts:207` |  |
| 347 | `limitScaleWithRubberBand` | fun | port | `src/core/comic/comicZoomGesture.ts:577` |  |
| 368 | `ComicGestureCallbacks` | type | port | `src/core/comic/comicReaderCore.ts:954` |  |
| 390 | `comicZoomable` | fun | port | `src/core/comic/comicReaderCore.ts:1235` |  |
| 745 | `comicEdgeSwipe` | fun | port | `src/core/comic/comicReaderCore.ts:1235` |  |
| 784 | `comicVerticalGestures` | fun | port | `src/core/ui/parityMisc.ts:367` |  |

## com/example/ui/comic/MangaJaNai.kt (261 行, 2 声明)

iOS 归属：`src/core/comic/mangaJaNai.ts` / `src/core/comic/mangaJaNaiFull.ts` / `src/core/comic/mangaJaNaiRuntime.ts` / `src/core/comic/mangaJaNaiMobile.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `MangaJaNaiBudgetExceeded` | type | port | `src/core/comic/mangaJaNai.ts:9` |  |
| 28 | `MangaJaNai` | type | port | `src/core/comic/mangaJaNai.ts:966` |  |

## com/example/ui/comic/MangaJaNaiFull.kt (246 行, 1 声明)

iOS 归属：`src/core/comic/mangaJaNaiFullRuntime.ts` / `src/core/comic/mangaJaNaiFull.ts` / `src/core/comic/mangaJaNai.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `MangaJaNaiFull` | type | port | `src/core/comic/mangaJaNaiFull.ts:675` |  |

## com/example/ui/comic/MangaJaNaiFullRuntime.kt (155 行, 1 声明)

iOS 归属：`src/core/comic/mangaJaNaiFull.ts` / `src/core/comic/mangaJaNaiFullRuntime.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `MangaJaNaiFullRuntime` | type | port | `src/core/comic/mangaJaNaiFullRuntime.ts:188` |  |

## com/example/ui/comic/MangaJaNaiGpu.kt (12 行, 1 声明)

iOS 归属：`src/core/comic/mangaJaNaiFullRuntime.ts` / `src/core/comic/mangaJaNai.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `MangaJaNaiGpu` | type | port | `src/core/comic/mangaJaNai.ts:42` |  |

## com/example/ui/comic/MangaJaNaiMobile.kt (74 行, 2 声明)

iOS 归属：`src/core/comic/mangaJaNaiMobile.ts` / `src/core/comic/mangaJaNai.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `mangaMobileInputSize` | fun | port | `src/core/comic/mangaJaNaiMobile.ts:61` |  |
| 28 | `combineMangaJaNaiDetail` | fun | port | `src/core/comic/mangaJaNaiMobile.ts:183` |  |

## com/example/ui/comic/MangaJaNaiRuntime.kt (183 行, 1 声明)

iOS 归属：`src/core/comic/mangaJaNaiRuntime.ts` / `src/core/comic/mangaJaNai.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 16 | `MangaJaNaiRuntime` | type | port | `src/core/comic/mangaJaNaiRuntime.ts:238` |  |

## com/example/ui/comic/MangaJaNaiTiles.kt (63 行, 2 声明)

iOS 归属：`src/core/comic/mangaJaNai.ts` / `src/core/comic/mangaJaNaiTiles.ts` / `src/core/comic/mangaJaNaiFull.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `MangaJaNaiTileCache` | type | port | `src/core/comic/mangaJaNaiTiles.ts:66` |  |
| 42 | `readMangaJaNaiTile` | fun | port | `src/core/comic/mangaJaNaiTiles.ts:138` |  |

## com/example/ui/components/AcrylicDialog.kt (201 行, 5 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/components/AcrylicDialog.tsx` / `src/ui/components/ReleaseHistoryDialog.tsx` / `src/ui/components/discover/DiscoverSettings.tsx` / `src/ui/shared/pullOutHosts.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 36 | `LocalOverlayClose` | val | port | `src/ui/components/PullOut.tsx:359` |  |
| 39 | `overlayDismiss` | fun | port | `src/core/ui/parityMisc.ts:375` |  |
| 45 | `acrylicPanel` | fun | port | `src/ui/components/AcrylicDialog.tsx:19` |  |
| 80 | `AcrylicDialog` | fun | port | `src/ui/components/AcrylicDialog.tsx:138` |  |
| 150 | `AcrylicBottomOverlay` | fun | port | `src/ui/components/AcrylicDialog.tsx:276` |  |

## com/example/ui/components/AppBottomTabBar.kt (541 行, 8 声明)

iOS 归属：`src/core/components/tabBar.ts` / `src/ui/shell/TabShell.tsx` / `src/App.tsx` / `src/core/app/navigation.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 90 | `AppTabItem` | type | port | `src/core/app/navigation.ts:241` |  |
| 101 | `TabBarCollapseState` | type | port | `src/core/components/tabBar.ts:62` |  |
| 117 | `rememberTabBarCollapseState` | fun | port | `src/core/components/tabBar.ts:97` |  |
| 133 | `AppBottomTabBar` | fun | port | `src/ui/components/AppBottomTabBar.tsx:98` |  |
| 377 | `AppRailWidth` | val | port | `src/core/components/tabBar.ts:132` |  |
| 381 | `AppNavigationRail` | fun | port | `src/core/components/tabBar.ts:16` |  |
| 417 | `DockTab` | fun | port | `src/core/components/tabBar.ts:20` |  |
| 541 | `roundToIntCompat` | fun | port | `src/core/components/tabBar.ts:160` |  |

## com/example/ui/components/AppButton.kt (415 行, 7 声明)

iOS 归属：`src/core/components/appButtonStyle.ts` / `src/ui/components/AppButton.tsx` / `src/ui/components/GradientActionButton.tsx` / `src/ui/components/discover/DiscoverSettings.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 81 | `AppButtonVariant` | type | port | `src/core/components/appButtonStyle.ts:41` |  |
| 88 | `AppButtonSize` | type | port | `src/core/components/appButtonStyle.ts:33` |  |
| 99 | `AppButtonColors` | type | port | `src/core/components/appButtonStyle.ts:44` |  |
| 107 | `LocalAppButtonColors` | val | port | `src/core/components/appButtonStyle.ts:9` |  |
| 111 | `rememberAppButtonColors` | fun | port | `src/core/components/appButtonStyle.ts:10` |  |
| 127 | `AppActionButton` | fun | port | `src/ui/components/AppButton.tsx:53` |  |
| 401 | `primaryGlassStyle` | fun | port | `src/core/components/appButtonStyle.ts:11` |  |

## com/example/ui/components/AppErrorSnackbar.kt (167 行, 1 声明)

iOS 归属：`src/ui/components/AppErrorSnackbar.tsx` / `src/ui/toast.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 35 | `AppErrorSnackbar` | fun | port | `src/ui/components/AppErrorSnackbar.tsx:65` |  |

## com/example/ui/components/AppProgressIndicator.kt (65 行, 3 声明)

iOS 归属：`src/ui/components/AppProgressIndicator.tsx` / `src/core/glass/motion.ts` / `src/core/glass/skeletonProgress.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 28 | `rememberProgressPhase` | fun | port | `src/core/glass/skeletonProgress.ts:20` |  |
| 33 | `drawAppProgressRing` | fun | port | `src/core/glass/motion.ts:329` |  |
| 44 | `AppProgressIndicator` | fun | port | `src/ui/components/AppProgressIndicator.tsx:66` |  |

## com/example/ui/components/AppSnackbar.kt (169 行, 4 声明)

iOS 归属：`src/ui/components/AppSnackbar.tsx` / `src/ui/shell/SnackbarHost.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 50 | `AppSnackKind` | type | port | `src/ui/components/AppSnackbar.tsx:24` |  |
| 56 | `AppSnackbarVisuals` | type | port | `src/ui/components/AppSnackbar.tsx:33` |  |
| 65 | `showAppSnackbar` | fun | port | `src/ui/components/AppSnackbar.tsx:59` |  |
| 87 | `AppToastSnackbar` | fun | port | `src/ui/components/AppSnackbar.tsx:128` |  |

## com/example/ui/components/AppSwitch.kt (59 行, 1 声明)

iOS 归属：`src/ui/pages/SettingsPage.tsx` / `src/ui/components/privacy/PrivacyWindows.tsx` / `src/ui/components/AppSwitch.tsx` / `src/ui/components/god/GodSettingsSection.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `AppSwitch` | fun | port | `src/ui/components/AppSwitch.tsx:63` |  |

## com/example/ui/components/AppToast.kt (117 行, 3 声明)

iOS 归属：`src/ui/components/AppToast.tsx` / `src/ui/components/AppErrorSnackbar.tsx` / `src/ui/pages/SettingsPage.tsx` / `src/core/cache/cacheManagement.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 33 | `AppToast` | type | port | `src/ui/components/AppToast.tsx:40` |  |
| 97 | `AppToastMessage` | type | port | `src/ui/components/AppToast.tsx:9` |  |
| 112 | `BindAppToastHost` | fun | port | `src/ui/components/AppToast.tsx:55` |  |

## com/example/ui/components/CardDentEffect.kt (50 行, 3 声明)

iOS 归属：`src/core/components/cardDent.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `CardDentEffect` | type | port | `src/core/components/cardDent.ts:31` |  |
| 15 | `createCardDentEffect` | fun | port | `src/core/components/cardDent.ts:48` |  |
| 24 | `CardDentApi33` | type | port | `src/core/components/cardDent.ts:11` |  |

## com/example/ui/components/CardTweaks.kt (55 行, 4 声明)

iOS 归属：`src/ui/pages/CardAppearancePage.tsx` / `src/core/glass/cardTweaks.ts` / `src/ui/components/CardTweaks.tsx` / `src/ui/pages/SettingsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `CardTweaks` | type | port | `src/core/glass/cardTweaks.ts:17` |  |
| 29 | `LocalCardTweaks` | val | port | `src/core/glass/cardTweaks.ts:6` |  |
| 32 | `readCardTweaks` | fun | port | `src/core/glass/cardTweaks.ts:10` |  |
| 45 | `writeCardTweaks` | fun | port | `src/ui/lib/cardTweaksPersistence.ts:10` |  |

## com/example/ui/components/CatalogCoverMotion.kt (23 行, 1 声明)

iOS 归属：`src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `catalogCoverMotion` | fun | port | `src/core/ui/parityMisc.ts:380` |  |

## com/example/ui/components/ChasingDots.kt (22 行, 1 声明)

iOS 归属：`src/ui/pages/LibraryPage.tsx` / `src/ui/components/comic/comicReaderChrome.tsx` / `src/core/glass/chasingDots.ts` / `src/ui/pages/NovelReaderOnlinePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `ChasingDots` | fun | port | `src/ui/components/ChasingDots.tsx:54` |  |

## com/example/ui/components/ColorMorph.kt (192 行, 2 声明)

iOS 归属：`src/ui/components/ColorMorph.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 51 | `ColorStateMorph` | fun | port | `src/ui/components/ColorMorph.tsx:110` |  |
| 124 | `ColorMorphSwatch` | fun | port | `src/ui/components/ColorMorph.tsx:191` |  |

## com/example/ui/components/CompletionGlyph.kt (32 行, 1 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/glass/skeletonProgress.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 16 | `CompletionGlyph` | fun | port | `src/core/ui/parityMisc.ts:393` |  |

## com/example/ui/components/CustomButtons.kt (135 行, 2 声明)

iOS 归属：`src/ui/pages/SettingsPage.tsx` / `src/ui/pages/DeviceTransferPage.tsx` / `src/ui/components/reader/TouchZoneEditor.tsx` / `src/ui/components/source/ZLibraryNodeManagementScreen.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 42 | `AppIconButton` | fun | port | `src/ui/components/CustomButtons.tsx:36` |  |
| 107 | `AppButton` | fun | port | `src/ui/components/AppButton.tsx:44` |  |

## com/example/ui/components/GlassCard.kt (1002 行, 12 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/components/GlassCard.tsx` / `src/ui/components/GlassCardLayers.tsx` / `src/ui/pages/SettingsPage.tsx` / `src/ui/pages/DeviceTransferPage.tsx` / `src/ui/components/privacy/PrivacyWindows.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 64 | `GlassDecoKey` | type | port | `src/ui/components/GlassCardLayers.tsx:68` |  |
| 80 | `ScaledCornerSize` | type | port | `src/ui/components/GlassCardLayers.tsx:17` |  |
| 94 | `buildIndentUnitPath` | fun | port | `src/ui/components/GlassCardLayers.tsx:108` |  |
| 131 | `PI_F` | val | port | `src/ui/components/GlassCardLayers.tsx:56` |  |
| 134 | `LIGHT_DIR_X` | val | port | `src/core/components/cardDent.ts:26` |  |
| 135 | `LIGHT_DIR_Y` | val | port | `src/core/components/cardDent.ts:28` |  |
| 138 | `DENT_AMBIENT` | val | port | `src/ui/components/GlassCardLayers.tsx:65` |  |
| 146 | `DENT_LIGHT_AGLS` | val | port | `src/ui/components/GlassCardLayers.tsx:46` |  |
| 194 | `scaledCardCorners` | fun | port | `src/core/ui/parityMisc.ts:401` |  |
| 204 | `rescaleCorners` | fun | port | `src/ui/components/GlassCardLayers.tsx:22` |  |
| 210 | `glassDecoKey` | fun | port | `src/ui/components/GlassCardLayers.tsx:82` |  |
| 261 | `GlassCard` | fun | port | `src/ui/components/GlassCard.tsx:56` |  |

## com/example/ui/components/GlassQuality.kt (39 行, 2 声明)

iOS 归属：`src/core/glass/renderQuality.ts` / `src/ui/components/GlassCard.tsx` / `src/ui/components/GlassQuality.tsx` / `src/ui/pages/CardAppearancePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 17 | `RenderQuality` | type | port | `src/core/glass/renderQuality.ts:25` |  |
| 39 | `LocalRenderQuality` | val | port | `src/core/glass/renderQuality.ts:7` |  |

## com/example/ui/components/GradientActionButton.kt (34 行, 1 声明)

iOS 归属：`src/ui/components/GradientActionButton.tsx` / `src/ui/components/AppButton.tsx` / `src/ui/components/favorite/ComicDetailActions.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `GradientActionButton` | fun | port | `src/ui/components/GradientActionButton.tsx:22` |  |

## com/example/ui/components/HazeProgress.kt (76 行, 1 声明)

iOS 归属：`src/ui/components/HazeProgress.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `FlowingGradientProgressBar` | fun | port | `src/ui/components/HazeProgress.tsx:31` |  |

## com/example/ui/components/LiquidBlob.kt (68 行, 1 声明)

iOS 归属：`src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `drawLiquidBlob` | fun | port | `src/core/ui/parityMisc.ts:408` |  |

## com/example/ui/components/LiquidGlass.kt (429 行, 20 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/glass/liquidGlass.ts` / `src/ui/components/AcrylicDialog.tsx` / `src/ui/components/LiquidGlass.tsx` / `src/ui/components/glasskit/GlassKit.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 50 | `LocalGlassBackdrop` | val | port | `src/core/glass/liquidGlass.ts:6` |  |
| 63 | `supportsRealtimeBlur` | val | port | `src/core/glass/liquidGlass.ts:72` |  |
| 67 | `GLASS_FALLBACK_ALPHA_BOOST` | val | port | `src/core/glass/liquidGlass.ts:58` |  |
| 74 | `frostedGlassFallback` | fun | port | `src/core/glass/liquidGlass.ts:9` |  |
| 110 | `LocalPreBlurredGlass` | val | port | `src/core/glass/liquidGlass.ts:10` |  |
| 125 | `rememberScreenGlassBackdrop` | fun | port | `src/core/ui/parityMisc.ts:417` |  |
| 132 | `rememberThemedGlassBackdrop` | fun | port | `src/core/glass/liquidGlass.ts:244` |  |
| 147 | `rememberGlassPanelBackdrop` | fun | port | `src/core/glass/liquidGlass.ts:268` |  |
| 168 | `liquidGlass` | fun | port | `src/core/glass/liquidGlass.ts:14` |  |
| 219 | `themeGradient` | fun | port | `src/core/ui/parityMisc.ts:418` |  |
| 236 | `rememberGlassFxChain` | fun | port | `src/core/glass/liquidGlass.ts:16` |  |
| 254 | `liquidGlassStatic` | fun | port | `src/core/glass/liquidGlass.ts:17` |  |
| 286 | `grainBitmap` | val | port | `src/core/ui/parityMisc.ts:422` |  |
| 288 | `createGrainBitmap` | fun | port | `src/core/glass/liquidGlass.ts:283` |  |
| 301 | `filmGrain` | fun | port | `src/core/glass/liquidGlass.ts:18` |  |
| 319 | `iridescentBorder` | fun | port | `src/core/glass/liquidGlass.ts:20` |  |
| 351 | `crystalInnerBevel` | fun | port | `src/core/glass/liquidGlass.ts:21` |  |
| 384 | `radialGlassScrim` | fun | port | `src/core/glass/liquidGlass.ts:22` |  |
| 398 | `rememberIridescentColors` | fun | port | `src/core/glass/liquidGlass.ts:23` |  |
| 416 | `rememberCrystalPrismColors` | fun | port | `src/core/glass/liquidGlass.ts:24` |  |

## com/example/ui/components/LiquidGlassControls.kt (89 行, 4 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/ui/liquidGlassControls.ts` / `src/ui/components/LiquidGlassControls.tsx` / `src/ui/pages/SettingsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 29 | `LocalLiquidGlassState` | val | port | `src/core/ui/liquidGlassControls.ts:7` |  |
| 31 | `LocalGlassWindowOwner` | val | port | `src/core/ui/liquidGlassControls.ts:10` |  |
| 39 | `DialogLiquidGlass` | fun | port | `src/ui/components/LiquidGlassControls.tsx:71` |  |
| 73 | `AppLiquidButton` | fun | port | `src/ui/components/LiquidGlassControls.tsx:145` |  |

## com/example/ui/components/LiquidSegmentPhysics.kt (128 行, 1 声明)

iOS 归属：`src/core/glass/liquidSegmentPhysics.ts` / `src/ui/components/LiquidSegmentedSelector.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 11 | `LiquidSegmentPhysics` | type | port | `src/core/glass/liquidSegmentPhysics.ts:51` |  |

## com/example/ui/components/LiquidSegmentShader.kt (103 行, 1 声明)

iOS 归属：`src/core/glass/liquidSegmentShader.ts` / `src/ui/components/LiquidSegmentedSelector.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 4 | `LIQUID_SEGMENT_SHADER` | val | port | `src/core/glass/liquidSegmentShader.ts:18` |  |

## com/example/ui/components/LiquidSegmentView.kt (332 行, 1 声明)

iOS 归属：`src/ui/components/LiquidSegmentedSelector.tsx` / `src/core/app/homeRenderRecovery.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `LiquidSegmentView` | type | port | `src/ui/components/LiquidSegmentedSelector.tsx:226` |  |

## com/example/ui/components/LiquidSegmentedSelector.kt (157 行, 2 声明)

iOS 归属：`src/ui/components/LiquidSegmentedSelector.tsx` / `src/ui/components/shelf/ShelfSearch.tsx` / `src/ui/components/OrdinaryControls.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 49 | `LiquidSegmentOption` | type | port | `src/ui/components/LiquidSegmentedSelector.tsx:44` |  |
| 53 | `LiquidSegmentedSelector` | fun | port | `src/ui/components/LiquidSegmentedSelector.tsx:592` |  |

## com/example/ui/components/LiquidSlider.kt (494 行, 4 声明)

iOS 归属：`src/core/glass/liquidSliderConfig.ts` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/ui/components/OrdinaryControls.tsx` / `src/core/app/homeRenderRecovery.ts` / `src/core/components/fluidSlider.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `LiquidSliderConfig` | type | port | `src/core/glass/liquidSliderConfig.ts:10` |  |
| 47 | `LiquidSlider` | fun | port | `src/core/app/homeRenderRecovery.ts:144` |  |
| 113 | `Slider` | fun | port | `src/ui/components/OrdinaryControls.tsx:24` |  |
| 121 | `LiquidSliderView` | type | port | `src/core/app/homeRenderRecovery.ts:144` |  |

## com/example/ui/components/MascotEmptyState.kt (211 行, 1 声明)

iOS 归属：`src/ui/pages/LibraryPage.tsx` / `src/core/home/homeViewModel.ts` / `src/ui/pages/StatisticsPage.tsx` / `src/ui/components/favorite/FavoritesPanel.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 30 | `MascotEmptyState` | fun | port | `src/ui/components/MascotEmptyState.tsx:55` |  |

## com/example/ui/components/MaxCardEffects.kt (151 行, 4 声明)

iOS 归属：`src/core/glass/maxFx.ts` / `src/ui/components/MaxCardEffects.tsx` / `src/ui/components/MaxFx.tsx` / `src/ui/components/GlassCard.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 40 | `chromaFlowEdge` | fun | port | `src/core/glass/maxFx.ts:11` |  |
| 94 | `SHIMMER_PEARL_COLORS` | val | port | `src/core/glass/maxFx.ts:245` |  |
| 104 | `shimmerPearl` | fun | port | `src/core/glass/maxFx.ts:12` |  |
| 138 | `addRoundRect` | fun | port | `src/core/glass/maxFx.ts:288` |  |

## com/example/ui/components/MaxFx.kt (198 行, 8 声明)

iOS 归属：`src/core/glass/maxFx.ts` / `src/ui/components/MaxFx.tsx` / `src/core/library/libraryDisplay.ts` / `src/ui/components/GlassCard.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 35 | `GLASS_SHEEN_COLORS` | val | port | `src/core/glass/maxFx.ts:71` |  |
| 47 | `glassSheen` | fun | port | `src/core/glass/maxFx.ts:8` |  |
| 90 | `AURA_INSET_DP` | val | port | `src/core/glass/maxFx.ts:135` |  |
| 93 | `AURA_WIDTH_DP` | val | port | `src/core/glass/maxFx.ts:137` |  |
| 96 | `AURA_ALPHA_MIN` | val | port | `src/core/glass/maxFx.ts:139` |  |
| 99 | `AURA_ALPHA_MAX` | val | port | `src/core/glass/maxFx.ts:141` |  |
| 135 | `maxCardAura` | fun | port | `src/core/glass/maxFx.ts:10` |  |
| 192 | `lerpColor` | fun | port | `src/core/glass/color.ts:95` |  |

## com/example/ui/components/OrdinaryControls.kt (79 行, 2 声明)

iOS 归属：`src/ui/components/OrdinaryControls.tsx` / `src/ui/components/LiquidSegmentedSelector.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `OrdinarySlider` | fun | port | `src/ui/components/OrdinaryControls.tsx:63` |  |
| 65 | `OrdinarySegmentedSelector` | fun | port | `src/ui/components/OrdinaryControls.tsx:174` |  |

## com/example/ui/components/OverlayAnimations.kt (86 行, 5 声明)

iOS 归属：`src/ui/components/OverlayAnimations.tsx` / `src/ui/components/privacy/PrivacyWindows.tsx` / `src/core/ui/overlayEntrance.ts` / `src/ui/components/AcrylicDialog.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `DialogEntrance` | fun | port | `src/ui/components/OverlayAnimations.tsx:94` |  |
| 21 | `BottomSheetEntrance` | fun | port | `src/ui/components/OverlayAnimations.tsx:118` |  |
| 27 | `OverlayEntrance` | fun | port | `src/core/ui/overlayEntrance.ts:15` |  |
| 62 | `ScrimEntrance` | fun | port | `src/ui/components/OverlayAnimations.tsx:155` |  |
| 81 | `PullOutScrim` | fun | port | `src/ui/components/OverlayAnimations.tsx:203` |  |

## com/example/ui/components/OverlayTouchShield.kt (17 行, 1 声明)

iOS 归属：`src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `overlayTouchShield` | fun | port | `src/core/ui/parityMisc.ts:430` |  |

## com/example/ui/components/PlayPauseMorph.kt (83 行, 3 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/components/PlayPauseMorph.tsx` / `src/core/glass/skeletonProgress.ts` / `src/ui/pages/ComicChaptersPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 33 | `PlayPauseMorph` | fun | port | `src/ui/components/PlayPauseMorph.tsx:32` |  |
| 39 | `PlayPauseGlyph` | fun | port | `src/core/ui/parityMisc.ts:435` |  |
| 68 | `PlayPauseMorphButton` | fun | port | `src/ui/components/PlayPauseMorph.tsx:149` |  |

## com/example/ui/components/ProducedState.kt (35 行, 2 声明)

iOS 归属：`src/ui/components/useProducedState.ts` / `src/core/glass/skeletonProgress.ts` / `src/ui/components/source/ZLibraryLoginDialog.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `rememberAsyncState` | fun | port | `src/core/glass/skeletonProgress.ts:38` |  |
| 27 | `rememberKeyedAsyncState` | fun | port | `src/core/glass/skeletonProgress.ts:39` |  |

## com/example/ui/components/PullOutButtons.kt (132 行, 7 声明)

iOS 归属：`src/ui/components/PullOut.tsx` / `src/ui/components/discover/DiscoverSettings.tsx` / `src/ui/components/reader/TouchZoneEditor.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 28 | `rememberPressScale` | fun | port | `src/ui/components/PullOut.tsx:25` |  |
| 44 | `PullOutButton` | fun | port | `src/ui/components/PullOut.tsx:301` |  |
| 54 | `PullOutTextButton` | fun | port | `src/ui/components/PullOut.tsx:459` |  |
| 64 | `PullOutOutlinedButton` | fun | port | `src/ui/components/PullOut.tsx:310` |  |
| 74 | `PullOutFilledTonalButton` | fun | port | `src/ui/components/PullOut.tsx:319` |  |
| 84 | `PullOutIconButton` | fun | port | `src/ui/components/PullOut.tsx:476` |  |
| 121 | `PullOutDropdownMenuItem` | fun | port | `src/ui/components/PullOut.tsx:328` |  |

## com/example/ui/components/PullOutHosts.kt (436 行, 32 声明)

iOS 归属：`src/core/components/pullOut.ts` / `src/ui/components/PullOut.tsx` / `src/ui/shared/pullOutHosts.ts` / `src/core/app/navigation.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 45 | `rememberPaperClose` | fun | port | `src/ui/components/PullOut.tsx:400` |  |
| 88 | `rememberPaperHandoff` | fun | port | `src/ui/components/PullOut.tsx:416` |  |
| 115 | `LocalPaperHandoff` | val | port | `src/ui/components/PullOut.tsx:371` |  |
| 117 | `paperOpen` | fun | port | `src/ui/components/PullOut.tsx:419` |  |
| 121 | `PaperOpenAction` | type | port | `src/ui/shared/pullOutHosts.ts:470` |  |
| 128 | `openPaperPage` | fun | port | `src/ui/components/PullOut.tsx:429` |  |
| 133 | `replacePaperPage` | fun | port | `src/ui/components/PullOut.tsx:434` |  |
| 146 | `paperPageOrigins` | val | port | `src/core/components/pullOut.ts:29` |  |
| 147 | `paperPageClosers` | val | port | `src/core/components/pullOut.ts:29` |  |
| 148 | `dismissPaperPage` | fun | port | `src/core/components/pullOut.ts:630` |  |
| 152 | `pageEase` | val | port | `src/core/app/navigation.ts:58` |  |
| 153 | `paperPageEnter` | fun | port | `src/core/components/pullOut.ts:609` |  |
| 159 | `paperPageExit` | fun | port | `src/core/components/pullOut.ts:614` |  |
| 165 | `paperPagePopEnter` | fun | port | `src/core/components/pullOut.ts:619` |  |
| 171 | `paperPagePopExit` | fun | port | `src/core/components/pullOut.ts:624` |  |
| 178 | `paperComposable` | fun | port | `src/ui/components/PullOut.tsx:439` |  |
| 191 | `PullOutPageContent` | fun | port | `src/ui/components/PullOut.tsx:108` |  |
| 218 | `PaperPageBackground` | fun | port | `src/ui/components/PullOut.tsx:130` |  |
| 237 | `WindowPaperFinalizer` | fun | port | `src/ui/components/PullOut.tsx:456` |  |
| 252 | `PullOutDialog` | fun | port | `src/ui/components/PullOut.tsx:157` |  |
| 266 | `DisablePlatformWindowMotion` | fun | port | `src/ui/components/PullOut.tsx:147` |  |
| 300 | `PullOutBottomSheet` | fun | port | `src/ui/components/PullOut.tsx:173` |  |
| 325 | `PullOutAlertDialog` | fun | port | `src/ui/components/PullOut.tsx:193` |  |
| 346 | `PullOutDropdownMenu` | fun | port | `src/ui/components/PullOut.tsx:218` |  |
| 392 | `LocalPaperButtonAction` | val | port | `src/ui/components/PullOut.tsx:374` |  |
| 393 | `LocalPaperVisibility` | val | port | `src/ui/components/PullOut.tsx:377` |  |
| 394 | `LocalPaperVisibleTarget` | val | port | `src/ui/components/PullOut.tsx:380` |  |
| 395 | `LocalPaperSheetDrag` | val | port | `src/ui/components/PullOut.tsx:383` |  |
| 399 | `paperSheetDragHandle` | fun | port | `src/core/components/pullOut.ts:690` |  |
| 403 | `PullOutInlineOverlay` | fun | port | `src/ui/components/PullOut.tsx:234` |  |
| 416 | `paperClick` | fun | port | `src/core/components/pullOut.ts:679` |  |
| 433 | `paperDismiss` | fun | port | `src/core/components/pullOut.ts:684` |  |

## com/example/ui/components/PullOutMotion.kt (310 行, 21 声明)

iOS 归属：`src/core/components/pullOut.ts` / `src/ui/components/PullOut.tsx` / `src/ui/shared/pullOutHosts.ts` / `src/ui/reader/touchZoneGestures.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `PullOutConfig` | type | port | `src/core/components/pullOut.ts:45` |  |
| 61 | `PullOutSource` | type | port | `src/core/components/pullOut.ts:666` |  |
| 86 | `PullOutSources` | type | port | `src/core/components/pullOut.ts:643` |  |
| 93 | `LocalPaperOrigin` | val | port | `src/ui/components/PullOut.tsx:62` |  |
| 94 | `LocalPaperOwner` | val | port | `src/ui/components/PullOut.tsx:64` |  |
| 96 | `LocalPaperBackdropOwner` | val | port | `src/ui/components/PullOut.tsx:66` |  |
| 97 | `paperBackdropProgress` | fun | port | `src/core/components/pullOut.ts:102` |  |
| 101 | `LocalPaperFullSurface` | val | port | `src/ui/components/PullOut.tsx:68` |  |
| 103 | `paperWindowOffset` | fun | port | `src/core/components/pullOut.ts:111` |  |
| 107 | `recordPaperTouch` | fun | port | `src/ui/components/PullOut.tsx:71` |  |
| 114 | `rememberPaperTrigger` | fun | port | `src/ui/components/PullOut.tsx:15` |  |
| 123 | `pullOutAnchor` | fun | port | `src/core/components/pullOut.ts:116` |  |
| 126 | `pullOutSelectable` | fun | port | `src/core/components/pullOut.ts:121` |  |
| 131 | `pullOutCombinedClickable` | fun | port | `src/core/components/pullOut.ts:141` |  |
| 138 | `pullOutClickable` | fun | port | `src/core/components/pullOut.ts:166` |  |
| 146 | `PaperLifecycle` | type | port | `src/core/components/pullOut.ts:176` |  |
| 161 | `paperLifecycles` | val | port | `src/core/components/pullOut.ts:234` |  |
| 163 | `rememberPaperLifecycle` | fun | port | `src/core/components/pullOut.ts:17` |  |
| 168 | `PaperSpring` | type | port | `src/core/components/pullOut.ts:245` |  |
| 216 | `PullOutVisibility` | fun | port | `src/core/components/pullOut.ts:20` |  |
| 226 | `PaperVisibilityLegacy` | fun | port | `src/core/components/pullOut.ts:334` |  |

## com/example/ui/components/PullOutRender.kt (238 行, 8 声明)

iOS 归属：`src/core/components/pullOut.ts` / `src/ui/components/PullOut.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `StablePaperSurface` | fun | port | `src/ui/components/PullOut.tsx:243` |  |
| 29 | `paperSurface` | fun | port | `src/ui/components/PullOut.tsx:24` |  |
| 93 | `PaperSurfaceGeometry` | type | port | `src/core/components/pullOut.ts:360` |  |
| 101 | `PaperWarpGeometry` | type | port | `src/core/components/pullOut.ts:374` |  |
| 179 | `PaperWarpEffect` | type | port | `src/core/components/pullOut.ts:24` |  |
| 192 | `paperWarpLookup` | fun | port | `src/core/components/pullOut.ts:522` |  |
| 209 | `PAPER_WARP_SHADER` | val | port | `src/core/components/pullOut.ts:539` |  |
| 233 | `PaperWarpStats` | type | port | `src/core/components/pullOut.ts:563` |  |

## com/example/ui/components/ReadingCalendarCard.kt (587 行, 10 声明)

iOS 归属：`src/ui/components/ReadingCalendarCard.tsx` / `src/ui/pages/StatisticsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 53 | `ReadingCalendarCard` | fun | port | `src/ui/components/ReadingCalendarCard.tsx:94` |  |
| 177 | `MonthGrid` | fun | port | `src/ui/components/ReadingCalendarCard.tsx:18` |  |
| 244 | `DayCell` | fun | port | `src/ui/components/ReadingCalendarCard.tsx:19` |  |
| 319 | `YearHeatmap` | fun | port | `src/ui/components/ReadingCalendarCard.tsx:20` |  |
| 464 | `YearCell` | fun | port | `src/ui/components/ReadingCalendarCard.tsx:21` |  |
| 500 | `WEEKDAY_LABELS` | val | port | `src/ui/components/ReadingCalendarCard.tsx:61` |  |
| 503 | `YearGrid` | type | port | `src/ui/components/ReadingCalendarCard.tsx:315` |  |
| 521 | `buildYearGrid` | fun | port | `src/ui/components/ReadingCalendarCard.tsx:325` |  |
| 575 | `heatAlpha` | fun | port | `src/ui/components/ReadingCalendarCard.tsx:70` |  |
| 587 | `HEAT_LEVELS` | val | port | `src/ui/components/ReadingCalendarCard.tsx:67` |  |

## com/example/ui/components/ReadingRecordCover.kt (28 行, 1 声明)

iOS 归属：`src/ui/pages/StatisticsPage.tsx` / `src/ui/components/ReadingRecordCover.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `ReadingRecordCover` | fun | port | `src/ui/components/ReadingRecordCover.tsx:79` |  |

## com/example/ui/components/ReadingStats.kt (212 行, 17 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/components/ReadingStats.tsx` / `src/ui/pages/StatisticsPage.tsx` / `src/ui/lib/readingStats.ts` / `src/ui/components/ReadingTrendCard.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 29 | `rememberTodayCalendar` | fun | port | `src/ui/components/ReadingStats.tsx:7` |  |
| 50 | `readingRecordsForDates` | fun | port | `src/core/ui/parityMisc.ts:440` |  |
| 56 | `readingRecordsToDailyTotals` | fun | port | `src/ui/components/ReadingStats.tsx:88` |  |
| 64 | `formatReadDuration` | fun | port | `src/ui/components/ReadingStats.tsx:96` |  |
| 78 | `formatShortDuration` | fun | port | `src/ui/components/ReadingStats.tsx:104` |  |
| 91 | `dateStrOf` | fun | port | `src/ui/components/ReadingStats.tsx:116` |  |
| 94 | `todayCalendar` | fun | port | `src/ui/components/ReadingStats.tsx:120` |  |
| 96 | `dateStrToCalendar` | fun | port | `src/ui/components/ReadingStats.tsx:130` |  |
| 110 | `weekDatesOf` | fun | port | `src/ui/components/ReadingStats.tsx:142` |  |
| 123 | `sumSecondsBetween` | fun | port | `src/ui/components/ReadingStats.tsx:156` |  |
| 132 | `daysReadBetween` | fun | port | `src/ui/components/ReadingStats.tsx:167` |  |
| 139 | `streakEndingAt` | fun | port | `src/ui/components/ReadingStats.tsx:178` |  |
| 155 | `longestStreakIn` | fun | port | `src/ui/components/ReadingStats.tsx:194` |  |
| 169 | `dailySeries` | fun | port | `src/ui/components/ReadingStats.tsx:209` |  |
| 181 | `monthlySeries` | fun | port | `src/ui/components/ReadingStats.tsx:239` |  |
| 196 | `peakHourTotals` | fun | port | `src/ui/components/ReadingStats.tsx:259` |  |
| 211 | `formatSessionTime` | fun | port | `src/ui/components/ReadingStats.tsx:277` |  |

## com/example/ui/components/ReadingTrendCard.kt (404 行, 3 声明)

iOS 归属：`src/ui/components/ReadingTrendCard.tsx` / `src/ui/pages/StatisticsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 49 | `ReadingTrendCard` | fun | port | `src/ui/components/ReadingTrendCard.tsx:65` |  |
| 232 | `TrendLineChart` | fun | port | `src/ui/components/ReadingTrendCard.tsx:27` |  |
| 350 | `PeakHoursBars` | fun | port | `src/ui/components/ReadingTrendCard.tsx:28` |  |

## com/example/ui/components/ReleaseHistoryDialog.kt (137 行, 3 声明)

iOS 归属：`src/ui/components/ReleaseHistoryDialog.tsx` / `src/ui/pages/SettingsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 30 | `ReleaseSummary` | type | port | `src/ui/components/ReleaseHistoryDialog.tsx:50` |  |
| 31 | `releaseHistory` | val | port | `src/ui/components/ReleaseHistoryDialog.tsx:10` |  |
| 95 | `ReleaseHistoryDialog` | fun | port | `src/ui/components/ReleaseHistoryDialog.tsx:139` |  |

## com/example/ui/components/ScrollTilt.kt (231 行, 7 声明)

iOS 归属：`src/core/ui/kotlinAuthorityConstants.ts` / `src/core/glass/scrollTilt.ts` / `src/ui/components/ScrollTilt.tsx` / `src/ui/pages/HomePage.tsx` / `src/ui/pages/StatisticsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 30 | `ScrollTiltController` | type | port | `src/core/glass/scrollTilt.ts:49` |  |
| 106 | `FOLLOW_TAU_MS` | val | port | `src/core/glass/scrollTilt.ts:31` |  |
| 109 | `RELEASE_TAU_MS` | val | port | `src/core/glass/scrollTilt.ts:34` |  |
| 112 | `LocalScrollTilt` | val | port | `src/core/glass/scrollTilt.ts:11` |  |
| 120 | `ScrollTiltHost` | fun | port | `src/ui/components/ScrollTilt.tsx:62` |  |
| 132 | `scrollTiltSource` | fun | port | `src/core/glass/scrollTilt.ts:13` |  |
| 220 | `scrollDeltaPx` | fun | port | `src/core/glass/scrollTilt.ts:112` |  |

## com/example/ui/components/SettingsControls.kt (465 行, 5 声明)

iOS 归属：`src/ui/components/SettingsControls.tsx` / `src/ui/pages/SettingsPage.tsx` / `src/ui/components/discover/DiscoverSettings.tsx` / `src/ui/components/source/ZLibraryLoginDialog.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 81 | `SegmentedPillSelector` | fun | port | `src/ui/components/index.ts:6` |  |
| 94 | `PageTurnSelectorRow` | fun | port | `src/ui/components/index.ts:7` |  |
| 204 | `CustomMinutesDialog` | fun | port | `src/ui/components/SettingsControls.tsx:471` |  |
| 316 | `JunoSlider` | fun | port | `src/ui/components/SettingsControls.tsx:566` |  |
| 329 | `PageTurnPreview` | fun | port | `src/ui/components/SettingsControls.tsx:267` |  |

## com/example/ui/components/ShimmerBox.kt (58 行, 1 声明)

iOS 归属：`src/ui/components/ShimmerBox.tsx` / `src/core/glass/skeletonProgress.ts` / `src/core/cache/cacheManagement.ts` / `src/ui/pages/CacheManagementPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 24 | `ShimmerBox` | fun | port | `src/ui/components/ShimmerBox.tsx:34` |  |

## com/example/ui/components/SourceAvatar.kt (59 行, 1 声明)

iOS 归属：`src/ui/pages/LibraryPage.tsx` / `src/ui/components/source/SourceManagementParts.tsx` / `src/ui/components/SourceAvatar.tsx` / `src/core/glass/color.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 29 | `SourceAvatar` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:575` |  |

## com/example/ui/components/StarryNightBackground.kt (75 行, 6 声明)

iOS 归属：`src/ui/components/StarryNightBackground.tsx` / `src/ui/pages/HomePage.tsx` / `src/core/home/homeViewModel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 22 | `GlassBorderWhite` | val | port | `src/ui/components/StarryNightBackground.tsx:14` |  |
| 23 | `GlassBorderDark` | val | port | `src/ui/components/StarryNightBackground.tsx:15` |  |
| 24 | `GlassWhite` | val | port | `src/ui/components/StarryNightBackground.tsx:16` |  |
| 25 | `GlassDark` | val | port | `src/ui/components/StarryNightBackground.tsx:17` |  |
| 26 | `WarmLampYellow` | val | port | `src/ui/components/StarryNightBackground.tsx:18` |  |
| 29 | `StarryNightBackground` | fun | port | `src/ui/components/StarryNightBackground.tsx:85` |  |

## com/example/ui/components/StartupDiagnosticsExportButton.kt (58 行, 1 声明)

iOS 归属：`src/ui/pages/SettingsPage.tsx` / `src/platform/ios-native/startupDiagnostics.ts` / `src/ui/components/StartupDiagnosticsExportButton.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `StartupDiagnosticsExportButton` | fun | port | `src/ui/components/StartupDiagnosticsExportButton.tsx:71` |  |

## com/example/ui/components/StateIcons.kt (93 行, 3 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/components/StateIcons.tsx` / `src/core/ui/stateIcons.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 32 | `AnimatedStateIcon` | fun | port | `src/ui/components/StateIcons.tsx:70` |  |
| 53 | `AnimatedChevron` | fun | port | `src/ui/components/StateIcons.tsx:130` |  |
| 69 | `AnimatedSelectionMark` | fun | port | `src/ui/components/StateIcons.tsx:170` |  |

## com/example/ui/components/TabScreenHeader.kt (283 行, 5 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/ui/tabScreenHeader.ts` / `src/ui/pages/StatisticsPage.tsx` / `src/ui/pages/SettingsPage.tsx` / `src/ui/components/TabScreenHeader.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 46 | `HeaderCollapseGate` | type | port | `src/core/ui/parityMisc.ts:464` |  |
| 71 | `rememberHeaderCollapsed` | fun | port | `src/core/ui/tabScreenHeader.ts:5` |  |
| 107 | `rememberHeaderCollapsedSource` | fun | port | `src/core/ui/tabScreenHeader.ts:6` |  |
| 142 | `TabScreenHeader` | fun | port | `src/ui/components/TabScreenHeader.tsx:26` |  |
| 177 | `CollapsingTabScreenHeader` | fun | port | `src/core/ui/parityMisc.ts:467` |  |

## com/example/ui/components/WeeklyReadingChart.kt (606 行, 3 声明)

iOS 归属：`src/ui/components/WeeklyReadingChart.tsx` / `src/ui/pages/StatisticsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 64 | `WeeklyReadingChart` | fun | port | `src/ui/components/WeeklyReadingChart.tsx:306` |  |
| 391 | `DayCoverCarousel` | fun | port | `src/ui/components/WeeklyReadingChart.tsx:21` |  |
| 436 | `DayCoverCard` | fun | port | `src/ui/components/WeeklyReadingChart.tsx:22` |  |

## com/example/ui/components/WindowBackdrop.kt (118 行, 7 声明)

iOS 归属：`src/core/glass/windowBackdrop.ts` / `src/ui/components/AcrylicDialog.tsx` / `src/ui/components/LiquidGlass.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `BLUR_STEPS_PER_PIXEL` | val | port | `src/core/glass/windowBackdrop.ts:29` |  |
| 22 | `BLUR_CACHE_CAPACITY` | val | port | `src/core/glass/windowBackdrop.ts:31` |  |
| 23 | `WINDOW_DIM_STEPS` | val | port | `src/core/glass/windowBackdrop.ts:33` |  |
| 24 | `GLASS_WINDOW_DIM` | val | port | `src/core/glass/windowBackdrop.ts:35` |  |
| 25 | `FALLBACK_WINDOW_DIM` | val | port | `src/core/glass/windowBackdrop.ts:37` |  |
| 31 | `GlassDialogWindowEffect` | fun | port | `src/core/glass/windowBackdrop.ts:16` |  |
| 68 | `GlassWindowBlur` | type | port | `src/core/glass/windowBackdrop.ts:97` |  |

## com/example/ui/design/DesignTokens.kt (114 行, 2 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/ui/components/reader/TouchZoneEditor.tsx` / `src/core/reader/readingSettingsPanel.ts` / `src/ui/tokens.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 41 | `DesignTokens` | type | port | `src/ui/tokens.ts:133` |  |
| 91 | `ReadingPalette` | type | port | `src/core/ui/designTokens.ts:44` |  |

## com/example/ui/favorite/ChapterStatusRow.kt (475 行, 7 声明)

iOS 归属：`src/core/favorite/favoriteUi.ts` / `src/ui/components/favorite/ChapterStatusRow.tsx` / `src/core/ui-theme/color.ts` / `src/core/comic/comicChapters.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 70 | `ChapterVisual` | type | port | `src/core/comic/comicChapters.ts:156` |  |
| 72 | `toVisual` | fun | port | `src/core/comic/comicChapters.ts:164` |  |
| 78 | `ChapterRowState` | type | port | `src/core/favorite/favoriteUi.ts:228` |  |
| 104 | `ChapterStatusRow` | fun | port | `src/ui/components/favorite/ChapterStatusRow.tsx:215` |  |
| 392 | `BookmarkRibbon` | fun | port | `src/ui/components/favorite/ChapterStatusRow.tsx:400` |  |
| 461 | `rememberChapterHighlight` | fun | port | `src/core/favorite/favoriteUi.ts:317` |  |
| 474 | `luminance` | fun | port | `src/core/ui-theme/color.ts:226` |  |

## com/example/ui/favorite/ComicDetailActions.kt (123 行, 3 声明)

iOS 归属：`src/ui/components/favorite/ComicDetailActions.tsx` / `src/ui/pages/ComicChaptersPage.tsx` / `src/core/favorite/favoriteUi.ts` / `src/core/comic/comicChapters.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 39 | `ComicBottomActionBar` | fun | port | `src/ui/components/favorite/ComicDetailActions.tsx:64` |  |
| 96 | `SourceUnavailableBanner` | fun | port | `src/ui/components/favorite/ComicDetailActions.tsx:118` |  |
| 120 | `continueReadingLabel` | fun | port | `src/core/favorite/favoriteUi.ts:440` |  |

## com/example/ui/favorite/DuplicateComicSheet.kt (128 行, 1 声明)

iOS 归属：`src/ui/components/favorite/DuplicateFavoriteHost.tsx` / `src/ui/components/favorite/DuplicateComicSheet.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 33 | `DuplicateComicSheet` | fun | port | `src/ui/components/favorite/DuplicateComicSheet.tsx:122` |  |

## com/example/ui/favorite/FavoriteCover.kt (94 行, 3 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/core/favorite/favoriteUi.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 26 | `favoriteCoverData` | fun | port | `src/core/favorite/favoriteUi.ts:652` |  |
| 35 | `favoriteCoverRequest` | fun | port | `src/core/ui/designTokens.ts:77` |  |
| 50 | `FavoriteCover` | fun | port | `src/core/favorite/favoriteUi.ts:629` |  |

## com/example/ui/favorite/FavoriteHeart.kt (304 行, 4 声明)

iOS 归属：`src/ui/components/favorite/FavoriteHeart.tsx` / `src/ui/components/shelf/ShelfSelectionHost.tsx` / `src/core/favorite/favoriteUi.ts` / `src/ui/components/favorite/ComicDetailActions.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 71 | `FavoriteHeartButton` | fun | port | `src/ui/components/favorite/FavoriteHeart.tsx:161` |  |
| 210 | `HeartGlyph` | fun | port | `src/ui/components/favorite/FavoriteHeart.tsx:35` |  |
| 253 | `HeartBurst` | fun | port | `src/core/favorite/favoriteUi.ts:526` |  |
| 290 | `FavoriteHeartIcon` | fun | port | `src/ui/components/favorite/FavoriteHeart.tsx:419` |  |

## com/example/ui/favorite/FavoritesPanel.kt (509 行, 7 声明)

iOS 归属：`src/core/favorite/favoriteUi.ts` / `src/core/home/homeViewModel.ts` / `src/ui/components/favorite/FavoritesPanel.tsx` / `src/ui/pages/HomePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 75 | `FavoriteSort` | type | port | `src/core/favorite/favoriteUi.ts:62` |  |
| 90 | `FavoritesPanel` | fun | port | `src/ui/components/favorite/FavoritesPanel.tsx:155` |  |
| 253 | `ALL_FAV_CATEGORY` | val | port | `src/core/favorite/favoriteUi.ts:82` |  |
| 257 | `FavoriteCard` | fun | port | `src/ui/components/favorite/FavoritesPanel.tsx:290` |  |
| 473 | `ShelfSegmentedTabs` | fun | port | `src/ui/components/favorite/FavoritesPanel.tsx:437` |  |
| 492 | `FavoritesEmptyState` | fun | port | `src/ui/components/favorite/FavoritesPanel.tsx:510` |  |
| 506 | `ensureFavoriteCategory` | fun | port | `src/core/favorite/favoriteUi.ts:194` |  |

## com/example/ui/favorite/HeartArt.kt (114 行, 9 声明)

iOS 归属：`src/ui/components/favorite/HeartArt.tsx` / `src/core/favorite/favoriteUi.ts` / `src/ui/components/favorite/FavoriteHeart.tsx` / `src/ui/components/shelf/ShelfSelectionHost.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 31 | `heartPathPx` | fun | port | `src/core/favorite/favoriteUi.ts:39` |  |
| 46 | `HeartTop` | val | port | `src/core/favorite/favoriteUi.ts:461` |  |
| 47 | `HeartMid` | val | port | `src/core/favorite/favoriteUi.ts:462` |  |
| 48 | `HeartBottom` | val | port | `src/core/favorite/favoriteUi.ts:463` |  |
| 50 | `ART_TOP` | val | port | `src/core/favorite/favoriteUi.ts:465` |  |
| 51 | `ART_MID` | val | port | `src/core/favorite/favoriteUi.ts:466` |  |
| 52 | `ART_BOTTOM` | val | port | `src/core/favorite/favoriteUi.ts:467` |  |
| 60 | `HeartArt` | fun | port | `src/ui/components/favorite/HeartArt.tsx:70` |  |
| 114 | `HeartArtDefaultSize` | val | port | `src/ui/components/favorite/FavoriteHeart.tsx:436` |  |

## com/example/ui/favorite/SourceMigration.kt (240 行, 4 声明)

iOS 归属：`src/ui/components/favorite/SourceMigration.tsx` / `src/core/favorite/favoriteUi.ts` / `src/ui/pages/ComicChaptersPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 50 | `SourceCandidate` | type | port | `src/core/favorite/favoriteUi.ts:325` |  |
| 64 | `ComicSourceMigration` | type | port | `src/core/favorite/favoriteUi.ts:30` |  |
| 124 | `SourceMigrateSheet` | fun | port | `src/ui/components/favorite/SourceMigration.tsx:91` |  |
| 197 | `SourceCandidateRow` | fun | port | `src/ui/components/favorite/SourceMigration.tsx:35` |  |

## com/example/ui/feedback/Motion.kt (255 行, 11 声明)

iOS 归属：`src/core/glass/motion.ts` / `src/ui/components/feedback/Motion.tsx` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/core/ui-theme/iosMotion.ts` / `src/core/motion/navigationMotion.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `AppMotion` | type | port | `src/core/glass/motion.ts:146` |  |
| 104 | `LocalReduceMotion` | val | port | `src/core/glass/motion.ts:7` |  |
| 107 | `LocalHapticsEnabled` | val | port | `src/core/glass/motion.ts:7` |  |
| 117 | `HapticsGate` | type | port | `src/core/glass/motion.ts:194` |  |
| 123 | `MutingHapticFeedback` | type | port | `src/core/glass/motion.ts:10` |  |
| 132 | `HapticKind` | type | port | `src/core/glass/motion.ts:202` |  |
| 139 | `AppHaptics` | type | port | `src/core/glass/motion.ts:240` |  |
| 185 | `rememberAppHaptics` | fun | port | `src/core/glass/motion.ts:13` |  |
| 204 | `systemReduceMotion` | fun | port | `src/core/glass/motion.ts:235` |  |
| 241 | `REDUCED_MOTION_SCALE_EPSILON` | val | port | `src/core/glass/motion.ts:199` |  |
| 245 | `ProvideMotion` | fun | port | `src/core/glass/motion.ts:16` |  |

## com/example/ui/feedback/NavigationMotion.kt (14 行, 1 声明)

iOS 归属：`src/core/motion/navigationMotion.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `NavigationMotion` | type | port | `src/core/motion/navigationMotion.ts:2` |  |

## com/example/ui/glasskit/GlassKit.kt (519 行, 9 声明)

iOS 归属：`src/ui/components/glasskit/GlassKit.tsx` / `src/core/glass/glassKit.ts` / `src/ui/pages/SourceManagementPage.tsx` / `src/ui/components/source/SourceManagementParts.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 88 | `GlassTokens` | type | port | `src/core/glass/glassKit.ts:35` |  |
| 164 | `SquircleShape` | type | port | `src/core/glass/glassKit.ts:7` |  |
| 188 | `GlassCardShape` | val | port | `src/core/glass/glassKit.ts:8` |  |
| 190 | `squirclePath` | fun | port | `src/core/glass/glassKit.ts:88` |  |
| 214 | `LocalGlassKitBackdrop` | val | port | `src/core/glass/glassKit.ts:9` |  |
| 228 | `GlassKitHost` | fun | port | `src/ui/components/glasskit/GlassKit.tsx:188` |  |
| 297 | `rememberReduceTransparency` | fun | port | `src/core/glass/glassKit.ts:11` |  |
| 321 | `GlassKitCard` | fun | port | `src/ui/components/glasskit/GlassKit.tsx:286` |  |
| 473 | `GlassTopBarStrip` | fun | port | `src/ui/components/glasskit/GlassKit.tsx:479` |  |

## com/example/ui/glasskit/GlassManagementTopBar.kt (101 行, 2 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/ui/pages/ThemePalettePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 36 | `GlassManagementPage` | fun | port | `src/ui/pages/ThemePalettePage.tsx:12` |  |
| 66 | `GlassManagementTopBar` | fun | port | `src/core/ui/designTokens.ts:198` |  |

## com/example/ui/help/FaqExpandableItem.kt (85 行, 1 声明)

iOS 归属：`src/ui/components/help/LibraryHelpBottomSheet.tsx` / `src/ui/components/help/FaqExpandableItem.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 27 | `FaqExpandableItem` | fun | port | `src/ui/components/help/FaqExpandableItem.tsx:23` |  |

## com/example/ui/help/HelpSection.kt (114 行, 3 声明)

iOS 归属：`src/ui/components/help/LibraryHelpBottomSheet.tsx` / `src/ui/components/help/HelpSection.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `HelpSectionHeader` | fun | port | `src/ui/components/help/HelpSection.tsx:22` |  |
| 43 | `FlowStepItem` | fun | port | `src/ui/components/help/HelpSection.tsx:39` |  |
| 95 | `TextDetailCard` | fun | port | `src/ui/components/help/HelpSection.tsx:66` |  |

## com/example/ui/help/JsonSourceGuideCard.kt (141 行, 1 声明)

iOS 归属：`src/ui/components/help/JsonSourceGuideCard.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 21 | `JsonSourceGuideCard` | fun | port | `src/ui/components/help/JsonSourceGuideCard.tsx:53` |  |

## com/example/ui/help/LibraryHelpBottomSheet.kt (357 行, 1 声明)

iOS 归属：`src/ui/pages/SettingsPage.tsx` / `src/ui/components/help/LibraryHelpBottomSheet.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 42 | `LibraryHelpBottomSheet` | fun | port | `src/ui/components/help/LibraryHelpBottomSheet.tsx:51` |  |

## com/example/ui/mascot/BookCompleteAnimation.kt (215 行, 2 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/ui/components/mascot/BookCompleteAnimation.tsx` / `src/ui/components/mascot/MascotAnimationController.tsx` / `src/core/mascot/mascotEvents.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 31 | `BookCompleteAnimation` | fun | port | `src/ui/components/mascot/BookCompleteAnimation.tsx:41` |  |
| 188 | `RoxyCelebrationImage` | fun | port | `src/core/ui/designTokens.ts:143` |  |

## com/example/ui/mascot/BookmarkHappyAnimation.kt (153 行, 1 声明)

iOS 归属：`src/ui/components/mascot/BookmarkHappyAnimation.tsx` / `src/ui/components/mascot/MascotAnimationController.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 27 | `BookmarkHappyAnimation` | fun | port | `src/ui/components/mascot/BookmarkHappyAnimation.tsx:31` |  |

## com/example/ui/mascot/DeleteSadAnimation.kt (153 行, 1 声明)

iOS 归属：`src/ui/components/mascot/DeleteSadAnimation.tsx` / `src/ui/components/mascot/MascotAnimationController.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 27 | `DeleteSadAnimation` | fun | port | `src/ui/components/mascot/DeleteSadAnimation.tsx:28` |  |

## com/example/ui/mascot/MascotAnimationController.kt (99 行, 5 声明)

iOS 归属：`src/core/mascot/mascotEvents.ts` / `src/ui/components/mascot/MascotAnimationController.tsx` / `src/ui/pages/ReaderPage.tsx` / `src/ui/pages/CacheManagementPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `MascotEvent` | type | port | `src/core/mascot/mascotEvents.ts:37` |  |
| 25 | `MascotEventInstance` | type | port | `src/core/mascot/mascotEvents.ts:47` |  |
| 37 | `MotionTransform` | type | port | `src/core/mascot/mascotEvents.ts:105` |  |
| 55 | `MascotAnimationController` | type | port | `src/core/mascot/mascotEvents.ts:79` |  |
| 69 | `MascotOverlay` | fun | port | `src/ui/components/mascot/MascotAnimationController.tsx:65` |  |

## com/example/ui/mascot/MascotSpriteSheet.kt (48 行, 4 声明)

iOS 归属：`src/core/mascot/mascotSpriteSheet.ts` / `src/ui/components/mascot/MascotSpriteSheet.ts` / `src/ui/components/MascotEmptyState.tsx` / `src/ui/pages/OnboardingPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `MascotSpriteSheet` | type | port | `src/core/mascot/mascotSpriteSheet.ts:31` |  |
| 28 | `MascotAssetMap` | type | port | `src/core/mascot/mascotSpriteSheet.ts:67` |  |
| 39 | `MascotMood` | type | port | `src/core/mascot/mascotSpriteSheet.ts:78` |  |
| 42 | `mascotMoodOf` | fun | port | `src/core/mascot/mascotSpriteSheet.ts:84` |  |

## com/example/ui/mascot/MoveBookAnimation.kt (152 行, 1 声明)

iOS 归属：`src/ui/components/mascot/MascotAnimationController.tsx` / `src/ui/components/mascot/MoveBookAnimation.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 27 | `MoveBookAnimation` | fun | port | `src/ui/components/mascot/MoveBookAnimation.tsx:28` |  |

## com/example/ui/pageturn/PageCurlReaderContainer.kt (407 行, 2 声明)

iOS 归属：`src/ui/components/pageturn/PageCurlReaderContainer.tsx` / `src/ui/pages/ReaderPage.tsx` / `src/platform/web/webPageCurl.ts` / `src/core/pagecurl/pageCurl.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 74 | `BACK_PAGE_CONTENT_ALPHA` | val | port | `src/ui/components/pageturn/PageCurlReaderContainer.tsx:46` |  |
| 86 | `PageCurlReaderContainer` | fun | port | `src/ui/components/pageturn/PageCurlReaderContainer.tsx:98` |  |

## com/example/ui/pageturn/PageScrubber.kt (563 行, 2 声明)

iOS 归属：`src/ui/pages/ReaderPage.tsx` / `src/ui/components/pageturn/PageScrubber.tsx` / `src/core/reader/readerScreenLogic.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 88 | `PaperFlipPlayer` | type | port | `src/ui/components/pageturn/PageScrubber.tsx:18` |  |
| 144 | `PageScrubberOverlay` | fun | port | `src/ui/components/pageturn/PageScrubber.tsx:93` |  |

## com/example/ui/pageturn/PageTurnContainer.kt (1219 行, 13 声明)

iOS 归属：`src/ui/components/pageturn/PageTurnContainer.tsx` / `src/core/pageturn/pageTurn.ts` / `src/ui/pages/SettingsPage.tsx` / `src/ui/pages/ReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 68 | `BACKSIDE_CONTENT_ALPHA` | val | port | `src/core/pageturn/pageTurn.ts:24` |  |
| 71 | `PageTurnType` | type | port | `src/ui/components/pageturn/PageTurnContainer.tsx:64` |  |
| 83 | `PageTurnContainer` | fun | port | `src/ui/components/pageturn/PageTurnContainer.tsx:140` |  |
| 569 | `Simulate3DCurlLayout` | fun | port | `src/ui/components/pageturn/PageTurnContainer.tsx:375` |  |
| 894 | `CurlFlapBackside` | fun | port | `src/ui/components/pageturn/PageTurnContainer.tsx:26` |  |
| 1028 | `midPoint` | fun | port | `src/core/pageturn/pageTurn.ts:32` |  |
| 1031 | `curlNormal` | fun | port | `src/core/pageturn/pageTurn.ts:37` |  |
| 1040 | `shadowStripPath` | fun | port | `src/core/pageturn/pageTurn.ts:47` |  |
| 1053 | `mirrorAngleDeg` | fun | port | `src/core/pageturn/pageTurn.ts:62` |  |
| 1060 | `buildFlapPath` | fun | port | `src/core/pageturn/pageTurn.ts:70` |  |
| 1083 | `CoverPageTurnLayout` | fun | port | `src/ui/components/pageturn/PageTurnContainer.tsx:28` |  |
| 1130 | `SlidePageTurnLayout` | fun | port | `src/ui/components/pageturn/PageTurnContainer.tsx:29` |  |
| 1175 | `FadePageTurnLayout` | fun | port | `src/ui/components/pageturn/PageTurnContainer.tsx:30` |  |

## com/example/ui/pageturn/PaperPalette.kt (93 行, 5 声明)

iOS 归属：`src/ui/components/pageturn/PaperPalette.ts` / `src/core/pageturn/paperPalette.ts` / `src/core/glass/color.ts` / `src/ui/components/source/SourceManagementParts.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `PaperPalette` | type | port | `src/core/pageturn/paperPalette.ts:29` |  |
| 45 | `rememberPaperPalette` | fun | port | `src/core/pageturn/paperPalette.ts:6` |  |
| 49 | `paperPaletteOf` | fun | port | `src/core/pageturn/paperPalette.ts:47` |  |
| 79 | `mix` | fun | port | `src/core/glass/color.ts:6` |  |
| 90 | `desaturate` | fun | port | `src/core/glass/color.ts:6` |  |

## com/example/ui/privacy/PrivacyWindows.kt (366 行, 7 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/ui/components/privacy/PrivacyWindows.tsx` / `src/core/privacy/privacyWindows.ts` / `src/ui/pages/SettingsPage.tsx` / `src/ui/pages/HomePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 54 | `PinEntryMode` | type | port | `src/core/privacy/privacyWindows.ts:168` |  |
| 57 | `PrivacyPinOverlay` | fun | port | `src/ui/components/privacy/PrivacyWindows.tsx:346` |  |
| 226 | `pinResult` | fun | port | `src/core/ui/designTokens.ts:105` |  |
| 235 | `PinDots` | fun | port | `src/core/privacy/privacyWindows.ts:24` |  |
| 263 | `PinKey` | fun | port | `src/core/ui/designTokens.ts:17` |  |
| 300 | `PrivacyManageOverlay` | fun | port | `src/ui/components/privacy/PrivacyWindows.tsx:598` |  |
| 349 | `PrivacySwitchRow` | fun | port | `src/core/ui/parityMisc.ts:474` |  |

## com/example/ui/reader/BookSpanLayout.kt (59 行, 4 声明)

iOS 归属：`src/ui/reader/bookSpanLayout.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `layoutBookSpans` | fun | port | `src/ui/reader/bookSpanLayout.ts:29` |  |
| 28 | `bookSpanRanges` | fun | port | `src/ui/reader/bookSpanLayout.ts:53` |  |
| 33 | `addBookSpans` | fun | port | `src/ui/reader/bookSpanLayout.ts:64` |  |
| 37 | `bookSpanStyle` | fun | port | `src/ui/reader/bookSpanLayout.ts:86` |  |

## com/example/ui/reader/ListeningHighlight.kt (17 行, 1 声明)

iOS 归属：`src/ui/reader/listeningHighlight.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `addListeningHighlight` | fun | port | `src/ui/reader/listeningHighlight.ts:22` |  |

## com/example/ui/reader/NovelImageFullscreen.kt (396 行, 8 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/ui/pages/ReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 74 | `openCoverGallery` | fun | port | `src/core/ui/parityMisc.ts:483` |  |
| 78 | `coverGalleryDestination` | fun | port | `src/core/ui/parityMisc.ts:488` |  |
| 101 | `NovelImageFullscreenViewer` | fun | port | `src/ui/pages/ReaderPage.tsx:128` |  |
| 144 | `CoverImageGallery` | fun | port | `src/core/ui/parityMisc.ts:490` |  |
| 179 | `ImageGalleryDialog` | fun | port | `src/core/ui/parityMisc.ts:494` |  |
| 198 | `ArchiveImageGallery` | fun | port | `src/core/ui/parityMisc.ts:498` |  |
| 277 | `ZoomableGalleryImage` | fun | port | `src/core/ui/parityMisc.ts:503` |  |
| 355 | `writeGalleryImage` | fun | port | `src/core/ui/parityMisc.ts:508` |  |

## com/example/ui/reader/NovelInlineImages.kt (464 行, 3 声明)

iOS 归属：`src/core/reader/novelInlineImages.ts` / `src/core/reader/readerScreenLogic.ts` / `src/ui/pages/ReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 44 | `NovelInlineImages` | type | port | `src/core/reader/novelInlineImages.ts:2` |  |
| 346 | `NovelInlineImage` | fun | port | `src/core/reader/novelInlineImages.ts:23` |  |
| 395 | `buildAnnotatedWithImages` | fun | port | `src/core/reader/novelInlineImages.ts:24` |  |

## com/example/ui/reader/OnlineNovelMarks.kt (46 行, 2 声明)

iOS 归属：`src/ui/reader/onlineNovelMarks.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `OnlineNovelMark` | type | port | `src/ui/reader/onlineNovelMarks.ts:22` |  |
| 12 | `OnlineNovelMarks` | type | port | `src/ui/reader/onlineNovelMarks.ts:48` |  |

## com/example/ui/reader/ReaderDictionarySheet.kt (228 行, 2 声明, 2 gap)


| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 51 | `DictionaryPane` | type | gap | — |  |
| 54 | `ReaderDictionarySheet` | fun | gap | — |  |

## com/example/ui/reader/ReaderListeningPanel.kt (394 行, 5 声明, 5 gap)


| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 63 | `ReaderListeningPanel` | fun | gap | — |  |
| 342 | `timerLabel` | fun | gap | — |  |
| 349 | `ListeningValue` | fun | gap | — |  |
| 360 | `ListeningOption` | fun | gap | — |  |
| 375 | `CustomVoiceSettings` | fun | gap | — |  |

## com/example/ui/reader/ReaderSelection.kt (280 行, 6 声明, 5 gap)

iOS 归属：`src/ui/reader/readerTextCoordinates.ts` / `src/ui/reader/onlineNovelMarks.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 46 | `ReaderTextSelection` | type | gap | — |  |
| 47 | `ReaderMark` | type | port | `src/ui/reader/readerTextCoordinates.ts:89` |  |
| 49 | `wordSelection` | fun | gap | — |  |
| 62 | `readerTextLongPress` | fun | gap | — |  |
| 97 | `ReaderSelectionSheet` | fun | gap | — |  |
| 237 | `renderExcerptCard` | fun | gap | — |  |

## com/example/ui/reader/ReaderTextCoordinates.kt (63 行, 3 声明)

iOS 归属：`src/ui/reader/readerTextCoordinates.ts` / `src/ui/reader/bookSpanLayout.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `ReaderTextCoordinates` | type | port | `src/ui/reader/readerTextCoordinates.ts:22` |  |
| 37 | `toReaderMark` | fun | port | `src/ui/reader/readerTextCoordinates.ts:118` |  |
| 54 | `addReaderMarks` | fun | port | `src/ui/reader/readerTextCoordinates.ts:161` |  |

## com/example/ui/reader/ReadingGlass.kt (46 行, 3 声明)

iOS 归属：`src/core/glass/glassKit.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `ReadingGlassStyle` | type | port | `src/core/glass/glassKit.ts:381` |  |
| 24 | `LocalReadingGlass` | val | port | `src/core/glass/glassKit.ts:382` |  |
| 28 | `readingGlass` | fun | port | `src/core/glass/glassKit.ts:372` |  |

## com/example/ui/reader/ReadingSettingsPanel.kt (92 行, 1 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/core/reader/readingSettingsPanel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 41 | `ReadingSettingsPanel` | fun | port | `src/core/ui/designTokens.ts:176` |  |

## com/example/ui/reader/TouchZoneEditor.kt (387 行, 3 声明)

iOS 归属：`src/ui/components/reader/TouchZoneEditor.tsx` / `src/core/reader/touchZones.ts` / `src/ui/pages/ComicReaderPage.tsx` / `src/ui/pages/ReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 51 | `TouchZoneEditor` | fun | port | `src/ui/components/reader/TouchZoneEditor.tsx:246` |  |
| 299 | `ActionChoices` | fun | port | `src/ui/components/reader/TouchZoneEditor.tsx:67` |  |
| 307 | `SwipeCalibrationArt` | fun | port | `src/ui/components/reader/TouchZoneEditor.tsx:55` |  |

## com/example/ui/reader/TouchZoneGestures.kt (112 行, 3 声明)

iOS 归属：`src/ui/reader/touchZoneGestures.ts` / `src/ui/pages/ReaderPage.tsx` / `src/ui/components/reader/TouchZoneEditor.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 16 | `ReaderTouchBinding` | type | port | `src/ui/pages/ReaderPage.tsx:3858` |  |
| 21 | `LocalReaderTouchBinding` | val | port | `src/ui/reader/touchZoneGestures.ts:18` |  |
| 24 | `touchZoneGestures` | fun | port | `src/ui/components/reader/TouchZoneEditor.tsx:11` |  |

## com/example/ui/reader/TouchZones.kt (101 行, 7 声明)

iOS 归属：`src/core/reader/touchZones.ts` / `src/ui/components/reader/TouchZoneEditor.tsx` / `src/ui/reader/touchZoneGestures.ts` / `src/core/comic/comicReaderConfig.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `TouchAction` | type | port | `src/core/reader/touchZones.ts:67` |  |
| 17 | `SwipeAction` | type | port | `src/core/reader/touchZones.ts:90` |  |
| 24 | `TouchZone` | type | port | `src/core/reader/touchZones.ts:159` |  |
| 64 | `NovelTouchZoneStore` | type | port | `src/core/reader/touchZones.ts:399` |  |
| 73 | `TouchGestureDecision` | type | port | `src/core/reader/touchZones.ts:458` |  |
| 90 | `fastPageCommit` | fun | port | `src/core/reader/touchZones.ts:541` |  |
| 100 | `swipeGuideSign` | fun | port | `src/core/reader/touchZones.ts:563` |  |

## com/example/ui/reader/VerticalNovelBody.kt (405 行, 9 声明, 9 gap)


| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 32 | `verticalOrigin` | val | gap | — |  |
| 33 | `selectionItem` | val | gap | — |  |
| 35 | `VerticalDocument` | type | gap | — |  |
| 38 | `VerticalNovelBody` | fun | gap | — |  |
| 74 | `VerticalTextView` | type | gap | — |  |
| 244 | `verticalDocument` | fun | gap | — |  |
| 327 | `verticalCss` | fun | gap | — |  |
| 344 | `escapeReaderHtml` | fun | gap | — |  |
| 346 | `verticalScript` | val | gap | — |  |

## com/example/ui/shelf/ShelfChips.kt (320 行, 3 声明)

iOS 归属：`src/ui/components/favorite/FavoritesPanel.tsx` / `src/ui/components/shelf/CategoryPill.tsx` / `src/ui/components/shelf/ShelfSelectionHost.tsx` / `src/ui/components/GlassCardLayers.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 69 | `CategoryPill` | fun | port | `src/ui/components/shelf/CategoryPill.tsx:182` |  |
| 205 | `pressScale` | fun | port | `src/ui/components/GlassCardLayers.tsx:397` |  |
| 246 | `AddCategoryPill` | fun | port | `src/ui/components/shelf/CategoryPill.tsx:337` |  |

## com/example/ui/shelf/ShelfMotion.kt (167 行, 8 声明)

iOS 归属：`src/core/wenku/shelfMotion.ts` / `src/ui/components/shelf/ShelfMotion.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 33 | `ShelfMotionState` | type | port | `src/ui/components/shelf/ShelfMotion.tsx:70` |  |
| 87 | `ShelfBurst` | type | port | `src/ui/components/shelf/ShelfMotion.tsx:56` |  |
| 91 | `ShelfShard` | type | port | `src/core/wenku/shelfMotion.ts:51` |  |
| 96 | `shelfShards` | fun | port | `src/core/wenku/shelfMotion.ts:72` |  |
| 120 | `rememberShelfMotionState` | fun | port | `src/ui/components/shelf/ShelfMotion.tsx:194` |  |
| 123 | `keepShelfViewportForSort` | fun | port | `src/ui/components/shelf/ShelfMotion.tsx:208` |  |
| 128 | `shelfCapture` | fun | port | `src/ui/components/shelf/ShelfMotion.tsx:219` |  |
| 145 | `ShelfShatterOverlay` | fun | port | `src/ui/components/shelf/ShelfMotion.tsx:248` |  |

## com/example/ui/shelf/ShelfMultiSelect.kt (677 行, 7 声明)

iOS 归属：`src/ui/components/shelf/ShelfSelectionState.ts` / `src/core/home/homeViewModel.ts` / `src/ui/components/shelf/ShelfSelectionHost.tsx` / `src/ui/pages/HomePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 35 | `ShelfPhase` | type | port | `src/core/home/homeViewModel.ts:771` |  |
| 47 | `ShelfSelectionScope` | type | port | `src/core/home/homeViewModel.ts:777` |  |
| 49 | `ShelfSelectionState` | type | port | `src/core/home/homeViewModel.ts:779` |  |
| 474 | `rememberShelfSelectionState` | fun | port | `src/core/home/homeViewModel.ts:33` |  |
| 490 | `ShelfGestureSink` | type | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:1867` |  |
| 499 | `DropSink` | type | port | `src/ui/components/shelf/ShelfSelectionState.ts:246` |  |
| 530 | `shelfGestures` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:103` |  |

## com/example/ui/shelf/ShelfSearch.kt (361 行, 11 声明)

iOS 归属：`src/core/wenku/shelfSearch.ts` / `src/ui/components/shelf/ShelfSearch.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 78 | `ShelfSearchState` | type | port | `src/ui/components/shelf/ShelfSearch.tsx:76` |  |
| 104 | `rememberShelfSearchState` | fun | port | `src/ui/components/shelf/ShelfSearch.tsx:123` |  |
| 114 | `ShelfSearchBackHandler` | fun | port | `src/ui/components/shelf/ShelfSearch.tsx:131` |  |
| 126 | `ShelfSearchPlane` | fun | port | `src/ui/components/shelf/ShelfSearch.tsx:161` |  |
| 182 | `shelfSearchBottomInsets` | fun | port | `src/ui/components/shelf/ShelfSearch.tsx:67` |  |
| 194 | `ShelfSearchField` | type | port | `src/core/wenku/shelfSearch.ts:32` |  |
| 204 | `shelfSearchOptions` | val | port | `src/ui/components/shelf/ShelfSearch.tsx:61` |  |
| 207 | `ShelfSearchResults` | fun | port | `src/ui/components/shelf/ShelfSearch.tsx:217` |  |
| 289 | `SearchSectionTitle` | fun | port | `src/ui/components/shelf/ShelfSearch.tsx:303` |  |
| 297 | `SearchBookRow` | fun | port | `src/ui/components/shelf/ShelfSearch.tsx:328` |  |
| 358 | `SearchCoverSource` | type | port | `src/ui/components/shelf/ShelfSearch.tsx:313` |  |

## com/example/ui/shelf/ShelfSelectionHost.kt (1457 行, 27 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/ui/components/shelf/ShelfSelectionHost.tsx` / `src/ui/pages/HomePage.tsx` / `src/core/home/homeViewModel.ts` / `src/ui/components/shelf/ShelfSelectionState.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 125 | `ShelfChrome` | type | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:5` |  |
| 135 | `DROP_TARGET_FAVORITE` | val | port | `src/core/home/homeViewModel.ts:198` |  |
| 136 | `DROP_TARGET_NEW` | val | port | `src/core/home/homeViewModel.ts:199` |  |
| 137 | `dropTargetOfCategory` | fun | port | `src/core/home/homeViewModel.ts:201` |  |
| 140 | `DROP_PREFIX_FAV_CATEGORY` | val | port | `src/core/home/homeViewModel.ts:204` |  |
| 141 | `dropTargetOfFavoriteCategory` | fun | port | `src/core/home/homeViewModel.ts:205` |  |
| 144 | `EDGE_TICK_MS` | val | port | `src/core/home/homeViewModel.ts:223` |  |
| 147 | `EDGE_ARM_NS` | val | port | `src/core/home/homeViewModel.ts:224` |  |
| 148 | `SHELF_ACTION_EXIT_MS` | val | port | `src/core/ui/designTokens.ts:47` |  |
| 156 | `SHELF_KEY_FAV_PREFIX` | val | port | `src/core/home/homeViewModel.ts:214` |  |
| 157 | `favShelfKey` | fun | port | `src/core/home/homeViewModel.ts:215` |  |
| 158 | `isFavShelfKey` | fun | port | `src/core/home/homeViewModel.ts:218` |  |
| 164 | `DragFlightKind` | type | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:334` |  |
| 175 | `DragFlight` | type | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:346` |  |
| 207 | `ShelfSelectBadge` | fun | port | `src/ui/components/shelf/CategoryPill.tsx:375` |  |
| 256 | `multiSelectGlassBar` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:27` |  |
| 371 | `MultiSelectTopBar` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:447` |  |
| 443 | `ShelfAction` | type | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:377` |  |
| 455 | `MultiSelectActionBar` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:490` |  |
| 548 | `MoreActionSheet` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:534` |  |
| 563 | `CategoryPickerSheet` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:573` |  |
| 620 | `ShelfSelectionHost` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:1840` |  |
| 987 | `PlaceholderBox` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:116` |  |
| 1027 | `DragStack` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:110` |  |
| 1150 | `DragFlightLayer` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:114` |  |
| 1295 | `HeartBurst` | fun | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:112` |  |
| 1451 | `SatelliteHeart` | type | port | `src/ui/components/shelf/ShelfSelectionHost.tsx:180` |  |

## com/example/ui/source/SourceInfoDialog.kt (41 行, 1 声明)

iOS 归属：`src/ui/components/source/SourceInfoDialog.tsx` / `src/ui/pages/SourceManagementPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `SourceInfoDialog` | fun | port | `src/ui/components/source/SourceInfoDialog.tsx:43` |  |

## com/example/ui/source/SourceManagementScreen.kt (1507 行, 54 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/ui/pages/SourceManagementPage.tsx` / `src/ui/components/source/SourceManagementParts.tsx` / `src/core/source/sourceViewModel.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 184 | `SourceAvatarRadius` | val | port | `src/ui/components/source/SourceManagementParts.tsx:49` | 改名：SourceAvatarRadius → SOURCE_AVATAR_RADIUS |
| 185 | `SourceIconRadius` | val | port | `src/ui/components/source/SourceManagementParts.tsx:50` | 改名：SourceIconRadius → SOURCE_ICON_RADIUS |
| 186 | `SourceImportRadius` | val | port | `src/ui/components/source/SourceManagementParts.tsx:51` | 改名：SourceImportRadius → SOURCE_IMPORT_RADIUS |
| 187 | `PillShape` | val | port | `src/ui/components/source/SourceManagementParts.tsx:52` |  |
| 190 | `SourcePageMargin` | val | port | `src/ui/components/source/SourceManagementParts.tsx:55` | 改名：SourcePageMargin → SOURCE_PAGE_MARGIN |
| 191 | `SourceCardGap` | val | port | `src/ui/components/source/SourceManagementParts.tsx:56` | 改名：SourceCardGap → SOURCE_CARD_GAP |
| 192 | `SourceHeaderHeight` | val | port | `src/ui/components/source/SourceManagementParts.tsx:57` | 改名：SourceHeaderHeight → SOURCE_HEADER_HEIGHT |
| 193 | `SourceRowHeight` | val | port | `src/ui/components/source/SourceManagementParts.tsx:58` | 改名：SourceRowHeight → SOURCE_ROW_HEIGHT |
| 194 | `SourceAvatarSize` | val | port | `src/ui/components/source/SourceManagementParts.tsx:59` | 改名：SourceAvatarSize → SOURCE_AVATAR_SIZE |
| 196 | `SourceRowDividerIndent` | val | port | `src/ui/components/source/SourceManagementParts.tsx:61` | 改名：SourceRowDividerIndent → SOURCE_ROW_DIVIDER_INDENT |
| 197 | `SourceQuickCardMinHeight` | val | port | `src/ui/components/source/SourceManagementParts.tsx:62` | 改名：SourceQuickCardMinHeight → SOURCE_QUICK_CARD_MIN_HEIGHT |
| 198 | `SourceQuickIconBox` | val | port | `src/ui/components/source/SourceManagementParts.tsx:63` | 改名：SourceQuickIconBox → SOURCE_QUICK_ICON_BOX |
| 199 | `SourceQuickIconSize` | val | port | `src/ui/components/source/SourceManagementParts.tsx:64` | 改名：SourceQuickIconSize → SOURCE_QUICK_ICON_SIZE |
| 200 | `SourceChipHeight` | val | port | `src/ui/components/source/SourceManagementParts.tsx:65` | 改名：SourceChipHeight → SOURCE_CHIP_HEIGHT |
| 201 | `SourceExpandRowHeight` | val | port | `src/ui/components/source/SourceManagementParts.tsx:66` | 改名：SourceExpandRowHeight → SOURCE_EXPAND_ROW_HEIGHT |
| 202 | `SourceImportRowHeight` | val | port | `src/ui/components/source/SourceManagementParts.tsx:67` | 改名：SourceImportRowHeight → SOURCE_IMPORT_ROW_HEIGHT |
| 203 | `SourceDividerWidth` | val | port | `src/ui/components/source/SourceManagementParts.tsx:68` | 改名：SourceDividerWidth → SOURCE_DIVIDER_WIDTH |
| 209 | `COMIC_GROUP_PREVIEW_COUNT` | val | port | `src/ui/components/source/SourceManagementParts.tsx:76` |  |
| 212 | `NUMERIC_FEATURE` | val | port | `src/ui/components/source/SourceManagementParts.tsx:79` |  |
| 215 | `GROUP_LETTER_SPACING` | val | port | `src/ui/components/source/SourceManagementParts.tsx:82` |  |
| 224 | `SourceNameStyle` | val | port | `src/core/ui/designTokens.ts:131` |  |
| 236 | `SourceIdStyle` | val | port | `src/core/ui/designTokens.ts:132` |  |
| 251 | `primaryText` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:10` |  |
| 255 | `secondaryText` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:10` |  |
| 264 | `accentText` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:101` |  |
| 276 | `accentContainer` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:10` |  |
| 280 | `dividerColor` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:10` |  |
| 288 | `SourceManagementScreen` | fun | port | `src/core/source/sourceViewModel.ts:111` |  |
| 678 | `SourceCollapsingTopBar` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:173` |  |
| 691 | `VENERA_IDLE` | val | port | `src/ui/components/source/SourceManagementParts.tsx:219` |  |
| 692 | `VENERA_BUSY` | val | port | `src/ui/components/source/SourceManagementParts.tsx:220` |  |
| 693 | `VENERA_DONE` | val | port | `src/ui/components/source/SourceManagementParts.tsx:221` |  |
| 697 | `SourceQuickTilesRow` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:392` |  |
| 772 | `SourceTileStatusText` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:14` |  |
| 784 | `SourceTileDivider` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:15` |  |
| 801 | `SourceQuickTile` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:15` |  |
| 875 | `SourceVeneraTile` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:15` |  |
| 931 | `VeneraSpinningIcon` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:16` |  |
| 961 | `BreathingDot` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:16` |  |
| 989 | `SourceGroupKind` | type | port | `src/ui/components/source/SourceManagementParts.tsx:435` |  |
| 991 | `SourceGroup` | type | port | `src/ui/components/source/SourceManagementParts.tsx:444` |  |
| 999 | `SourceLine` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:17` |  |
| 1018 | `SourceGroupCard` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:723` |  |
| 1118 | `SourceGroupHeader` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:18` |  |
| 1166 | `SourceCountBadge` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:18` |  |
| 1191 | `SourceExpandRestRow` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:19` |  |
| 1247 | `sourceAuthEpoch` | val | port | `src/core/source/sourceViewModel.ts:116` |  |
| 1250 | `SourceRow` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:20` |  |
| 1370 | `ActiveDot` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:20` |  |
| 1382 | `SourceMiniLabel` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:20` |  |
| 1403 | `SourceMiniActionChip` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:21` |  |
| 1438 | `SourceImportEntryRow` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:837` |  |
| 1475 | `dashedOutline` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:23` |  |
| 1502 | `desaturate` | fun | port | `src/ui/components/source/SourceManagementParts.tsx:23` |  |

## com/example/ui/source/ZLibraryLoginDialog.kt (286 行, 2 声明)

iOS 归属：`src/core/ui/designTokens.ts` / `src/ui/components/source/ZLibraryLoginDialog.tsx` / `src/ui/pages/LibraryPage.tsx` / `src/ui/components/source/SourceCredentialFields.tsx` / `src/ui/pages/SourceManagementPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 45 | `ZLibraryLoginDialog` | fun | port | `src/ui/components/source/ZLibraryLoginDialog.tsx:176` |  |
| 244 | `SourceCredentialFields` | fun | port | `src/ui/components/source/SourceCredentialFields.tsx:55` |  |

## com/example/ui/source/ZLibraryNodeManagementScreen.kt (513 行, 3 声明)

iOS 归属：`src/ui/components/source/ZLibraryNodeManagementScreen.tsx` / `src/ui/pages/SourceManagementPage.tsx` / `src/core/library/zLibraryNodeManager.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 61 | `ZLibraryNodeManagementScreen` | fun | port | `src/ui/components/source/ZLibraryNodeManagementScreen.tsx:367` |  |
| 333 | `probeNode` | fun | port | `src/ui/components/source/ZLibraryNodeManagementScreen.tsx:26` |  |
| 427 | `NodeCard` | fun | port | `src/ui/components/source/ZLibraryNodeManagementScreen.tsx:66` |  |

## com/example/ui/theme/AppFonts.kt (146 行, 1 声明)

iOS 归属：`src/core/ui-theme/appFonts.ts` / `src/core/ui-theme/type.ts` / `src/core/reader/readerScreenLogic.ts` / `src/ui/components/wenku/WenkuSectionHeader.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 40 | `AppFonts` | type | port | `src/core/reader/readerScreenLogic.ts:22` |  |

## com/example/ui/theme/AppInsets.kt (32 行, 2 声明)

iOS 归属：`src/core/ui-theme/appInsets.ts` / `src/ui/pages/StatisticsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `LocalAppBottomInset` | val | port | `src/core/ui-theme/appInsets.ts:8` |  |
| 31 | `LocalAppBottomInsetNoTabBar` | val | port | `src/core/ui-theme/appInsets.ts:8` |  |

## com/example/ui/theme/Color.kt (61 行, 19 声明)

iOS 归属：`src/core/ui-theme/color.ts` / `src/ui/components/comic/comicPanelDesign.tsx` / `src/core/glass/color.ts` / `src/core/comic/anime4KCnn.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `MintPrimary` | val | port | `src/core/ui-theme/color.ts:23` |  |
| 13 | `MintSecondary` | val | port | `src/core/ui-theme/color.ts:26` |  |
| 17 | `MintGold` | val | port | `src/core/ui-theme/color.ts:28` |  |
| 19 | `DarkCharcoal` | val | port | `src/core/ui-theme/color.ts:30` |  |
| 20 | `MediumGray` | val | port | `src/core/ui-theme/color.ts:31` |  |
| 21 | `DividerGray` | val | port | `src/core/ui-theme/color.ts:32` |  |
| 22 | `LightBg` | val | port | `src/core/ui-theme/color.ts:33` |  |
| 23 | `PureWhite` | val | port | `src/core/ui-theme/color.ts:34` |  |
| 26 | `SepiaBg` | val | port | `src/core/ui-theme/color.ts:37` |  |
| 27 | `SepiaText` | val | port | `src/core/ui-theme/color.ts:37` |  |
| 29 | `EyeGreenBg` | val | port | `src/core/ui-theme/color.ts:39` |  |
| 30 | `EyeGreenText` | val | port | `src/core/ui-theme/color.ts:39` |  |
| 32 | `NightBg` | val | port | `src/core/ui-theme/color.ts:41` |  |
| 33 | `NightText` | val | port | `src/core/ui-theme/color.ts:41` |  |
| 35 | `OledBg` | val | port | `src/core/ui-theme/color.ts:43` |  |
| 36 | `OledText` | val | port | `src/core/ui-theme/color.ts:43` |  |
| 39 | `luminance` | fun | port | `src/core/glass/color.ts:112` |  |
| 48 | `onColor` | fun | port | `src/core/glass/color.ts:112` |  |
| 56 | `glassTitleColor` | fun | port | `src/core/ui-theme/color.ts:272` |  |

## com/example/ui/theme/IosMotion.kt (71 行, 1 声明)

iOS 归属：`src/core/ui-theme/iosMotion.ts` / `src/core/app/navigation.ts` / `src/ui/tokens.ts` / `src/core/glass/motion.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 22 | `IosMotion` | type | port | `src/core/app/navigation.ts:46` |  |

## com/example/ui/theme/ModifierExtensions.kt (150 行, 3 声明)

iOS 归属：`src/core/ui-theme/modifierExtensions.ts` / `src/ui/pages/SettingsPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 32 | `clickableWithFeedback` | fun | port | `src/core/ui-theme/modifierExtensions.ts:15` |  |
| 91 | `clickableRowFeedback` | fun | port | `src/core/ui-theme/modifierExtensions.ts:16` |  |
| 138 | `animateAlpha` | fun | port | `src/core/ui-theme/modifierExtensions.ts:17` |  |

## com/example/ui/theme/Theme.kt (166 行, 6 声明)

iOS 归属：`src/ui/theme/theme.ts` / `src/core/ui/designTokens.ts` / `src/core/ui-theme/theme.ts` / `src/ui/theme/AppThemeContext.tsx` / `src/core/ui/parityMisc.ts` / `src/ui/state/appStore.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `LocalAppDarkTheme` | val | port | `src/ui/theme/AppThemeContext.tsx:10` |  |
| 22 | `themeTextContrast` | fun | port | `src/core/ui/parityMisc.ts:514` |  |
| 28 | `legibleThemeInk` | fun | port | `src/core/ui/parityMisc.ts:528` |  |
| 36 | `BasePrimaryColors` | val | port | `src/core/ui-theme/theme.ts:26` |  |
| 44 | `BaseSecondaryColors` | val | port | `src/core/ui-theme/theme.ts:31` |  |
| 54 | `MyApplicationTheme` | fun | port | `src/core/ui-theme/theme.ts:38` |  |

## com/example/ui/theme/Type.kt (139 行, 1 声明)

iOS 归属：`src/core/ui-theme/type.ts` / `src/core/i18n/strings.ts` / `src/ui/components/wenku/WenkuIcon.tsx` / `src/ui/tokens.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `Typography` | val | port | `src/core/i18n/strings.ts:294` |  |

## com/example/ui/wenku/ArchiveShelf.kt (1376 行, 34 声明)

iOS 归属：`src/core/wenku/shelfMetrics.ts` / `src/ui/components/wenku/ArchiveShelf.tsx` / `src/core/wenku/parityNames.ts` / `src/ui/components/GlassCardLayers.tsx` / `src/core/wenku/volumeRender.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 176 | `ArchiveShelf` | fun | port | `src/ui/components/wenku/ArchiveShelf.tsx:448` |  |
| 599 | `hapticsPerform` | fun | port | `src/core/wenku/parityNames.ts:412` |  |
| 604 | `ArchiveShelfCaption` | fun | port | `src/ui/components/wenku/ArchiveShelf.tsx:23` |  |
| 694 | `ShelfStepButton` | fun | port | `src/ui/components/wenku/ArchiveShelf.tsx:24` |  |
| 717 | `rememberShelfPainter` | fun | port | `src/core/wenku/parityNames.ts:423` |  |
| 751 | `METRICS_DEPTH_X` | val | port | `src/core/wenku/parityNames.ts:623` |  |
| 752 | `METRICS_DEPTH_Y` | val | port | `src/core/wenku/parityNames.ts:625` |  |
| 753 | `METRICS_ROW_STEP` | val | port | `src/core/wenku/parityNames.ts:627` |  |
| 754 | `METRICS_RADIUS` | val | port | `src/core/wenku/parityNames.ts:629` |  |
| 755 | `METRICS_MAX_VIEWPORT` | val | port | `src/core/wenku/parityNames.ts:409` |  |
| 756 | `SHELF_CENTRE_CURVE` | val | port | `src/ui/components/wenku/ArchiveShelf.tsx:105` |  |
| 759 | `smoothStep` | fun | port | `src/core/wenku/motion.ts:121` |  |
| 765 | `ShelfMetrics` | type | port | `src/core/wenku/shelfMetrics.ts:56` |  |
| 851 | `floorMod` | fun | port | `src/core/wenku/shelfMetrics.ts:176` |  |
| 858 | `wrapFocus` | fun | port | `src/core/wenku/shelfMetrics.ts:184` |  |
| 867 | `inkStartOf` | fun | port | `src/core/wenku/shelfMetrics.ts:192` |  |
| 869 | `inkProgressOf` | fun | port | `src/core/wenku/shelfMetrics.ts:197` |  |
| 878 | `loadingLiftPx` | fun | port | `src/core/wenku/shelfMetrics.ts:206` |  |
| 889 | `SHELF_DRAG_RATE` | val | port | `src/core/wenku/shelfMetrics.ts:18` |  |
| 890 | `SHELF_OMEGA` | val | port | `src/core/wenku/shelfMetrics.ts:18` |  |
| 896 | `ShelfScrollSimulation` | type | port | `src/core/wenku/shelfMetrics.ts:487` |  |
| 971 | `archiveSpineRuns` | fun | port | `src/core/wenku/volumeRender.ts:179` |  |
| 989 | `ShelfVolume` | type | port | `src/core/wenku/types.ts:148` |  |
| 1030 | `ShelfCoverStore` | type | port | `src/core/wenku/coverArt.ts:472` |  |
| 1067 | `shelfWarmWindow` | fun | port | `src/core/wenku/shelfMetrics.ts:285` |  |
| 1086 | `COVER_RASTER_BUDGET` | val | port | `src/ui/components/wenku/ArchiveShelf.tsx:102` |  |
| 1097 | `fallbackTint` | fun | port | `src/core/wenku/volumeRender.ts:225` |  |
| 1105 | `ArchiveShelfMemory` | type | port | `src/ui/components/wenku/ArchiveShelf.tsx:172` |  |
| 1120 | `shelfSlotOf` | fun | port | `src/core/wenku/shelfMetrics.ts:249` |  |
| 1129 | `slotOriginX` | fun | port | `src/core/wenku/shelfMetrics.ts:263` |  |
| 1135 | `slotOriginY` | fun | port | `src/core/wenku/shelfMetrics.ts:274` |  |
| 1140 | `ShelfScenePainter` | type | port | `src/core/wenku/shelfMetrics.ts:21` |  |
| 1342 | `withAlpha` | fun | port | `src/core/comic/comicSceneFx.ts:302` |  |
| 1347 | `shelfSemanticBox` | fun | port | `src/core/wenku/shelfMetrics.ts:22` |  |

## com/example/ui/wenku/ShelfCoverArt.kt (261 行, 9 声明)

iOS 归属：`src/core/wenku/coverArt.ts` / `src/core/ui-theme/color.ts` / `src/core/comic/anime4KCnn.ts` / `src/core/discover/design.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 43 | `blend` | fun | port | `src/core/ui-theme/color.ts:254` |  |
| 53 | `shade` | fun | port | `src/core/wenku/coverArt.ts:6` |  |
| 57 | `luminance` | fun | port | `src/core/discover/design.ts:42` |  |
| 61 | `inkOn` | fun | port | `src/core/wenku/coverArt.ts:109` |  |
| 70 | `rasterizeShelfCover` | fun | port | `src/core/wenku/coverArt.ts:9` |  |
| 101 | `generateShelfCover` | fun | port | `src/core/wenku/coverArt.ts:10` |  |
| 225 | `buildShelfLayout` | fun | port | `src/core/wenku/coverArt.ts:11` |  |
| 236 | `withAlphaInt` | fun | port | `src/core/wenku/coverArt.ts:114` |  |
| 240 | `dominantEdgeColor` | fun | port | `src/core/wenku/coverArt.ts:13` |  |

## com/example/ui/wenku/ShelfVolumeRender.kt (635 行, 17 声明)

iOS 归属：`src/core/wenku/parityNames.ts` / `src/core/wenku/volumeRender.ts` / `src/core/wenku/types.ts` / `src/ui/components/wenku/ArchiveShelf.tsx` / `src/core/wenku/tokens.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 37 | `ShelfVolumePose` | type | port | `src/core/wenku/types.ts:162` |  |
| 55 | `RESTING_VOLUME_POSE` | val | port | `src/core/wenku/volumeRender.ts:92` |  |
| 68 | `ShelfVolumeArt` | type | port | `src/core/wenku/types.ts:217` |  |
| 89 | `SpineRun` | type | port | `src/core/wenku/types.ts:133` |  |
| 102 | `ShelfOpenTimeline` | type | port | `src/core/wenku/tokens.ts:19` |  |
| 182 | `ShelfVolumeArtist` | type | port | `src/core/wenku/types.ts:26` |  |
| 544 | `MATERIAL_CLOTH` | val | port | `src/core/wenku/volumeRender.ts:83` |  |
| 545 | `MATERIAL_MATTE` | val | port | `src/core/wenku/volumeRender.ts:84` |  |
| 546 | `MATERIAL_GLOSS` | val | port | `src/core/wenku/volumeRender.ts:85` |  |
| 548 | `CLOTH_TILE_SEED` | val | port | `src/core/wenku/volumeRender.ts:87` |  |
| 549 | `CODE_ALPHA` | val | port | `src/core/wenku/tokens.ts:20` |  |
| 552 | `clothTile` | fun | port | `src/core/wenku/tokens.ts:280` |  |
| 571 | `ShelfVolumePaint` | type | port | `src/core/wenku/parityNames.ts:266` |  |
| 585 | `ShelfPalette` | type | port | `src/core/wenku/types.ts:186` |  |
| 617 | `volumeThicknessPx` | fun | port | `src/core/wenku/volumeRender.ts:233` |  |
| 624 | `volumeHeightScale` | fun | port | `src/core/wenku/volumeRender.ts:248` |  |
| 630 | `volumeMaterial` | fun | port | `src/core/wenku/volumeRender.ts:254` |  |

## com/example/ui/wenku/WenkuActionSheet.kt (50 行, 1 声明)

iOS 归属：`src/ui/components/source/ZLibraryLoginDialog.tsx` / `src/ui/components/wenku/index.ts` / `src/ui/components/wenku/WenkuActionSheet.tsx` / `src/ui/components/wenku/WenkuMenuHost.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 23 | `WenkuActionSheet` | fun | port | `src/ui/components/wenku/WenkuActionSheet.tsx:75` |  |

## com/example/ui/wenku/WenkuAnchors.kt (28 行, 2 声明)

iOS 归属：`src/core/wenku/parityNames.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `rememberWenkuAnchor` | fun | port | `src/core/wenku/parityNames.ts:365` |  |
| 26 | `wenkuAnchor` | fun | port | `src/core/wenku/parityNames.ts:384` |  |

## com/example/ui/wenku/WenkuCoverFlight.kt (840 行, 21 声明)

iOS 归属：`src/core/wenku/parityNames.ts` / `src/core/wenku/flight.ts` / `src/core/wenku/types.ts` / `src/core/wenku/motion.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 81 | `WENKU_MESH_COLUMNS` | val | port | `src/core/wenku/parityNames.ts:42` |  |
| 84 | `WENKU_MESH_ROWS` | val | port | `src/core/wenku/parityNames.ts:43` |  |
| 87 | `WENKU_MESH_EDGE_SAMPLES` | val | port | `src/core/wenku/parityNames.ts:44` |  |
| 89 | `PI_F` | val | port | `src/core/wenku/parityNames.ts:46` |  |
| 92 | `BACKING_ARGB` | val | port | `src/core/wenku/parityNames.ts:48` |  |
| 99 | `WenkuFlightRect` | type | port | `src/core/wenku/flight.ts:6` |  |
| 132 | `WenkuFlightPose` | type | port | `src/core/wenku/flight.ts:7` |  |
| 350 | `WenkuPlanePose` | type | port | `src/core/wenku/flight.ts:10` |  |
| 389 | `WenkuPaperMesh` | type | port | `src/core/wenku/flight.ts:11` |  |
| 408 | `WenkuPaperBrush` | type | port | `src/core/wenku/parityNames.ts:51` |  |
| 426 | `WenkuCoverSource` | type | port | `src/core/wenku/parityNames.ts:60` |  |
| 433 | `WenkuCoverTarget` | type | port | `src/core/wenku/parityNames.ts:63` |  |
| 441 | `WenkuCoverFlight` | fun | port | `src/core/wenku/flight.ts:4` |  |
| 517 | `WenkuCoverArrival` | fun | port | `src/core/wenku/parityNames.ts:66` |  |
| 527 | `WenkuCoverArrivalFrame` | fun | port | `src/core/wenku/flight.ts:13` |  |
| 621 | `WenkuCoverArrivalCache` | type | port | `src/core/wenku/parityNames.ts:69` |  |
| 641 | `toFlightRect` | fun | port | `src/core/wenku/parityNames.ts:72` |  |
| 644 | `toRect` | fun | port | `src/core/wenku/parityNames.ts:80` |  |
| 648 | `drawWenkuCoverFlight` | fun | port | `src/core/wenku/flight.ts:16` |  |
| 791 | `wenkuCoverSilhouette` | fun | port | `src/core/wenku/flight.ts:17` |  |
| 823 | `wenkuPaperFlight` | fun | port | `src/core/wenku/flight.ts:18` |  |

## com/example/ui/wenku/WenkuCoverSnapshots.kt (143 行, 4 声明)

iOS 归属：`src/core/wenku/parityNames.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 22 | `WenkuCoverSnapshots` | type | port | `src/core/wenku/parityNames.ts:100` |  |
| 56 | `WenkuFlightSources` | type | port | `src/core/wenku/parityNames.ts:125` |  |
| 81 | `WenkuCoverSnapshot` | fun | port | `src/core/wenku/parityNames.ts:144` |  |
| 109 | `rasterizeWenkuCover` | fun | port | `src/core/wenku/parityNames.ts:152` |  |

## com/example/ui/wenku/WenkuFlightBridge.kt (199 行, 5 声明)

iOS 归属：`src/core/wenku/flight.ts` / `src/core/wenku/coverArt.ts` / `src/core/wenku/types.ts` / `src/core/wenku/index.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 26 | `WenkuFlightRequest` | type | port | `src/core/wenku/flight.ts:20` |  |
| 44 | `WenkuFlightBridge` | type | port | `src/core/wenku/coverArt.ts:21` |  |
| 94 | `fitWenkuCover` | fun | port | `src/core/wenku/coverArt.ts:196` |  |
| 114 | `cropCoverToAspect` | fun | port | `src/core/wenku/coverArt.ts:23` |  |
| 139 | `WenkuFlightOverlay` | fun | port | `src/core/wenku/flight.ts:26` |  |

## com/example/ui/wenku/WenkuGlass.kt (794 行, 14 声明)

iOS 归属：`src/ui/components/wenku/WenkuGlass.tsx` / `src/core/wenku/parityNames.ts` / `src/ui/components/ReleaseHistoryDialog.tsx` / `src/ui/pages/ThemePalettePage.tsx` / `src/ui/components/wenku/WenkuSectionHeader.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 82 | `WenkuNoHighlight` | val | port | `src/core/wenku/parityNames.ts:399` |  |
| 83 | `WenkuNoShadow` | val | port | `src/core/wenku/parityNames.ts:401` |  |
| 89 | `WenkuGlassSurface` | fun | port | `src/ui/components/wenku/WenkuGlass.tsx:2` |  |
| 236 | `WenkuIconButton` | fun | port | `src/ui/components/wenku/WenkuGlass.tsx:258` |  |
| 319 | `WenkuTextButton` | fun | port | `src/ui/components/wenku/WenkuGlass.tsx:346` |  |
| 419 | `rememberWenkuSearchMotion` | fun | port | `src/ui/components/wenku/WenkuGlass.tsx:883` |  |
| 437 | `WenkuExpandableSearch` | fun | port | `src/ui/components/wenku/WenkuGlass.tsx:597` |  |
| 503 | `WenkuSearchField` | fun | port | `src/ui/components/wenku/WenkuGlass.tsx:478` |  |
| 586 | `WenkuPillButton` | fun | port | `src/ui/components/wenku/WenkuGlass.tsx:687` |  |
| 652 | `WenkuJellyTapSurface` | fun | port | `src/ui/components/wenku/WenkuGlass.tsx:767` |  |
| 681 | `WenkuContentPanel` | fun | port | `src/ui/components/wenku/WenkuContentPanel.tsx:94` |  |
| 717 | `WenkuMenu` | fun | port | `src/ui/components/wenku/WenkuGlass.tsx:821` |  |
| 735 | `WenkuSectionHeader` | fun | port | `src/ui/components/wenku/WenkuSectionHeader.tsx:129` |  |
| 791 | `WenkuHairline` | fun | port | `src/ui/components/wenku/WenkuSectionHeader.tsx:201` |  |

## com/example/ui/wenku/WenkuGlassFilters.kt (67 行, 2 声明)

iOS 归属：`src/core/wenku/parityNames.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 25 | `WenkuGlassFilters` | type | port | `src/core/wenku/parityNames.ts:277` |  |
| 61 | `wenkuGlassBlur` | fun | port | `src/core/wenku/parityNames.ts:323` |  |

## com/example/ui/wenku/WenkuIcon.kt (582 行, 19 声明)

iOS 归属：`src/core/wenku/iconMotion.ts` / `src/core/wenku/iconArt.ts` / `src/ui/components/wenku/WenkuIconContact.tsx` / `src/core/wenku/parityNames.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 72 | `WenkuIconContact` | type | port | `src/core/wenku/iconMotion.ts:41` |  |
| 78 | `LocalWenkuIconContact` | val | port | `src/ui/components/wenku/WenkuIconContact.tsx:24` |  |
| 85 | `WenkuEaseOutCubic` | val | port | `src/core/wenku/iconMotion.ts:13` |  |
| 88 | `WENKU_ENTRANCE_NONE` | val | port | `src/core/wenku/iconMotion.ts:35` |  |
| 91 | `WENKU_AMBIENT_REST_MS` | val | port | `src/core/wenku/iconMotion.ts:38` |  |
| 94 | `gesturePhase` | fun | port | `src/core/wenku/iconMotion.ts:71` |  |
| 100 | `sampleGesture` | fun | port | `src/core/wenku/iconMotion.ts:77` |  |
| 106 | `pressGesture` | fun | port | `src/core/wenku/iconMotion.ts:83` |  |
| 116 | `baseStrokeWidth` | fun | port | `src/core/wenku/iconMotion.ts:89` |  |
| 126 | `drawWenkuPose` | fun | port | `src/core/wenku/iconMotion.ts:20` |  |
| 154 | `drawWenkuCrossfade` | fun | port | `src/core/wenku/iconArt.ts:506` |  |
| 171 | `drawWenkuStrokes` | fun | port | `src/core/wenku/iconArt.ts:491` |  |
| 208 | `WenkuIconEntranceBatch` | type | port | `src/core/wenku/parityNames.ts:436` |  |
| 250 | `WenkuGlyphClock` | type | port | `src/core/wenku/iconMotion.ts:21` |  |
| 283 | `WenkuIcon` | fun | port | `src/ui/components/wenku/WenkuIcon.tsx:1093` |  |
| 342 | `WenkuIconResponse` | fun | port | `src/core/wenku/parityNames.ts:452` |  |
| 419 | `WenkuIconStill` | fun | port | `src/core/wenku/parityNames.ts:455` |  |
| 448 | `WenkuIconAnimated` | fun | port | `src/core/wenku/parityNames.ts:458` |  |
| 569 | `rememberWenkuForeground` | fun | port | `src/core/wenku/iconMotion.ts:248` |  |

## com/example/ui/wenku/WenkuIconArt.kt (1457 行, 12 声明)

iOS 归属：`src/core/wenku/iconArt.ts` / `src/core/wenku/iconMotion.ts` / `src/core/ui/kotlinAuthorityConstants.ts` / `src/ui/components/wenku/WenkuIcon.tsx` / `src/ui/components/wenku/WenkuGlass.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 22 | `WenkuSymbol` | type | port | `src/ui/components/wenku/WenkuIcon.tsx:35` |  |
| 118 | `WenkuIconGesture` | type | port | `src/core/wenku/iconMotion.ts:52` |  |
| 140 | `WenkuIconPose` | type | port | `src/core/wenku/iconArt.ts:154` |  |
| 147 | `WenkuIconStroke` | type | port | `src/core/wenku/iconArt.ts:161` |  |
| 159 | `WenkuIconMotion` | type | port | `src/core/wenku/iconArt.ts:191` |  |
| 201 | `WenkuIconPoses` | type | port | `src/core/wenku/iconArt.ts:215` |  |
| 235 | `WenkuIconArt` | type | port | `src/core/ui/kotlinAuthorityConstants.ts:33` |  |
| 248 | `WenkuMat` | type | port | `src/core/wenku/iconArt.ts:392` |  |
| 285 | `WenkuTrace` | type | port | `src/core/wenku/iconArt.ts:392` |  |
| 329 | `WenkuArtBuilder` | type | port | `src/core/wenku/iconArt.ts:410` |  |
| 506 | `xy` | fun | port | `src/core/wenku/iconArt.ts:463` |  |
| 513 | `foldDrawing` | fun | port | `src/core/wenku/iconArt.ts:318` |  |

## com/example/ui/wenku/WenkuIconMapping.kt (164 行, 3 声明)

iOS 归属：`src/ui/components/wenku/WenkuIcon.tsx` / `src/core/wenku/iconArt.ts` / `src/core/wenku/parityNames.ts` / `src/ui/components/wenku/index.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 32 | `wenkuSymbolForIconName` | fun | port | `src/ui/components/wenku/WenkuIcon.tsx:808` |  |
| 122 | `wenkuSymbolOrNull` | fun | port | `src/core/wenku/parityNames.ts:461` |  |
| 127 | `WenkuButtonGlyph` | fun | port | `src/ui/components/wenku/WenkuIcon.tsx:1154` |  |

## com/example/ui/wenku/WenkuLoadingHandoff.kt (77 行, 1 声明)

iOS 归属：`src/ui/components/wenku/WenkuLoadingHandoff.tsx` / `src/ui/components/comic/ComicChaptersSkeletons.tsx` / `src/ui/components/library/LibrarySearchSkeleton.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 29 | `WenkuLoadingHandoff` | fun | port | `src/ui/components/wenku/WenkuLoadingHandoff.tsx:214` |  |

## com/example/ui/wenku/WenkuMenuHost.kt (1110 行, 39 声明)

iOS 归属：`src/core/wenku/menuGeometry.ts` / `src/core/wenku/menuHost.ts` / `src/ui/components/wenku/WenkuMenuHost.tsx` / `src/ui/components/wenku/WenkuActionSheet.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 120 | `WenkuEaseOut` | val | port | `src/core/wenku/menuGeometry.ts:9` |  |
| 123 | `WenkuEaseInOut` | val | port | `src/core/wenku/menuGeometry.ts:10` |  |
| 126 | `WenkuMenuWidthCurve` | val | port | `src/core/wenku/menuGeometry.ts:11` |  |
| 129 | `WenkuMenuHeightCurve` | val | port | `src/core/wenku/menuGeometry.ts:12` |  |
| 132 | `WenkuPlaneCurve` | val | port | `src/core/wenku/menuGeometry.ts:13` |  |
| 135 | `WenkuMenuHitThreshold` | val | port | `src/core/wenku/menuGeometry.ts:14` |  |
| 138 | `WenkuMenuContentThreshold` | val | port | `src/core/wenku/menuGeometry.ts:15` |  |
| 141 | `WenkuMenuStaggerStart` | val | port | `src/core/wenku/menuGeometry.ts:85` |  |
| 142 | `WenkuMenuStaggerEnd` | val | port | `src/core/wenku/menuGeometry.ts:86` |  |
| 145 | `WenkuMenuStaggerStep` | val | port | `src/core/wenku/menuGeometry.ts:87` |  |
| 146 | `WenkuMenuStaggerMaxOrder` | val | port | `src/core/wenku/menuGeometry.ts:88` |  |
| 149 | `WenkuMenuBarrier` | val | port | `src/core/wenku/menuGeometry.ts:17` |  |
| 152 | `WenkuSheetBarrier` | val | port | `src/core/wenku/menuGeometry.ts:18` |  |
| 155 | `WenkuStaticPhase` | val | port | `src/core/wenku/menuGeometry.ts:19` |  |
| 162 | `wenkuMenuSourceAlpha` | fun | port | `src/core/wenku/menuGeometry.ts:101` |  |
| 169 | `LocalWenkuMenuPhase` | val | port | `src/ui/components/wenku/WenkuMenuHost.tsx:357` |  |
| 196 | `WenkuMenuStretch` | fun | port | `src/core/wenku/menuHost.ts:95` |  |
| 233 | `WenkuMenuHost` | fun | port | `src/ui/components/wenku/WenkuMenuHost.tsx:99` |  |
| 379 | `WenkuSheetHost` | fun | port | `src/core/wenku/menuHost.ts:140` |  |
| 586 | `WenkuStaggerPart` | fun | port | `src/ui/components/wenku/WenkuMenuHost.tsx:377` |  |
| 622 | `WenkuMenuTrigger` | fun | port | `src/ui/components/wenku/WenkuMenuHost.tsx:400` |  |
| 646 | `WenkuMenuGeometry` | type | port | `src/core/wenku/menuHost.ts:39` |  |
| 663 | `WenkuMenuStretchCore` | fun | port | `src/core/wenku/menuHost.ts:106` |  |
| 778 | `wenkuLerp` | fun | port | `src/core/wenku/menuGeometry.ts:106` |  |
| 781 | `wenkuLerpRect` | fun | port | `src/core/wenku/menuGeometry.ts:111` |  |
| 788 | `wenkuEaseOutCubic` | fun | port | `src/core/wenku/menuGeometry.ts:121` |  |
| 791 | `wenkuInterval` | fun | port | `src/core/wenku/menuGeometry.ts:133` |  |
| 798 | `wenkuRevealProgress` | fun | port | `src/core/wenku/menuGeometry.ts:144` |  |
| 808 | `wenkuMenuCurrentRect` | fun | port | `src/core/wenku/menuGeometry.ts:163` |  |
| 823 | `wenkuMenuContentAlpha` | fun | port | `src/core/wenku/menuGeometry.ts:178` |  |
| 827 | `wenkuMenuViewportRadius` | fun | port | `src/core/wenku/menuGeometry.ts:183` |  |
| 840 | `wenkuSafeRect` | fun | port | `src/core/wenku/menuGeometry.ts:196` |  |
| 854 | `wenkuMenuArea` | fun | port | `src/core/wenku/menuGeometry.ts:208` |  |
| 865 | `wenkuMenuTargetRect` | fun | port | `src/core/wenku/menuGeometry.ts:225` |  |
| 883 | `wenkuPointerGate` | fun | port | `src/core/wenku/menuGeometry.ts:33` |  |
| 913 | `sheetDragModifier` | fun | port | `src/core/wenku/menuGeometry.ts:34` |  |
| 981 | `WenkuSheetSurface` | fun | port | `src/core/wenku/menuHost.ts:117` |  |
| 1035 | `WenkuSheetDialog` | fun | port | `src/core/wenku/menuHost.ts:133` |  |
| 1100 | `WenkuSheetRegistry` | type | port | `src/core/wenku/menuHost.ts:151` |  |

## com/example/ui/wenku/WenkuMotion.kt (601 行, 26 声明)

iOS 归属：`src/core/wenku/motion.ts` / `src/ui/components/wenku/WenkuAccessibility.tsx` / `src/core/wenku/parityNames.ts` / `src/ui/components/wenku/WenkuLoadingHandoff.tsx` / `src/ui/components/wenku/WenkuSectionHeader.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 81 | `LocalWenkuSequence` | val | port | `src/ui/components/wenku/WenkuAccessibility.tsx:42` |  |
| 82 | `LocalWenkuSceneSequence` | val | port | `src/ui/components/wenku/WenkuAccessibility.tsx:44` |  |
| 83 | `LocalWenkuPaneVisible` | val | port | `src/ui/components/wenku/WenkuAccessibility.tsx:46` |  |
| 89 | `WenkuLoadedContentSequence` | fun | port | `src/ui/components/wenku/WenkuLoadedContentSequence.tsx:110` |  |
| 117 | `WenkuContentClock` | fun | port | `src/core/wenku/parityNames.ts:474` |  |
| 125 | `WenkuRevealAxis` | type | port | `src/core/wenku/motion.ts:394` |  |
| 129 | `wenkuReveal` | fun | port | `src/core/wenku/motion.ts:430` |  |
| 135 | `wenkuArchivePart` | fun | port | `src/core/wenku/motion.ts:413` |  |
| 175 | `wenkuTabTitle` | fun | port | `src/core/wenku/motion.ts:439` |  |
| 193 | `revealProgress` | fun | port | `src/core/wenku/motion.ts:398` |  |
| 203 | `WenkuPlaneTabSwitcher` | fun | port | `src/core/wenku/motion.ts:33` |  |
| 295 | `WenkuTabTransition` | type | port | `src/core/wenku/parityNames.ts:482` |  |
| 303 | `wenkuRetainedLayout` | fun | port | `src/core/wenku/motion.ts:453` |  |
| 314 | `RetainedPaneLifecycle` | fun | port | `src/core/wenku/motion.ts:33` |  |
| 346 | `wenkuPlaneLayer` | fun | port | `src/core/wenku/motion.ts:458` |  |
| 401 | `wenkuBlockPointer` | fun | port | `src/core/wenku/motion.ts:485` |  |
| 416 | `rememberWenkuReaderChrome` | fun | port | `src/core/wenku/parityNames.ts:500` |  |
| 431 | `WenkuReaderChromePart` | type | port | `src/core/wenku/motion.ts:510` |  |
| 444 | `WenkuReaderChromeLayer` | fun | port | `src/core/wenku/parityNames.ts:517` |  |
| 478 | `readerLocationEase` | val | port | `src/core/wenku/motion.ts:391` |  |
| 481 | `wenkuReaderLocation` | fun | port | `src/core/wenku/motion.ts:490` |  |
| 488 | `wenkuReaderCapsule` | fun | port | `src/core/wenku/motion.ts:502` |  |
| 495 | `WenkuReaderProgressSlider` | fun | port | `src/core/wenku/parityNames.ts:544` |  |
| 529 | `WenkuScrollEdgeFade` | fun | port | `src/core/wenku/motion.ts:34` |  |
| 570 | `WenkuSkeletonBlock` | fun | port | `src/ui/components/wenku/WenkuLoadingHandoff.tsx:164` |  |
| 581 | `WenkuLoadingHandoff` | fun | port | `src/ui/components/wenku/WenkuLoadingHandoff.tsx:214` |  |

## com/example/ui/wenku/WenkuPageEntrance.kt (46 行, 2 声明)

iOS 归属：`src/core/wenku/parityNames.ts` / `src/ui/shared/pullOutHosts.ts` / `src/ui/pages/ThemePalettePage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `WenkuPageEntrance` | fun | port | `src/core/wenku/parityNames.ts:340` |  |
| 46 | `wenkuPagePart` | fun | port | `src/core/wenku/parityNames.ts:360` |  |

## com/example/ui/wenku/WenkuReflow.kt (668 行, 23 声明)

iOS 归属：`src/core/wenku/parityNames.ts` / `src/core/wenku/reflow.ts` / `src/ui/components/wenku/WenkuReflow.tsx` / `src/core/wenku/motion.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 77 | `REFLOW_DURATION_MS` | val | port | `src/core/wenku/parityNames.ts:604` |  |
| 80 | `WORKSPACE_CLOSE_MS` | val | port | `src/core/wenku/parityNames.ts:605` |  |
| 83 | `REFLOW_STAGGER_STEP` | val | port | `src/core/wenku/parityNames.ts:600` |  |
| 84 | `REFLOW_STAGGER_BANDS` | val | port | `src/core/wenku/parityNames.ts:602` |  |
| 87 | `REFLOW_RISE_DP` | val | port | `src/core/wenku/parityNames.ts:607` |  |
| 89 | `WORKSPACE_WIDE_MIN_WIDTH_DP` | val | port | `src/core/wenku/parityNames.ts:632` |  |
| 90 | `WORKSPACE_WIDE_MIN_HEIGHT_DP` | val | port | `src/core/wenku/parityNames.ts:634` |  |
| 91 | `WORKSPACE_MAX_WIDTH_DP` | val | port | `src/core/wenku/parityNames.ts:636` |  |
| 92 | `WORKSPACE_SELECTED_MAX_WIDTH_DP` | val | port | `src/core/wenku/parityNames.ts:638` |  |
| 93 | `WORKSPACE_GAP_DP` | val | port | `src/core/wenku/parityNames.ts:640` |  |
| 96 | `ReflowEasing` | val | port | `src/core/wenku/motion.ts:27` |  |
| 102 | `LocalWenkuReflowState` | val | port | `src/ui/components/wenku/WenkuReflow.tsx:13` |  |
| 112 | `WenkuReflowState` | type | port | `src/core/wenku/parityNames.ts:175` |  |
| 320 | `rememberWenkuReflowState` | fun | port | `src/core/wenku/parityNames.ts:210` |  |
| 328 | `staggerProgress` | fun | port | `src/core/wenku/reflow.ts:68` |  |
| 346 | `WenkuReflowItem` | fun | port | `src/core/wenku/parityNames.ts:218` |  |
| 362 | `wenkuReflowItemLayer` | fun | port | `src/core/wenku/reflow.ts:17` |  |
| 414 | `WenkuReflowScope` | fun | port | `src/core/wenku/parityNames.ts:224` |  |
| 459 | `WenkuReflowViewport` | fun | port | `src/core/wenku/parityNames.ts:169` |  |
| 494 | `WenkuSplitWorkspace` | fun | port | `src/core/wenku/parityNames.ts:228` |  |
| 608 | `wenkuHiddenDraw` | fun | port | `src/core/wenku/reflow.ts:26` |  |
| 616 | `wenkuDetailPlane` | fun | port | `src/core/wenku/reflow.ts:19` |  |
| 654 | `wenkuBlockWhile` | fun | port | `src/core/wenku/reflow.ts:26` |  |

## com/example/ui/wenku/WenkuTextMotion.kt (132 行, 3 声明)

iOS 归属：`src/core/wenku/motion.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 40 | `WenkuMorphText` | fun | port | `src/core/wenku/motion.ts:211` |  |
| 105 | `TEXT_FOLD_MS` | val | port | `src/core/wenku/motion.ts:221` |  |
| 112 | `WenkuCountUp` | fun | port | `src/core/wenku/motion.ts:211` |  |

## com/example/ui/wenku/WenkuTokens.kt (348 行, 16 声明)

iOS 归属：`src/core/wenku/tokens.ts` / `src/ui/components/wenku/WenkuAccessibility.tsx` / `src/ui/components/wenku/WenkuGlass.tsx` / `src/ui/components/wenku/WenkuLoadingHandoff.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 31 | `WenkuTokens` | type | port | `src/core/wenku/tokens.ts:4` |  |
| 97 | `WenkuShapes` | type | port | `src/core/wenku/tokens.ts:499` |  |
| 108 | `WenkuSpacing` | type | port | `src/core/wenku/tokens.ts:511` |  |
| 121 | `WenkuMotion` | type | port | `src/core/wenku/tokens.ts:9` |  |
| 223 | `WenkuColors` | type | port | `src/core/wenku/tokens.ts:524` |  |
| 241 | `wenkuColors` | fun | port | `src/core/wenku/tokens.ts:476` |  |
| 269 | `LocalWenkuMainSurface` | val | port | `src/ui/components/wenku/WenkuAccessibility.tsx:31` |  |
| 272 | `LocalWenkuHighContrast` | val | port | `src/ui/components/wenku/WenkuAccessibility.tsx:33` |  |
| 275 | `LocalWenkuReduceMotion` | val | port | `src/ui/components/wenku/WenkuAccessibility.tsx:35` |  |
| 278 | `LocalWenkuBlurEnabled` | val | port | `src/ui/components/wenku/WenkuAccessibility.tsx:37` |  |
| 281 | `LocalWenkuDecorativeMotion` | val | port | `src/ui/components/wenku/WenkuAccessibility.tsx:39` |  |
| 283 | `WenkuAccessibility` | type | port | `src/core/wenku/tokens.ts:579` |  |
| 292 | `rememberWenkuAccessibility` | fun | port | `src/ui/components/wenku/WenkuAccessibility.tsx:99` |  |
| 307 | `readHighContrast` | fun | port | `src/core/wenku/tokens.ts:590` |  |
| 316 | `wenkuSmooth` | fun | port | `src/core/wenku/tokens.ts:599` |  |
| 322 | `WenkuReaderPhysics` | type | port | `src/core/wenku/tokens.ts:605` |  |

## com/example/ui/wenku/WenkuVolumeFlight.kt (250 行, 6 声明)

iOS 归属：`src/core/wenku/parityNames.ts` / `src/core/wenku/flight.ts` / `src/core/wenku/tokens.ts` / `src/core/wenku/types.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 41 | `WenkuVolumeFlightRequest` | type | port | `src/core/wenku/parityNames.ts:569` |  |
| 57 | `WenkuVolumeFlightBridge` | type | port | `src/core/wenku/parityNames.ts:576` |  |
| 154 | `WenkuVolumeFlightOverlay` | fun | port | `src/core/wenku/parityNames.ts:253` |  |
| 215 | `drawFlightVolume` | fun | port | `src/core/wenku/parityNames.ts:592` |  |
| 247 | `ARRIVE_P` | val | port | `src/core/wenku/parityNames.ts:246` |  |
| 250 | `CLOSE_FADE_IN` | val | port | `src/core/wenku/parityNames.ts:248` |  |

## com/ramotion/fluidslider/FluidSlider.kt (599 行, 1 声明)

iOS 归属：`src/core/components/fluidSlider.ts` / `src/core/reader/readerScreenLogic.ts` / `src/ui/pages/CardAppearancePage.tsx` / `src/ui/pages/ReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 20 | `FluidSlider` | type | port | `src/core/components/fluidSlider.ts:2` |  |

## com/ramotion/fluidslider/FluidSliderCompose.kt (32 行, 1 声明)

iOS 归属：`src/core/components/fluidSlider.ts` / `src/core/reader/readerScreenLogic.ts` / `src/ui/pages/CardAppearancePage.tsx` / `src/ui/pages/ReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `FluidSlider` | fun | port | `src/core/components/fluidSlider.ts:2` |  |

## com/swapnil/squishyswitch/presentation/SquishyToggle.kt (194 行, 1 声明)

iOS 归属：`src/ui/components/AppSwitch.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 50 | `SquishyToggleSwitch` | fun | port | `src/ui/components/AppSwitch.tsx:11` |  |

## eu/wewox/pagecurl/ExperimentalPageCurlApi.kt (10 行, 1 声明)

iOS 归属：`src/core/pagecurl/pageCurl.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 10 | `ExperimentalPageCurlApi` | type | port | `src/core/pagecurl/pageCurl.ts:28` |  |

## eu/wewox/pagecurl/config/PageCurlConfig.kt (398 行, 5 声明)

iOS 归属：`src/core/pagecurl/pageCurl.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 45 | `rememberPageCurlConfig` | fun | port | `src/core/ui/parityMisc.ts:699` |  |
| 197 | `PageCurlConfig` | type | port | `src/core/pagecurl/pageCurl.ts:26` |  |
| 388 | `full` | fun | port | `src/core/pagecurl/pageCurl.ts:26` |  |
| 393 | `leftHalf` | fun | port | `src/core/pagecurl/pageCurl.ts:26` |  |
| 398 | `rightHalf` | fun | port | `src/core/pagecurl/pageCurl.ts:26` |  |

## eu/wewox/pagecurl/page/CurlDraw.kt (268 行, 8 声明)

iOS 归属：`src/core/pagecurl/pageCurl.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 32 | `drawCurl` | fun | port | `src/core/pagecurl/pageCurl.ts:441` |  |
| 84 | `drawOnlyContent` | fun | port | `src/core/pagecurl/pageCurl.ts:450` |  |
| 92 | `drawNothing` | fun | port | `src/core/pagecurl/pageCurl.ts:455` |  |
| 98 | `prepareClippedContent` | fun | port | `src/core/pagecurl/pageCurl.ts:460` |  |
| 116 | `prepareCurl` | fun | port | `src/core/pagecurl/pageCurl.ts:465` |  |
| 187 | `prepareShadow` | fun | port | `src/core/pagecurl/pageCurl.ts:475` |  |
| 225 | `prepareShadowApi28` | fun | port | `src/core/pagecurl/pageCurl.ts:480` |  |
| 240 | `prepareShadowImage` | fun | port | `src/core/pagecurl/pageCurl.ts:485` |  |

## eu/wewox/pagecurl/page/DragCommonGesture.kt (171 行, 4 声明)

iOS 归属：`src/core/pagecurl/pageCurl.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 26 | `DragConfig` | type | port | `src/core/pagecurl/pageCurl.ts:224` |  |
| 36 | `detectCurlGestures` | fun | port | `src/core/ui/parityMisc.ts:719` |  |
| 112 | `detectCustomDragGestures` | fun | port | `src/core/pagecurl/pageCurl.ts:22` |  |
| 148 | `NewEdgeCreator` | type | port | `src/core/pagecurl/pageCurl.ts:237` |  |

## eu/wewox/pagecurl/page/DragGesture.kt (81 行, 1 声明)

iOS 归属：`src/core/pagecurl/pageCurl.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `dragGesture` | fun | port | `src/core/pagecurl/pageCurl.ts:24` |  |

## eu/wewox/pagecurl/page/DragStartEnd.kt (83 行, 1 声明)

iOS 归属：`src/core/pagecurl/pageCurl.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `dragStartEnd` | fun | port | `src/core/pagecurl/pageCurl.ts:23` |  |

## eu/wewox/pagecurl/page/PageCurl.kt (170 行, 1 声明)

iOS 归属：`src/ui/components/pageturn/PageCurlReaderContainer.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 29 | `PageCurl` | fun | port | `src/ui/components/pageturn/PageCurlReaderContainer.tsx:16` |  |

## eu/wewox/pagecurl/page/PageCurlState.kt (310 行, 7 声明)

iOS 归属：`src/core/pagecurl/pageCurl.ts` / `src/platform/web/webPageCurl.ts` / `src/ui/components/pageturn/PageCurlReaderContainer.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 35 | `rememberPageCurlState` | fun | port | `src/ui/components/pageturn/PageCurlReaderContainer.tsx:12` |  |
| 125 | `PageCurlState` | type | port | `src/platform/web/webPageCurl.ts:167` |  |
| 262 | `Edge` | type | port | `src/core/pagecurl/pageCurl.ts:134` |  |
| 278 | `DefaultNext` | val | port | `src/core/pagecurl/pageCurl.ts:173` |  |
| 289 | `DefaultPrev` | val | port | `src/core/pagecurl/pageCurl.ts:16` |  |
| 300 | `DefaultAnimDuration` | val | port | `src/core/pagecurl/pageCurl.ts:140` |  |
| 301 | `DefaultMidPointDuration` | val | port | `src/core/pagecurl/pageCurl.ts:142` |  |

## eu/wewox/pagecurl/page/TapGesture.kt (49 行, 1 声明)

iOS 归属：`src/core/pagecurl/pageCurl.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 15 | `tapGesture` | fun | port | `src/core/pagecurl/pageCurl.ts:412` |  |

## eu/wewox/pagecurl/utils/MathUtils.kt (30 行, 2 声明)

iOS 归属：`src/core/pagecurl/pageCurl.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `rotate` | fun | port | `src/core/pagecurl/pageCurl.ts:47` |  |
| 13 | `lineLineIntersection` | fun | port | `src/core/pagecurl/pageCurl.ts:54` |  |

## eu/wewox/pagecurl/utils/Polygon.kt (47 行, 2 声明)

iOS 归属：`src/core/pagecurl/pageCurl.ts` / `src/platform/ios-native/index.ts` / `src/ui/pages/ComicReaderOnlinePage.tsx` / `src/core/parser/mobiParser.ts` / `src/core/reader/touchZones.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 6 | `Polygon` | type | port | `src/core/pagecurl/pageCurl.ts:78` |  |
| 44 | `normalized` | fun | port | `src/core/pagecurl/pageCurl.ts:72` |  |

## eu/wewox/pagecurl/utils/RectUtils.kt (11 行, 1 声明)

iOS 归属：`src/platform/raster/pixCodec.ts` / `src/platform/web/webAgslShader.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `multiply` | fun | port | `src/platform/raster/pixCodec.ts:317` |  |

## me/trishiraj/shadowglow/Animation.kt (61 行, 2 声明)

iOS 归属：`src/ui/components/feedback/shadowGlowAnimation.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 18 | `rememberAnimatedBreathingValue` | fun | port | `src/ui/components/feedback/shadowGlowAnimation.ts:118` |  |
| 43 | `rememberGlowTrailProgess` | fun | port | `src/ui/components/feedback/shadowGlowAnimation.ts:119` |  |

## me/trishiraj/shadowglow/Drawing.kt (119 行, 3 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/glass/glowDrawCache.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `toAndroidPath` | fun | port | `src/core/ui/parityMisc.ts:537` |  |
| 45 | `shadowOutlineSignature` | fun | port | `src/core/ui/parityMisc.ts:542` |  |
| 78 | `drawGlowTrailAlongShape` | fun | port | `src/core/ui/parityMisc.ts:547` |  |

## me/trishiraj/shadowglow/GlowDrawCache.kt (99 行, 2 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/glass/glowDrawCache.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 14 | `RoundRectGlowDrawCache` | type | port | `src/core/glass/glowDrawCache.ts:215` |  |
| 67 | `GlowTrailDrawCache` | type | port | `src/core/glass/glowDrawCache.ts:414` |  |

## me/trishiraj/shadowglow/Parallax.kt (81 行, 1 声明)

iOS 归属：`src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 19 | `rememberGyroParallaxState` | fun | port | `src/core/ui/gyroParallax.ts:7` |  |

## me/trishiraj/shadowglow/ShadowBlurEngine.kt (580 行, 21 声明)

iOS 归属：`src/core/glass/shadowBlurEngine.ts` / `src/core/glass/glowDrawCache.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 66 | `SHADOW_PERF_LOG` | val | port | `src/core/glass/shadowBlurEngine.ts:42` |  |
| 67 | `SHADOW_PERF_LOG_EVERY` | val | port | `src/core/glass/shadowBlurEngine.ts:44` |  |
| 84 | `ShadowCacheBucket` | type | port | `src/core/glass/shadowBlurEngine.ts:47` |  |
| 93 | `SHADOW_MASK_CACHE_BYTES_STATIC` | val | port | `src/core/glass/shadowBlurEngine.ts:51` |  |
| 102 | `SHADOW_MASK_CACHE_BYTES_ANIMATED` | val | port | `src/core/glass/shadowBlurEngine.ts:53` |  |
| 105 | `SHADOW_MASK_MAX_SIDE` | val | port | `src/core/glass/shadowBlurEngine.ts:55` |  |
| 108 | `MaskKey` | type | port | `src/core/glass/shadowBlurEngine.ts:58` |  |
| 116 | `ShadowMaskCache` | type | port | `src/core/glass/shadowBlurEngine.ts:202` |  |
| 190 | `MaskScratchBuffers` | type | port | `src/core/glass/shadowBlurEngine.ts:207` |  |
| 197 | `halfPx` | fun | port | `src/core/glass/shadowBlurEngine.ts:71` |  |
| 205 | `ResolvedBlurredShadow` | type | port | `src/core/glass/shadowBlurEngine.ts:219` |  |
| 223 | `resolveBlurredShadow` | fun | port | `src/core/glass/shadowBlurEngine.ts:317` |  |
| 306 | `drawResolvedBlurredShadow` | fun | port | `src/core/glass/glowDrawCache.ts:51` |  |
| 327 | `drawDeterministicBlurredPath` | fun | port | `src/core/glass/shadowBlurEngine.ts:25` |  |
| 363 | `drawDeterministicGlowRoundRect` | fun | port | `src/core/glass/shadowBlurEngine.ts:26` |  |
| 401 | `pickMaskScale` | fun | port | `src/core/glass/shadowBlurEngine.ts:255` |  |
| 417 | `buildMaskBitmap` | fun | port | `src/core/glass/shadowBlurEngine.ts:28` |  |
| 480 | `sigmaToBoxRadius` | fun | port | `src/core/glass/shadowBlurEngine.ts:265` |  |
| 491 | `boxBlurThreePass` | fun | port | `src/core/glass/shadowBlurEngine.ts:402` |  |
| 504 | `boxBlurHorizontal` | fun | port | `src/core/glass/shadowBlurEngine.ts:415` |  |
| 552 | `boxBlurVertical` | fun | port | `src/core/glass/shadowBlurEngine.ts:461` |  |

## me/trishiraj/shadowglow/ShadowBlurStyle.kt (20 行, 2 声明)

iOS 归属：`src/core/glass/shadowBlurStyle.ts` / `src/core/enums/kotlinEnums.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `ShadowBlurStyle` | type | port | `src/core/glass/shadowBlurStyle.ts:15` |  |
| 13 | `toAndroidBlurStyle` | fun | port | `src/core/glass/shadowBlurStyle.ts:40` |  |

## me/trishiraj/shadowglow/ShadowGlow.kt (395 行, 10 声明)

iOS 归属：`src/core/glass/shadowGlow.ts` / `src/ui/components/AcrylicDialog.tsx` / `src/ui/components/glasskit/GlassKit.tsx` / `src/ui/pages/ComicChaptersPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 40 | `shadowGlow` | fun | port | `src/core/glass/shadowGlow.ts:172` |  |
| 151 | `cachedShadowGlow` | fun | port | `src/core/glass/shadowGlow.ts:150` |  |
| 216 | `SHADOW_AMBIENT_BLUR_FACTOR` | val | port | `src/core/glass/shadowGlow.ts:30` |  |
| 219 | `SHADOW_SPOT_BLUR_FACTOR` | val | port | `src/core/glass/shadowGlow.ts:32` |  |
| 222 | `SHADOW_SPOT_OFFSET_FACTOR` | val | port | `src/core/glass/shadowGlow.ts:34` |  |
| 229 | `SHADOW_AMBIENT_ALPHA_GAIN` | val | port | `src/core/glass/shadowGlow.ts:36` |  |
| 230 | `SHADOW_SPOT_ALPHA_GAIN` | val | port | `src/core/glass/shadowGlow.ts:38` |  |
| 233 | `BLUR_RADIUS_TO_SIGMA` | val | port | `src/core/glass/shadowGlow.ts:40` |  |
| 236 | `blurRadiusToSigma` | fun | port | `src/core/glass/shadowGlow.ts:43` |  |
| 257 | `consistentShadow` | fun | port | `src/core/glass/shadowGlow.ts:121` |  |

## me/trishiraj/shadowglow/ShadowScratchPool.kt (50 行, 1 声明)

iOS 归属：`src/core/glass/shadowScratchPool.ts` / `src/core/glass/shadowBlurEngine.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `ShadowScratchPool` | type | port | `src/core/glass/shadowScratchPool.ts:17` |  |

## net/engawapg/lib/zoomable/DetectMouseWheelZoom.kt (29 行, 4 声明)

iOS 归属：`src/core/zoom/gestures.ts` / `src/core/zoom/zoomState.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 8 | `SCROLL_TO_ZOOM_RATE` | val | port | `src/core/zoom/zoomState.ts:73` |  |
| 9 | `MIN_ZOOM` | val | port | `src/core/zoom/zoomState.ts:316` |  |
| 10 | `MAX_ZOOM` | val | port | `src/core/zoom/zoomState.ts:316` |  |
| 12 | `detectMouseWheelZoom` | fun | port | `src/core/ui/parityMisc.ts:661` |  |

## net/engawapg/lib/zoomable/DetectZoomableGestures.kt (253 行, 9 声明)

iOS 归属：`src/core/zoom/gestures.ts` / `src/ui/components/comic/sheets/ComicCropSheet.tsx` / `src/ui/pages/ComicChaptersPage.tsx` / `src/ui/components/comic/comicChapterEdgeGesture.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 36 | `detectZoomableGestures` | fun | port | `src/core/zoom/gestures.ts:13` |  |
| 64 | `detectGesture` | fun | port | `src/core/ui/parityMisc.ts:679` |  |
| 146 | `awaitTouchSlop` | fun | port | `src/core/zoom/gestures.ts:16` |  |
| 169 | `awaitEvent` | fun | port | `src/core/zoom/gestures.ts:25` |  |
| 178 | `consumeAllEventsUntilReleased` | fun | port | `src/core/zoom/gestures.ts:26` |  |
| 185 | `PointerEvent` | val | port | `src/core/comic/comicZoomGesture.ts:105` |  |
| 197 | `awaitSecondDown` | fun | port | `src/core/zoom/gestures.ts:21` |  |
| 212 | `consumePositionChanges` | fun | port | `src/core/ui/parityMisc.ts:688` |  |
| 228 | `TouchSlop` | type | port | `src/core/zoom/gestures.ts:24` |  |

## net/engawapg/lib/zoomable/ExperimentalZoomableApi.kt (7 行, 1 声明)

iOS 归属：`src/core/zoom/gestures.ts` / `src/core/ui/parityMisc.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 7 | `ExperimentalZoomableApi` | type | port | `src/core/ui/parityMisc.ts:693` |  |

## net/engawapg/lib/zoomable/MouseWheelZoom.kt (54 行, 1 声明)

iOS 归属：`src/core/ui/parityMisc.ts` / `src/core/enums/kotlinEnums.ts` / `src/ui/components/zoom/Zoomable.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 12 | `MouseWheelZoom` | type | port | `src/core/enums/kotlinEnums.ts:674` |  |

## net/engawapg/lib/zoomable/ScrollGesturePrpagation.kt (21 行, 1 声明)

iOS 归属：`src/core/zoom/gestures.ts` / `src/ui/components/zoom/Zoomable.tsx` / `src/core/zoom/zoomState.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 9 | `ScrollGesturePropagation` | type | port | `src/core/zoom/gestures.ts:38` |  |

## net/engawapg/lib/zoomable/SnapBackZoomableBox.kt (433 行, 14 声明)

iOS 归属：`src/ui/components/zoom/SnapBackZoomableBox.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 64 | `ZoomablePopupState` | type | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:62` |  |
| 98 | `rememberZoomablePopupState` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:81` |  |
| 110 | `SnapBackZoomableOverlayController` | type | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:93` |  |
| 116 | `SnapBackZoomableOverlayEntry` | type | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:83` |  |
| 124 | `LocalSnapBackZoomableOverlayController` | val | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:100` |  |
| 152 | `SnapBackZoomableOverlayHost` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:110` |  |
| 201 | `SnapBackZoomableBox` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:164` |  |
| 234 | `HostedSnapBackZoomableBox` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:14` |  |
| 269 | `scrimAlphaForScale` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:144` |  |
| 272 | `rememberScrimAlpha` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:16` |  |
| 279 | `HostedZoomOverlay` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:285` |  |
| 333 | `PopupSnapBackZoomableBox` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:18` |  |
| 372 | `ReservedSpace` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:319` |  |
| 381 | `ZoomablePopup` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:264` |  |

## net/engawapg/lib/zoomable/ZoomState.kt (463 行, 2 声明)

iOS 归属：`src/core/zoom/zoomState.ts` / `src/ui/components/zoom/SnapBackZoomableBox.tsx` / `src/ui/pages/ComicReaderPage.tsx`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 54 | `ZoomState` | type | port | `src/core/zoom/zoomState.ts:2` |  |
| 456 | `rememberZoomState` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:323` |  |

## net/engawapg/lib/zoomable/Zoomable.kt (432 行, 6 声明)

iOS 归属：`src/ui/components/zoom/Zoomable.tsx` / `src/core/zoom/zoomState.ts` / `src/ui/components/zoom/SnapBackZoomableBox.tsx` / `src/core/enums/kotlinEnums.ts`

| Kotlin:行 | 声明 | 种类 | 状态 | iOS 位置 | 备注 |
|---|---|---|---|---|---|
| 60 | `zoomable` | fun | port | `src/core/enums/kotlinEnums.ts:674` |  |
| 96 | `snapBackZoomable` | fun | port | `src/ui/components/zoom/SnapBackZoomableBox.tsx:235` |  |
| 139 | `zoomableWithScroll` | fun | port | `src/ui/components/zoom/Zoomable.tsx:2` |  |
| 163 | `ZoomableElement` | type | port | `src/ui/components/zoom/Zoomable.tsx:14` |  |
| 217 | `ZoomableNode` | type | port | `src/ui/components/zoom/Zoomable.tsx:15` |  |
| 425 | `toggleScale` | fun | port | `src/core/zoom/zoomState.ts:266` |  |
