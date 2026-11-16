/**
 * AniList title DAO — port of the `AniListDao` interface + `AniListTitleEntity` declared in
 * `novel-reader/app/src/main/java/com/example/data/AppDatabase.kt`
 * (Kotlin lines 176..239, 64 non-blank).
 *
 * Line map (Kotlin line → TS):
 *   176      KDoc `AniList 本地标题库 DAO（第七轮第 7 条）：查询走 SQL + 索引，数据集不整体进内存` → kept.
 *   177..221 `interface AniListDao { … }` → `AniListDao` class over `DatabaseLike`.
 *   178      `@Dao` → no analogue.
 *   180..184 `@Query("SELECT DISTINCT mediaId FROM anilist_titles " + "WHERE normalizedTitle = :normalized OR compactTitle = :compact LIMIT 64")`
 *            / `suspend fun findMediaIds(normalized, compact): List<Int>` →
 *            `findMediaIds(normalized, compact)`. **64 preserved.**
 *   185      (blank)
 *   186..190 KDoc explaining the substring-match fix (round 11 §6) → kept.
 *   191..196 `@Query(… LIKE '%' || :norm || '%' ESCAPE '\\' … OR … LIMIT :limit)`
 *            / `findMediaIdsContaining(norm, comp, limit)` →
 *            `findMediaIdsContaining(norm, comp, limit)`. **The `ESCAPE '\'` clause and
 *            the LIKE pattern are byte-identical**; Kotlin's `\\` inside a regular string
 *            is one backslash, which is what lands in the SQL.
 *   197      (blank)
 *   198..201 KDoc `取这些作品的全部标题原文（变体扩展用…）` → kept.
 *   202..208 `@Query(… ORDER BY mediaId ASC, CASE titleType WHEN 'NATIVE' THEN 0 WHEN 'ENGLISH' THEN 1 WHEN 'ROMAJI' THEN 2 WHEN 'SYNONYM' THEN 3 ELSE 4 END)`
 *            / `getRawTitlesFor(mediaIds): List<String>` → `getRawTitlesFor(mediaIds)`.
 *            The five-branch CASE ordering is preserved exactly (NATIVE < ENGLISH < ROMAJI < SYNONYM < other).
 *   209      (blank)
 *   210..211 `@Query("SELECT * FROM anilist_titles WHERE mediaId IN (:mediaIds)")` / `getTitleRowsFor(mediaIds)`
 *            → `getTitleRowsFor(mediaIds)`.
 *   212      (blank)
 *   213..214 `@Insert(onConflict = OnConflictStrategy.IGNORE)` / `insertTitles(rows)`
 *            → `insertTitles(rows)` using `INSERT OR IGNORE` (Room IGNORE == SQL IGNORE).
 *   215      (blank)
 *   216..217 `@Query("SELECT COUNT(*) FROM anilist_titles")` / `countTitles()` → `countTitles()`.
 *   218      (blank)
 *   219..220 `@Query("DELETE FROM anilist_titles")` / `clearTitles()` → `clearTitles()`.
 *   221      `}` → end of interface.
 *   222      (blank)
 *   223      KDoc `AniList 多语言标题行：一部作品的每个标题（romaji/english/native/synonym）一行` → kept.
 *   224..231 `@Entity(tableName = "anilist_titles", indices = [Index(["normalizedTitle"]), Index(["compactTitle"]), Index(["mediaId","titleType","rawTitle"], unique = true)])`
 *            → the indices live in `schemaV12.ts` `TABLES[anilist_titles].indices` (already
 *              correct: 2 non-unique + 1 unique composite). The entity becomes a plain interface.
 *   232..239 `data class AniListTitleEntity(rowId = 0, mediaId, titleType, rawTitle, normalizedTitle, compactTitle)`
 *            → `AniListTitleEntity`. `rowId` is the Room `autoGenerate` primary key, so
 *              it is optional on insert (mirrors the Kotlin default `= 0`).
 *
 * Skipped lines and why:
 *   - Kotlin `@Dao` / `@Query` / `@Insert` annotations → code-generation directives with no
 *     runtime meaning outside Room; the SQL they carry is reproduced as real statements.
 *   - Kotlin `suspend` → `Promise`; `suspend fun` bodies are otherwise unchanged.
 *   - Kotlin `List<Int>` bind parameters (`IN (:mediaIds)`) → explicit placeholder list
 *     (`?,?,…`) because Capacitor SQLite has no named-parameter binding; the empty-list
 *     case returns `[]` without issuing a query (a malformed `IN ()` is a syntax error in
 *     SQLite), matching Room's behaviour of returning an empty list.
 *   - Kotlin `import kotlinx.coroutines.flow.Flow` → `AniListDao` has no `Flow` member
 *     (unlike `BookDao`), so nothing is lost.
 *
 * The bulk-import side of this feature (gzip TSV parsing, `TitleNormalizer` columns,
 * the format-version fingerprint) lives in `data/anilistSeeding.ts` and was audited OK:
 * `ANILIST_SEED_FMT_VERSION = 2` matches Kotlin `BUNDLED_FMT_VERSION = 2`, and the Kotlin
 * `IMPORT_BATCH = 2000` batching is not a behavioural requirement (batching only bounds
 * peak memory of one INSERT batch; the TS version issues the same rows in one transaction).
 */

import type { DatabaseLike } from '../library/bookRepository';

/** Kotlin `AniListTitleEntity`. */
export interface AniListTitleEntity {
  /** Room `autoGenerate` primary key; omit on insert (Kotlin default `= 0`). */
  rowId?: number;
  mediaId: number;
  titleType: string;
  rawTitle: string;
  normalizedTitle: string;
  compactTitle: string;
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(',');
}

/** `AniList 本地标题库 DAO（第七轮第 7 条）：查询走 SQL + 索引，数据集不整体进内存` */
export class AniListDao {
  constructor(private readonly db: DatabaseLike) {}

  /** 精确匹配（归一化态 / 紧凑态任一命中）→ 作品 id 列表 */
  async findMediaIds(normalized: string, compact: string): Promise<number[]> {
    const rows = await this.db.query<{ mediaId: number }>(
      'SELECT DISTINCT mediaId FROM anilist_titles ' +
        'WHERE normalizedTitle = ? OR compactTitle = ? LIMIT 64',
      [normalized, compact],
    );
    return rows.map((r) => r.mediaId);
  }

  /**
   * 子串匹配（第十一轮第 6 条修复）：用户输入常为短名（"无职转生"），而库里存的是
   * 完整标题（"無職転生 ～異世界行ったら本気だす～"）——精确等值永远落空，多语言
   * 扩展从未生效。此查询以"关键词包含在标题内"命中，LIKE 通配符已由调用方转义。
   */
  async findMediaIdsContaining(norm: string, comp: string, limit: number): Promise<number[]> {
    const rows = await this.db.query<{ mediaId: number }>(
      'SELECT DISTINCT mediaId FROM anilist_titles ' +
        "WHERE normalizedTitle LIKE '%' || ? || '%' ESCAPE '\\' " +
        "   OR compactTitle LIKE '%' || ? || '%' ESCAPE '\\' LIMIT ?",
      [norm, comp, limit],
    );
    return rows.map((r) => r.mediaId);
  }

  /**
   * 取这些作品的全部标题原文（变体扩展用；结果集 = 命中作品数 × 标题数，天然有界）。
   * 第十一轮第 6 条：作品优先 + 类型优先排序——同一作品的官方标题（原名/英文/
   *  罗马音）聚在一起且排在同义词前，保证 MAX_VARIANTS 截断时优先保留主作品
   *  最有价值的变体，不被衍生作的同类型标题挤占。
   */
  async getRawTitlesFor(mediaIds: number[]): Promise<string[]> {
    if (mediaIds.length === 0) return [];
    const rows = await this.db.query<{ rawTitle: string }>(
      `SELECT rawTitle FROM anilist_titles WHERE mediaId IN (${placeholders(mediaIds.length)}) ` +
        'ORDER BY mediaId ASC, CASE titleType ' +
        "WHEN 'NATIVE' THEN 0 WHEN 'ENGLISH' THEN 1 WHEN 'ROMAJI' THEN 2 " +
        "WHEN 'SYNONYM' THEN 3 ELSE 4 END",
      mediaIds,
    );
    return rows.map((r) => r.rawTitle);
  }

  async getTitleRowsFor(mediaIds: number[]): Promise<AniListTitleEntity[]> {
    if (mediaIds.length === 0) return [];
    return this.db.query<AniListTitleEntity>(
      'SELECT * FROM anilist_titles WHERE mediaId IN (' + placeholders(mediaIds.length) + ')',
      mediaIds,
    );
  }

  /**
   * Kotlin `@Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertTitles(rows: List<AniListTitleEntity>)`.
   *
   * Room wraps a `List` insert in a single transaction, so a failure part-way through a
   * 2 000-row batch rolls the whole batch back. The previous shape issued one statement
   * per row with no transaction, which left a half-imported dataset behind on failure —
   * and `AppDatabase.ensureBundledTitlesImported` records `countTitles()` as its
   * idempotency fingerprint, so a partial batch would be recorded as a complete import.
   */
  async insertTitles(rows: AniListTitleEntity[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.execute('BEGIN');
    try {
      for (const row of rows) {
        await this.db.execute(
          'INSERT OR IGNORE INTO anilist_titles ("mediaId", "titleType", "rawTitle", "normalizedTitle", "compactTitle") VALUES (?,?,?,?,?)',
          [row.mediaId, row.titleType, row.rawTitle, row.normalizedTitle, row.compactTitle],
        );
      }
      await this.db.execute('COMMIT');
    } catch (error) {
      await this.db.execute('ROLLBACK');
      throw error;
    }
  }

  async countTitles(): Promise<number> {
    const rows = await this.db.query<{ c: number }>('SELECT COUNT(*) AS c FROM anilist_titles');
    return rows[0]?.c ?? 0;
  }

  async clearTitles(): Promise<void> {
    await this.db.execute('DELETE FROM anilist_titles');
  }
}