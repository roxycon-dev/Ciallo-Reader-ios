/**
 * `BackupManager` 的 **JSON 兼容信封** —— 逐行移植 Android
 * `com.example.data.BackupManager.kt`。
 *
 * ## 为什么需要它（E79）
 *
 * Android 有**两个**备份通道，`BackupManager` 是它们的门面：
 *  1. **ZIP**（`exportBackupArchive` / `restoreBackupArchive`）→ 委托 `BackupArchive`，
 *     产出 `database.rows` + `settings.json` + `files/**`。
 *  2. **JSON**（`exportBackupJson` / `restoreBackupJson`）→ 本文件。**不是**另一种
 *     数据格式，而是「ZIP 的 base64 信封 + 一小撮 `preferences` + 神回独立数组」。
 *
 * 差异的实际范围比 E79 原登记的大：原登记只说「god 备份多一列 `coverPath`」，
 * 实际上 **iOS 侧整个 JSON 通道都不存在**（`grep exportBackupJson src/` 零命中）。
 * 没有它，Android 的「导出 JSON 备份」文件在 iOS 上完全无法导入。
 *
 * ## 格式（Kotlin L50-108 逐条对照）
 *
 * ```kotlin
 * val archive = exportBackupArchive(File(cacheDir, "backup_${UUID}.zip"))
 * val encoded = try {
 *     require(archive.length() <= 16L * 1024 * 1024) { "备份超过 JSON 容量，请使用 ZIP 备份接口" }
 *     Base64.encodeToString(archive.readBytes(), Base64.NO_WRAP)
 * } finally { archive.delete() }
 * val godArray = godRepository?.runCatching { exportJson() }?.getOrNull()
 * val payload = BackupPayload(
 *     booksCount = bookDao().getBooksCount(),
 *     preferences = mapOf("fontSize" to …, "lineHeight" to …, "readerTheme" to …,
 *                         "pageTurnMode" to …, "splashPureMode" to …,
 *                         "screenOrientationLock" to …, "restReminderMinutes" to …)
 * )
 * JSONObject().put("archive", encoded).put("exportTime", …).put("booksCount", …)
 *            .put("preferences", JSONObject(payload.preferences))
 *            .apply { if (godArray != null) put("godMoments", godArray) }
 * ```
 *
 * `archive` 是必需字段：`restoreBackupJson` 先看它，非空就解 base64 还原成 ZIP 走
 * ZIP 通道并**立即返回**；只有没有 `archive` 时才回落到「仅恢复 preferences +
 * godMoments」的轻量路径（Kotlin L85-103）。
 *
 * ## 2026-10-11 接线说明（E79 剩余项闭合）
 *
 * 本模块此前只有单测、没有任何生产调用方。现在 `backupService.ts` 的导出/恢复编排
 * 已改为走本模块：
 *  - `BackupService.exportBackup` ≙ Kotlin `BackupManager.exportBackupJson`（信封为
 *    导出产物，内层 ZIP 仍由 `backupArchive.ts` 产出，神回以 14 字段独立数组进信封）；
 *  - `BackupService.importBackup` ≙ Kotlin `BackupManager.restoreBackupJson` +
 *    `restoreBackupArchive`：按内容分发——JSON 对象 → 信封恢复；其余（PK 魔数）→
 *    ZIP 恢复（Android 设置页 UI 导出的就是 ZIP，必须继续可导）。
 * 新增 `kotlinFloatToString`（Kotlin `Float.toString()`）与 `ParsedJsonBackup.hasPreferences`
 * （Kotlin L91 `optJSONObject("preferences") ?: return@withContext false`）。
 */

import type { GodMoment } from '@core/god/godTypes';
import {
  DEFAULT_CROP_PARAMS,
  coverSourceToTag,
  cropParamsToTag,
  defaultCoverSource,
} from '@core/god/godTypes';

/** Kotlin L137 `GodContentType.COMIC.code` 的缺省值。 */
const GOD_CONTENT_TYPE_COMIC = 'comic';
/** Kotlin L148 `CoverSource.ComicPage().toTag()` 的缺省值。 */
const COVER_SOURCE_COMIC_PAGE_DEFAULT = coverSourceToTag(defaultCoverSource());

/** Kotlin L53 `require(archive.length() <= 16L * 1024 * 1024)`。 */
export const JSON_ARCHIVE_MAX_BYTES = 16 * 1024 * 1024;
/** Kotlin L86 `require(encoded.length <= 24 * 1024 * 1024)`。 */
export const JSON_ENCODED_MAX_CHARS = 24 * 1024 * 1024;
/** Kotlin L77 落盘文件名。 */
export const JSON_BACKUP_FILE_NAME = 'novel_reader_backup.json';

/**
 * Kotlin L9-13 `data class BackupPayload(exportTime, booksCount, preferences)`。
 * `preferences` 的 7 个键名逐字照抄 L59-67（camelCase，与 ZIP 通道的 snake_case
 * 设置键名**不同** —— 这是 Kotlin 的原样，不要「统一」）。
 */
export const JSON_PREFERENCE_KEYS = [
  'fontSize',
  'lineHeight',
  'readerTheme',
  'pageTurnMode',
  'splashPureMode',
  'screenOrientationLock',
  'restReminderMinutes',
] as const;

export type JsonPreferenceKey = (typeof JSON_PREFERENCE_KEYS)[number];

/* ── base64（Kotlin 用 android.util.Base64；NO_WRAP 导出 / DEFAULT 导入） ── */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Kotlin `Float.toString()` —— 恒带小数点：`18f` → `"18.0"`，`16.5f` → `"16.5"`，
 * `NaN` → `"NaN"`，`±Infinity` → `"Infinity"` / `"-Infinity"`。信封导出侧
 * `"fontSize" to prefs.fontSize.toString()`（BackupManager.kt L60-61）用它序列化，
 * iOS 侧如果直接 `String(18)` 会得到 `"18"`，与安卓产物字节不同 —— 结构级对拍会挂。
 *
 * Kotlin 对整数值的 Float 输出 `x.0`（最短表示再加 `.0`）；非整数走最短往返十进制，
 * 与 JS `String()` 一致（本模块的取值域是字号 8..80 / 行高 8..120 量级，两者逐字相同）。
 */
export function kotlinFloatToString(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  if (Number.isInteger(value) && Math.abs(value) < 1e7) return `${value}.0`;
  return String(value);
}

/**
 * Kotlin `Base64.encodeToString(bytes, Base64.NO_WRAP)` ——
 * NO_WRAP 只是「不插换行」，`=` 填充仍然保留。
 */
export function encodeBase64NoWrap(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : undefined;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : undefined;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64_CHARS[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64_CHARS[b2 & 0x3f];
  }
  return out;
}

/**
 * Kotlin `Base64.decode(encoded, Base64.DEFAULT)` —— DEFAULT 是宽容模式：
 * 忽略空白、容忍 URL-safe 字母表（`-`/`_`）与缺失的填充。
 */
export function decodeBase64Default(encoded: string): Uint8Array {
  const clean = encoded.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (clean.length % 4)) % 4;
  const padded = clean + '='.repeat(padding);
  const out = new Uint8Array(Math.floor((padded.length / 4) * 3));
  let o = 0;
  for (let i = 0; i < padded.length; i += 4) {
    const n0 = B64_CHARS.indexOf(padded[i] as string);
    const n1 = B64_CHARS.indexOf(padded[i + 1] as string);
    const n2 = padded[i + 2] === '=' ? -1 : B64_CHARS.indexOf(padded[i + 2] as string);
    const n3 = padded[i + 3] === '=' ? -1 : B64_CHARS.indexOf(padded[i + 3] as string);
    if (n0 < 0 || n1 < 0) throw new Error('备份 archive 字段不是合法 base64');
    out[o] = ((n0 << 2) | (n1 >> 4)) & 0xff;
    o += 1;
    if (n2 >= 0) {
      out[o] = ((n1 << 4) | (n2 >> 2)) & 0xff;
      o += 1;
      if (n3 >= 0) {
        out[o] = ((n2 << 6) | n3) & 0xff;
        o += 1;
      }
    }
  }
  return out.slice(0, o);
}

/* ── 神回独立数组（Kotlin GodMomentRepository.kt L103-158） ── */

/** Kotlin `JSONObject.put(...)` 集合 —— 键名逐字照抄 L109-122。 */
export interface GodMomentJson {
  readonly id: number;
  readonly contentType: string;
  readonly bookId: string;
  readonly chapterId: string;
  readonly bookTitle: string;
  readonly chapterTitle: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly titleIsCustom: boolean;
  readonly rating: number;
  readonly note: string;
  readonly coverSource: string;
  readonly cropParams: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * Kotlin `GodMomentRepository.exportJson()`（L104-127）。
 *
 * **14 个字段，刻意不含 `coverPath`** —— 注释原文：「导出神回元数据为 JSON 数组
 * （不含封面位图，封面可重建）」。这正是 E79 的核心：走通用 `database.rows` 通道会
 * 带上 `coverPath`，而那一列在跨端恢复后指向对方设备的绝对路径，必然失效。
 */
export function exportGodMomentsJson(moments: readonly GodMoment[]): GodMomentJson[] {
  return moments.map((m) => ({
    id: m.id,
    contentType: m.contentType,
    bookId: m.bookId,
    chapterId: m.chapterId,
    bookTitle: m.bookTitle,
    chapterTitle: m.chapterTitle,
    chapterNumber: m.chapterNumber,
    title: m.title,
    titleIsCustom: m.titleIsCustom,
    rating: m.rating,
    note: m.note,
    coverSource: m.coverSource,
    cropParams: m.cropParams,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }));
}

export interface GodImportResult {
  readonly moments: GodMoment[];
  /** Kotlin L153-155：跳过 bookId/chapterId 为空的行，不计入 n。 */
  readonly skipped: number;
}

/**
 * Kotlin `GodMomentRepository.importJson(arr)`（L130-158）。
 *
 * 逐条照抄默认值：
 *  - `contentType` 缺省 `GodContentType.COMIC.code`（L137）
 *  - `rating` 缺省 5.0 且**始终** `coerceIn(0.5f, 5f)`（L145）
 *  - `coverPath = null`（L147，硬编码 null，不是缺省）
 *  - `coverSource` 缺省 `CoverSource.ComicPage().toTag()`（L148）
 *  - `cropParams` 缺省 `CropParams.DEFAULT.toTag()`（L149）
 *  - `createdAt` / `updatedAt` 缺省 `System.currentTimeMillis()`（L150-151）
 *  - `bookId`/`chapterId` 任一为空 → **跳过该行**（L153）
 */
export function importGodMomentsJson(
  rows: readonly unknown[],
  now: number,
): GodImportResult {
  const moments: GodMoment[] = [];
  let skipped = 0;
  for (const raw of rows) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const str = (key: string, fallback = ''): string => {
      const v = o[key];
      return typeof v === 'string' ? v : fallback;
    };
    const num = (key: string, fallback: number): number => {
      const v = o[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    };
    const bool = (key: string, fallback: boolean): boolean => {
      const v = o[key];
      return typeof v === 'boolean' ? v : fallback;
    };
    const bookId = str('bookId');
    const chapterId = str('chapterId');
    // Kotlin L153：`if (e.bookId.isBlank() || e.chapterId.isBlank()) continue`
    if (bookId.trim() === '' || chapterId.trim() === '') {
      skipped += 1;
      continue;
    }
    moments.push({
      // Kotlin L136 `id = 0` —— 强制走自增主键（bookId+chapterId 由 UNIQUE 约束覆盖）。
      id: 0,
      contentType: str('contentType', GOD_CONTENT_TYPE_COMIC) as GodMoment['contentType'],
      bookId,
      chapterId,
      bookTitle: str('bookTitle'),
      chapterTitle: str('chapterTitle'),
      chapterNumber: Math.trunc(num('chapterNumber', 0)),
      title: str('title'),
      titleIsCustom: bool('titleIsCustom', false),
      rating: Math.min(5, Math.max(0.5, num('rating', 5))),
      note: str('note'),
      // Kotlin L147：封面路径**不**从备份恢复（封面是本地缓存，可重建）。
      coverPath: null,
      coverSource: str('coverSource', COVER_SOURCE_COMIC_PAGE_DEFAULT),
      cropParams: str('cropParams', cropParamsToTag(DEFAULT_CROP_PARAMS)),
      createdAt: num('createdAt', now),
      updatedAt: num('updatedAt', now),
    });
  }
  return { moments, skipped };
}

/* ── 信封组装 / 解析 ── */

export interface BuildJsonBackupArgs {
  /** `exportBackupArchive` 产出的 ZIP 字节。 */
  readonly archiveBytes: Uint8Array;
  readonly booksCount: number;
  readonly preferences: Readonly<Partial<Record<JsonPreferenceKey, string>>>;
  /** Kotlin L56 `runCatching { exportJson() }.getOrNull()` —— 失败/为 null 则不写该键。 */
  readonly godMoments?: readonly GodMoment[] | null;
  readonly now: number;
}

/** Kotlin L50-80 `exportBackupJson`。 */
export function buildJsonBackup(args: BuildJsonBackupArgs): string {
  // Kotlin L53：超过 16 MiB 直接拒绝，并给出同一条中文文案。
  if (args.archiveBytes.byteLength > JSON_ARCHIVE_MAX_BYTES) {
    throw new Error('备份超过 JSON 容量，请使用 ZIP 备份接口');
  }
  const payload: Record<string, unknown> = {
    archive: encodeBase64NoWrap(args.archiveBytes),
    exportTime: args.now,
    booksCount: args.booksCount,
    preferences: { ...args.preferences },
  };
  // Kotlin L74 `.apply { if (godArray != null) put("godMoments", godArray) }`
  if (args.godMoments !== undefined && args.godMoments !== null) {
    payload['godMoments'] = exportGodMomentsJson(args.godMoments);
  }
  return JSON.stringify(payload);
}

export interface ParsedJsonBackup {
  readonly archiveBytes: Uint8Array | null;
  /** `archive` 缺失 ⇒ false（轻量路径）。 */
  readonly hasArchive: boolean;
  /**
   * `preferences` 键存在且为 JSON 对象 ⇒ true（Kotlin L91
   * `optJSONObject("preferences") ?: return@withContext false`：轻量路径上**没有**
   * preferences 对象 = 恢复失败）。注意它与 `preferences` 内容为空对象不同。
   */
  readonly hasPreferences: boolean;
  readonly preferences: Readonly<Partial<Record<JsonPreferenceKey, string>>>;
  readonly godMoments: readonly unknown[] | null;
}

/**
 * Kotlin L82-108 `restoreBackupJson` 的**解析**部分。
 *
 * 关键结构（L85-90）：`archive` 非空 ⇒ 整个 JSON 只是 ZIP 的载体，解 base64 还原成
 * ZIP 走 `restoreBackupArchive` 并**立即返回**；`preferences` 与 `godMoments` 在这条
 * 路径上**不参与**。只有 `archive` 缺失时才走 L91-103 的轻量恢复。
 */
export function parseJsonBackup(json: string): ParsedJsonBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('备份内容不是合法 JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('备份内容不是合法 JSON');
  }
  const o = parsed as Record<string, unknown>;
  const encodedRaw = o['archive'];
  const encoded = typeof encodedRaw === 'string' ? encodedRaw.trim() : '';
  const hasArchive = encoded !== '';
  if (hasArchive && encoded.length > JSON_ENCODED_MAX_CHARS) {
    // Kotlin L86 `require(encoded.length <= 24 * 1024 * 1024)`
    throw new Error('备份 archive 字段超过 24MiB');
  }
  const prefsRaw = o['preferences'];
  // Kotlin L91 `optJSONObject("preferences")`：键缺失、值为 null / 数组 / 标量时都返回
  // null —— 只有「存在且是对象」才进入轻量恢复。这一位标志交给编排层去决定失败。
  const hasPreferences =
    prefsRaw !== null && typeof prefsRaw === 'object' && !Array.isArray(prefsRaw);
  const preferences: Partial<Record<JsonPreferenceKey, string>> = {};
  if (hasPreferences) {
    for (const key of JSON_PREFERENCE_KEYS) {
      const v = (prefsRaw as Record<string, unknown>)[key];
      if (typeof v === 'string') preferences[key] = v;
    }
  }
  const godRaw = o['godMoments'];
  const godMoments = Array.isArray(godRaw) ? (godRaw as readonly unknown[]) : null;
  return {
    archiveBytes: hasArchive ? decodeBase64Default(encoded) : null,
    hasArchive,
    hasPreferences,
    preferences,
    godMoments,
  };
}

/* ── preferences 的取值与钳制（Kotlin L93-99） ── */

/** Kotlin L93 `toFloatOrNull()?.takeIf { it.isFinite() && it in 8f..80f }` */
export function readFontSize(
  prefs: Readonly<Partial<Record<JsonPreferenceKey, string>>>,
): number | null {
  const v = Number.parseFloat(prefs.fontSize ?? '');
  return Number.isFinite(v) && v >= 8 && v <= 80 ? v : null;
}
/** Kotlin L94 `8f..120f` */
export function readLineHeight(
  prefs: Readonly<Partial<Record<JsonPreferenceKey, string>>>,
): number | null {
  const v = Number.parseFloat(prefs.lineHeight ?? '');
  return Number.isFinite(v) && v >= 8 && v <= 120 ? v : null;
}
/** Kotlin L95 `0..5` */
export function readReaderTheme(
  prefs: Readonly<Partial<Record<JsonPreferenceKey, string>>>,
): number | null {
  const v = Number.parseInt(prefs.readerTheme ?? '', 10);
  return Number.isInteger(v) && v >= 0 && v <= 5 ? v : null;
}
/** Kotlin L96 `0..4` */
export function readPageTurnMode(
  prefs: Readonly<Partial<Record<JsonPreferenceKey, string>>>,
): number | null {
  const v = Number.parseInt(prefs.pageTurnMode ?? '', 10);
  return Number.isInteger(v) && v >= 0 && v <= 4 ? v : null;
}
/** Kotlin L97 `toBooleanStrictOrNull()` —— 只接受字面 `"true"` / `"false"`。 */
export function readSplashPureMode(
  prefs: Readonly<Partial<Record<JsonPreferenceKey, string>>>,
): boolean | null {
  const v = prefs.splashPureMode;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}
/** Kotlin L98 `0..2` */
export function readScreenOrientationLock(
  prefs: Readonly<Partial<Record<JsonPreferenceKey, string>>>,
): number | null {
  const v = Number.parseInt(prefs.screenOrientationLock ?? '', 10);
  return Number.isInteger(v) && v >= 0 && v <= 2 ? v : null;
}
/** Kotlin L99 `0..1440` */
export function readRestReminderMinutes(
  prefs: Readonly<Partial<Record<JsonPreferenceKey, string>>>,
): number | null {
  const v = Number.parseInt(prefs.restReminderMinutes ?? '', 10);
  return Number.isInteger(v) && v >= 0 && v <= 1440 ? v : null;
}