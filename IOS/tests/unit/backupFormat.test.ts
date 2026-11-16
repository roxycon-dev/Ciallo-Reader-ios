import { describe, expect, it } from 'vitest';
import {
  BACKUP_HEADER,
  BACKUP_TABLES_ORDER,
  encodeRowLine,
  parseBoundedLines,
  parseRowLine,
  replaceFilesPath,
} from '../../src/core/backup/backupArchiveFormat';
import { isSafeSettingKey } from '../../src/core/backup/safeSetting';
import { settingType } from '../../src/core/backup/settingTypes';
import { validateRestoreHeader, validateRestoredRow } from '../../src/core/backup/backupArchive';

describe('backupArchiveFormat', () => {
  it('encodes and parses the header line', () => {
    const headerLine = JSON.stringify(BACKUP_HEADER);
    const obj = JSON.parse(headerLine) as { version: number; schema: number };
    expect(obj.version).toBe(1);
    expect(obj.schema).toBe(12);
    expect(() => validateRestoreHeader(obj)).not.toThrow();
    expect(() => validateRestoreHeader({ version: 1, schema: 11 })).toThrow();
    expect(() => validateRestoreHeader({})).toThrow();
  });

  it('encodes and parses row lines', () => {
    const line = encodeRowLine('books', { id: 1, title: '书' });
    const { table, row } = parseRowLine(line);
    expect(table).toBe('books');
    expect(row['id']).toBe(1);
    expect(row['title']).toBe('书');
  });

  it('parseBoundedLines splits on LF and drops trailing empty line', () => {
    const text = '{"version":1,"schema":12}\n{"table":"books","row":{}}\n';
    expect(parseBoundedLines(text)).toHaveLength(2);
    expect(parseBoundedLines('a\nb')).toEqual(['a', 'b']);
  });

  it('replaceFilesPath swaps files root for @FILES@', () => {
    expect(replaceFilesPath('/data/user/0/app/files/imports/a.txt', '/data/user/0/app/files')).toBe(
      '@FILES@/imports/a.txt',
    );
    expect(replaceFilesPath('plain', '/data/user/0/app/files')).toBe('plain');
  });

  it('table order matches schemaV12 backup list', () => {
    expect([...BACKUP_TABLES_ORDER]).toEqual([
      'books',
      'chapters',
      'bookmarks',
      'highlights',
      'categories',
      'reading_records',
      'reading_sessions',
      'favorites',
      'comic_progress',
      'comic_chapter_read',
      'favorite_categories',
      'god_moments',
    ]);
  });
});

describe('safeSetting', () => {
  it('excludes cookie_token and other secret keys', () => {
    expect(isSafeSettingKey('cookie_token')).toBe(false);
    expect(isSafeSettingKey('zlibrary_password')).toBe(false);
    expect(isSafeSettingKey('ai_api_key')).toBe(false);
    expect(isSafeSettingKey('pin_salt')).toBe(false);
    expect(isSafeSettingKey('auth_header')).toBe(false);
  });

  it('keeps normal preference keys', () => {
    expect(isSafeSettingKey('font_size')).toBe(true);
    expect(isSafeSettingKey('reader_theme')).toBe(true);
    expect(isSafeSettingKey('daily_read_time_2026-10-04')).toBe(true);
  });
});

describe('settingTypes + restored row validation', () => {
  it('maps known keys and daily_read_time dates to types', () => {
    expect(settingType('font_size')).toBe('float');
    expect(settingType('reader_theme')).toBe('int');
    expect(settingType('total_read_time_seconds')).toBe('long');
    expect(settingType('daily_read_time_2026-10-04')).toBe('long');
    expect(settingType('nope')).toBeNull();
  });

  it('validates column sets and types', () => {
    const columns = new Map<string, { type: string; notNull: boolean }>([
      ['id', { type: 'INTEGER', notNull: true }],
      ['title', { type: 'TEXT', notNull: false }],
    ]);
    expect(() => validateRestoredRow('books', { id: 1, title: 'x' }, columns)).not.toThrow();
    expect(() => validateRestoredRow('books', { id: 1 }, columns)).toThrow();
    expect(() => validateRestoredRow('books', { id: 'x', title: 'x' }, columns)).toThrow();
  });

  it('rejects oversized chapters content', () => {
    const columns = new Map<string, { type: string; notNull: boolean }>([
      ['content', { type: 'TEXT', notNull: true }],
    ]);
    const big = 'x'.repeat(256_001);
    expect(() => validateRestoredRow('chapters', { content: big }, columns)).toThrow();
  });
});
