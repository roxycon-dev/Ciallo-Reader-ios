import { describe, expect, it } from 'vitest';
import { SettingsRepository } from '../../src/core/settings/settingsRepository';
import { InMemorySqliteDatabase } from '../../src/platform/web-mock/inMemoryDb';

async function openRepo(): Promise<SettingsRepository> {
  const db = new InMemorySqliteDatabase();
  await db.open({ name: 'settings-test.db' });
  return new SettingsRepository(db);
}

describe('SettingsRepository', () => {
  it('returns Android defaults when keys are missing', async () => {
    const repo = await openRepo();
    expect(await repo.getBoolean('haptics_enabled')).toBe(true);
    expect(await repo.getFloat('font_size')).toBe(18);
    expect(await repo.getInt('reader_theme')).toBe(1);
    expect(await repo.getString('js_source_repo_url')).toContain('venera-configs');
    expect(await repo.getBoolean('splash_pure_mode', false)).toBe(false);
    expect(await repo.getInt('missing_key', 7)).toBe(7);
  });

  it('round-trips boolean, int, float, long, and string values', async () => {
    const repo = await openRepo();
    await repo.setBoolean('incognito_browsing_enabled', true);
    await repo.setInt('page_turn_mode', 4);
    await repo.setFloat('font_size', 22.5);
    await repo.setLong('total_read_time_seconds', 12345);
    await repo.setString('search_history_v1', '["诡秘之主"]');

    expect(await repo.getBoolean('incognito_browsing_enabled', false)).toBe(true);
    expect(await repo.getInt('page_turn_mode', 0)).toBe(4);
    expect(await repo.getFloat('font_size', 0)).toBe(22.5);
    expect(await repo.getLong('total_read_time_seconds', 0)).toBe(12345);
    expect(await repo.getString('search_history_v1', '[]')).toBe('["诡秘之主"]');
  });

  it('overwrites existing keys via upsert', async () => {
    const repo = await openRepo();
    await repo.setInt('reader_theme', 3);
    await repo.setInt('reader_theme', 5);
    expect(await repo.getInt('reader_theme', 0)).toBe(5);
  });

  it('getAll returns stored entries', async () => {
    const repo = await openRepo();
    await repo.setBoolean('keep_screen_on', false);
    await repo.setFloat('line_height', 32);
    const all = await repo.getAll();
    const keys = all.map((item) => item.key).sort();
    expect(keys).toEqual(['keep_screen_on', 'line_height']);
    expect(all.find((item) => item.key === 'line_height')?.value).toBe(32);
  });

  it('restoreSafeEntries replaces safe keys and keeps credential/unknown ones (E13)', async () => {
    const repo = await openRepo();
    await repo.setString('cookie_token', 'secret');
    await repo.setInt('reader_theme', 2);
    await repo.setString('custom_font_path', '/old/font.ttf');

    await repo.restoreSafeEntries([
      { key: 'reader_theme', type: 'int', value: 4 },
      { key: 'custom_font_path', type: 'string', value: '@FILES@/custom_font.ttf' },
      { key: 'font_size', type: 'float', value: 20 },
      { key: 'zlibrary_password', type: 'string', value: 'nope' },
      { key: 'no_such_setting', type: 'boolean', value: true },
    ]);

    expect(await repo.getInt('reader_theme', 0)).toBe(4);
    expect(await repo.getString('custom_font_path', '')).toBe('@FILES@/custom_font.ttf');
    expect(await repo.getFloat('font_size', 0)).toBe(20);
    // E13: `cookie_token` is not a safe key, so it is preserved (not wiped) on restore.
    expect(await repo.getString('cookie_token', '')).toBe('secret');
    expect(await repo.getString('zlibrary_password', '')).toBe('');
    expect(await repo.getBoolean('no_such_setting', false)).toBe(false);
  });

  it('rejects type mismatches and out-of-range ints on restore', async () => {
    const repo = await openRepo();
    await expect(
      repo.restoreSafeEntries([{ key: 'reader_theme', type: 'float', value: 1 }]),
    ).rejects.toThrow(/类型不符/);
    await expect(
      repo.restoreSafeEntries([{ key: 'page_turn_mode', type: 'int', value: 99 }]),
    ).rejects.toThrow(/越界/);
  });

  it('clamps font_size and line_height on restore', async () => {
    const repo = await openRepo();
    await repo.restoreSafeEntries([
      { key: 'font_size', type: 'float', value: 500 },
      { key: 'line_height', type: 'float', value: 1 },
    ]);
    expect(await repo.getFloat('font_size', 0)).toBe(80);
    expect(await repo.getFloat('line_height', 0)).toBe(8);
  });
});
