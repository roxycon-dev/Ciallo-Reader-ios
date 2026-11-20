/**
 * 应用更新的镜像 / 协调 / 状态机 —— `data/AppUpdateAutoCheck.kt` L17-60 +
 * `data/AppUpdateDownload.kt` L29-30 + `data/AppUpdateManager.kt` L23 的逐值移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L17 `UPDATE_MIRROR_PREFIX = "https://gh-proxy.com/"`     → 同名
 *   L18 `UPDATE_MIRROR_HOST = "gh-proxy.com"`                → 同名
 *   L21-25 `mirrorDownloadUrl(tag, asset)`：sha256 必须是 64 位小写 hex，
 *          且 `officialUpdateAsset(tag, name, url)` 成立，才拼镜像 URL → `mirrorDownloadUrl`
 *   L28-29 `officialDownloadUrl(tag, asset)`                 → 同名
 *   L36-60+ `object UpdateCheckCoordination`：同 key 的并发请求合并（`CompletableDeferred`）＋
 *           `completedRecently(windowMs = 90_000)` 的 nanotime 窗口 → `UpdateCheckCoordination`
 *   `AppUpdateDownload.kt` L29-30 `GITHUB_DOWNLOAD_HOSTS`     → 同名
 *   `AppUpdateManager.kt` L23 `enum class AppUpdateSource { GITHUB, MIRROR }` → `APP_UPDATE_SOURCES`
 *
 * 关键约束（Kotlin 注释 L12-15 / L27）：镜像只搬运官方 APK 字节，
 * 不带任何版本元数据，且仅在 GitHub 为「同一仓库资产 URL」发布了可校验 SHA-256 时才提供；
 * 浏览器下载永远走官方 URL，从不走镜像。
 */

/** L17。 */
export const UPDATE_MIRROR_PREFIX = 'https://gh-proxy.com/';
/** L18。 */
export const UPDATE_MIRROR_HOST = 'gh-proxy.com';
/** `AppUpdateDownload.kt` L30 的三个可下载主机。 */
export const GITHUB_DOWNLOAD_HOSTS: readonly string[] = [
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
];

/** `AppUpdateManager.kt` L23 `enum class AppUpdateSource { GITHUB, MIRROR }`。 */
export const APP_UPDATE_SOURCES = ['GITHUB', 'MIRROR'] as const;
export type AppUpdateSource = (typeof APP_UPDATE_SOURCES)[number];

/** `AppUpdateManager.kt` L25 `enum class AppUpdateStage`。 */
export const APP_UPDATE_STAGES = [
  'AVAILABLE',
  'DOWNLOADING',
  'VERIFYING',
  'READY',
  'NEED_PERMISSION',
  'INSTALLING',
  'FAILED',
] as const;
export type AppUpdateStage = (typeof APP_UPDATE_STAGES)[number];

export interface UpdateApkAsset {
  readonly name: string;
  readonly url: string;
  readonly sha256?: string | null;
}

/**
 * `officialUpdateAsset(tag, name, url)`：资产必须指向**同一仓库**的 release 资源。
 * 判定：host ∈ `GITHUB_DOWNLOAD_HOSTS`，且 URL 里含该 tag 的 release 路径。
 */
export function officialUpdateAsset(tag: string, name: string, url: string): boolean {
  if (name.trim() === '' || tag.trim() === '') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (!GITHUB_DOWNLOAD_HOSTS.includes(parsed.hostname)) return false;
  // release 资源路径里必须出现 tag（`/releases/download/<tag>/<asset>`）。
  return parsed.pathname.includes(`/releases/download/${encodeURIComponent(tag)}/`);
}

/** L21-25 `mirrorDownloadUrl(tag, asset)`。 */
export function mirrorDownloadUrl(tag: string, asset: UpdateApkAsset): string | null {
  const sha = asset.sha256 ?? null;
  if (sha === null || !/^[0-9a-f]{64}$/.test(sha)) return null;
  if (!officialUpdateAsset(tag, asset.name, asset.url)) return null;
  return UPDATE_MIRROR_PREFIX + asset.url;
}

/** L28-29 `officialDownloadUrl(tag, asset)`。 */
export function officialDownloadUrl(tag: string, asset: UpdateApkAsset): string | null {
  return officialUpdateAsset(tag, asset.name, asset.url) ? asset.url : null;
}

/** L41-44 `completedRecently(windowMs = 90_000)` 的默认窗口。 */
export const UPDATE_CHECK_RECENT_WINDOW_MS = 90_000;

export type UpdateCheckResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * L36-60+ `object UpdateCheckCoordination`：
 * 静默启动检查与设置页手动检查**共享同一次 GitHub 请求**；
 * 手动结果永不被后台结果替换；失败不缓存（显式重试仍会走网络）。
 */
export class UpdateCheckCoordination {
  private readonly flights = new Map<string, Promise<UpdateCheckResult>>();
  private completedAtNs: number | null = null;

  /** L41-44 `completedRecently(windowMs = 90_000)`（用单调时钟 ns）。 */
  completedRecently(windowMs = UPDATE_CHECK_RECENT_WINDOW_MS): boolean {
    if (this.completedAtNs === null) return false;
    return performance.now() * 1_000_000 - this.completedAtNs <= windowMs * 1_000_000;
  }

  /** L46+ `run(key, block)`：同一 key 的在飞请求合并。 */
  async run(key: string, block: () => Promise<UpdateCheckResult>): Promise<UpdateCheckResult> {
    const existing = this.flights.get(key);
    if (existing !== undefined) return existing;
    const flight = (async (): Promise<UpdateCheckResult> => {
      try {
        const result = await block();
        // 失败不缓存：只有成功才刷新「刚完成」的时间戳。
        if (result.ok) this.completedAtNs = performance.now() * 1_000_000;
        return result;
      } finally {
        this.flights.delete(key);
      }
    })();
    this.flights.set(key, flight);
    return flight;
  }

  /** 在飞请求数（调试/测试用）。 */
  get inflight(): number {
    return this.flights.size;
  }
}

/** 进程级单例（Kotlin `object`）。 */
export const updateCheckCoordination = new UpdateCheckCoordination();
