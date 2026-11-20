/**
 * wenkuFlightVolumeParity.test.ts —— 3D 书架「飞入 / 重排 / 书脊渲染」+ 卡片凹陷的常量对拍。
 *
 * 这批常量的共同点：它们决定**动的观感**（飞行网格密度、重排错峰、翻开/合上时长、
 * 书脊材质的布料贴图种子、卡片凹陷的光向与环境光）。任何一个漂一点，
 * 表现都是「飞得抖 / 错峰乱 / 翻书太快 / 布纹闪」这类只在真机上看得出的毛病。
 *
 * 与前面几批的区别：这里**直接 import 真实导出**再与 Kotlin 原文解析值比对
 * （而不是在 TS 源码里搜字面量），所以「常量被改成引用别的字段」也躲不过。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BACKING_ARGB,
  PI_F,
  REFLOW_DURATION_MS,
  REFLOW_RISE_DP,
  REFLOW_STAGGER_BANDS,
  REFLOW_STAGGER_STEP,
  WENKU_MESH_COLUMNS,
  WENKU_MESH_EDGE_SAMPLES,
  WENKU_MESH_ROWS,
  WORKSPACE_CLOSE_MS,
} from '@core/wenku/parityNames';
import {
  BEND_FOCAL,
  CORNER_INSET,
  RECT_LIFT_BASE,
  RECT_LIFT_LIMIT,
  REFERENCE_FACE_HEIGHT,
  REFERENCE_FACE_WIDTH,
} from '@core/wenku/flight';
import {
  CLOSE_COVER_IN_MS,
  CLOSE_MS,
  CLOTH_TILE_SEED,
  MATERIAL_CLOTH,
  MATERIAL_GLOSS,
  MATERIAL_MATTE,
  OPEN_MS,
} from '@core/wenku/volumeRender';
import { DENT_AMBIENT, LIGHT_DIR_X, LIGHT_DIR_Y } from '@core/components/cardDent';

import { androidReference } from '../helpers/androidReference';

const KT_DIR = 'app/src/main/java/com/example';

const ATOM = '(?:0[xX][0-9a-fA-F_]+|[\\d_]+(?:\\.[\\d_]+)?(?:[eE][-+]?\\d+)?)[fFlLdD]?';
const EXPR = `-?${ATOM}(?:\\s*[*/]\\s*${ATOM})*`;

function evalExpr(raw: string): number | null {
  const normalized = raw
    .replace(/(\d)[fFlLdD]\b/g, '$1')
    .replace(/_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^-?0[xX]/.test(normalized)) return Number.parseInt(normalized.replace(/^-/, ''), 16);
  if (!/^[\d.\s*/()+ -]+$/.test(normalized)) return null;
  try {
    const value = Function(`"use strict";return (${normalized});`)() as unknown;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function kotlinConsts(rel: string): Map<string, number> {
  const source = readFileSync(androidReference(`${KT_DIR}/${rel}`), 'utf8');
  const out = new Map<string, number>();
  const re = new RegExp(
    `(?:(?:private|internal|public)\\s+)?const\\s+val\\s+([A-Z][A-Z0-9_]*)\\s*(?::\\s*[\\w<>?.]+)?\\s*=\\s*(${EXPR})\\s*(?:\\.[dsp]+|[fFlLdD])?`,
    'g',
  );
  let m;
  while ((m = re.exec(source)) !== null) {
    const value = evalExpr(m[2] ?? '');
    if (value !== null && !out.has(m[1] ?? '')) out.set(m[1] ?? '', value);
  }
  return out;
}

describe('WenkuCoverFlight.kt：飞行网格与参考面', () => {
  const kt = kotlinConsts('ui/wenku/WenkuCoverFlight.kt');

  it('网格 17×32、边缘采样 8、FLOAT 精度 π', () => {
    expect(kt.get('WENKU_MESH_COLUMNS')).toBeDefined();
    expect(WENKU_MESH_COLUMNS).toBe(kt.get('WENKU_MESH_COLUMNS'));
    expect(WENKU_MESH_COLUMNS).toBe(17);
    expect(WENKU_MESH_ROWS).toBe(kt.get('WENKU_MESH_ROWS'));
    expect(WENKU_MESH_ROWS).toBe(32);
    expect(WENKU_MESH_EDGE_SAMPLES).toBe(kt.get('WENKU_MESH_EDGE_SAMPLES'));
    expect(WENKU_MESH_EDGE_SAMPLES).toBe(8);
    // Kotlin 刻意用 Float 精度：3.1415927（不是 Math.PI）
    expect(PI_F).toBe(kt.get('PI_F'));
    expect(PI_F).toBeCloseTo(Math.PI, 6);
    expect(PI_F).not.toBe(Math.PI);
  });

  it('参考面 120×164、圆角内缩 8、抬升上限 32 / 基数 12、弯曲焦距 300', () => {
    for (const [name, tsValue] of [
      ['REFERENCE_FACE_WIDTH', REFERENCE_FACE_WIDTH],
      ['REFERENCE_FACE_HEIGHT', REFERENCE_FACE_HEIGHT],
      ['CORNER_INSET', CORNER_INSET],
      ['RECT_LIFT_LIMIT', RECT_LIFT_LIMIT],
      ['RECT_LIFT_BASE', RECT_LIFT_BASE],
      ['BEND_FOCAL', BEND_FOCAL],
    ] as const) {
      expect(kt.get(name), `Kotlin 里没有 ${name}`).toBeDefined();
      expect(tsValue, `${name} 与 Kotlin 不同值`).toBe(kt.get(name));
    }
    expect(REFERENCE_FACE_WIDTH).toBe(120);
    expect(REFERENCE_FACE_HEIGHT).toBe(164);
    // 参考面是竖版（高 > 宽）
    expect(REFERENCE_FACE_HEIGHT).toBeGreaterThan(REFERENCE_FACE_WIDTH);
    // 弯曲焦距必须远大于抬升上限，否则贴近「平面」
    expect(BEND_FOCAL).toBeGreaterThan(RECT_LIFT_LIMIT * 5);
    // BACKING_ARGB 在 Kotlin 里是 `private val`（不是 const val），单独从原文抽
    const backing = /private\s+val\s+BACKING_ARGB\s*:\s*Int\s*=\s*(0[xX][0-9a-fA-F]+)/.exec(
      readFileSync(androidReference(`${KT_DIR}/ui/wenku/WenkuCoverFlight.kt`), 'utf8'),
    );
    expect(backing, 'BACKING_ARGB 没匹配到').not.toBeNull();
    expect(BACKING_ARGB).toBe(Number.parseInt(backing?.[1] ?? '0', 16));
    expect(BACKING_ARGB).toBe(0xff202020);
  });
});

describe('WenkuReflow.kt：重排时长与错峰', () => {
  const kt = kotlinConsts('ui/wenku/WenkuReflow.kt');

  it('重排 420ms / 收起 280ms / 抬起 10dp / 错峰 0.025 × 9 档', () => {
    expect(REFLOW_DURATION_MS).toBe(kt.get('REFLOW_DURATION_MS'));
    expect(REFLOW_DURATION_MS).toBe(420);
    expect(WORKSPACE_CLOSE_MS).toBe(kt.get('WORKSPACE_CLOSE_MS'));
    expect(WORKSPACE_CLOSE_MS).toBe(280);
    expect(REFLOW_RISE_DP).toBe(kt.get('REFLOW_RISE_DP'));
    expect(REFLOW_RISE_DP).toBe(10);
    expect(REFLOW_STAGGER_STEP).toBe(kt.get('REFLOW_STAGGER_STEP'));
    expect(REFLOW_STAGGER_STEP).toBe(0.025);
    expect(REFLOW_STAGGER_BANDS).toBe(kt.get('REFLOW_STAGGER_BANDS'));
    expect(REFLOW_STAGGER_BANDS).toBe(9);
    // 收起必须比展开快（用户主动退出时不能拖）
    expect(WORKSPACE_CLOSE_MS).toBeLessThan(REFLOW_DURATION_MS);
    // 9 档 × 0.025 = 0.2 —— 最后一档错峰不超过总时长的 1/5
    // 9 档 × 0.025 = 0.225：最后一档错峰不超过总时长的 1/4
    expect(REFLOW_STAGGER_STEP * REFLOW_STAGGER_BANDS).toBeCloseTo(0.225, 9);
    expect(REFLOW_STAGGER_STEP * REFLOW_STAGGER_BANDS).toBeLessThanOrEqual(0.25);
  });
});

describe('ShelfVolumeRender.kt：翻开时序与书脊材质', () => {
  const kt = kotlinConsts('ui/wenku/ShelfVolumeRender.kt');

  it('翻开 880ms / 合上 720ms / 封面收回 120ms', () => {
    expect(OPEN_MS).toBe(kt.get('OPEN_MS'));
    expect(OPEN_MS).toBe(880);
    expect(CLOSE_MS).toBe(kt.get('CLOSE_MS'));
    expect(CLOSE_MS).toBe(720);
    expect(CLOSE_COVER_IN_MS).toBe(kt.get('CLOSE_COVER_IN_MS'));
    expect(CLOSE_COVER_IN_MS).toBe(120);
    // 合上比翻开短，封面收回又比整体合上短得多（收尾加速）
    expect(CLOSE_MS).toBeLessThan(OPEN_MS);
    expect(CLOSE_COVER_IN_MS).toBeLessThan(CLOSE_MS);
  });

  it('三种材质 id 是 0/1/2，布料贴图种子 11', () => {
    expect(MATERIAL_CLOTH).toBe(kt.get('MATERIAL_CLOTH'));
    expect(MATERIAL_MATTE).toBe(kt.get('MATERIAL_MATTE'));
    expect(MATERIAL_GLOSS).toBe(kt.get('MATERIAL_GLOSS'));
    expect([MATERIAL_CLOTH, MATERIAL_MATTE, MATERIAL_GLOSS]).toEqual([0, 1, 2]);
    expect(CLOTH_TILE_SEED).toBe(kt.get('CLOTH_TILE_SEED'));
    expect(CLOTH_TILE_SEED).toBe(11);
  });
});

describe('GlassCard.kt：凹陷的光向与环境光', () => {
  const kt = kotlinConsts('ui/components/GlassCard.kt');

  it('LIGHT_DIR = (0, -0.6)、DENT_AMBIENT = 0.8', () => {
    expect(LIGHT_DIR_X).toBe(kt.get('LIGHT_DIR_X'));
    expect(LIGHT_DIR_X).toBe(0);
    expect(LIGHT_DIR_Y).toBe(kt.get('LIGHT_DIR_Y'));
    expect(LIGHT_DIR_Y).toBe(-0.6);
    expect(DENT_AMBIENT).toBe(kt.get('DENT_AMBIENT'));
    expect(DENT_AMBIENT).toBe(0.8);
    // 方向是「正上方略偏」（y 为负 = 屏幕坐标向上），且是单位向量的一半左右
    expect(Math.hypot(LIGHT_DIR_X, LIGHT_DIR_Y)).toBeCloseTo(0.6, 6);
    // 环境光不能超过 1（会盖掉凹陷本身）
    expect(DENT_AMBIENT).toBeLessThan(1);
  });
});
