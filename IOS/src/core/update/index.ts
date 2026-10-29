/**
 * `src/core/update/index.ts` — barrel for the AppUpdate module.
 *
 * Ported from `com/example/data/{AppUpdateStore, GithubUpdateChecker, AppUpdateManager,
 * AppUpdateDownload, AppUpdateInstaller, AppUpdateCleanupReceiver}.kt`. Each file carries
 * its own Kotlin→TS line map; this barrel only re-exports, so nothing is re-declared here.
 *
 * Wiring order for a host (`src/App.tsx` / `src/platform/**`):
 *   1. `UpdateFileStore` over the platform `FileSystemApi` (+ `filesDir`).
 *   2. `AppPackageIdentity` (installed `versionCode`) → `AppUpdateStore`.
 *   3. `UpdateHttpClient` (`updateHttpClientFrom(platform.http)`) →
 *      `GithubUpdateChecker` + `AppUpdateDownload`.
 *   4. `AndroidPackageInspector` + `sdkInt` → `UpdateApkVerifier` → `AppUpdateManager`.
 *   5. `AndroidAppUpdateInstaller` / the `AppInstaller` port →
 *      `createAppUpdateActions(...)` → `AppUpdateDialogHost`'s `actions` prop.
 *   6. `createAppUpdateCleanupReceiver(store)` → the platform broadcast listener.
 *
 * ⚠️ iOS: `AppInstaller.openInstaller()` MUST route to the App Store page for
 * `roxycon-dev/Ciallo-Reader`; iOS cannot install a side-loaded APK.
 */

export {
  MAX_UPDATE_BYTES,
  UPDATE_REPOSITORY,
  GithubCheckFailure,
  GithubUpdateChecker,
  assetState,
  classifyFailure,
  decodeReleaseMetadata,
  effectivePort,
  failureReason,
  firstDifferingPair,
  headerValue,
  httpFailure,
  isAllowedSize,
  isAssetDigest,
  isCancellationError,
  isLowerSha256,
  isNewerVersion,
  isRedirectStatus,
  makeUpdateRelease,
  officialUpdateAsset,
  pathSegmentsOf,
  releaseUrlFrom,
  releaseVersion,
  singleOrNull,
  stableTag,
  userAgent,
  versionParts,
  withGithubFailureKind,
  REDIRECT_STATUSES,
  type GithubFailureKind,
  type GithubUpdateCheckerOptions,
  type UpdateApkAsset,
  type UpdateCheckResult,
  type UpdateHttpClient,
  type UpdateHttpRequest,
  type UpdateHttpRequestOptions,
  type UpdateRelease,
} from './githubUpdateChecker';

export {
  APP_UPDATE_APK_FILE,
  APP_UPDATE_DIRECTORY,
  APP_UPDATE_METADATA_FILE,
  APP_UPDATE_PARTIAL_EXTENSION,
  ATOMIC_BACKUP_SUFFIX,
  AppUpdateStore,
  AtomicMetadataFile,
  MAX_PENDING_METADATA_BYTES,
  MAX_PENDING_NOTES_CHARS,
  canonicalize,
  encodePendingMetadata,
  fileExtension,
  joinPath,
  kCheck,
  kRequire,
  randomUuid,
  type AppPackageIdentity,
  type AppUpdateStoreOptions,
  type PendingAppUpdate,
  type UpdateFileStore,
} from './appUpdateStore';

export {
  AppUpdateDownload,
  DOWNLOAD_CHUNK_BYTES,
  DOWNLOAD_PROGRESS_INTERVAL_NS,
  DOWNLOAD_REDIRECT_HOSTS,
  DOWNLOAD_TIMEOUT_MS,
  UpdateApkVerifier,
  assertChunkBudget,
  assertSafeRedirect,
  bytesToHex,
  declaredContentLength,
  sha256Hex,
  updateFileSha256,
  updateHttpClientFrom,
  type AndroidPackageInspector,
  type AppUpdateDownloadOptions,
  type AppPackageIdentity as ArchivePackageIdentity,
  type UpdateApkVerifierOptions,
  type UpdateProgressCallback,
} from './appUpdateDownload';

export {
  ACTION_MANAGE_UNKNOWN_APP_SOURCES,
  ACTION_MY_PACKAGE_REPLACED,
  ACTION_SECURITY_SETTINGS,
  ACTION_VIEW,
  APK_CLIP_LABEL,
  APK_MIME_TYPE,
  AndroidAppUpdateInstaller,
  FLAG_GRANT_READ_URI_PERMISSION,
  UNKNOWN_SOURCES_SDK,
  createAppUpdateActions,
  type AndroidAppUpdateInstallerOptions,
  type AppUpdateActions,
  type CreateAppUpdateActionsOptions,
  type ExportDestination,
  type InstallEnvironment,
  type IntentDescriptor,
} from './appUpdateInstaller';

export {
  APP_UPDATE_STAGES,
  AppUpdateManager,
  MESSAGE_DOWNLOAD_CANCELLED,
  MESSAGE_DOWNLOAD_FAILED,
  MESSAGE_INSTALLATION_INCOMPLETE,
  MESSAGE_PACKAGE_READY,
  MESSAGE_PERMISSION_NEEDED,
  UpdateStateStore,
  copyUpdateState,
  defaultUpdateScope,
  getAppUpdateManager,
  hasPackage,
  initialUpdateState,
  isTransferring,
  resetAppUpdateManager,
  type AppUpdateManagerOptions,
  type AppUpdateManagerScope,
  type AppUpdateStage,
  type AppUpdateState,
  type UpdateVerify,
} from './appUpdateManager';

export {
  PACKAGE_REPLACED_ACTION,
  createAppUpdateCleanupReceiver,
  handlePackageReplaced,
  type AppUpdateCleanupReceiver,
  type AppUpdateCleanupTarget,
} from './appUpdateCleanupReceiver';
