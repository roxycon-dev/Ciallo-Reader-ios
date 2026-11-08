/**
 * Backup format constants, tied to the Kotlin authority at runtime.
 *
 * `tests/unit/backupRoundTrip.test.ts` and `backupFormat.test.ts` already pin the
 * *behaviour* of `src/core/backup/**` against hand-written expectations. This file
 * closes the remaining hole: every constant, key list and regex in that package is
 * re-derived here **by parsing `novel-reader/app/src/main/java/com/example/data/BackupArchive.kt`
 * / `BackupManager.kt`**, so a later edit to either side cannot drift unnoticed.
 *
 * The Kotlin text is read from disk rather than transcribed — the same technique
 * `tests/unit/cjkFoldMapParity.test.ts` uses for the fold table.
 */
import { readFileSync } from 'node:fs';
import { androidReference } from '../helpers/androidReference';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_TABLES_ORDER,
  MAX_CONTENT_LENGTH,
  MAX_LINE_BYTES,
  MAX_ROWS,
} from '../../src/core/backup/backupArchiveFormat';
import {
  isOwnedFilesDir,
  BACKUP_ENTRY_MAX_BYTES,
  BACKUP_ENTRY_MAX_COUNT,
  BACKUP_TOTAL_MAX_BYTES,
  BACKUP_ZIP_ROWS_ENTRY,
  BACKUP_ZIP_SETTINGS_ENTRY,
} from '../../src/core/backup/backupArchive';
import {
  FLOAT_ABS_MAX,
  FLOAT_RANGES,
  INT_RANGES,
  SETTING_TYPES,
  settingType,
} from '../../src/core/backup/settingTypes';
import { SAFE_SETTING_EXCLUSION, isSafeSettingKey } from '../../src/core/backup/safeSetting';
import {
  JSON_ARCHIVE_MAX_BYTES,
  JSON_BACKUP_FILE_NAME,
  JSON_ENCODED_MAX_CHARS,
  JSON_PREFERENCE_KEYS,
} from '../../src/core/backup/backupManagerJson';

const BACKUP_ARCHIVE_KT = readFileSync(androidReference('app/src/main/java/com/example/data/BackupArchive.kt'), 'utf8');
const BACKUP_MANAGER_KT = readFileSync(androidReference('app/src/main/java/com/example/data/BackupManager.kt'), 'utf8');

/** All quoted string literals of a `listOf("a","b", …)` argument list. */
function listOfLiterals(text: string, call: string): string[] {
  const start = text.indexOf(call);
  if (start < 0) throw new Error(`kotlin call not found: ${call}`);
  const open = text.indexOf('(', start);
  const close = text.indexOf(')', open);
  const body = text.slice(open + 1, close);
  return [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1] as string);
}

describe('BackupArchive.kt — the archived table list', () => {
  it('BACKUP_TABLES_ORDER is the Kotlin `tables = listOf(…)`, in order', () => {
    const kotlinTables = listOfLiterals(
      BACKUP_ARCHIVE_KT,
      'val tables = listOf(',
    );
    expect(kotlinTables).toHaveLength(12);
    expect([...BACKUP_TABLES_ORDER]).toEqual(kotlinTables);
  });

  it('the two archive entry names are the Kotlin literals', () => {
    expect(BACKUP_ZIP_ROWS_ENTRY).toBe('database.rows');
    expect(BACKUP_ZIP_SETTINGS_ENTRY).toBe('settings.json');
    expect(BACKUP_ARCHIVE_KT).toContain('entry("database.rows", stage)');
    expect(BACKUP_ARCHIVE_KT).toContain('zip.putNextEntry(ZipEntry("settings.json"))');
    // …and the zip whitelist on the restore side names the same two.
    expect(BACKUP_ARCHIVE_KT).toContain(
      'require(entry.name == "database.rows" || entry.name == "settings.json" || entry.name.startsWith("files/"))',
    );
  });
});

describe('BackupArchive.kt — `ownedNames` / `owned(name)`', () => {
  it('mirrors the 12 Kotlin directory names verbatim', () => {
    const kotlinNames = listOfLiterals(BACKUP_ARCHIVE_KT, 'private val ownedNames = setOf(');
    expect(kotlinNames).toEqual([
      'imports',
      'epub_images',
      'docx_images',
      'fb2_images',
      'mobi_images',
      'epub_covers',
      'fb2_covers',
      'mobi_covers',
      'comic_covers',
      'god_covers',
      'sample_comic',
      'chapter_catalogs',
    ]);
    for (const name of kotlinNames) {
      expect(isOwnedFilesDir(name), `owned("${name}") must be true`).toBe(true);
    }
  });

  it('mirrors the six Kotlin name prefixes verbatim', () => {
    // `owned(name) = name in ownedNames || name.startsWith("comics_") || …`
    const ownedLine = BACKUP_ARCHIVE_KT.split('\n').find((l) => l.includes('private fun owned(name'));
    expect(ownedLine).toBeDefined();
    const prefixes = [...(ownedLine ?? '').matchAll(/startsWith\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(prefixes).toEqual([
      'comics_',
      'restored_',
      'custom_poster_',
      'custom_background_',
      'custom_app_bg_',
      'custom_font_',
    ]);
    for (const prefix of prefixes) {
      expect(isOwnedFilesDir(`${prefix}whatever`)).toBe(true);
      expect(isOwnedFilesDir('x_whatever')).toBe(false);
    }
  });

  it('rejects names that are neither listed nor prefixed', () => {
    expect(isOwnedFilesDir('databases')).toBe(false);
    expect(isOwnedFilesDir('shared_prefs')).toBe(false);
    expect(isOwnedFilesDir('')).toBe(false);
  });
});

describe('BackupArchive.kt — safeSetting', () => {
  it('uses the same regex body and case-insensitivity as the Kotlin Regex', () => {
    // Kotlin: Regex("(?i)(cookie|token|password|credential|secret|api.?key|pin_|salt|auth)")
    // The `(?i)` inline flag is Kotlin's spelling of the JS `/i` flag; the body that
    // follows it must be the same text, capture group included.
    const match = /Regex\("\(\?i\)(\([^"]*\))"\)/.exec(BACKUP_ARCHIVE_KT);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(SAFE_SETTING_EXCLUSION.source);
    expect(SAFE_SETTING_EXCLUSION.flags).toBe('i');
    // The Kotlin helper is a plain substring match, not a whole-key match.
    expect(BACKUP_ARCHIVE_KT).toContain('.containsMatchIn(key)');
  });

  it('separates the same keys the Kotlin filter separates', () => {
    for (const key of ['Cookie', 'AUTH_TOKEN', 'user_password', 'apiKey', 'pin_hash', 'salt_v2']) {
      expect(isSafeSettingKey(key), key).toBe(false);
    }
    for (const key of ['font_size', 'reader_theme', 'custom_source_ids', 'total_read_time_seconds']) {
      expect(isSafeSettingKey(key), key).toBe(true);
    }
  });
});

describe('BackupArchive.kt — settingTypes', () => {
  /** Kotlin `listOf(...).forEach { put(it,"<type>") }` blocks. */
  const kotlinGroups = (): Array<{ type: string; keys: string[] }> => {
    const out: Array<{ type: string; keys: string[] }> = [];
    const re = /listOf\(([^)]*)\)\.forEach \{ put\(it,"(\w+)"\) \}/g;
    for (const m of BACKUP_ARCHIVE_KT.matchAll(re)) {
      const keys = [...(m[1] ?? '').matchAll(/"([^"]*)"/g)].map((x) => x[1] as string);
      out.push({ type: m[2] as string, keys });
    }
    return out;
  };

  it('declares exactly five type groups (boolean / float / int / long / string)', () => {
    expect(kotlinGroups().map((g) => g.type)).toEqual(['boolean', 'float', 'int', 'long', 'string']);
  });

  it('map of SETTING_TYPES equals the Kotlin buildMap entry for entry', () => {
    const expected: Record<string, string> = {};
    for (const group of kotlinGroups()) {
      for (const key of group.keys) expected[key] = group.type;
    }
    // 21 boolean + 15 float + 18 int + 2 long + 5 string = 61 keys.
    expect(Object.keys(expected)).toHaveLength(61);
    expect(SETTING_TYPES).toEqual(expected);
  });

  it('settingType falls back to "long" only for the daily_read_time_YYYY-MM-DD shape', () => {
    // Kotlin: "long".takeIf { Regex("daily_read_time_\\d{4}-\\d{2}-\\d{2}").matches(key) }
    // The Kotlin literal is `\\d` (an escaped backslash), i.e. the regex body is `\d`.
    const daily = /Regex\("daily_read_time_([^"]*)"\)/.exec(BACKUP_ARCHIVE_KT);
    expect(daily).not.toBeNull();
    expect((daily?.[1] ?? '').replaceAll('\\\\', '\\')).toBe(
      '\\d{4}-\\d{2}-\\d{2}',
    );
    expect(settingType('daily_read_time_2026-01-31')).toBe('long');
    expect(settingType('daily_read_time_2026-1-31')).toBeNull();
    expect(settingType('daily_read_time_20260131')).toBeNull();
    expect(settingType('unknown_key')).toBeNull();
  });
});

describe('BackupArchive.kt — the numeric budgets', () => {
  it('per-entry 512 MB / total 4 GB / 50 000 entries match the Kotlin literals', () => {
    // Kotlin L69:  require(file.length() <= 512L*1024*1024 && expanded + file.length() <= 4L*1024*1024*1024)
    expect(BACKUP_ARCHIVE_KT).toContain('512L*1024*1024');
    expect(BACKUP_ARCHIVE_KT).toContain('4L*1024*1024*1024');
    expect(BACKUP_ENTRY_MAX_BYTES).toBe(512 * 1024 * 1024);
    expect(BACKUP_TOTAL_MAX_BYTES).toBe(4 * 1024 * 1024 * 1024);
    // Kotlin L103:  require(entry.name.length<=1024 && seen.size<50_000)
    expect(BACKUP_ARCHIVE_KT).toContain('seen.size<50_000');
    expect(BACKUP_ENTRY_MAX_COUNT).toBe(50_000);
  });

  it('the 512 KiB line budget matches `readBoundedLine`', () => {
    // Kotlin L200:  require(line.length < 512 * 1024) { "备份行过大" }
    expect(BACKUP_ARCHIVE_KT).toContain('require(line.length < 512 * 1024)');
    expect(MAX_LINE_BYTES).toBe(512 * 1024);
  });

  it('the chapter content cap and the row cap match', () => {
    // Kotlin L163:  require(row.getString("content").length<=256_000)
    expect(BACKUP_ARCHIVE_KT).toContain('length<=256_000');
    expect(MAX_CONTENT_LENGTH).toBe(256_000);
    // Kotlin L158:  require(++rowCount <= 1_000_000)
    expect(BACKUP_ARCHIVE_KT).toContain('++rowCount <= 1_000_000');
    expect(MAX_ROWS).toBe(1_000_000);
  });

  it('the backup header is version 1 / schema 12', () => {
    // Kotlin L47 and L153.
    expect(BACKUP_ARCHIVE_KT).toContain('JSONObject().put("version", 1).put("schema", 12)');
    expect(BACKUP_ARCHIVE_KT).toContain(
      'require(header.getInt("version") == 1 && header.getInt("schema") == 12)',
    );
  });
});

describe('BackupArchive.kt — the setting ranges applied on restore', () => {
  it('INT_RANGES equals the Kotlin `when(key)` table', () => {
    // Kotlin L135:
    //   "reader_theme" -> 0..5; "page_turn_mode" -> 0..4; "screen_orientation_lock" -> 0..2;
    //   "font_family_index" -> 0..20; "app_background_mode" -> 0..1; "app_background_dim" -> 0..50;
    //   "daily_goal_minutes","rest_reminder_minutes" -> 0..1440; else -> Int.MIN_VALUE..Int.MAX_VALUE
    // One `->` branch may list several comma-separated keys (daily_goal_minutes and
    // rest_reminder_minutes share 0..1440), so capture the whole key list.
    const ranges: Record<string, { min: number; max: number }> = {};
    for (const m of BACKUP_ARCHIVE_KT.matchAll(
      /((?:"[a-z_]+",?\s*)+) -> (\d+)\.\.(\d+)/g,
    )) {
      for (const key of [...(m[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((k) => k[1] as string)) {
        ranges[key] = { min: Number(m[2]), max: Number(m[3]) };
      }
    }
    expect(Object.keys(ranges)).toHaveLength(8);
    expect(INT_RANGES).toEqual(ranges);
  });

  it('FLOAT_RANGES and the ±10 000 sanity bound match', () => {
    const floats: Record<string, { min: number; max: number }> = {};
    for (const m of BACKUP_ARCHIVE_KT.matchAll(
      /"([a-z_]+)" -> number\.coerceIn\(([\d.]+)f,\s*([\d.]+)f\)/g,
    )) {
      floats[m[1] as string] = { min: Number(m[2]), max: Number(m[3]) };
    }
    expect(floats).toEqual({ font_size: { min: 8, max: 80 }, line_height: { min: 8, max: 120 } });
    expect(FLOAT_RANGES).toEqual(floats);
    // Kotlin L141:  require(number.isFinite() && kotlin.math.abs(number)<=10_000)
    expect(BACKUP_ARCHIVE_KT).toContain('abs(number)<=10_000');
    expect(FLOAT_ABS_MAX).toBe(10_000);
  });

  it('the string-set cap is 10 000 (Kotlin L145)', () => {
    expect(BACKUP_ARCHIVE_KT).toContain('require(a.length()<=10000)');
  });
});

describe('BackupManager.kt — the JSON envelope', () => {
  it('keeps the 16 MiB archive cap and the 24 MiB encoded cap', () => {
    // Kotlin L53 / L86.
    expect(BACKUP_MANAGER_KT).toContain('require(archive.length() <= 16L * 1024 * 1024)');
    expect(BACKUP_MANAGER_KT).toContain('require(encoded.length <= 24 * 1024 * 1024)');
    expect(JSON_ARCHIVE_MAX_BYTES).toBe(16 * 1024 * 1024);
    expect(JSON_ENCODED_MAX_CHARS).toBe(24 * 1024 * 1024);
  });

  it('writes the payload to novel_reader_backup.json', () => {
    expect(BACKUP_MANAGER_KT).toContain('File(context.filesDir, "novel_reader_backup.json")');
    expect(JSON_BACKUP_FILE_NAME).toBe('novel_reader_backup.json');
  });

  it('carries the same seven preference keys, in the same order', () => {
    // Kotlin L59-67: the ZIP channel uses snake_case settings keys; this map is
    // deliberately camelCase — do not "unify" them.
    const keys = [...BACKUP_MANAGER_KT.matchAll(/^\s{16}"([A-Za-z]+)" to prefs\./gm)].map(
      (m) => m[1] as string,
    );
    expect(keys).toEqual([
      'fontSize',
      'lineHeight',
      'readerTheme',
      'pageTurnMode',
      'splashPureMode',
      'screenOrientationLock',
      'restReminderMinutes',
    ]);
    expect([...JSON_PREFERENCE_KEYS]).toEqual(keys);
  });

  it('applies the same per-key clamps when restoring preferences', () => {
    // Kotlin L93-99: 8f..80f / 8f..120f / 0..5 / 0..4 / toBooleanStrictOrNull / 0..2 / 0..1440
    expect(BACKUP_MANAGER_KT).toContain('it in 8f..80f');
    expect(BACKUP_MANAGER_KT).toContain('it in 8f..120f');
    expect(BACKUP_MANAGER_KT).toContain('it in 0..5');
    expect(BACKUP_MANAGER_KT).toContain('it in 0..4');
    expect(BACKUP_MANAGER_KT).toContain('it in 0..2');
    expect(BACKUP_MANAGER_KT).toContain('it in 0..1440');
  });
});
