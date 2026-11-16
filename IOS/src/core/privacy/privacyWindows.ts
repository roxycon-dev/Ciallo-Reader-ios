/**
 * privacyWindows.ts — `ui/privacy/PrivacyWindows.kt` 的纯逻辑部分（可单测）。
 *
 * Kotlin 源: novel-reader/app/src/main/java/com/example/ui/privacy/PrivacyWindows.kt
 *            (633 行 / 618 非空)
 * TS 目标:   IOS/src/core/privacy/privacyWindows.ts
 * UI 配套:   IOS/src/ui/components/privacy/PrivacyWindows.tsx
 *           IOS/src/styles/privacyWindows.css
 *
 * 为什么 Kotlin 文件本身 100% 是 Compose：
 *   PrivacyWindows.kt 里没有任何独立的类/函数体，全部是 `@Composable`。
 *   本文件把其中**不依赖 Compose 的判定与数值**抽出来，使它们可单测；
 *   纯布局/绘制/手势代码留在 .tsx。二者的行号对应关系逐条列在下面，
 *   每条都能反向定位回 Kotlin 行。
 *
 * Kotlin → TS 映射（行号 = PrivacyWindows.kt）
 * ---------------------------------------------
 *   1      package com.example.ui.privacy        → 无对应物（TS 无包）
 *   3-59   import 块                              → 顶部 `import { … } from './pinKdf'`
 *   61-67  隐私模式 UI 设计语言注释               → 本文件头（压缩保留）
 *   59     `import com.example.ui.theme.MintPrimary`
 *                                                 → `MINT_PRIMARY`（值取 theme.css
 *                                                   `--color-primary` = #059669）
 *   75-88  `PinDots` 的 Animatable 摆动           → `pinDotsShakeTargets()` /
 *                                                   `pinDotsShakeAmplitude()` /
 *                                                   `springHalfSwingMs()`
 *   89-92  `Row(horizontalArrangement = spacedBy(14.dp))`
 *                                                 → `PIN_DOTS_SPACING_PX = 14`
 *   93-108 `repeat(6) { Box(12.dp, alpha 1f/0.45f …) }`
 *                                                 → `PIN_DOTS_COUNT = 6` /
 *                                                   `PIN_DOTS_SIZE_PX = 12` /
 *                                                   `PIN_DOTS_ALPHA_INACTIVE = 0.45`
 *   181    `enum class PinEntryMode`              → `PinEntryMode` + `PIN_ENTRY_MODES`
 *   197-209 `entered / error / firstSetup /
 *            currentMode / changeFlow / fun reset()`→ `PinFlowState` + `initialPinFlow()`
 *                                                   + `resetPinFlow()`（内部）
 *   211-256 `LaunchedEffect(entered, currentMode)` → `advancePinFlow()`
 *            （把 when(currentMode) 的每个分支变成
 *             PinFlowAction 判别联合，副作用留在 .tsx）
 *   281-283 `BoxWithConstraints { compact / keySize / rowSpace }`
 *                                                 → `pinOverlayMetrics()`
 *   294    `PaddingValues(horizontal = 24.dp,
 *            vertical = if (compact) 14.dp else 24.dp)`
 *                                                 → `PinOverlayMetrics.cardPaddingX/Y`
 *   308-314 标题 `when(currentMode)`              → `PIN_ENTRY_TITLE`
 *   320-324 副标题 `when(currentMode)`            → `PIN_ENTRY_SUBTITLE`
 *   329/332/340 `Spacer(10|18 / 3|6 / 3|6)`      → `PinOverlayMetrics.gapBeforeDots /
 *                                                 gapAfterDots / gapBeforeKeys`
 *   333    `Box(Modifier.height(16.dp))`（错误占位）→ `PinOverlayMetrics.errorSlotHeight`
 *   341-347 `Column(spacedBy(rowSpace))` + 4 行键位表 → `PIN_KEYPAD_ROWS`
 *   348    `Row(spacedBy(if (compact) 16.dp else 22.dp))`
 *                                                 → `PinOverlayMetrics.keyGap`
 *   351-372 键位分支（空位 / ⌫ / 数字）与 onClick → `appendPinDigit()` /
 *             `backspacePinDigit()`（钳位逻辑纯化）+ 布局留在 .tsx
 *   139/175 字号与图标尺寸 `if (keySize < 60.dp)`
 *                                                 → `PinOverlayMetrics.labelFontSize /
 *                                                   iconSize`
 *   386-388「进入前提：隐私模式已开启且已验证 PIN」→ `privacyManageEntryAllowed()`
 *   463    说明文案                           → `PRIVACY_MANAGE_LEAD`
 *   446/451 「隐私模式」/「完成」               → `PRIVACY_MANAGE_TITLE` /
 *                                                 `PRIVACY_MANAGE_DONE`
 *   490-499 无痕浏览开关行（含 L495/496 文案分支）→ `PRIVACY_MANAGE_INCOGNITO_*` +
 *                                                 `incognitoHintText()`
 *   528-538「我喜欢的」开关行（含 L534/535 分支）→ `PRIVACY_MANAGE_FAVORITES_*` +
 *                                                 `favoritesHintText()`
 *   555-587 分类行（Lock/LockOpen + L577 提示）  → `categoryRowHintVisible()` /
 *                                                 `PRIVACY_MANAGE_CATEGORY_HINT`
 *   583-586 `AppSwitch(onCheckedChange = { onToggleProtected(cat, it) })`
 *                                                 → `applyCategoryProtectionToggle()`
 *           （接收侧 MainViewModel.setCategoryProtected 的早退 + 取消解锁）
 *   605-626 底部两枚动作键文案                 → `PRIVACY_MANAGE_ACTION_CHANGE_PIN` /
 *                                                 `PRIVACY_MANAGE_ACTION_DISABLE`
 *
 * PIN 失败锁定接线（PrivacyManager.kt，不是本文件）
 * --------------------------------------------------
 *   隐私模式 UI 本身不记失败次数——Kotlin 侧由 `data/PrivacyManager.kt` 负责：
 *     L73  `if (System.currentTimeMillis() < prefs.getLong("pin_retry_after", 0)) return false`
 *     L79-83 failures++ / failures >= 5 → retry_after = now + 30_000
 *   本文件**不重新实现 KDF 或锁定**（`./pinKdf` 已是 PrivacyManager 的权威移植），
 *   只提供 UI 需要的读取与接线：
 *     `readPinLockout()`      → 读 failures / retry_after 并算剩余毫秒
 *     `verifyPinWithLockout()`→ 锁定期内直接短路（与 L73 同语义），并回传锁定态
 *   常量 `PIN_MAX_FAILURES` / `PIN_RETRY_AFTER_MS` 一律从 `./pinKdf` 引入，
 *   不在本文件重新声明，避免两份真值。
 *
 * Skipped（未移植 + 原因）
 * ------------------------
 *   L3-59   Compose / Material / 交互源 import     → TS 无这些运行时依赖
 *   L56     `CategoryEntity` 全字段               → 只用到 `id / name / isProtected`，
 *                                                  由 .tsx 的 `PrivacyCategory` 声明
 *   L121-134 `GlassPinKey` 的 pressed 缩放        → Compose `collectIsPressedAsState`
 *                                                  + `animateFloatAsState(spring)`；
 *                                                  Web 端由 CSS `:active` + transition
 *                                                  承担（见 privacyWindows.css），
 *                                                  数值 0.94f / spring(0.6, 900) 保留
 *   L155-170 同上（图标键）                       → 同上
 *   L167/173 `background(surface 0.55f)` / `onSurface 0.8f` → CSS rgba（见 .css）
 *   L258/405 `BackHandler(onBack = onDismiss)`    → Web 无系统返回键；用 `Escape`
 *                                                  键桥（.tsx 内），见报告
 *   L260-264/407-411 `Box(fillMaxSize, Center)`  → CSS `position:fixed` + flex 居中
 *   L265-275/412-422 `ScrimEntrance` + `Color(0x59000000)`
 *                                                 → 复用 `ScrimEntrance` 组件 +
 *                                                  CSS `rgba(0,0,0,0.35)`（0x59 = 35%）
 *   L276-381/423-631 `DialogEntrance` 外壳       → 复用 `DialogEntrance` 组件
 *   L284-295 `GlassCard(shape = RoundedCornerShape(28.dp), contentPadding = …)`
 *                                                 → 共享 `GlassCard.tsx` 的
 *                                                   `radius={28}` / `padding`
 *   L284-292/424-432 卡片上的 `clickable { 拦截穿透点击 }`
 *                                                 → CSS `pointer-events` 分层（.css）
 *   L286-287 `fillMaxWidth().padding(horizontal = 36.dp)`
 *                                                 → CSS `padding-inline: 36px`
 *   L426-427 `fillMaxHeight(0.72f)`              → CSS `max-height: 72%`
 *   L436-460 `Column` / `Row` / `Text` / `Icon` / `Modifier.weight(1f)`
 *                                                 → .tsx 的 flex 布局 + .css
 *   L469-471 / L508-510 中文段落注释             → 本文件头对应小节已转述
 *   L547-589 `LazyColumn(weight(1f))` + `items(list, key = { it.id })`
 *                                                 → `overflow-y:auto` 容器 +
 *                                                   React `key={cat.id}`（.tsx）
 *   L465/498/538/579 `onSurface.copy(alpha = …)` → CSS rgba（.css）
 *   L601/617 `clickableWithFeedback`             → CSS `:active` 缩放（.css）
 *
 * 重复端口的收敛（重要）
 * ---------------------------------------
 * 同一份 Kotlin 曾被两个并行 agent 各移植一次：`PrivacySetupOverlay.tsx`（只做了
 * 键盘层，无 core、无 CSS）与本文件这一组三件套。本文件是**权威版**：枚举顺序、
 * 错误文案、锁定语义、度量阈值以本文件为准。唯一已知的数值分歧是抖动摆动的
 * 每段挂钟时长，见 `springHalfSwingMs()` 上方注释。`PrivacySetupOverlay.tsx`
 * 已删除 —— 它把每段硬编码成 123 ms / 256 ms，而本函数从 ζ/k 闭式解出
 * 127.36 ms / 196.35 ms（弹簧参数与振幅两版一致，只有挂钟近似不同）。
 */

import {
  PIN_LENGTH,
  PIN_MAX_FAILURES,
  PIN_RETRY_AFTER_MS,
  verifyPin,
  type PinStore,
} from './pinKdf';

/* ═══════════════════════════════════════════════════════════════════════════
 * 主题常量
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Kotlin L59 `import com.example.ui.theme.MintPrimary`。
 * `Color.kt:9` 定义 `MintPrimary = MaterialTheme.colorScheme.primary`；
 * 浅色主题 primary = #059669（与 `styles/theme.css` 的 `--color-primary` 同源）。
 */
export const MINT_PRIMARY = '#059669';

/** Kotlin `MaterialTheme.colorScheme.surface`（浅色主题 = 纯白）。 */
export const SURFACE_RGB = '255, 255, 255';

/** Kotlin `MaterialTheme.colorScheme.onSurface`（= `DarkCharcoal` 0xFF18191C）。 */
export const ON_SURFACE_RGB = '24, 25, 28';

/** Kotlin `MaterialTheme.colorScheme.error`（= `--color-danger` 0xFFDC2626）。 */
export const ERROR_RGB = '220, 38, 38';

/** Kotlin L269 遮罩色 `Color(0x59000000)`（0x59 = 89/255 ≈ 35%）。 */
export const SCRIM_RGBA = 'rgba(0, 0, 0, 0.35)';

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L181 — `enum class PinEntryMode { SETUP, CONFIRM, VERIFY, CHANGE_OLD, CHANGE_NEW }`
 * 声明顺序即 ordinal，顺序不可改。
 * ═══════════════════════════════════════════════════════════════════════════ */

export type PinEntryMode = 'SETUP' | 'CONFIRM' | 'VERIFY' | 'CHANGE_OLD' | 'CHANGE_NEW';

/** Kotlin L181 的声明顺序（ordinal = 下标）。 */
export const PIN_ENTRY_MODES: readonly PinEntryMode[] = [
  'SETUP',
  'CONFIRM',
  'VERIFY',
  'CHANGE_OLD',
  'CHANGE_NEW',
];

/** Kotlin L181 的 `ordinal`。 */
export const PIN_ENTRY_MODE_ORDINAL: Readonly<Record<PinEntryMode, number>> = {
  SETUP: 0,
  CONFIRM: 1,
  VERIFY: 2,
  CHANGE_OLD: 3,
  CHANGE_NEW: 4,
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L342-347 — 键盘行布局
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L346 的 `""` 空位占键（与 `keySize` 同尺寸的 Spacer）。 */
export const PIN_KEYPAD_BLANK = '';

/** Kotlin L346 的删除键字面量（同时是绘制分支的判据）。 */
export const PIN_KEYPAD_BACKSPACE = '⌫';

/** Kotlin L342-346：`listOf(listOf("1","2","3"), …, listOf("","0","⌫"))`。 */
export const PIN_KEYPAD_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [PIN_KEYPAD_BLANK, '0', PIN_KEYPAD_BACKSPACE],
];

/** Kotlin L211-213 的提交门槛：`if (entered.length != 6) return`。 */
export const PIN_SUBMIT_LENGTH = 6;

/** Kotlin L351 空位键的类型判别。 */
export function isPinKeypadBlank(key: string): boolean {
  return key === PIN_KEYPAD_BLANK;
}

/** Kotlin L352 的删除键判别。 */
export function isPinKeypadBackspace(key: string): boolean {
  return key === PIN_KEYPAD_BACKSPACE;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L351-372 — 键位钳位（纯函数；UI 布局在 .tsx）
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Kotlin L366-371：`if (entered.length < 6) { entered += key; error = null }`。
 * 满 6 位后按键无效 —— 返回原串（钳位）。
 */
export function appendPinDigit(entered: string, key: string): string {
  return entered.length < PIN_SUBMIT_LENGTH ? entered + key : entered;
}

/**
 * Kotlin L357-360：`if (entered.isNotEmpty()) { entered = entered.dropLast(1); error = null }`。
 * 空串上删除无效 —— 返回原串（钳位）。
 */
export function backspacePinDigit(entered: string): string {
  return entered.length > 0 ? entered.slice(0, -1) : entered;
}

/** Kotlin L367 的判据本身，便于 UI 直接复用而不必先算长度。 */
export function canAppendPinDigit(entered: string): boolean {
  return entered.length < PIN_SUBMIT_LENGTH;
}

/** Kotlin L357 的判据本身。 */
export function canBackspacePinDigit(entered: string): boolean {
  return entered.length > 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L280-348 + L139 + L175 — 窗口度量（BoxWithConstraints 的数值决策）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L281 `val compact = maxHeight < 560.dp`。 */
export const PIN_OVERLAY_COMPACT_MAX_HEIGHT = 560;

export interface PinOverlayMetrics {
  /** Kotlin L281。 */
  readonly compact: boolean;
  /** Kotlin L282 `if (compact) 52.dp else 68.dp`。 */
  readonly keySize: number;
  /** Kotlin L283 `if (compact) 7.dp else 12.dp`（行间距）。 */
  readonly rowSpace: number;
  /** Kotlin L348 `if (compact) 16.dp else 22.dp`（行内键间距）。 */
  readonly keyGap: number;
  /** Kotlin L294 `horizontal = 24.dp`（GlassCard contentPadding 水平）。 */
  readonly cardPaddingX: number;
  /** Kotlin L294 `vertical = if (compact) 14.dp else 24.dp`。 */
  readonly cardPaddingY: number;
  /** Kotlin L329 `Spacer(if (compact) 10.dp else 18.dp)`。 */
  readonly gapBeforeDots: number;
  /** Kotlin L332 `Spacer(if (compact) 3.dp else 6.dp)`。 */
  readonly gapAfterDots: number;
  /** Kotlin L340 `Spacer(if (compact) 3.dp else 6.dp)`。 */
  readonly gapBeforeKeys: number;
  /** Kotlin L333 `Box(Modifier.height(16.dp))`（错误提示占位，固定高度）。 */
  readonly errorSlotHeight: number;
  /** Kotlin L306 `Spacer(Modifier.height(10.dp))`（盾牌图标下）。 */
  readonly shieldGap: number;
  /** Kotlin L318 `Spacer(Modifier.height(4.dp))`（标题下）。 */
  readonly titleGap: number;
  /** Kotlin L139 `if (keySize < 60.dp) 19.sp else 22.sp`。 */
  readonly labelFontSize: number;
  /** Kotlin L175 `size(if (keySize < 60.dp) 19.dp else 22.dp)`。 */
  readonly iconSize: number;
  /** Kotlin L299-304 紧凑模式下去掉盾牌图标。 */
  readonly showShield: boolean;
}

/**
 * Kotlin L280-348 的 `BoxWithConstraints { … }` 数值决策，纯函数化。
 *
 * ⚠️ 本项目 dp 与 px 按 1:1 映射（与 `ComicReaderPage.tsx` 同一约定），
 * 因此调用方直接传容器高度像素值即可。
 */
export function pinOverlayMetrics(maxHeight: number): PinOverlayMetrics {
  const compact = maxHeight < PIN_OVERLAY_COMPACT_MAX_HEIGHT;
  const keySize = compact ? 52 : 68;
  const rowSpace = compact ? 7 : 12;
  return {
    compact,
    keySize,
    rowSpace,
    keyGap: compact ? 16 : 22,
    cardPaddingX: 24,
    cardPaddingY: compact ? 14 : 24,
    gapBeforeDots: compact ? 10 : 18,
    gapAfterDots: compact ? 3 : 6,
    gapBeforeKeys: compact ? 3 : 6,
    errorSlotHeight: 16,
    shieldGap: 10,
    titleGap: 4,
    labelFontSize: keySize < 60 ? 19 : 22,
    iconSize: keySize < 60 ? 19 : 22,
    showShield: !compact,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L71-108 — PinDots 抖动（摆动表 + 弹簧参数）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L93 `repeat(6)`。 */
export const PIN_DOTS_COUNT = 6;
/** Kotlin L96 `.size(12.dp)`。 */
export const PIN_DOTS_SIZE_PX = 12;
/** Kotlin L91 `horizontalArrangement = Arrangement.spacedBy(14.dp)`。 */
export const PIN_DOTS_SPACING_PX = 14;
/** Kotlin L98 `alpha = if (active) 1f else 0.45f`。 */
export const PIN_DOTS_ALPHA_INACTIVE = 0.45;

/** Kotlin L82 `repeat(3)`。 */
export const PIN_DOTS_SHAKE_SWINGS = 3;
/** Kotlin L83 `val amp = 10f * (1f - i / 3f)` 的基准振幅。 */
export const PIN_DOTS_SHAKE_BASE_AMPLITUDE = 10;
/** Kotlin L84-85 `spring(dampingRatio = 0.15f, stiffness = 1400f)`。 */
export const PIN_DOTS_SHAKE_DAMPING = 0.15;
export const PIN_DOTS_SHAKE_STIFFNESS = 1400;
/** Kotlin L87 `spring(dampingRatio = 0.6f, stiffness = 900f)`。 */
export const PIN_DOTS_SETTLE_DAMPING = 0.6;
export const PIN_DOTS_SETTLE_STIFFNESS = 900;

/**
 * Kotlin L82-83：`repeat(3) { i -> val amp = 10f * (1f - i / 3f) }`。
 * i ∈ {0,1,2} → 10 / 6.666… / 3.333…（注释里的「10 → 6.7 → 3.3」）。
 */
export function pinDotsShakeAmplitude(index: number): number {
  return PIN_DOTS_SHAKE_BASE_AMPLITUDE * (1 - index / PIN_DOTS_SHAKE_SWINGS);
}

/**
 * Kotlin L82-87 的完整摆动目标序列（`translationX`，px）：
 *   +amp, −amp, +amp, −amp, +amp, −amp, 0
 * 即 L84/L85 成对 `animateTo`，最后一次是 L87 的 `animateTo(0f, spring(0.6, 900))`。
 *
 * 2026-09-21 的 Kotlin 注释（L72-74）说明了为什么不能回退成
 * `animateFloatAsState` + `shake > 0.5f`：那样圆点会从 −8 跳到 +8 之后永久停在
 * +8。序列本身（含末尾归零）是这次修复的全部内容，务必不要省掉最后的 0。
 */
export function pinDotsShakeTargets(): number[] {
  const targets: number[] = [];
  for (let i = 0; i < PIN_DOTS_SHAKE_SWINGS; i += 1) {
    const amp = pinDotsShakeAmplitude(i);
    targets.push(amp, -amp);
  }
  targets.push(0);
  return targets;
}

/**
 * 单段 `animateTo(target, spring(ζ, k))` 的挂钟时长，单位 ms。
 *
 * Kotlin 的 Compose `spring`（mass = 1，欠阻尼 ζ<1）阶跃响应是
 *   `x(t) = 1 − e^(−ζω₀t)·(cos ω_d t + (ζω₀/ω_d)·sin ω_d t)`，
 *   `ω₀ = √k`、`ω_d = ω₀·√(1−ζ²)`。
 * 其极值点（过冲峰）在 `t_peak = π / ω_d`；取 **1.5 个半周期**（`1.5π/ω_d`）
 * 作为一段的可视时长 —— 这正好覆盖「冲到过冲峰 + 回落到目标」，与
 * `Animatable.animateTo` 在弹簧收敛前播出的可见轨迹同形，且段末速度归零。
 *
 * ⚠️ 已删除的重复端口 `PrivacySetupOverlay.tsx` 曾把每段硬编码成
 * 123 ms / 256 ms 的近似值。本函数给出 **127.36 ms / 196.35 ms**
 * （摆动 / 归位），是从上面的 ζ/k 直接解出来的，不是拟合常数。
 * 弹簧参数（ζ/k）与振幅（10 → 6.7 → 3.3）两版完全一致，只有每段的挂钟近似不同，
 * 因此只保留本函数这一份真值。
 */
export function springHalfSwingMs(dampingRatio: number, stiffness: number): number {
  return springHalfSwingSeconds(dampingRatio, stiffness) * 1000;
}

/** `springHalfSwingMs` 的秒版本（1.5 个半周期）。 */
export function springHalfSwingSeconds(dampingRatio: number, stiffness: number): number {
  const omega0 = Math.sqrt(stiffness);
  const omegaD = omega0 * Math.sqrt(1 - dampingRatio * dampingRatio);
  return (1.5 * Math.PI) / omegaD;
}

/**
 * 归一化的弹簧插值曲线：t∈[0,1] → y∈[0,1]，y(0)=0、y(1)=1（两端速度归零），
 * 中途带欠阻尼过冲（ζ=0.15 时过冲约 +62% 的段长，正是 Compose 抖动手感的来源）。
 * 归一化方式：把整段轨迹除以段末值，保证逐段精确落在目标上。
 * UI 直接用它做每段 rAF 插值，避免各处重复实现弹簧解。
 */
export function springSegmentEase(
  dampingRatio: number,
  stiffness: number,
): (t: number) => number {
  const omega0 = Math.sqrt(stiffness);
  const omegaD = omega0 * Math.sqrt(1 - dampingRatio * dampingRatio);
  const zetaOmega0 = dampingRatio * omega0;
  const ratio = zetaOmega0 / omegaD;
  const duration = springHalfSwingSeconds(dampingRatio, stiffness);
  const step = (t: number): number => {
    const s = t * duration;
    const envelope = Math.exp(-zetaOmega0 * s);
    return 1 - envelope * (Math.cos(omegaD * s) + ratio * Math.sin(omegaD * s));
  };
  // 段末值：归一化分母（t=1.5π → cos=0、sin=−1）
  const end = step(1);
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return step(t) / end;
  };
}

/**
 * 抖动摆动每段的目标值 + 时长，供 .tsx 的 rAF 驱动器直接消费。
 * 段数 = `PIN_DOTS_SHAKE_SWINGS * 2 + 1`（前 2N 段用 L84/85 的弹簧，末段用 L87 的）。
 */
export function pinDotsShakeSchedule(): ReadonlyArray<{
  readonly to: number;
  readonly ms: number;
  readonly ease: (t: number) => number;
}> {
  const swingEase = springSegmentEase(PIN_DOTS_SHAKE_DAMPING, PIN_DOTS_SHAKE_STIFFNESS);
  const settleEase = springSegmentEase(PIN_DOTS_SETTLE_DAMPING, PIN_DOTS_SETTLE_STIFFNESS);
  const swingMs = springHalfSwingMs(PIN_DOTS_SHAKE_DAMPING, PIN_DOTS_SHAKE_STIFFNESS);
  const settleMs = springHalfSwingMs(PIN_DOTS_SETTLE_DAMPING, PIN_DOTS_SETTLE_STIFFNESS);
  const targets = pinDotsShakeTargets();
  return targets.map((to, index) => {
    const last = index === targets.length - 1;
    return { to, ms: last ? settleMs : swingMs, ease: last ? settleEase : swingEase };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L308-328 — 文案（逐字保留，含中点「·」）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L308-314 的标题 `when(currentMode)`。 */
export const PIN_ENTRY_TITLE: Readonly<Record<PinEntryMode, string>> = {
  SETUP: '设置隐私密码',
  CONFIRM: '再次输入以确认',
  VERIFY: '输入隐私密码',
  CHANGE_OLD: '输入当前密码',
  CHANGE_NEW: '输入新密码',
};

/** Kotlin L321-322：SETUP / CONFIRM 共用的副标题。 */
export const PIN_ENTRY_SUBTITLE_SETUP = '6 位数字 · 开启后受保护分类需要密码查看';

/** Kotlin L323：其余模式共用的副标题。 */
export const PIN_ENTRY_SUBTITLE_VERIFY = '6 位数字密码';

/** Kotlin L320-324 的副标题 `when(currentMode)`。 */
export function pinEntrySubtitle(mode: PinEntryMode): string {
  return mode === 'SETUP' || mode === 'CONFIRM'
    ? PIN_ENTRY_SUBTITLE_SETUP
    : PIN_ENTRY_SUBTITLE_VERIFY;
}

/** Kotlin L229：改密码二次确认不一致。 */
export const PIN_ERROR_CONFIRM_MISMATCH_IN_CHANGE = '两次输入不一致，请重新输入新密码';

/** Kotlin L232：首次设置二次确认不一致。 */
export const PIN_ERROR_CONFIRM_MISMATCH_IN_SETUP = '两次输入不一致，请重新设置';

/** Kotlin L237 / L243：密码错误。 */
export const PIN_ERROR_WRONG = '密码错误，请重试';

/** Kotlin L354 `contentDescription = "删除"`。 */
export const PIN_BACKSPACE_CONTENT_DESCRIPTION = '删除';

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L197-256 — PIN 输入状态机（`LaunchedEffect(entered, currentMode)`）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L197-204 的五个 `remember { mutableStateOf(…) }`。 */
export interface PinFlowState {
  readonly entered: string;
  readonly error: string | null;
  readonly firstSetup: string | null;
  readonly currentMode: PinEntryMode;
  /** Kotlin L204「标记当前 CONFIRM 阶段属于『修改密码』流程」。 */
  readonly changeFlow: boolean;
}

/** Kotlin L206-209 `fun reset(msg: String? = null) { entered = ""; error = msg }`。 */
export function resetPinFlow(state: PinFlowState, msg: string | null = null): PinFlowState {
  return { ...state, entered: '', error: msg };
}

/** Kotlin `remember { mutableStateOf(mode) }` 的初值。 */
export function initialPinFlow(mode: PinEntryMode): PinFlowState {
  return { entered: '', error: null, firstSetup: null, currentMode: mode, changeFlow: false };
}

/**
 * Kotlin L212-256 的 `when(currentMode)`，逐分支变成数据。
 *
 * - `'none'`   ← L213 `if (entered.length != 6) return`（无 `next`），
 *              以及 L215-219 / L222-234 / L245-254 三个**纯状态**分支
 *              （带 `next`：把要落地的状态交回调用方，无副作用）。
 * - `'set'`    ← L221 `if (entered == firstSetup) onPinSet(entered)`
 * - `'verify'` ← L236-244 `VERIFY` / `CHANGE_OLD` 两个 `onPinVerified` 分支
 *
 * `'verify'` 同时给出成功/失败两条后继状态，因为 Kotlin 的两个分支里
 * `onDismiss()` 与 `reset(msg)` 是同步发生的，调用方需要按结果二选一：
 *   VERIFY      成功 → 直接 `onDismiss()`（不再 reset）
 *   VERIFY      失败 → `reset("密码错误，请重试")`
 *   CHANGE_OLD  成功 → `currentMode = CHANGE_NEW` + `reset()`（空错误）
 *   CHANGE_OLD  失败 → `reset("密码错误，请重试")`
 *
 * ⚠️ `'set'` 分支的 `next` 原样返回 state（Kotlin L221 不做任何 reset），
 * 调用方必须自己保证「提交中不重入」，否则 `entered` 仍是 6 位会再次触发。
 */
export type PinFlowAction =
  | { readonly type: 'none'; readonly next?: PinFlowState }
  | { readonly type: 'set'; readonly pin: string; readonly next: PinFlowState }
  | {
      readonly type: 'verify'
      readonly pin: string
      /** 校验通过后落地的状态。 */
      readonly nextOnSuccess: PinFlowState
      /** 校验失败后落地的状态。 */
      readonly nextOnFailure: PinFlowState
      /** Kotlin L237：仅 VERIFY 模式校验通过后需要关闭窗口。 */
      readonly dismissOnSuccess: boolean
    };

/**
 * Kotlin L212-256 的纯逻辑部分。
 *
 * ⚠️ 注意 Kotlin 的门槛**只看长度**（`entered.length != 6`），不看是否全为数字；
 * 键盘只能输入数字（L342-346 的键表），所以两者等价。这里保持原样，不加严。
 */
export function advancePinFlow(state: PinFlowState): PinFlowAction {
  // Kotlin L213 `if (entered.length != 6) return@LaunchedEffect`
  if (state.entered.length !== PIN_SUBMIT_LENGTH) {
    return { type: 'none' };
  }
  const entered = state.entered;
  switch (state.currentMode) {
    case 'SETUP': {
      // Kotlin L215-219
      //   firstSetup = entered; currentMode = CONFIRM; reset()
      const next: PinFlowState = {
        ...resetPinFlow(state),
        firstSetup: entered,
        currentMode: 'CONFIRM',
      };
      // 状态机本身不发起副作用：把下一帧要落地的状态带出去，由 .tsx 的
      // `setState(...)` 消费（advancePinFlow 连续调用两次的结果与 Kotlin 递归
      // 重启 LaunchedEffect 的结果一致）。
      return { type: 'none', next };
    }
    case 'CONFIRM': {
      // Kotlin L220-235
      if (entered === state.firstSetup) {
        // L221 `onPinSet(entered)` —— 不 reset，状态原样推进（调用方负责防重入）。
        return { type: 'set', pin: entered, next: state };
      }
      // L223-234
      const inChangeFlow = state.changeFlow;
      const base: PinFlowState = {
        ...state,
        firstSetup: null,
        changeFlow: false,
      };
      const next = inChangeFlow
        ? {
            ...resetPinFlow(base, PIN_ERROR_CONFIRM_MISMATCH_IN_CHANGE),
            currentMode: 'CHANGE_NEW' as PinEntryMode,
          }
        : {
            ...resetPinFlow(base, PIN_ERROR_CONFIRM_MISMATCH_IN_SETUP),
            currentMode: 'SETUP' as PinEntryMode,
          };
      return { type: 'none', next };
    }
    case 'VERIFY': {
      // Kotlin L236-238
      //   if (onPinVerified(entered)) onDismiss() else reset("密码错误，请重试")
      return {
        type: 'verify',
        pin: entered,
        // 成功 → 直接关闭窗口，不再 reset（Kotlin 未调用 reset）。
        nextOnSuccess: state,
        nextOnFailure: resetPinFlow(state, PIN_ERROR_WRONG),
        dismissOnSuccess: true,
      };
    }
    case 'CHANGE_OLD': {
      // Kotlin L239-244
      //   成功 → currentMode = CHANGE_NEW; reset()  ｜ 失败 → reset("密码错误，请重试")
      return {
        type: 'verify',
        pin: entered,
        nextOnSuccess: {
          ...resetPinFlow(state),
          currentMode: 'CHANGE_NEW',
        },
        nextOnFailure: resetPinFlow(state, PIN_ERROR_WRONG),
        dismissOnSuccess: false,
      };
    }
    case 'CHANGE_NEW': {
      // Kotlin L245-254（2026-09-21 修复：与首次设置同规格，二次确认）
      //   firstSetup = entered; changeFlow = true; currentMode = CONFIRM; reset()
      const next: PinFlowState = {
        ...resetPinFlow(state),
        firstSetup: entered,
        changeFlow: true,
        currentMode: 'CONFIRM',
      };
      return { type: 'none', next };
    }
    default: {
      // 不可达：PinEntryMode 是穷尽联合。保持 exhaustive 以便新增成员时编译报错。
      const exhaustive: never = state.currentMode;
      void exhaustive;
      return { type: 'none' };
    }
  }
}

/**
 * Kotlin L212-256 的**纯状态**推进循环。
 *
 * Kotlin 里 `LaunchedEffect(entered, currentMode)` 每次重新启动都会把整个
 * `when(currentMode)` 重跑一遍；由于每个纯分支都把 `entered` 清空（`reset()`），
 * 链式推进最多两步就停。UI 层用它把「无副作用」的那部分在 render 期算完，
 * effect 里只留 `onPinSet` / `onPinVerified` 两个真副作用
 * （这是 React 19 `set-state-in-effect` 规则要求的形状）。
 *
 * `maxSteps` 只是防御性上限：正常路径 ≤ 2 步。
 */
export function settlePinFlow(state: PinFlowState, maxSteps = 8): PinFlowState {
  let current = state;
  for (let step = 0; step < maxSteps; step += 1) {
    const action = advancePinFlow(current);
    if (action.type !== 'none' || action.next === undefined) return current;
    if (action.next === current) return current;
    current = action.next;
  }
  return current;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Kotlin L211-256 — PIN 输入窗口门禁与分类保护门禁（PrivacyManageOverlay）
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Kotlin L446 标题。 */
export const PRIVACY_MANAGE_TITLE = '隐私模式';
/** Kotlin L451 右上角动作。 */
export const PRIVACY_MANAGE_DONE = '完成';
/** Kotlin L463 顶部说明。 */
export const PRIVACY_MANAGE_LEAD = '开启密码保护的分类需要验证密码查看，其中的阅读不计入统计。';
/** Kotlin L490 无痕浏览开关标题。 */
export const PRIVACY_MANAGE_INCOGNITO_LABEL = '无痕浏览';
/** Kotlin L495 无痕浏览「开」文案。 */
export const PRIVACY_MANAGE_INCOGNITO_HINT_ON = '已开启 · 全部阅读不计入统计';
/** Kotlin L496 无痕浏览「关」文案。 */
export const PRIVACY_MANAGE_INCOGNITO_HINT_OFF = '开启后在线等全部阅读不计入统计';
/** Kotlin L529「我喜欢的」开关标题（中文引号逐字保留）。 */
export const PRIVACY_MANAGE_FAVORITES_LABEL = '「我喜欢的」需要密码';
/** Kotlin L534 收藏保护「开」文案。 */
export const PRIVACY_MANAGE_FAVORITES_HINT_ON = '已开启 · 进入该板块需验证密码';
/** Kotlin L535 收藏保护「关」文案。 */
export const PRIVACY_MANAGE_FAVORITES_HINT_OFF = '开启后查看收藏要先验证密码';
/** Kotlin L577 受保护分类行的第二行文案。 */
export const PRIVACY_MANAGE_CATEGORY_HINT = '无痕 · 阅读不计入统计';
/** Kotlin L606 左下动作。 */
export const PRIVACY_MANAGE_ACTION_CHANGE_PIN = '修改密码';
/** Kotlin L622 右下动作。 */
export const PRIVACY_MANAGE_ACTION_DISABLE = '关闭隐私模式';

/** Kotlin L495-496 的 `if (incognitoBrowsingEnabled)` 分支。 */
export function incognitoHintText(enabled: boolean): string {
  return enabled ? PRIVACY_MANAGE_INCOGNITO_HINT_ON : PRIVACY_MANAGE_INCOGNITO_HINT_OFF;
}

/** Kotlin L534-535 的 `if (favoritesProtected)` 分支。 */
export function favoritesHintText(enabled: boolean): string {
  return enabled ? PRIVACY_MANAGE_FAVORITES_HINT_ON : PRIVACY_MANAGE_FAVORITES_HINT_OFF;
}

/** Kotlin L575-581 `if (cat.isProtected) { Text(…) }`。 */
export function categoryRowHintVisible(isProtected: boolean): boolean {
  return isProtected;
}

/**
 * Kotlin L388 KDoc 逐字：「进入前提：隐私模式已开启且已验证 PIN。」
 * —— 隐私管理窗口的两道前置条件。
 */
export function privacyManageEntryAllowed(input: {
  readonly privacyModeEnabled: boolean;
  /** 打开管理窗口前是否已通过 PIN 验证（UI 层持有，PrivacyManager 不持久化）。 */
  readonly pinVerified: boolean;
}): boolean {
  return input.privacyModeEnabled && input.pinVerified;
}

export interface CategoryProtectionToggleResult {
  /** false = 被门禁拦下，调用方不应写库。 */
  readonly changed: boolean;
  /** 取消保护后需要同步移除的解锁记录（MainViewModel L1152-1156）。 */
  readonly unlockedCategoryIds: ReadonlySet<number>;
}

/**
 * 分类保护开关的语义（Kotlin L583-586 交给 `onToggleProtected(cat, it)`；
 * 接收侧 `MainViewModel.setCategoryProtected` L1149-1157 逐行如下）：
 *
 *   if (!privacyModeEnabled) return                       // L1150
 *   persist(categoryId, isProtected)                      // L1151
 *   if (!isProtected) unlockedCategoryIds -= categoryId   // L1152-1156
 *
 * 这里把它做成纯函数，好让「分类保护门禁 + 取消解锁」能被单测覆盖。
 */
export function applyCategoryProtectionToggle(input: {
  readonly privacyModeEnabled: boolean;
  readonly categoryId: number;
  readonly protectedOn: boolean;
  readonly unlockedCategoryIds: ReadonlySet<number>;
}): CategoryProtectionToggleResult {
  if (!input.privacyModeEnabled) {
    return { changed: false, unlockedCategoryIds: input.unlockedCategoryIds };
  }
  if (input.protectedOn) {
    return { changed: true, unlockedCategoryIds: input.unlockedCategoryIds };
  }
  const next = new Set(input.unlockedCategoryIds);
  next.delete(input.categoryId);
  return { changed: true, unlockedCategoryIds: next };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PIN 失败锁定接线（数据源：PrivacyManager.kt L73 / L79-83；真值：./pinKdf）
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface PinLockout {
  /** `pin_failures`（PrivacyManager L80）。 */
  readonly failures: number;
  /** `PIN_MAX_FAILURES` = 5（L82 的字面量 5，pinKdf 已导出）。 */
  readonly maxFailures: number;
  /** `pin_retry_after` 的毫秒时间戳（L82）。 */
  readonly retryAfterMs: number;
  /** Kotlin L73 `System.currentTimeMillis() < retry_after`。 */
  readonly locked: boolean;
  /** 锁定期剩余毫秒（未锁定为 0）。 */
  readonly remainingMs: number;
  /** `PIN_RETRY_AFTER_MS` = 30_000（L82）。 */
  readonly cooldownMs: number;
}

/** 读锁定态。UI 用它决定要不要禁用键盘 / 显示倒计时。 */
export function readPinLockout(store: PinStore, nowMs: number): PinLockout {
  const failures = store.getFailures();
  const retryAfterMs = store.getRetryAfterMs();
  const locked = nowMs < retryAfterMs;
  return {
    failures,
    maxFailures: PIN_MAX_FAILURES,
    retryAfterMs,
    locked,
    remainingMs: locked ? retryAfterMs - nowMs : 0,
    cooldownMs: PIN_RETRY_AFTER_MS,
  };
}

export interface PinVerifyWithLockoutDeps {
  readonly store: PinStore;
  /** 注入时钟，便于测试（默认 `Date.now`，等价 Kotlin `System.currentTimeMillis`）。 */
  readonly now?: () => number;
}

export interface PinVerifyWithLockoutResult {
  readonly ok: boolean;
  /** 调用前后的锁定态（失败计数已在 `verifyPin` 内累加）。 */
  readonly lockout: PinLockout;
  /** true = 锁定期内被短路，PIN 连比较都没发生。 */
  readonly shortCircuited: boolean;
}

/**
 * UI 侧的 PIN 校验接线。
 *
 * `verifyPin()`（pinKdf L130-164）**已经**在内部做了 L73 的锁定检查与 L79-83 的
 * 失败计数，因此这里不重复实现任何 KDF / 计数逻辑；本函数只额外提供：
 *   ① 锁定期的显式短路（省掉一次 PBKDF2 —— 120k 迭代不是免费的），语义与 L73 一致；
 *   ② 把调用前后可观察到的锁定态一并返回，供 UI 决定键盘是否禁用。
 *
 * `ok === false && shortCircuited === true` ⇒ 「太频繁了，稍后再试」。
 */
export async function verifyPinWithLockout(
  pin: string,
  deps: PinVerifyWithLockoutDeps,
): Promise<PinVerifyWithLockoutResult> {
  const now = deps.now ?? (() => Date.now());
  const before = readPinLockout(deps.store, now());
  if (before.locked) {
    return { ok: false, lockout: before, shortCircuited: true };
  }
  const ok = await verifyPin(pin, { store: deps.store, now });
  return { ok, lockout: readPinLockout(deps.store, now()), shortCircuited: false };
}

/** `PinStore` 上的一次 PIN 提交是否达到自动提交长度（Kotlin L213）。 */
export function isPinSubmitReady(entered: string): boolean {
  return entered.length === PIN_SUBMIT_LENGTH;
}

/** 供 UI 复用的 PIN 长度常量（真值在 `./pinKdf`，此处只是转出）。 */
export const PIN_INPUT_LENGTH = PIN_LENGTH;
