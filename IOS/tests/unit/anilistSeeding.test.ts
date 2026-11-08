import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'fflate';
import { openAppDatabase } from '@core/db/openDatabase';
import {
  ANILIST_SEED_FMT_KEY,
  ANILIST_SEED_FMT_VERSION,
  ANILIST_SEED_ROWS_KEY,
  anilistSeedFingerprintMatches,
  ensureAniListSeedFormat,
  parseAniListTsvGzip,
  readAniListSeedFingerprint,
  seedAniListTitles,
  writeAniListSeedFingerprint,
} from '@core/data/anilistSeeding';
import type { SQLiteDatabase, SqlValue } from '@platform/interfaces';
import { InMemorySqliteDatabase } from '@platform/web-mock/inMemoryDb';
import { MemorySecureStore } from '@platform/web-mock/memorySecureStore';

class OrIgnoreSqliteDatabase implements SQLiteDatabase {
  constructor(private readonly inner: InMemorySqliteDatabase) {}

  open(options: { name: string }): Promise<void> {
    return this.inner.open(options);
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  async execute(sql: string, params?: SqlValue[]): Promise<{ rowsAffected: number; lastInsertRowId?: number }> {
    if (/^INSERT\s+OR\s+IGNORE/i.test(sql.trim())) {
      try {
        return await this.inner.execute(sql.replace(/^INSERT\s+OR\s+IGNORE/i, 'INSERT'), params);
      } catch (err) {
        if (String(err).includes('UNIQUE')) {
          return { rowsAffected: 0 };
        }
        throw err;
      }
    }
    return this.inner.execute(sql, params);
  }

  query<T>(sql: string, params?: SqlValue[]): Promise<T[]> {
    return this.inner.query<T>(sql, params);
  }
}

function gzipText(text: string): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(text, 'utf8')));
}

async function openSeedingDb(): Promise<SQLiteDatabase> {
  const inner = new InMemorySqliteDatabase();
  await openAppDatabase({ db: inner });
  return new OrIgnoreSqliteDatabase(inner);
}

const SAMPLE_TSV = [
  '30001\tENGLISH\tMonster',
  '30001\tNATIVE\tMONSTER',
  '30001\tROMAJI\tMonster',
  '30002\tSYNONYM\t無職転生',
  '30002\tENGLISH\tMushoku Tensei',
  '',
  'not-a-number\tENGLISH\tBad',
  '30003\tENGLISH',
  '30004\tENGLISH\t',
  '30005\tKITSU_ALIAS\tAlias Title',
].join('\n');

describe('anilistSeeding', () => {
  it('parses gzip TSV rows and computes normalized/compact titles', () => {
    const rows = parseAniListTsvGzip(gzipText(SAMPLE_TSV));
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({
      mediaId: 30001,
      titleType: 'ENGLISH',
      rawTitle: 'Monster',
      normalizedTitle: 'monster',
      compactTitle: 'monster',
    });
    expect(rows[3]).toEqual({
      mediaId: 30002,
      titleType: 'SYNONYM',
      rawTitle: '無職転生',
      normalizedTitle: '无职转生',
      compactTitle: '无职转生',
    });
    expect(rows[4]).toEqual({
      mediaId: 30002,
      titleType: 'ENGLISH',
      rawTitle: 'Mushoku Tensei',
      normalizedTitle: 'mushoku tensei',
      compactTitle: 'mushokutensei',
    });
    expect(rows[5]).toEqual({
      mediaId: 30005,
      titleType: 'KITSU_ALIAS',
      rawTitle: 'Alias Title',
      normalizedTitle: 'alias title',
      compactTitle: 'aliastitle',
    });
  });

  it('skips malformed lines, blank lines, and empty titles', () => {
    const rows = parseAniListTsvGzip(gzipText(SAMPLE_TSV));
    const mediaIds = rows.map((r) => r.mediaId);
    expect(mediaIds).not.toContain(Number.NaN);
    expect(rows.some((r) => r.rawTitle === '')).toBe(false);
    expect(rows.some((r) => r.titleType === 'ENGLISH' && r.mediaId === 30003)).toBe(false);
  });

  it('seeds anilist_titles with normalized columns and INSERT OR IGNORE semantics', async () => {
    const db = await openSeedingDb();
    const result = await seedAniListTitles(db, gzipText(SAMPLE_TSV));
    expect(result.parsed).toBe(6);
    expect(result.inserted).toBe(6);

    const allRows = await db.query<{
      mediaId: number;
      titleType: string;
      normalizedTitle: string;
      compactTitle: string;
    }>('SELECT * FROM "anilist_titles"');
    expect(allRows).toHaveLength(6);

    const monster = allRows.find((r) => r.mediaId === 30001 && r.titleType === 'ENGLISH');
    expect(monster?.normalizedTitle).toBe('monster');
    expect(monster?.compactTitle).toBe('monster');

    const traditional = allRows.find((r) => r.mediaId === 30002 && r.titleType === 'SYNONYM');
    expect(traditional?.normalizedTitle).toBe('无职转生');
  });

  it('is idempotent for duplicate (mediaId, titleType, rawTitle) keys', async () => {
    const db = await openSeedingDb();
    const payload = gzipText(SAMPLE_TSV);
    const first = await seedAniListTitles(db, payload);
    const second = await seedAniListTitles(db, payload);
    expect(first.inserted).toBe(6);
    expect(second.inserted).toBe(0);
    expect(second.parsed).toBe(6);

    const countRows = await db.query<{ count: number }>('SELECT COUNT(*) FROM "anilist_titles"');
    expect(countRows[0]?.count).toBe(6);
  });

  it('decompresses and parses the bundled public/anilist asset', () => {
    const assetPath = resolve(process.cwd(), 'public/anilist/anilist_titles.tsv.gzip');
    const compressed = new Uint8Array(readFileSync(assetPath));
    expect(compressed.length).toBeGreaterThan(0);

    const decompressed = new TextDecoder('utf-8').decode(gunzipSync(compressed));
    const lines = decompressed.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThan(90_000);

    const rows = parseAniListTsvGzip(compressed);
    expect(rows.length).toBe(lines.length);

    const first = rows[0];
    expect(first?.mediaId).toBe(30001);
    expect(first?.titleType).toBe('ENGLISH');
    expect(first?.rawTitle).toBe('Monster');
    expect(first?.normalizedTitle).toBe('monster');

    const hasKitsuAlias = rows.some((r) => r.titleType === 'KITSU_ALIAS');
    expect(hasKitsuAlias).toBe(true);

    const hasTraditionalFold = rows.some((r) => r.rawTitle.includes('無職') && r.normalizedTitle.includes('无职'));
    expect(hasTraditionalFold).toBe(true);
  });
});

describe('anilistSeeding fingerprint', () => {
  it('defaults to rows=-1 and fmt=1 when unset', async () => {
    const store = new MemorySecureStore();
    expect(await readAniListSeedFingerprint(store)).toEqual({ rows: -1, fmt: 1 });
  });

  it('round-trips fingerprint values through the secure store', async () => {
    const store = new MemorySecureStore();
    await writeAniListSeedFingerprint(store, { rows: 94252, fmt: ANILIST_SEED_FMT_VERSION });
    expect(await readAniListSeedFingerprint(store)).toEqual({ rows: 94252, fmt: ANILIST_SEED_FMT_VERSION });
    expect(await store.get(ANILIST_SEED_ROWS_KEY)).toBe('94252');
    expect(await store.get(ANILIST_SEED_FMT_KEY)).toBe(String(ANILIST_SEED_FMT_VERSION));
  });

  it('falls back to defaults for malformed stored values', async () => {
    const store = new MemorySecureStore();
    await store.set(ANILIST_SEED_ROWS_KEY, 'not-a-number');
    await store.set(ANILIST_SEED_FMT_KEY, '');
    expect(await readAniListSeedFingerprint(store)).toEqual({ rows: -1, fmt: 1 });
  });

  it('matches only when currentRows > 0 and equals the stored fingerprint', async () => {
    const store = new MemorySecureStore();
    expect(await anilistSeedFingerprintMatches(store, 6)).toBe(false);
    await writeAniListSeedFingerprint(store, { rows: 6, fmt: ANILIST_SEED_FMT_VERSION });
    expect(await anilistSeedFingerprintMatches(store, 6)).toBe(true);
    expect(await anilistSeedFingerprintMatches(store, 7)).toBe(false);
    expect(await anilistSeedFingerprintMatches(store, 0)).toBe(false);
  });

  it('clears anilist_titles and resets the fingerprint when fmt is stale', async () => {
    const db = await openSeedingDb();
    const store = new MemorySecureStore();
    await writeAniListSeedFingerprint(store, { rows: 5, fmt: 1 });
    const payload = gzipText(SAMPLE_TSV);
    await seedAniListTitles(db, payload);
    const before = await db.query<{ count: number }>('SELECT COUNT(*) FROM "anilist_titles"');
    expect(before[0]?.count).toBeGreaterThan(0);

    await ensureAniListSeedFormat(store, db);

    const after = await db.query<{ count: number }>('SELECT COUNT(*) FROM "anilist_titles"');
    expect(after[0]?.count).toBe(0);
    expect(await readAniListSeedFingerprint(store)).toEqual({ rows: -1, fmt: ANILIST_SEED_FMT_VERSION });
  });

  it('leaves data untouched when fmt is already current', async () => {
    const db = await openSeedingDb();
    const store = new MemorySecureStore();
    const payload = gzipText(SAMPLE_TSV);
    await seedAniListTitles(db, payload);
    await writeAniListSeedFingerprint(store, { rows: 6, fmt: ANILIST_SEED_FMT_VERSION });

    await ensureAniListSeedFormat(store, db);

    const after = await db.query<{ count: number }>('SELECT COUNT(*) FROM "anilist_titles"');
    expect(after[0]?.count).toBe(6);
    expect(await readAniListSeedFingerprint(store)).toEqual({ rows: 6, fmt: ANILIST_SEED_FMT_VERSION });
  });
});
