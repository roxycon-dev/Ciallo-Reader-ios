/**
 * Android `com.example.source.keyword.KeywordDictionary.kt` (176 lines, 169 non-blank)
 * → `src/core/source/keyword/keywordDictionary.ts`.
 *
 * Kotlin class KDoc (line 20), verbatim:
 * `Rebuildable reverse index, isolated from books/favorites; never keeps the full dictionary in RAM.`
 *
 * Kotlin → TS mapping (line numbers refer to the Kotlin file):
 *   1-19     package/imports                          → header + imports
 *   20       class KDoc                               → header comment (verbatim)
 *   21-27    class + gate/helper/settings/client      → ctor with injected deps
 *   29-46    private class Helper : SQLiteOpenHelper    → CREATE/UPGRADE SQL literals
 *   48-69    find()                                  → find()
 *   71-95    prepare()                                → prepare()
 *   97-123   put(insert, namespace, raw, name)        → put()
 *   126-175  refreshIfDue(allowed)                     → refreshIfDue()
 *
 * Skipped lines / adaptations:
 *   - `android.content.Context` → three injected ports: `db: SQLiteDatabase`
 *     (the platform SQLite, which also owns the schema version),
 *     `readAsset(name): Promise<Uint8Array>` (the bundled gzip TSV + the version
 *     file) and `settings: KeyValueStore` (`SharedPreferences`).
 *   - `SQLiteOpenHelper(context, path, null, 3)` → `db.open({name})` plus the
 *     literal `CREATE`/`DELETE` statements below. The Room `@Dao`/`@Entity`
 *     annotations have no equivalent; the SQL is verbatim and exposed as
 *     `KEYWORD_DICTIONARY_SCHEMA` so a migration can reuse it.
 *   - `onCreate` / `onUpgrade` (lines 31-45) → `ensureSchema()` + `upgradeSchema()`
 *     exporting the same statements in the same order.
 *   - `GZIPInputStream(context.assets.open("keyword_ehtag.tsv.gzip"))` →
 *     `gunzipSync(await readAsset('keyword_ehtag.tsv.gzip'))` via `fflate`
 *     (already a dependency, used by `src/core/data/anilistSeeding.ts`).
 *   - `compileStatement` + `bindString` + `executeInsert` → `db.execute(sql, params)`;
 *     `INSERT OR IGNORE` keeps the idempotent replay semantics.
 *   - `settings.edit().putLong(...).apply()` → `settings.set(key, String(value))`.
 *   - `System.currentTimeMillis()` → the injected `now()` (default `Date.now`).
 *   - `Mutex.withLock` → `AsyncMutex` from `../impl/sourceHttp`.
 *   - `currentCoroutineContext().ensureActive()` → an `abort` check via the
 *     `signal?: AbortSignal` option (a cooperative cancellation point between
 *     rows); without a signal this is a no-op, matching "no scope to cancel".
 *   - `SystemProxyResolver.resolve(context)` + `client.newBuilder().proxy(it)` →
 *     the caller injects an already-proxied `client`; OkHttp's proxy builder has
 *     no JS counterpart. The conditional `?: client` therefore disappears.
 *   - `Character.getType(point) != OTHER_SYMBOL / MODIFIER_SYMBOL` and the
 *     `0xFE0F / 0xFE0E / 0x200D` exclusions (lines 101-107) → a Unicode regex
 *     covering the same code points: `Symbol`-category characters (So/Sk — the
 *     JS `\p{S}` class), variation selectors and the zero-width joiner. This is
 *     documented as an approximation of `Character.getType`; the intent
 *     (strip decorative emoji from upstream display names) is preserved.
 *   - `require(count in 1_000..100_000)` → the same bound check with the same
 *     message.
 */

import type { SQLiteDatabase } from '@platform/interfaces';
import { gunzipSync } from 'fflate';
import {
  arrayOptJsonObject,
  keys,
  optInt,
  optJsonArray,
  optJsonObject,
  optString,
  parseJsonObjectOrThrow,
} from '../impl/jsonSupport';
import {
  AsyncMutex,
  MAX_IMPORT_BODY_BYTES,
  decodeUtf8,
  executeSourceRequest,
  isSuccessful,
  resolveHttpClient,
  SourceNetworkError,
} from '../impl/sourceHttp';
import type { HttpClient } from '../impl/sourceHttp';
import type { KeywordConcept, KeywordName } from './keywordModels';
import { language, shortForms } from './keywordModels';
import { compact } from '../../data/titleNormalizer';

/** Rebuildable reverse index, isolated from books/favorites; never keeps the full dictionary in RAM. */

/** Kotlin `SharedPreferences("keyword_dictionary")` — the two values used here. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface KeywordDictionaryOptions {
  /** Kotlin `context.assets.open(name)`. */
  readonly readAsset: (name: string) => Promise<Uint8Array>;
  /** Kotlin `SharedPreferences`. */
  readonly settings: KeyValueStore;
  /** Kotlin `SharedHttpTransport.builder()…build()`. */
  readonly client?: HttpClient | null;
  /** Kotlin `System::currentTimeMillis`. */
  readonly now?: () => number;
  /** Cooperative cancellation between rows (Kotlin `ensureActive()`). */
  readonly signal?: AbortSignal;
}

const DB_NAME = 'keyword_dictionary_v1.db';

/** Kotlin `Helper(context)` — `onCreate` / `onUpgrade`, statement for statement. */
export const KEYWORD_DICTIONARY_SCHEMA: readonly string[] = [
  'CREATE TABLE IF NOT EXISTS aliases (concept TEXT NOT NULL, raw TEXT NOT NULL, lang TEXT NOT NULL, match_key TEXT NOT NULL, PRIMARY KEY(concept,raw,lang))',
  'CREATE INDEX IF NOT EXISTS alias_match ON aliases(match_key)',
  'CREATE TABLE IF NOT EXISTS metadata (version TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS name_parts (concept TEXT NOT NULL, match_key TEXT NOT NULL, PRIMARY KEY(concept,match_key))',
  'CREATE INDEX IF NOT EXISTS name_part_match ON name_parts(match_key)',
];

export const INSERT_ALIAS_SQL =
  'INSERT OR IGNORE INTO aliases(concept,raw,lang,match_key) VALUES(?,?,?,?)';
export const INSERT_NAME_PART_SQL =
  'INSERT OR IGNORE INTO name_parts(concept,match_key) VALUES(?,?)';

const LATIN_NAMESPACES = new Set(['parody', 'character', 'artist', 'group']);
const SHORT_NAME_NAMESPACES = new Set(['character', 'artist']);
const SKIPPED_GROUPS = new Set(['rows', 'temp']);
const CHECKED_AT = 'checked_at';
const DICTIONARY_URL =
  'https://raw.githubusercontent.com/EhTagTranslation/DatabaseReleases/master/db.text.json';
const DICTIONARY_UA =
  'CialloReader/1.2 (+https://github.com/roxycon-dev/Ciallo-Reader)';

export class KeywordDictionary {
  private readonly gate = new AsyncMutex();
  private ready = false;

  constructor(
    private readonly db: SQLiteDatabase,
    private readonly options: KeywordDictionaryOptions,
  ) {}

  /** Kotlin `find(input)` (lines 48-69). */
  async find(input: string): Promise<KeywordConcept[]> {
    return this.gate.withLock(async () => {
      await this.prepare();
      const ids: string[] = [];
      const direct = await this.db.query<{ concept: string }>(
        'SELECT DISTINCT concept FROM aliases WHERE match_key=? LIMIT 4',
        [matchKey(input)],
      );
      for (const row of direct) ids.push(row.concept);
      if (ids.length === 0) {
        const parts = await this.db.query<{ concept: string }>(
          'SELECT DISTINCT concept FROM name_parts WHERE match_key=? LIMIT 2',
          [matchKey(input)],
        );
        for (const row of parts) ids.push(row.concept);
        // Same short name across entities needs more context, not a guess.
        if (ids.length > 1) return [];
      }
      const out: KeywordConcept[] = [];
      for (const id of ids) {
        const rows = await this.db.query<{ raw: string; lang: string }>(
          'SELECT raw,lang FROM aliases WHERE concept=?',
          [id],
        );
        const names: KeywordName[] = rows.map((row) => ({
          text: row.raw,
          language: row.lang,
        }));
        out.push({ id, names, source: 'EhTagTranslation (CC BY-NC-SA 3.0)' });
      }
      return out;
    });
  }

  /** Kotlin `prepare()` (lines 71-95). */
  private async prepare(): Promise<void> {
    if (this.ready) return;
    await this.ensureSchema();
    const rows = await this.db.query<{ count: number }>('SELECT COUNT(*) FROM metadata');
    const exists = (rows[0]?.count ?? 0) > 0;
    if (!exists) {
      await this.db.execute('BEGIN');
      try {
        const bytes = await this.options.readAsset('keyword_ehtag.tsv.gzip');
        const text = decodeUtf8(gunzipSync(bytes));
        for (const rawLine of text.split('\n')) {
          this.throwIfAborted();
          const line = rawLine.replace(/\r$/, '');
          const parts = line.split('\t');
          if (parts.length !== 3) continue;
          await this.put(
            parts[0] as string,
            parts[1] as string,
            parts[2] as string,
          );
        }
        const versionBytes = await this.options.readAsset('keyword_dictionary_version.txt');
        const version = decodeUtf8(versionBytes).trim();
        await this.db.execute('INSERT INTO metadata(version) VALUES(?)', [version]);
        await this.db.execute('COMMIT');
      } catch (e) {
        await this.db.execute('ROLLBACK');
        throw e;
      }
      await this.options.settings.set(CHECKED_AT, String(this.now()));
    }
    this.ready = true;
  }

  /** Kotlin `private fun put(insert, namespace, raw, name)` (lines 97-123). */
  private async put(namespace: string, raw: string, name: string): Promise<void> {
    if (raw.trim() === '' || name.trim() === '') return;
    if (raw.length > 160 || name.length > 160) return;
    const id = `ehtag:${namespace}:${raw}`;
    // Upstream display names can include decorative emoji, which aren't query words.
    const cleanName = stripDecorativeSymbols(name).trim();
    const names: KeywordName[] = [
      { text: raw, language: LATIN_NAMESPACES.has(namespace) ? 'latin' : 'en' },
      { text: cleanName, language: language(cleanName) },
    ];
    const shorts = SHORT_NAME_NAMESPACES.has(namespace) ? shortForms(cleanName) : [];
    if (shorts.length > 0) {
      for (const short of shorts) {
        await this.db.execute(INSERT_NAME_PART_SQL, [id, matchKey(short)]);
      }
    }
    for (const entry of dedupeNames(names)) {
      if (entry.text.trim() === '') continue;
      this.throwIfAborted();
      await this.db.execute(INSERT_ALIAS_SQL, [
        id,
        entry.text,
        entry.language,
        matchKey(entry.text),
      ]);
    }
  }

  /** On a missing word, at most one attempt per day, without erasing a usable old version. */
  async refreshIfDue(allowed: () => boolean): Promise<boolean> {
    const due = await this.gate.withLock(async () => {
      await this.prepare();
      const stamp = this.now();
      const last = await this.options.settings.get(CHECKED_AT);
      const lastNum = last != null && /^\d+$/.test(last) ? Number.parseInt(last, 10) : 0;
      if (!allowed() || stamp - lastNum < 24 * 60 * 60 * 1_000) return false;
      await this.options.settings.set(CHECKED_AT, String(stamp));
      return true;
    });
    if (!due) return false;

    const request = {
      url: DICTIONARY_URL,
      headers: { 'User-Agent': DICTIONARY_UA },
      maxBytes: MAX_IMPORT_BODY_BYTES,
    };
    const client = resolveHttpClient(this.options.client ?? null);
    const response = await executeSourceRequest(client, request.url, request);
    if (!isSuccessful(response)) return false;
    if (response.body.byteLength === 0) return false;
    const root = parseJsonObjectOrThrow(decodeUtf8(response.body));
    if (optInt(root, 'version') !== 7) {
      throw new Error('Unsupported keyword dictionary format');
    }
    const head = optString(optJsonObject(root, 'head'), 'sha', '') ?? '';
    const groups = optJsonArray(root, 'data');
    if (groups == null) throw new Error('missing data');
    return this.gate.withLock(async () => {
      const currentRows = await this.db.query<{ version: string }>(
        'SELECT version FROM metadata LIMIT 1',
      );
      const current = currentRows[0]?.version ?? '';
      if (head.trim() !== '' && head === current) return false;
      await this.db.execute('BEGIN');
      try {
        await this.db.execute('DELETE FROM aliases');
        await this.db.execute('DELETE FROM name_parts');
        let count = 0;
        for (let i = 0; i < groups.length; i += 1) {
          this.throwIfAborted();
          if (!allowed()) return false;
          const group = arrayOptJsonObject(groups, i);
          if (group == null) continue;
          const namespace = optString(group, 'namespace', '') ?? '';
          if (SKIPPED_GROUPS.has(namespace)) continue;
          const data = optJsonObject(group, 'data');
          if (data == null) continue;
          for (const raw of keys(data)) {
            const display = optString(optJsonObject(data, raw), 'name', '') ?? '';
            await this.put(namespace, raw, display);
            count += 1;
          }
        }
        if (!(count >= 1_000 && count <= 100_000)) {
          throw new Error('Invalid keyword dictionary size');
        }
        await this.db.execute('DELETE FROM metadata');
        await this.db.execute('INSERT INTO metadata(version) VALUES(?)', [
          head.trim() === '' ? `online-${this.now()}` : head,
        ]);
        await this.db.execute('COMMIT');
        return true;
      } catch (e) {
        await this.db.execute('ROLLBACK');
        throw e;
      }
    });
  }

  /** Kotlin `Helper.onCreate` + `createNameParts` (lines 31-40). */
  async ensureSchema(): Promise<void> {
    await this.db.open({ name: DB_NAME });
    for (const sql of KEYWORD_DICTIONARY_SCHEMA) {
      await this.db.execute(sql);
    }
  }

  /** Kotlin `Helper.onUpgrade` (lines 41-45) — clears and recreates everything. */
  async upgradeSchema(): Promise<void> {
    await this.db.execute('DELETE FROM aliases');
    await this.db.execute('DELETE FROM metadata');
    for (const sql of KEYWORD_DICTIONARY_SCHEMA.slice(3)) {
      await this.db.execute(sql);
    }
    await this.db.execute('DELETE FROM name_parts');
  }

  private now(): number {
    return this.options.now != null ? this.options.now() : Date.now();
  }

  /** Kotlin `currentCoroutineContext().ensureActive()`. */
  private throwIfAborted(): void {
    if (this.options.signal?.aborted === true) {
      throw new SourceNetworkError('keyword dictionary refresh cancelled');
    }
  }
}

/** Kotlin `KeywordKeys.match(text)` = `TitleNormalizer.compact(text)`. */
function matchKey(text: string): string {
  return compact(text);
}

/** Kotlin `names.distinct()` over the two-field `KeywordName` data class. */
function dedupeNames(names: KeywordName[]): KeywordName[] {
  const seen = new Set<string>();
  const out: KeywordName[] = [];
  for (const name of names) {
    const key = `${name.text} ${name.language}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Kotlin lines 101-107: drop code points whose `Character.getType` is
 * `OTHER_SYMBOL` (So) or `MODIFIER_SYMBOL` (Sk), plus U+FE0F, U+FE0E and
 * U+200D. JS exposes `General_Category=So|Sk` through `\p{}`, which matches
 * `Character.getType` exactly for those two categories; the three literal code
 * points are excluded separately.
 */
function stripDecorativeSymbols(value: string): string {
  return [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 0xfe0f || code === 0xfe0e || code === 0x200d) return false;
      return !/^[\p{So}\p{Sk}]$/u.test(ch);
    })
    .join('');
}

/** Kotlin `org.json.JSONObject(text)` is `parseJsonObjectOrThrow` in `../impl/jsonSupport`. */