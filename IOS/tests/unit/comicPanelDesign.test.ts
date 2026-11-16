/**
 * comicPanelDesign.test.ts — 钉死 Android `ComicPanelDesign.kt`（L1-L339）中
 * 可脱离 Compose 测试的纯逻辑（颜色运算 + 滑条几何 + 开关几何）。
 * 端口：`src/core/comic/comicPanelDesign.ts`。
 */
import { describe, expect, it } from 'vitest';
import {
  PANEL_CARD_BG,
  PANEL_CARD_STROKE,
  PANEL_SLIDER_HEIGHT_DP,
  PANEL_SLIDER_PRESS_RING_R_DISABLED_DP,
  PANEL_SLIDER_PRESS_RING_R_DP,
  PANEL_SLIDER_RING_STROKE_DP,
  PANEL_SLIDER_THUMB_R_DP,
  PANEL_SLIDER_TRACK_H_DP,
  PANEL_SWITCH_BASE_OFFSET_DP,
  PANEL_SWITCH_TRAVEL_DP,
  comicPanelLerpColor,
  comicPanelWithAlpha,
  panelSelectedBg,
  panelSelectedStroke,
  panelSliderFraction,
  panelSliderPosToValue,
  panelSliderSnap,
} from '@core/comic/comicPanelDesign';

describe('令牌（L62-L64 / L239-L241 / L296-L315）', () => {
  it('PanelCardBg / PanelCardStroke 与 Kotlin 0x 值一致（Kotlin AARRGGBB → CSS RRGGBBAA）', () => {
    expect(PANEL_CARD_BG).toBe('#FFFFFF0D')
    expect(PANEL_CARD_STROKE).toBe('#FFFFFF26')
  })

  it('滑条/开关几何常量（dp → px 1:1）', () => {
    expect(PANEL_SLIDER_HEIGHT_DP).toBe(30)
    expect(PANEL_SLIDER_TRACK_H_DP).toBe(5)
    expect(PANEL_SLIDER_THUMB_R_DP).toBe(8)
    expect(PANEL_SLIDER_PRESS_RING_R_DP).toBe(12)
    expect(PANEL_SLIDER_PRESS_RING_R_DISABLED_DP).toBe(10)
    expect(PANEL_SLIDER_RING_STROKE_DP).toBe(1)
    expect(PANEL_SWITCH_TRAVEL_DP).toBe(18)
    expect(PANEL_SWITCH_BASE_OFFSET_DP).toBe(3)
  })
})

describe('comicPanelWithAlpha（L69/L72 的 Color.copy(alpha=)）', () => {
  it('替换 alpha、保留 RGB', () => {
    expect(comicPanelWithAlpha('#059669', 0.18)).toBe('#0596692E')
    expect(comicPanelWithAlpha('#059669', 0.55)).toBe('#0596698C')
    expect(comicPanelWithAlpha('#059669', 0.9)).toBe('#059669E6')
    expect(comicPanelWithAlpha('#059669', 1)).toBe('#059669FF')
  })

  it('alpha 出界被钳制', () => {
    expect(comicPanelWithAlpha('#000000', -1)).toBe('#00000000')
    expect(comicPanelWithAlpha('#000000', 2)).toBe('#000000FF')
  })
})

describe('panelSelectedBg / panelSelectedStroke（L69/L72）', () => {
  it('薄荷绿 18% / 55%', () => {
    expect(panelSelectedBg('#059669')).toBe('#0596692E')
    expect(panelSelectedStroke('#059669')).toBe('#0596698C')
  })
})

describe('comicPanelLerpColor（L323-L328）', () => {
  it('t=0 → a；t=1 → b', () => {
    expect(comicPanelLerpColor('#000000', '#FFFFFF', 0)).toBe('#000000FF')
    expect(comicPanelLerpColor('#000000', '#FFFFFF', 1)).toBe('#FFFFFFFF')
  })

  it('t=0.5 → 逐通道中点（含 alpha）', () => {
    expect(comicPanelLerpColor('#00000000', '#FFFFFFFF', 0.5)).toBe('#80808080')
  })

  it('PanelSwitch 轨道色端点：t=0 → #FFFFFF33；t=1 → mint 85%', () => {
    expect(comicPanelLerpColor('#FFFFFF33', '#059669D9', 0)).toBe('#FFFFFF33')
    expect(comicPanelLerpColor('#FFFFFF33', '#059669D9', 1)).toBe('#059669D9')
  })
})

describe('panelSliderFraction（L182-L184）', () => {
  it('start < end → 线性并钳 [0,1]', () => {
    expect(panelSliderFraction(0, [0, 10])).toBe(0)
    expect(panelSliderFraction(5, [0, 10])).toBe(0.5)
    expect(panelSliderFraction(10, [0, 10])).toBe(1)
    expect(panelSliderFraction(-5, [0, 10])).toBe(0)
    expect(panelSliderFraction(50, [0, 10])).toBe(1)
  })

  it('end == start → 0（L184 else 分支）', () => {
    expect(panelSliderFraction(5, [5, 5])).toBe(0)
    expect(panelSliderFraction(5, [10, 0])).toBe(0)
  })

  it('负起点范围也正确', () => {
    expect(panelSliderFraction(-5, [-10, 0])).toBe(0.5)
  })
})

describe('panelSliderSnap（L189-L192）', () => {
  it('steps=0 → 原值', () => {
    expect(panelSliderSnap(0.3333, 0)).toBe(0.3333)
    expect(panelSliderSnap(-1, 0)).toBe(-1)
  })

  it('steps>0 → 吸附到 1/(steps+1) 的整数倍', () => {
    // steps=3 → st = 0.25 → 吸附 0 / .25 / .5 / .75 / 1
    expect(panelSliderSnap(0.1, 3)).toBe(0)
    expect(panelSliderSnap(0.13, 3)).toBe(0.25)
    expect(panelSliderSnap(0.4, 3)).toBe(0.5)
    expect(panelSliderSnap(0.9, 3)).toBe(1)
  })

  it('结果钳 [0,1]', () => {
    expect(panelSliderSnap(-0.4, 3)).toBe(0)
    expect(panelSliderSnap(1.4, 3)).toBe(1)
  })
})

describe('panelSliderPosToValue（L201-L205）', () => {
  it('x 在轨道内 → 线性映射', () => {
    expect(panelSliderPosToValue(0, 100, [0, 10], 0, false)).toBe(0)
    expect(panelSliderPosToValue(50, 100, [0, 10], 0, false)).toBe(5)
    expect(panelSliderPosToValue(100, 100, [0, 10], 0, false)).toBe(10)
  })

  it('x 越界被钳制（L202 coerceIn）', () => {
    expect(panelSliderPosToValue(-20, 100, [0, 10], 0, false)).toBe(0)
    expect(panelSliderPosToValue(200, 100, [0, 10], 0, false)).toBe(10)
  })

  it('reverse → 水平镜像（L203 1f - physical）', () => {
    expect(panelSliderPosToValue(0, 100, [0, 10], 0, true)).toBe(10)
    expect(panelSliderPosToValue(50, 100, [0, 10], 0, true)).toBe(5)
    expect(panelSliderPosToValue(100, 100, [0, 10], 0, true)).toBe(0)
  })

  it('steps 在 posToValue 内生效（L203 snap）', () => {
    // st = 0.25 → x=10/100=0.1 → snap → 0
    expect(panelSliderPosToValue(10, 100, [0, 10], 3, false)).toBe(0)
    // x=20/100=0.2 → snap → 0.25 → 2.5
    expect(panelSliderPosToValue(20, 100, [0, 10], 3, false)).toBe(2.5)
  })

  it('非零起点范围', () => {
    expect(panelSliderPosToValue(50, 100, [20, 60], 0, false)).toBe(40)
  })
})
