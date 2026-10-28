/**
 * GodMomentRepository —— Android `god/GodMomentRepository.kt`（159 行 / 126 非空）的 DB 侧。
 *
 * Kotlin 行号映射（`novel-reader/app/src/main/java/com/example/god/GodMomentRepository.kt`）：
 *   - 33-37   `Flow<T>.guarded(default, tag)`（任何异常降级，不带崩 App）→ `guarded()` 包装
 *   - 40-41   `observeAll()` → `all()`（排序在 SQL，与 DAO 同款）
 *   - 43-44   `observeForBook()` → `listForBook()`（`ORDER BY chapterNumber ASC`）
 *   - 46-47   `observeChapter()` → `find()`
 *   - 50-53   `observeChapterMap()`（associateBy chapterId）→ 见 `find()`
 *   - 58      `count()` → `count()`
 *   - 66-77   `save()`（复用旧 id / createdAt、推 updatedAt、封面路径变化时删旧封面）
 *              → `upsert()`
 *   - 79-99   `delete` / `deleteForBook` / `deleteForChapter`（删完清封面文件）→ 同名方法
 *   - 103-127 `exportJson()` / 129-158 `importJson()` → **未移植**，走通用 `database.rows`
 *              备份通道（`core/db/schemaV12.ts` 的 `BACKUP_TABLES` 含 `god_moments`），
 *              见 `docs/PARITY_EXCEPTIONS.md` E79（与 E12 同源）
 *   - 58-67   DAO SQL（`observeAll` 的 `ORDER BY rating DESC, createdAt DESC` 等）
 *              → 本文件各方法的 SQL 字面量
 *
 * 适配与跳过：
 *   - `ContentMutationGate.mutex.withLock`（L67/80/87/94）→ `@core/god/godMoments` 的
 *     `dbSyncQueue` promise 链（`enqueueDbSync`），同语义（写库串行化）。
 *   - `withContext(Dispatchers.IO)` → 返回 `Promise`。
 *   - `GodCoverEngine.deleteQuietly(...)` → **跳过**：web 侧没有 filesDir，
 *     `coverPath` 是 URL/路径（E36）。
 *   - `Guarded` 降级：本文件所有读方法都过 `guarded()`，与 Kotlin L33-37 同款。
 *
 * 本次逐行复核的修正：
 *   - `emptyMoment()` 的 `cropParams` 默认值：Kotlin L219 是 `CropParams.DEFAULT.toTag()`，
 *     而 Kotlin `round3()` 用 `Float.toString()`（恒带一位小数）⇒ 安卓的默认串是
 *     `"1.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0"`。此前这里手写 `'1,0,0,0,0,0,1,1'` ——
 *     能解析回来但**字节与安卓不同**（新落库的行 + 备份 diff 会不一致）。
 *     现改走 `cropParamsToTag(DEFAULT_CROP_PARAMS)`。
 *
 * 本文件是 `src/core`，不 import React / DOM / Capacitor。
 */
import { cropParamsToTag, DEFAULT_CROP_PARAMS, type GodMoment, type GodSort } from './godTypes';
import { sortGodMoments } from './godTypes';

export interface GodDatabase {
  execute(
    sql: string,
    params?: Array<string | number | null>,
  ): Promise<{ rowsAffected: number; lastInsertRowId?: number }>;
  query<T>(sql: string, params?: Array<string | number | null>): Promise<T[]>;
}

export interface GodMomentRow {
  id: number;
  contentType: string;
  bookId: string;
  chapterId: string;
  bookTitle: string;
  chapterTitle: string;
  chapterNumber: number;
  title: string;
  titleIsCustom: number;
  rating: number;
  note: string;
  coverPath: string | null;
  coverSource: string;
  cropParams: string;
  createdAt: number;
  updatedAt: number;
}

const MOMENT_COLUMNS =
  '"id", "contentType", "bookId", "chapterId", "bookTitle", "chapterTitle", ' +
  '"chapterNumber", "title", "titleIsCustom", "rating", "note", "coverPath", ' +
  '"coverSource", "cropParams", "createdAt", "updatedAt"';

export function rowToGodMoment(row: GodMomentRow): GodMoment {
  return {
    id: row.id,
    contentType: row.contentType === 'novel' ? 'novel' : 'comic',
    bookId: row.bookId,
    chapterId: row.chapterId,
    bookTitle: row.bookTitle,
    chapterTitle: row.chapterTitle,
    chapterNumber: row.chapterNumber,
    title: row.title,
    titleIsCustom: row.titleIsCustom === 1,
    rating: row.rating,
    note: row.note,
    coverPath: row.coverPath,
    coverSource: row.coverSource,
    cropParams: row.cropParams,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function emptyMoment(overrides: Partial<GodMoment>): GodMoment {
  return {
    id: 0,
    contentType: 'comic',
    bookId: '',
    chapterId: '',
    bookTitle: '',
    chapterTitle: '',
    chapterNumber: 0,
    title: '',
    titleIsCustom: false,
    rating: 5,
    note: '',
    coverPath: null,
    // Kotlin L217：`CoverSource.ComicPage().toTag()` = "page|0|"
    coverSource: 'page|0|',
    // Kotlin L219：`CropParams.DEFAULT.toTag()`
    // ⚠️ 必须走 `cropParamsToTag()` —— Kotlin `Float.toString()` 恒带一位小数，
    // 安卓的默认值是 `"1.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0"`；手写 `'1,0,0,0,0,0,1,1'`
    // 会让新落库的行与安卓 / 备份里的字节不一致。
    cropParams: cropParamsToTag(DEFAULT_CROP_PARAMS),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function safeId(id: number): number {
  return Number.isFinite(id) ? Math.trunc(id) : 0;
}

/**
 * Kotlin `private fun <T> Flow<T>.guarded(default: T, tag: String)`（L33-37）。
 *
 * 「神回是**附加功能**，任何一步出问题（数据库未就绪、磁盘异常、迁移失败……）都只允许
 * 它自己不可用，**绝不能把整个 App 带崩**。所有对外 Flow 都经过这里。」
 *
 * 只包**读**方法（对应 Kotlin 的 `observeAll` / `observeForBook` / `observeChapter`）；
 * `chapter()` / `count()` / 写方法在 Kotlin 侧同样没有 guard。
 */
function guarded<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(() => fallback);
}

export class GodMomentRepository {
  constructor(private readonly db: GodDatabase) {}

  all(): Promise<GodMoment[]> {
    // Kotlin `GodMomentDao.allSync()` / `observeAll()`：
    //   `SELECT * FROM god_moments ORDER BY rating DESC, createdAt DESC`
    // 排序在 SQL 里（Room Flow 与 sync 版本同款）。此前本文件不带 ORDER BY，
    // 行的顺序取决于 SQLite 的行序 —— 跨端读同一份备份会拿到不同顺序。
    return guarded(
      this.db
        .query<GodMomentRow>(
          `SELECT ${MOMENT_COLUMNS} FROM god_moments ORDER BY rating DESC, createdAt DESC`,
        )
        .then((rows) => rows.map(rowToGodMoment)),
      [],
    );
  }

  listRanked(sort: GodSort = 'rating'): Promise<GodMoment[]> {
    return this.all().then((list) => sortGodMoments(list, sort));
  }

  listForBook(bookId: string): Promise<GodMoment[]> {
    return guarded(
      this.all().then((list) =>
        list
          .filter((item) => item.bookId === bookId)
          .sort((a, b) => a.chapterNumber - b.chapterNumber),
      ),
      [],
    );
  }

  find(bookId: string, chapterId: string): Promise<GodMoment | null> {
    return guarded(
      this.all().then((list) => {
        const match = list.find(
          (item) => item.bookId === bookId && item.chapterId === chapterId,
        );
        return match ?? null;
      }),
      null,
    );
  }

  byId(id: number): Promise<GodMoment | null> {
    return this.all().then((list) => {
      const match = list.find((item) => item.id === id);
      return match ?? null;
    });
  }

  count(): Promise<number> {
    return this.db
      .query<{ count: number }>('SELECT COUNT(*) FROM god_moments')
      .then((rows) => rows[0]?.count ?? 0);
  }

  clear(): Promise<void> {
    return this.db.execute('DELETE FROM god_moments').then(() => undefined);
  }

  delete(id: number): Promise<void> {
    return this.db
      .execute(`DELETE FROM god_moments WHERE "id" = ${safeId(id)}`)
      .then(() => undefined);
  }

  deleteForBook(bookId: string): Promise<void> {
    return this.all().then(async (list) => {
      for (const item of list) {
        if (item.bookId === bookId) {
          await this.db.execute(
            `DELETE FROM god_moments WHERE "id" = ${safeId(item.id)}`,
          );
        }
      }
    });
  }

  deleteForChapter(bookId: string, chapterId: string): Promise<void> {
    return this.all().then(async (list) => {
      for (const item of list) {
        if (item.bookId === bookId && item.chapterId === chapterId) {
          await this.db.execute(
            `DELETE FROM god_moments WHERE "id" = ${safeId(item.id)}`,
          );
        }
      }
    });
  }

  upsert(moment: GodMoment): Promise<GodMoment> {
    return this.all().then(async (list) => {
      const existing =
        list.find(
          (item) => item.bookId === moment.bookId && item.chapterId === moment.chapterId,
        ) ?? null;
      const now = Date.now();
      const saved = emptyMoment({
        ...moment,
        id: existing?.id ?? moment.id,
        createdAt: existing?.createdAt ?? moment.createdAt,
        updatedAt: now,
      });

      if (existing) {
        await this.db.execute(
          'UPDATE god_moments SET "contentType" = ?, "bookTitle" = ?, "chapterTitle" = ?, ' +
            '"chapterNumber" = ?, "title" = ?, "titleIsCustom" = ?, "rating" = ?, "note" = ?, ' +
            '"coverPath" = ?, "coverSource" = ?, "cropParams" = ?, "updatedAt" = ? ' +
            `WHERE "id" = ${safeId(saved.id)}`,
          [
            saved.contentType,
            saved.bookTitle,
            saved.chapterTitle,
            saved.chapterNumber,
            saved.title,
            saved.titleIsCustom ? 1 : 0,
            saved.rating,
            saved.note,
            saved.coverPath,
            saved.coverSource,
            saved.cropParams,
            saved.updatedAt,
          ],
        );
        return saved;
      }

      const result = await this.db.execute(
        'INSERT INTO god_moments ("id", "contentType", "bookId", "chapterId", "bookTitle", ' +
          '"chapterTitle", "chapterNumber", "title", "titleIsCustom", "rating", "note", ' +
          '"coverPath", "coverSource", "cropParams", "createdAt", "updatedAt") ' +
          'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          saved.id === 0 ? null : saved.id,
          saved.contentType,
          saved.bookId,
          saved.chapterId,
          saved.bookTitle,
          saved.chapterTitle,
          saved.chapterNumber,
          saved.title,
          saved.titleIsCustom ? 1 : 0,
          saved.rating,
          saved.note,
          saved.coverPath,
          saved.coverSource,
          saved.cropParams,
          saved.createdAt,
          saved.updatedAt,
        ],
      );
      return emptyMoment({ ...saved, id: result.lastInsertRowId ?? saved.id });
    });
  }
}
