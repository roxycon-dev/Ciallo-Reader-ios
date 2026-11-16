export {
  CONFETTI_SEEDS,
  MASCOT_ASSET_DIR,
  MASCOT_ASSET_EXTENSION,
  MASCOT_DURATION_MS,
  MascotAnimationController,
  MascotAssetMap,
  MascotSpriteSheet,
  mascotAssetUrl,
  mascotMoodOf,
  popupAlphaComplete,
  popupAlphaStandard,
  popupScaleComplete,
  popupScaleStandard,
} from '../../../core/mascot/index';
export type { MascotAssetKey, MascotEvent, MascotMood } from '../../../core/mascot/index';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/mascot/MascotSpriteSheet.kt` (37 non-blank lines) — FULL PORT
 *   lines 15-25 `object MascotSpriteSheet`  → `MascotSpriteSheet` (core)
 *   lines 28-36 `object MascotAssetMap`     → `MascotAssetMap` (core)
 *   line 39      `enum class MascotMood`    → `MascotMood` (core)
 *   lines 42-48 `fun mascotMoodOf`          → `mascotMoodOf` (core)
 *
 * - `ui/mascot/MascotAnimationController.kt` (85 non-blank lines) — re-exported here
 *   because the sprite sheet and the event bus are consumed as one unit by the
 *   animation components (see `src/core/mascot/mascotEvents.ts` for the
 *   `MutableSharedFlow` → subscriber-Set adaptation).
 *
 * Header comment verbatim:
 *   Roxy 吉祥物素材（新 5 张统一形象：蓝发双马尾巫师少女）。
 *   场景绑定已整体重置，按“动作语义”重新分配：
 *     - idle      待机站姿（默认/常驻/欢迎）
 *     - celebrate 举杖欢呼（成就/成功/奖励）
 *     - run       奔跑（加载/过渡/跳转）
 *     - reading   捧书阅读（阅读相关）
 *     - sad       低落站姿（空状态/异常/久未使用）
 *   旧属性名保留为兼容别名，但语义已映射到新素材。
 *
 * REVIEW 2026-10-06 — re-exports `MASCOT_ASSET_DIR` / `MASCOT_ASSET_EXTENSION` /
 * `mascotAssetUrl`; the five `res/drawable-nodpi/mascot_*.webp` files were missing
 * from `public/` (see `src/core/mascot/mascotSpriteSheet.ts`).
 */