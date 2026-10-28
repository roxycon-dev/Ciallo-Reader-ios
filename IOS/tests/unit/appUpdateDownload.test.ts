/**
 * Tests for `src/core/update/appUpdateDownload.ts`
 * (port of `com/example/data/AppUpdateDownload.kt`): the redirect walk, the chunk budget,
 * the 100 ms progress cadence, the SHA-256 helper and the archive identity gate.
 */

import { describe, expect, it } from 'vitest';
import {
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
  type UpdateProgressCallback,
} from '../../src/core/update/appUpdateDownload';
import type { UpdateFileStore } from '../../src/core/update/appUpdateStore';
import {
  MAX_UPDATE_BYTES,
  UPDATE_REPOSITORY,
  makeUpdateRelease,
  officialUpdateAsset,
  type UpdateApkAsset,
  type UpdateHttpClient,
  type UpdateHttpRequestOptions,
} from '../../src/core/update/githubUpdateChecker';
import type { HttpResponse } from '../../src/platform/interfaces';

const TAG = 'v1.2.3';
const NAME = 'Ciallo-Reader-v1.2.3.apk';
const ASSET_URL = `${UPDATE_REPOSITORY}/releases/download/${TAG}/${NAME}`;

class MemoryUpdateStore implements UpdateFileStore {
  readonly files = new Map<string, Uint8Array>();
  readonly filesDir = 'files';
  readonly deleted: string[] = [];

  async mkdirs(): Promise<void> {}
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async isFile(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async size(path: string): Promise<number> {
    return this.files.get(path)?.length ?? 0;
  }
  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (data === undefined) throw new Error(`missing ${path}`);
    return data;
  }
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data.slice());
  }
  async delete(path: string): Promise<boolean> {
    this.deleted.push(path);
    return this.files.delete(path);
  }
  async list(): Promise<string[] | null> {
    return [];
  }
  async rename(): Promise<boolean> {
    return false;
  }
  canonicalPath(path: string): string {
    return path;
  }
}

function asset(overrides: Partial<UpdateApkAsset> = {}): UpdateApkAsset {
  // Kotlin leaves `asset.size` nullable and every guard branches on it, so the default is
  // "no published size" and each test opts in explicitly.
  return { name: NAME, url: ASSET_URL, size: null, sha256: null, ...overrides };
}

function ok(body: Uint8Array, extra: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, headers: {}, body, url: ASSET_URL, ...extra };
}

interface SeenRequest {
  url: string;
  headers?: Record<string, string> | undefined;
  options?: UpdateHttpRequestOptions | undefined;
}

function transport(scripted: Array<Partial<HttpResponse> & { status: number }>): {
  http: UpdateHttpClient;
  seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  let index = 0;
  return {
    seen,
    http: {
      async request(req, options) {
        seen.push({ url: req.url, headers: req.headers, options });
        const next = scripted[index];
        index += 1;
        if (next === undefined) throw new Error('script exhausted');
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

function makeDownloader(
  http: UpdateHttpClient,
  fs: UpdateFileStore,
  nowNs: () => number = () => 0,
  signal?: AbortSignal,
): AppUpdateDownload {
  return new AppUpdateDownload({ http, fs, versionName: '1.2.0', nowNs, signal });
}

describe('constants', () => {
  it('preserves the Kotlin literals', () => {
    expect(DOWNLOAD_CHUNK_BYTES).toBe(64 * 1024);
    expect(DOWNLOAD_PROGRESS_INTERVAL_NS).toBe(100_000_000);
    expect(DOWNLOAD_TIMEOUT_MS).toBe(10 * 60 * 1000);
    expect([...DOWNLOAD_REDIRECT_HOSTS].sort()).toEqual([
      'github.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com',
    ]);
  });
});

describe('bytesToHex / sha256Hex / updateFileSha256', () => {
  it('formats bytes as %02x', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe('00010f10ff');
  });

  it('matches the well-known SHA-256 vectors', async () => {
    expect(await sha256Hex(new TextEncoder().encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes a file through the injected store', async () => {
    const fs = new MemoryUpdateStore();
    await fs.writeFile('a.bin', new TextEncoder().encode('abc'));
    expect(await updateFileSha256(fs, 'a.bin')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('declaredContentLength', () => {
  it('prefers Content-Length and falls back to the body length', () => {
    expect(declaredContentLength(ok(new Uint8Array(5)))).toBe(5);
    expect(declaredContentLength(ok(new Uint8Array(5), { headers: { 'content-length': '9' } }))).toBe(9);
    expect(declaredContentLength(ok(new Uint8Array(5), { headers: { 'Content-Length': 'bad' } }))).toBe(5);
  });
});

describe('assertChunkBudget', () => {
  it('is the MAX_UPDATE_BYTES + declared-total guard', () => {
    expect(() => assertChunkBudget(1, null)).not.toThrow();
    expect(() => assertChunkBudget(1, 2)).not.toThrow();
    expect(() => assertChunkBudget(3, 2)).toThrow('安装包大小异常');
    expect(() => assertChunkBudget(MAX_UPDATE_BYTES, null)).not.toThrow();
    expect(() => assertChunkBudget(MAX_UPDATE_BYTES + 1, null)).toThrow('安装包大小异常');
  });
});

describe('assertSafeRedirect', () => {
  it('allows only https:443 GitHub hosts without userinfo', () => {
    for (const host of DOWNLOAD_REDIRECT_HOSTS) {
      expect(() => assertSafeRedirect(new URL(`https://${host}/x`))).not.toThrow();
    }
    expect(() => assertSafeRedirect(new URL('http://github.com/x'))).toThrow(
      '下载跳转不是 GitHub 官方安全地址',
    );
    expect(() => assertSafeRedirect(new URL('https://github.com:8443/x'))).toThrow(
      '下载跳转不是 GitHub 官方安全地址',
    );
    expect(() => assertSafeRedirect(new URL('https://evil.example/x'))).toThrow(
      '下载跳转不是 GitHub 官方安全地址',
    );
    expect(() => assertSafeRedirect(new URL('https://u:p@github.com/x'))).toThrow(
      '下载跳转不是 GitHub 官方安全地址',
    );
  });
});

describe('AppUpdateDownload.download — guards before any byte is written', () => {
  it('rejects a non-official asset', async () => {
    const fs = new MemoryUpdateStore();
    const { http } = transport([]);
    await expect(
      makeDownloader(http, fs).download(asset({ url: 'https://evil.example/x.apk' }), TAG, 'out.part', () => {}),
    ).rejects.toThrow('安装包地址不属于此版本的官方发布');
  });

  it('rejects an implausible declared size and accepts a missing one', async () => {
    const fs = new MemoryUpdateStore();
    const { http } = transport([]);
    await expect(
      makeDownloader(http, fs).download(asset({ size: 0 }), TAG, 'out.part', () => {}),
    ).rejects.toThrow('安装包大小异常');
    await expect(
      makeDownloader(http, fs).download(asset({ size: MAX_UPDATE_BYTES + 1 }), TAG, 'out.part', () => {}),
    ).rejects.toThrow('安装包大小异常');
    // `asset.size == null` reaches the transport, i.e. the size guard let it through.
    const okTransport = transport([{ status: 200, body: new Uint8Array(4) }]);
    await expect(
      makeDownloader(okTransport.http, fs).download(asset({ size: null }), TAG, 'out.part', () => {}),
    ).resolves.toBeUndefined();
  });

  it('deletes the destination when the transfer fails early', async () => {
    const fs = new MemoryUpdateStore();
    await fs.writeFile('out.part', new Uint8Array(4));
    const { http } = transport([]);
    await expect(
      makeDownloader(http, fs).download(asset({ size: null }), TAG, 'out.part', () => {}),
    ).rejects.toThrow();
    expect(fs.deleted).toContain('out.part');
    expect(await fs.exists('out.part')).toBe(false);
  });
});

describe('AppUpdateDownload.download — happy path and progress cadence', () => {
  it('reports 0/total first, then received bytes, then the completion frame', async () => {
    const fs = new MemoryUpdateStore();
    const body = new Uint8Array(10);
    const { http } = transport([{ status: 200, body }]);
    const frames: Array<[number, number | null]> = [];
    let clock = 0;
    const downloader = makeDownloader(
      http,
      fs,
      () => {
        clock += DOWNLOAD_PROGRESS_INTERVAL_NS;
        return clock;
      },
    );
    await downloader.download(asset({ size: 10 }), TAG, 'out.part', (received, total) => {
      frames.push([received, total]);
    });
    expect(frames[0]).toEqual([0, 10]);
    expect(frames[frames.length - 1]).toEqual([10, 10]);
    expect((await fs.readFile('out.part')).length).toBe(10);
  });

  it('emits a progress frame at most every 100 ms for a large body', async () => {
    const fs = new MemoryUpdateStore();
    const body = new Uint8Array(DOWNLOAD_CHUNK_BYTES * 10);
    const { http } = transport([{ status: 200, body }]);
    let clock = 0;
    const downloader = makeDownloader(http, fs, () => {
      clock += 10 * 1_000_000; // 10 ms per chunk -> one frame every ten chunks
      return clock;
    });
    const frames: number[] = [];
    await downloader.download(asset({ size: body.length }), TAG, 'out.part', (received) => {
      frames.push(received);
    });
    expect(frames[0]).toBe(0);
    expect(frames[frames.length - 1]).toBe(body.length);
    expect(frames.length).toBeLessThan(12);
    expect(frames.length).toBeGreaterThan(2);
  });

  it('sends the Kotlin User-Agent / Accept / Accept-Encoding headers', async () => {
    const fs = new MemoryUpdateStore();
    const { http, seen } = transport([{ status: 200, body: new Uint8Array(4) }]);
    const downloader = new AppUpdateDownload({
      http,
      fs,
      versionName: '9.9.9',
      nowNs: () => 0,
    });
    await downloader.download(asset({ size: 4 }), TAG, 'out.part', () => {});
    expect(seen[0]?.url).toBe(ASSET_URL);
    expect(seen[0]?.headers).toEqual({
      'User-Agent': 'Ciallo-Reader/9.9.9',
      Accept: 'application/octet-stream',
      'Accept-Encoding': 'identity',
    });
    expect(seen[0]?.options?.followRedirects).toBe(false);
  });

  it('keeps the destination when the transfer completed', async () => {
    const fs = new MemoryUpdateStore();
    const { http } = transport([{ status: 200, body: new Uint8Array(4) }]);
    await makeDownloader(http, fs).download(asset({ size: 4 }), TAG, 'out.part', () => {});
    expect(fs.deleted).not.toContain('out.part');
    expect(await fs.exists('out.part')).toBe(true);
  });
});

describe('AppUpdateDownload.download — size reconciliation', () => {
  it('rejects a body that disagrees with the published size', async () => {
    const fs = new MemoryUpdateStore();
    const { http } = transport([{ status: 200, body: new Uint8Array(4) }]);
    await expect(
      makeDownloader(http, fs).download(asset({ size: 8 }), TAG, 'out.part', () => {}),
    ).rejects.toThrow('安装包大小与发布信息不符');
  });

  it('rejects a truncated body against the declared length', async () => {
    const fs = new MemoryUpdateStore();
    const body = new Uint8Array(4);
    const { http } = transport([{ status: 200, body, headers: { 'content-length': '99' } }]);
    await expect(
      makeDownloader(http, fs).download(asset({ size: null }), TAG, 'out.part', () => {}),
    ).rejects.toThrow('安装包下载不完整，请重试');
  });

  it('rejects an empty body at the size guard', async () => {
    const fs = new MemoryUpdateStore();
    // Kotlin L66-67: `body.contentLength()` is 0 for a declared-empty 200 response, so
    // `require(length in 1..MAX_UPDATE_BYTES)` fires before the copy loop.
    const { http } = transport([{ status: 200, body: new Uint8Array(0) }]);
    await expect(
      makeDownloader(http, fs).download(asset({ size: null }), TAG, 'out.part', () => {}),
    ).rejects.toThrow('安装包大小异常');
  });

  it('rejects a non-200 final response with the HTTP code in the message', async () => {
    const fs = new MemoryUpdateStore();
    const { http } = transport([{ status: 503, body: new Uint8Array(0) }]);
    await expect(
      makeDownloader(http, fs).download(asset({ size: null }), TAG, 'out.part', () => {}),
    ).rejects.toThrow('安装包下载失败（HTTP 503），可重试或使用浏览器下载');
  });
});

describe('AppUpdateDownload.download — redirect walk', () => {
  it('follows a 302 to a GitHub asset host and reports the final bytes', async () => {
    const fs = new MemoryUpdateStore();
    const target = 'https://release-assets.githubusercontent.com/o/1?token=x';
    const { http, seen } = transport([
      { status: 302, headers: { Location: target } },
      { status: 200, body: new Uint8Array(4), url: target },
    ]);
    await makeDownloader(http, fs).download(asset({ size: null }), TAG, 'out.part', () => {});
    expect(seen.map((r) => r.url)).toEqual([ASSET_URL, target]);
    expect(await fs.exists('out.part')).toBe(true);
  });

  it('rejects a 302 without a Location header', async () => {
    const fs = new MemoryUpdateStore();
    const { http } = transport([{ status: 302, headers: {} }]);
    await expect(
      makeDownloader(http, fs).download(asset({ size: null }), TAG, 'out.part', () => {}),
    ).rejects.toThrow('下载跳转缺少地址');
  });

  it('rejects a redirect off the GitHub allow-list', async () => {
    const fs = new MemoryUpdateStore();
    const { http } = transport([
      { status: 307, headers: { Location: 'https://cdn.example/evil.apk' } },
    ]);
    await expect(
      makeDownloader(http, fs).download(asset({ size: null }), TAG, 'out.part', () => {}),
    ).rejects.toThrow('下载跳转不是 GitHub 官方安全地址');
  });

  it('gives up after 6 hops', async () => {
    const fs = new MemoryUpdateStore();
    const hop = { status: 302, headers: { Location: 'https://github.com/next' } };
    const { http, seen } = transport(Array.from({ length: 8 }, () => hop));
    await expect(
      makeDownloader(http, fs).download(asset({ size: null }), TAG, 'out.part', () => {}),
    ).rejects.toThrow('下载跳转次数过多，请使用浏览器下载');
    // `for (redirect in 0..5)` is six requests, not seven.
    expect(seen.length).toBe(6);
  });
});

describe('AppUpdateDownload.download — cancellation', () => {
  it('aborts through the signal and deletes the partial destination', async () => {
    const fs = new MemoryUpdateStore();
    const controller = new AbortController();
    const { http } = transport([{ status: 200, body: new Uint8Array(DOWNLOAD_CHUNK_BYTES * 4) }]);
    controller.abort();
    await expect(
      makeDownloader(http, fs, () => 0, controller.signal).download(
        asset({ size: null }),
        TAG,
        'out.part',
        () => {},
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fs.deleted).toContain('out.part');
  });

  it('passes the signal down to the transport so the socket is cancelled', async () => {
    const fs = new MemoryUpdateStore();
    const controller = new AbortController();
    const { http, seen } = transport([{ status: 200, body: new Uint8Array(4) }]);
    await makeDownloader(http, fs, () => 0, controller.signal).download(
      asset({ size: 4 }),
      TAG,
      'out.part',
      () => {},
    );
    expect(seen[0]?.options?.signal).toBe(controller.signal);
  });
});

/* ── UpdateApkVerifier ─────────────────────────────────────────────────────────── */

interface Identity {
  packageName: string;
  versionName: string | null;
  versionCode: number;
  minSdkVersion: number | null;
  signatures: readonly string[];
}

const INSTALLED: Identity = {
  packageName: 'com.example.novelreader',
  versionName: '1.2.0',
  versionCode: 2,
  minSdkVersion: 24,
  signatures: ['f'.repeat(64)],
};

function archiveWith(overrides: Partial<Identity> = {}): Identity {
  return { ...INSTALLED, versionName: '1.2.3', versionCode: 3, minSdkVersion: 24, ...overrides };
}

function makeVerifier(archive: Identity | null, sdkInt = 34): UpdateApkVerifier {
  return new UpdateApkVerifier({
    inspector: {
      inspectArchive: async () => archive,
      installedPackage: async () => INSTALLED,
    },
    sdkInt,
    packageName: 'com.example.novelreader',
  });
}

const RELEASE = makeUpdateRelease(
  'v1.2.3',
  `${UPDATE_REPOSITORY}/releases/tag/v1.2.3`,
  'notes',
  { name: NAME, url: ASSET_URL, size: 4096, sha256: null },
);

describe('UpdateApkVerifier.verify', () => {
  it('returns the archive version code for a matching identity', async () => {
    const fs = new MemoryUpdateStore();
    await fs.writeFile('update.apk', new Uint8Array(4096));
    expect(await makeVerifier(archiveWith()).verify(fs, 'update.apk', RELEASE)).toBe(3);
  });

  it('rejects an empty or missing file', async () => {
    const fs = new MemoryUpdateStore();
    await fs.writeFile('empty.apk', new Uint8Array(0));
    await expect(makeVerifier(archiveWith()).verify(fs, 'empty.apk', RELEASE)).rejects.toThrow(
      '安装包为空或过大',
    );
    await expect(makeVerifier(archiveWith()).verify(fs, 'missing.apk', RELEASE)).rejects.toThrow(
      '安装包为空或过大',
    );
  });

  it('rejects a release with no apk', async () => {
    const fs = new MemoryUpdateStore();
    await fs.writeFile('update.apk', new Uint8Array(4096));
    const bare = makeUpdateRelease('v1.2.3', `${UPDATE_REPOSITORY}/releases/tag/v1.2.3`);
    await expect(makeVerifier(archiveWith()).verify(fs, 'update.apk', bare)).rejects.toThrow(
      '此版本没有可用安装包',
    );
  });

  it('rejects a size mismatch and a digest mismatch', async () => {
    const fs = new MemoryUpdateStore();
    await fs.writeFile('update.apk', new Uint8Array(4096));
    await expect(makeVerifier(archiveWith()).verify(fs, 'update.apk', RELEASE)).resolves.toBe(3);
    const wrongSize = makeUpdateRelease('v1.2.3', RELEASE.releaseUrl, 'notes', {
      name: NAME,
      url: ASSET_URL,
      size: 4095,
      sha256: null,
    });
    await expect(makeVerifier(archiveWith()).verify(fs, 'update.apk', wrongSize)).rejects.toThrow(
      '安装包大小校验失败',
    );
    const wrongHash = makeUpdateRelease('v1.2.3', RELEASE.releaseUrl, 'notes', {
      name: NAME,
      url: ASSET_URL,
      size: 4096,
      sha256: 'b'.repeat(64),
    });
    await expect(makeVerifier(archiveWith()).verify(fs, 'update.apk', wrongHash)).rejects.toThrow(
      '安装包完整性校验失败，请重新下载',
    );
  });

  it('rejects an uninspectable archive with the Android message', async () => {
    const fs = new MemoryUpdateStore();
    await fs.writeFile('update.apk', new Uint8Array(4096));
    await expect(makeVerifier(null).verify(fs, 'update.apk', RELEASE)).rejects.toThrow(
      '下载文件不是有效的 Android 安装包',
    );
  });

  it('rejects a foreign package, a version mismatch and a downgrade', async () => {
    const fs = new MemoryUpdateStore();
    await fs.writeFile('update.apk', new Uint8Array(4096));
    await expect(
      makeVerifier(archiveWith({ packageName: 'com.other.app' })).verify(fs, 'update.apk', RELEASE),
    ).rejects.toThrow('安装包不属于 Ciallo Reader');
    await expect(
      makeVerifier(archiveWith({ versionName: '1.2.4' })).verify(fs, 'update.apk', RELEASE),
    ).rejects.toThrow('安装包版本与更新信息不符');
    await expect(
      makeVerifier(archiveWith({ versionName: null })).verify(fs, 'update.apk', RELEASE),
    ).rejects.toThrow('安装包版本与更新信息不符');
    await expect(
      makeVerifier(archiveWith({ versionCode: 2 })).verify(fs, 'update.apk', RELEASE),
    ).rejects.toThrow('安装包不是比当前更新的版本');
    await expect(
      makeVerifier(archiveWith({ versionCode: 1 })).verify(fs, 'update.apk', RELEASE),
    ).rejects.toThrow('安装包不是比当前更新的版本');
  });

  it('defaults a null minSdkVersion to 24 and compares it with the device SDK', async () => {
    const fs = new MemoryUpdateStore();
    await fs.writeFile('update.apk', new Uint8Array(4096));
    await expect(
      makeVerifier(archiveWith({ minSdkVersion: null }), 23).verify(fs, 'update.apk', RELEASE),
    ).rejects.toThrow('新版本不支持当前 Android 系统');
    await expect(
      makeVerifier(archiveWith({ minSdkVersion: null }), 24).verify(fs, 'update.apk', RELEASE),
    ).resolves.toBe(3);
    await expect(
      makeVerifier(archiveWith({ minSdkVersion: 35 }), 34).verify(fs, 'update.apk', RELEASE),
    ).rejects.toThrow('新版本不支持当前 Android 系统');
  });

  it('rejects a signing-key mismatch and an empty installed signature set', async () => {
    const fs = new MemoryUpdateStore();
    await fs.writeFile('update.apk', new Uint8Array(4096));
    await expect(
      makeVerifier(archiveWith({ signatures: ['0'.repeat(64)] })).verify(fs, 'update.apk', RELEASE),
    ).rejects.toThrow('新版本签名与当前应用不一致，无法直接覆盖安装。请先备份数据，再查看发布页的迁移说明');
    const unsigned = new UpdateApkVerifier({
      inspector: {
        inspectArchive: async () => archiveWith({ signatures: [] }),
        installedPackage: async () => ({ ...INSTALLED, signatures: [] }),
      },
      sdkInt: 34,
      packageName: 'com.example.novelreader',
    });
    await expect(unsigned.verify(fs, 'update.apk', RELEASE)).rejects.toThrow('新版本签名与当前应用不一致');
  });
});

describe('officialUpdateAsset interop', () => {
  it('still accepts the asset the downloader allows', () => {
    expect(officialUpdateAsset(TAG, NAME, ASSET_URL)).toBe(true);
    const p: UpdateProgressCallback = () => {};
    expect(typeof p).toBe('function');
  });
});
