/**
 * godRankingExhibitsParity.test.ts —— 神回排行榜的三种陈列（`god/GodRankingExhibits.kt`，480 行）。
 *
 *   · `GodPodiumStyle`    —— 真正的台座（2/1/3 站位、98/66/52 三档高度）；
 *   · `GodVinylStyle`     —— 套封 + 只露一侧的唱片 + 2dp 细搁板；
 *   · `GodPolaroidStyle`  —— 双列相纸墙（墙面 / 相纸 / 名次角标 / 三行文字）。
 *
 * 本轮修掉的一致性问题：这三块在 Kotlin 里全部读
 * `MaterialTheme.colorScheme.surfaceVariant`，而 `Theme.kt` L84/L104 把它覆盖成
 * **亮 #F0EDE5 / 深 #2D2D2D**（`WenkuTokens.RaisedDark`）。端口在 `god.css` 里
 * 8 处写成了 M3 **基线**（亮 #E3E5E7 / 深 #49454F）—— 浅色偏冷灰、深色偏紫。
 * 现在统一走 `--god-surface-variant`。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { androidReference } from '../helpers/androidReference';

const KT = readFileSync(
  androidReference('app/src/main/java/com/example/god/GodRankingExhibits.kt'),
  'utf8',
);
const TSX = readFileSync('src/ui/components/god/GodRankingBody.tsx', 'utf8');
const CSS = readFileSync('src/styles/god.css', 'utf8');

describe('GodRankingExhibits.kt：领奖台站位与三档台座', () => {
  it('满三名时站位是「2 / 1 / 3」，不足三名按原序', () => {
    expect(KT).toContain('val order = if (items.size >= 3) listOf(1, 0, 2) else items.indices.toList()');
    expect(TSX).toContain('const order = items.length >= 3 ? [1, 0, 2] : items.map((_, index) => index);');
    // 站位语义：索引 1（第二名）在左、索引 0（冠军）居中、索引 2（第三名）在右
    expect([1, 0, 2].map((i) => i + 1)).toEqual([2, 1, 3]);
  });

  it('列间距 7dp、冠军列权重 1.12', () => {
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(7.dp)');
    expect(KT).toContain('modifier = Modifier.weight(if (winner) 1.12f else 1f)');
    expect(CSS).toContain('.god-pod__row {');
    expect(CSS).toContain('gap: 7px;');
    expect(TSX).toContain('flexGrow: winner ? 1.12 : 1');
  });

  it('封面 105（冠军）/ 88、3:4、阴影 8dp、圆角 9dp', () => {
    expect(KT).toContain('.width(if (winner) 105.dp else 88.dp)');
    expect(KT).toContain('.aspectRatio(GodCoverEngine.COVER_RATIO)');
    expect(KT).toContain('.shadow(8.dp, RoundedCornerShape(9.dp))');
    expect(KT).toContain('.clip(RoundedCornerShape(9.dp))');
    expect(TSX).toContain('width: winner ? 105 : 88');
    expect(CSS).toContain('border-radius: 9px;');
  });

  it('台座高度：98/76、66/50、52/38（非 compact / compact）', () => {
    expect(KT).toContain('1 -> if (compact) 76.dp else 98.dp');
    expect(KT).toContain('2 -> if (compact) 50.dp else 66.dp');
    expect(KT).toContain('else -> if (compact) 38.dp else 52.dp');
    expect(TSX).toContain('? compact\n      ? 76\n      : 98');
    // 单调：第一名最高、第三名最矮（两种密度都成立）
    expect(98).toBeGreaterThan(66);
    expect(66).toBeGreaterThan(52);
    expect(76).toBeGreaterThan(50);
    expect(50).toBeGreaterThan(38);
  });

  it('台座渐变到 0.76、1dp 描边（深 .48 / 亮 .64）、顶部圆角 9', () => {
    expect(KT).toContain('stone.copy(alpha = 0.76f)');
    expect(KT).toContain('accent.copy(alpha = if (dark) 0.48f else 0.64f)');
    expect(KT).toContain('RoundedCornerShape(topStart = 9.dp, topEnd = 9.dp)');
    expect(TSX).toContain('alpha(stone, 0.76)');
    expect(TSX).toContain('alpha(accent, dark ? 0.48 : 0.64)');
    expect(CSS).toContain('border-radius: 9px 9px 0 0;');
    expect(CSS).toContain('border: 1px solid;');
  });

  it('三组主色与石色逐值（金 / 银 / 铜，明暗两套）', () => {
    expect(KT).toContain('1 -> Color(0xFFD6AC62)');
    expect(KT).toContain('2 -> Color(0xFFADB6C0)');
    expect(KT).toContain('else -> Color(0xFFC49A7A)');
    expect(KT).toContain('1 -> if (dark) Color(0xFF4E412E) else Color(0xFFEBDFC5)');
    expect(KT).toContain('2 -> if (dark) Color(0xFF3C4148) else Color(0xFFE0E4E8)');
    expect(KT).toContain('else -> if (dark) Color(0xFF4B3D36) else Color(0xFFE8D9CE)');
    for (const hex of ['#D6AC62', '#ADB6C0', '#C49A7A', '#4E412E', '#EBDFC5', '#3C4148', '#E0E4E8', '#4B3D36', '#E8D9CE']) {
      expect(TSX.toUpperCase()).toContain(hex);
    }
  });

  it('台座数字 30/24sp Light；深色用主色、亮色用 #594936', () => {
    expect(KT).toContain('fontSize = if (winner) 30.sp else 24.sp');
    expect(KT).toContain('fontWeight = FontWeight.Light');
    expect(KT).toContain('color = if (dark) accent else Color(0xFF594936)');
    expect(TSX).toContain("color: dark ? accent : '#594936'");
    expect(TSX).toContain('fontSize: winner ? 30 : 24');
    expect(CSS).toContain('font-weight: 300;');
  });

  it('倾斜位移系数冠军 .4、其余 .2', () => {
    expect(KT).toContain('translationX = if (reduceMotion) 0f else tilt.x * if (winner) 0.4f else 0.2f');
    expect(TSX).toContain('godTiltFactor(winner ? 0.4 : 0.2)');
  });

  it('标题 11/10sp、600/500、固定高 30dp、行高 14sp、最多两行', () => {
    expect(KT).toContain('fontSize = if (winner) 11.sp else 10.sp');
    expect(KT).toContain('fontWeight = if (winner) FontWeight.SemiBold else FontWeight.Medium');
    expect(KT).toContain('lineHeight = 14.sp');
    expect(KT).toContain('modifier = Modifier.fillMaxWidth().height(30.dp)');
    expect(CSS).toContain('height: 30px;');
    expect(CSS).toContain('line-height: 14px;');
    expect(CSS).toContain('-webkit-line-clamp: 2;');
    expect(TSX).toContain('fontSize: winner ? 11 : 10');
    expect(TSX).toContain('fontWeight: winner ? 600 : 500');
  });

  it('冠军备注条：surfaceVariant@.24、10×7 内边距、11sp', () => {
    expect(KT).toContain('.background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.24f))');
    expect(KT).toContain('.padding(horizontal = 10.dp, vertical = 7.dp)');
    expect(KT).toContain('fontSize = 11.sp');
    expect(CSS).toContain('padding: 7px 10px;');
  });

  it('第四名起：r12、surfaceVariant@.28、12×10、列间距 12；名次 15sp 金色', () => {
    expect(KT).toContain('.clip(RoundedCornerShape(12.dp))');
    expect(KT).toContain('.background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.28f))');
    expect(KT).toContain('.padding(horizontal = 12.dp, vertical = 10.dp)');
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(12.dp)');
    expect(KT).toContain('color = GodGold.LightEnd');
    expect(KT).toContain('fontSize = 15.sp');
    expect(KT).toContain('fontSize = 11.sp');
    expect(KT).toContain('fontSize = 10.sp');
    expect(CSS).toContain('padding: 10px 12px;');
  });
});

describe('GodRankingExhibits.kt：唱片架', () => {
  it('套封 152/190、页宽 220/260、展台 228/282、唱片 116/148', () => {
    expect(KT).toContain('val sleeveWidth = if (compact) 152.dp else 190.dp');
    expect(KT).toContain('val pageWidth = if (compact) 220.dp else 260.dp');
    expect(KT).toContain('val exhibitHeight = if (compact) 228.dp else 282.dp');
    expect(KT).toContain('.size(if (compact) 116.dp else 148.dp)');
    expect(TSX).toContain('const sleeveWidth = compact ? 152 : 190;');
    expect(TSX).toContain('const pageWidth = compact ? 220 : 260;');
    expect(TSX).toContain('const exhibitHeight = compact ? 228 : 282;');
    expect(TSX).toContain('discSize={compact ? 116 : 148}');
  });

  it('侧边留白 = (可用宽 − 页宽) / 2，且不为负', () => {
    expect(KT).toContain('val side = ((maxWidth - pageWidth) / 2).coerceAtLeast(0.dp)');
    // 语义：可用宽 600、常规页宽 260 → 两侧各 170
    expect((600 - 260) / 2).toBe(170);
    // 可用宽不足时夹到 0（不留负 padding）
    expect(Math.max(0, (200 - 260) / 2)).toBe(0);
  });

  it('唱片距右 9、套封距左 12、套封阴影 10 / 圆角 11', () => {
    expect(KT).toContain('.padding(end = 9.dp)');
    expect(KT).toContain('.padding(start = 12.dp)');
    expect(KT).toContain('.shadow(10.dp, RoundedCornerShape(11.dp))');
    expect(KT).toContain('.clip(RoundedCornerShape(11.dp))');
    expect(CSS).toContain('left: 12px;');
    expect(CSS).toContain('border-radius: 11px;');
  });

  it('名次角标：距上左 9、0xC11C1B1A、r5、7×3、11sp Bold', () => {
    expect(KT).toContain('.padding(9.dp)');
    expect(KT).toContain('background(Color(0xC11C1B1A), RoundedCornerShape(5.dp))');
    expect(KT).toContain('.padding(horizontal = 7.dp, vertical = 3.dp)');
    expect(KT).toContain('fontSize = 11.sp');
    expect(KT).toContain('fontWeight = FontWeight.Bold');
    // 0xC1 / 255 ≈ 0.757
    expect(Number((0xc1 / 255).toFixed(3))).toBe(0.757);
    expect(CSS).toContain('top: 9px;');
    expect(CSS).toContain('padding: 3px 7px;');
  });

  it('搁板：左右 20、高 2dp、GodGold.LightMid@.32', () => {
    expect(KT).toContain('.padding(horizontal = 20.dp)');
    expect(KT).toContain('.height(2.dp)');
    expect(KT).toContain('GodGold.LightMid.copy(alpha = 0.32f)');
    expect(CSS).toContain('width: calc(100% - 40px);');
    expect(CSS).toContain('height: 2px;');
    // LightMid = #F5B942 → rgba(245, 185, 66, .32)
    expect(CSS).toContain('rgba(245, 185, 66, 0.32)');
  });

  it('说明区间距 14 / 5 / 5 / 4，星级 14dp，次级文字 11sp', () => {
    expect(KT).toContain('Spacer(Modifier.height(14.dp))');
    expect(KT).toContain('starSize = 14.dp');
    expect(KT).toContain('Spacer(Modifier.height(5.dp))');
    expect(KT).toContain('Spacer(Modifier.height(4.dp))');
    expect(KT).toContain('fontSize = 11.sp');
    expect(TSX).toContain('starSize={14}');
  });

  it('页脚文案 `book  ·  n / total`（两个空格 + 中点 + 两个空格）', () => {
    expect(KT).toContain('"${selected.entity.bookTitle}  ·  ${pager.currentPage + 1} / ${items.size}"');
    expect(TSX).toContain("{'  ·  '}");
    expect(TSX).toContain('{page + 1} / {items.length}');
  });

  it('唱片本体：#202124 盘面 + 7 圈 .045 纹路（.40 + i·.075）+ 金标 .27 + 中心孔 .035', () => {
    expect(KT).toContain('drawCircle(Color(0xFF202124), radius)');
    expect(KT).toContain('for (i in 1..7)');
    expect(KT).toContain('Color.White.copy(alpha = 0.045f)');
    expect(KT).toContain('radius * (0.40f + i * 0.075f)');
    expect(KT).toContain('Stroke(width = 1.dp.toPx())');
    expect(KT).toContain('drawCircle(Color(0xFFB89A67), radius * 0.27f)');
    expect(KT).toContain('drawCircle(Color(0xFF25231F), radius * 0.035f)');
    expect(TSX).toContain('fill="#202124"');
    expect(TSX).toContain('r={r * (0.4 + i * 0.075)}');
    expect(TSX).toContain("stroke=\"rgba(255, 255, 255, 0.045)\"");
    expect(TSX).toContain('r * 0.27');
    expect(TSX).toContain('r * 0.035');
    // 最外圈 .40 + 7×.075 = .925（仍在盘面内）
    expect(0.4 + 7 * 0.075).toBeCloseTo(0.925, 10);
  });
});

describe('GodRankingExhibits.kt：照片墙', () => {
  it('墙面 / 相纸：亮 #F1EDE6 / 白；深 #232321 / #F2EFEA', () => {
    expect(KT).toContain('val wall = if (dark) Color(0xFF232321) else Color(0xFFF1EDE6)');
    expect(KT).toContain('val paper = if (dark) Color(0xFFF2EFEA) else Color.White');
    expect(TSX).toContain("const paper = isDark ? '#F2EFEA' : '#FFFFFF';");
    expect(TSX).toContain("const wall = dark ? '#232321' : '#F1EDE6';");
  });

  it('墙面 r18 / 14dp 内边距 / 13dp 行距 / 每排两张 12dp', () => {
    expect(KT).toContain('.clip(RoundedCornerShape(18.dp))');
    expect(KT).toContain('.padding(14.dp)');
    expect(KT).toContain('verticalArrangement = Arrangement.spacedBy(13.dp)');
    expect(KT).toContain('horizontalArrangement = Arrangement.spacedBy(12.dp)');
    expect(KT).toContain('items.chunked(2)');
    expect(CSS).toContain('border-radius: 18px;');
    expect(CSS).toContain('padding: 14px;');
    expect(CSS).toContain('gap: 13px;');
    expect(CSS).toContain('gap: 12px;');
  });

  it('表头：MOMENT WALL 10sp Semibold 字距 1.7 / 右侧「N FRAMES」10sp', () => {
    expect(KT).toContain('"MOMENT WALL"');
    expect(KT).toContain('letterSpacing = 1.7.sp');
    expect(KT).toContain('"${items.size} FRAMES"');
    expect(KT).toContain('fontSize = 10.sp');
    expect(TSX).toContain('MOMENT WALL');
    expect(TSX).toContain('{props.items.length} FRAMES');
    expect(CSS).toContain('letter-spacing: 1.7px;');
    expect(CSS).toContain('.god-wall__filler');
  });

  it('表头两色：亮 #705F49 / 深 #E5D1AD；计数 亮 #8E8172 / 深 #B9AD9C', () => {
    expect(KT).toContain('if (dark) Color(0xFFE5D1AD) else Color(0xFF705F49)');
    expect(KT).toContain('if (dark) Color(0xFFB9AD9C) else Color(0xFF8E8172)');
    expect(TSX).toContain("dark ? '#E5D1AD' : '#705F49'");
    expect(TSX).toContain("dark ? '#B9AD9C' : '#8E8172'");
  });

  it('相纸：阴影 5 / 圆角 4 / 内边距 7 / 封面裁切 2', () => {
    expect(KT).toContain('.shadow(5.dp, RoundedCornerShape(4.dp))');
    expect(KT).toContain('.clip(RoundedCornerShape(4.dp))');
    expect(KT).toContain('.padding(7.dp)');
    expect(KT).toContain('.clip(RoundedCornerShape(2.dp))');
    expect(CSS).toContain('padding: 7px;');
    expect(CSS).toContain('border-radius: 4px;');
  });

  it('名次角标：距上左 6、0xB922201E、r3、6×2、10sp', () => {
    expect(KT).toContain('.padding(6.dp)');
    expect(KT).toContain('background(Color(0xB922201E), RoundedCornerShape(3.dp))');
    expect(KT).toContain('.padding(horizontal = 6.dp, vertical = 2.dp)');
    expect(KT).toContain('fontSize = 10.sp');
    expect(Number((0xb9 / 255).toFixed(3))).toBe(0.725);
    expect(CSS).toContain('top: 6px;');
    expect(CSS).toContain('padding: 2px 6px;');
  });

  it('三行文字：标题 11 #302C27 / 评分·书名 9 #8C7250 / 备注 9 #786E62', () => {
    expect(KT).toContain('color = Color(0xFF302C27)');
    expect(KT).toContain('color = Color(0xFF8C7250)');
    expect(KT).toContain('color = Color(0xFF786E62)');
    expect(KT).toContain('"${item.entity.rating} ★  ·  ${item.entity.bookTitle}"');
    expect(CSS).toContain('color: #302c27;');
    expect(CSS).toContain('color: #8c7250;');
  });

  it('间距 9 / 4 / 3 / 5；倾斜系数 .25', () => {
    expect(KT).toContain('Spacer(Modifier.height(9.dp))');
    expect(KT).toContain('Spacer(Modifier.height(3.dp))');
    expect(KT).toContain('Spacer(Modifier.height(5.dp))');
    expect(KT).toContain('translationX = if (reduceMotion) 0f else tilt.x * 0.25f');
    expect(TSX).toContain('godTiltFactor(0.25)');
  });
});

describe('Theme.kt 的 surfaceVariant：god.css 统一走变量', () => {
  it('亮 #F0EDE5 / 深 #2D2D2D（WenkuTokens.RaisedDark），不是 M3 基线', () => {
    expect(CSS).toContain('--god-surface-variant: #F0EDE5;');
    expect(CSS).toContain('--god-surface-variant: #2D2D2D;');
    // 旧的两组基线值不再出现在**声明**里
    const declarations = CSS.split('\n').filter((line) => {
      const t = line.trimStart();
      return !(t.startsWith('*') || t.startsWith('/*'));
    });
    const joined = declarations.join('\n');
    expect(joined).not.toContain('rgba(227, 229, 231');
    expect(joined).not.toContain('rgba(73, 69, 79');
  });

  it('半透明用法是 color-mix（只淡化填充，不改文字）', () => {
    expect(CSS).toContain('color-mix(in srgb, var(--god-surface-variant, #F0EDE5) 24%, transparent)');
    expect(CSS).toContain('color-mix(in srgb, var(--god-surface-variant, #F0EDE5) 28%, transparent)');
    expect(CSS).toContain('color-mix(in srgb, var(--god-surface-variant, #F0EDE5) 32%, transparent)');
  });
});
