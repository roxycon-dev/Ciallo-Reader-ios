/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/mascot/MascotSpriteSheet.kt` (37 non-blank lines)
 *
 *   lines 15-25  object MascotSpriteSheet (9 R.drawable ids) → MascotSpriteSheet
 *   lines 28-36  object MascotAssetMap                      → MascotAssetMap
 *   line 39      enum class MascotMood                      → MascotMood
 *   lines 42-48  fun mascotMoodOf(drawableId)              → mascotMoodOf()
 *
 * ADAPTATION — `@DrawableRes Int` → string asset keys
 * ────────────────────────────────────────────────────
 * Android resource ids are build-generated ints; the web needs a stable string key
 * that the asset pipeline (`public/`) resolves.  The mapping is 1:1 and the
 * `mascotMoodOf` dispatch (which is the only behavioural code) is byte-identical.
 *
 * REVIEW 2026-10-06 — `mascotAssetUrl()` added: the five `res/drawable-nodpi/
 * mascot_*.webp` files were missing from `public/` (see the constant's docblock).
 */

/**
 * Roxy 吉祥物素材（新 5 张统一形象：蓝发双马尾巫师少女）。
 * 场景绑定已整体重置，按"动作语义"重新分配：
 *  - idle      待机站姿（默认/常驻/欢迎）
 *  - celebrate 举杖欢呼（成就/成功/奖励）
 *  - run       奔跑（加载/过渡/跳转）
 *  - reading   捧书阅读（阅读相关）
 *  - sad       低落站姿（空状态/异常/久未使用）
 * 旧属性名保留为兼容别名，但语义已映射到新素材。
 */
export const MascotSpriteSheet = {
  idleDrawable: 'mascot_idle',
  sadDrawable: 'mascot_sad',
  happyDrawable: 'mascot_celebrate',
  moveDrawable: 'mascot_run',
  readingDrawable: 'mascot_reading',
  celebrateDrawable: 'mascot_celebrate',
  runDrawable: 'mascot_run',
  /** 兼容旧引用：书签成功 = 欢呼 */
  bookmarkDrawable: 'mascot_celebrate',
} as const;

export type MascotAssetKey = (typeof MascotSpriteSheet)[keyof typeof MascotSpriteSheet];

/**
 * REVIEW 2026-10-06 — asset resolution (was MISSING, see report §2 F1).
 *
 * Kotlin `painterResource(R.drawable.mascot_idle)` resolves through AAPT to
 * `res/drawable-nodpi/mascot_idle.webp`. Those five files were **absent** from
 * `public/`, so every `<img src="mascot_*.png">` in the port 404'd (the
 * `onError` handlers hid the element, so the mascot silently disappeared).
 * The WebP files are now shipped byte-identical under `public/mascot/`.
 *
 * ADAPTATION — `@DrawableRes Int` → `<key>.webp` URL under `/mascot/`.
 * The extension is `.webp` on both sides (Android ships `.webp`); WKWebView
 * has supported WebP since iOS 14.
 */
export const MASCOT_ASSET_DIR = '/mascot/';
export const MASCOT_ASSET_EXTENSION = 'webp';

/** `painterResource(R.drawable.<key>)` → the URL of the shipped asset. */
export function mascotAssetUrl(key: MascotAssetKey | string): string {
  return `${MASCOT_ASSET_DIR}${key}.${MASCOT_ASSET_EXTENSION}`;
}

/** 场景 -> 素材映射表（新绑定，旧匹配逻辑不再作为默认）。 */
export const MascotAssetMap = {
  idle: MascotSpriteSheet.idleDrawable,
  sad: MascotSpriteSheet.sadDrawable,
  happy: MascotSpriteSheet.happyDrawable,
  move: MascotSpriteSheet.moveDrawable,
  reading: MascotSpriteSheet.readingDrawable,
  celebrate: MascotSpriteSheet.celebrateDrawable,
  run: MascotSpriteSheet.runDrawable,
} as const;

/** 吉祥物当前"情绪/动作"，用于静态图上的微动效。 */
export type MascotMood = 'IDLE' | 'READING' | 'RUN' | 'HAPPY' | 'SAD';

/** 由素材 id 推断情绪，供空状态等组件选择动效。 */
export function mascotMoodOf(drawableId: string): MascotMood {
  if (drawableId === MascotSpriteSheet.readingDrawable) return 'READING';
  if (drawableId === MascotSpriteSheet.celebrateDrawable) return 'HAPPY';
  if (drawableId === MascotSpriteSheet.runDrawable) return 'RUN';
  if (drawableId === MascotSpriteSheet.sadDrawable) return 'SAD';
  return 'IDLE';
}