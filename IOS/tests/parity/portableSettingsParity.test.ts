/**
 * portableSettingsParity.test.ts —— `transfer/PortableSettings.kt`（**141 行 / 138 非空**）。
 *
 * 端口的存储模型是既定的平台适配（`SharedPreferences` → `app_settings` 行 + `comic_reader_store:`
 * 前缀的 localStorage），这一层不改；本轮逐条对拍的是**判定与文案**，并修掉三处方向性错误：
 *
 *   ① 书源单条的 2 MiB 上限：Kotlin L90 是 `toString().length`（**字符数**），端口用
 *      `stringBytes`（UTF-8 字节）—— 一个字符数 1.9 M / 字节数 5.7 M 的中文书源定义
 *      在 Android 侧能进，在端口里会被拒。
 *   ② `书源无效或含认证字段` 把 Kotlin 的两条 `require`（L90 无 message、L91「书源含认证字段」）
 *      合成了一条，于是「长度/格式不对」也报成「含认证字段」。
 *   ③ 端口自造了 `500` 条书源与 `2000` 条 source_states 的上限，Kotlin 完全没有 ——
 *      重用户（书源上百、状态上千）的合法归档会被拒。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  mergePortableSettings,
  portableComicKey,
  portableCounterKey,
  portableNovelKey,
  portableResourceKey,
  relocateComicSettingKey,
  validatePortableSettings,
  type PortableSettingEntries,
} from '@core/transfer/portableSettings';
import { PORTABLE_METADATA_MAX_BYTES } from '@core/transfer/portableFormat';
import { isAcceptableFloat, settingType } from '@core/backup/settingTypes';
import { isSafeSettingKey } from '@core/backup/safeSetting';

import { androidReference } from '../helpers/androidReference';

function kt(rel: string): string {
  return readFileSync(androidReference(`app/src/main/java/com/example/${rel}`), 'utf8');
}

function repoText(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const KT = 'transfer/PortableSettings.kt';
const TS = 'src/core/transfer/portableSettings.ts';

/* ══════════════════════════════════════════════════════════════════════════════
   ① PortableSettings.kt L12-16 三个常量与敏感正则
   ══════════════════════════════════════════════════════════════════════════════ */

describe('PortableSettings.kt L12-16 常量', () => {
  const src = kt(KT);

  it('L12 注释「Only named, typed settings cross the device boundary. Private script stores never do.」', () => {
    expect(src).toContain(
      '/** Only named, typed settings cross the device boundary. Private script stores never do. */',
    );
  });

  it('L14 `stores` 三个名字，**顺序**决定 `stores[0]` / `stores[1]` / `take(2)`', () => {
    expect(src).toContain('val stores = listOf("novel_reader_prefs", "comic_reader_store", "book_sources_config")');
    const ts = repoText(TS);
    expect(ts).toContain("const TOP_LEVEL = new Set(['novel_reader_prefs', 'comic_reader_store', 'god', 'sources', 'scripts', 'source_states', 'active_source']);");
    // 本文件里 `stores` 只被这样读：`stores[0]` / `stores[1]` / `stores.take(2)`
    expect(src).toContain('context.getSharedPreferences(stores[0], 0).all');
    expect(src).toContain('context.getSharedPreferences(stores[1], 0).all');
    expect(src).toContain('for (name in stores.take(2))');
    expect(src).toContain('if (name == stores[0])');
    /*
     * 第三个名字**从不被索引**：L54 的源站走的是 `SharedPreferencesSourceStorage(context)`，
     * 书源不进 settings 信封。端口同理 —— `portableSettings.ts` 里没有 `book_sources_config`，
     * 那个名字只出现在 `importJournalLayout.ts` 的 `PORTABLE_SETTINGS_STORES` 里。
     */
    expect(src).not.toContain('stores[2]');
    expect(ts).not.toContain('book_sources_config');
    expect(repoText('src/core/transfer/importJournalLayout.ts')).toContain("'book_sources_config',");
  });

  it('L15 `comicKeys` 四个键逐字', () => {
    expect(src).toContain('private val comicKeys = setOf("global_config", "presets", "default_preset", "custom_fit_presets")');
    expect(repoText(TS)).toContain("const COMIC_KEYS = new Set(['global_config', 'presets', 'default_preset', 'custom_fit_presets']);");
  });

  it('L16 敏感正则的七个词与两处 `.?` 逐字（忽略大小写）', () => {
    expect(src).toContain('private val sensitive = Regex("(?i)(cookie|authorization|credential|password|secret|api.?key|access.?token|refresh.?token)")');
    const sensitive = /(cookie|authorization|credential|password|secret|api.?key|access.?token|refresh.?token)/i;
    for (const hit of ['Cookie', 'AUTHORIZATION', 'credential', 'passWord', 'secret', 'apiKey', 'api_key', 'accessToken', 'refresh-token']) {
      expect(sensitive.test(hit)).toBe(true);
    }
    // `.?` 是「可选的一个任意字符」，所以 `api` + (无) + `key` 命中 `apikeyish`，`apiXkey` 也命中
    expect(sensitive.test('apikeyish')).toBe(true);
    expect(sensitive.test('apiXkey')).toBe(true);
    // 而 `access.?token` 需要 `access` 前缀，`tokenization` 不命中
    expect(sensitive.test('tokenization')).toBe(false);
    expect(sensitive.test('keynote')).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② PortableSettings.kt L17-21 encode / L22-37 write
   ══════════════════════════════════════════════════════════════════════════════ */

describe('PortableSettings.kt L17-21 `encode` 的类型标签', () => {
  const src = kt(KT);

  it('L18 null 值整条跳过（不写 type 也不写 value）', () => {
    expect(src).toContain('values.forEach { (key, value) -> if (value != null) put(key, JSONObject()');
  });

  it('L19 六支 `when`：boolean / int / long / float / set / else string', () => {
    expect(src).toContain('is Boolean -> "boolean"; is Int -> "int"; is Long -> "long"; is Float -> "float"; is Set<*> -> "set"; else -> "string"');
  });

  it('L20 `Set` 先转成 JSONArray，其余原样', () => {
    expect(src).toContain('.put("value", if (value is Set<*>) JSONArray(value.toList()) else value)) }');
  });

  it('`settingType()` **永远不会**返回 "set" —— `set` 两支在便携路径上是死代码', () => {
    const archive = kt('data/BackupArchive.kt');
    // 类型表只由五个列表拼成；`"set"` 只出现在 encode 与备份恢复里
    expect(archive).toContain('internal fun settingType(key: String) = settingTypes[key] ?: "long".takeIf {');
    expect(archive).toContain('is Set<*> -> "set"');
    expect(archive).toContain('"set" -> { val a=item.getJSONArray("value"); require(a.length()<=10000); editor.putStringSet(');
    // 便携路径的 validate 要求 type 严格等于 settingType(key)，所以 "set" 进不来
    expect(src).toContain('require(item.getString("type") == BackupArchive.settingType(key)) { tr("设置类型不符") }');
    // 端口同样没有任何键被判定成 set
    expect(settingType('favorites_protected')).toBe('boolean');
    expect(settingType('font_size')).toBe('float');
    expect(repoText('src/core/backup/settingTypes.ts')).not.toContain("'set'");
  });
});

describe('PortableSettings.kt L22-37 `write`', () => {
  const src = kt(KT);

  it('L24 `replace` 时先 `edit.clear()`', () => {
    expect(src).toContain('if (replace) edit.clear()');
  });

  it('L26-34 六支写入；float 有 `require(it.isFinite())`（无 message）', () => {
    expect(src).toContain('"boolean" -> edit.putBoolean(key, item.getBoolean("value"))');
    expect(src).toContain('"int" -> edit.putInt(key, item.getInt("value"))');
    expect(src).toContain('"long" -> edit.putLong(key, item.getLong("value"))');
    expect(src).toContain('"float" -> edit.putFloat(key, item.getDouble("value").toFloat().also { require(it.isFinite()) })');
    expect(src).toContain('"string" -> edit.putString(key, item.getString("value"))');
    expect(src).toContain('"set" -> edit.putStringSet(key, item.getJSONArray("value").let { a ->');
    expect(src).toContain('else -> error(tr("不支持的设置类型"))');
  });

  it('L36 `check(edit.commit()) { "设置保存失败" }` —— 失败要抛，不能静默', () => {
    expect(src).toContain('check(edit.commit()) { "设置保存失败" }');
    // 文案已在词表里（它是 tr 过的）
    expect(repoText('src/core/i18n/strings.ts')).toContain('["不支持的设置类型",');
  });

  it('端口把这一层换成 `app_settings` 行的 `put(key, {type, value})`（E215 登记的结构适配）', () => {
    const platform = repoText('src/platform/ios-native/archiveSettings.ts');
    expect(platform).toContain("await database.execute('INSERT OR REPLACE INTO app_settings (key,type,value) VALUES (?,?,?)', [key, setting.type, JSON.stringify(setting.value)]);");
    expect(platform).toContain("for (const key of Object.keys(existing)) if (!Object.hasOwn(merged, key)) await database.execute('DELETE FROM app_settings WHERE key=?', [key]);");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ PortableSettings.kt L38-67 export 的四道过滤
   ══════════════════════════════════════════════════════════════════════════════ */

describe('PortableSettings.kt L38-67 export', () => {
  const src = kt(KT);

  it('L40 `SETTINGS in categories || RESOURCES in categories` 才进这一段', () => {
    expect(src).toContain('if (TransferCategory.SETTINGS in selection.categories || TransferCategory.RESOURCES in selection.categories) {');
    expect(repoText('src/platform/ios-native/archiveExportSettings.ts')).toContain(
      "if (!portableNovelKey(item.key) || portableCounterKey(item.key) || !categories.has(portableResourceKey(item.key) ? 'RESOURCES' : 'SETTINGS')) continue;",
    );
  });

  it('L42-45 四个排除键 + `daily_read_time_` 前缀 + 三个资源键只属于 RESOURCES', () => {
    expect(src).toContain('key !in setOf("favorites_protected", "total_read_time_seconds", "legacy_unattributed_read_seconds", "reading_totals_reconciled_v1") &&');
    expect(src).toContain('!key.startsWith("daily_read_time_")');
    expect(src).toContain('key in setOf("custom_splash_poster_uri","custom_app_background_uri","custom_font_path")');
    // 端口：三组键名逐字
    const ts = repoText(TS);
    expect(ts).toContain("const RESOURCE_KEYS = new Set(['custom_splash_poster_uri', 'custom_app_background_uri', 'custom_font_path']);");
    expect(ts).toContain("const TOTAL_KEYS = new Set(['total_read_time_seconds', 'legacy_unattributed_read_seconds', 'reading_totals_reconciled_v1']);");
    expect(portableResourceKey('custom_font_path')).toBe(true);
    expect(portableResourceKey('font_size')).toBe(false);
    // 三个累计键与 daily_ 前缀都算「计数器」
    expect(portableCounterKey('total_read_time_seconds')).toBe(true);
    expect(portableCounterKey('reading_totals_reconciled_v1')).toBe(true);
    expect(portableCounterKey('daily_read_time_2026-01-02')).toBe(true);
    expect(portableCounterKey('font_size')).toBe(false);
  });

  it('L48-50 漫画 store 只在 SETTINGS 下导出；键 = 四个固定键 或 选中书的三类键', () => {
    expect(src).toContain('if(TransferCategory.SETTINGS in selection.categories) output.put(stores[1], encode(context.getSharedPreferences(stores[1], 0).all.filterKeys { key ->');
    expect(src).toContain('key in comicKeys || selectedBookKeys.any { key == "book_cfg_$it" || key == "book_state_$it" || key.startsWith("resume_${it}_") }');
    const platform = repoText('src/platform/ios-native/archiveExportSettings.ts');
    expect(platform).toContain("const fullKey = context.storage.key(index); if (!fullKey?.startsWith('comic_reader_store:')) continue;");
    expect(platform).toContain('const key = fullKey.slice(19); if (!portableComicKey(key)) continue;');
    expect(platform).toContain(
      "const allowed = ['global_config', 'presets', 'default_preset', 'custom_fit_presets'].includes(key) || [...context.selectedBookKeys].some((id) => key === `book_cfg_${id}` || key === `book_state_${id}` || key === `resume_${id}` || key.startsWith(`resume_${id}_`));",
    );
    // `comic_reader_store:` 恰好 19 字符 —— `slice(19)` 不是魔法数
    expect('comic_reader_store:'.length).toBe(19);
  });

  it('L51 `god` 也只在 SETTINGS 下导出', () => {
    expect(src).toContain('if(TransferCategory.SETTINGS in selection.categories) output.put("god", com.example.god.GodMomentSettingsStore(context).exportPortable())');
  });

  it('L56-60 含凭据的书源**整条跳过**并写警告，不做「猜一处脱敏」', () => {
    expect(src).toContain('// Opaque rule strings can contain credentials; skip the entire source rather than guessing a redaction.');
    expect(src).toContain('if (sensitive.containsMatchIn(body) || Regex("(?i)https?://[^/\\\\s]+:[^/@\\\\s]+@").containsMatchIn(body)) warnings.add("书源 $id 含认证字段，未发送")');
    expect(src).toContain('else custom.put(id, JSONObject(body))');
  });

  it('L61-64 sources / scripts / source_states / active_source 四个键名', () => {
    expect(src).toContain('output.put("sources", custom)');
    expect(src).toContain('output.put("scripts",com.example.source.js.JsSourceRepo.exportPortable(context,warnings))');
    expect(src).toContain('output.put("source_states", JSONObject(storage.getSourceStates()))');
    expect(src).toContain('storage.getActiveSourceId()?.let { output.put("active_source", it) }');
    const ts = repoText(TS);
    for (const key of ["'sources'", "'scripts'", "'source_states'", "'active_source'"]) {
      expect(ts).toContain(key);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ PortableSettings.kt L68-95 validate
   ══════════════════════════════════════════════════════════════════════════════ */

describe('PortableSettings.kt L69-81 novel_reader_prefs 的校验', () => {
  const src = kt(KT);

  it('L70 三条：`safeSetting` + `settingType != null` + 不是 `favorites_protected`', () => {
    expect(src).toContain('require(BackupArchive.safeSetting(key) && BackupArchive.settingType(key) != null && key != "favorites_protected") { tr("包含不可迁移设置") }');
    expect(portableNovelKey('font_size')).toBe(true);
    expect(portableNovelKey('favorites_protected')).toBe(false);
    expect(portableNovelKey('unknown_key_zzz')).toBe(false);
    expect(isSafeSettingKey('font_size')).toBe(true);
  });

  it('L72 类型必须等于 `settingType(key)`，否则「设置类型不符」', () => {
    expect(src).toContain('require(item.getString("type") == BackupArchive.settingType(key)) { tr("设置类型不符") }');
    expect(() => validatePortableSettings({ novel_reader_prefs: { font_size: { type: 'int', value: 12 } } })).toThrow(
      '设置类型不符',
    );
    expect(validatePortableSettings({ novel_reader_prefs: { font_size: { type: 'float', value: 12 } } }).novel_reader_prefs?.font_size).toEqual({ type: 'float', value: 12 });
  });

  it('L73 float 一律 `isFinite && abs <= 10000`（具名范围优先，见 E215）', () => {
    expect(src).toContain('if (item.getString("type") == "float") require(item.getDouble("value").isFinite() && kotlin.math.abs(item.getDouble("value")) <= 10000)');
    // 有具名范围时，范围先生效（7.9 / 80.1 都被 8..80 拦下，与 10000 无关）
    expect(() => validatePortableSettings({ novel_reader_prefs: { font_size: { type: 'float', value: 7.9 } } })).toThrow(
      '浮点设置超出范围',
    );
    expect(() => validatePortableSettings({ novel_reader_prefs: { font_size: { type: 'float', value: 80.1 } } })).toThrow(
      '浮点设置超出范围',
    );
    expect(validatePortableSettings({ novel_reader_prefs: { font_size: { type: 'float', value: 80 } } }).novel_reader_prefs?.font_size?.value).toBe(80);
    /*
     * 绝对值上限本身只在**无具名范围**的键上可见：`font_size` 有 8..80，`isAcceptableFloat`
     * 先查具名范围，所以拿 `font_size: 10000` 去测 10000 这条上限永远测不到。
     */
    expect(isAcceptableFloat('__no_named_range__', 10_000)).toBe(true);
    expect(isAcceptableFloat('__no_named_range__', 10_001)).toBe(false);
    expect(isAcceptableFloat('__no_named_range__', -10_001)).toBe(false);
    expect(isAcceptableFloat('__no_named_range__', Number.NaN)).toBe(false);
    expect(isAcceptableFloat('__no_named_range__', Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('L75-79 五个具名范围（font_size 8..80 / line_height 8..120 / 三个 int 档）', () => {
    expect(src).toContain('"font_size" -> require(item.getDouble("value") in 8.0..80.0)');
    expect(src).toContain('"line_height" -> require(item.getDouble("value") in 8.0..120.0)');
    expect(src).toContain('"reader_theme" -> require(item.getInt("value") in 0..5)');
    expect(src).toContain('"page_turn_mode" -> require(item.getInt("value") in 0..4)');
    expect(src).toContain('"screen_orientation_lock" -> require(item.getInt("value") in 0..2)');
    // 边界两侧
    expect(() => validatePortableSettings({ novel_reader_prefs: { font_size: { type: 'float', value: 7.9 } } })).toThrow();
    expect(() => validatePortableSettings({ novel_reader_prefs: { font_size: { type: 'float', value: 80.1 } } })).toThrow();
    expect(validatePortableSettings({ novel_reader_prefs: { font_size: { type: 'float', value: 80 } } }).novel_reader_prefs?.font_size?.value).toBe(80);
    expect(() => validatePortableSettings({ novel_reader_prefs: { line_height: { type: 'float', value: 120.5 } } })).toThrow();
    expect(() => validatePortableSettings({ novel_reader_prefs: { reader_theme: { type: 'int', value: 6 } } })).toThrow();
    expect(() => validatePortableSettings({ novel_reader_prefs: { page_turn_mode: { type: 'int', value: -1 } } })).toThrow();
    expect(() => validatePortableSettings({ novel_reader_prefs: { screen_orientation_lock: { type: 'int', value: 3 } } })).toThrow();
    expect(validatePortableSettings({ novel_reader_prefs: { reader_theme: { type: 'int', value: 5 } } }).novel_reader_prefs?.reader_theme?.value).toBe(5);
  });
});

describe('PortableSettings.kt L82-88 comic_reader_store 的校验', () => {
  const src = kt(KT);

  it('L83 键必须是四个固定键或三类前缀', () => {
    expect(src).toContain('require(key in comicKeys || key.startsWith("book_cfg_") || key.startsWith("book_state_") || key.startsWith("resume_"))');
    expect(portableComicKey('global_config')).toBe(true);
    expect(portableComicKey('presets')).toBe(true);
    expect(portableComicKey('default_preset')).toBe(true);
    expect(portableComicKey('custom_fit_presets')).toBe(true);
    expect(portableComicKey('book_cfg_7')).toBe(true);
    expect(portableComicKey('book_state_7')).toBe(true);
    expect(portableComicKey('resume_7_chapter')).toBe(true);
    expect(portableComicKey('favorites_protected')).toBe(false);
  });

  it('L84 类型必须是 `string`', () => {
    expect(src).toContain('val item = settings.getJSONObject(key); require(item.getString("type") == "string")');
    expect(() => validatePortableSettings({ comic_reader_store: { global_config: { type: 'int', value: 1 } } })).toThrow(
      '设置类型不符',
    );
  });

  it('L85 上限是 `raw.length <= 1024 * 1024` —— **字符数**', () => {
    expect(src).toContain('val raw = item.getString("value"); require(raw.length <= 1024 * 1024)');
    // 65536 个汉字 = 196608 字节，远小于 1 MiB 字节；字符数也远小于 1 Mi
    const ok = validatePortableSettings({ comic_reader_store: { global_config: { type: 'string', value: JSON.stringify({ pad: 'あ'.repeat(300_000) }) } } });
    expect(ok.comic_reader_store?.global_config?.type).toBe('string');
    // 超过 1 Mi 字符 → 拒
    expect(() =>
      validatePortableSettings({ comic_reader_store: { global_config: { type: 'string', value: JSON.stringify({ pad: 'a'.repeat(1024 * 1024) }) } } }),
    ).toThrow();
  });

  it('L86-87 两个预设键要求 JSON 数组、其余（除 default_preset）要求 JSON 对象', () => {
    expect(src).toContain('if (key == "presets" || key == "custom_fit_presets") JSONArray(raw)');
    expect(src).toContain('else if (key != "default_preset") JSONObject(raw)');
    expect(() => validatePortableSettings({ comic_reader_store: { presets: { type: 'string', value: '{}' } } })).toThrow();
    expect(() => validatePortableSettings({ comic_reader_store: { global_config: { type: 'string', value: '[]' } } })).toThrow();
    // default_preset 不做 JSON 解析（它可以是裸字符串）
    expect(
      validatePortableSettings({ comic_reader_store: { default_preset: { type: 'string', value: 'not-json' } } }).comic_reader_store?.default_preset?.value,
    ).toBe('not-json');
  });
});

describe('PortableSettings.kt L89-94 sources / god / scripts', () => {
  const src = kt(KT);

  it('L90 `id.length in 1..512` 且 `toString().length <= 2 MiB`（**字符数**，无 message）', () => {
    expect(src).toContain('require(id.length in 1..512 && sources.getJSONObject(id).toString().length <= 2 * 1024 * 1024)');
    // 端口此前用 UTF-8 字节数（`stringBytes`），中文书源会被误拒 —— 已改回字符数
    expect(repoText(TS)).toContain("requireTransfer(id.length >= 1 && id.length <= 512 && text.length <= 2 * 1024 * 1024, 'Failed requirement.');");
    // 字符数 ≤ 2 Mi、字节数 > 2 Mi 的定义必须能通过
    const definition = { rules: 'あ'.repeat(700_000) };
    const chars = JSON.stringify(definition).length;
    const bytes = new TextEncoder().encode(JSON.stringify(definition)).length;
    expect(chars).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(bytes).toBeGreaterThan(2 * 1024 * 1024);
    expect(validatePortableSettings({ sources: { src1: definition } }).sources?.src1).toBeDefined();
    // 长度越界仍要拒
    expect(() => validatePortableSettings({ sources: { '': { a: 1 } } })).toThrow();
    expect(() => validatePortableSettings({ sources: { ['x'.repeat(513)]: { a: 1 } } })).toThrow();
  });

  it('L91 敏感命中 → 「书源含认证字段」', () => {
    expect(src).toContain('require(!sensitive.containsMatchIn(sources.getJSONObject(id).toString())) { tr("书源含认证字段") }');
    expect(() => validatePortableSettings({ sources: { s: { headers: { Cookie: 'a=1' } } } })).toThrow('书源含认证字段');
    expect(() => validatePortableSettings({ sources: { s: { password: 'x' } } })).toThrow('书源含认证字段');
    // 长度/格式问题报的是 Kotlin L90 那条**无 message** 的 require
    expect(() => validatePortableSettings({ sources: { '': { a: 1 } } })).not.toThrow('书源含认证字段');
  });

  it('L93 `god` 只「摸」三个键（缺键/类型错就抛）', () => {
    expect(src).toContain('value.optJSONObject("god")?.let { it.getString("ranking_style"); it.getBoolean("last_page_hint"); it.getBoolean("gyro_parallax") }');
    expect(() => validatePortableSettings({ god: { last_page_hint: true, gyro_parallax: true } })).toThrow();
    expect(() => validatePortableSettings({ god: { ranking_style: 'podium', last_page_hint: 'yes', gyro_parallax: true } })).toThrow();
    expect(
      validatePortableSettings({ god: { ranking_style: 'vinyl', last_page_hint: false, gyro_parallax: true } }).god,
    ).toEqual({ ranking_style: 'vinyl', last_page_hint: false, gyro_parallax: true });
  });

  it('L94 `scripts` 交给 `JsSourceRepo.validatePortable`', () => {
    expect(src).toContain('value.optJSONArray("scripts")?.let(com.example.source.js.JsSourceRepo::validatePortable)');
    expect(repoText(TS)).toContain('if (value.scripts !== undefined) output.scripts = JsSourceRepo.validatePortable(value.scripts);');
  });

  it('Kotlin **没有**的集合上限：端口已删掉 500 / 2000 两条', () => {
    const ts = repoText(TS);
    expect(ts).not.toContain('书源过多');
    expect(ts).not.toContain('书源状态过多');
    expect(src).not.toContain('<= 500');
    expect(src).not.toContain('<= 2000');
    // 600 条书源、2100 条状态都能过（总信封仍受 8 MiB 元数据上限约束）
    const sources: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 600; i += 1) sources[`s${String(i)}`] = { n: i };
    expect(Object.keys(validatePortableSettings({ sources }).sources ?? {})).toHaveLength(600);
    const states: Record<string, boolean> = {};
    for (let i = 0; i < 2100; i += 1) states[`s${String(i)}`] = i % 2 === 0;
    expect(Object.keys(validatePortableSettings({ source_states: states }).source_states ?? {})).toHaveLength(2100);
    expect(PORTABLE_METADATA_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ PortableSettings.kt L96-140 apply
   ══════════════════════════════════════════════════════════════════════════════ */

describe('PortableSettings.kt L96-127 apply 的两个 store', () => {
  const src = kt(KT);

  it('L97 先 `validate(value)` —— 整包校验在任何写入之前', () => {
    expect(src).toContain('fun apply(context: Context, value: JSONObject, mode: ImportMode, bookIds: Map<Int, Int>) {');
    expect(src).toContain('validate(value)');
    expect(repoText('src/platform/ios-native/archiveSettings.ts')).toContain('const settings = validatePortableSettings(input), { preview, mode, storage, sources, scripts } = context;');
  });

  it('L98 只遍历 `stores.take(2)`（第三个 store 走 SOURCES 分支）', () => {
    expect(src).toContain('for (name in stores.take(2)) value.optJSONObject(name)?.let { input ->');
  });

  it('L104-106 书号不在 `bookIds` 里就**整条跳过**（不迁移、不报错）', () => {
    expect(src).toContain('val numeric=Regex("^(?:book_cfg_|book_state_|resume_)(\\\\d+)(?:_|$)").find(oldKey)?.groupValues?.get(1)?.toIntOrNull()');
    expect(src).toContain('if(numeric!=null && numeric !in bookIds)return@forEach');
    const ids = new Map([[7, 19]]);
    expect(relocateComicSettingKey('book_cfg_7', ids)).toBe('book_cfg_19');
    expect(relocateComicSettingKey('book_state_7', ids)).toBe('book_state_19');
    expect(relocateComicSettingKey('resume_7_ch', ids)).toBe('resume_19_ch');
    expect(relocateComicSettingKey('book_cfg_8', ids)).toBeNull();
    // 前缀后面不是纯数字的（`book_cfg_source::7`）原样保留
    expect(relocateComicSettingKey('book_cfg_source::7', ids)).toBe('book_cfg_source::7');
  });

  it('L108-109 两类键的重命名方式不同（`substringBeforeLast` vs `removePrefix`）', () => {
    expect(src).toContain('if (oldKey == "book_cfg_$old" || oldKey == "book_state_$old") key = oldKey.substringBeforeLast(\'_\') + "_$new"');
    expect(src).toContain('if (oldKey.startsWith("resume_${old}_")) key = "resume_${new}_" + oldKey.removePrefix("resume_${old}_")');
    // `book_cfg_7` 的 `substringBeforeLast('_')` 是 `book_cfg`；`resume_7_ch` 是 `resume` + `19` + `_ch`
    const ids = new Map([[7, 19]]);
    expect(relocateComicSettingKey('book_cfg_7', ids)).toBe('book_cfg_19');
    expect(relocateComicSettingKey('resume_7_a_b', ids)).toBe('resume_19_a_b');
  });

  it('L111 `REPLACE || !prefs.contains(key)` 才覆盖', () => {
    expect(src).toContain('if (mode == ImportMode.REPLACE || !prefs.contains(key)) output.put(key, input.get(oldKey))');
    const existing: PortableSettingEntries = { font_size: { type: 'float', value: 12 } };
    const incoming: PortableSettingEntries = { font_size: { type: 'float', value: 30 } };
    expect(mergePortableSettings(existing, incoming, 'novel_reader_prefs', 'MERGE', new Map()).font_size?.value).toBe(12);
    expect(mergePortableSettings(existing, incoming, 'novel_reader_prefs', 'REPLACE', new Map()).font_size?.value).toBe(30);
  });

  it('L112-117 两个预设键按 `id` 追加去重（MERGE 时）', () => {
    expect(src).toContain('val ids = (0 until existing.length()).map { existing.getJSONObject(it).getString("id") }.toMutableSet()');
    expect(src).toContain('for (i in 0 until incoming.length()) if (ids.add(incoming.getJSONObject(i).getString("id"))) existing.put(incoming.getJSONObject(i))');
    const existing: PortableSettingEntries = {
      presets: { type: 'string', value: JSON.stringify([{ id: 'same', name: '旧' }]) },
    };
    const incoming: PortableSettingEntries = {
      presets: { type: 'string', value: JSON.stringify([{ id: 'same', name: '传入' }, { id: 'new', name: '新' }]) },
    };
    const merged = mergePortableSettings(existing, incoming, 'comic_reader_store', 'MERGE', new Map());
    expect(JSON.parse(merged.presets?.value as string)).toEqual([
      { id: 'same', name: '旧' },
      { id: 'new', name: '新' },
    ]);
  });

  it('L119-125 REPLACE 只删**可迁移键**：凭据与设备私有偏好永不清', () => {
    expect(src).toContain('// Remove only portable keys: credentials and device preferences are never cleared.');
    expect(src).toContain('prefs.all.keys.filter { key -> if (name == stores[0]) BackupArchive.settingType(key) != null && BackupArchive.safeSetting(key) && key != "favorites_protected"');
    const existing: PortableSettingEntries = {
      font_size: { type: 'float', value: 12 },
      total_read_time_seconds: { type: 'long', value: 999 },
      favorites_protected: { type: 'boolean', value: true },
    };
    const merged = mergePortableSettings(existing, {}, 'novel_reader_prefs', 'REPLACE', new Map());
    // 可迁移键被删
    expect(merged.font_size).toBeUndefined();
    // 计数器与 favorites_protected 保留（端口比 Kotlin L122 多排除了计数器，见 E215）
    expect(merged.total_read_time_seconds?.value).toBe(999);
    expect(merged.favorites_protected?.value).toBe(true);
  });
});

describe('PortableSettings.kt L128-139 apply 的 sources 侧', () => {
  const src = kt(KT);

  it('L128 `god` 只在 REPLACE 时导入', () => {
    expect(src).toContain('value.optJSONObject("god")?.let { if (mode == ImportMode.REPLACE) com.example.god.GodMomentSettingsStore(context).importPortable(it) }');
    expect(repoText('src/platform/ios-native/archiveSettings.ts')).toContain(
      "if (settings.god && (mode === 'REPLACE' || storage.getItem('god_moment_prefs') === null)) storage.setItem('god_moment_prefs', JSON.stringify(settings.god));",
    );
  });

  it('L130 `scripts` 的 replace 标志 = `mode == REPLACE`', () => {
    expect(src).toContain('value.optJSONArray("scripts")?.let { com.example.source.js.JsSourceRepo.importPortable(context,it,mode==ImportMode.REPLACE) }');
    expect(repoText('src/platform/ios-native/archiveSettings.ts')).toContain(
      "if (settings.scripts) await scripts.importPortable(settings.scripts, mode === 'REPLACE');",
    );
  });

  it('L132-133 书源：REPLACE 或本地没有才写', () => {
    expect(src).toContain('if (mode == ImportMode.REPLACE || id !in existing) storage.saveCustomSourceJson(id, sources.getJSONObject(id).toString())');
    expect(repoText('src/platform/ios-native/archiveSettings.ts')).toContain(
      "for (const [id, definition] of Object.entries(settings.sources ?? {})) if (mode === 'REPLACE' || !Object.hasOwn(definitions, id)) await sources.saveCustomSourceJson(id, JSON.stringify(definition));",
    );
  });

  it('L136-137 启用状态同理；L139 活动书源还要求本地为 null', () => {
    expect(src).toContain('if (mode == ImportMode.REPLACE || id !in states) storage.saveSourceState(id, sources.getBoolean(id))');
    expect(src).toContain('value.stringOrNull("active_source")?.let { if (mode == ImportMode.REPLACE || storage.getActiveSourceId() == null) storage.saveActiveSourceId(it) }');
    expect(repoText('src/platform/ios-native/archiveSettings.ts')).toContain(
      "if (settings.active_source !== undefined && (mode === 'REPLACE' || await sources.getActiveSourceId() === null)) await sources.saveActiveSourceId(settings.active_source);",
    );
  });
});
