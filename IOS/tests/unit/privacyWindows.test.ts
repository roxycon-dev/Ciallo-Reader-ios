/**
 * privacyWindows.test.ts — `ui/privacy/PrivacyWindows.kt` 纯逻辑端口的单元测试。
 *
 * 覆盖：枚举顺序/ordinal、键盘行布局、键位钳位、窗口度量阈值、抖动摆动表、
 *       中文文案逐字、隐私管理窗口门禁与提示文案。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/privacy/PrivacyWindows.kt
 * TS 源:    IOS/src/core/privacy/privacyWindows.ts
 */

import { describe, expect, it } from 'vitest';
import {
  ERROR_RGB,
  MINT_PRIMARY,
  ON_SURFACE_RGB,
  PIN_BACKSPACE_CONTENT_DESCRIPTION,
  PIN_DOTS_ALPHA_INACTIVE,
  PIN_DOTS_COUNT,
  PIN_DOTS_SETTLE_DAMPING,
  PIN_DOTS_SETTLE_STIFFNESS,
  PIN_DOTS_SHAKE_BASE_AMPLITUDE,
  PIN_DOTS_SHAKE_DAMPING,
  PIN_DOTS_SHAKE_SWINGS,
  PIN_DOTS_SHAKE_STIFFNESS,
  PIN_DOTS_SIZE_PX,
  PIN_DOTS_SPACING_PX,
  PIN_ENTRY_MODES,
  PIN_ENTRY_MODE_ORDINAL,
  PIN_ENTRY_TITLE,
  PIN_ERROR_CONFIRM_MISMATCH_IN_CHANGE,
  PIN_ERROR_CONFIRM_MISMATCH_IN_SETUP,
  PIN_ERROR_WRONG,
  PIN_INPUT_LENGTH,
  PIN_KEYPAD_BACKSPACE,
  PIN_KEYPAD_BLANK,
  PIN_KEYPAD_ROWS,
  PIN_OVERLAY_COMPACT_MAX_HEIGHT,
  PIN_SUBMIT_LENGTH,
  PRIVACY_MANAGE_ACTION_CHANGE_PIN,
  PRIVACY_MANAGE_ACTION_DISABLE,
  PRIVACY_MANAGE_CATEGORY_HINT,
  PRIVACY_MANAGE_DONE,
  PRIVACY_MANAGE_FAVORITES_LABEL,
  PRIVACY_MANAGE_INCOGNITO_LABEL,
  PRIVACY_MANAGE_LEAD,
  PRIVACY_MANAGE_TITLE,
  SCRIM_RGBA,
  SURFACE_RGB,
  appendPinDigit,
  applyCategoryProtectionToggle,
  backspacePinDigit,
  canAppendPinDigit,
  canBackspacePinDigit,
  categoryRowHintVisible,
  favoritesHintText,
  incognitoHintText,
  isPinKeypadBackspace,
  isPinKeypadBlank,
  pinDotsShakeAmplitude,
  pinDotsShakeSchedule,
  pinDotsShakeTargets,
  pinEntrySubtitle,
  pinOverlayMetrics,
  privacyManageEntryAllowed,
  springHalfSwingMs,
  springSegmentEase,
} from '../../src/core/privacy/privacyWindows';
import { PIN_LENGTH, PIN_MAX_FAILURES, PIN_RETRY_AFTER_MS } from '../../src/core/privacy/pinKdf';

describe('privacyWindows — Kotlin L181 `enum class PinEntryMode`', () => {
  it('keeps the Kotlin declaration order (ordinal is load-bearing)', () => {
    expect(PIN_ENTRY_MODES).toEqual(['SETUP', 'CONFIRM', 'VERIFY', 'CHANGE_OLD', 'CHANGE_NEW']);
  });

  it('maps every mode to its declaration index', () => {
    expect(PIN_ENTRY_MODE_ORDINAL.SETUP).toBe(0);
    expect(PIN_ENTRY_MODE_ORDINAL.CONFIRM).toBe(1);
    expect(PIN_ENTRY_MODE_ORDINAL.VERIFY).toBe(2);
    expect(PIN_ENTRY_MODE_ORDINAL.CHANGE_OLD).toBe(3);
    expect(PIN_ENTRY_MODE_ORDINAL.CHANGE_NEW).toBe(4);
    PIN_ENTRY_MODES.forEach((mode, index) => {
      expect(PIN_ENTRY_MODE_ORDINAL[mode]).toBe(index);
    });
  });

  it('has exactly 5 members (a new one must break this test)', () => {
    expect(PIN_ENTRY_MODES).toHaveLength(5);
  });
});

describe('privacyWindows — Kotlin L342-347 keypad rows', () => {
  it('reproduces the exact 4×3 grid', () => {
    expect(PIN_KEYPAD_ROWS).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['', '0', '⌫'],
    ]);
  });

  it('classifies the blank spacer and the backspace key', () => {
    expect(isPinKeypadBlank(PIN_KEYPAD_BLANK)).toBe(true);
    expect(isPinKeypadBlank('0')).toBe(false);
    expect(isPinKeypadBackspace(PIN_KEYPAD_BACKSPACE)).toBe(true);
    expect(isPinKeypadBackspace('')).toBe(false);
  });
});

describe('privacyWindows — Kotlin L351-372 key clamping', () => {
  it('caps entry at 6 digits (Kotlin `if (entered.length < 6)`)', () => {
    expect(appendPinDigit('', '1')).toBe('1');
    expect(appendPinDigit('12345', '6')).toBe('123456');
    // 满 6 位后按键无效：返回原串
    expect(appendPinDigit('123456', '7')).toBe('123456');
    expect(canAppendPinDigit('123456')).toBe(false);
    expect(canAppendPinDigit('12345')).toBe(true);
  });

  it('is a no-op on an empty entry (Kotlin `if (entered.isNotEmpty())`)', () => {
    expect(backspacePinDigit('123456')).toBe('12345');
    expect(backspacePinDigit('')).toBe('');
    expect(canBackspacePinDigit('')).toBe(false);
    expect(canBackspacePinDigit('1')).toBe(true);
  });

  it('matches the PrivacyManager PIN length', () => {
    expect(PIN_SUBMIT_LENGTH).toBe(6);
    expect(PIN_SUBMIT_LENGTH).toBe(PIN_LENGTH);
    expect(PIN_INPUT_LENGTH).toBe(PIN_LENGTH);
  });
});

describe('privacyWindows — Kotlin L280-348 overlay metrics', () => {
  it('switches to compact mode strictly below 560dp (Kotlin `maxHeight < 560.dp`)', () => {
    expect(PIN_OVERLAY_COMPACT_MAX_HEIGHT).toBe(560);
    expect(pinOverlayMetrics(559).compact).toBe(true);
    expect(pinOverlayMetrics(560).compact).toBe(false);
    expect(pinOverlayMetrics(561).compact).toBe(false);
  });

  it('preserves every compact/regular literal', () => {
    const compact = pinOverlayMetrics(400);
    expect(compact.keySize).toBe(52);
    expect(compact.rowSpace).toBe(7);
    expect(compact.keyGap).toBe(16);
    expect(compact.cardPaddingY).toBe(14);
    expect(compact.gapBeforeDots).toBe(10);
    expect(compact.gapAfterDots).toBe(3);
    expect(compact.gapBeforeKeys).toBe(3);
    expect(compact.showShield).toBe(false);
    expect(compact.labelFontSize).toBe(19);
    expect(compact.iconSize).toBe(19);

    const regular = pinOverlayMetrics(800);
    expect(regular.keySize).toBe(68);
    expect(regular.rowSpace).toBe(12);
    expect(regular.keyGap).toBe(22);
    expect(regular.cardPaddingX).toBe(24);
    expect(regular.cardPaddingY).toBe(24);
    expect(regular.gapBeforeDots).toBe(18);
    expect(regular.gapAfterDots).toBe(6);
    expect(regular.gapBeforeKeys).toBe(6);
    expect(regular.showShield).toBe(true);
    expect(regular.labelFontSize).toBe(22);
    expect(regular.iconSize).toBe(22);
  });

  it('keeps the fixed-height error slot (Kotlin L333 `Box(height = 16.dp)`)', () => {
    expect(pinOverlayMetrics(400).errorSlotHeight).toBe(16);
    expect(pinOverlayMetrics(900).errorSlotHeight).toBe(16);
  });

  it('keeps the shield gap and title gap (Kotlin L306 / L318)', () => {
    expect(pinOverlayMetrics(400).shieldGap).toBe(10);
    expect(pinOverlayMetrics(400).titleGap).toBe(4);
  });
});

describe('privacyWindows — Kotlin L75-88 PinDots shake', () => {
  it('uses 6 dots of 12dp with 14dp spacing and 0.45 inactive alpha', () => {
    expect(PIN_DOTS_COUNT).toBe(6);
    expect(PIN_DOTS_SIZE_PX).toBe(12);
    expect(PIN_DOTS_SPACING_PX).toBe(14);
    expect(PIN_DOTS_ALPHA_INACTIVE).toBe(0.45);
  });

  it('decays the amplitude 10 → 6.7 → 3.3 (Kotlin `10f * (1f - i / 3f)`)', () => {
    expect(PIN_DOTS_SHAKE_SWINGS).toBe(3);
    expect(PIN_DOTS_SHAKE_BASE_AMPLITUDE).toBe(10);
    expect(pinDotsShakeAmplitude(0)).toBe(10);
    expect(pinDotsShakeAmplitude(1)).toBeCloseTo(6.6666667, 5);
    expect(pinDotsShakeAmplitude(2)).toBeCloseTo(3.3333333, 5);
  });

  it('emits 3 symmetric swing pairs then a settle back to 0', () => {
    // Kotlin L82-87：repeat(3) { animateTo(amp); animateTo(-amp) } + animateTo(0f)
    const targets = pinDotsShakeTargets();
    expect(targets).toHaveLength(7);
    expect(targets[0]).toBe(10);
    expect(targets[1]).toBe(-10);
    expect(targets[2]).toBeCloseTo(6.6666667, 5);
    expect(targets[3]).toBeCloseTo(-6.6666667, 5);
    expect(targets[4]).toBeCloseTo(3.3333333, 5);
    expect(targets[5]).toBeCloseTo(-3.3333333, 5);
    // 末段必须归零（Kotlin L72-74 的修复点：不能停在 +8 / +3.3）
    expect(targets[6]).toBe(0);
  });

  it('keeps the Kotlin spring specs (0.15/1400 for swings, 0.6/900 for the settle)', () => {
    expect(PIN_DOTS_SHAKE_DAMPING).toBe(0.15);
    expect(PIN_DOTS_SHAKE_STIFFNESS).toBe(1400);
    expect(PIN_DOTS_SETTLE_DAMPING).toBe(0.6);
    expect(PIN_DOTS_SETTLE_STIFFNESS).toBe(900);
  });

  it('gives every segment a positive wall-clock duration and the right spring', () => {
    const schedule = pinDotsShakeSchedule();
    expect(schedule).toHaveLength(7);
    const swingMs = springHalfSwingMs(PIN_DOTS_SHAKE_DAMPING, PIN_DOTS_SHAKE_STIFFNESS);
    const settleMs = springHalfSwingMs(PIN_DOTS_SETTLE_DAMPING, PIN_DOTS_SETTLE_STIFFNESS);
    expect(swingMs).toBeGreaterThan(0);
    expect(settleMs).toBeGreaterThan(0);
    // 刚度更高的弹簧半摆更快
    expect(swingMs).toBeLessThan(settleMs);
    schedule.slice(0, 6).forEach((segment) => {
      expect(segment.ms).toBe(swingMs);
    });
    expect(schedule[6]?.ms).toBe(settleMs);
  });

  it('normalises the spring segment ease to 0 → 1 with rest at both ends', () => {
    const ease = springSegmentEase(PIN_DOTS_SHAKE_DAMPING, PIN_DOTS_SHAKE_STIFFNESS);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    // 欠阻尼（ζ = 0.15 < 1）→ 段内过冲（Compose 抖动手感的来源）
    let peak = 0;
    for (let i = 1; i < 200; i += 1) {
      peak = Math.max(peak, ease(i / 200));
    }
    expect(peak).toBeGreaterThan(1.1);
    // 单调起步（起点速度为 0）
    expect(ease(0.02)).toBeLessThan(0.02);
  });

  it('gives the stiffer spring a shorter segment than the softer one', () => {
    // 1.5 个半周期 = 1.5π / ω_d，ω_d = √k·√(1−ζ²)
    expect(springHalfSwingMs(0.15, 1400)).toBeCloseTo(127.36, 1);
    expect(springHalfSwingMs(0.6, 900)).toBeCloseTo(196.35, 1);
  });
});

describe('privacyWindows — Kotlin L308-328 copy (verbatim)', () => {
  it('keeps the five titles', () => {
    expect(PIN_ENTRY_TITLE).toEqual({
      SETUP: '设置隐私密码',
      CONFIRM: '再次输入以确认',
      VERIFY: '输入隐私密码',
      CHANGE_OLD: '输入当前密码',
      CHANGE_NEW: '输入新密码',
    });
  });

  it('routes the subtitle the way Kotlin `SETUP, CONFIRM -> …` does', () => {
    expect(pinEntrySubtitle('SETUP')).toBe('6 位数字 · 开启后受保护分类需要密码查看');
    expect(pinEntrySubtitle('CONFIRM')).toBe('6 位数字 · 开启后受保护分类需要密码查看');
    expect(pinEntrySubtitle('VERIFY')).toBe('6 位数字密码');
    expect(pinEntrySubtitle('CHANGE_OLD')).toBe('6 位数字密码');
    expect(pinEntrySubtitle('CHANGE_NEW')).toBe('6 位数字密码');
  });

  it('keeps the error strings and the backspace a11y label', () => {
    expect(PIN_ERROR_CONFIRM_MISMATCH_IN_SETUP).toBe('两次输入不一致，请重新设置');
    expect(PIN_ERROR_CONFIRM_MISMATCH_IN_CHANGE).toBe('两次输入不一致，请重新输入新密码');
    expect(PIN_ERROR_WRONG).toBe('密码错误，请重试');
    expect(PIN_BACKSPACE_CONTENT_DESCRIPTION).toBe('删除');
  });
});

describe('privacyWindows — Kotlin L386-633 manage window gates & copy', () => {
  it('requires both privacy mode and a verified PIN (Kotlin L388 KDoc)', () => {
    expect(
      privacyManageEntryAllowed({ privacyModeEnabled: true, pinVerified: true }),
    ).toBe(true);
    expect(
      privacyManageEntryAllowed({ privacyModeEnabled: true, pinVerified: false }),
    ).toBe(false);
    expect(
      privacyManageEntryAllowed({ privacyModeEnabled: false, pinVerified: true }),
    ).toBe(false);
    expect(
      privacyManageEntryAllowed({ privacyModeEnabled: false, pinVerified: false }),
    ).toBe(false);
  });

  it('branches the incognito hint exactly like Kotlin L495-496', () => {
    expect(incognitoHintText(true)).toBe('已开启 · 全部阅读不计入统计');
    expect(incognitoHintText(false)).toBe('开启后在线等全部阅读不计入统计');
  });

  it('branches the favorites hint exactly like Kotlin L534-535', () => {
    expect(favoritesHintText(true)).toBe('已开启 · 进入该板块需验证密码');
    expect(favoritesHintText(false)).toBe('开启后查看收藏要先验证密码');
  });

  it('shows the per-category hint only for protected rows (Kotlin L575)', () => {
    expect(categoryRowHintVisible(true)).toBe(true);
    expect(categoryRowHintVisible(false)).toBe(false);
    expect(PRIVACY_MANAGE_CATEGORY_HINT).toBe('无痕 · 阅读不计入统计');
  });

  it('keeps the remaining manage-window copy verbatim', () => {
    expect(PRIVACY_MANAGE_TITLE).toBe('隐私模式');
    expect(PRIVACY_MANAGE_DONE).toBe('完成');
    expect(PRIVACY_MANAGE_LEAD).toBe('开启密码保护的分类需要验证密码查看，其中的阅读不计入统计。');
    expect(PRIVACY_MANAGE_INCOGNITO_LABEL).toBe('无痕浏览');
    expect(PRIVACY_MANAGE_FAVORITES_LABEL).toBe('「我喜欢的」需要密码');
    expect(PRIVACY_MANAGE_ACTION_CHANGE_PIN).toBe('修改密码');
    expect(PRIVACY_MANAGE_ACTION_DISABLE).toBe('关闭隐私模式');
  });
});

describe('privacyWindows — category-protection gating (Kotlin L583-586 receiver)', () => {
  it('blocks the toggle when privacy mode is off', () => {
    const unlocked = new Set<number>([7]);
    const result = applyCategoryProtectionToggle({
      privacyModeEnabled: false,
      categoryId: 7,
      protectedOn: true,
      unlockedCategoryIds: unlocked,
    });
    expect(result.changed).toBe(false);
    expect(result.unlockedCategoryIds).toBe(unlocked);
  });

  it('applies the toggle when privacy mode is on', () => {
    const result = applyCategoryProtectionToggle({
      privacyModeEnabled: true,
      categoryId: 7,
      protectedOn: true,
      unlockedCategoryIds: new Set<number>(),
    });
    expect(result.changed).toBe(true);
    expect(result.unlockedCategoryIds.has(7)).toBe(false);
  });

  it('drops the unlock record when protection is turned back off', () => {
    const unlocked = new Set<number>([3, 7]);
    const result = applyCategoryProtectionToggle({
      privacyModeEnabled: true,
      categoryId: 7,
      protectedOn: false,
      unlockedCategoryIds: unlocked,
    });
    expect(result.changed).toBe(true);
    expect([...result.unlockedCategoryIds]).toEqual([3]);
    // 原集合不可变
    expect(unlocked.has(7)).toBe(true);
  });

  it('leaves other categories untouched', () => {
    const result = applyCategoryProtectionToggle({
      privacyModeEnabled: true,
      categoryId: 1,
      protectedOn: false,
      unlockedCategoryIds: new Set<number>([1, 2, 3]),
    });
    expect([...result.unlockedCategoryIds]).toEqual([2, 3]);
  });
});

describe('privacyWindows — theme tokens', () => {
  it('matches the light-theme Material colours used by the overlays', () => {
    // ui/theme/Color.kt: MintPrimary = colorScheme.primary
    expect(MINT_PRIMARY).toBe('#059669');
    // DarkCharcoal = 0xFF18191C
    expect(ON_SURFACE_RGB).toBe('24, 25, 28');
    // PureWhite / LightBg = 0xFFFFFFFF
    expect(SURFACE_RGB).toBe('255, 255, 255');
    // --color-danger = #dc2626
    expect(ERROR_RGB).toBe('220, 38, 38');
    // Kotlin L269 Color(0x59000000) → 0x59/255 ≈ 35%
    expect(SCRIM_RGBA).toBe('rgba(0, 0, 0, 0.35)');
  });

  it('reuses the PrivacyManager lockout constants rather than redeclaring them', () => {
    expect(PIN_MAX_FAILURES).toBe(5);
    expect(PIN_RETRY_AFTER_MS).toBe(30_000);
  });
});
