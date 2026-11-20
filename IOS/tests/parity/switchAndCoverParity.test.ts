/**
 * switchAndCoverParity.test.ts —— 全局开关的轨/滑块几何 + 统计页封面加载器。
 *
 * 覆盖 3 个 Kotlin 文件：
 *   `ui/components/AppSwitch.kt`（59 行）—— 60×32 / 滑块 24 / padding 4，
 *        以及**必须成套修改的不变量**：行程 = containerWidth − circleSize − padding×2
 *   `ui/components/ReadingRecordCover.kt`（28 行）—— `zlibrary` 走专用加载器、其余走通用加载器，
 *        headers 原样透传，`ContentScale.Crop`
 *   `ui/components/GradientActionButton.kt`（34 行）—— 默认 Primary / Medium 的兼容入口
 *
 * 开关这条不变量写错的表现很隐蔽：滑块「滑出轨道」或「走不满」，只有在真机上才看得出，
 * 而且改任一项参数就会踩到 —— 所以这里把它算成具体数字钉住。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { AppSwitch, switchTravelPx } from '@ui/components/AppSwitch';
import { ReadingRecordCover } from '@ui/components/ReadingRecordCover';

import { androidReference } from '../helpers/androidReference';

const KT = 'app/src/main/java/com/example/ui/components';

function kt(rel: string): string {
  return readFileSync(androidReference(`${KT}/${rel}`), 'utf8');
}

describe('AppSwitch.kt：轨/滑块几何与行程不变量', () => {
  const source = kt('AppSwitch.kt');

  it('默认 60×32、滑块 24、内边距 4（= SquishyToggleSwitch 出厂值）', () => {
    expect(source).toContain('containerWidth: Int = 60');
    expect(source).toContain('containerHeight: Int = 32');
    expect(source).toContain('circleSize: Int = 24');
    expect(source).toContain('padding: Int = 4');
  });

  it('行程 = containerWidth − circleSize − padding×2 = 60−24−8 = 28', () => {
    // Kotlin 注释里的不变量
    expect(source).toContain('位移量 = containerWidth − circleSize − padding×2');
    expect(switchTravelPx({ containerWidth: 60, circleSize: 24, padding: 4 })).toBe(28);
    // 书源管理页的那套：44×26 / 滑块 20 / 内边距 3 → 行程 18
    expect(switchTravelPx({ containerWidth: 44, circleSize: 20, padding: 3 })).toBe(18);
    expect(source).toContain('书源管理页按该页设计规范传 44×26 / 滑块 20 / 内边距 3');
  });

  it('行程永远小于轨道宽、且为正（改任一项参数都会破坏这个关系）', () => {
    const cases = [
      { containerWidth: 60, circleSize: 24, padding: 4 },
      { containerWidth: 44, circleSize: 20, padding: 3 },
      { containerWidth: 52, circleSize: 24, padding: 3 },
    ];
    for (const c of cases) {
      const travel = switchTravelPx(c);
      expect(travel).toBeGreaterThan(0);
      expect(travel).toBeLessThan(c.containerWidth);
      // 行程 + 滑块 + 两侧内边距 = 轨道宽（闭合关系）
      expect(travel + c.circleSize + c.padding * 2).toBe(c.containerWidth);
    }
  });

  it('三档画质分支：MINIMAL → Checkbox、无 enhancedMotion → 原生 Switch、其余 → Squishy', () => {
    expect(source).toContain('if (LocalRenderQuality.current.minimal)');
    expect(source).toContain('androidx.compose.material3.Checkbox(checked = checked, onCheckedChange = onCheckedChange, modifier = modifier)');
    expect(source).toContain('if (!LocalRenderQuality.current.enhancedMotion)');
    expect(source).toContain('androidx.compose.material3.Switch(checked = checked, onCheckedChange = onCheckedChange, modifier = modifier)');
    // 组件存在（UI 层导出）
    expect(AppSwitch).toBeTypeOf('function');
  });

  it('收敛说明：全 App 只允许这一个开关实现', () => {
    expect(source).toContain('全局唯一开关组件');
    expect(source).toContain('不允许再直接引用其它开关实现');
  });
});

describe('ReadingRecordCover.kt：封面加载器分流', () => {
  const source = kt('ReadingRecordCover.kt');

  it('sourceId == "zlibrary" 走 ZLibrary 加载器，否则 Generic', () => {
    expect(source).toContain('imageLoader = if (sourceId == "zlibrary") ZLibraryCoverLoader.get(context) else GenericCoverLoader.get(context)');
    // 视图层同样按这个分支
    expect(ReadingRecordCover).toBeTypeOf('function');
  });

  it('headers 原样透传（Cookie / Referer 靠它）、Crop 裁切', () => {
    expect(source).toContain('headers.forEach { (name, value) -> addHeader(name, value) }');
    expect(source).toContain('contentScale = ContentScale.Crop');
    // 统计页与书库共用同一套缓存/凭据 —— 这是这条注释的语义
    expect(source).toContain('Statistics share the library');
  });
});

describe('GradientActionButton.kt：兼容旧调用的入口', () => {
  const source = kt('GradientActionButton.kt');

  it('默认 Primary + Medium，其余一律透传', () => {
    expect(source).toContain('variant: AppButtonVariant = AppButtonVariant.Primary');
    expect(source).toContain('size: AppButtonSize = AppButtonSize.Medium');
    expect(source).toContain('enabled: Boolean = true');
    expect(source).toContain('loading: Boolean = false');
    expect(source).toContain('fullWidth: Boolean = false');
    // 实现已迁移到 AppActionButton（四变体 + 液态玻璃 + gel-press + loading）
    expect(source).toContain('实现已统一迁移到 [AppActionButton]');
    expect(source).toContain('AppActionButton(');
  });

  it('9 个参数全部原样转发（不静默丢弃 modifier/icon/fullWidth）', () => {
    for (const param of [
      'text = text',
      'onClick = onClick',
      'modifier = modifier',
      'variant = variant',
      'buttonSize = size',
      'icon = icon',
      'enabled = enabled',
      'loading = loading',
      'fullWidth = fullWidth',
    ]) {
      expect(source, `漏了转发 ${param}`).toContain(param);
    }
  });
});
