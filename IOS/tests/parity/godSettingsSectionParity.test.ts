/**
 * godSettingsSectionParity.test.ts —— 设置页「神回」分组（`god/GodSettingsSection.kt`，269 行）。
 *
 * 这个分区把三件事拼在一起：三选一的展示风格卡（每张卡片是**现画的**小型示意图）、
 * 陀螺仪视差开关（无传感器则整行隐藏）、排行榜入口。数值错了不会崩，
 * 只会「卡片里的三个台阶比例变了」这种肉眼可见的偏差，所以逐值对拍。
 *
 * 本轮修掉的两处：
 *   ① 选中态标签**没有加粗** —— Kotlin L254 `if (selected) FontWeight.Bold else Medium`，
 *      而 CSS 只有一条 `.god-style-card__label { font-weight: 500 }`；
 *   ② 卡片里另写了一个私有的 60×32/24/4 开关，而 Kotlin L164 调的是**共享**
 *      `AppSwitch` —— 两份实现必然漂移，改回共享端口。
 *
 * 另外把三张示意图从「JSX 里手算的小数」改回**比例式**（`godStylePreview()`），
 * 并修正 `designTokens.ts` 里两个字段名与 Kotlin 对不上的占位接口。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  GOD_PREVIEW_POLAROID_WHITE,
  GOD_PREVIEW_ROPE,
  GOD_PREVIEW_SHELF,
  GOD_PREVIEW_SLEEVE_GREY,
  GOD_PREVIEW_VINYL_BLACK,
  GOD_SETTINGS_CTA,
  GOD_SETTINGS_SECTION,
  GOD_SETTINGS_STRINGS,
  GOD_SETTING_SWITCH_ROW,
  GOD_STYLE_CARD,
  godSettingsCtaColor,
  godStyleCardBorderAlpha,
  godStyleCardBorderWidth,
  godStyleCardLabelWeight,
  godStyleCardScale,
  godStyleCardSurfaceAlpha,
  godStylePreview,
} from '@core/god/godSettingsSection';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/god/GodSettingsSection.kt'),
  'utf8',
);
const MOTION = readFileSync(
  androidReference('app/src/main/java/com/example/god/GodMotion.kt'),
  'utf8',
);

const GOLD: readonly [string, string, string] = ['#FFE29A', '#F5B942', '#D98E1F'];

describe('GodSettingsSection.kt：分区容器与标题', () => {
  it('标题 13sp / SemiBold / 字距 .1 / onSurface@.62，下方 8dp', () => {
    expect(KT).toContain('fontWeight = FontWeight.SemiBold');
    expect(KT).toContain('fontSize = 13.sp');
    expect(KT).toContain('letterSpacing = 0.1.sp');
    expect(KT).toContain('color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.62f)');
    expect(KT).toContain('Spacer(Modifier.height(8.dp))');
    expect(GOD_SETTINGS_SECTION.titleSizeSp).toBe(13);
    expect(GOD_SETTINGS_SECTION.titleLetterSpacingSp).toBe(0.1);
    expect(GOD_SETTINGS_SECTION.titleAlpha).toBe(0.62);
    expect(GOD_SETTINGS_SECTION.titleGapDp).toBe(8);
  });

  it('卡片 r16 / 内边距 16 / 纵向 14 / 风格行 10', () => {
    expect(KT).toContain('shape = RoundedCornerShape(16.dp)');
    expect(KT).toContain('Modifier.padding(16.dp)');
    expect(KT).toContain('verticalArrangement = Arrangement.spacedBy(14.dp)');
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(10.dp)');
    expect(KT).toContain('fontSize = 14.sp');
    expect(KT).toContain('fontWeight = FontWeight.Medium');
    expect(GOD_SETTINGS_SECTION.cardRadiusDp).toBe(16);
    expect(GOD_SETTINGS_SECTION.contentPaddingDp).toBe(16);
    expect(GOD_SETTINGS_SECTION.contentGapDp).toBe(14);
    expect(GOD_SETTINGS_SECTION.styleRowGapDp).toBe(10);
    expect(GOD_SETTINGS_SECTION.sectionTitleSizeSp).toBe(14);
  });

  it('竖向节奏闭合：标题 13 + 8 间距 + 卡片内 14 间距（三段互不相等）', () => {
    expect(GOD_SETTINGS_SECTION.titleGapDp).toBeLessThan(GOD_SETTINGS_SECTION.contentGapDp);
    expect(GOD_SETTINGS_SECTION.styleRowGapDp).toBeLessThan(GOD_SETTINGS_SECTION.contentGapDp);
    expect(GOD_SETTINGS_SECTION.styleRowGapDp).toBeGreaterThan(GOD_SETTINGS_SECTION.titleGapDp);
  });
});

describe('GodSettingsSection.kt：陀螺仪开关行', () => {
  it('标题 14sp / 副文案 11.5sp 行高 15 / 间距 2 与 10', () => {
    expect(KT).toContain('Text(title, fontSize = 14.sp');
    expect(KT).toContain('fontSize = 11.5.sp');
    expect(KT).toContain('lineHeight = 15.sp');
    expect(KT).toContain('Spacer(Modifier.height(2.dp))');
    expect(KT).toContain('Spacer(Modifier.width(10.dp))');
    expect(GOD_SETTING_SWITCH_ROW.titleSizeSp).toBe(14);
    expect(GOD_SETTING_SWITCH_ROW.descSizeSp).toBe(11.5);
    expect(GOD_SETTING_SWITCH_ROW.descLineHeightSp).toBe(15);
    expect(GOD_SETTING_SWITCH_ROW.descGapDp).toBe(2);
    expect(GOD_SETTING_SWITCH_ROW.trailingGapDp).toBe(10);
  });

  it('副文案为空时不占位（`if (desc.isNotBlank())`）', () => {
    expect(KT).toContain('if (desc.isNotBlank()) {');
    // 间距也一起跳过 —— 否则空文案会留一条 2dp 的缝
    const body = KT.slice(KT.indexOf('if (desc.isNotBlank()) {'), KT.indexOf('Spacer(Modifier.width(10.dp))'));
    expect(body).toContain('Spacer(Modifier.height(2.dp))');
  });

  it('无旋转向量传感器时整行隐藏', () => {
    expect(KT).toContain('val hasGyro = remember(context) { context.hasRotationSensor() }');
    expect(KT).toContain('if (hasGyro) {');
  });

  it('开关是共享 AppSwitch，不是本地副本', () => {
    expect(KT).toContain('AppSwitch(checked = checked, onCheckedChange = onCheckedChange)');
    // iOS 侧必须 import 共享端口（本轮修：此前是组件内私有实现）
    const tsx = readFileSync('src/ui/components/god/GodSettingsSection.tsx', 'utf8');
    expect(tsx).toContain("from '@ui/components/AppSwitch'");
    expect(tsx).not.toContain('app-switch__thumb');
  });
});

describe('GodSettingsSection.kt：风格单选卡', () => {
  it('选中 1.04 倍、未选 1.0', () => {
    expect(KT).toContain('targetValue = if (selected) 1.04f else 1f');
    expect(GOD_STYLE_CARD.selectedScale).toBe(1.04);
    expect(godStyleCardScale(true)).toBe(1.04);
    expect(godStyleCardScale(false)).toBe(1);
  });

  it('描边：选中 1.6dp 金渐变、未选 1dp onSurface@.12（动画目标 .95）', () => {
    expect(KT).toContain('width = if (selected) 1.6.dp else 1.dp');
    expect(KT).toContain('targetValue = if (selected) 0.95f else 0.12f');
    expect(KT).toContain('Brush.horizontalGradient(gold)');
    expect(GOD_STYLE_CARD.borderWidthSelectedDp).toBe(1.6);
    expect(GOD_STYLE_CARD.borderWidthIdleDp).toBe(1);
    expect(godStyleCardBorderWidth(true)).toBe(1.6);
    expect(godStyleCardBorderWidth(false)).toBe(1);
    expect(GOD_STYLE_CARD.borderAlphaSelected).toBe(0.95);
    expect(GOD_STYLE_CARD.borderAlphaIdle).toBe(0.12);
    expect(godStyleCardBorderAlpha(false)).toBe(0.12);
  });

  it('底：选中 surfaceVariant@.55、未选 @.32；圆角 14、内边距 8', () => {
    expect(KT).toContain('val surface = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = if (selected) 0.55f else 0.32f)');
    expect(KT).toContain('.clip(RoundedCornerShape(14.dp))');
    expect(KT).toContain('.padding(8.dp)');
    expect(GOD_STYLE_CARD.surfaceAlphaSelected).toBe(0.55);
    expect(GOD_STYLE_CARD.surfaceAlphaIdle).toBe(0.32);
    expect(godStyleCardSurfaceAlpha(true)).toBe(0.55);
    expect(godStyleCardSurfaceAlpha(false)).toBe(0.32);
    expect(GOD_STYLE_CARD.radiusDp).toBe(14);
    expect(GOD_STYLE_CARD.paddingDp).toBe(8);
  });

  it('标签 11.5sp，选中 **Bold** / 未选 Medium（本轮修：此前恒 500）', () => {
    expect(KT).toContain('fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium');
    expect(KT).toContain('fontSize = 11.5.sp');
    expect(GOD_STYLE_CARD.labelSizeSp).toBe(11.5);
    expect(GOD_STYLE_CARD.labelWeightSelected).toBe(700);
    expect(GOD_STYLE_CARD.labelWeightIdle).toBe(500);
    expect(godStyleCardLabelWeight(true)).toBe(700);
    expect(godStyleCardLabelWeight(false)).toBe(500);
    // 组件真的用了这个函数（不是只写在常量表里）
    const tsx = readFileSync('src/ui/components/god/GodSettingsSection.tsx', 'utf8');
    expect(tsx).toContain('godStyleCardLabelWeight(selected)');
    expect(tsx).toContain('godStyleCardScale(');
  });

  it('示意图上方 6dp 间距，画布 62×46，圆角元素 4dp', () => {
    expect(KT).toContain('Canvas(modifier = Modifier.size(width = 62.dp, height = 46.dp))');
    expect(KT).toContain('Spacer(Modifier.height(6.dp))');
    expect(KT).toContain('CornerRadius(4.dp.toPx(), 4.dp.toPx())');
    expect(GOD_STYLE_CARD.artWidthDp).toBe(62);
    expect(GOD_STYLE_CARD.artHeightDp).toBe(46);
    expect(GOD_STYLE_CARD.stepRadiusDp).toBe(4);
    expect(GOD_STYLE_CARD.labelGapDp).toBe(6);
  });
});

describe('GodSettingsSection.kt：三张示意图（比例式）', () => {
  it('PODIUM：三个台阶 0.22 宽，中间最高、左中右高度 .38/.58/.30', () => {
    expect(KT).toContain('val bw = w * 0.22f');
    expect(KT).toContain('drawRoundRectStyleStep(w * 0.12f, h * 0.62f, bw, h * 0.38f, gold[1])');
    expect(KT).toContain('drawRoundRectStyleStep(w * 0.39f, h * 0.42f, bw, h * 0.58f, gold[0])');
    expect(KT).toContain('drawRoundRectStyleStep(w * 0.66f, h * 0.70f, bw, h * 0.30f, gold[2])');

    const ops = godStylePreview('podium', GOLD);
    expect(ops).toHaveLength(3);
    // 62 × 46 画布上的实际坐标（Kotlin 的比例 × 画布）
    expect(ops[0]).toMatchObject({ kind: 'roundRect', x: 62 * 0.12, y: 46 * 0.62 });
    expect(ops[0]?.width).toBeCloseTo(62 * 0.22, 9);
    expect(ops[0]?.height).toBeCloseTo(46 * 0.38, 9);
    expect(ops[1]?.x).toBeCloseTo(62 * 0.39, 9);
    expect(ops[1]?.height).toBeCloseTo(46 * 0.58, 9);
    expect(ops[2]?.x).toBeCloseTo(62 * 0.66, 9);
    expect(ops[2]?.y).toBeCloseTo(46 * 0.7, 9);
    // 中间那道用 gold[0]（最亮），左右用 gold[1] / gold[2]
    expect(ops.map((op) => op.fill)).toEqual([GOLD[1], GOLD[0], GOLD[2]]);
    // 台阶全部落在画布内
    for (const op of ops) {
      expect(op.x).toBeGreaterThanOrEqual(0);
      expect(op.x + op.width).toBeLessThanOrEqual(62 + 1e-9);
      expect(op.y + op.height).toBeLessThanOrEqual(46 + 1e-9);
    }
  });

  it('VINYL_SHELF：三张套 + 黑胶（外 .24h / 内 .08h）+ 搁板（.88h，8% 高）', () => {
    expect(KT).toContain('drawRoundRectStyleStep(w * 0.06f, h * 0.24f, w * 0.16f, h * 0.62f, Color(0xFF5A5F6B))');
    expect(KT).toContain('drawRoundRectStyleStep(w * 0.30f, h * 0.18f, w * 0.18f, h * 0.68f, gold[0])');
    expect(KT).toContain('drawRoundRectStyleStep(w * 0.58f, h * 0.24f, w * 0.16f, h * 0.62f, Color(0xFF5A5F6B))');
    expect(KT).toContain('drawCircle(Color(0xFF121316), radius = h * 0.24f, center = Offset(w * 0.84f, h * 0.52f))');
    expect(KT).toContain('drawCircle(gold[0], radius = h * 0.08f, center = Offset(w * 0.84f, h * 0.52f))');
    expect(KT).toContain('drawRect(Color(0x33666666), topLeft = Offset(0f, h * 0.88f), size = Size(w, h * 0.08f))');

    const ops = godStylePreview('vinyl', GOLD);
    expect(ops).toHaveLength(6);
    expect(ops[0]?.fill).toBe(GOD_PREVIEW_SLEEVE_GREY);
    expect(ops[1]?.fill).toBe(GOLD[0]);
    expect(ops[2]?.fill).toBe(GOD_PREVIEW_SLEEVE_GREY);
    // 黑胶与中心标签同心同点
    expect(ops[3]).toMatchObject({ kind: 'circle', x: 62 * 0.84, y: 46 * 0.52 });
    expect(ops[3]?.radius).toBeCloseTo(46 * 0.24, 9);
    expect(ops[4]?.radius).toBeCloseTo(46 * 0.08, 9);
    expect(ops[4]?.x).toBe(ops[3]?.x);
    expect(ops[4]?.y).toBe(ops[3]?.y);
    // 中心标签只占盘面的 1/3 —— 否则看着像纯色圆
    expect((ops[4]?.radius ?? 0) / (ops[3]?.radius ?? 1)).toBeCloseTo(1 / 3, 9);
    // 搁板
    expect(ops[5]).toMatchObject({ kind: 'rect', x: 0, y: 46 * 0.88 });
    expect(ops[5]?.width).toBe(62);
    expect(ops[5]?.height).toBeCloseTo(46 * 0.08, 9);
    expect(ops[5]?.fill).toBe(GOD_PREVIEW_SHELF);
    expect(ops[3]?.fill).toBe(GOD_PREVIEW_VINYL_BLACK);
  });

  it('POLAROID_WALL：麻绳二次贝塞尔（控制点 .34h、两端 .16h）+ 两张拍立得', () => {
    expect(KT).toContain('moveTo(0f, h * 0.16f)');
    expect(KT).toContain('quadraticBezierTo(w / 2f, h * 0.34f, w, h * 0.16f)');
    expect(KT).toContain('drawPath(path, Color(0xFFB79B72), style = Stroke(width = 2f))');
    expect(KT).toContain('drawRoundRectStyleStep(w * 0.10f, h * 0.30f, w * 0.32f, h * 0.52f, Color.White)');
    expect(KT).toContain('drawRoundRectStyleStep(w * 0.52f, h * 0.34f, w * 0.32f, h * 0.52f, Color.White)');

    const ops = godStylePreview('polaroid', GOLD);
    expect(ops).toHaveLength(3);
    const rope = ops[0];
    expect(rope?.kind).toBe('path');
    expect(rope?.y).toBeCloseTo(46 * 0.16, 9);
    expect(rope?.path?.controlX).toBeCloseTo(31, 9);
    expect(rope?.path?.controlY).toBeCloseTo(46 * 0.34, 9);
    expect(rope?.path?.endX).toBe(62);
    expect(rope?.path?.endY).toBeCloseTo(46 * 0.16, 9);
    expect(rope?.path?.strokeWidth).toBe(2);
    expect(rope?.fill).toBe(GOD_PREVIEW_ROPE);
    // 两张拍立得错开一点（第二张更低），都 32% 宽、52% 高
    expect(ops[1]?.x).toBeCloseTo(62 * 0.1, 9);
    expect(ops[1]?.y).toBeCloseTo(46 * 0.3, 9);
    expect(ops[2]?.x).toBeCloseTo(62 * 0.52, 9);
    expect(ops[2]?.y).toBeCloseTo(46 * 0.34, 9);
    expect(ops[1]?.height).toBeCloseTo(46 * 0.52, 9);
    expect(ops[2]?.height).toBeCloseTo(46 * 0.52, 9);
    expect(ops[2]?.y).toBeGreaterThan(ops[1]?.y ?? 0);
    for (const op of [ops[1], ops[2]]) expect(op?.fill).toBe(GOD_PREVIEW_POLAROID_WHITE);
  });

  it('三种风格的元素数量固定：3 / 6 / 3（GodRankingStyle 只有三档）', () => {
    expect(godStylePreview('podium', GOLD)).toHaveLength(3);
    expect(godStylePreview('vinyl', GOLD)).toHaveLength(6);
    expect(godStylePreview('polaroid', GOLD)).toHaveLength(3);
  });

  it('画布尺寸可替换，比例保持不变', () => {
    const big = godStylePreview('podium', GOLD, 124, 92);
    const small = godStylePreview('podium', GOLD);
    expect(big[0]?.x).toBeCloseTo((small[0]?.x ?? 0) * 2, 9);
    expect(big[0]?.width).toBeCloseTo((small[0]?.width ?? 0) * 2, 9);
    expect(big[0]?.height).toBeCloseTo((small[0]?.height ?? 0) * 2, 9);
  });
});

describe('GodSettingsSection.kt：排行榜入口', () => {
  it('r12 / secondary@.10 / 竖向内边距 11 / 13.5sp SemiBold', () => {
    expect(KT).toContain('.clip(RoundedCornerShape(12.dp))');
    expect(KT).toContain('.background(MaterialTheme.colorScheme.secondary.copy(alpha = 0.10f))');
    expect(KT).toContain('.padding(vertical = 11.dp)');
    expect(KT).toContain('fontSize = 13.5.sp');
    expect(KT).toContain('fontWeight = FontWeight.SemiBold');
    expect(GOD_SETTINGS_CTA.radiusDp).toBe(12);
    expect(GOD_SETTINGS_CTA.backgroundAlpha).toBe(0.1);
    expect(GOD_SETTINGS_CTA.paddingVerticalDp).toBe(11);
    expect(GOD_SETTINGS_CTA.labelSizeSp).toBe(13.5);
  });

  it('文字金色随明暗：深 DarkMid(#C79A3E) / 浅 LightEnd(#D98E1F)', () => {
    expect(KT).toContain('color = if (dark) GodGold.DarkMid else GodGold.LightEnd');
    expect(MOTION).toContain('val LightEnd = Color(0xFFD98E1F)');
    expect(MOTION).toContain('val DarkMid = Color(0xFFC79A3E)');
    expect(godSettingsCtaColor(false)).toBe('#D98E1F');
    expect(godSettingsCtaColor(true)).toBe('#C79A3E');
    // 两色不相等（否则明暗切换无反馈）
    expect(godSettingsCtaColor(false)).not.toBe(godSettingsCtaColor(true));
  });

  it('只有传了 onOpenRanking 才渲染（Kotlin L117 的 null 判断）', () => {
    expect(KT).toContain('if (onOpenRanking != null) {');
    expect(KT).toContain('onOpenRanking: (() -> Unit)? = null');
    const tsx = readFileSync('src/ui/components/god/GodSettingsSection.tsx', 'utf8');
    expect(tsx).toContain('onOpenRanking !== null ?');
  });
});

describe('GodSettingsSection.kt：五条文案逐字', () => {
  it('分区标题 / 风格标题 / 陀螺仪标题与说明 / 入口', () => {
    expect(KT).toContain('tr("神回")');
    expect(KT).toContain('com.example.i18n.tr("神回排行榜展示风格")');
    expect(KT).toContain('tr("排行榜陀螺仪视差")');
    expect(KT).toContain('tr("倾斜手机时封面与光环反向位移，形成景深")');
    expect(KT).toContain('com.example.i18n.tr("查看神回排行榜 ✦")');

    expect(GOD_SETTINGS_STRINGS.sectionTitle).toBe('神回');
    expect(GOD_SETTINGS_STRINGS.styleTitle).toBe('神回排行榜展示风格');
    expect(GOD_SETTINGS_STRINGS.gyroTitle).toBe('排行榜陀螺仪视差');
    expect(GOD_SETTINGS_STRINGS.gyroDesc).toBe('倾斜手机时封面与光环反向位移，形成景深');
    expect(GOD_SETTINGS_STRINGS.openRanking).toBe('查看神回排行榜 ✦');
  });

  it('组件用常量而不是二次手写（改文案只改一处）', () => {
    const tsx = readFileSync('src/ui/components/god/GodSettingsSection.tsx', 'utf8');
    expect(tsx).toContain('tr(GOD_SETTINGS_STRINGS.sectionTitle)');
    expect(tsx).toContain('tr(GOD_SETTINGS_STRINGS.styleTitle)');
    expect(tsx).toContain('tr(GOD_SETTINGS_STRINGS.gyroTitle)');
    expect(tsx).toContain('tr(GOD_SETTINGS_STRINGS.gyroDesc)');
    expect(tsx).toContain('tr(GOD_SETTINGS_STRINGS.openRanking)');
  });
});

describe('GodSettingsSection.kt：designTokens 里的占位接口已对齐', () => {
  it('GodSettingSwitchRow 的字段是 desc / onCheckedChange（此前写反了）', async () => {
    const tokens = await import('@core/ui/designTokens');
    // 类型只在编译期存在；这里断言常量确实存在于同一模块（占位接口不携带值）
    expect(tokens).toBeDefined();
    const src = readFileSync('src/core/ui/designTokens.ts', 'utf8');
    expect(src).toContain('readonly desc: string;');
    expect(src).toContain('readonly onCheckedChange: (next: boolean) => void;');
    expect(src).not.toContain('readonly description: string;');
    expect(src).toContain('readonly style: ');
    expect(src).toContain('readonly gold: readonly [string, string, string];');
    expect(src).not.toContain('readonly onOpen: () => void;');
  });
});
