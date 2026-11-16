import { beforeEach, describe, expect, it } from 'vitest';
import { NativeImportPreferences } from '@platform/ios-native/importPreferences';
beforeEach(() => localStorage.clear());
function setup() {
  const values = new Map<string, string>([['ss:custom_source_ids', '["old"]'], ['source_enabled_old', 'false'], ['active_source_id', 'old'], ['privacy.pin.v1', 'PIN-SECRET'], ['js_source_data.old', 'COOKIE-SECRET']]);
  const secure = { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { values.set(key, value); }, remove: async (key: string) => { values.delete(key); } };
  return { values, prefs: new NativeImportPreferences(secure, localStorage, ['old', 'incoming', 'builtin']) };
}
describe('private native import preference snapshot', () => {
  it('captures old/new source-state slots and reader preferences without reading accounts or PINs', async () => {
    const { prefs } = setup(); localStorage.setItem('comic_reader_store:global_config', '{"theme":"old"}'); localStorage.setItem('god_moment_prefs', '{"ranking_style":"glass"}'); localStorage.setItem('account_token', 'OTHER-SECRET');
    const snapshot = await prefs.snapshot(), metadata = JSON.parse(snapshot.source_metadata!);
    expect(metadata.source_enabled_old).toBe('false'); expect(metadata.source_enabled_incoming).toBeNull(); expect(metadata.source_enabled_builtin).toBeNull();
    expect(JSON.stringify(snapshot)).not.toMatch(/SECRET|privacy\.pin|js_source_data/); expect(snapshot.god_moment_prefs).toContain('glass');
  });
  it('restores null source slots, removes new comic keys and preserves unrelated credentials', async () => {
    const { prefs, values } = setup(); localStorage.setItem('comic_reader_store:global_config', 'old'); const snapshot = await prefs.snapshot();
    values.set('source_enabled_incoming', 'true'); values.set('source_enabled_old', 'true'); values.set('active_source_id', 'incoming');
    localStorage.setItem('comic_reader_store:global_config', 'new'); localStorage.setItem('comic_reader_store:book_cfg_88', '{}'); localStorage.setItem('god_moment_prefs', '{}');
    await prefs.restore(snapshot);
    expect(localStorage.getItem('comic_reader_store:global_config')).toBe('old'); expect(localStorage.getItem('comic_reader_store:book_cfg_88')).toBeNull(); expect(localStorage.getItem('god_moment_prefs')).toBeNull();
    expect(values.get('source_enabled_old')).toBe('false'); expect(values.has('source_enabled_incoming')).toBe(false); expect(values.get('active_source_id')).toBe('old'); expect(values.get('privacy.pin.v1')).toBe('PIN-SECRET');
  });
  it('validates every restored key before touching any preference', async () => {
    const { prefs, values } = setup(); localStorage.setItem('comic_reader_store:global_config', 'old');
    await expect(prefs.restore({ 'comic_reader_store:global_config': 'changed', source_metadata: '{"privacy.pin.v1":"attacker"}' })).rejects.toThrow('未知存储');
    expect(localStorage.getItem('comic_reader_store:global_config')).toBe('old'); expect(values.get('privacy.pin.v1')).toBe('PIN-SECRET');
  });
});
