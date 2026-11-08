/**
 * Pure-logic + in-memory tests for `src/core/update/appUpdateStore.ts`
 * (port of `com/example/data/AppUpdateStore.kt`).
 *
 * Covers the retention/cleanup policy (`clearPartialFiles`, `cleanupInstalled`),
 * the `pending.json` metadata round trip and every guard in `load()`.
 */

import { describe, expect, it } from 'vitest';
import {
  APP_UPDATE_APK_FILE,
  APP_UPDATE_DIRECTORY,
  APP_UPDATE_METADATA_FILE,
  AppUpdateStore,
  AtomicMetadataFile,
  canonicalize,
  encodePendingMetadata,
  fileExtension,
  joinPath,
  kCheck,
  kRequire,
  randomUuid,
  type AppPackageIdentity,
  type PendingAppUpdate,
  type UpdateFileStore,
} from '../../src/core/update/appUpdateStore';
import {
  MAX_UPDATE_BYTES,
  UPDATE_REPOSITORY,
  makeUpdateRelease,
  type UpdateApkAsset,
} from '../../src/core/update/githubUpdateChecker';

const FILES_DIR = 'files';
const DIRECTORY = `${FILES_DIR}/${APP_UPDATE_DIRECTORY}`;
const APK = `${DIRECTORY}/${APP_UPDATE_APK_FILE}`;
const META = `${DIRECTORY}/${APP_UPDATE_METADATA_FILE}`;

const TAG = 'v1.2.3';
const ASSET_NAME = 'Ciallo-Reader-v1.2.3.apk';
const ASSET_URL = `${UPDATE_REPOSITORY}/releases/download/${TAG}/${ASSET_NAME}`;
const SHA = 'a'.repeat(64);

/** `MemoryFileSystem` over the `UpdateFileStore` port, with a rename that is not atomic. */
class MemoryUpdateStore implements UpdateFileStore {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  readonly filesDir = FILES_DIR;
  readonly canonical = new Map<string, string>();

  async mkdirs(path: string): Promise<void> {
    this.dirs.add(canonicalize(path));
    this.canonical.set(canonicalize(path), canonicalize(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(canonicalize(path));
  }

  async isFile(path: string): Promise<boolean> {
    return this.files.has(canonicalize(path));
  }

  async size(path: string): Promise<number> {
    return this.files.get(canonicalize(path))?.length ?? 0;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(canonicalize(path));
    if (data === undefined) throw new Error(`file not found: ${path}`);
    return data;
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.files.set(canonicalize(path), data.slice());
  }

  async delete(path: string): Promise<boolean> {
    return this.files.delete(canonicalize(path));
  }

  async list(path: string): Promise<string[] | null> {
    const prefix = `${canonicalize(path)}/`;
    const out = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      out.add(slash < 0 ? rest : rest.slice(0, slash));
    }
    return [...out].sort();
  }

  async rename(from: string, to: string): Promise<boolean> {
    const key = canonicalize(from);
    const data = this.files.get(key);
    if (data === undefined) return false;
    this.files.set(canonicalize(to), data);
    this.files.delete(key);
    return true;
  }

  canonicalPath(path: string): string {
    const key = canonicalize(path);
    return this.canonical.get(key) ?? key;
  }
}

function makeStore(versionCode: number): { store: AppUpdateStore; fs: MemoryUpdateStore } {
  const fs = new MemoryUpdateStore();
  const pkg: AppPackageIdentity = { packageName: 'com.example.novelreader', versionCode };
  return { store: new AppUpdateStore({ fs, packageIdentity: pkg }), fs };
}

function pending(overrides: Partial<PendingAppUpdate> = {}): PendingAppUpdate {
  const asset: UpdateApkAsset = { name: ASSET_NAME, url: ASSET_URL, size: 4096, sha256: SHA };
  return {
    release: makeUpdateRelease(TAG, `${UPDATE_REPOSITORY}/releases/tag/${TAG}`, 'notes', asset),
    versionCode: 3,
    sha256: SHA,
    ...overrides,
  };
}

describe('fileExtension', () => {
  it('reproduces java.io/kotlin File.extension', () => {
    expect(fileExtension('update.apk')).toBe('apk');
    expect(fileExtension('noext')).toBe('');
    expect(fileExtension('.part')).toBe('part');
    expect(fileExtension('trailing.')).toBe('');
    expect(fileExtension('a.b.c')).toBe('c');
    expect(fileExtension('')).toBe('');
  });
});

describe('canonicalize / joinPath', () => {
  it('is a lexical canonicalization (no symlinks in core)', () => {
    expect(canonicalize('/a/b/../c')).toBe('/a/c');
    expect(canonicalize('/a/./b/')).toBe('/a/b');
    expect(canonicalize('a/b/../c')).toBe('a/c');
  });

  it('joins POSIX-style paths and collapses the trailing separator', () => {
    expect(joinPath('files', APP_UPDATE_DIRECTORY)).toBe(DIRECTORY);
    expect(joinPath('files/', 'app_updates')).toBe(DIRECTORY);
    expect(joinPath('/data/files', 'app_updates')).toBe('/data/files/app_updates');
  });
});

describe('kCheck / kRequire', () => {
  it('uses Kotlin default messages when none is given', () => {
    expect(() => kCheck(false)).toThrow('Check failed.');
    expect(() => kRequire(false)).toThrow('Failed requirement.');
    expect(() => kCheck(false, '无法替换旧安装包')).toThrow('无法替换旧安装包');
    expect(() => kCheck(true)).not.toThrow();
  });
});

describe('randomUuid', () => {
  it('produces a distinct RFC-4122 v4 layout each call', () => {
    const a = randomUuid();
    const b = randomUuid();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a[14]).toBe('4');
    expect(a).not.toBe(b);
  });
});

describe('encodePendingMetadata', () => {
  it('keeps the Kotlin JSON field order and the JSON null sentinels', () => {
    const json = JSON.parse(encodePendingMetadata(pending())) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual([
      'tag',
      'releaseUrl',
      'notes',
      'name',
      'url',
      'size',
      'digest',
      'versionCode',
      'sha256',
    ]);
    expect(json['size']).toBe(4096);
    expect(json['digest']).toBe(SHA);
    const bare = pending({
      release: makeUpdateRelease(TAG, `${UPDATE_REPOSITORY}/releases/tag/${TAG}`),
    });
    expect(() => encodePendingMetadata(bare)).toThrow('更新缺少安装包');
  });
});

describe('AppUpdateStore paths', () => {
  it('pins the fixed private paths', async () => {
    const { store, fs } = makeStore(1);
    expect(await store.apkFile()).toBe(APK);
    const part = await store.newTransferFile();
    expect(part.startsWith(`${DIRECTORY}/`)).toBe(true);
    expect(fileExtension(part)).toBe('part');
    expect(fs.dirs.has(DIRECTORY)).toBe(true);
    // Two transfers never collide.
    expect(await store.newTransferFile()).not.toBe(part);
  });
});

describe('AppUpdateStore.save', () => {
  it('renames the .part into update.apk and writes pending.json', async () => {
    const { store, fs } = makeStore(1);
    const part = await store.newTransferFile();
    await fs.writeFile(part, new Uint8Array(64));
    const record = pending();
    await store.save(part, record);
    expect(await fs.exists(APK)).toBe(true);
    expect(await fs.exists(part)).toBe(false);
    expect(await fs.exists(`${META}.bak`)).toBe(false);
    expect(await store.load()).toEqual(record);
  });

  it('replaces an older package', async () => {
    const { store, fs } = makeStore(1);
    for (let i = 0; i < 2; i += 1) {
      const part = await store.newTransferFile();
      await fs.writeFile(part, new Uint8Array(64));
      await store.save(part, pending());
    }
    expect(await fs.exists(APK)).toBe(true);
    expect(await store.load()).not.toBeNull();
  });

  it('rejects a transfer file outside app_updates', async () => {
    const { store, fs } = makeStore(1);
    await fs.writeFile('elsewhere/evil.part', new Uint8Array(8));
    await expect(store.save('elsewhere/evil.part', pending())).rejects.toThrow('Check failed.');
  });

  it('rejects a transfer file without the .part extension', async () => {
    const { store, fs } = makeStore(1);
    await fs.writeFile(`${DIRECTORY}/update.apk`, new Uint8Array(8));
    await expect(store.save(`${DIRECTORY}/update.apk`, pending())).rejects.toThrow('Check failed.');
  });

  it('rejects a release whose asset is not the official artifact', async () => {
    const { store, fs } = makeStore(1);
    const part = await store.newTransferFile();
    await fs.writeFile(part, new Uint8Array(8));
    const evil = pending({
      release: makeUpdateRelease(TAG, `${UPDATE_REPOSITORY}/releases/tag/${TAG}`, '', {
        name: ASSET_NAME,
        url: 'https://evil.example/x.apk',
        size: 8,
        sha256: null,
      }),
    });
    await expect(store.save(part, evil)).rejects.toThrow('Failed requirement.');
  });

  it('throws "无法保存安装包" when the rename fails', async () => {
    const { store, fs } = makeStore(1);
    const part = await store.newTransferFile();
    await fs.writeFile(part, new Uint8Array(8));
    fs.rename = async () => false;
    await expect(store.save(part, pending())).rejects.toThrow('无法保存安装包');
  });
});

describe('AppUpdateStore.load', () => {
  async function withMetadata(json: unknown, versionCode = 1): Promise<AppUpdateStore> {
    const { store, fs } = makeStore(versionCode);
    await fs.writeFile(META, new TextEncoder().encode(JSON.stringify(json)));
    return store;
  }

  function goodJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      tag: TAG,
      releaseUrl: `${UPDATE_REPOSITORY}/releases/tag/${TAG}`,
      notes: 'hello',
      name: ASSET_NAME,
      url: ASSET_URL,
      size: 4096,
      digest: SHA,
      versionCode: 3,
      sha256: SHA,
      ...overrides,
    };
  }

  it('round-trips a valid record', async () => {
    const store = await withMetadata(goodJson());
    const loaded = await store.load();
    expect(loaded?.release.tag).toBe(TAG);
    expect(loaded?.versionCode).toBe(3);
    expect(loaded?.sha256).toBe(SHA);
    expect(loaded?.release.notes).toBe('hello');
    expect(loaded?.release.apk?.size).toBe(4096);
  });

  it('truncates the notes at 24000 characters', async () => {
    const store = await withMetadata(goodJson({ notes: 'x'.repeat(25_000) }));
    expect((await store.load())?.release.notes).toHaveLength(24_000);
  });

  it('returns null when the file is missing or not JSON', async () => {
    const { store } = makeStore(1);
    expect(await store.load()).toBeNull();
    const { store: store2, fs } = makeStore(1);
    await fs.writeFile(META, new TextEncoder().encode('not json'));
    expect(await store2.load()).toBeNull();
  });

  it('returns null when the metadata exceeds the 192 KiB read ceiling', async () => {
    const { store, fs } = makeStore(1);
    await fs.writeFile(META, new Uint8Array(192 * 1024 + 1));
    expect(await store.load()).toBeNull();
    expect(await store.load()).toBeNull();
    expect(fs.files.has(META)).toBe(true);
  });

  it('rejects a releaseUrl that is not the canonical tag URL', async () => {
    expect(await (await withMetadata(goodJson({ releaseUrl: 'https://evil/x' }))).load()).toBeNull();
  });

  it('rejects an uppercase or malformed sha256', async () => {
    expect(await (await withMetadata(goodJson({ sha256: 'A'.repeat(64) }))).load()).toBeNull();
    expect(await (await withMetadata(goodJson({ sha256: 'a'.repeat(63) }))).load()).toBeNull();
    expect(await (await withMetadata(goodJson({ digest: 'A'.repeat(64) }))).load()).toBeNull();
  });

  it('rejects a size outside 1..MAX_UPDATE_BYTES and accepts explicit nulls', async () => {
    expect(await (await withMetadata(goodJson({ size: 0 }))).load()).toBeNull();
    expect(await (await withMetadata(goodJson({ size: MAX_UPDATE_BYTES + 1 }))).load()).toBeNull();
    expect(await (await withMetadata(goodJson({ size: MAX_UPDATE_BYTES }))).load()).not.toBeNull();
    const nullable = await (await withMetadata(goodJson({ size: null, digest: null }))).load();
    expect(nullable?.release.apk?.size).toBeNull();
    expect(nullable?.release.apk?.sha256).toBeNull();
  });

  it('rejects a non-positive versionCode', async () => {
    expect(await (await withMetadata(goodJson({ versionCode: 0 }))).load()).toBeNull();
    expect(await (await withMetadata(goodJson({ versionCode: -1 }))).load()).toBeNull();
  });

  it('rejects a non-official asset', async () => {
    expect(await (await withMetadata(goodJson({ url: 'https://evil.example/x.apk' }))).load()).toBeNull();
    expect(await (await withMetadata(goodJson({ name: 'evil.apk' }))).load()).toBeNull();
    expect(await (await withMetadata(goodJson({ tag: 'nightly' }))).load()).toBeNull();
  });

  it('rejects a missing required field', async () => {
    for (const key of ['tag', 'name', 'url', 'releaseUrl', 'versionCode', 'sha256']) {
      const bad = goodJson();
      delete bad[key];
      expect(await (await withMetadata(bad)).load()).toBeNull();
    }
  });
});

describe('AppUpdateStore retention / cleanup policy', () => {
  it('clearPartialFiles deletes only .part files inside app_updates', async () => {
    const { store, fs } = makeStore(1);
    await fs.writeFile(`${DIRECTORY}/a.part`, new Uint8Array(1));
    await fs.writeFile(`${DIRECTORY}/b.part`, new Uint8Array(1));
    await fs.writeFile(`${DIRECTORY}/keep.apk`, new Uint8Array(1));
    await fs.writeFile(`${DIRECTORY}/pending.json`, new Uint8Array(1));
    await fs.writeFile('downloads/book.part', new Uint8Array(1));
    await store.clearPartialFiles();
    expect(await fs.exists(`${DIRECTORY}/a.part`)).toBe(false);
    expect(await fs.exists(`${DIRECTORY}/b.part`)).toBe(false);
    expect(await fs.exists(`${DIRECTORY}/keep.apk`)).toBe(true);
    expect(await fs.exists(`${DIRECTORY}/pending.json`)).toBe(true);
    // A user's own export outside the private directory is never touched.
    expect(await fs.exists('downloads/book.part')).toBe(true);
  });

  it('clear removes the package, the metadata and every .part file', async () => {
    const { store, fs } = makeStore(1);
    const part = await store.newTransferFile();
    await fs.writeFile(part, new Uint8Array(64));
    await store.save(part, pending());
    await fs.writeFile(`${DIRECTORY}/stale.part`, new Uint8Array(1));
    await store.clear();
    expect(await fs.exists(APK)).toBe(false);
    expect(await fs.exists(META)).toBe(false);
    expect(await fs.exists(`${DIRECTORY}/stale.part`)).toBe(false);
    expect(await store.load()).toBeNull();
  });

  it('cleanupInstalled keeps the package while the installed code is lower', async () => {
    const { store, fs } = makeStore(2);
    const part = await store.newTransferFile();
    await fs.writeFile(part, new Uint8Array(64));
    await store.save(part, pending());
    expect(await store.cleanupInstalled()).toBe(false);
    expect(await fs.exists(APK)).toBe(true);
    expect(await store.load()).not.toBeNull();
  });

  it('cleanupInstalled wipes everything once the target version is installed', async () => {
    const { store, fs } = makeStore(3);
    const part = await store.newTransferFile();
    await fs.writeFile(part, new Uint8Array(64));
    await store.save(part, pending());
    expect(await store.cleanupInstalled()).toBe(true);
    expect(await fs.exists(APK)).toBe(false);
    expect(await fs.exists(META)).toBe(false);
    // Idempotent: a second pass has nothing to clean.
    expect(await store.cleanupInstalled()).toBe(false);
  });

  it('cleanupInstalled is a no-op with nothing saved', async () => {
    const { store } = makeStore(99);
    expect(await store.cleanupInstalled()).toBe(false);
  });

  it('installedCode reports the injected package identity', async () => {
    const { store } = makeStore(42);
    expect(await store.installedCode()).toBe(42);
  });
});

describe('AtomicMetadataFile', () => {
  it('restores the previous good copy after a failed write', async () => {
    const fs = new MemoryUpdateStore();
    await fs.mkdirs(DIRECTORY);
    const meta = new AtomicMetadataFile(fs, META);
    await meta.startWrite();
    await fs.writeFile(META, new TextEncoder().encode('first'));
    await meta.finishWrite();
    await meta.startWrite();
    expect(await fs.exists(`${META}.bak`)).toBe(true);
    await meta.failWrite();
    expect(await fs.exists(`${META}.bak`)).toBe(false);
    expect(new TextDecoder().decode(await meta.openRead())).toBe('first');
  });

  it('heals a missing base file from the rollback copy on read', async () => {
    const fs = new MemoryUpdateStore();
    await fs.mkdirs(DIRECTORY);
    const meta = new AtomicMetadataFile(fs, META);
    await meta.startWrite();
    await fs.writeFile(META, new TextEncoder().encode('first'));
    await meta.startWrite();
    await fs.delete(META);
    expect(new TextDecoder().decode(await meta.openRead())).toBe('first');
  });

  it('delete removes both the base file and the rollback copy', async () => {
    const fs = new MemoryUpdateStore();
    await fs.mkdirs(DIRECTORY);
    const meta = new AtomicMetadataFile(fs, META);
    await meta.startWrite();
    await fs.writeFile(META, new TextEncoder().encode('first'));
    await meta.startWrite();
    expect(await fs.exists(`${META}.bak`)).toBe(true);
    await meta.delete();
    expect(await fs.exists(META)).toBe(false);
    expect(await fs.exists(`${META}.bak`)).toBe(false);
  });
});
