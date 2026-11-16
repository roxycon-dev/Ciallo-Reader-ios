/**
 * Port of Android `god/GodMomentSettingsStore.kt` (line by line).
 *
 * Android keeps these in a dedicated DataStore file `god_moment_prefs`
 * (Preferences DataStore, keys below) — "与既有 SharedPreferences 体系并存，互不干扰".
 * Web counterpart: one localStorage entry with the same name and key names.
 *
 * Every read is guarded ("DataStore 读文件失败（磁盘满 / 文件损坏）时返回默认值，
 * 不允许把 App 崩 —— 神回只是附加功能") — here a corrupt JSON / quota error falls
 * back to the default instead of throwing.
 *
 * E61：原先直接 `window.localStorage`，让 `src/core/**` 依赖 DOM 全局。现走
 * `keyValueStore` 注入（与 `src/platform/interfaces.ts` 的 `KeyValueStore`
 * 结构兼容 —— 对应 Android `SharedPreferences` 的同步语义）。
 *
 * Keys (GodMomentSettingsStore.kt L27-31):
 *   ranking_style : String  (GodRankingStyle.code)  default "podium"
 *   last_page_hint: Boolean default true
 *   gyro_parallax : Boolean default true
 */

import { getKeyValueStore } from './keyValueStore'

/** 神回排行榜展示风格（设置项三选一）— GodMomentModels.kt L33-43. */
export type GodRankingStyleCode = 'podium' | 'vinyl' | 'polaroid';

export interface GodRankingStyleDef {
  code: GodRankingStyleCode;
  label: string;
  desc: string;
}

/** GodRankingStyle.entries — 领奖台 / 唱片架 / 照片墙. */
export const GOD_RANKING_STYLES: readonly GodRankingStyleDef[] = [
  { code: 'podium', label: '领奖台', desc: '前三名登台，其余卡牌流' },
  { code: 'vinyl', label: '唱片架', desc: '黑胶 Cover Flow 翻阅' },
  { code: 'polaroid', label: '照片墙', desc: '拍立得挂在麻绳上' },
];

/** GodRankingStyle.of(code) — 未知值兜底 PODIUM. */
export function godRankingStyleOf(code: string | null | undefined): GodRankingStyleCode {
  const found = GOD_RANKING_STYLES.find((entry) => entry.code === code);
  return found !== undefined ? found.code : 'podium';
}

export function godRankingStyleDef(code: GodRankingStyleCode): GodRankingStyleDef {
  return GOD_RANKING_STYLES.find((entry) => entry.code === code) ?? (GOD_RANKING_STYLES[0] as GodRankingStyleDef);
}

const STORAGE_KEY = 'god_moment_prefs';

interface GodPrefsFile {
  ranking_style?: string;
  last_page_hint?: boolean;
  gyro_parallax?: boolean;
}

/** guarded() — DataStore read failure → default, never throws. */
function readPrefs(): GodPrefsFile {
  try {
    const raw = getKeyValueStore().get(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as GodPrefsFile;
  } catch {
    return {};
  }
}

/** edit() — write whole map; quota/serialization errors are swallowed (guarded default). */
function writePrefs(next: GodPrefsFile): void {
  try {
    getKeyValueStore().set(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // guarded: 神回只是附加功能，写失败不崩
  }
}

/** rankingStyle Flow — default GodRankingStyle.PODIUM. */
export function getGodRankingStyle(): GodRankingStyleCode {
  return godRankingStyleOf(readPrefs().ranking_style ?? null);
}

/** setRankingStyle(style) — stores style.code. */
export function setGodRankingStyle(style: GodRankingStyleCode): void {
  writePrefs({ ...readPrefs(), ranking_style: style });
}

/** hintCapsuleEnabled Flow — default true (末页「标记神回」提示胶囊). */
export function getGodHintCapsuleEnabled(): boolean {
  const value = readPrefs().last_page_hint;
  return typeof value === 'boolean' ? value : true;
}

/** setHintCapsuleEnabled(enabled). */
export function setGodHintCapsuleEnabled(enabled: boolean): void {
  writePrefs({ ...readPrefs(), last_page_hint: enabled });
}

/** gyroParallaxEnabled Flow — default true (排行榜陀螺仪视差). */
export function getGodGyroParallaxEnabled(): boolean {
  const value = readPrefs().gyro_parallax;
  return typeof value === 'boolean' ? value : true;
}

/** setGyroParallaxEnabled(enabled). */
export function setGodGyroParallaxEnabled(enabled: boolean): void {
  writePrefs({ ...readPrefs(), gyro_parallax: enabled });
}

/* ══════════ 进程内一次性信标（GodMomentModels.kt L307-324） ══════════ */

/**
 * GodMomentJumpState — 排行榜 → 漫画主页的跳转信标：
 * 点条目时写入 chapterId，详情页进入后读取并滚动定位 + 金色高亮脉冲，
 * 读完即清空（避免二次进入误触发）。
 */
let godJumpChapterId: string | null = null;

export function setGodJumpChapterId(chapterId: string): void {
  godJumpChapterId = chapterId;
}

/** 读一次即清空（remember { v = pending; pending = null; v }）。 */
export function takeGodJumpChapterId(): string | null {
  const value = godJumpChapterId;
  godJumpChapterId = null;
  return value;
}

/**
 * GodStyleSettingsJump — 排行榜「陈列方式」按钮 → 设置页神回分区的跳转信标；
 * 设置页进入后读取并动画滚动到神回分区，读完即清空。
 */
let godStyleSettingsPending = false;

export function setGodStyleSettingsJumpPending(pending: boolean): void {
  godStyleSettingsPending = pending;
}

export function takeGodStyleSettingsJumpPending(): boolean {
  const value = godStyleSettingsPending;
  godStyleSettingsPending = false;
  return value;
}
