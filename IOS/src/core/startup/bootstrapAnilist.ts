import type { HttpClient, SQLiteDatabase, SecureStore } from '@platform/interfaces';
import {
  ANILIST_SEED_FMT_VERSION,
  anilistSeedFingerprintMatches,
  ensureAniListSeedFormat,
  seedAniListTitles,
  writeAniListSeedFingerprint,
} from '@core/data/anilistSeeding';

export const ANILIST_BUNDLED_ASSET_URL = '/anilist/anilist_titles.tsv.gzip';

export interface BootstrapAniListOptions {
  db: SQLiteDatabase;
  secure: SecureStore;
  fetchAsset: () => Promise<Uint8Array>;
}

export interface BootstrapAniListResult {
  seeded: boolean;
  rowCount: number;
  durationMs: number;
}

export function createAniListAssetFetcher(http: HttpClient): () => Promise<Uint8Array> {
  return async () => {
    const res = await http.request({ url: ANILIST_BUNDLED_ASSET_URL, method: 'GET' });
    if (res.status !== 200 || res.body.length === 0) {
      throw new Error(`failed to fetch anilist bundled asset: status ${res.status}`);
    }
    return res.body;
  };
}

async function countAniListTitles(db: SQLiteDatabase): Promise<number> {
  try {
    const rows = await db.query<{ count: number }>('SELECT COUNT(*) FROM "anilist_titles"');
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

export async function bootstrapAniListSeeding(
  options: BootstrapAniListOptions,
): Promise<BootstrapAniListResult> {
  const startedAt = Date.now();
  const { db, secure, fetchAsset } = options;

  await ensureAniListSeedFormat(secure, db);

  const current = await countAniListTitles(db);
  if (current > 0 && (await anilistSeedFingerprintMatches(secure, current))) {
    return { seeded: false, rowCount: current, durationMs: Date.now() - startedAt };
  }

  try {
    const gzipBytes = await fetchAsset();
    await seedAniListTitles(db, gzipBytes);
  } catch {
    return { seeded: false, rowCount: current, durationMs: Date.now() - startedAt };
  }

  const after = await countAniListTitles(db);
  await writeAniListSeedFingerprint(secure, { rows: after, fmt: ANILIST_SEED_FMT_VERSION });
  return { seeded: true, rowCount: after, durationMs: Date.now() - startedAt };
}
