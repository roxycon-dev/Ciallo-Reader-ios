/**
 * Backup archive NDJSON format — port of Android `BackupArchive.kt` row encoding / parsing.
 *
 * First line: {"version":1,"schema":12}
 * Then:       {"table":"...","row":{...}}
 * filesDir path is replaced with @FILES@.
 */

import { BACKUP_TABLES } from '@core/db/schemaV12';

export const BACKUP_HEADER = { version: 1, schema: 12 } as const;

/**
 * Kotlin `BackupArchive.tables` (BackupArchive.kt lines 19..21) — the single source
 * of truth for the 12 archived tables and their **export order**. It now aliases
 * `BACKUP_TABLES` in `schemaV12.ts` instead of restating the list, so the export
 * order, the restore whitelist and the per-table column validation can never drift.
 */
export const BACKUP_TABLES_ORDER: readonly string[] = BACKUP_TABLES;

export const MAX_CONTENT_LENGTH = 256_000;
/**
 * Kotlin `BackupArchive.readBoundedLine` (BackupArchive.kt 194..203):
 *
 * ```kotlin
 * require(line.length < 512 * 1024) { "备份行过大" }
 * line.append(ch.toChar())
 * ```
 *
 * The guard runs **before** the append, so the longest line that can survive is
 * exactly `512 * 1024` chars: a 524 288-char line followed by `\n` is returned
 * normally, and only the 524 289-th character trips the guard. Hence the strict `>`
 * here — `>=` would reject the boundary line Kotlin still accepts.
 */
export const MAX_LINE_BYTES = 512 * 1024;
export const MAX_ROWS = 1_000_000;

export function encodeRowLine(table: string, row: Record<string, unknown>): string {
  return JSON.stringify({ table, row });
}

export function parseRowLine(line: string): { table: string; row: Record<string, unknown> } {
  const obj = JSON.parse(line) as { table?: unknown; row?: unknown };
  if (typeof obj.table !== 'string' || typeof obj.row !== 'object' || obj.row === null) {
    throw new Error('无效的备份行');
  }
  return { table: obj.table, row: obj.row as Record<string, unknown> };
}

/**
 * Split NDJSON text on LF; reject lines over the max line budget.
 *
 * Kotlin `readBoundedLine` terminates on char 10 only and treats every other byte —
 * including `\r` — as part of the line, so a CRLF archive keeps the `\r` inside the
 * record. Both `org.json.JSONObject` and `JSON.parse` tolerate trailing whitespace, so
 * this stays round-trip-safe either way; keeping it is what the Kotlin source does.
 */
export function parseBoundedLines(text: string): string[] {
  const raw = text.split('\n');
  const lines: string[] = [];
  const last = raw.length - 1;
  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i] ?? '';
    if (i === last && line === '') break;
    if (line.length > MAX_LINE_BYTES) {
      throw new Error('备份行过大');
    }
    lines.push(line);
  }
  return lines;
}

/** Export side: absolute files-dir prefix → `@FILES@` (Kotlin `c.getString(i).replace(root, "@FILES@")`). */
export function replaceFilesPath(value: string, filesRoot: string, placeholder = '@FILES@'): string {
  if (filesRoot === '') return value;
  return value.split(filesRoot).join(placeholder);
}

/**
 * Restore side of {@link replaceFilesPath} — Kotlin `BackupArchive.restore` line 175:
 * `is String -> value.replace("@FILES@", root)`.
 *
 * Without it the placeholder written at export time survives into the database as a
 * literal `@FILES@/…` path and every cover / import reference is dead on disk.
 * `filesRoot === ''` means the caller has no real root to point at (the `BackupService`
 * default), so the value is left untouched instead of being rewritten to a bare suffix.
 */
export function restoreFilesPath(value: string, filesRoot: string, placeholder = '@FILES@'): string {
  if (filesRoot === '') return value;
  return value.split(placeholder).join(filesRoot);
}
