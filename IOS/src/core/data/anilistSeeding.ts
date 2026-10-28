import { gunzipSync } from 'fflate';
import type { SQLiteDatabase, SecureStore } from '@platform/interfaces';
import { compact, normalize } from './titleNormalizer';
import { contentMutationGate } from '@core/library/contentMutationGate';

export interface AniListTitleRow {
  mediaId: number;
  titleType: string;
  rawTitle: string;
  normalizedTitle: string;
  compactTitle: string;
}

export interface SeedAniListResult {
  parsed: number;
  inserted: number;
}

export interface AniListSeedFingerprint {
  rows: number;
  fmt: number;
}

export const ANILIST_SEED_FMT_VERSION = 2;
export const ANILIST_SEED_ROWS_KEY = 'anilist_bundled:bundled_anilist_rows';
export const ANILIST_SEED_FMT_KEY = 'anilist_bundled:bundled_anilist_fmt';

const DEFAULT_SEED_ROWS = -1;
const DEFAULT_SEED_FMT = 1;

function parseStoredInt(raw: string | null, fallback: number): number {
  if (raw === null || !/^-?\d+$/.test(raw)) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : fallback;
}

export async function readAniListSeedFingerprint(store: SecureStore): Promise<AniListSeedFingerprint> {
  const rows = parseStoredInt(await store.get(ANILIST_SEED_ROWS_KEY), DEFAULT_SEED_ROWS);
  const fmt = parseStoredInt(await store.get(ANILIST_SEED_FMT_KEY), DEFAULT_SEED_FMT);
  return { rows, fmt };
}

export async function writeAniListSeedFingerprint(
  store: SecureStore,
  fingerprint: AniListSeedFingerprint,
): Promise<void> {
  await store.set(ANILIST_SEED_ROWS_KEY, String(fingerprint.rows));
  await store.set(ANILIST_SEED_FMT_KEY, String(fingerprint.fmt));
}

export async function anilistSeedFingerprintMatches(
  store: SecureStore,
  currentRows: number,
): Promise<boolean> {
  const fingerprint = await readAniListSeedFingerprint(store);
  return currentRows > 0 && fingerprint.rows === currentRows;
}

export async function ensureAniListSeedFormat(store: SecureStore, db: SQLiteDatabase): Promise<void> {
  const fingerprint = await readAniListSeedFingerprint(store);
  if (fingerprint.fmt >= ANILIST_SEED_FMT_VERSION) {
    return;
  }
  await db.execute('DELETE FROM "anilist_titles"').catch(() => undefined);
  await writeAniListSeedFingerprint(store, { rows: DEFAULT_SEED_ROWS, fmt: ANILIST_SEED_FMT_VERSION });
}

const INSERT_OR_IGNORE_SQL =
  'INSERT OR IGNORE INTO "anilist_titles" ("mediaId", "titleType", "rawTitle", "normalizedTitle", "compactTitle") VALUES (?, ?, ?, ?, ?)';

function parseMediaId(raw: string): number | null {
  if (!/^-?\d+$/.test(raw)) {
    return null;
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) {
    return null;
  }
  return n;
}

export function parseAniListTsvGzip(gzipBytes: Uint8Array): AniListTitleRow[] {
  const text = new TextDecoder('utf-8').decode(gunzipSync(gzipBytes));
  const rows: AniListTitleRow[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const tab1 = line.indexOf('\t');
    if (tab1 <= 0) {
      continue;
    }
    const tab2 = line.indexOf('\t', tab1 + 1);
    if (tab2 <= tab1) {
      continue;
    }
    const mediaId = parseMediaId(line.slice(0, tab1));
    if (mediaId === null) {
      continue;
    }
    const titleType = line.slice(tab1 + 1, tab2);
    const rawTitle = line.slice(tab2 + 1);
    if (rawTitle === '') {
      continue;
    }
    rows.push({
      mediaId,
      titleType,
      rawTitle,
      normalizedTitle: normalize(rawTitle),
      compactTitle: compact(rawTitle),
    });
  }
  return rows;
}

export async function seedAniListTitles(
  db: SQLiteDatabase,
  gzipBytes: Uint8Array,
): Promise<SeedAniListResult> {
  return contentMutationGate.mutex.withLock(() => seedAniListTitlesLocked(db, gzipBytes));
}

async function seedAniListTitlesLocked(db: SQLiteDatabase, gzipBytes: Uint8Array): Promise<SeedAniListResult> {
  const rows = parseAniListTsvGzip(gzipBytes);
  const seen = new Set<string>();
  let inserted = 0;
  await db.execute('BEGIN');
  try {
    for (const row of rows) {
      const key = `${row.mediaId}\u0000${row.titleType}\u0000${row.rawTitle}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const res = await db.execute(INSERT_OR_IGNORE_SQL, [
        row.mediaId,
        row.titleType,
        row.rawTitle,
        row.normalizedTitle,
        row.compactTitle,
      ]);
      inserted += res.rowsAffected;
      // An immediately resolved mock/native bridge promise can monopolize the
      // microtask queue. Yield periodically so launch animation and input run.
      if (seen.size % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    await db.execute('COMMIT');
  } catch (err) {
    await db.execute('ROLLBACK');
    throw err;
  }
  return { parsed: rows.length, inserted };
}
