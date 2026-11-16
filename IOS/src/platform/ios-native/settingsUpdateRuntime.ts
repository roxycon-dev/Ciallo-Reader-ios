import {
  isNewerVersion,
  releaseVersion,
  stableTag,
  versionParts,
} from '@core/update/githubUpdateChecker';
import type { ExternalBrowserPort, HttpClient, HttpResponse } from '@platform/interfaces';
import type { SettingsUpdateIo, UpdateCheckResult, UpdateRelease } from '@ui/pages/SettingsPage';

export const IOS_GITHUB_REPOSITORY = 'https://github.com/roxycon-dev/Ciallo-Reader-ios';
export const IOS_GITHUB_RELEASES_URL = `${IOS_GITHUB_REPOSITORY}/releases`;
export const IOS_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/roxycon-dev/Ciallo-Reader-ios/releases/latest';
export const IOS_NO_INSTALLABLE_UPDATE_MESSAGE = '暂无可安装的 iOS 更新；可查看项目发布说明';

const OFFICIAL_GITHUB_ORIGIN = 'https://github.com';
const OFFICIAL_API_ORIGIN = 'https://api.github.com';
const MAX_RELEASE_METADATA_BYTES = 512 * 1024;
const IOS_UPDATE_HINT = '暂无可安装的 iOS 更新；可查看项目发布说明';

interface IosReleaseMetadata {
  readonly tag: string;
  readonly version: string;
  readonly url: string;
  readonly versionParts: number[];
}

/** Accepts only the canonical official iOS repository page for this stable tag. */
export function isOfficialIosReleasePage(tag: string, rawUrl: string): boolean {
  if (stableTag(tag) === null) return false;
  const expected = `${IOS_GITHUB_REPOSITORY}/releases/tag/${tag}`;
  try {
    const url = new URL(rawUrl);
    return url.href === expected && url.origin === OFFICIAL_GITHUB_ORIGIN &&
      url.username === '' && url.password === '' && url.search === '' && url.hash === '';
  } catch {
    return false;
  }
}

function isAllowedSettingsUrl(rawUrl: string): boolean {
  if (rawUrl === IOS_GITHUB_REPOSITORY || rawUrl === IOS_GITHUB_RELEASES_URL) return true;
  const prefix = `${IOS_GITHUB_REPOSITORY}/releases/tag/`;
  if (!rawUrl.startsWith(prefix)) return false;
  return isOfficialIosReleasePage(rawUrl.slice(prefix.length), rawUrl);
}

function noInstallableUpdate(): UpdateCheckResult {
  return { message: IOS_NO_INSTALLABLE_UPDATE_MESSAGE, releaseUrl: IOS_GITHUB_RELEASES_URL, release: null };
}

function responseFailure(status: number): UpdateCheckResult {
  switch (status) {
    case 404:
      // GitHub's /releases/latest endpoint returns 404 when this repository has no releases.
      return noInstallableUpdate();
    case 401:
      return {
        message: '无法访问 iOS 发布信息（HTTP 401）；可查看项目发布说明',
        releaseUrl: IOS_GITHUB_RELEASES_URL,
        release: null,
      };
    case 403:
      return {
        message: 'GitHub 限制了 iOS 发布信息查询（HTTP 403）；可查看项目发布说明',
        releaseUrl: IOS_GITHUB_RELEASES_URL,
        release: null,
      };
    default:
      return {
        message: `GitHub iOS 发布信息请求失败（HTTP ${status}）；可查看项目发布说明`,
        releaseUrl: IOS_GITHUB_RELEASES_URL,
        release: null,
      };
  }
}

function parseRelease(body: Uint8Array): IosReleaseMetadata | null {
  if (body.byteLength === 0 || body.byteLength > MAX_RELEASE_METADATA_BYTES) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const metadata = value as Record<string, unknown>;
    if (metadata.draft !== false || metadata.prerelease !== false || typeof metadata.tag_name !== 'string' ||
      typeof metadata.html_url !== 'string') return null;

    const parts = stableTag(metadata.tag_name);
    if (parts === null || !isOfficialIosReleasePage(metadata.tag_name, metadata.html_url)) return null;
    return {
      tag: metadata.tag_name,
      version: releaseVersion(metadata.tag_name),
      url: metadata.html_url,
      versionParts: parts,
    };
  } catch {
    return null;
  }
}

function isOfficialApiResponseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.href === IOS_LATEST_RELEASE_API_URL && url.origin === OFFICIAL_API_ORIGIN &&
      url.username === '' && url.password === '' && url.search === '' && url.hash === '';
  } catch {
    return false;
  }
}

function releasedVersionResult(metadata: IosReleaseMetadata, currentVersion: string): UpdateCheckResult {
  const current = versionParts(currentVersion);
  if (current !== null && !isNewerVersion(metadata.versionParts, current)) {
    return {
      message: '当前 iOS 版本已是最新；可查看项目发布说明',
      releaseUrl: metadata.url,
      release: null,
    };
  }

  // The repository's current CI publishes simulator artifacts only. Even a newer
  // tag therefore links to its notes; it is never represented as an installable update.
  return {
    message: IOS_NO_INSTALLABLE_UPDATE_MESSAGE,
    releaseUrl: metadata.url,
    release: null,
  };
}

/**
 * iOS Settings release discovery. It reads only the official iOS repository API and
 * exposes validated release notes. No Android assets or sideload/install flow is used.
 */
export function createIosSettingsUpdateIo(deps: {
  http: HttpClient;
  externalBrowser: ExternalBrowserPort;
}): SettingsUpdateIo {
  return {
    updateHint: IOS_UPDATE_HINT,
    projectUrl: IOS_GITHUB_REPOSITORY,
    releaseNotesUrl: IOS_GITHUB_RELEASES_URL,
    releaseNotesLabel: '项目发布说明',
    async check(currentVersion) {
      let response: HttpResponse;
      try {
        response = await deps.http.request({
          url: IOS_LATEST_RELEASE_API_URL,
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Ciallo-Reader-iOS',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          timeoutMs: 12_000,
          maxResponseBytes: MAX_RELEASE_METADATA_BYTES,
          redirect: 'error',
        });
      } catch {
        return {
          message: '检查 iOS 更新失败：无法连接 GitHub；可查看项目发布说明',
          releaseUrl: IOS_GITHUB_RELEASES_URL,
          release: null,
        };
      }

      if (response.status === 404 || response.status === 401 || response.status === 403 ||
        response.status < 200 || response.status >= 300) {
        return responseFailure(response.status);
      }
      if (!isOfficialApiResponseUrl(response.url)) {
        return {
          message: 'GitHub iOS 发布信息来源校验失败；可查看项目发布说明',
          releaseUrl: IOS_GITHUB_RELEASES_URL,
          release: null,
        };
      }

      const metadata = parseRelease(response.body);
      if (metadata === null) {
        return {
          message: 'GitHub 返回的 iOS 发布信息无法读取；可查看项目发布说明',
          releaseUrl: IOS_GITHUB_RELEASES_URL,
          release: null,
        };
      }
      return releasedVersionResult(metadata, currentVersion);
    },
    async offer(_release: UpdateRelease) {},
    async appUpdateState() {
      return { release: null, transferring: false, hasPackage: false };
    },
    onAppUpdateState: () => () => {},
    showAppUpdateSheet: () => {},
    async openUri(uri) {
      if (!isAllowedSettingsUrl(uri)) throw new Error('只允许打开 Ciallo Reader iOS 官方 GitHub 项目或发布页');
      await deps.externalBrowser.open(uri);
    },
    relaunchApp: () => {},
  };
}
