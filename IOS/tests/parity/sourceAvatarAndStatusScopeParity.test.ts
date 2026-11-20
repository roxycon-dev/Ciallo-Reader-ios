/**
 * sourceAvatarAndStatusScopeParity.test.ts —— 源站头像配色 + 发现页状态作用域。
 *
 * 覆盖 2 个 Kotlin 文件：
 *   `ui/components/SourceAvatar.kt`（59 行）—— 色相取自 JVM `String.hashCode()`，
 *        饱和度 .52 / 明度 .86，首字母 = 首个字符大写或 `?`，字号 `size / 2.2`，白描边 1dp @ .85
 *   `discover/DiscoverStatusScope.kt`（34 行）—— 「结算类」与「新作类」两条正则，
 *        **否定优先**（`未完结` / `连载` 绝不能变成「只看完结」），以及三态 hint / effectiveStatus
 *
 * 这两处的共同点：错了不会崩，只会「看起来怪」或「筛选结果莫名少一半」。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { hashColor } from '@ui/components/SourceAvatar';
import { DiscoverStatusScope, discoverStatusScope } from '@core/discover/statusScope';

import { androidReference } from '../helpers/androidReference';

const KT = 'app/src/main/java/com/example';

function kt(rel: string): string {
  return readFileSync(androidReference(`${KT}/${rel}`), 'utf8');
}

describe('SourceAvatar.kt：哈希取色与首字母', () => {
  const source = kt('ui/components/SourceAvatar.kt');

  it('色相 = hashCode().toUInt() % 360，饱和度 .52、明度 .86', () => {
    expect(source).toContain('val hash = sourceId.hashCode().toUInt()');
    expect(source).toContain('val hue = (hash % 360u).toFloat()');
    expect(source).toContain('Color.hsv(hue, 0.52f, 0.86f)');

    // 同一个 id 稳定同色；不同 id 大概率不同色
    expect(hashColor('ixdzs8')).toBe(hashColor('ixdzs8'));
    const colors = new Set(['ixdzs8', 'wenku8_library', 'zlibrary', 'fanqie', 'alicesw'].map(hashColor));
    expect(colors.size).toBeGreaterThanOrEqual(4);
    // 输出是合法 hex 且带 alpha
    for (const c of colors) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('首字母：trim 后取首个字符并大写；空名回落 "?"', () => {
    expect(source).toContain('sourceName.trim().firstOrNull()?.uppercase() ?: "?"');
    // 该逻辑在 UI 层（SourceAvatar.tsx 的 letter 计算）
    const tsx = readFileSync('src/ui/components/SourceAvatar.tsx', 'utf8');
    expect(tsx).toContain('trim()');
    expect(tsx).toContain("'?'");
  });

  it('字号 = size / 2.2，默认 32dp，白描边 1dp @ .85', () => {
    expect(source).toContain('fontSize = (size.value / 2.2f).sp');
    expect(source).toContain('size: Dp = 32.dp');
    expect(source).toContain('.border(1.dp, Color.White.copy(alpha = 0.85f), shape)');
    // 32 / 2.2 ≈ 14.5
    expect(32 / 2.2).toBeCloseTo(14.545, 2);
  });

  it('shape 默认 CircleShape（既有调用点零回归），书源管理页传 RoundedCornerShape(12)', () => {
    expect(source).toContain('shape: Shape = CircleShape');
    expect(source).toContain('书源管理页按设计规范传 `RoundedCornerShape(12)` 走圆角方形');
  });
});

describe('DiscoverStatusScope.kt：结算/新作的判定', () => {
  const source = kt('discover/DiscoverStatusScope.kt');

  it('否定优先：未完结 / 未结束 / 连载 / ongoing 一律不算「只看完结」', () => {
    expect(source).toContain('未完[结結]|未[结結]束');
    expect(source).toContain('uncompleted|incomplete|unfinished|ongoing|连载|連載');
    const negatives = ['未完结', '未结束', '不完结', '未完成', 'uncompleted', 'incomplete', 'unfinished', 'ongoing', '连载', '連載'];
    for (const label of negatives) {
      const scope = discoverStatusScope('RANKING', label, null, null);
      expect(scope.completedOnly, `${label} 不该被判成完结`).toBe(false);
    }
  });

  it('肯定：完结 / 已完成 / completed / finished 才算完结', () => {
    const positives = ['完结', '完结榜', '已完成', 'completed', 'finished', 'ended'];
    for (const label of positives) {
      expect(discoverStatusScope('RANKING', label, null, null).completedOnly, `${label} 应判成完结`).toBe(true);
    }
    // 英文必须是整词（`completedxxx` 不算）
    expect(discoverStatusScope('RANKING', 'uncompleted', null, null).completedOnly).toBe(false);
  });

  it('新作：新作 / 新书 / 上架 / new releases / recently added；且完结优先覆盖新作', () => {
    for (const label of ['新作', '新书', '上架', 'new', 'new releases', 'recently added']) {
      const scope = discoverStatusScope('RANKING', label, null, null);
      expect(scope.newWorks, `${label} 应判成新作`).toBe(true);
      expect(scope.completedOnly).toBe(false);
    }
    // 「新作」+「完结」同时出现 → 完结优先，newWorks 被压掉
    const both = discoverStatusScope('RANKING', '完结新作', null, null);
    expect(both.completedOnly).toBe(true);
    expect(both.newWorks).toBe(false);
  });

  it('range 只在 RANKING 维度当 label（其余维度忽略 range）', () => {
    // Kotlin：`dimension == DiscoverDimension.RANKING -> range`
    expect(kt('discover/DiscoverStatusScope.kt')).toContain('dimension == DiscoverDimension.RANKING -> range');
    expect(discoverStatusScope('RANKING', '完结榜', null, null).completedOnly).toBe(true);
    expect(discoverStatusScope('UPDATES', '完结榜', null, null).completedOnly).toBe(false);
    expect(discoverStatusScope('CLICKS', '完结榜', null, null).completedOnly).toBe(false);
    expect(discoverStatusScope('DISCUSSION', '完结榜', null, null).completedOnly).toBe(false);
  });

  it('三态：showStatusChoices / hint / effectiveStatus', () => {
    expect(source).toContain('val showStatusChoices get() = !completedOnly && !newWorks');
    expect(source).toContain('completedOnly -> tr("仅显示已确认完结的作品")');
    expect(source).toContain('newWorks -> tr("按原站新上架排序，作品可能仍在连载")');
    expect(source).toContain('completedOnly -> tr("完结")');
    expect(source).toContain('newWorks -> tr("全部")');

    const neutral = new DiscoverStatusScope(false, false);
    expect(neutral.showStatusChoices).toBe(true);
    expect(neutral.hint).toBeNull();
    expect(neutral.effectiveStatus('连载中')).toBe('连载中');

    const completed = new DiscoverStatusScope(true, false);
    expect(completed.showStatusChoices).toBe(false);
    expect(completed.hint).toBe('仅显示已确认完结的作品');
    expect(completed.effectiveStatus('连载中')).toBe('完结');

    const fresh = new DiscoverStatusScope(false, true);
    expect(fresh.showStatusChoices).toBe(false);
    expect(fresh.hint).toBe('按原站新上架排序，作品可能仍在连载');
    expect(fresh.effectiveStatus('连载中')).toBe('全部');
  });

  it('label 的取值优先级：categoryId > native feed > feedId > RANKING 的 range', () => {
    expect(source).toContain('categoryId != null -> catalog?.categories?.firstOrNull { it.id == categoryId }?.label');
    expect(source).toContain('feedId == "native" -> catalog?.feeds?.firstOrNull()?.label');
    expect(source).toContain('dimension == DiscoverDimension.RANKING -> range');

    const catalog = {
      feeds: [
        { id: 'native', label: '本站完结' },
        { id: 'other', label: '新作' },
      ],
      categories: [{ id: 'c1', label: '未完结分类' }],
    };
    // categoryId 优先（且否定词生效）
    expect(discoverStatusScope('UPDATES', '', 'other', 'c1', catalog).completedOnly).toBe(false);
    // native feed 取第一个
    expect(discoverStatusScope('UPDATES', '', 'native', null, catalog).completedOnly).toBe(true);
    // 指定 feedId 取对应项
    expect(discoverStatusScope('UPDATES', '', 'other', null, catalog).newWorks).toBe(true);
    // RANKING 时用 range 当 label
    expect(discoverStatusScope('RANKING', '完结榜', null, null).completedOnly).toBe(true);
    expect(discoverStatusScope('RANKING', '连载榜', null, null).completedOnly).toBe(false);
  });
});
