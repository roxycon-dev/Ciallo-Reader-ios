import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { openAppDatabase } from '@core/db/openDatabase';
import {
  ANILIST_SEED_FMT_KEY,
  ANILIST_SEED_FMT_VERSION,
  ANILIST_SEED_ROWS_KEY,
  seedAniListTitles,
  writeAniListSeedFingerprint,
} from '@core/data/anilistSeeding';
import {
  ANILIST_BUNDLED_ASSET_URL,
  bootstrapAniListSeeding,
  createAniListAssetFetcher,
} from '@core/startup/bootstrapAnilist';
import type { HttpClient, SQLiteDatabase, SqlValue } from '@platform/interfaces';
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

async function openHarness(): Promise<{ db: SQLiteDatabase; secure: MemorySecureStore }> {
  const inner = new InMemorySqliteDatabase();
  await openAppDatabase({ db: inner });
  return { db: new OrIgnoreSqliteDatabase(inner), secure: new MemorySecureStore() };
}

const SAMPLE_TSV = [
  '30001\tENGLISH\tMonster',
  '30001\tNATIVE\tMONSTER',
  '30002\tSYNONYM\t無職転生',
  '30002\tENGLISH\tMushoku Tensei',
  '30005\tKITSU_ALIAS\tAlias Title',
].join('\n');

const SAMPLE_GZIP = gzipText(SAMPLE_TSV);

describe('bootstrapAnilist', () => {
  it('seeds an empty DB and stores the fingerprint', async () => {
    const { db, secure } = await openHarness();
    let fetchCount = 0;
    const result = await bootstrapAniListSeeding({
      db,
      secure,
      fetchAsset: async () => {
        fetchCount += 1;
        return SAMPLE_GZIP;
      },
    });
    expect(result.seeded).toBe(true);
    expect(result.rowCount).toBe(5);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(fetchCount).toBe(1);
    expect(await secure.get(ANILIST_SEED_ROWS_KEY)).toBe('5');
    expect(await secure.get(ANILIST_SEED_FMT_KEY)).toBe(String(ANILIST_SEED_FMT_VERSION));

    const rows = await db.query<{ count: number }>('SELECT COUNT(*) FROM "anilist_titles"');
    expect(rows[0]?.count).toBe(5);
  });

  it('is idempotent: second call skips via fingerprint', async () => {
    const { db, secure } = await openHarness();
    let fetchCount = 0;
    const fetchAsset = async () => {
      fetchCount += 1;
      return SAMPLE_GZIP;
    };
    const first = await bootstrapAniListSeeding({ db, secure, fetchAsset });
    const second = await bootstrapAniListSeeding({ db, secure, fetchAsset });
    expect(first.seeded).toBe(true);
    expect(first.rowCount).toBe(5);
    expect(second.seeded).toBe(false);
    expect(second.rowCount).toBe(5);
    expect(fetchCount).toBe(1);
  });

  it('skips when rows already exist and fingerprint matches', async () => {
    const { db, secure } = await openHarness();
    await seedAniListTitles(db, SAMPLE_GZIP);
    await writeAniListSeedFingerprint(secure, { rows: 5, fmt: ANILIST_SEED_FMT_VERSION });
    let fetchCount = 0;
    const result = await bootstrapAniListSeeding({
      db,
      secure,
      fetchAsset: async () => {
        fetchCount += 1;
        return SAMPLE_GZIP;
      },
    });
    expect(result.seeded).toBe(false);
    expect(result.rowCount).toBe(5);
    expect(fetchCount).toBe(0);
  });

  it('re-imports when rows exist but fingerprint is missing', async () => {
    const { db, secure } = await openHarness();
    await seedAniListTitles(db, SAMPLE_GZIP);
    let fetchCount = 0;
    const result = await bootstrapAniListSeeding({
      db,
      secure,
      fetchAsset: async () => {
        fetchCount += 1;
        return SAMPLE_GZIP;
      },
    });
    expect(result.seeded).toBe(true);
    expect(result.rowCount).toBe(5);
    expect(fetchCount).toBe(1);
    expect(await secure.get(ANILIST_SEED_ROWS_KEY)).toBe('5');
  });

  it('clears and reseeds when format version is stale', async () => {
    const { db, secure } = await openHarness();
    await seedAniListTitles(db, SAMPLE_GZIP);
    await writeAniListSeedFingerprint(secure, { rows: 5, fmt: 1 });
    const result = await bootstrapAniListSeeding({
      db,
      secure,
      fetchAsset: async () => SAMPLE_GZIP,
    });
    expect(result.seeded).toBe(true);
    expect(result.rowCount).toBe(5);
    expect(await secure.get(ANILIST_SEED_FMT_KEY)).toBe(String(ANILIST_SEED_FMT_VERSION));
    expect(await secure.get(ANILIST_SEED_ROWS_KEY)).toBe('5');
  });

  it('returns seeded=false when the asset fetch fails', async () => {
    const { db, secure } = await openHarness();
    const result = await bootstrapAniListSeeding({
      db,
      secure,
      fetchAsset: async () => {
        throw new Error('network down');
      },
    });
    expect(result.seeded).toBe(false);
    expect(result.rowCount).toBe(0);
    const rows = await db.query<{ count: number }>('SELECT COUNT(*) FROM "anilist_titles"');
    expect(rows[0]?.count).toBe(0);
  });

  it('createAniListAssetFetcher requests the bundled asset URL', async () => {
    const requested: string[] = [];
    const http: HttpClient = {
      request: async (req) => {
        requested.push(req.url);
        return { status: 200, headers: {}, body: SAMPLE_GZIP, url: req.url };
      },
    };
    const fetchAsset = createAniListAssetFetcher(http);
    const bytes = await fetchAsset();
    expect(bytes).toBe(SAMPLE_GZIP);
    expect(requested).toEqual([ANILIST_BUNDLED_ASSET_URL]);
  });

  it('createAniListAssetFetcher throws on non-200 or empty body', async () => {
    const notFound: HttpClient = {
      request: async (req) => ({ status: 404, headers: {}, body: new Uint8Array(0), url: req.url }),
    };
    await expect(createAniListAssetFetcher(notFound)()).rejects.toThrow();

    const emptyBody: HttpClient = {
      request: async (req) => ({ status: 200, headers: {}, body: new Uint8Array(0), url: req.url }),
    };
    await expect(createAniListAssetFetcher(emptyBody)()).rejects.toThrow();
  });
});
