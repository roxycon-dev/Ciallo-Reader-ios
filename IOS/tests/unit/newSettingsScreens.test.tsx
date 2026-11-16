/**
 * newSettingsScreens.test.tsx — 回归测试：Android 1.6.4 新增的 4 个界面在 iOS 侧的移植。
 *
 * 覆盖：
 *   ① `ThemePalettePage`  — 文案逐字、默认索引、预览色条定值、单选交互
 *   ② `CardAppearancePage` — 8 个滑杆的 label/valueText/区间端点定值、重置默认、滑杆交互
 *   ③ `TouchZoneEditor`    — 文案逐字、几何/命中纯函数固定向量、工具展开、试读、保存语义
 *   ④ `ReleaseHistoryDialog` — 59 条版本记录逐字、当前版本分支、关闭回调
 *
 * Kotlin 源：
 *   ui/ThemePaletteScreen.kt / ui/CardAppearanceScreen.kt
 *   ui/reader/TouchZoneEditor.kt (+ ui/reader/TouchZones.kt)
 *   ui/components/ReleaseHistoryDialog.kt
 *
 * 仓库没有 `@testing-library/react`，沿用 tests/unit 既有写法：`react-dom/client` + `act`。
 */

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { mixHex } from '@core/glass/color';
import { DEFAULT_CARD_TWEAKS } from '@core/glass/cardTweaks';
import ThemePalettePage, {
  DEFAULT_THEME_PALETTE,
  PALETTE_LABELS,
  hexStateDescription,
  palettePreviewSwatches,
} from '@ui/pages/ThemePalettePage';
import CardAppearancePage, {
  DEFAULT_CARD_APPEARANCE,
  oneDecimal,
  percentText,
} from '@ui/pages/CardAppearancePage';
import TouchZoneEditor, {
  MAX_DISTANCE_DP,
  MIN_DISTANCE_DP,
  TOUCH_ACTION_LABELS,
  TOUCH_ZONE_PREFS,
  applyZoneDrag,
  createTouchZone,
  decodeZones,
  encodeZones,
  normalizeZone,
  swipeGuideSign,
  zoneContains,
  zoneHit,
  type TouchZone,
  type TouchZoneConfig,
} from '@ui/components/reader/TouchZoneEditor';
import ReleaseHistoryDialog, {
  INSTALLED_VERSION,
  RELEASE_HISTORY,
} from '@ui/components/ReleaseHistoryDialog';

// React 19 要求显式声明 act 环境
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

interface Mounted {
  readonly root: Root;
  readonly host: HTMLDivElement;
}

const mounted: Mounted[] = [];

async function mount(node: ReactNode): Promise<Mounted> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  const entry: Mounted = { root, host };
  mounted.push(entry);
  return entry;
}

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => {
      entry.root.unmount();
    });
    entry.host.remove();
  }
});

function texts(host: HTMLElement, selector: string): string[] {
  return [...host.querySelectorAll(selector)].map((el) => el.textContent ?? '');
}

function buttonByText(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (el) => (el.textContent ?? '').includes(label),
  );
  if (found === undefined) throw new Error(`button not found: ${label}`);
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement | null): Promise<void> {
  if (element === null) throw new Error('click target is null');
  await act(async () => {
    element.click();
  });
}

/** React 19 的受控 `<input type="range">`：用原型 setter 绕过值追踪器再派发 input。 */
async function setRangeValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function rangeByLabel(host: HTMLElement, label: string): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(`input[type="range"][aria-label="${label}"]`);
  if (found === null) throw new Error(`range not found: ${label}`);
  return found;
}

/* ══════════════════════════════════════════════════════════════════════════════
   ① ThemePalettePage — ThemePaletteScreen.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ThemePalettePage（ThemePaletteScreen.kt）', () => {
  it('渲染标题、三段编号与逐字文案', async () => {
    const { host } = await mount(<ThemePalettePage />);
    expect(host.querySelector('.tab-screen-header__title')?.textContent).toBe('主题配色方案');
    expect(host.querySelector('.tab-screen-header__subtitle')?.textContent).toBe(
      'APPEARANCE / PALETTE',
    );
    // 本轮把页面内联的三段头换成共享 `WenkuSectionHeader`（WenkuGlass.kt L733-787）：编号与拉丁
    // 副标题合成 `01 / TONAL PALETTE` 一行，旧类名 `__section-number` / `__section-code` 不再存在。
    // 断言内容一字不改，只换定位方式。
    expect(texts(host, '.wenku-section-header__meta')).toEqual([
      '01 / TONAL PALETTE',
      '02 / PRIMARY COLOR',
      '03 / ACCENT COLOR',
    ]);
    expect(texts(host, '.wenku-section-header__title')).toEqual([
      '实时预览',
      '主色调',
      '强调色',
    ]);
    expect(host.querySelector('.theme-palette__preview-title')?.textContent).toBe('Ciallo 阅览室');
    expect(host.querySelector('.theme-palette__preview-desc')?.textContent).toBe(
      '配色会即时应用到页面、玻璃卡片和控件。',
    );
  });

  it('默认索引取 Theme.kt 的 2（绿），预览五色与 Kotlin lerp 顺序一致', async () => {
    const { host } = await mount(<ThemePalettePage />);
    expect(DEFAULT_THEME_PALETTE).toEqual({ primaryIndex: 2, secondaryIndex: 2 });

    const tones = [
      ...host.querySelectorAll<HTMLElement>('[data-testid^="theme_palette_preview_"]'),
    ];
    expect(tones.map((el) => el.dataset.testid)).toEqual([
      'theme_palette_preview_0',
      'theme_palette_preview_1',
      'theme_palette_preview_2',
      'theme_palette_preview_3',
      'theme_palette_preview_4',
    ]);
    const expected = [
      '#059669',
      '#10B981',
      mixHex('#FFFFFF', '#059669', 0.22),
      mixHex('#FFFFFF', '#10B981', 0.16),
      '#E6E0E9',
    ];
    expect(tones.map((el) => el.style.background.toUpperCase().startsWith('#') ? el.style.background.toUpperCase() : el.getAttribute('title'))).toEqual(
      expected.map((hex) => hex.toUpperCase()),
    );
    expect(palettePreviewSwatches(0, 0, false)[0]).toBe('#2563EB');
    expect(palettePreviewSwatches(0, 0, false)[1]).toBe('#3B82F6');
    expect(palettePreviewSwatches(0, 0, true)[4]).toBe('#36343B');
  });

  it('十个单选块：标签逐字、默认选中第 3 个、点击回调索引', async () => {
    const onPrimaryChange = vi.fn();
    const onSecondaryChange = vi.fn();
    const { host } = await mount(
      <ThemePalettePage
        onPrimaryChange={onPrimaryChange}
        onSecondaryChange={onSecondaryChange}
      />,
    );
    expect(PALETTE_LABELS).toEqual(['蓝', '紫', '绿', '粉', '橙']);
    const radios = [...host.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios).toHaveLength(10);
    expect(radios.filter((el) => el.getAttribute('aria-checked') === 'true')).toHaveLength(2);
    expect(texts(host, '.theme-palette__label')).toEqual([
      '蓝',
      '紫',
      '绿',
      '粉',
      '橙',
      '蓝',
      '紫',
      '绿',
      '粉',
      '橙',
    ]);
    expect(radios[2]?.getAttribute('aria-label')).toBe('主色调 · 绿');
    expect(radios[2]?.getAttribute('aria-description')).toBe('已选择');
    expect(radios[0]?.getAttribute('aria-description')).toBe('未选择');

    await click(host.querySelector('[aria-label="主色调 · 蓝"]'));
    expect(onPrimaryChange).toHaveBeenCalledWith(0);
    await click(host.querySelector('[aria-label="强调色 · 橙"]'));
    expect(onSecondaryChange).toHaveBeenCalledWith(4);
  });

  it('hexStateDescription 复刻 "#%06X".format(... and 0xFFFFFF)', () => {
    expect(hexStateDescription('#059669')).toBe('#059669');
    expect(hexStateDescription('#10b981')).toBe('#10B981');
    expect(hexStateDescription('#002244')).toBe('#002244');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② CardAppearancePage — CardAppearanceScreen.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('CardAppearancePage（CardAppearanceScreen.kt）', () => {
  it('渲染标题、两块面板与八个滑杆的定值文案', async () => {
    const { host } = await mount(<CardAppearancePage />);
    expect(host.querySelector('.tab-screen-header__title')?.textContent).toBe('自定义卡片参数');
    expect(host.querySelector('.tab-screen-header__subtitle')?.textContent).toBe(
      'APPEARANCE / CARDS',
    );
    expect(texts(host, '.card-appearance__card-title')).toEqual(['表面与色调', '倾斜与按压']);

    const labels = [
      '壁纸玻璃模糊（自定义壁纸＋高或极致画质）',
      '卡片圆角',
      '主题色叠加浓度',
      '卡片不透明度',
      '3D 倾斜最大角度',
      '立体透视强度（越大越立体）',
      '压力形变强度',
      '压力形变半径',
    ];
    expect(texts(host, '.card-appearance__slider-label')).toEqual(labels);

    // Kotlin `valueText` / `startText` / `endText` 逐项定值（Table: 默认值 → 文案）
    expect(texts(host, '.card-appearance__slider-value')).toEqual([
      '22dp',
      '16dp',
      '8%',
      '100%',
      '6.0°',
      '77%',
      '125%',
      '×1.1',
    ]);
    expect(texts(host, '.card-appearance__slider-ends > span')).toEqual([
      '8',
      '40',
      '2',
      '48',
      '0%',
      '30%',
      '40%',
      '100%',
      '0°',
      '15°',
      '平面',
      '立体',
      '0%',
      '200%',
      '0.5×',
      '2.5×',
    ]);
    expect(DEFAULT_CARD_APPEARANCE).toEqual(DEFAULT_CARD_TWEAKS);
    expect(percentText(0.08)).toBe('8%');
    expect(percentText(1)).toBe('100%');
    expect(oneDecimal(6)).toBe('6.0');
  });

  it('预览说明随 pressPreview 切换（Kotlin L66 三元）', async () => {
    const withPress = await mount(<CardAppearancePage />);
    expect(withPress.host.querySelector('.card-appearance__preview-title')?.textContent).toBe(
      '实时预览',
    );
    expect(withPress.host.querySelector('.card-appearance__preview-desc')?.textContent).toBe(
      '按住卡片边缘，查看倾斜与压力反馈',
    );
    await act(async () => {
      withPress.root.render(<CardAppearancePage reduceMotion />);
    });
    expect(withPress.host.querySelector('.card-appearance__preview-desc')?.textContent).toBe(
      '圆角、色调与不透明度即时更新',
    );
  });

  it('拖动滑杆按 Kotlin 反解公式写回，并保持区间端点', async () => {
    const onChange = vi.fn();
    const { host } = await mount(<CardAppearancePage onChange={onChange} />);
    // 卡片圆角：position = 0.5 ⇒ cornerRadiusDp = 2 + 0.5 * 46 = 25
    await setRangeValue(rangeByLabel(host, '卡片圆角'), '0.5');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0] as { cornerRadiusDp: number };
    expect(last.cornerRadiusDp).toBeCloseTo(25, 6);
    expect(texts(host, '.card-appearance__slider-value')[1]).toBe('25dp');

    // 不透明度：position = 0 ⇒ 0.4
    await setRangeValue(rangeByLabel(host, '卡片不透明度'), '0');
    const alpha = onChange.mock.calls.at(-1)?.[0] as { cardAlpha: number };
    expect(alpha.cardAlpha).toBeCloseTo(0.4, 6);
    expect(texts(host, '.card-appearance__slider-value')[3]).toBe('40%');
  });

  it('updateCardTweaks 保持 Kotlin 的「传函数」语义', async () => {
    const transforms: ((current: typeof DEFAULT_CARD_TWEAKS) => typeof DEFAULT_CARD_TWEAKS)[] = [];
    const { host } = await mount(
      <CardAppearancePage
        updateCardTweaks={(update) => {
          transforms.push(update);
        }}
      />,
    );
    await setRangeValue(rangeByLabel(host, '壁纸玻璃模糊（自定义壁纸＋高或极致画质）'), '0.5');
    expect(transforms).toHaveLength(1);
    const next = transforms[0]?.({ ...DEFAULT_CARD_TWEAKS });
    expect(next?.blurRadiusDp).toBeCloseTo(24, 6); // 8 + 0.5 * 32
  });

  it('重置默认写回 CardTweaks() 的出厂值', async () => {
    const onChange = vi.fn();
    const { host } = await mount(<CardAppearancePage onChange={onChange} />);
    await setRangeValue(rangeByLabel(host, '卡片圆角'), '1');
    await click(buttonByText(host, '重置默认'));
    const reset = onChange.mock.calls.at(-1)?.[0] as typeof DEFAULT_CARD_TWEAKS;
    expect(reset).toEqual(DEFAULT_CARD_TWEAKS);
    expect(reset).not.toBe(DEFAULT_CARD_TWEAKS); // 全新实例，等价 `CardTweaks()`
    expect(texts(host, '.card-appearance__slider-value')[1]).toBe('16dp');
  });

  it('滑杆 position 越界时 coerceIn(0, 1)', async () => {
    const { host } = await mount(<CardAppearancePage />);
    expect(rangeByLabel(host, '卡片不透明度').value).toBe('1'); // (1 - 0.4) / 0.6 === 1
    const input = rangeByLabel(host, '卡片圆角');
    expect(input.min).toBe('0');
    expect(input.max).toBe('1');
    expect(input.step).toBe('0.001');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ TouchZoneEditor — TouchZoneEditor.kt + TouchZones.kt
   ══════════════════════════════════════════════════════════════════════════════ */

const DEFAULT_DISTANCE = 60;
const ZONE_A = createTouchZone('zone-a');

describe('TouchZoneEditor — 模型纯函数（TouchZones.kt 固定向量）', () => {
  it('TouchZone() 默认值 / 持久化 key 与 Kotlin 一致', () => {
    expect(ZONE_A).toEqual({
      id: 'zone-a',
      left: 0.15,
      top: 0.2,
      right: 0.85,
      bottom: 0.65,
      tap: 'CONTROLS',
      swipe: 'PAGE',
      distanceDp: null,
    });
    expect(TOUCH_ZONE_PREFS).toEqual({
      name: 'reader_touch_zones_v1',
      key: 'novel',
      maxZones: 64,
    });
    expect(MIN_DISTANCE_DP).toBe(12);
    expect(MAX_DISTANCE_DP).toBe(360);
    expect(TOUCH_ACTION_LABELS).toMatchObject({
      NONE: '不执行操作',
      PREVIOUS: '上一页',
      NEXT: '下一页',
      CONTROLS: '呼出 / 收起状态栏',
      SETTINGS: '打开设置',
      CONTENTS: '打开目录',
      LISTEN: '听书',
      EXIT: '退出阅读',
    });
  });

  it('contains 四边闭合，hit 取最后一个命中（NONE 也阻断）', () => {
    expect(zoneContains(ZONE_A, 0.15, 0.2)).toBe(true);
    expect(zoneContains(ZONE_A, 0.85, 0.65)).toBe(true);
    expect(zoneContains(ZONE_A, 0.1499, 0.5)).toBe(false);

    const lower = createTouchZone('lower', { left: 0, top: 0, right: 1, bottom: 1 });
    const upper = createTouchZone('upper', {
      left: 0.2,
      top: 0.2,
      right: 0.4,
      bottom: 0.4,
      tap: 'NONE',
    });
    expect(zoneHit([lower, upper], 0.3, 0.3)?.id).toBe('upper');
    expect(zoneHit([lower, upper], 0.9, 0.9)?.id).toBe('lower');
    expect(zoneHit([lower, upper], -0.1, 0.3)).toBeNull();
  });

  it('normalized() 逐条复刻 coerceIn 与 NaN 兜底', () => {
    const normalized = normalizeZone({
      ...ZONE_A,
      left: 0.95, // ⇒ 0.92
      top: -3, // ⇒ 0
      right: 0.1, // ⇒ left + .08 = 1.0
      bottom: 0.5, // 仍在 [top + .08, 1] 内 ⇒ 0.5
      distanceDp: 5, // ⇒ 12
    });
    expect(normalized.left).toBe(0.92);
    expect(normalized.top).toBe(0);
    expect(normalized.right).toBe(1);
    expect(normalized.bottom).toBeCloseTo(0.5, 6);
    expect(normalized.distanceDp).toBe(12);

    // `coerceIn(t + .08f, 1f)` 的下界生效
    expect(normalizeZone({ ...ZONE_A, top: 0.8, bottom: 0.1 }).bottom).toBeCloseTo(0.88, 6);

    const infinite = normalizeZone({ ...ZONE_A, left: Number.NaN, distanceDp: Number.NaN });
    expect(infinite.left).toBe(0.15);
    expect(infinite.distanceDp).toBeNull();

    expect(normalizeZone({ ...ZONE_A, distanceDp: 999 }).distanceDp).toBe(360);
  });

  it('applyZoneDrag：四角只夹紧对边，整体移动双向夹紧（L190-199）', () => {
    const handle0 = applyZoneDrag(ZONE_A, 0, 0.05, -0.05);
    expect(handle0.left).toBeCloseTo(0.2, 6);
    expect(handle0.top).toBeCloseTo(0.15, 6);
    expect(handle0.right).toBe(0.85);

    const clamped0 = applyZoneDrag(ZONE_A, 0, 0.9, 0.9);
    expect(clamped0.left).toBeCloseTo(0.85 - 0.08, 6);
    expect(clamped0.top).toBeCloseTo(0.65 - 0.08, 6);

    const handle1 = applyZoneDrag(ZONE_A, 1, 0.05, -0.05);
    expect(handle1.right).toBeCloseTo(0.9, 6);
    expect(handle1.top).toBeCloseTo(0.15, 6);
    expect(handle1.bottom).toBe(0.65);

    const handle2 = applyZoneDrag(ZONE_A, 2, 0.05, 0.05);
    expect(handle2.left).toBeCloseTo(0.2, 6);
    expect(handle2.bottom).toBeCloseTo(0.7, 6);

    const handle3 = applyZoneDrag(ZONE_A, 3, 0.05, 0.05);
    expect(handle3.right).toBeCloseTo(0.9, 6);
    expect(handle3.bottom).toBeCloseTo(0.7, 6);

    // 整体移动：dx/dy 各自被 coerceIn(-left, 1 - right) / (-top, 1 - bottom) 夹紧
    const move = applyZoneDrag(createTouchZone('m'), -1, 10, 10);
    expect(move.left).toBeCloseTo(0.3, 6); // mx = 1 - 0.85 = .15
    expect(move.right).toBe(1);
    expect(move.top).toBeCloseTo(0.55, 6); // my = 1 - 0.65 = .35
    expect(move.bottom).toBe(1);

    const moveBack = applyZoneDrag(createTouchZone('m'), -1, -10, -10);
    expect(moveBack.left).toBe(0);
    expect(moveBack.top).toBe(0);
    expect(moveBack.right).toBeCloseTo(0.7, 6);
    expect(moveBack.bottom).toBeCloseTo(0.45, 6);
  });

  it('swipeGuideSign：PREVIOUS 正方向，reverse 取反（L100-101）', () => {
    expect(swipeGuideSign('PREVIOUS', false)).toBe(1);
    expect(swipeGuideSign('NEXT', false)).toBe(-1);
    expect(swipeGuideSign('PREVIOUS', true)).toBe(-1);
    expect(swipeGuideSign('NEXT', true)).toBe(1);
    expect(swipeGuideSign('CONTROLS', false)).toBe(-1);
  });

  it('encode/decode 往返，异常输入返回 null（L45-58）', () => {
    const zones = [createTouchZone('a'), createTouchZone('b', { distanceDp: 90, tap: 'NEXT' })];
    const raw = encodeZones(zones);
    const decoded = decodeZones(raw);
    expect(decoded).toHaveLength(2);
    expect(decoded?.[1]).toMatchObject({ id: 'b', distanceDp: 90, tap: 'NEXT' });
    // 归一化：写出的坐标已 coerce，解码后仍相等
    expect(decoded?.[0]?.left).toBeCloseTo(0.15, 6);
    // 未知枚举 → NONE（不是丢弃整条）
    const unknown = decodeZones('[{"id":"x","l":0,"t":0,"r":1,"b":1,"tap":"?","swipe":"?"}]');
    expect(unknown?.[0]).toMatchObject({ tap: 'NONE', swipe: 'NONE' });
    // 缺失数值 → 整条解析失败
    expect(decodeZones('[{"id":"x","t":0,"r":1,"b":1}]')).toBeNull();
    expect(decodeZones('not json')).toBeNull();
    expect(decodeZones(null)).toBeNull();
    // 超过 64 条 → null（Kotlin `require(array.length() <= 64)`）
    expect(decodeZones(JSON.stringify(Array.from({ length: 65 }, (_v, i) => ({ id: `z${String(i)}`, l: 0, t: 0, r: 1, b: 1 }))))).toBeNull();
  });
});

describe('TouchZoneEditor — 渲染与交互', () => {
  it('默认文案与区域标签逐字一致', async () => {
    const { host } = await mount(
      <TouchZoneEditor
        zones={null}
        defaults={[ZONE_A]}
        defaultDistanceDp={DEFAULT_DISTANCE}
        onSave={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(host.querySelector('.tze__bar-title')?.textContent).toBe('自定义触控分区');
    expect(host.querySelector('.tze__bar-subtitle')?.textContent).toBe(
      '原尺寸阅读画面 · 拖动移动 / 四角缩放',
    );
    expect(host.querySelector('.tze__zone-label')?.textContent).toBe(
      '1 · 呼出 / 收起状态栏\n滑动翻页',
    );
    const actions = texts(host, '.tze__bar-row--actions button').map((text) => text.trim());
    expect(actions).toEqual(['添加分区', '设置功能', '试读', '工具移到另一侧']);
    expect(buttonByText(host, '保存')).toBeTruthy();
  });

  it('设置功能展开后显示分区、行为选择与距离滑杆（12…360）', async () => {
    const { host } = await mount(
      <TouchZoneEditor
        zones={null}
        defaults={[ZONE_A]}
        defaultDistanceDp={DEFAULT_DISTANCE}
        onSave={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    await click(buttonByText(host, '设置功能'));
    expect(buttonByText(host, '收起工具')).toBeTruthy();
    expect(host.querySelector('.tze__section-title')?.textContent).toBe('分区 1');
    expect(texts(host, '.tze__label')).toEqual(['点击行为', '滑动行为']);
    expect(host.querySelector('[data-testid="tze_range_caption"]')?.textContent).toBe(
      '沿用原有阅读器判定 · 校准快速完成距离',
    );
    const range = rangeByLabel(host, '触发距离');
    expect(range.min).toBe('12');
    expect(range.max).toBe('360');
    expect(range.value).toBe(String(DEFAULT_DISTANCE));
    await setRangeValue(range, '120');
    expect(host.querySelector('[data-testid="tze_range_caption"]')?.textContent).toBe(
      '触发距离 120 dp',
    );
    expect(
      host.querySelector('.tze__hint')?.textContent,
    ).toContain('仅调整快速翻页的完成距离；慢速拖角、卷起与回退保持原样，滑动不限方向。');
    expect(buttonByText(host, '恢复原有默认')).toBeTruthy();
  });

  it('切换点击行为会改写区域标签（Kotlin `edit(selected.copy(tap = it))`）', async () => {
    const { host } = await mount(
      <TouchZoneEditor
        zones={null}
        defaults={[ZONE_A]}
        defaultDistanceDp={DEFAULT_DISTANCE}
        onSave={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    await click(buttonByText(host, '设置功能'));
    await click(buttonByText(host, '下一页'));
    expect(host.querySelector('.tze__zone-label')?.textContent).toBe(
      '1 · 下一页\n滑动翻页',
    );
  });

  it('comic 版本隐藏「听书」选项（Kotlin L272 过滤）', async () => {
    const reader = await mount(
      <TouchZoneEditor
        zones={null}
        defaults={[ZONE_A]}
        defaultDistanceDp={DEFAULT_DISTANCE}
        onSave={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    await click(buttonByText(reader.host, '设置功能'));
    expect(texts(reader.host, '.category-pill').some((text) => text.includes('听书'))).toBe(true);

    const comic = await mount(
      <TouchZoneEditor
        zones={null}
        defaults={[ZONE_A]}
        defaultDistanceDp={DEFAULT_DISTANCE}
        comic
        onSave={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    await click(buttonByText(comic.host, '设置功能'));
    expect(texts(comic.host, '.category-pill').some((text) => text.includes('听书'))).toBe(false);
    // 其余点击行为仍在（Kotlin 只过滤 LISTEN）
    expect(texts(comic.host, '.category-pill').slice(0, 8)).toEqual([
      '不执行操作',
      '上一页',
      '下一页',
      '呼出 / 收起状态栏',
      '打开设置',
      '打开目录',
      '退出阅读',
      '不执行操作',
    ]);
  });

  it('试读切换标题/副标题并隐藏编辑层；保存回传 draft 并关闭', async () => {
    const onSave = vi.fn<(zones: TouchZoneConfig) => void>();
    const onDismiss = vi.fn<() => void>();
    const onPreview = vi.fn<(zones: TouchZoneConfig, trying: boolean) => void>();
    const { host } = await mount(
      <TouchZoneEditor
        zones={null}
        defaults={[ZONE_A]}
        defaultDistanceDp={DEFAULT_DISTANCE}
        onSave={onSave}
        onDismiss={onDismiss}
        onPreview={onPreview}
      />,
    );
    // Kotlin L81：首帧预览 draft = zones(null)，trying = false
    expect(onPreview).toHaveBeenLastCalledWith(null, false);

    await click(buttonByText(host, '试读'));
    expect(host.querySelector('.tze__bar-title')?.textContent).toBe('正在真实试读');
    expect(host.querySelector('.tze__bar-subtitle')?.textContent).toBe(
      '使用未保存的分区，可直接翻页',
    );
    expect(host.querySelector('[data-testid="tze_layer"]')).toBeNull();
    // Kotlin L240：试读态的按钮文案是「返回编辑」，回到编辑后才出现「保存」
    await click(buttonByText(host, '返回编辑'));
    expect(host.querySelector('.tze__bar-title')?.textContent).toBe('自定义触控分区');
    expect(host.querySelector('[data-testid="tze_layer"]')).not.toBeNull();

    await click(buttonByText(host, '保存'));
    expect(onSave).toHaveBeenCalledWith(null); // 未改动 ⇒ 回传 null（沿用阅读器默认）
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('添加分区后保存回传两条，且选中新分区', async () => {
    const onSave = vi.fn<(zones: TouchZoneConfig) => void>();
    const { host } = await mount(
      <TouchZoneEditor
        zones={null}
        defaults={[ZONE_A]}
        defaultDistanceDp={DEFAULT_DISTANCE}
        makeZoneId={() => 'zone-new'}
        onSave={onSave}
        onDismiss={() => undefined}
      />,
    );
    await click(buttonByText(host, '添加分区'));
    expect(texts(host, '.tze__zone-label')).toEqual([
      '1 · 呼出 / 收起状态栏\n滑动翻页',
      '2 · 呼出 / 收起状态栏\n滑动翻页',
    ]);
    // Kotlin L249 `selectedId = added.id; startCalibration()` —— 新分区即选中项且工具收起
    expect(host.querySelector('.tze__controls--open')).toBeNull();
    await click(buttonByText(host, '设置功能'));
    expect(host.querySelector('.tze__controls--open .tze__section-title')?.textContent).toBe(
      '分区 2',
    );
    await click(buttonByText(host, '保存'));
    const saved = onSave.mock.calls.at(-1)?.[0] as TouchZone[];
    expect(saved.map((zone) => zone.id)).toEqual(['zone-a', 'zone-new']);
  });

  it('关闭按钮与 Escape 都走 onDismiss（BackHandler 等价）', async () => {
    const onDismiss = vi.fn<() => void>();
    const { host } = await mount(
      <TouchZoneEditor
        zones={null}
        defaults={[ZONE_A]}
        defaultDistanceDp={DEFAULT_DISTANCE}
        onSave={() => undefined}
        onDismiss={onDismiss}
      />,
    );
    await click(host.querySelector('.tze__close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ ReleaseHistoryDialog — ReleaseHistoryDialog.kt
   ══════════════════════════════════════════════════════════════════════════════ */

describe('ReleaseHistoryDialog（ReleaseHistoryDialog.kt）', () => {
  it('59 条记录逐字，最新一条为 1.6.4', () => {
    expect(RELEASE_HISTORY).toHaveLength(59);
    expect(RELEASE_HISTORY[0]).toEqual({
      version: '1.6.4',
      date: '11-13',
      summary: '修复一些已知bug',
    });
    expect(RELEASE_HISTORY[1]?.summary).toBe('英文界面补齐 · 分类与统计文案 · 仓库清理');
    expect(RELEASE_HISTORY[20]?.summary).toBe(
      '新增书阁小说源 · 完整目录、在线文字与 EPUB 下载',
    );
    expect(RELEASE_HISTORY[58]).toEqual({
      version: '1.0.0',
      date: '08-28',
      summary: '首次发布',
    });
    expect(INSTALLED_VERSION).toBe('1.6.4');
  });

  it('渲染标题、已安装版本与当前版本分支', async () => {
    const { host } = await mount(<ReleaseHistoryDialog onDismiss={() => undefined} />);
    expect(host.querySelector('[data-testid="release-history"]')).not.toBeNull();
    expect(host.querySelector('.release-history__title')?.textContent).toBe('更新目录');
    expect(host.querySelector('.release-history__code')?.textContent).toBe('SYSTEM / RELEASES');
    expect(host.querySelector('.release-history__installed-label')?.textContent).toBe('已安装版本');
    expect(host.querySelector('.release-history__installed-version')?.textContent).toBe('1.6.4');
    // 同上：共享 `WenkuSectionHeader` 把 `01` 与 `RELEASE NOTES` 合成一行。
    expect(host.querySelector('.wenku-section-header__meta')?.textContent).toBe('01 / RELEASE NOTES');
    expect(host.querySelector('.wenku-section-header__title')?.textContent).toBe('版本记录');

    expect(host.querySelectorAll('.release-history__item')).toHaveLength(59);
    const versions = texts(host, '.release-history__version');
    expect(versions[0]).toBe('当前版本'); // 与 BuildConfig.VERSION_NAME 相等的那条
    expect(versions[1]).toBe('1.6.3');
    expect(versions.filter((text) => text === '当前版本')).toHaveLength(1);
    expect(texts(host, '.release-history__date')[0]).toBe('11-13');
    expect(texts(host, '.release-history__summary')[0]).toBe('修复一些已知bug');
  });

  it('已安装版本可覆盖；不匹配时全部显示版本号', async () => {
    const { host } = await mount(
      <ReleaseHistoryDialog installedVersion="1.5.15" onDismiss={() => undefined} />,
    );
    const versions = texts(host, '.release-history__version');
    expect(versions[0]).toBe('1.6.4');
    expect(versions[6]).toBe('当前版本'); // 1.5.15
    expect(host.querySelector('.release-history__installed-version')?.textContent).toBe('1.5.15');
  });

  it('关闭按钮与「关闭」都调用 onDismiss', async () => {
    const onDismiss = vi.fn<() => void>();
    const { host } = await mount(<ReleaseHistoryDialog onDismiss={onDismiss} />);
    await click(host.querySelector('.release-history__close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await click(buttonByText(host, '关闭'));
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(texts(host, '.release-history__sr-only')[0]).toBe('关闭更新目录');
  });
});
