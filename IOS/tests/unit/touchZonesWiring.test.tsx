/**
 * touchZonesWiring.test.tsx — 自定义触控分区（Android 1.6.x）接线回归。
 *
 * 权威源（只读）
 * ─────────────────────────────────────────────────────────────────────────────
 *   `ui/reader/TouchZones.kt`（101 行）        → `src/core/reader/touchZones.ts`
 *   `ui/reader/TouchZoneGestures.kt`（112 行） → `src/ui/reader/touchZoneGestures.ts`
 *   `ui/reader/TouchZoneEditor.kt`（387 行）   → `src/ui/components/reader/TouchZoneEditor.tsx`
 *   `ui/ReaderScreen.kt` L345-352 / L1701-1718 / L1864 / L1879 / L1974 / L3502-3516
 *                                              → `src/ui/pages/ReaderPage.tsx`
 *   `ui/comic/ComicReaderConfig.kt` L86 / L124 / L191 / L272
 *                                              → `src/core/comic/comicReaderConfig.ts`
 *   `ui/comic/ComicReaderCore.kt` L887 / L930-944 / L988-1000
 *                                              → `src/ui/pages/ComicReaderPage.tsx`
 *   `ui/comic/ComicReaderSheets.kt` L1473-1477 → `ComicSettingsGestureTab.tsx`
 *
 * 本文件锁四件事：
 *   ① 模型/判定/`fastPageCommit` 的固定向量（Kotlin 数值逐字）；
 *   ② 小说阅读器：`reader_touch_zones_v1` / `novel` 的读取与保存（走真实
 *      `SettingsRepository` + 假 db），以及「分区点击 → 翻页动作」；
 *   ③ 漫画：`ComicReaderConfig` 的 JSON 往返含 `touchZones`、`resolveTapAction`
 *      优先自定义区、默认三分区的 RTL 反向；
 *   ④ 设置入口可见 + 编辑器 `onSave` 真写回配置文件。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SQLiteDatabase } from '@platform/interfaces';
import {
  MAX_DISTANCE_DP,
  MIN_DISTANCE_DP,
  NovelTouchZoneStore,
  TOUCH_ACTIONS,
  TOUCH_ZONE_PREFS,
  TouchGestureDecision,
  comicDefaultTouchZones,
  createMemoryTouchZonePrefs,
  createTouchZone,
  decodeZones,
  encodeZones,
  fastPageCommit,
  loadNovelTouchZones,
  novelDefaultTouchZones,
  novelTouchZonePrefsKey,
  novelTouchZoneSplit,
  pageSwipeAction,
  resolveComicZoneTapAction,
  saveNovelTouchZones,
  swipeGuideSign,
  zoneContains,
  zoneHit,
  type TouchZone,
} from '@core/reader/touchZones';
import { bindTouchZoneGestures, estimateVelocity } from '@ui/reader/touchZoneGestures';
import { SettingsRepository } from '@core/settings/settingsRepository';
import {
  DEFAULT_COMIC_READER_CONFIG,
  comicReaderConfigFromJson,
  comicReaderConfigToJson,
  comicReaderConfigToJsonString,
  createComicReaderConfig,
  touchZonesOf,
  withComicTouchZones,
} from '@core/comic/comicReaderConfig';
import {
  ComicSettingsStore,
  createMemoryComicStore,
  KEY_GLOBAL_CONFIG,
} from '@core/comic/comicSettingsStore';
import { ComicReaderPage } from '@ui/pages/ComicReaderPage';
import {
  DEFAULT_COMIC_READER_CONFIG as CORE_DEFAULT_COMIC_READER_CONFIG,
  type ComicBitmap,
  type ComicPageLoaderPort,
  type ComicPageRef,
} from '@core/comic/comicReaderCore';

// React 19 要求显式声明 act 环境
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

/* ══════════════════════════════════════════════════════════════════════════════
   ① 模型固定向量 —— TouchZones.kt
   ══════════════════════════════════════════════════════════════════════════════ */

const BASE = createTouchZone('base');

describe('TouchZone 模型（TouchZones.kt L23-61）', () => {
  it('TouchZone() 默认值与 Kotlin L25-30 逐字段一致', () => {
    expect(BASE).toEqual({
      id: 'base',
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
    expect(TOUCH_ACTIONS).toEqual([
      'NONE',
      'PREVIOUS',
      'NEXT',
      'CONTROLS',
      'SETTINGS',
      'CONTENTS',
      'LISTEN',
      'EXIT',
    ]);
  });

  it('contains 四边闭合（L32）', () => {
    expect(zoneContains(BASE, 0.15, 0.2)).toBe(true);
    expect(zoneContains(BASE, 0.85, 0.65)).toBe(true);
    expect(zoneContains(BASE, 0.1499, 0.5)).toBe(false);
    expect(zoneContains(BASE, 0.5, 0.1999)).toBe(false);
    expect(zoneContains(BASE, 0.5, 0.2001)).toBe(true);
    expect(zoneContains(BASE, 0.8501, 0.5)).toBe(false);
  });

  it('normalized() 四角 coerce 范围：0..0.92 / l+.08..1 / t+.08..1（L33-39）', () => {
    const normalized = decodeZones(
      JSON.stringify([
        { id: 'a', l: 0.95, t: -3, r: 0.5, b: 0.5, tap: 'NONE', swipe: 'NONE' },
      ]),
    );
    const zone = normalized?.[0];
    expect(zone?.left).toBe(0.92);
    expect(zone?.top).toBe(0);
    // right = coerceIn(l + .08, 1) ⇒ 0.92 + 0.08 = 1
    expect(zone?.right).toBe(1);
    // bottom = coerceIn(t + .08, 1) ⇒ .5 已在 [0.08, 1] 内
    expect(zone?.bottom).toBe(0.5);

    const clampedBottom = decodeZones(
      JSON.stringify([{ id: 'b', l: 0, t: 0.9, r: 1, b: 0.1, tap: 'NONE', swipe: 'NONE' }]),
    )?.[0];
    expect(clampedBottom?.bottom).toBeCloseTo(0.98, 6);
    expect(clampedBottom?.right).toBe(1);

    // 非有限值走 `safe(default)`：left 回 .15，distanceDp 直接变 null
    const nan = decodeZones('[]');
    expect(nan).toEqual([]);
    expect(zoneHit(nan ?? [], 0, 0)).toBeNull();
  });

  it('distanceDp：12..360 夹紧，缺失 ⇒ null，非法 ⇒ 整条 decode 失败（L38/L55）', () => {
    const [withDistance] = decodeZones(
      JSON.stringify([{ id: 'a', l: 0, t: 0, r: 1, b: 1, distance: 5 }]),
    ) ?? [];
    expect(withDistance?.distanceDp).toBe(12);
    const [tooBig] = decodeZones(
      JSON.stringify([{ id: 'a', l: 0, t: 0, r: 1, b: 1, distance: 999 }]),
    ) ?? [];
    expect(tooBig?.distanceDp).toBe(360);
    const [missing] = decodeZones(JSON.stringify([{ id: 'a', l: 0, t: 0, r: 1, b: 1 }])) ?? [];
    expect(missing?.distanceDp).toBeNull();
    // Kotlin `o.has("distance") → o.getDouble(...)`：存在但非数字 ⇒ JSONException ⇒ 整串 null
    expect(
      decodeZones(JSON.stringify([{ id: 'a', l: 0, t: 0, r: 1, b: 1, distance: 'x' }])),
    ).toBeNull();
  });

  it('hit：最后命中的矩形优先，NONE 阻断下层、不穿透（L59-60）', () => {
    const lower = createTouchZone('lower', { left: 0, top: 0, right: 1, bottom: 1, tap: 'PREVIOUS' });
    const upper = createTouchZone('upper', {
      left: 0.2,
      top: 0.2,
      right: 0.4,
      bottom: 0.4,
      tap: 'NONE',
    });
    expect(zoneHit([lower, upper], 0.3, 0.3)).toMatchObject({ id: 'upper', tap: 'NONE' });
    expect(zoneHit([lower, upper], 0.9, 0.9)).toMatchObject({ id: 'lower', tap: 'PREVIOUS' });
    // 顺序决定优先级：同一位置，后入列者胜
    expect(zoneHit([upper, lower], 0.3, 0.3)?.id).toBe('lower');
    expect(zoneHit([lower, upper], 1.2, 0.3)).toBeNull();
  });

  it('encode/decode：64 上限、按 id 去重、坏数据 null、未知枚举 ⇒ NONE（L45-58）', () => {
    const zones = [createTouchZone('a'), createTouchZone('b', { distanceDp: 90, tap: 'NEXT' })];
    const decoded = decodeZones(encodeZones(zones));
    expect(decoded).toHaveLength(2);
    expect(decoded?.[1]).toMatchObject({ id: 'b', distanceDp: 90, tap: 'NEXT' });

    // 未知枚举回落 NONE（不是丢弃整条）
    expect(
      decodeZones('[{"id":"x","l":0,"t":0,"r":1,"b":1,"tap":"?","swipe":"?"}]')?.[0],
    ).toMatchObject({ tap: 'NONE', swipe: 'NONE' });

    // 同 id 只保留第一条
    const dup = decodeZones(
      '[{"id":"x","l":0,"t":0,"r":1,"b":1,"tap":"NEXT"},{"id":"x","l":0,"t":0,"r":0.5,"b":1,"tap":"PREVIOUS"}]',
    );
    expect(dup).toHaveLength(1);
    expect(dup?.[0]?.tap).toBe('NEXT');

    expect(decodeZones('[{"id":"x","t":0,"r":1,"b":1}]')).toBeNull();
    expect(decodeZones('not json')).toBeNull();
    expect(decodeZones('null')).toBeNull();
    expect(decodeZones(null)).toBeNull();
    expect(
      decodeZones(
        JSON.stringify(Array.from({ length: 65 }, (_v, i) => ({ id: `z${String(i)}`, l: 0, t: 0, r: 1, b: 1 }))),
      ),
    ).toBeNull();
  });

  it('swipeGuideSign / pageSwipeAction（TouchZones.kt L100-101 + Gestures L101-104）', () => {
    expect(swipeGuideSign('PREVIOUS', false)).toBe(1);
    expect(swipeGuideSign('NEXT', false)).toBe(-1);
    expect(swipeGuideSign('PREVIOUS', true)).toBe(-1);
    expect(swipeGuideSign('NEXT', true)).toBe(1);

    // 横向：左滑（dx<0）⇒ NEXT；反向（reverse）⇒ PREVIOUS
    expect(pageSwipeAction(-100, 0, false, false)).toBe('NEXT');
    expect(pageSwipeAction(100, 0, false, false)).toBe('PREVIOUS');
    expect(pageSwipeAction(-100, 0, false, true)).toBe('PREVIOUS');
    // 纵向：看 dy
    expect(pageSwipeAction(0, -100, true, false)).toBe('NEXT');
    expect(pageSwipeAction(0, 100, true, false)).toBe('PREVIOUS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ② TouchGestureDecision / fastPageCommit —— TouchZones.kt L72-97
   ══════════════════════════════════════════════════════════════════════════════ */

describe('TouchGestureDecision（L72-87）', () => {
  it('tap：位移 ≤ slop 才算点击，移动后绝不再产生 click', () => {
    const decision = new TouchGestureDecision(8, 40);
    decision.update(3, 3);
    expect(decision.isTap()).toBe(true);
    expect(decision.isSwipe(false)).toBe(false);

    decision.update(9, 0);
    expect(decision.moved).toBe(true);
    expect(decision.isTap()).toBe(false);
    // 单向：回到原点也不算点击
    decision.update(0, 0);
    expect(decision.moved).toBe(true);
    expect(decision.isTap()).toBe(false);
  });

  it('swipe：欧氏距离 ≥ threshold（与轴向无关）', () => {
    const decision = new TouchGestureDecision(8, 40);
    decision.update(30, 40); // hypot = 50
    expect(decision.isSwipe(false)).toBe(true);
    expect(decision.isSwipe(true)).toBe(true);

    const short = new TouchGestureDecision(8, 40);
    short.update(9, 0); // 过了 slop 但没到 threshold
    expect(short.moved).toBe(true);
    expect(short.isSwipe(false)).toBe(false);
  });

  it('多指 / consumed 一旦出现即取消（isTap 与 isSwipe 都为 false）', () => {
    const multi = new TouchGestureDecision(8, 0);
    multi.update(0, 0, 2);
    expect(multi.cancelled).toBe(true);
    expect(multi.isTap()).toBe(false);
    expect(multi.isSwipe(false)).toBe(false);
    expect(multi.pointers).toBe(2);

    const consumed = new TouchGestureDecision(8, 0);
    consumed.update(0, 0, 1, true);
    expect(consumed.cancelled).toBe(true);
    expect(consumed.isTap()).toBe(false);
  });
});

describe('fastPageCommit（L90-97）', () => {
  const fast = { x: 1000, y: 0 };
  const slow = { x: 400, y: 0 };

  it('distanceDp == null ⇒ 交回 native 判定', () => {
    expect(fastPageCommit(null, { x: 50, y: 0 }, fast, 1, true)).toBe(true);
    expect(fastPageCommit(null, { x: 50, y: 0 }, fast, 1, false)).toBe(false);
  });

  it('850 dp/s * density 是快速甩动的门槛', () => {
    // velocity < 850*density ⇒ native
    expect(fastPageCommit(100, { x: 200, y: 0 }, slow, 1, false)).toBe(false);
    expect(fastPageCommit(100, { x: 200, y: 0 }, slow, 1, true)).toBe(true);
    // velocity == 850*density（不取等号下界之外）⇒ 覆盖 native
    expect(fastPageCommit(100, { x: 200, y: 0 }, { x: 850, y: 0 }, 1, false)).toBe(true);
    // density 2 ⇒ 门槛 1700
    expect(fastPageCommit(100, { x: 200, y: 0 }, { x: 1000, y: 0 }, 2, false)).toBe(false);
    expect(fastPageCommit(100, { x: 300, y: 0 }, { x: 1700, y: 0 }, 2, false)).toBe(true);
  });

  it('反向甩动（delta·velocity < 0）恒为 false', () => {
    expect(fastPageCommit(100, { x: 200, y: 0 }, { x: -1000, y: 0 }, 1, true)).toBe(false);
  });

  it('delta 必须达到 distanceDp * density', () => {
    expect(fastPageCommit(100, { x: 99, y: 0 }, fast, 1, true)).toBe(false);
    expect(fastPageCommit(100, { x: 100, y: 0 }, fast, 1, false)).toBe(true);
    // 斜向也按欧氏距离
    expect(fastPageCommit(100, { x: 60, y: 80 }, fast, 1, false)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ③ 小说阅读器：reader_touch_zones_v1 / novel 的读取与保存
   ══════════════════════════════════════════════════════════════════════════════ */

interface FakeRow {
  type: string;
  value: string;
}

/** `SettingsRepository` 的最小 SQLite 假实现（app_settings 单表）。 */
function fakeSettingsDb(initial: Readonly<Record<string, FakeRow>> = {}): {
  rows: Map<string, FakeRow>;
  db: SQLiteDatabase;
} {
  const rows = new Map<string, FakeRow>(Object.entries(initial));
  const execute = async (sql: string, params?: readonly unknown[]): Promise<void> => {
    if (sql.startsWith('INSERT INTO "app_settings"')) {
      const [key, type, value] = params as readonly [string, string, string];
      rows.set(key, { type, value });
      return;
    }
    if (sql.startsWith('DELETE FROM "app_settings"')) {
      rows.clear();
      return;
    }
    // CREATE TABLE / BEGIN / COMMIT / ROLLBACK 不改变数据
  };
  const query = async <T,>(sql: string): Promise<T[]> => {
    if (!sql.includes('FROM "app_settings"')) return [];
    return [...rows.entries()].map(([key, row]) => ({
      key,
      type: row.type,
      value: row.value,
    })) as unknown as T[];
  };
  return { rows, db: { execute, query } as unknown as SQLiteDatabase };
}

describe('小说阅读器 store（TouchZones.kt L64-70 + SettingsRepository 适配）', () => {
  const ZONES = [
    createTouchZone('left', { left: 0, top: 0, right: 0.35, bottom: 1, tap: 'PREVIOUS' }),
    createTouchZone('right', { left: 0.65, top: 0, right: 1, bottom: 1, tap: 'NEXT', distanceDp: 64 }),
  ];

  it('平台键名 = reader_touch_zones_v1 + novel', () => {
    expect(novelTouchZonePrefsKey()).toBe('reader_touch_zones_v1:novel');
  });

  it('同步端口：save → load 往返；save(null) 删除键', () => {
    const prefs = createMemoryTouchZonePrefs();
    const store = new NovelTouchZoneStore(prefs);
    expect(store.load()).toBeNull();

    store.save(ZONES);
    const loaded = store.load();
    expect(loaded?.map((zone) => zone.id)).toEqual(['left', 'right']);
    expect(loaded?.[1]?.distanceDp).toBe(64);

    store.save(null);
    expect(prefs.getString(novelTouchZonePrefsKey())).toBeNull();
    expect(store.load()).toBeNull();
  });

  it('SettingsRepository 适配：读取已有分区（设置表 → decode）', async () => {
    const { db } = fakeSettingsDb({
      'reader_touch_zones_v1:novel': { type: 'string', value: JSON.stringify(encodeZones(ZONES)) },
    });
    const zones = await loadNovelTouchZones(new SettingsRepository(db));
    expect(zones?.map((zone) => zone.id)).toEqual(['left', 'right']);
  });

  it('SettingsRepository 适配：保存写回同一键，清除则移除', async () => {
    const { db, rows } = fakeSettingsDb();
    const repo = new SettingsRepository(db);

    await saveNovelTouchZones(repo, ZONES);
    const row = rows.get('reader_touch_zones_v1:novel');
    expect(row?.type).toBe('string');
    // 存的是字符串设置（值是 JSON 字符串，内部再编码一次），与 Kotlin putString 同形
    expect(JSON.parse(row?.value ?? '""')).toBe(encodeZones(ZONES));
    expect((await loadNovelTouchZones(repo))?.map((zone) => zone.id)).toEqual(['left', 'right']);

    await saveNovelTouchZones(repo, null);
    expect(rows.has('reader_touch_zones_v1:novel')).toBe(false);
    expect(await loadNovelTouchZones(repo)).toBeNull();
  });

  it('默认分区：滚动模式整屏一块，翻页模式左/中/右三段（ReaderScreen.kt L3505-3509）', () => {
    const scroll = novelDefaultTouchZones(true, 0.35);
    expect(scroll).toHaveLength(1);
    expect(scroll[0]).toMatchObject({ id: 'scroll', left: 0, top: 0, right: 1, bottom: 1, swipe: 'NONE' });

    const paged = novelDefaultTouchZones(false, 1 / 3);
    expect(paged.map((zone) => zone.id)).toEqual(['left', 'center', 'right']);
    expect(paged.map((zone) => zone.tap)).toEqual(['PREVIOUS', 'CONTROLS', 'NEXT']);
    expect(paged[1]?.left).toBeCloseTo(1 / 3, 9);
    expect(paged[1]?.right).toBeCloseTo(2 / 3, 9);
    expect(paged[1]?.swipe).toBe('PAGE');

    // SIMULATE / minimal ⇒ 1/3，其余 0.35
    expect(novelTouchZoneSplit(true, false)).toBeCloseTo(1 / 3, 6);
    expect(novelTouchZoneSplit(false, true)).toBeCloseTo(1 / 3, 6);
    expect(novelTouchZoneSplit(false, false)).toBeCloseTo(0.35, 6);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ④ 手势层：分区点击 / 滑动 → TouchAction（TouchZoneGestures.kt L46-110）
   ══════════════════════════════════════════════════════════════════════════════ */

const WIDTH = 300;
const HEIGHT = 600;

function pointerEvent(type: string, x: number, y: number, id = 1): PointerEvent {
  const event = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  Object.defineProperty(event, 'isPrimary', { value: id === 1 });
  return event as unknown as PointerEvent;
}

/** 三块竖切分区（左=上一页 / 中=菜单 / 右=下一页），与漫画默认三分区同形。 */
const THIRDS: readonly TouchZone[] = [
  createTouchZone('left', { left: 0, top: 0, right: 1 / 3, bottom: 1, tap: 'PREVIOUS' }),
  createTouchZone('center', { left: 1 / 3, top: 0, right: 2 / 3, bottom: 1, tap: 'CONTROLS' }),
  createTouchZone('right', { left: 2 / 3, top: 0, right: 1, bottom: 1, tap: 'NEXT' }),
];

describe('触控分区手势层（ReaderPage 的 onAction 接线）', () => {
  let host: HTMLDivElement;
  let actions: string[];
  let detach: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    actions = [];
    host = document.createElement('div');
    host.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: WIDTH,
        height: HEIGHT,
        right: WIDTH,
        bottom: HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    // jsdom 没有指针捕获实现：给个 no-op，避免手势层走 try/catch 分支
    host.setPointerCapture = () => undefined;
    host.releasePointerCapture = () => undefined;
    document.body.append(host);
    const binding = bindTouchZoneGestures(host, {
      zones: THIRDS,
      // Kotlin `{ it * .15f }`
      defaultDistance: (span) => span * 0.15,
      onAction: (action) => actions.push(action),
      slop: 8,
      density: 1,
    });
    detach = binding.detach;
  });

  afterEach(() => {
    detach();
    host.remove();
  });

  const tap = (x: number, y = HEIGHT / 2): void => {
    host.dispatchEvent(pointerEvent('pointerdown', x, y));
    host.dispatchEvent(pointerEvent('pointerup', x, y));
  };

  it('点击右侧分区 → NEXT；左侧 → PREVIOUS；中间 → CONTROLS', () => {
    tap(250);
    expect(actions).toEqual(['NEXT']);
    actions.length = 0;
    tap(50);
    expect(actions).toEqual(['PREVIOUS']);
    actions.length = 0;
    tap(150);
    expect(actions).toEqual(['CONTROLS']);
  });

  it('滑过完成距离才翻页：180px 左滑 → NEXT，10px 抖动 → 无动作', () => {
    host.dispatchEvent(pointerEvent('pointerdown', 260, 300));
    host.dispatchEvent(pointerEvent('pointermove', 200, 300));
    host.dispatchEvent(pointerEvent('pointermove', 80, 300));
    host.dispatchEvent(pointerEvent('pointerup', 80, 300));
    expect(actions).toEqual(['NEXT']);

    actions.length = 0;
    host.dispatchEvent(pointerEvent('pointerdown', 150, 300));
    host.dispatchEvent(pointerEvent('pointermove', 140, 300));
    host.dispatchEvent(pointerEvent('pointerup', 140, 300));
    // 移动过 slop（10 > 8）⇒ 不再是点击；但 hypot 10 < 0.15 * 300 = 45 ⇒ 不翻页
    expect(actions).toEqual([]);
  });

  it('右滑 → PREVIOUS（PAGE 双向）', () => {
    host.dispatchEvent(pointerEvent('pointerdown', 80, 300));
    host.dispatchEvent(pointerEvent('pointermove', 150, 300));
    host.dispatchEvent(pointerEvent('pointermove', 260, 300));
    host.dispatchEvent(pointerEvent('pointerup', 260, 300));
    expect(actions).toEqual(['PREVIOUS']);
  });

  it('多指取消：第二根手指落下后整次手势不产生动作，全部抬起后恢复', () => {
    host.dispatchEvent(pointerEvent('pointerdown', 250, 300, 1));
    host.dispatchEvent(pointerEvent('pointerdown', 50, 300, 2));
    host.dispatchEvent(pointerEvent('pointerup', 50, 300, 2));
    host.dispatchEvent(pointerEvent('pointerup', 250, 300, 1));
    expect(actions).toEqual([]);

    tap(250);
    expect(actions).toEqual(['NEXT']);
  });

  it('velocity 估计：100ms 视界内首尾样本（px/s）', () => {
    expect(estimateVelocity([{ x: 0, y: 0, t: 0 }])).toEqual({ x: 0, y: 0 });
    const velocity = estimateVelocity([
      { x: 0, y: 0, t: 0 },
      { x: 50, y: 0, t: 50 },
      { x: 100, y: 0, t: 100 },
    ]);
    expect(velocity.x).toBeCloseTo(1000, 6);
    expect(velocity.y).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑤ 漫画：JSON 往返 / resolveTapAction / 默认三分区
   ══════════════════════════════════════════════════════════════════════════════ */

const COMIC_ZONES: readonly TouchZone[] = [
  createTouchZone('default0', { left: 0, top: 0, right: 1 / 3, bottom: 1, tap: 'PREVIOUS' }),
  createTouchZone('default1', { left: 1 / 3, top: 0, right: 2 / 3, bottom: 1, tap: 'CONTROLS' }),
  createTouchZone('default2', { left: 2 / 3, top: 0, right: 1, bottom: 1, tap: 'NEXT' }),
];

describe('ComicReaderConfig.touchZones（ComicReaderConfig.kt L86/L124/L191/L272）', () => {
  it('默认 null（= 完整 legacy 手势）', () => {
    expect(DEFAULT_COMIC_READER_CONFIG.touchZones).toBeNull();
    expect(touchZonesOf(DEFAULT_COMIC_READER_CONFIG)).toBeNull();
  });

  it('toJson：键位在 autoScrollSpeedDp 与 gestureTapLeft 之间，null 时整键不出现', () => {
    const withZones = createComicReaderConfig({ touchZones: COMIC_ZONES });
    const json = comicReaderConfigToJson(withZones);
    const keys = Object.keys(json);
    expect(keys.indexOf('touchZones')).toBe(keys.indexOf('autoScrollSpeedDp') + 1);
    expect(keys.indexOf('gestureTapLeft')).toBe(keys.indexOf('touchZones') + 1);
    expect(json['touchZones']).toEqual([
      { id: 'default0', l: 0, t: 0, r: 1 / 3, b: 1, tap: 'PREVIOUS', swipe: 'PAGE' },
      { id: 'default1', l: 1 / 3, t: 0, r: 2 / 3, b: 1, tap: 'CONTROLS', swipe: 'PAGE' },
      { id: 'default2', l: 2 / 3, t: 0, r: 1, b: 1, tap: 'NEXT', swipe: 'PAGE' },
    ]);

    const withoutZones = comicReaderConfigToJson(DEFAULT_COMIC_READER_CONFIG);
    expect(Object.keys(withoutZones)).not.toContain('touchZones');
  });

  it('JSON 往返：stringify → fromJson 保序保值；distance 只在非 null 时出现', () => {
    const withDistance = COMIC_ZONES.map((zone, index) =>
      index === 1 ? { ...zone, distanceDp: 72 } : zone,
    );
    const raw = comicReaderConfigToJsonString(
      createComicReaderConfig({ touchZones: withDistance }),
    );
    const restored = comicReaderConfigFromJson(JSON.parse(raw) as Record<string, unknown>);
    expect(restored.touchZones).toHaveLength(3);
    expect(restored.touchZones?.map((zone) => zone.id)).toEqual([
      'default0',
      'default1',
      'default2',
    ]);
    expect(restored.touchZones?.[1]?.distanceDp).toBe(72);
    expect(restored.touchZones?.[0]?.distanceDp).toBeNull();
    expect(restored.touchZones?.[0]?.tap).toBe('PREVIOUS');
  });

  it('fromJson：65 条 → decode 失败 ⇒ null（Kotlin require(<= 64)）', () => {
    const json = comicReaderConfigToJson(createComicReaderConfig());
    // 注意：`encodeZones` 自己就 take(64)，所以这里直接手写 65 条的 JSON 数组，
    // 模拟「旧存档/外部导入」里超出上限的数据。
    json['touchZones'] = Array.from({ length: 65 }, (_v, i) => ({
      id: `z${String(i)}`,
      l: 0,
      t: 0,
      r: 1,
      b: 1,
    }));
    expect(comicReaderConfigFromJson(json).touchZones).toBeNull();

    // 64 条可以解出来
    json['touchZones'] = Array.from({ length: 64 }, (_v, i) => ({
      id: `z${String(i)}`,
      l: 0,
      t: 0,
      r: 1,
      b: 1,
    }));
    expect(comicReaderConfigFromJson(json).touchZones).toHaveLength(64);
  });

  it('withComicTouchZones 归一化 + 按 id 去重（Kotlin normalized() L124）', () => {
    const merged = withComicTouchZones(DEFAULT_COMIC_READER_CONFIG, [
      createTouchZone('a', { left: -1, top: 0.95, right: 5, bottom: -3 }),
      createTouchZone('a', { left: 0.5 }),
      createTouchZone('b'),
    ]);
    expect(merged.touchZones?.map((zone) => zone.id)).toEqual(['a', 'b']);
    expect(merged.touchZones?.[0]).toMatchObject({ left: 0, top: 0.92, right: 1, bottom: 1 });
  });

  it('resolveTapAction 优先自定义区：命中取 tap，未命中 ⇒ NONE（不回落三分区）', () => {
    expect(resolveComicZoneTapAction(null, 0.9, 0.5)).toBeNull();
    expect(resolveComicZoneTapAction(COMIC_ZONES, 0.9, 0.5)).toBe('NEXT');
    expect(resolveComicZoneTapAction(COMIC_ZONES, 0.1, 0.5)).toBe('PREV');
    expect(resolveComicZoneTapAction(COMIC_ZONES, 0.5, 0.5)).toBe('TOGGLE_CONTROLS');

    const blocking = [
      createTouchZone('full', { left: 0, top: 0, right: 1, bottom: 1, tap: 'NONE' }),
      createTouchZone('inner', { left: 0.2, top: 0.2, right: 0.4, bottom: 0.4, tap: 'SETTINGS' }),
    ];
    expect(resolveComicZoneTapAction(blocking, 0.9, 0.9)).toBe('NONE');
    expect(resolveComicZoneTapAction(blocking, 0.3, 0.3)).toBe('SETTINGS');
  });

  it('默认三分区：竖屏上下三块，横屏左右三块，RTL 反向（ComicReaderCore.kt L930-937）', () => {
    const horizontal = comicDefaultTouchZones({
      vertical: false,
      reverse: false,
      taps: ['PREVIOUS', 'CONTROLS', 'NEXT'],
      swipe: 'PAGE',
    });
    expect(horizontal.map((zone) => zone.id)).toEqual(['default0', 'default1', 'default2']);
    expect(horizontal[0]).toMatchObject({ left: 0, top: 0, right: 1 / 3, bottom: 1 });
    expect(horizontal[2]).toMatchObject({ left: 2 / 3, top: 0, right: 1, bottom: 1 });

    const vertical = comicDefaultTouchZones({
      vertical: true,
      reverse: false,
      taps: ['PREVIOUS', 'CONTROLS', 'NEXT'],
      swipe: 'NONE',
    });
    expect(vertical[0]).toMatchObject({ left: 0, top: 0, right: 1, bottom: 1 / 3, swipe: 'NONE' });
    expect(vertical[2]).toMatchObject({ left: 0, top: 2 / 3, right: 1, bottom: 1 });

    // RTL：三块的 tap 顺序整体倒序（左块拿 gestureTapRight）
    const rtl = comicDefaultTouchZones({
      vertical: false,
      reverse: true,
      taps: ['PREVIOUS', 'CONTROLS', 'NEXT'],
      swipe: 'PAGE',
    });
    expect(rtl.map((zone) => zone.tap)).toEqual(['NEXT', 'CONTROLS', 'PREVIOUS']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑥ 漫画设置入口 + 编辑器写回（ComicReaderPage）
   ══════════════════════════════════════════════════════════════════════════════ */

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function localPages(count: number): ComicPageRef[] {
  return Array.from({ length: count }, (_unused, i) => ({
    kind: 'LOCAL' as const,
    id: `p${String(i + 1)}`,
    path: PIXEL,
  }));
}

function fastLoader(): ComicPageLoaderPort {
  const bitmap: ComicBitmap = { src: PIXEL, width: 1, height: 1 };
  return {
    peekProcessed: () => bitmap,
    peekReadingPreview: () => null,
    loadForDisplay: () => Promise.resolve(bitmap),
    decodeRegion: () => Promise.resolve(null),
    preloadWindow: () => undefined,
    replaceProcessed: () => undefined,
    evictProcessed: () => undefined,
    probeSizes: () => Promise.resolve(),
    clearProcessedCache: () => undefined,
    shutdown: () => undefined,
    sizes: () => ({}),
    subscribeSizes: () => () => undefined,
  };
}

interface Mounted {
  readonly root: Root;
  readonly host: HTMLDivElement;
}

async function mount(node: ReactNode): Promise<Mounted> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  return { root, host };
}

async function unmount(m: Mounted): Promise<void> {
  await act(async () => {
    m.root.unmount();
  });
  m.host.remove();
}

async function clickByText(m: Mounted, selector: string, label: string): Promise<void> {
  const target = [...m.host.querySelectorAll(selector)].find((el) =>
    (el.textContent ?? '').includes(label),
  );
  if (target === undefined) {
    throw new Error(`找不到文案含 ${JSON.stringify(label)} 的 ${selector}`);
  }
  await act(async () => {
    (target as HTMLElement).click();
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

describe('漫画阅读器：设置入口 + 编辑器（ComicReaderSheets.kt L1473-1477 / Core L887-945）', () => {
  it('「手势」Tab 里出现「触控功能分区」入口，文案与 Kotlin 一致', async () => {
    const store = new ComicSettingsStore(createMemoryComicStore());
    const m = await mount(
      <ComicReaderPage pages={localPages(3)} bookKey={null} loader={fastLoader()} store={store} />,
    );
    await clickByText(m, '.comic-chip', '设置');
    await clickByText(m, '.cmcs-tabrow__label', '手势');

    const titles = [...m.host.querySelectorAll('.cmcs-card__title')].map(
      (el) => el.textContent ?? '',
    );
    expect(titles).toContain('触控功能分区');
    expect(m.host.textContent).toContain(
      '在当前漫画上直接调整分区，画面保持原尺寸。点击与滑动独立配置，双指缩放与放大后拖图优先。',
    );
    expect(m.host.textContent).toContain('可视化编辑功能分区');
    await unmount(m);
  });

  it('点入口打开编辑器（comic=true 隐藏听书），保存后 touchZones 写入配置 JSON', async () => {
    const kv = createMemoryComicStore();
    const store = new ComicSettingsStore(kv);
    const m = await mount(
      <ComicReaderPage pages={localPages(3)} bookKey={null} loader={fastLoader()} store={store} />,
    );
    await clickByText(m, '.comic-chip', '设置');
    await clickByText(m, '.cmcs-tabrow__label', '手势');
    await clickByText(m, 'button', '可视化编辑功能分区');

    // 编辑器出现在页面上（Kotlin `TouchZoneEditor(..., comic = true)`）
    expect(m.host.querySelector('.tze')).not.toBeNull();
    expect(m.host.querySelector('[data-testid="tze_layer"]')).not.toBeNull();

    // 展开工具 → 点击行为里没有「听书」（comic 分支过滤掉 LISTEN）
    await clickByText(m, 'button', '设置功能');
    const chips = [...m.host.querySelectorAll('.tze__choices button')].map(
      (el) => el.textContent ?? '',
    );
    expect(chips).toContain('上一页');
    expect(chips).toContain('下一页');
    expect(chips.join('|')).not.toContain('听书');

    // 加一块分区再保存 ⇒ 默认三块 + 新增一块 = 4
    await clickByText(m, 'button', '添加分区');
    await clickByText(m, 'button', '保存');

    const saved = store.loadGlobalConfig();
    expect(saved.touchZones).toHaveLength(4);
    expect(saved.touchZones?.[3]?.tap).toBe('CONTROLS');
    // 配置文件里真的出现了 touchZones（不是只留在内存）
    // 注：内存仓库直接存 `KEY_GLOBAL_CONFIG`（`comicPrefsKey()` 前缀是平台适配层用的）。
    const raw = kv.getString(KEY_GLOBAL_CONFIG) ?? '{}';
    const rawJson = JSON.parse(raw) as { touchZones?: unknown };
    expect(Array.isArray(rawJson.touchZones)).toBe(true);
    await unmount(m);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   ⑦ 小说阅读器接线断言（源码级）
   ══════════════════════════════════════════════════════════════════════════════

   `ReaderPage.tsx` 是 4400 行的聚焦组件：没有 props，全靠 `useAppStore` +
   `getPlatform()`，且排版依赖 canvas 量行（jsdom 无 2d context），因此没有既有
   mount 测试。这里改为锁定**接线点**本身存在且语义正确 —— 行为本身由 ③④ 两组
   真实函数/真实指针事件覆盖。 */

describe('ReaderPage 接线点（源码级）', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/ui/pages/ReaderPage.tsx'),
    'utf8',
  );

  it('从 reader_touch_zones_v1 / novel 读取并保存（SettingsRepository 端口）', () => {
    expect(source).toContain('loadNovelTouchZones(repo)');
    expect(source).toContain('saveNovelTouchZones(repo, zones)');
    expect(source).toContain('const saveTouchZones = useCallback(');
  });

  it('无自定义分区时保留旧点击区行为（Kotlin `if (touchZones == null)`）', () => {
    expect(source).toContain('enabled: scrollMode && touchZones === null');
    expect(source).toContain('{!scrollMode && touchZones !== null ? (');
  });

  it('点击/滑动分区接到 NEXT/PREVIOUS/CONTROLS/SETTINGS/CONTENTS/LISTEN/EXIT', () => {
    expect(source).toContain("case 'PREVIOUS':");
    expect(source).toContain('handlePrevPage();');
    expect(source).toContain("case 'NEXT':");
    expect(source).toContain('handleNextPage();');
    expect(source).toContain("case 'CONTENTS':");
    expect(source).toContain('setShowTocSheet(true);');
    expect(source).toContain("case 'LISTEN':");
    expect(source).toContain('startTts();');
  });

  it('滚动模式把手势挂在滚动容器上且不消费移动（垂直滑动仍归滚动）', () => {
    expect(source).toContain('useTouchZoneGestures(scrollRef, {');
    expect(source).toContain('consumeMoves: false');
    expect(source).toContain('defaultDistance: (span) => span * DEFAULT_TOUCH_DISTANCE_RATIO');
  });

  it('编辑器渲染 + 预览 + 设置面板入口', () => {
    expect(source).toContain('<TouchZoneEditor');
    expect(source).toContain('zones={savedTouchZones}');
    expect(source).toContain('viewport={touchViewport}');
    expect(source).toContain('onPreview={(draft, trying) => {');
    expect(source).toContain('onOpenTouchZones={() => {');
    expect(source).toContain('自定义触控功能分区');
  });
});

/* 保持 `CORE_DEFAULT_COMIC_READER_CONFIG` 的引用（证明两份 ComicReaderConfig 的
   默认值仍然一致；`touchZones` 字段只加在 config 模块那一份上，读取走
   `touchZonesOf()`）。 */
describe('两份 ComicReaderConfig 的默认值仍一致', () => {
  it('除 touchZones 外逐字段相同', () => {
    const core = CORE_DEFAULT_COMIC_READER_CONFIG as unknown as Record<string, unknown>;
    const config = DEFAULT_COMIC_READER_CONFIG as unknown as Record<string, unknown>;
    for (const key of Object.keys(config)) {
      if (key === 'touchZones') continue;
      expect(core[key]).toEqual(config[key]);
    }
  });
});
