/**
 * Pure-logic tests for `src/core/update/githubUpdateChecker.ts`
 * (port of `com/example/data/GithubUpdateChecker.kt`).
 *
 * The semantic-version comparison is the highest-value pure algorithm in this module:
 * `1.2.10` MUST sort above `1.2.9` (numeric component compare, not lexical), pre-release
 * and build metadata MUST be stripped before parsing, and a malformed version MUST yield
 * `null` rather than a guess.
 */

import { describe, expect, it } from 'vitest';
import {
  assetState,
  classifyFailure,
  decodeReleaseMetadata,
  effectivePort,
  failureReason,
  firstDifferingPair,
  GithubCheckFailure,
  GithubUpdateChecker,
  httpFailure,
  isAllowedSize,
  isNewerVersion,
  makeUpdateRelease,
  officialUpdateAsset,
  pathSegmentsOf,
  releaseUrlFrom,
  releaseVersion,
  stableTag,
  versionParts,
  withGithubFailureKind,
  MAX_UPDATE_BYTES,
  UPDATE_REPOSITORY,
  type UpdateHttpClient,
} from '../../src/core/update/githubUpdateChecker';
import type { HttpResponse } from '../../src/platform/interfaces';

const TAG = 'v1.2.3';
const NAME = 'Ciallo-Reader-v1.2.3.apk';
const ASSET_URL = `${UPDATE_REPOSITORY}/releases/download/${TAG}/${NAME}`;

describe('versionParts', () => {
  it('pads every legal arity to four components', () => {
    expect(versionParts('1.2')).toEqual([1, 2, 0, 0]);
    expect(versionParts('1.2.3')).toEqual([1, 2, 3, 0]);
    expect(versionParts('1.2.3.4')).toEqual([1, 2, 3, 4]);
  });

  it('strips exactly one v/V prefix (removePrefix semantics)', () => {
    expect(versionParts('v1.2.3')).toEqual([1, 2, 3, 0]);
    expect(versionParts('V1.2.3')).toEqual([1, 2, 3, 0]);
    // "vv1.2.3" -> removePrefix("v") = "v1.2.3" -> removePrefix("V") is a no-op -> unparsable
    expect(versionParts('vv1.2.3')).toBeNull();
  });

  it('truncates at the first - and + before matching', () => {
    expect(versionParts('1.2.3-rc1')).toEqual([1, 2, 3, 0]);
    expect(versionParts('1.2.3+build.9')).toEqual([1, 2, 3, 0]);
    expect(versionParts('v1.2.3-rc.1+meta')).toEqual([1, 2, 3, 0]);
    // Only the FIRST '-' counts, so "1.2.3-a-b" still parses its numeric head.
    expect(versionParts('1.2.3-a-b')).toEqual([1, 2, 3, 0]);
  });

  it('rejects malformed versions instead of guessing', () => {
    for (const bad of ['', '1', '1.', '.1', '1..2', '1.2.3.4.5', 'a.b', '1.2.x', ' 1.2', '1.2 ']) {
      expect(versionParts(bad)).toBeNull();
    }
  });

  it('rejects component overflow the way toLongOrNull does', () => {
    expect(versionParts('99999999999999999999.1')).toBeNull();
    expect(versionParts('1.99999999999999999999')).toBeNull();
    expect(versionParts('9007199254740993.1')).toBeNull();
  });

  it('keeps large-but-representable components', () => {
    expect(versionParts('9007199254740991.1')).toEqual([9007199254740991, 1, 0, 0]);
  });
});

describe('stableTag', () => {
  it('accepts only a bare numeric tag, never a pre-release tag', () => {
    expect(stableTag('v1.2.3')).toEqual([1, 2, 3, 0]);
    expect(stableTag('1.2')).toEqual([1, 2, 0, 0]);
    expect(stableTag('1.2.3.4')).toEqual([1, 2, 3, 4]);
    expect(stableTag('1.2.3-rc1')).toBeNull();
    expect(stableTag('v1.2.3+build')).toBeNull();
    expect(stableTag('release-1.2.3')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('orders 1.2.10 ABOVE 1.2.9 (numeric, not lexical)', () => {
    expect(isNewerVersion(versionParts('1.2.10')!, versionParts('1.2.9')!)).toBe(true);
    expect(isNewerVersion(versionParts('1.2.9')!, versionParts('1.2.10')!)).toBe(false);
    // The lexical trap this guards: '1.2.10' < '1.2.9' as a string.
    expect('1.2.10' < '1.2.9').toBe(true);
  });

  it('ignores padding: 1.2 == 1.2.0', () => {
    expect(isNewerVersion(versionParts('1.2')!, versionParts('1.2.0')!)).toBe(false);
    expect(isNewerVersion(versionParts('1.2.0.0')!, versionParts('1.2')!)).toBe(false);
  });

  it('compares the first differing component only', () => {
    expect(isNewerVersion([2, 0, 0, 0], [1, 99, 99, 99])).toBe(true);
    expect(isNewerVersion([1, 3, 0, 0], [1, 2, 99, 99])).toBe(true);
    expect(firstDifferingPair([1, 3, 0, 0], [1, 2, 99, 99])).toEqual([3, 2]);
    expect(firstDifferingPair([1, 2, 3, 4], [1, 2, 3, 4])).toBeNull();
    expect(isNewerVersion([1, 2, 3, 4], [1, 2, 3, 4])).toBe(false);
  });

  it('lets a fourth component decide a full-length tie', () => {
    expect(isNewerVersion([1, 2, 3, 1], [1, 2, 3, 0])).toBe(true);
  });
});

describe('releaseVersion', () => {
  it('mirrors removePrefix("v").removePrefix("V")', () => {
    expect(releaseVersion('v1.2.3')).toBe('1.2.3');
    expect(releaseVersion('V1.2.3')).toBe('1.2.3');
    expect(releaseVersion('1.2.3')).toBe('1.2.3');
    expect(releaseVersion('vv1.2')).toBe('v1.2');
    expect(releaseVersion('')).toBe('');
  });
});

describe('officialUpdateAsset', () => {
  it('accepts the canonical release asset', () => {
    expect(officialUpdateAsset(TAG, NAME, ASSET_URL)).toBe(true);
    // Unprefixed tag: the path AND the name must both use it verbatim.
    const plainName = 'Ciallo-Reader-1.2.3.apk';
    expect(
      officialUpdateAsset('1.2.3', plainName, `${UPDATE_REPOSITORY}/releases/download/1.2.3/${plainName}`),
    ).toBe(true);
  });

  it('accepts an upper-case .APK suffix (ignoreCase = true)', () => {
    const upper = NAME.replace('.apk', '.APK');
    expect(officialUpdateAsset(TAG, upper, `${UPDATE_REPOSITORY}/releases/download/${TAG}/${upper}`)).toBe(
      true,
    );
  });

  it('rejects a tag that is not a stable numeric tag', () => {
    expect(officialUpdateAsset('1.2.3-rc1', NAME, ASSET_URL)).toBe(false);
    expect(officialUpdateAsset('latest', NAME, ASSET_URL)).toBe(false);
    expect(officialUpdateAsset('1', NAME, ASSET_URL)).toBe(false);
    expect(officialUpdateAsset('1.2.3.4.5', NAME, ASSET_URL)).toBe(false);
  });

  it('enforces the 5..200 name length window', () => {
    // Kotlin `name.length !in 5..200` — 4 is too short, 5 is the shortest legal name.
    expect(officialUpdateAsset(TAG, 'a.ap', `${UPDATE_REPOSITORY}/releases/download/${TAG}/a.ap`)).toBe(
      false,
    );
    expect(officialUpdateAsset(TAG, 'a.apk', `${UPDATE_REPOSITORY}/releases/download/${TAG}/a.apk`)).toBe(
      true,
    );
    const long = `${'x'.repeat(196)}.apk`;
    expect(long.length).toBe(200);
    expect(officialUpdateAsset(TAG, long, `${UPDATE_REPOSITORY}/releases/download/${TAG}/${long}`)).toBe(
      true,
    );
    const tooLong = `${'x'.repeat(197)}.apk`;
    expect(officialUpdateAsset(TAG, tooLong, `${UPDATE_REPOSITORY}/releases/download/${TAG}/${tooLong}`)).toBe(
      false,
    );
  });

  it('requires the .apk suffix', () => {
    const aab = 'Ciallo-Reader-v1.2.3.aab';
    expect(officialUpdateAsset(TAG, aab, `${UPDATE_REPOSITORY}/releases/download/${TAG}/${aab}`)).toBe(false);
  });

  it('rejects a foreign host, a mirror, or a non-https scheme', () => {
    expect(officialUpdateAsset(TAG, NAME, `https://evil.example/roxycon-dev/Ciallo-Reader/releases/download/${TAG}/${NAME}`)).toBe(
      false,
    );
    expect(officialUpdateAsset(TAG, NAME, `http://github.com/roxycon-dev/Ciallo-Reader/releases/download/${TAG}/${NAME}`)).toBe(
      false,
    );
    expect(officialUpdateAsset(TAG, NAME, `https://github.com/roxycon-dev/Ciallo-Reader/releases/download/${TAG}/other.apk`)).toBe(
      false,
    );
  });

  it('rejects userinfo, a query string and a fragment', () => {
    expect(officialUpdateAsset(TAG, NAME, `https://user:pass@github.com/roxycon-dev/Ciallo-Reader/releases/download/${TAG}/${NAME}`)).toBe(
      false,
    );
    expect(officialUpdateAsset(TAG, NAME, `${ASSET_URL}?x=1`)).toBe(false);
    expect(officialUpdateAsset(TAG, NAME, `${ASSET_URL}#frag`)).toBe(false);
  });

  it('rejects path traversal and separators inside the name', () => {
    const traversal = '../../../etc/passwd.apk';
    expect(officialUpdateAsset(TAG, traversal, `${UPDATE_REPOSITORY}/releases/download/${TAG}/${traversal}`)).toBe(
      false,
    );
    expect(officialUpdateAsset(TAG, 'sub/dir.apk', `${UPDATE_REPOSITORY}/releases/download/${TAG}/sub/dir.apk`)).toBe(
      false,
    );
    expect(officialUpdateAsset(TAG, 'sub\\dir.apk', `${UPDATE_REPOSITORY}/releases/download/${TAG}/sub\\dir.apk`)).toBe(
      false,
    );
  });

  it('returns false for an unparsable URL (runCatching + getOrDefault)', () => {
    expect(officialUpdateAsset(TAG, NAME, 'not a url')).toBe(false);
    expect(officialUpdateAsset(TAG, NAME, '/relative/path.apk')).toBe(false);
  });
});

describe('releaseUrlFrom', () => {
  it('replaces the trailing "latest" segment with "tag/<tag>"', () => {
    expect(releaseUrlFrom(`${UPDATE_REPOSITORY}/releases/latest`, 'v1.2.3')).toBe(
      `${UPDATE_REPOSITORY}/releases/tag/v1.2.3`,
    );
    expect(releaseUrlFrom(`${UPDATE_REPOSITORY}/releases/latest`, TAG)).toBe(
      `${UPDATE_REPOSITORY}/releases/tag/${TAG}`,
    );
  });
});

describe('pathSegmentsOf / effectivePort', () => {
  it('percent-decodes segments and drops empties', () => {
    expect(pathSegmentsOf(new URL('https://github.com/a/b/c'))).toEqual(['a', 'b', 'c']);
    expect(pathSegmentsOf(new URL('https://github.com/a%20b/c'))).toEqual(['a b', 'c']);
    expect(pathSegmentsOf(new URL('https://github.com/'))).toEqual([]);
  });

  it('reports the implicit scheme default', () => {
    expect(effectivePort(new URL('https://github.com/x'))).toBe(443);
    expect(effectivePort(new URL('https://github.com:8443/x'))).toBe(8443);
    expect(effectivePort(new URL('http://github.com/x'))).toBe(80);
  });
});

describe('isAllowedSize', () => {
  it('is the 1..MAX_UPDATE_BYTES window', () => {
    expect(isAllowedSize(0)).toBe(false);
    expect(isAllowedSize(1)).toBe(true);
    expect(isAllowedSize(MAX_UPDATE_BYTES)).toBe(true);
    expect(isAllowedSize(MAX_UPDATE_BYTES + 1)).toBe(false);
    expect(isAllowedSize(null)).toBe(false);
    expect(isAllowedSize(undefined)).toBe(false);
    expect(MAX_UPDATE_BYTES).toBe(192 * 1024 * 1024);
  });
});

describe('httpFailure', () => {
  it('maps 403/429, 404 and everything else', () => {
    expect(httpFailure(403)).toBe('GitHub 接口访问受限或请求过多（HTTP 403）');
    expect(httpFailure(429)).toBe('GitHub 接口访问受限或请求过多（HTTP 429）');
    expect(httpFailure(404)).toBe('尚未找到正式发布版本（HTTP 404）');
    expect(httpFailure(500)).toBe('GitHub 请求未成功（HTTP 500）');
    expect(httpFailure(200)).toBe('GitHub 请求未成功（HTTP 200）');
  });
});

describe('failureReason', () => {
  it('returns the CheckFailure reason verbatim', () => {
    expect(failureReason(new GithubCheckFailure('GitHub 返回了空数据'))).toBe('GitHub 返回了空数据');
    expect(classifyFailure(new GithubCheckFailure('x'))).toBe('CHECK_FAILURE');
  });

  it('honours an explicit failure kind', () => {
    expect(failureReason(withGithubFailureKind(new Error('x'), 'UNKNOWN_HOST'))).toBe('GitHub 域名解析失败');
    expect(failureReason(withGithubFailureKind(new Error('x'), 'TIMEOUT'))).toBe('连接 GitHub 超时');
    expect(failureReason(withGithubFailureKind(new Error('x'), 'CONNECT'))).toBe(
      '无法连接 GitHub，请检查网络或系统代理',
    );
    expect(failureReason(withGithubFailureKind(new Error('x'), 'SSL'))).toBe('GitHub 安全连接失败');
    expect(failureReason(withGithubFailureKind(new Error('x'), 'JSON'))).toBe('GitHub 版本资料格式异常');
    expect(failureReason(withGithubFailureKind(new Error('x'), 'UNKNOWN'))).toBe('无法读取 GitHub 更新信息');
  });

  it('classifies a JSON parse failure as the org.json.JSONException bucket', () => {
    expect(classifyFailure(new SyntaxError('Unexpected token < in JSON'))).toBe('JSON');
    expect(failureReason(new SyntaxError('bad'))).toBe('GitHub 版本资料格式异常');
  });

  it('falls back to the catch-all for anything unrecognised', () => {
    expect(failureReason(new Error('nonsense'))).toBe('无法读取 GitHub 更新信息');
    expect(failureReason('a string')).toBe('无法读取 GitHub 更新信息');
  });
});

describe('decodeReleaseMetadata', () => {
  it('rejects an empty body', () => {
    expect(() => decodeReleaseMetadata(new Uint8Array(0))).toThrow('GitHub 返回了空数据');
  });

  it('rejects an oversized body', () => {
    expect(() => decodeReleaseMetadata(new Uint8Array(512 * 1024 + 1))).toThrow('压缩包解压体积超过安全上限');
  });

  it('decodes UTF-8', () => {
    const text = decodeReleaseMetadata(new TextEncoder().encode('{"tag_name":"v1.0.0"}'));
    expect(JSON.parse(text).tag_name).toBe('v1.0.0');
  });
});

describe('assetState', () => {
  it('defaults to "uploaded" and preserves an explicit state', () => {
    expect(assetState({})).toBe('uploaded');
    expect(assetState({ state: 'new' })).toBe('new');
    expect(assetState({ state: 'uploaded' })).toBe('uploaded');
    expect(assetState({ state: null })).toBe('uploaded');
  });
});

/* ── The whole-checker flow, driven by a stub transport ──────────────────────── */

function stubHttp(responses: Array<Partial<HttpResponse> & { status: number }>): {
  http: UpdateHttpClient;
  requests: string[];
} {
  const requests: string[] = [];
  let index = 0;
  return {
    requests,
    http: {
      async request(req) {
        requests.push(req.url);
        const next = responses[index];
        index += 1;
        if (next === undefined) throw new Error('no stubbed response');
        return {
          status: next.status,
          headers: next.headers ?? {},
          body: next.body ?? new Uint8Array(0),
          url: next.url ?? req.url,
        };
      },
    },
  };
}

function apiBody(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function makeChecker(http: UpdateHttpClient): GithubUpdateChecker {
  return new GithubUpdateChecker({ http, versionName: '1.2.0' });
}

const VALID_ASSET = {
  name: NAME,
  browser_download_url: ASSET_URL,
  size: 1024,
  state: 'uploaded',
  digest: `sha256:${'A'.repeat(64)}`,
};

describe('GithubUpdateChecker.selectAssets (release-asset selection)', () => {
  it('keeps only official assets inside the size window', () => {
    const assets = GithubUpdateChecker.selectAssets(
      [
        { name: NAME, browser_download_url: ASSET_URL, size: 1024 },
        { name: 'notes.txt', browser_download_url: 'https://x/y', size: 10 },
        { name: NAME, browser_download_url: ASSET_URL, size: 0 },
        { name: NAME, browser_download_url: ASSET_URL, size: MAX_UPDATE_BYTES + 1 },
      ],
      TAG,
    );
    expect(assets).toEqual([{ name: NAME, url: ASSET_URL, size: 1024, sha256: null }]);
  });

  it('drops an asset whose state is not "uploaded"', () => {
    expect(GithubUpdateChecker.selectAssets([{ ...VALID_ASSET, state: 'new' }], TAG)).toEqual([]);
    expect(GithubUpdateChecker.selectAssets([{ ...VALID_ASSET, state: 'uploaded' }], TAG)).toHaveLength(1);
  });

  it('lowercases a well-formed sha256 digest and rejects a malformed one', () => {
    const lower = 'b'.repeat(64);
    // Kotlin `Regex("sha256:[0-9a-fA-F]{64}")` — case-sensitive prefix, either-case hex.
    expect(
      GithubUpdateChecker.selectAssets([{ ...VALID_ASSET, digest: `sha256:${lower.toUpperCase()}` }], TAG)[0]
        ?.sha256,
    ).toBe(lower);
    expect(GithubUpdateChecker.selectAssets([{ ...VALID_ASSET, digest: `SHA256:${lower}` }], TAG)).toEqual([]);
    expect(GithubUpdateChecker.selectAssets([{ ...VALID_ASSET, digest: `sha256:${'z'.repeat(64)}` }], TAG)).toEqual([]);
    expect(GithubUpdateChecker.selectAssets([{ ...VALID_ASSET, digest: 'sha256:short' }], TAG)).toEqual([]);
    expect(GithubUpdateChecker.selectAssets([{ ...VALID_ASSET, digest: lower }], TAG)).toEqual([]);
  });

  it('treats an absent digest and the literal "null" digest as no digest', () => {
    const noDigest = { ...VALID_ASSET };
    delete (noDigest as Record<string, unknown>).digest;
    expect(GithubUpdateChecker.selectAssets([noDigest], TAG)[0]?.sha256).toBeNull();
    expect(GithubUpdateChecker.selectAssets([{ ...VALID_ASSET, digest: 'null' }], TAG)[0]?.sha256).toBeNull();
    expect(GithubUpdateChecker.selectAssets([{ ...VALID_ASSET, digest: '' }], TAG)[0]?.sha256).toBeNull();
    expect(GithubUpdateChecker.selectAssets([{ ...VALID_ASSET, digest: null }], TAG)[0]?.sha256).toBeNull();
  });

  it('skips non-object array entries and a null assets array', () => {
    expect(GithubUpdateChecker.selectAssets(null, TAG)).toEqual([]);
    expect(GithubUpdateChecker.selectAssets([null, 'x', VALID_ASSET], TAG)).toHaveLength(1);
  });
});

describe('GithubUpdateChecker.check', () => {
  it('reports a newer release and offers it', async () => {
    const { http, requests } = stubHttp([
      { status: 200, body: apiBody({ tag_name: TAG, body: 'notes', assets: [VALID_ASSET] }) },
    ]);
    const result = await makeChecker(http).check('1.2.0');
    expect(result.message).toBe('发现新版本 1.2.3，可下载并安装。');
    expect(result.releaseUrl).toBe(`${UPDATE_REPOSITORY}/releases/tag/${TAG}`);
    expect(result.release?.version).toBe('1.2.3');
    expect(result.release?.notes).toBe('notes');
    expect(result.release?.apk?.name).toBe(NAME);
    expect(requests[0]).toBe('https://api.github.com/repos/roxycon-dev/Ciallo-Reader/releases/latest');
  });

  it('reports 1.2.10 as newer than 1.2.9', async () => {
    const { http } = stubHttp([{ status: 200, body: apiBody({ tag_name: 'v1.2.10', assets: [] }) }]);
    expect((await makeChecker(http).check('1.2.9')).message).toBe('发现新版本 1.2.10，可下载并安装。');
  });

  it('reports "already latest" for an older or equal tag', async () => {
    const older = stubHttp([{ status: 200, body: apiBody({ tag_name: 'v1.2.2', assets: [] }) }]);
    expect((await makeChecker(older.http).check('1.2.3')).message).toBe(
      '当前已是最新版本（GitHub 正式版 1.2.2）。',
    );
    const same = stubHttp([{ status: 200, body: apiBody({ tag_name: 'v1.2.3', assets: [] }) }]);
    expect((await makeChecker(same.http).check('1.2.3')).message).toBe(
      '当前已是最新版本（GitHub 正式版 1.2.3）。',
    );
  });

  it('rejects a draft or prerelease payload', async () => {
    const draft = stubHttp([{ status: 200, body: apiBody({ tag_name: TAG, draft: true, assets: [] }) }]);
    expect((await makeChecker(draft.http).check('1.0.0')).message).toContain('GitHub 返回的正式版本资料不完整');
    const pre = stubHttp([
      { status: 200, body: apiBody({ tag_name: TAG, prerelease: true, assets: [] }) },
    ]);
    expect((await makeChecker(pre.http).check('1.0.0')).message).toContain('GitHub 返回的正式版本资料不完整');
    const weirdTag = stubHttp([{ status: 200, body: apiBody({ tag_name: 'nightly', assets: [] }) }]);
    expect((await makeChecker(weirdTag.http).check('1.0.0')).message).toContain('GitHub 返回的正式版本资料不完整');
  });

  it('surfaces an unparsable current version', async () => {
    const { http } = stubHttp([{ status: 200, body: apiBody({ tag_name: TAG, assets: [] }) }]);
    expect((await makeChecker(http).check('unknown')).message).toBe(
      '无法识别当前版本，请打开 GitHub 发布页查看。',
    );
  });

  it('falls back to the releases/latest redirect and joins the two reasons on failure', async () => {
    const ok = stubHttp([
      { status: 500, body: new Uint8Array(0) },
      { status: 302, headers: { Location: `${UPDATE_REPOSITORY}/releases/tag/v9.9.9` } },
    ]);
    const result = await makeChecker(ok.http).check('1.0.0');
    expect(result.message).toBe('发现新版本 9.9.9，可下载并安装。');
    expect(result.release?.apk?.url).toBe(
      `${UPDATE_REPOSITORY}/releases/download/v9.9.9/Ciallo-Reader-v9.9.9.apk`,
    );
    expect(result.release?.notes).toBe('');

    const bothFail = stubHttp([
      { status: 404, body: new Uint8Array(0) },
      { status: 200, body: new Uint8Array(0) },
    ]);
    expect((await makeChecker(bothFail.http).check('1.0.0')).message).toBe(
      '检查更新失败：尚未找到正式发布版本（HTTP 404）；GitHub 请求未成功（HTTP 200）。可稍后重试或打开 GitHub 发布页。',
    );
  });

  it('deduplicates identical failure reasons before joining', async () => {
    const bothFail = stubHttp([
      { status: 500, body: new Uint8Array(0) },
      { status: 500, body: new Uint8Array(0) },
    ]);
    expect((await makeChecker(bothFail.http).check('1.0.0')).message).toBe(
      '检查更新失败：GitHub 请求未成功（HTTP 500）。可稍后重试或打开 GitHub 发布页。',
    );
  });

  it('refuses a cross-host or off-repo Location header', async () => {
    const evil = stubHttp([
      { status: 500, body: new Uint8Array(0) },
      { status: 302, headers: { Location: 'https://evil.example/roxycon-dev/Ciallo-Reader/releases/tag/v9.9.9' } },
    ]);
    expect((await makeChecker(evil.http).check('1.0.0')).message).toContain(
      'GitHub 发布页返回了非项目版本地址',
    );

    const missing = stubHttp([
      { status: 500, body: new Uint8Array(0) },
      { status: 302, headers: {} },
    ]);
    expect((await makeChecker(missing.http).check('1.0.0')).message).toContain(
      'GitHub 发布页未提供版本地址',
    );

    const badTag = stubHttp([
      { status: 500, body: new Uint8Array(0) },
      { status: 302, headers: { Location: `${UPDATE_REPOSITORY}/releases/tag/nightly` } },
    ]);
    expect((await makeChecker(badTag.http).check('1.0.0')).message).toContain('GitHub 发布页版本格式异常');
  });

  it('rejects a non-redirect response on the releases/latest probe', async () => {
    const { http } = stubHttp([
      { status: 500, body: new Uint8Array(0) },
      { status: 200, body: new Uint8Array(0) },
    ]);
    expect((await makeChecker(http).check('1.0.0')).message).toContain('GitHub 请求未成功（HTTP 200）');
  });
});

describe('makeUpdateRelease', () => {
  it('defaults notes to "" and apk to null, and derives version from the tag', () => {
    const release = makeUpdateRelease(TAG, 'u');
    expect(release.notes).toBe('');
    expect(release.apk).toBeNull();
    expect(release.version).toBe('1.2.3');
  });
});
