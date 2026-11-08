/**
 * `source/storage/SharedPreferencesSourceStorage.kt` (86 lines, 74 non-blank)
 * → `src/core/source/storage/sharedPreferencesSourceStorage.ts`, and
 * `source/storage/SourceStorage.kt` (12 lines, 10 non-blank)
 * → `src/core/source/storage/sourceStorage.ts`.
 *
 * Focus: round-trips for all seven port members, the legacy `custom_source_json_*` migration,
 * the 2 MiB guard (including UTF-8 vs UTF-16 length), the `check(commit())` failure path, and
 * the SHA-256 / AtomicFile plumbing that `configFile(id)` depends on.
 */

import { describe, expect, it } from 'vitest';

import {
  ACTIVE_SOURCE_ID_KEY,
  ATOMIC_WRITE_SUFFIX,
  CONFIG_DIRECTORY,
  CONFIG_FILE_EXTENSION,
  CONFIG_TOO_LARGE_MESSAGE,
  CUSTOM_SOURCE_IDS_KEY,
  CUSTOM_SOURCE_JSON_PREFIX,
  MAX_CONFIG_BYTES,
  PREFS_NAME,
  SOURCE_ENABLED_PREFIX,
} from '../../src/core/source/storage/sourceStorage';
import type { SourceStorage } from '../../src/core/source/storage/sourceStorage';
import {
  SharedPreferencesSourceStorage,
  sha256Hex,
  utf8ByteLength,
  utf8Bytes,
} from '../../src/core/source/storage/sharedPreferencesSourceStorage';
import type {
  SourceConfigFilePort,
  SourcePrefsPort,
  SourcePrefsValue,
} from '../../src/core/source/storage/sourceStorage';

// ── In-memory ports ─────────────────────────────────────────────────────────

/** A `SharedPreferences` stand-in that keeps the batched `edit()` / `commit()` semantics. */
class FakePrefs implements SourcePrefsPort {
  readonly store = new Map<string, SourcePrefsValue>();
  private readonly pending = new Map<string, SourcePrefsValue | null>();
  /** Flip to make `commit()` report failure, i.e. Kotlin's `commit() == false`. */
  commitResult = true;
  commits = 0;

  all(): Readonly<Record<string, SourcePrefsValue>> {
    return Object.fromEntries(this.store.entries());
  }

  async getString(key: string, fallback: string | null): Promise<string | null> {
    const value = this.store.get(key);
    return typeof value === 'string' ? value : fallback;
  }

  async getStringSet(key: string): Promise<ReadonlySet<string>> {
    const value = this.store.get(key);
    return value instanceof Set ? new Set(value) : new Set<string>();
  }

  async putBoolean(key: string, value: boolean): Promise<void> {
    this.pending.set(key, value);
  }

  async putString(key: string, value: string): Promise<void> {
    this.pending.set(key, value);
  }

  async putStringSet(key: string, values: ReadonlySet<string>): Promise<void> {
    this.pending.set(key, new Set(values));
  }

  remove(key: string): void {
    this.pending.set(key, null);
  }

  async commit(): Promise<boolean> {
    this.commits += 1;
    if (!this.commitResult) return false;
    for (const [key, value] of this.pending.entries()) {
      if (value === null) this.store.delete(key);
      else this.store.set(key, value);
    }
    this.pending.clear();
    return true;
  }
}

class FakeFiles implements SourceConfigFilePort {
  readonly blobs = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly log: string[] = [];
  failRename = false;

  filesDir(): string {
    return '/data/files';
  }

  mkdirs(path: string): void {
    this.dirs.add(path);
  }

  exists(path: string): boolean {
    return this.blobs.has(path);
  }

  writeText(path: string, content: string): void {
    this.blobs.set(path, content);
    this.log.push(`write ${path}`);
  }

  readText(path: string): string | null {
    return this.blobs.get(path) ?? null;
  }

  length(path: string): number {
    // Kotlin `f.length()` counts BYTES; the tests store ASCII except where noted.
    return utf8ByteLength(this.blobs.get(path) ?? '');
  }

  delete(path: string): void {
    this.blobs.delete(path);
    this.log.push(`delete ${path}`);
  }

  rename(from: string, to: string): void {
    if (this.failRename) throw new Error('rename failed');
    const content = this.blobs.get(from);
    if (content !== undefined) {
      this.blobs.set(to, content);
      this.blobs.delete(from);
    }
    this.log.push(`rename ${from} -> ${to}`);
  }
}

function makeStorage(): {
  storage: SharedPreferencesSourceStorage;
  prefs: FakePrefs;
  files: FakeFiles;
} {
  const prefs = new FakePrefs();
  const files = new FakeFiles();
  const storage = new SharedPreferencesSourceStorage({ prefs, files });
  return { storage, prefs, files };
}

// ── sourceStorage.ts — the port shape ───────────────────────────────────────

describe('SourceStorage port', () => {
  it('exposes exactly the seven Kotlin members, and SharedPreferencesSourceStorage satisfies it', () => {
    const { storage } = makeStorage();
    const port: SourceStorage = storage;
    for (const member of [
      'saveSourceState',
      'getSourceStates',
      'saveActiveSourceId',
      'getActiveSourceId',
      'saveCustomSourceJson',
      'getCustomSourceJsons',
      'removeCustomSourceJson',
    ]) {
      expect(typeof (port as unknown as Record<string, unknown>)[member]).toBe('function');
    }
  });

  it('preserves every key literal from the Kotlin source', () => {
    expect(PREFS_NAME).toBe('book_sources_config');
    expect(CONFIG_DIRECTORY).toBe('source_configs');
    expect(SOURCE_ENABLED_PREFIX).toBe('source_enabled_');
    expect(ACTIVE_SOURCE_ID_KEY).toBe('active_source_id');
    expect(CUSTOM_SOURCE_IDS_KEY).toBe('custom_source_ids');
    expect(CUSTOM_SOURCE_JSON_PREFIX).toBe('custom_source_json_');
    expect(MAX_CONFIG_BYTES).toBe(2 * 1024 * 1024);
    expect(CONFIG_TOO_LARGE_MESSAGE).toBe('书源配置超过 2MiB');
    expect(CONFIG_FILE_EXTENSION).toBe('.json');
    expect(ATOMIC_WRITE_SUFFIX).toBe('.bak');
  });
});

// ── L8 — the config directory ───────────────────────────────────────────────

describe('constructor — Kotlin L8-L9', () => {
  it('creates source_configs under filesDir', () => {
    const { storage, files } = makeStorage();
    expect(storage.configDirectory).toBe('/data/files/source_configs');
    expect(files.dirs.has('/data/files/source_configs')).toBe(true);
  });
});

// ── L11-L34 — enabled flags + the active id ────────────────────────────────

describe('source states — Kotlin L11-L34', () => {
  it('round-trips a single enabled flag', async () => {
    const { storage, prefs } = makeStorage();
    await storage.saveSourceState('netease', false);
    expect(prefs.store.get('source_enabled_netease')).toBe(false);
    expect(await storage.getSourceStates()).toEqual({ netease: false });
  });

  it('round-trips many flags, in both directions', async () => {
    const { storage } = makeStorage();
    await storage.saveSourceState('a', true);
    await storage.saveSourceState('b', false);
    await storage.saveSourceState('c', true);
    expect(await storage.getSourceStates()).toEqual({ a: true, b: false, c: true });
  });

  it('ignores keys with the wrong prefix', async () => {
    const { storage, prefs } = makeStorage();
    prefs.store.set('enabled_netease', true);
    prefs.store.set('source_enabled_', true); // empty id is still a match on Android
    expect(await storage.getSourceStates()).toEqual({ '': true });
  });

  it('ignores non-boolean values under the prefix (Kotlin `value is Boolean`)', async () => {
    const { storage, prefs } = makeStorage();
    // The string "false" must NOT be read as the boolean false.
    prefs.store.set('source_enabled_gotcha', 'false');
    prefs.store.set('source_enabled_real', false);
    expect(await storage.getSourceStates()).toEqual({ real: false });
  });

  it('round-trips the active source id, and null when never set', async () => {
    const { storage, prefs } = makeStorage();
    expect(await storage.getActiveSourceId()).toBeNull();
    await storage.saveActiveSourceId('my_source');
    expect(prefs.store.get(ACTIVE_SOURCE_ID_KEY)).toBe('my_source');
    expect(await storage.getActiveSourceId()).toBe('my_source');
  });

  it('overwrites the active source id rather than appending', async () => {
    const { storage } = makeStorage();
    await storage.saveActiveSourceId('first');
    await storage.saveActiveSourceId('second');
    expect(await storage.getActiveSourceId()).toBe('second');
  });
});

// ── L36-L39 — configFile: SHA-256 of the UTF-8 id ───────────────────────────

describe('configFilePath() — Kotlin L36-L39', () => {
  it('matches NIST SHA-256 vectors', () => {
    expect(sha256Hex(utf8Bytes(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(utf8Bytes('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(utf8Bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes across the 55/56/64-byte block boundaries', () => {
    const million = 'a'.repeat(1_000_000);
    expect(sha256Hex(utf8Bytes(million))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('agrees with node:crypto for arbitrary ids', async () => {
    const { createHash } = await import('node:crypto');
    for (const id of ['netease', '书源·中文·id', 'emoji😀id', 'a'.repeat(200)]) {
      const expected = createHash('sha256').update(id, 'utf8').digest('hex');
      expect(sha256Hex(utf8Bytes(id))).toBe(expected);
    }
  });

  it('names the file <sha256>.json inside source_configs', () => {
    const { storage } = makeStorage();
    const path = storage.configFilePath('abc');
    expect(path).toBe(`/data/files/source_configs/${sha256Hex(utf8Bytes('abc'))}.json`);
    expect(path.endsWith('.json')).toBe(true);
  });

  it('is injective for distinct ids and stable across calls', () => {
    const { storage } = makeStorage();
    expect(storage.configFilePath('x')).toBe(storage.configFilePath('x'));
    expect(storage.configFilePath('x')).not.toBe(storage.configFilePath('y'));
  });

  it('honours an injected digest implementation', () => {
    const storage = new SharedPreferencesSourceStorage({
      prefs: new FakePrefs(),
      files: new FakeFiles(),
      sha256Hex: () => 'deadbeef',
    });
    expect(storage.configFilePath('anything')).toBe('/data/files/source_configs/deadbeef.json');
  });
});

// ── L41-L51 — saveCustomSourceJson ─────────────────────────────────────────

describe('saveCustomSourceJson() — Kotlin L41-L51', () => {
  it('round-trips a body through the AtomicFile staging file', async () => {
    const { storage, files } = makeStorage();
    await storage.saveCustomSourceJson('abc', '{"bookSourceName":"测试"}');
    const path = storage.configFilePath('abc');
    expect(files.readText(path)).toBe('{"bookSourceName":"测试"}');
    // startWrite → <name>.bak, finishWrite → rename onto <name>
    expect(files.log).toContain(`write ${path}${ATOMIC_WRITE_SUFFIX}`);
    expect(files.log).toContain(`rename ${path}${ATOMIC_WRITE_SUFFIX} -> ${path}`);
    expect(files.exists(`${path}${ATOMIC_WRITE_SUFFIX}`)).toBe(false);
  });

  it('records the id in the custom_source_ids set', async () => {
    const { storage, prefs } = makeStorage();
    await storage.saveCustomSourceJson('abc', '{}');
    expect(prefs.store.get(CUSTOM_SOURCE_IDS_KEY)).toEqual(new Set(['abc']));
    expect(await storage.getCustomSourceJsons()).toEqual({ abc: '{}' });
  });

  it('appends, never replaces', async () => {
    const { storage } = makeStorage();
    await storage.saveCustomSourceJson('a', '{"a":1}');
    await storage.saveCustomSourceJson('b', '{"b":2}');
    await storage.saveCustomSourceJson('c', '{"c":3}');
    expect(await storage.getCustomSourceJsons()).toEqual({
      a: '{"a":1}',
      b: '{"b":2}',
      c: '{"c":3}',
    });
  });

  it('overwrites an existing body for the same id', async () => {
    const { storage } = makeStorage();
    await storage.saveCustomSourceJson('a', '{"v":1}');
    await storage.saveCustomSourceJson('a', '{"v":2}');
    expect(await storage.getCustomSourceJsons()).toEqual({ a: '{"v":2}' });
  });

  it('clears the legacy inline key in the same commit (Kotlin L49)', async () => {
    const { storage, prefs } = makeStorage();
    prefs.store.set(`${CUSTOM_SOURCE_JSON_PREFIX}a`, '{"old":true}');
    await storage.saveCustomSourceJson('a', '{"new":true}');
    expect(prefs.store.has(`${CUSTOM_SOURCE_JSON_PREFIX}a`)).toBe(false);
  });

  it('serialises concurrent saves — the companion lock is process-wide', async () => {
    const { storage, files } = makeStorage();
    await Promise.all([
      storage.saveCustomSourceJson('a', '{"n":1}'),
      storage.saveCustomSourceJson('b', '{"n":2}'),
      storage.saveCustomSourceJson('c', '{"n":3}'),
      storage.saveCustomSourceJson('d', '{"n":4}'),
    ]);
    const loaded = await storage.getCustomSourceJsons();
    expect(Object.keys(loaded).sort()).toEqual(['a', 'b', 'c', 'd']);
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(files.readText(storage.configFilePath(id))).toBe(`{"n":${id.charCodeAt(0) - 96}}`);
    }
  });
});

// ── L43 / L60 — the 2 MiB guard ────────────────────────────────────────────

describe('the 2 MiB guard — Kotlin L43 / L60', () => {
  it('measures UTF-8 BYTES, not UTF-16 code units', () => {
    // A 3-byte CJK char: .length === 1 in JS but 3 UTF-8 bytes, exactly like Kotlin.
    expect('书'.length).toBe(1);
    expect(utf8ByteLength('书')).toBe(3);
    // A surrogate pair (emoji) is 2 JS units but 4 UTF-8 bytes.
    expect('😀'.length).toBe(2);
    expect(utf8ByteLength('😀')).toBe(4);
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('')).toBe(0);
  });

  it('accepts exactly 2 MiB (Kotlin checks `<=`)', async () => {
    const { storage } = makeStorage();
    const exact = 'a'.repeat(MAX_CONFIG_BYTES);
    expect(utf8ByteLength(exact)).toBe(MAX_CONFIG_BYTES);
    await expect(storage.saveCustomSourceJson('big', exact)).resolves.toBeUndefined();
  });

  it('rejects one byte over 2 MiB with the verbatim Chinese message', async () => {
    const { storage } = makeStorage();
    const tooBig = 'a'.repeat(MAX_CONFIG_BYTES + 1);
    await expect(storage.saveCustomSourceJson('big', tooBig)).rejects.toThrow('书源配置超过 2MiB');
  });

  it('rejects a body that fits in UTF-16 units but not in UTF-8 bytes', async () => {
    const { storage } = makeStorage();
    // Exactly MAX UTF-16 units … but each CJK char is 3 UTF-8 bytes, so 6 MiB on the wire.
    const cjk = '书'.repeat(MAX_CONFIG_BYTES);
    expect(cjk.length).toBe(MAX_CONFIG_BYTES);
    expect(utf8ByteLength(cjk)).toBe(3 * MAX_CONFIG_BYTES);
    await expect(storage.saveCustomSourceJson('big', cjk)).rejects.toThrow('书源配置超过 2MiB');
  });

  it('applies the same guard to the legacy inline value during migration (L60)', async () => {
    const { storage, prefs } = makeStorage();
    prefs.store.set(`${CUSTOM_SOURCE_JSON_PREFIX}legacy`, 'a'.repeat(MAX_CONFIG_BYTES + 1));
    await expect(storage.getCustomSourceJsons()).rejects.toThrow('书源配置超过 2MiB');
  });

  it('migrates a legacy inline value that is exactly at the limit', async () => {
    const { storage, prefs, files } = makeStorage();
    const exact = 'a'.repeat(MAX_CONFIG_BYTES);
    prefs.store.set(`${CUSTOM_SOURCE_JSON_PREFIX}legacy`, exact);
    expect(await storage.getCustomSourceJsons()).toEqual({ legacy: exact });
    expect(files.readText(storage.configFilePath('legacy'))).toBe(exact);
  });
});

// ── L47 / L64 — the failWrite path ─────────────────────────────────────────

describe('AtomicFile failure path — Kotlin L47 / L64', () => {
  it('deletes the staging file and rethrows, leaving the good file intact', async () => {
    const { storage, files } = makeStorage();
    await storage.saveCustomSourceJson('a', '{"good":true}');
    const path = storage.configFilePath('a');
    files.failRename = true;
    await expect(storage.saveCustomSourceJson('a', '{"bad":true}')).rejects.toThrow('rename failed');
    expect(files.exists(`${path}${ATOMIC_WRITE_SUFFIX}`)).toBe(false);
    expect(files.readText(path)).toBe('{"good":true}');
  });

  it('leaves the id set untouched when the write fails', async () => {
    const { storage, files, prefs } = makeStorage();
    await storage.saveCustomSourceJson('a', '{"v":1}');
    files.failRename = true;
    await expect(storage.saveCustomSourceJson('b', '{"v":2}')).rejects.toThrow('rename failed');
    expect(prefs.store.get(CUSTOM_SOURCE_IDS_KEY)).toEqual(new Set(['a']));
  });
});

// ── L53-L74 — getCustomSourceJsons + legacy migration ──────────────────────

describe('getCustomSourceJsons() — Kotlin L53-L74', () => {
  it('migrates a legacy inline value into a file and drops the key', async () => {
    const { storage, prefs, files } = makeStorage();
    prefs.store.set(`${CUSTOM_SOURCE_JSON_PREFIX}old`, '{"legacy":true}');
    const loaded = await storage.getCustomSourceJsons();
    expect(loaded).toEqual({ old: '{"legacy":true}' });
    expect(files.readText(storage.configFilePath('old'))).toBe('{"legacy":true}');
    expect(prefs.store.has(`${CUSTOM_SOURCE_JSON_PREFIX}old`)).toBe(false);
    expect(prefs.store.get(CUSTOM_SOURCE_IDS_KEY)).toEqual(new Set(['old']));
  });

  it('migrates many legacy values and keeps already-migrated ones', async () => {
    const { storage, prefs } = makeStorage();
    await storage.saveCustomSourceJson('new', '{"n":1}');
    prefs.store.set(`${CUSTOM_SOURCE_JSON_PREFIX}old1`, '{"o":1}');
    prefs.store.set(`${CUSTOM_SOURCE_JSON_PREFIX}old2`, '{"o":2}');
    const loaded = await storage.getCustomSourceJsons();
    expect(Object.keys(loaded).sort()).toEqual(['new', 'old1', 'old2']);
    expect(prefs.store.get(CUSTOM_SOURCE_IDS_KEY)).toEqual(new Set(['new', 'old1', 'old2']));
  });

  it('skips an id whose file has vanished (Kotlin `f.isFile` guard)', async () => {
    const { storage, files } = makeStorage();
    await storage.saveCustomSourceJson('a', '{"a":1}');
    await storage.saveCustomSourceJson('b', '{"b":2}');
    files.blobs.delete(storage.configFilePath('a'));
    expect(await storage.getCustomSourceJsons()).toEqual({ b: '{"b":2}' });
  });

  it('skips an id whose file is over the limit (Kotlin `f.length() <= 2 MiB`)', async () => {
    const { storage, files } = makeStorage();
    await storage.saveCustomSourceJson('a', '{"a":1}');
    await storage.saveCustomSourceJson('b', '{"b":2}');
    // Grow `a` past 2 MiB without going through the writer.
    files.blobs.set(storage.configFilePath('a'), 'a'.repeat(MAX_CONFIG_BYTES + 1));
    expect(await storage.getCustomSourceJsons()).toEqual({ b: '{"b":2}' });
  });

  it('ignores non-string values under the legacy prefix (Kotlin `value is String`)', async () => {
    const { storage, prefs } = makeStorage();
    prefs.store.set(`${CUSTOM_SOURCE_JSON_PREFIX}notAString`, true);
    expect(await storage.getCustomSourceJsons()).toEqual({});
  });

  it('returns an empty record on a fresh install', async () => {
    const { storage } = makeStorage();
    expect(await storage.getCustomSourceJsons()).toEqual({});
  });
});

// ── L76-L82 — removeCustomSourceJson ────────────────────────────────────────

describe('removeCustomSourceJson() — Kotlin L76-L82', () => {
  it('removes the id, both prefs keys and the file', async () => {
    const { storage, prefs, files } = makeStorage();
    await storage.saveSourceState('abc', true);
    await storage.saveCustomSourceJson('abc', '{"a":1}');
    prefs.store.set(`${CUSTOM_SOURCE_JSON_PREFIX}abc`, '{"a":1}');
    expect(files.exists(storage.configFilePath('abc'))).toBe(true);

    await storage.removeCustomSourceJson('abc');

    expect(await storage.getCustomSourceJsons()).toEqual({});
    expect(await storage.getSourceStates()).toEqual({});
    expect(prefs.store.get(CUSTOM_SOURCE_IDS_KEY)).toEqual(new Set<string>());
    expect(prefs.store.has(`${CUSTOM_SOURCE_JSON_PREFIX}abc`)).toBe(false);
    expect(files.exists(storage.configFilePath('abc'))).toBe(false);
  });

  it('is idempotent for an unknown id', async () => {
    const { storage } = makeStorage();
    await storage.saveCustomSourceJson('keep', '{"k":1}');
    await expect(storage.removeCustomSourceJson('nope')).resolves.toBeUndefined();
    expect(await storage.getCustomSourceJsons()).toEqual({ keep: '{"k":1}' });
  });

  it('does not disturb the other ids or the active source id', async () => {
    const { storage } = makeStorage();
    await storage.saveCustomSourceJson('a', '{"a":1}');
    await storage.saveCustomSourceJson('b', '{"b":2}');
    await storage.saveActiveSourceId('b');
    await storage.removeCustomSourceJson('a');
    expect(await storage.getCustomSourceJsons()).toEqual({ b: '{"b":2}' });
    expect(await storage.getActiveSourceId()).toBe('b');
  });
});

// ── L49 / L68 / L78 — check(commit()) ──────────────────────────────────────

describe('check(commit()) — Kotlin L49 / L68 / L78', () => {
  it('saveSourceState swallows a failed commit (Kotlin discards the boolean at L12)', async () => {
    const { storage, prefs } = makeStorage();
    prefs.commitResult = false;
    await expect(storage.saveSourceState('a', true)).resolves.toBeUndefined();
  });

  it('saveActiveSourceId also discards the result (L28)', async () => {
    const { storage, prefs } = makeStorage();
    prefs.commitResult = false;
    await expect(storage.saveActiveSourceId('a')).resolves.toBeUndefined();
  });

  it('saveCustomSourceJson throws on a failed commit', async () => {
    const { storage, prefs } = makeStorage();
    prefs.commitResult = false;
    await expect(storage.saveCustomSourceJson('a', '{}')).rejects.toThrow('Failed requirement.');
  });

  it('getCustomSourceJsons throws on a failed commit', async () => {
    const { storage, prefs } = makeStorage();
    prefs.commitResult = false;
    await expect(storage.getCustomSourceJsons()).rejects.toThrow('Failed requirement.');
  });

  it('removeCustomSourceJson throws on a failed commit, before deleting the file', async () => {
    const { storage, prefs, files } = makeStorage();
    await storage.saveCustomSourceJson('a', '{"a":1}');
    prefs.commitResult = false;
    await expect(storage.removeCustomSourceJson('a')).rejects.toThrow('Failed requirement.');
    expect(files.exists(storage.configFilePath('a'))).toBe(true);
  });
});

// ── Serialization edge cases ───────────────────────────────────────────────

describe('serialization round-trip edge cases', () => {
  it('preserves an empty body', async () => {
    const { storage } = makeStorage();
    await storage.saveCustomSourceJson('a', '');
    expect(await storage.getCustomSourceJsons()).toEqual({ a: '' });
  });

  it('preserves newlines, tabs, quotes and emoji exactly', async () => {
    const { storage } = makeStorage();
    const body = '{\n\t"name": "书😀源",\n\t"x": "a\\"b"\n}\n';
    await storage.saveCustomSourceJson('a', body);
    expect(await storage.getCustomSourceJsons()).toEqual({ a: body });
  });

  it('preserves lone surrogates (invalid UTF-16) byte-for-byte', async () => {
    const { storage } = makeStorage();
    const body = '{"lone":"\ud800"}';
    await storage.saveCustomSourceJson('a', body);
    expect(await storage.getCustomSourceJsons()).toEqual({ a: body });
  });

  it('handles ids with path separators and unicode', async () => {
    const { storage } = makeStorage();
    for (const id of ['../../etc/passwd', 'a/b', '书源😀', '']) {
      await storage.saveCustomSourceJson(id, `{"id":"${id}"}`);
    }
    const loaded = await storage.getCustomSourceJsons();
    expect(Object.keys(loaded)).toEqual(['../../etc/passwd', 'a/b', '书源😀', '']);
    // Every id still hashes into a flat filename inside source_configs — no traversal.
    for (const id of Object.keys(loaded)) {
      const path = storage.configFilePath(id);
      expect(path.startsWith('/data/files/source_configs/')).toBe(true);
      expect(path.slice('/data/files/source_configs/'.length)).toMatch(/^[0-9a-f]{64}\.json$/);
    }
  });

  it('survives a full save → load → remove → load cycle', async () => {
    const { storage } = makeStorage();
    await storage.saveSourceState('s1', true);
    await storage.saveSourceState('s2', false);
    await storage.saveActiveSourceId('s1');
    await storage.saveCustomSourceJson('s1', '{"n":1}');
    await storage.saveCustomSourceJson('s2', '{"n":2}');

    expect(await storage.getSourceStates()).toEqual({ s1: true, s2: false });
    expect(await storage.getActiveSourceId()).toBe('s1');
    expect(await storage.getCustomSourceJsons()).toEqual({ s1: '{"n":1}', s2: '{"n":2}' });

    await storage.removeCustomSourceJson('s1');
    expect(await storage.getCustomSourceJsons()).toEqual({ s2: '{"n":2}' });
    // Kotlin L79 also removes `source_enabled_s1` in the same commit, so the enabled flag
    // for the removed source is gone too — not just the JSON body.
    expect(await storage.getSourceStates()).toEqual({ s2: false });
    // `active_source_id` is untouched by removeCustomSourceJson.
    expect(await storage.getActiveSourceId()).toBe('s1');
  });
});
