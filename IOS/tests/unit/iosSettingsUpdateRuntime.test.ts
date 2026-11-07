import { describe, expect, it, vi } from 'vitest';
import {
  createIosSettingsUpdateIo,
  IOS_GITHUB_REPOSITORY,
  IOS_GITHUB_RELEASES_URL,
  IOS_LATEST_RELEASE_API_URL,
  IOS_NO_INSTALLABLE_UPDATE_MESSAGE,
  isOfficialIosReleasePage,
} from '@platform/ios-native/settingsUpdateRuntime';
import type { ExternalBrowserPort, HttpClient, HttpRequest, HttpResponse } from '@platform/interfaces';

const tag = 'v1.5.11';
const releaseUrl = `${IOS_GITHUB_REPOSITORY}/releases/tag/${tag}`;

interface RuntimeOptions {
  status?: number;
  responseUrl?: string;
  body?: Uint8Array;
  error?: Error;
}

function runtime(options: RuntimeOptions = {}) {
  const requests: HttpRequest[] = [];
  const open = vi.fn(async (_url: string) => {});
  const http: HttpClient = {
    async request(request): Promise<HttpResponse> {
      requests.push(request);
      if (options.error !== undefined) throw options.error;
      return {
        status: options.status ?? 200,
        url: options.responseUrl ?? IOS_LATEST_RELEASE_API_URL,
        headers: { 'content-type': 'application/json' },
        body: options.body ?? new TextEncoder().encode(JSON.stringify(iosRelease())),
      };
    },
  };
  const externalBrowser: ExternalBrowserPort = { open, close: async () => {} };
  return { io: createIosSettingsUpdateIo({ http, externalBrowser }), requests, open };
}

function iosRelease(): unknown {
  return {
    tag_name: tag,
    html_url: releaseUrl,
    draft: false,
    prerelease: false,
    body: 'iOS project release notes.',
    // The configured CI artifact is a simulator app zip, which cannot be installed on iOS.
    assets: [{ name: 'CialloReader-sim.app.zip', browser_download_url: 'https://github.com/roxycon-dev/Ciallo-Reader-ios/releases/download/v1.5.11/CialloReader-sim.app.zip' }],
  };
}

describe('iOS Settings release discovery', () => {
  it('queries official iOS metadata, compares versions, and exposes notes without an installable release', async () => {
    const { io, requests, open } = runtime();
    const result = await io.check('1.2.4');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(IOS_LATEST_RELEASE_API_URL);
    expect(requests[0]?.redirect).toBe('error');
    expect(requests[0]?.maxResponseBytes).toBe(512 * 1024);
    expect(result.message).toBe(IOS_NO_INSTALLABLE_UPDATE_MESSAGE);
    expect(result.release).toBeNull();
    expect(result.releaseUrl).toBe(releaseUrl);

    await io.openUri(result.releaseUrl!);
    expect(open).toHaveBeenCalledWith(releaseUrl);
    expect(open).not.toHaveBeenCalledWith(expect.stringContaining('.app.zip'));
    expect(await io.appUpdateState()).toEqual({ release: null, transferring: false, hasPackage: false });
    expect(io.releaseNotesUrl).toBe(IOS_GITHUB_RELEASES_URL);
    expect(io.releaseNotesLabel).toBe('项目发布说明');
    expect(io.projectUrl).toBe(IOS_GITHUB_REPOSITORY);
  });

  it('uses version comparison to report an already-current iOS version', async () => {
    const { io } = runtime();
    const result = await io.check('1.5.11');
    expect(result.message).toBe('当前 iOS 版本已是最新；可查看项目发布说明');
    expect(result.releaseUrl).toBe(releaseUrl);
    expect(result.release).toBeNull();

    const newerInstalled = await io.check('2.0.0');
    expect(newerInstalled.message).toBe('当前 iOS 版本已是最新；可查看项目发布说明');
  });

  it('distinguishes missing/forbidden releases from a transport failure', async () => {
    const missing = await runtime({ status: 404 }).io.check('1.2.4');
    expect(missing.message).toBe(IOS_NO_INSTALLABLE_UPDATE_MESSAGE);
    expect(missing.releaseUrl).toBe(IOS_GITHUB_RELEASES_URL);

    const unauthorized = await runtime({ status: 401 }).io.check('1.2.4');
    expect(unauthorized.message).toContain('HTTP 401');
    expect(unauthorized.message).not.toContain('无法连接 GitHub');

    const forbidden = await runtime({ status: 403 }).io.check('1.2.4');
    expect(forbidden.message).toContain('HTTP 403');
    expect(forbidden.message).not.toContain('暂无可安装的 iOS 更新');

    const transport = await runtime({ error: new Error('offline') }).io.check('1.2.4');
    expect(transport.message).toContain('无法连接 GitHub');
    expect(transport.message).not.toContain('HTTP 404');
  });

  it('requires exact official iOS tag URLs and rejects Android release metadata', async () => {
    expect(isOfficialIosReleasePage(tag, releaseUrl)).toBe(true);
    expect(isOfficialIosReleasePage('v1.5.10', releaseUrl)).toBe(false);
    expect(isOfficialIosReleasePage(tag, `${releaseUrl}?download=1`)).toBe(false);
    expect(isOfficialIosReleasePage(tag, releaseUrl.replace('github.com/', 'github.com.evil/'))).toBe(false);
    expect(isOfficialIosReleasePage(tag, releaseUrl.replace('Ciallo-Reader-ios', 'Ciallo-Reader'))).toBe(false);

    const androidRelease = {
      ...(iosRelease() as Record<string, unknown>),
      html_url: `https://github.com/roxycon-dev/Ciallo-Reader/releases/tag/${tag}`,
    };
    const invalid = await runtime({ body: new TextEncoder().encode(JSON.stringify(androidRelease)) }).io.check('1.2.4');
    expect(invalid.message).toContain('无法读取');
    expect(invalid.release).toBeNull();

    const { io, open } = runtime();
    await expect(io.openUri('https://github.com.evil/roxycon-dev/Ciallo-Reader-ios/releases/latest')).rejects.toThrow(
      '只允许打开 Ciallo Reader iOS 官方 GitHub 项目或发布页',
    );
    await expect(io.openUri('https://github.com/roxycon-dev/Ciallo-Reader/releases/latest')).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects a response whose endpoint URL is not the official iOS API', async () => {
    const { io } = runtime({ responseUrl: 'https://api.github.com/repos/roxycon-dev/Ciallo-Reader/releases/latest' });
    const result = await io.check('1.2.4');
    expect(result.message).toContain('来源校验失败');
    expect(result.release).toBeNull();
  });
});
