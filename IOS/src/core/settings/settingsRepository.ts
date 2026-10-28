import { isSafeSettingKey } from '@core/backup/safeSetting';
import { FLOAT_ABS_MAX, floatRangeFor, intRangeFor, settingType } from '@core/backup/settingTypes';
import { replaceFilesPath, restoreFilesPath } from '@core/backup/backupArchiveFormat';
import type { SQLiteDatabase } from '@platform/interfaces';

export type SettingType = 'boolean' | 'float' | 'int' | 'long' | 'string';

export type SettingValue = boolean | number | string;

export interface StoredSetting {
  key: string;
  type: SettingType;
  value: SettingValue;
}

export interface SettingSpec {
  type: SettingType;
  default: SettingValue;
}

export const SETTINGS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "app_settings" ("key" TEXT PRIMARY KEY, "type" TEXT NOT NULL, "value" TEXT NOT NULL)`;

export const SETTING_SPECS: Record<string, SettingSpec> = {
  first_line_indent: { type: 'boolean', default: true },
  splash_pure_mode: { type: 'boolean', default: false },
  auto_night_mode: { type: 'boolean', default: false },
  blue_light_filter: { type: 'boolean', default: false },
  preload_wifi_only: { type: 'boolean', default: false },
  keep_screen_on: { type: 'boolean', default: true },
  haptics_enabled: { type: 'boolean', default: true },
  incognito_browsing_enabled: { type: 'boolean', default: false },
  favorites_protected: { type: 'boolean', default: false },
  multi_language_search: { type: 'boolean', default: true },
  multi_language_online_lookup: { type: 'boolean', default: true },
  show_overlay_header_footer: { type: 'boolean', default: true },
  card_tweaks_migrated_v2: { type: 'boolean', default: false },
  has_seen_onboarding: { type: 'boolean', default: false },
  has_seen_welcome: { type: 'boolean', default: false },
  has_configured_source: { type: 'boolean', default: false },
  has_imported_local_book: { type: 'boolean', default: false },
  has_imported_community_comics_v1: { type: 'boolean', default: false },
  show_adult_sources: { type: 'boolean', default: true },
  js_source_health_checked_v3: { type: 'boolean', default: false },
  reading_totals_reconciled_v1: { type: 'boolean', default: false },

  font_size: { type: 'float', default: 18 },
  line_height: { type: 'float', default: 28 },
  blue_light_alpha: { type: 'float', default: 0.15 },
  tts_speed: { type: 'float', default: 1 },
  tts_pitch: { type: 'float', default: 1 },
  reader_brightness: { type: 'float', default: 1 },
  card_blur_dp: { type: 'float', default: 22 },
  card_corner_dp: { type: 'float', default: 16 },
  card_tilt_deg: { type: 'float', default: 6 },
  card_cam_mult: { type: 'float', default: 5 },
  card_ripple_a: { type: 'float', default: 0.42 },
  card_tint_mix: { type: 'float', default: 0.08 },
  card_press_s: { type: 'float', default: 1.25 },
  card_press_r: { type: 'float', default: 1.1 },
  card_alpha: { type: 'float', default: 1 },

  margin_horizontal: { type: 'int', default: 16 },
  reader_theme: { type: 'int', default: 1 },
  custom_bg_color: { type: 'int', default: 0xfffbf0d9 },
  custom_text_color: { type: 'int', default: 0xff5f4b32 },
  font_family_index: { type: 'int', default: 0 },
  page_turn_mode: { type: 'int', default: 0 },
  app_background_mode: { type: 'int', default: 0 },
  app_background_dim: { type: 'int', default: 20 },
  screen_orientation_lock: { type: 'int', default: 0 },
  rest_reminder_minutes: { type: 'int', default: 30 },
  shelf_drag_hint_shown: { type: 'int', default: 0 },
  click_zone_left_action: { type: 'int', default: 0 },
  click_zone_center_action: { type: 'int', default: 1 },
  click_zone_right_action: { type: 'int', default: 2 },
  color_primary_index: { type: 'int', default: 2 },
  color_secondary_index: { type: 'int', default: 2 },
  render_quality: { type: 'int', default: 2 },
  daily_goal_minutes: { type: 'int', default: 60 },

  total_read_time_seconds: { type: 'long', default: 0 },
  legacy_unattributed_read_seconds: { type: 'long', default: 0 },

  custom_splash_poster_uri: { type: 'string', default: '' },
  custom_app_background_uri: { type: 'string', default: '' },
  custom_font_path: { type: 'string', default: '' },
  js_source_repo_url: {
    type: 'string',
    default: 'https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/index.json',
  },
  search_history_v1: { type: 'string', default: '[]' },
};

interface SettingRow {
  key: string;
  type: string;
  value: string;
}

function isSettingType(value: string): value is SettingType {
  return value === 'boolean' || value === 'float' || value === 'int' || value === 'long' || value === 'string';
}

function decodeValue(type: SettingType, raw: string): SettingValue {
  const parsed = JSON.parse(raw) as unknown;
  if (type === 'boolean') {
    if (typeof parsed !== 'boolean') {
      throw new Error(`设置值损坏: ${type}`);
    }
    return parsed;
  }
  if (type === 'string') {
    if (typeof parsed !== 'string') {
      throw new Error(`设置值损坏: ${type}`);
    }
    return parsed;
  }
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error(`设置值损坏: ${type}`);
  }
  return parsed;
}

export class SettingsRepository {
  private ready: Promise<void> | null = null;

  /**
   * @param db           SQLite handle for the `app_settings` table.
   * @param filesRoot    Device files directory. When set, `exportEntries` rewrites owned
   *                     file paths to the `@FILES@` placeholder and `restoreSafeEntries`
   *                     re-localises them back (Kotlin `BackupArchive.kt` L57 / L144).
   *                     Defaults to `''` (no substitution) for callers that do not back up
   *                     to / from disk (e.g. unit tests, in-app reads).
   */
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly filesRoot = '',
  ) {}

  private ensureReady(): Promise<void> {
    if (this.ready === null) {
      this.ready = this.db.execute(SETTINGS_TABLE_SQL).then(() => undefined);
    }
    return this.ready;
  }

  async getBoolean(key: string, defaultValue?: boolean): Promise<boolean> {
    const value = await this.getRaw(key);
    if (value !== null && value.type === 'boolean') return value.value as boolean;
    if (defaultValue !== undefined) return defaultValue;
    const spec = SETTING_SPECS[key];
    if (spec !== undefined && spec.type === 'boolean') return spec.default as boolean;
    throw new Error(`未知设置项: ${key}`);
  }

  async getInt(key: string, defaultValue?: number): Promise<number> {
    const value = await this.getRaw(key);
    if (value !== null && (value.type === 'int' || value.type === 'long')) return value.value as number;
    if (defaultValue !== undefined) return defaultValue;
    const spec = SETTING_SPECS[key];
    if (spec !== undefined && (spec.type === 'int' || spec.type === 'long')) return spec.default as number;
    throw new Error(`未知设置项: ${key}`);
  }

  async getFloat(key: string, defaultValue?: number): Promise<number> {
    const value = await this.getRaw(key);
    if (value !== null && value.type === 'float') return value.value as number;
    if (defaultValue !== undefined) return defaultValue;
    const spec = SETTING_SPECS[key];
    if (spec !== undefined && spec.type === 'float') return spec.default as number;
    throw new Error(`未知设置项: ${key}`);
  }

  async getLong(key: string, defaultValue?: number): Promise<number> {
    return this.getInt(key, defaultValue);
  }

  async getString(key: string, defaultValue?: string): Promise<string> {
    const value = await this.getRaw(key);
    if (value !== null && value.type === 'string') return value.value as string;
    if (defaultValue !== undefined) return defaultValue;
    const spec = SETTING_SPECS[key];
    if (spec !== undefined && spec.type === 'string') return spec.default as string;
    throw new Error(`未知设置项: ${key}`);
  }

  async setBoolean(key: string, value: boolean): Promise<void> {
    await this.put(key, 'boolean', value);
  }

  async setInt(key: string, value: number): Promise<void> {
    await this.put(key, 'int', value);
  }

  async setFloat(key: string, value: number): Promise<void> {
    await this.put(key, 'float', value);
  }

  async setLong(key: string, value: number): Promise<void> {
    await this.put(key, 'long', value);
  }

  async setString(key: string, value: string): Promise<void> {
    await this.put(key, 'string', value);
  }

  async remove(key: string): Promise<void> {
    await this.ensureReady();
    await this.rewriteAll((row) => row.key !== key);
  }

  async getAll(): Promise<StoredSetting[]> {
    await this.ensureReady();
    const rows = await this.db.query<SettingRow>('SELECT "key", "type", "value" FROM "app_settings"');
    const out: StoredSetting[] = [];
    for (const row of rows) {
      if (!isSettingType(row.type)) continue;
      out.push({ key: row.key, type: row.type, value: decodeValue(row.type, row.value) });
    }
    return out;
  }

  async exportEntries(filesRoot = this.filesRoot): Promise<StoredSetting[]> {
    const all = await this.getAll();
    if (filesRoot === '') return all;
    // Kotlin L79: string settings that embed a files-dir path get the `@FILES@` placeholder.
    return all.map((item) =>
      item.type === 'string' && typeof item.value === 'string'
        ? { ...item, value: replaceFilesPath(item.value, filesRoot) }
        : item,
    );
  }

  async restoreSafeEntries(
    entries: ReadonlyArray<{ key: string; type: string; value: unknown }>,
    filesRoot = this.filesRoot,
  ): Promise<void> {
    await this.ensureReady();
    const validated: StoredSetting[] = [];
    for (const entry of entries) {
      if (!isSafeSettingKey(entry.key)) continue;
      const expected = settingType(entry.key);
      if (expected === null) continue;
      if (entry.type !== expected) {
        throw new Error(`备份设置类型不符: ${entry.key}`);
      }
      const type = expected as SettingType;
      let value = entry.value;
      // Kotlin L144: re-localise the `@FILES@` placeholder to the target files directory.
      if (type === 'string' && typeof value === 'string') {
        value = restoreFilesPath(value, filesRoot);
      }
      validated.push({ key: entry.key, type, value: this.coerce(entry.key, type, value) });
    }

    await this.db.execute('BEGIN');
    try {
      // 缺口 E13 (Kotlin `BackupArchive.restore` L123-125): only drop keys that are both
      // safe (no credential) AND have a known backup type; credential / unknown keys are kept
      // untouched so a restore never wipes the user's logged-in session. We rebuild the table
      // from the kept rows plus the validated backup rows — the in-memory test store does not
      // support a bound `DELETE ... WHERE key = ?` across multiple rows, so we wipe and replay.
      const existing = await this.getAll();
      const keep = existing.filter(
        (item) => !(isSafeSettingKey(item.key) && settingType(item.key) !== null),
      );
      await this.db.execute('DELETE FROM "app_settings"');
      for (const item of [...keep, ...validated]) {
        await this.db.execute('INSERT INTO "app_settings" ("key", "type", "value") VALUES (?, ?, ?)', [
          item.key,
          item.type,
          JSON.stringify(item.value),
        ]);
      }
      await this.db.execute('COMMIT');
    } catch (error) {
      await this.db.execute('ROLLBACK');
      throw error;
    }
  }

  private async getRaw(key: string): Promise<StoredSetting | null> {
    await this.ensureReady();
    const all = await this.getAll();
    return all.find((item) => item.key === key) ?? null;
  }

  private async rewriteAll(keep: (item: StoredSetting) => boolean): Promise<void> {
    const all = await this.getAll();
    const kept = all.filter(keep);
    await this.db.execute('BEGIN');
    try {
      await this.db.execute('DELETE FROM "app_settings"');
      for (const item of kept) {
        await this.db.execute('INSERT INTO "app_settings" ("key", "type", "value") VALUES (?, ?, ?)', [
          item.key,
          item.type,
          JSON.stringify(item.value),
        ]);
      }
      await this.db.execute('COMMIT');
    } catch (error) {
      await this.db.execute('ROLLBACK');
      throw error;
    }
  }

  private async put(key: string, type: SettingType, value: SettingValue): Promise<void> {
    await this.ensureReady();
    await this.db.execute(
      'INSERT INTO "app_settings" ("key", "type", "value") VALUES (?, ?, ?) ON CONFLICT("key") DO UPDATE SET "type" = excluded."type", "value" = excluded."value"',
      [key, type, JSON.stringify(value)],
    );
  }

  private coerce(key: string, type: SettingType, raw: unknown): SettingValue {
    if (type === 'boolean') {
      if (typeof raw !== 'boolean') {
        throw new Error(`备份设置类型不符: ${key}`);
      }
      return raw;
    }
    if (type === 'string') {
      if (typeof raw !== 'string') {
        throw new Error(`备份设置类型不符: ${key}`);
      }
      return raw;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > FLOAT_ABS_MAX) {
      throw new Error(`备份设置类型不符: ${key}`);
    }
    if (type === 'int') {
      if (!Number.isInteger(raw)) {
        throw new Error(`备份设置类型不符: ${key}`);
      }
      const range = intRangeFor(key);
      if (raw < range.min || raw > range.max) {
        throw new Error(`备份设置越界: ${key}`);
      }
      return raw;
    }
    if (type === 'long') {
      return raw;
    }
    const range = floatRangeFor(key);
    if (range) {
      return Math.min(Math.max(raw, range.min), range.max);
    }
    return raw;
  }
}

export function createSettingsRepository(db: SQLiteDatabase): SettingsRepository {
  return new SettingsRepository(db);
}

/**
 * PreferencesManager.kt — typed accessors + helpers beyond raw key get/set.
 * Wraps SettingsRepository; defaults mirror Android SharedPreferences.
 */
export class PreferencesManager {
  constructor(private readonly repo: SettingsRepository) {}

  multiLanguageOnlineLookup(): Promise<boolean> {
    return this.repo.getBoolean('multi_language_online_lookup', true)
  }
  setMultiLanguageOnlineLookup(v: boolean): Promise<void> {
    return this.repo.setBoolean('multi_language_online_lookup', v)
  }

  fontSize(): Promise<number> {
    return this.repo.getFloat('font_size', 18)
  }
  lineHeight(): Promise<number> {
    return this.repo.getFloat('line_height', 28)
  }
  marginHorizontal(): Promise<number> {
    return this.repo.getInt('margin_horizontal', 16)
  }
  firstLineIndent(): Promise<boolean> {
    return this.repo.getBoolean('first_line_indent', true)
  }
  readerTheme(): Promise<number> {
    return this.repo.getInt('reader_theme', 1)
  }
  customBgColor(): Promise<number> {
    return this.repo.getInt('custom_bg_color', 0xfffbf0d9)
  }
  customTextColor(): Promise<number> {
    return this.repo.getInt('custom_text_color', 0xff5f4b32)
  }
  fontFamilyIndex(): Promise<number> {
    return this.repo.getInt('font_family_index', 0)
  }
  /** 0: 3D仿真, 1: 覆盖, 2: 平移, 3: 渐变, 4: 滚动 */
  pageTurnMode(): Promise<number> {
    return this.repo.getInt('page_turn_mode', 0)
  }
  setPageTurnMode(v: number): Promise<void> {
    return this.repo.setInt('page_turn_mode', v)
  }
  customSplashPosterUri(): Promise<string> {
    return this.repo.getString('custom_splash_poster_uri', '')
  }
  splashPureMode(): Promise<boolean> {
    return this.repo.getBoolean('splash_pure_mode', false)
  }
  appBackgroundMode(): Promise<number> {
    return this.repo.getInt('app_background_mode', 0)
  }
  customAppBackgroundUri(): Promise<string> {
    return this.repo.getString('custom_app_background_uri', '')
  }
  appBackgroundDim(): Promise<number> {
    return this.repo.getInt('app_background_dim', 20).then((v) => Math.min(Math.max(v, 0), 50))
  }
  screenOrientationLock(): Promise<number> {
    return this.repo.getInt('screen_orientation_lock', 0)
  }
  restReminderMinutes(): Promise<number> {
    return this.repo.getInt('rest_reminder_minutes', 30)
  }
  autoNightMode(): Promise<boolean> {
    return this.repo.getBoolean('auto_night_mode', false)
  }
  blueLightFilter(): Promise<boolean> {
    return this.repo.getBoolean('blue_light_filter', false)
  }
  blueLightAlpha(): Promise<number> {
    return this.repo.getFloat('blue_light_alpha', 0.15)
  }
  preloadWifiOnly(): Promise<boolean> {
    return this.repo.getBoolean('preload_wifi_only', false)
  }
  shelfDragHintShown(): Promise<number> {
    return this.repo.getInt('shelf_drag_hint_shown', 0).then((v) => Math.min(Math.max(v, 0), 3))
  }
  keepScreenOn(): Promise<boolean> {
    return this.repo.getBoolean('keep_screen_on', true)
  }
  hapticsEnabled(): Promise<boolean> {
    return this.repo.getBoolean('haptics_enabled', true)
  }
  ttsSpeed(): Promise<number> {
    return this.repo.getFloat('tts_speed', 1)
  }
  ttsPitch(): Promise<number> {
    return this.repo.getFloat('tts_pitch', 1)
  }
  totalReadTimeSeconds(): Promise<number> {
    return this.repo.getLong('total_read_time_seconds', 0)
  }
  incognitoBrowsingEnabled(): Promise<boolean> {
    return this.repo.getBoolean('incognito_browsing_enabled', false)
  }
  favoritesProtected(): Promise<boolean> {
    return this.repo.getBoolean('favorites_protected', false)
  }
  multiLanguageSearch(): Promise<boolean> {
    return this.repo.getBoolean('multi_language_search', true)
  }
  showOverlayHeaderFooter(): Promise<boolean> {
    return this.repo.getBoolean('show_overlay_header_footer', true)
  }
  clickZoneLeftAction(): Promise<number> {
    return this.repo.getInt('click_zone_left_action', 0)
  }
  clickZoneCenterAction(): Promise<number> {
    return this.repo.getInt('click_zone_center_action', 1)
  }
  clickZoneRightAction(): Promise<number> {
    return this.repo.getInt('click_zone_right_action', 2)
  }
  colorPrimaryIndex(): Promise<number> {
    return this.repo.getInt('color_primary_index', 2)
  }
  colorSecondaryIndex(): Promise<number> {
    return this.repo.getInt('color_secondary_index', 2)
  }
  renderQuality(): Promise<number> {
    return this.repo.getInt('render_quality', 2).then((v) => Math.min(Math.max(v, 0), 3))
  }
  dailyGoalMinutes(): Promise<number> {
    return this.repo.getInt('daily_goal_minutes', 60).then((v) => Math.min(Math.max(v, 5), 480))
  }
  readerBrightness(): Promise<number> {
    return this.repo.getFloat('reader_brightness', 1).then((v) => Math.min(Math.max(v, 0.2), 1))
  }
  customFontPath(): Promise<string> {
    return this.repo.getString('custom_font_path', '')
  }

  cardBlurRadiusDp(): Promise<number> {
    return this.repo.getFloat('card_blur_dp', 22).then((v) => Math.min(Math.max(v, 8), 40))
  }
  cardCornerRadiusDp(): Promise<number> {
    return this.repo.getFloat('card_corner_dp', 16).then((v) => Math.min(Math.max(v, 2), 48))
  }
  cardTiltMaxDeg(): Promise<number> {
    return this.repo.getFloat('card_tilt_deg', 6).then((v) => Math.min(Math.max(v, 0), 15))
  }
  cardCameraDistMult(): Promise<number> {
    return this.repo.getFloat('card_cam_mult', 5).then((v) => Math.min(Math.max(v, 3), 12))
  }
  cardRippleAlpha(): Promise<number> {
    return this.repo.getFloat('card_ripple_a', 0.42).then((v) => Math.min(Math.max(v, 0.1), 0.8))
  }
  cardTintMix(): Promise<number> {
    return this.repo.getFloat('card_tint_mix', 0.08).then((v) => Math.min(Math.max(v, 0), 0.3))
  }
  cardPressStrength(): Promise<number> {
    return this.repo.getFloat('card_press_s', 1.25).then((v) => Math.min(Math.max(v, 0), 2))
  }
  cardPressRadius(): Promise<number> {
    return this.repo.getFloat('card_press_r', 1.1).then((v) => Math.min(Math.max(v, 0.5), 2.5))
  }
  cardAlpha(): Promise<number> {
    return this.repo.getFloat('card_alpha', 1).then((v) => Math.min(Math.max(v, 0.4), 1))
  }

  /** 一次性迁移：v1 出厂参数升到 v2 默认档（幂等）。 */
  async migrateCardTweaksDefaultsV2(): Promise<void> {
    const done = await this.repo.getBoolean('card_tweaks_migrated_v2', false)
    if (done) return
    await this.repo.setFloat('card_tilt_deg', 6)
    await this.repo.setFloat('card_cam_mult', 5)
    await this.repo.setFloat('card_ripple_a', 0.42)
    await this.repo.setFloat('card_press_s', 1.25)
    await this.repo.setFloat('card_press_r', 1.1)
    await this.repo.setBoolean('card_tweaks_migrated_v2', true)
  }

  hasSeenWelcome(): Promise<boolean> {
    return this.repo.getBoolean('has_seen_welcome', false)
  }
  hasConfiguredSource(): Promise<boolean> {
    return this.repo.getBoolean('has_configured_source', false)
  }
  hasImportedLocalBook(): Promise<boolean> {
    return this.repo.getBoolean('has_imported_local_book', false)
  }
  hasImportedCommunityComics(): Promise<boolean> {
    return this.repo.getBoolean('has_imported_community_comics_v1', false)
  }
  showAdultSources(): Promise<boolean> {
    return Promise.resolve(true)
  }
  jsSourceRepoUrl(): Promise<string> {
    return this.repo.getString(
      'js_source_repo_url',
      'https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/index.json',
    )
  }
  jsSourceHealthChecked(): Promise<boolean> {
    return this.repo.getBoolean('js_source_health_checked_v3', false)
  }

  async searchHistory(): Promise<string[]> {
    const raw = await this.repo.getString('search_history_v1', '[]')
    try {
      const arr = JSON.parse(raw) as unknown
      if (!Array.isArray(arr)) return []
      return arr.filter((x): x is string => typeof x === 'string')
    } catch {
      return []
    }
  }

  async setSearchHistory(value: string[]): Promise<void> {
    await this.repo.setString('search_history_v1', JSON.stringify(value.slice(0, 20)))
  }

  /**
   * Kotlin L281–283 `hasSeenOnboarding` — `prefs.getBoolean("has_seen_onboarding", false)`.
   *
   * `PreferencesManager` carries this too, but `App.tsx`'s bootstrap path only ever holds a
   * raw `SettingsRepository`, so the same accessor lives here as well (the two classes are
   * two faces of the same `novel_reader_prefs` store).
   */
  hasSeenOnboarding(): Promise<boolean> {
    return this.repo.getBoolean('has_seen_onboarding', false)
  }

  async setHasSeenOnboarding(seen: boolean): Promise<void> {
    await this.repo.setBoolean('has_seen_onboarding', seen)
  }

  getDailyReadTime(dateStr: string): Promise<number> {
    return this.repo.getLong(`daily_read_time_${dateStr}`, 0)
  }

  async setDailyReadTime(dateStr: string, seconds: number): Promise<void> {
    await this.repo.setLong(`daily_read_time_${dateStr}`, Math.max(0, seconds))
  }

  get readingTotalsReconciled(): Promise<boolean> {
    return this.repo.getBoolean('reading_totals_reconciled_v1', false)
  }
  set readingTotalsReconciled(v: Promise<boolean> | boolean) {
    void this.setReadingTotalsReconciled(v)
  }

  /** Android `readingTotalsReconciled` setter — commit() semantics, so it is awaitable. */
  async setReadingTotalsReconciled(v: Promise<boolean> | boolean): Promise<void> {
    await this.repo.setBoolean('reading_totals_reconciled_v1', await v)
  }

  get legacyUnattributedSeconds(): Promise<number> {
    return this.repo.getLong('legacy_unattributed_read_seconds', 0).then((v) => Math.max(0, v))
  }

  async legacyUnattributedSecondsSet(value: number): Promise<void> {
    await this.repo.setLong('legacy_unattributed_read_seconds', Math.max(0, value))
  }

  /* ══════════════════════════════════════════════════════════════
     具名 setter — 逐个对应 Android `PreferencesManager.kt` 的 `var` 属性
     （L74 screenOrientationLock / L82 autoNightMode / L86 blueLightFilter /
      L90 blueLightAlpha / L117 hapticsEnabled / L129 totalReadTimeSeconds /
      L153 incognitoBrowsingEnabled / L158 favoritesProtected /
      L200 colorPrimaryIndex / L204 colorSecondaryIndex / L209 renderQuality）。
     之前只有 getter，调用方拿不到写路径（MainViewModel 因此接不上）。
     ══════════════════════════════════════════════════════════════ */

  setScreenOrientationLock(v: number): Promise<void> {
    return this.repo.setInt('screen_orientation_lock', v)
  }

  setAutoNightMode(v: boolean): Promise<void> {
    return this.repo.setBoolean('auto_night_mode', v)
  }

  setBlueLightFilter(v: boolean): Promise<void> {
    return this.repo.setBoolean('blue_light_filter', v)
  }

  setBlueLightAlpha(v: number): Promise<void> {
    return this.repo.setFloat('blue_light_alpha', v)
  }

  setHapticsEnabled(v: boolean): Promise<void> {
    return this.repo.setBoolean('haptics_enabled', v)
  }

  /**
   * Kotlin L129–131 — `putLong("total_read_time_seconds", value)` with NO clamp.
   * Deliberately not `Math.max(0, …)`: Android stores whatever the caller passes, so the
   * port must too (every caller already guarantees a non-negative delta).
   */
  setTotalReadTimeSeconds(v: number): Promise<void> {
    return this.repo.setLong('total_read_time_seconds', v)
  }

  setIncognitoBrowsingEnabled(v: boolean): Promise<void> {
    return this.repo.setBoolean('incognito_browsing_enabled', v)
  }

  setFavoritesProtected(v: boolean): Promise<void> {
    return this.repo.setBoolean('favorites_protected', v)
  }

  setColorPrimaryIndex(v: number): Promise<void> {
    return this.repo.setInt('color_primary_index', v)
  }

  setColorSecondaryIndex(v: number): Promise<void> {
    return this.repo.setInt('color_secondary_index', v)
  }

  setRenderQuality(v: number): Promise<void> {
    return this.repo.setInt('render_quality', Math.min(Math.max(v, 0), 3))
  }

  /** legacyDailyTotals — keys of form daily_read_time_YYYY-MM-DD. */
  // Kotlin L139–142: `value is Long && value > 0` — the stored value must be a Long and
  // strictly positive. A stored string / boolean under a matching key is skipped rather
  // than coerced, so the predicate mirrors `value is Long` exactly (no `Number(...)`).
  async legacyDailyTotals(): Promise<Map<string, number>> {
    const all = await this.repo.getAll()
    const out = new Map<string, number>()
    for (const item of all) {
      if (!item.key.startsWith('daily_read_time_')) continue
      const date = item.key.slice('daily_read_time_'.length)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      const value = item.value
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
      out.set(date, value)
    }
    return out
  }

  /** calculateStreak — consecutive days ending today with dailyReadTime > 0. */
  async calculateStreak(): Promise<number> {
    let count = 0
    const d = new Date()
    for (;;) {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      const dateStr = `${y}-${m}-${day}`
      const duration = await this.getDailyReadTime(dateStr)
      if (duration > 0) {
        count += 1
        d.setDate(d.getDate() - 1)
      } else {
        break
      }
    }
    return count
  }
}

export function createPreferencesManager(db: SQLiteDatabase): PreferencesManager {
  return new PreferencesManager(createSettingsRepository(db))
}
