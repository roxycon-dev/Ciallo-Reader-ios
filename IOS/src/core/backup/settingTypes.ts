/**
 * Setting type map + ranges — port of Android `BackupArchive` settingTypes / INT_RANGES / FLOAT ranges.
 */

export const SETTING_TYPES: Record<string, string> = {};

const BOOLEAN_KEYS = [
  'reading_totals_reconciled_v1',
  'first_line_indent',
  'splash_pure_mode',
  'auto_night_mode',
  'blue_light_filter',
  'preload_wifi_only',
  'keep_screen_on',
  'haptics_enabled',
  'incognito_browsing_enabled',
  'favorites_protected',
  'multi_language_search',
  'multi_language_online_lookup',
  'show_overlay_header_footer',
  'card_tweaks_migrated_v2',
  'has_seen_onboarding',
  'has_seen_welcome',
  'has_configured_source',
  'has_imported_local_book',
  'has_imported_community_comics_v1',
  'show_adult_sources',
  'js_source_health_checked_v3',
];

const FLOAT_KEYS = [
  'font_size',
  'line_height',
  'blue_light_alpha',
  'tts_speed',
  'tts_pitch',
  'reader_brightness',
  'card_blur_dp',
  'card_corner_dp',
  'card_tilt_deg',
  'card_cam_mult',
  'card_ripple_a',
  'card_tint_mix',
  'card_press_s',
  'card_press_r',
  'card_alpha',
];

const INT_KEYS = [
  'margin_horizontal',
  'reader_theme',
  'custom_bg_color',
  'custom_text_color',
  'font_family_index',
  'page_turn_mode',
  'app_background_mode',
  'app_background_dim',
  'screen_orientation_lock',
  'rest_reminder_minutes',
  'shelf_drag_hint_shown',
  'click_zone_left_action',
  'click_zone_center_action',
  'click_zone_right_action',
  'color_primary_index',
  'color_secondary_index',
  'render_quality',
  'daily_goal_minutes',
];

const LONG_KEYS = ['total_read_time_seconds', 'legacy_unattributed_read_seconds'];

const STRING_KEYS = [
  'custom_splash_poster_uri',
  'custom_app_background_uri',
  'custom_font_path',
  'js_source_repo_url',
  'search_history_v1',
];

for (const key of BOOLEAN_KEYS) SETTING_TYPES[key] = 'boolean';
for (const key of FLOAT_KEYS) SETTING_TYPES[key] = 'float';
for (const key of INT_KEYS) SETTING_TYPES[key] = 'int';
for (const key of LONG_KEYS) SETTING_TYPES[key] = 'long';
for (const key of STRING_KEYS) SETTING_TYPES[key] = 'string';

const DAILY_READ_TIME_RE = /^daily_read_time_\d{4}-\d{2}-\d{2}$/;

/** Map a preference key to its backup type, or null if unknown. */
export function settingType(key: string): string | null {
  const t = SETTING_TYPES[key];
  if (t !== undefined) return t;
  if (DAILY_READ_TIME_RE.test(key)) return 'long';
  return null;
}

export interface IntRange {
  min: number;
  max: number;
}

export const INT_RANGE_DEFAULT: IntRange = {
  min: Number.MIN_SAFE_INTEGER,
  max: Number.MAX_SAFE_INTEGER,
};

export const INT_RANGES: Record<string, IntRange> = {
  reader_theme: { min: 0, max: 5 },
  page_turn_mode: { min: 0, max: 4 },
  screen_orientation_lock: { min: 0, max: 2 },
  font_family_index: { min: 0, max: 20 },
  app_background_mode: { min: 0, max: 1 },
  app_background_dim: { min: 0, max: 50 },
  daily_goal_minutes: { min: 0, max: 1440 },
  rest_reminder_minutes: { min: 0, max: 1440 },
};

export function intRangeFor(key: string): IntRange {
  return INT_RANGES[key] ?? INT_RANGE_DEFAULT;
}

export const FLOAT_ABS_MAX = 10_000;

export const FLOAT_RANGES: Record<string, IntRange> = {
  font_size: { min: 8, max: 80 },
  line_height: { min: 8, max: 120 },
};

export function floatRangeFor(key: string): IntRange | null {
  return FLOAT_RANGES[key] ?? null;
}

export function isAcceptableFloat(key: string, number: number): boolean {
  if (!Number.isFinite(number) || Math.abs(number) > FLOAT_ABS_MAX) return false;
  const range = FLOAT_RANGES[key];
  if (!range) return true;
  return number >= range.min && number <= range.max;
}
