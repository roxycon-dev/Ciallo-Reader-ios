import { describe, expect, it } from 'vitest';
import { mergePortableSettings, relocateComicSettingKey, validatePortableSettings, type PortableSettingEntries } from '@core/transfer/portableSettings';

describe('portable settings trust boundary and merge', () => {
  it.each([
    { secure: { pin: '123456' } }, { novel_reader_prefs: { favorites_protected: { type: 'boolean', value: false } } },
    { novel_reader_prefs: { privacy_pin: { type: 'string', value: '123456' } } }, { novel_reader_prefs: { font_size: { type: 'float', value: 300 } } },
    { novel_reader_prefs: { reader_theme: { type: 'int', value: 99 } } }, { novel_reader_prefs: { keep_screen_on: { type: 'boolean', value: 'false' } } },
    { sources: { source: { headers: { Authorization: 'Bearer private' } } } }, { sources: { source: { url: 'https://user:private@example.com' } } },
    { source_states: { source: 'false' } }, { comic_reader_store: { presets: { type: 'string', value: '{}' } } },
  ])('rejects private stores, invalid values and credential-bearing source definitions', (value) => {
    expect(() => validatePortableSettings(value)).toThrow();
  });
  it('accepts only typed settings, public source definitions and ordinary reader state', () => {
    const value = { novel_reader_prefs: { font_size: { type: 'float', value: 22 } }, comic_reader_store: { book_state_7: { type: 'string', value: '{"page":2}' } },
      sources: { public: { name: '公开源', url: 'https://example.org' } }, source_states: { public: true }, active_source: 'public', god: { ranking_style: 'podium', last_page_hint: true, gyro_parallax: false } };
    expect(validatePortableSettings(value)).toEqual(value);
  });
  it('keeps local credentials, PIN protection and derived statistics when replacing reader settings', () => {
    const existing: PortableSettingEntries = { font_size: { type: 'float', value: 18 }, favorites_protected: { type: 'boolean', value: true }, private_account: { type: 'string', value: 'local-only' }, total_read_time_seconds: { type: 'long', value: 99 }, daily_read_time_2026: { type: 'long', value: 50 } };
    const incoming = validatePortableSettings({ novel_reader_prefs: { font_size: { type: 'float', value: 24 }, total_read_time_seconds: { type: 'long', value: 99999 } } }).novel_reader_prefs!;
    const output = mergePortableSettings(existing, incoming, 'novel_reader_prefs', 'REPLACE', new Map());
    expect(output.font_size?.value).toBe(24); expect(output.favorites_protected?.value).toBe(true); expect(output.private_account?.value).toBe('local-only'); expect(output.total_read_time_seconds?.value).toBe(99);
    expect(existing.font_size?.value).toBe(18);
  });
  it('relocates numeric book references without touching online identities and skips absent parents', () => {
    const ids = new Map([[7, 19]]); expect(relocateComicSettingKey('book_cfg_7', ids)).toBe('book_cfg_19'); expect(relocateComicSettingKey('resume_7_chapter', ids)).toBe('resume_19_chapter');
    expect(relocateComicSettingKey('book_state_8', ids)).toBeNull(); expect(relocateComicSettingKey('book_cfg_source::7', ids)).toBe('book_cfg_source::7');
    expect(relocateComicSettingKey('book_cfg_70', ids)).toBeNull();
  });
  it('merges presets by stable id while preserving local values and relocated book state', () => {
    const existing: PortableSettingEntries = { presets: { type: 'string', value: '[{"id":"same","name":"本机"}]' }, global_config: { type: 'string', value: '{"zoom":1}' } };
    const incoming = validatePortableSettings({ comic_reader_store: { presets: { type: 'string', value: '[{"id":"same","name":"传入"},{"id":"new","name":"新预设"},{"id":"new","name":"重复"}]' }, book_state_7: { type: 'string', value: '{"page":3}' }, book_state_8: { type: 'string', value: '{"page":4}' } } }).comic_reader_store!;
    const merged = mergePortableSettings(existing, incoming, 'comic_reader_store', 'MERGE', new Map([[7, 19]]));
    expect(JSON.parse(merged.presets!.value as string)).toEqual([{ id: 'same', name: '本机' }, { id: 'new', name: '新预设' }]); expect(merged.book_state_19?.value).toBe('{"page":3}'); expect(merged).not.toHaveProperty('book_state_8'); expect(merged.global_config?.value).toBe('{"zoom":1}');
  });
});
