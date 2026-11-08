/**
 * 书架多选状态机单测 — 对照 Android `ui/shelf/ShelfMultiSelect.kt`（604 行 / 353 code）
 * 与 `ui/shelf/ShelfSelectionHost.kt`（1400 行 / 1150 code）。
 *
 * 被测对象 `src/ui/components/shelf/ShelfSelectionState.ts` 就是 Kotlin 侧自己标注
 * 「纯状态、无 Android 依赖，可单测」的那一部分；手势/动画都留在
 * `ShelfSelectionHost.tsx` 里，因此这里不需要 jsdom 与 DOM。
 *
 * 覆盖：
 *   - key / drop-target 命名（L99–118）
 *   - Rect / Offset 纯函数（L134–156）
 *   - 阶段机 BROWSE → SELECTING → DRAGGING（enterSelection / select / unselect /
 *     toggle / slideAcross / selectAll / exitSelection / beginDrag / moveDrag /
 *     endDrag / cancelDrag）
 *   - 两个板块完全独立（ShelfSelectionScope + accepts）
 *   - 锚点保护（slideAcross 不得取消锚点）
 *   - 几何登记 / 裁剪 / 命中测试（hitTestItem 当场过滤 aliveKeys）
 *   - 落点命中必须完整可见 + 迟滞（HYSTERESIS）+ 边缘自动滚动（EDGE_BAND_DP）
 *   - 归位飞行交班（beginReturnFlight / endReturnFlight）
 *   - subscribe / 通知
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_SELECT_GUARD_MS,
  DROP_PREFIX_FAV_CATEGORY,
  DROP_TARGET_FAVORITE,
  DROP_TARGET_NEW,
  EDGE_BAND_DP,
  HYSTERESIS,
  LONG_PRESS_MS,
  PICK_UP_MS,
  SHELF_KEY_FAV_PREFIX,
  ShelfPhase,
  ShelfSelectionScope,
  ShelfSelectionState,
  createShelfSelectionState,
  dropTargetOfCategory,
  dropTargetOfFavoriteCategory,
  favShelfKey,
  isFavShelfKey,
  offset,
  rectCenter,
  rectContains,
  rectSize,
  rectsEqual,
  translateRect,
  type ShelfRect,
} from '@ui/components/shelf/ShelfSelectionState';

/* ─────────────────────────── helpers ─────────────────────────── */

function rect(left: number, top: number, right: number, bottom: number): ShelfRect {
  return { left, top, right, bottom };
}

const A = 'book-1';
const B = 'book-2';
const C = 'book-3';
const F1 = favShelfKey('fav-1');

function threeBooks(s: ShelfSelectionState): void {
  s.registerItem(A, rect(0, 100, 100, 260));
  s.registerItem(B, rect(110, 100, 210, 260));
  s.registerItem(C, rect(220, 100, 320, 260));
}

/* ─────────────────────── 命名与纯函数 ─────────────────────── */

describe('key 与落点命名 — ShelfMultiSelect.kt L99–118', () => {
  it('收藏板 key 前缀', () => {
    expect(SHELF_KEY_FAV_PREFIX).toBe('fav::');
    expect(favShelfKey('x')).toBe('fav::x');
    expect(isFavShelfKey('fav::x')).toBe(true);
    expect(isFavShelfKey('book-1')).toBe(false);
  });

  it('落点 id 常量与构造器', () => {
    expect(DROP_TARGET_FAVORITE).toBe('drop::favorite');
    expect(DROP_TARGET_NEW).toBe('drop::new');
    expect(dropTargetOfCategory('默认')).toBe('drop::cat::默认');
    expect(dropTargetOfFavoriteCategory('热血')).toBe(`${DROP_PREFIX_FAV_CATEGORY}热血`);
    expect(dropTargetOfFavoriteCategory('热血').startsWith(DROP_PREFIX_FAV_CATEGORY)).toBe(true);
  });

  it('书架分类落点与收藏分类落点前缀不同（不会互相误命中）', () => {
    expect(dropTargetOfCategory('热血').startsWith(DROP_PREFIX_FAV_CATEGORY)).toBe(false);
  });
});

describe('Offset / Rect 纯函数 — ShelfSelectionHost.kt L239–243', () => {
  it('offset', () => {
    expect(offset(3, 4)).toEqual({ x: 3, y: 4 });
  });

  it('rectContains：边界算命中（Compose Rect.contains 同语义）', () => {
    const r = rect(0, 0, 10, 10);
    expect(rectContains(r, offset(5, 5))).toBe(true);
    expect(rectContains(r, offset(0, 0))).toBe(true);
    expect(rectContains(r, offset(10, 10))).toBe(true);
    expect(rectContains(r, offset(-1, 5))).toBe(false);
    expect(rectContains(r, offset(5, 11))).toBe(false);
  });

  it('rectCenter / rectSize / translateRect / rectsEqual', () => {
    expect(rectCenter(rect(0, 0, 10, 20))).toEqual({ x: 5, y: 10 });
    expect(rectSize(rect(0, 0, 10, 20))).toEqual({ width: 10, height: 20 });
    expect(translateRect(rect(0, 0, 10, 20), 5, -5)).toEqual(rect(5, -5, 15, 15));
    expect(rectsEqual(rect(0, 0, 1, 1), rect(0, 0, 1, 1))).toBe(true);
    expect(rectsEqual(rect(0, 0, 1, 1), rect(0, 0, 1, 2))).toBe(false);
  });

  it('时长常量与 Kotlin 一致', () => {
    expect(LONG_PRESS_MS).toBe(350);
    expect(PICK_UP_MS).toBe(250);
    expect(AUTO_SELECT_GUARD_MS).toBe(500);
    expect(HYSTERESIS).toBe(12);
    expect(EDGE_BAND_DP).toBe(96);
  });
});

/* ─────────────────────── 阶段机 ─────────────────────── */

describe('BROWSE → SELECTING', () => {
  it('enterSelection：定板块、选中锚点、记下连选起点、清掉按压态', () => {
    const s = createShelfSelectionState();
    expect(s.phase).toBe(ShelfPhase.BROWSE);
    s.setPressed(B);
    s.enterSelection(A);
    expect(s.phase).toBe(ShelfPhase.SELECTING);
    expect(s.scope).toBe(ShelfSelectionScope.BOOK);
    expect([...s.selected]).toEqual([A]);
    expect(s.lastSlideKey).toBe(A);
    expect(s.pressedKey).toBeNull();
  });

  it('select / unselect / toggle', () => {
    const s = createShelfSelectionState();
    s.select(A);
    s.select(B);
    expect([...s.selected].sort()).toEqual([A, B]);
    s.unselect(A);
    expect([...s.selected]).toEqual([B]);
    s.toggle(A);
    expect([...s.selected].sort()).toEqual([A, B]);
    s.toggle(A);
    expect([...s.selected]).toEqual([B]);
  });

  it('selected 每次都是新 Set（不会就地改，React 才认得变更）', () => {
    const s = createShelfSelectionState();
    s.select(A);
    const first = s.selected;
    s.select(B);
    expect(s.selected).not.toBe(first);
  });

  it('selectAll：定板块后只收本板块的 key', () => {
    const s = createShelfSelectionState();
    s.selectAll([A, B, F1]);
    expect(s.phase).toBe(ShelfPhase.SELECTING);
    expect(s.scope).toBe(ShelfSelectionScope.BOOK);
    expect([...s.selected].sort()).toEqual([A, B]);
  });

  it('selectAll 在已定板块后补进来的另一板块 key 被挡掉', () => {
    const s = createShelfSelectionState();
    s.enterSelection(F1);
    s.selectAll([A, F1, favShelfKey('fav-2')]);
    expect([...s.selected].sort()).toEqual([F1, 'fav::fav-2'].sort());
  });

  it('exitSelection：阶段回 BROWSE，板块、名单、飞行集合全清', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    s.select(B);
    s.beginDrag(A, offset(50, 180));
    s.beginReturnFlight([A, B]);
    s.exitSelection();
    expect(s.phase).toBe(ShelfPhase.BROWSE);
    expect(s.scope).toBeNull();
    expect(s.selected.size).toBe(0);
    expect(s.dragging).toEqual([]);
    expect(s.flyingHome.size).toBe(0);
    expect(s.pointer).toBeNull();
    expect(s.pressedKey).toBeNull();
    expect(s.hoverTarget).toBeNull();
    expect(s.edgeScroll).toBe(0);
    expect(s.lastSlideKey).toBeNull();
  });

  it('退出后再次长按：板块按新锚点重定', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    s.exitSelection();
    s.enterSelection(F1);
    expect(s.scope).toBe(ShelfSelectionScope.FAV);
  });
});

describe('两个板块完全独立 — ShelfMultiSelect.kt 「我的书架」/「我喜欢的」', () => {
  it('浏览态（scope == null）一律放行', () => {
    const s = createShelfSelectionState();
    expect(s.accepts(A)).toBe(true);
    expect(s.accepts(F1)).toBe(true);
  });

  it('在书架进入多选 → 收藏 key 一律不受理', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    expect(s.accepts(B)).toBe(true);
    expect(s.accepts(F1)).toBe(false);
    s.select(F1);
    expect(s.selected.has(F1)).toBe(false);
  });

  it('在收藏板进入多选 → 书架 key 一律不受理', () => {
    const s = createShelfSelectionState();
    s.enterSelection(F1);
    expect(s.accepts(A)).toBe(false);
    expect(s.accepts(favShelfKey('fav-9'))).toBe(true);
  });

  it('取消选中不加闸门（另一板块也能被摘掉）', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    s.select(B);
    s.unselect(A);
    expect([...s.selected]).toEqual([B]);
    // 兜底闸门只拦"进名单"，摘名单一律放行 —— 即使 scope 已定为 BOOK
    s.enterSelection(A);
    s.select(favShelfKey('fav-x'));
    s.select(B);
    s.unselect(favShelfKey('fav-x'));
    expect([...s.selected].sort()).toEqual([A, B].sort());
  });
});

describe('滑动连选与锚点保护 — ShelfMultiSelect.kt', () => {
  it('划过即选中，滑回来即取消', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    s.slideAcross(B);
    expect(s.selected.has(B)).toBe(true);
    s.slideAcross(B);
    expect(s.selected.has(B)).toBe(false);
  });

  it('锚点不允许被滑回取消（否则长按选中的书下一瞬就没了）', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    s.slideAcross(A);
    expect(s.selected.has(A)).toBe(true);
  });

  it('setLastSlideKey：外部（宿主事件回调）写入连选起点', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    s.setLastSlideKey(C);
    expect(s.lastSlideKey).toBe(C);
    s.setLastSlideKey(null);
    expect(s.lastSlideKey).toBeNull();
  });
});

describe('SELECTING → DRAGGING', () => {
  it('beginDrag：被长按的那本置顶，其余选中的跟上', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    s.select(B);
    s.beginDrag(B, offset(160, 180));
    expect(s.phase).toBe(ShelfPhase.DRAGGING);
    expect(s.dragging).toEqual([B, A]);
    expect(s.pointer).toEqual({ x: 160, y: 180 });
  });

  it('endDrag：交出（落点, 条目）并回到多选态，保留选中', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    s.select(B);
    s.beginDrag(A, offset(50, 180));
    const [target, items] = s.endDrag();
    expect(target).toBeNull();
    expect(items.sort()).toEqual([A, B]);
    expect(s.phase).toBe(ShelfPhase.SELECTING);
    expect(s.dragging).toEqual([]);
    expect(s.pointer).toBeNull();
    expect(s.ghostTilt).toBe(0);
    expect(s.edgeScroll).toBe(0);
    expect([...s.selected].sort()).toEqual([A, B]);
  });

  it('cancelDrag：同样回到多选态但交不出条目', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    s.beginDrag(A, offset(50, 180));
    s.cancelDrag();
    expect(s.phase).toBe(ShelfPhase.SELECTING);
    expect(s.dragging).toEqual([]);
  });

  it('setGhostTiltAnimated：把动画倾角写回状态机（松手后起飞不"啪"地摆正）', () => {
    const s = createShelfSelectionState();
    s.beginDrag(A, offset(50, 180));
    s.setGhostTiltAnimated(-7.5);
    expect(s.ghostTilt).toBe(-7.5);
  });
});

/* ─────────────────────── 几何与命中 ─────────────────────── */

describe('几何登记与裁剪', () => {
  it('registerItem / itemRect；registerCover / coverRect；coverRect 缺登记时退回整卡', () => {
    const s = createShelfSelectionState();
    s.registerItem(A, rect(0, 100, 100, 260));
    expect(s.itemRect(A)).toEqual(rect(0, 100, 100, 260));
    expect(s.coverRect(A)).toEqual(rect(0, 100, 100, 260));
    s.registerCover(A, rect(10, 110, 90, 230));
    expect(s.coverRect(A)).toEqual(rect(10, 110, 90, 230));
    expect(s.itemRect(A)).toEqual(rect(0, 100, 100, 260));
  });

  it('register*(null) 是空操作（ref 卸载时不能把几何抹掉）', () => {
    const s = createShelfSelectionState();
    s.registerItem(A, rect(0, 0, 10, 10));
    s.registerItem(A, null);
    expect(s.itemRect(A)).toEqual(rect(0, 0, 10, 10));
  });

  it('未登记的 key 返回 null', () => {
    const s = createShelfSelectionState();
    expect(s.itemRect('nope')).toBeNull();
    expect(s.coverRect('nope')).toBeNull();
    expect(s.targetRect('nope')).toBeNull();
  });

  it('pruneGeometry：不在 alive 集合里的几何被清掉（幽灵热区）', () => {
    const s = createShelfSelectionState();
    threeBooks(s);
    s.registerCover(A, rect(10, 110, 90, 230));
    s.registerDropTarget(dropTargetOfCategory('默认'), rect(0, 0, 80, 40));
    s.pruneGeometry(new Set([A, B]), new Set<string>());
    expect(s.itemRect(C)).toBeNull();
    expect(s.coverRect(A)).not.toBeNull();
    expect(s.targetRect(dropTargetOfCategory('默认'))).toBeNull();
  });
});

describe('hitTestItem — ShelfSelectionHost.kt L280–289', () => {
  it('命中矩形内的条目', () => {
    const s = createShelfSelectionState();
    threeBooks(s);
    expect(s.hitTestItem(offset(50, 180), new Set(), null)).toBe(A);
    expect(s.hitTestItem(offset(160, 180), new Set(), null)).toBe(B);
  });

  it('空白处 → null', () => {
    const s = createShelfSelectionState();
    threeBooks(s);
    expect(s.hitTestItem(offset(500, 500), new Set(), null)).toBeNull();
  });

  it('aliveKeys 为空 → 不拦截（退回旧行为，不把整页手势打死）', () => {
    const s = createShelfSelectionState();
    threeBooks(s);
    expect(s.hitTestItem(offset(50, 180), new Set(), null)).toBe(A);
  });

  it('aliveKeys 当场过滤已消失的条目（"点下去命中旧 key"的那一帧窗口被消掉）', () => {
    const s = createShelfSelectionState();
    threeBooks(s);
    expect(s.hitTestItem(offset(50, 180), new Set([B, C]), null)).toBeNull();
  });

  it('缓存没命中 → 问列表（fallbackHit）', () => {
    const s = createShelfSelectionState();
    threeBooks(s);
    const fallback = (p: { x: number; y: number }): string | null => (p.x > 300 ? C : null);
    expect(s.hitTestItem(offset(320, 180), new Set(), fallback)).toBe(C);
  });

  it('fallbackHit 返回的 key 也要过 aliveKeys 过滤', () => {
    const s = createShelfSelectionState();
    threeBooks(s);
    const fallback = (): string | null => C;
    expect(s.hitTestItem(offset(320, 180), new Set([A]), fallback)).toBeNull();
  });

  it('没有 fallbackHit 时空白处就是 null', () => {
    const s = createShelfSelectionState();
    threeBooks(s);
    expect(s.hitTestItem(offset(900, 900), new Set(), null)).toBeNull();
  });
});

describe('落点命中与自动滚动 — moveDrag', () => {
  const HOST_TOP = 0;
  const HOST_BOTTOM = 800;

  function withChip(): ShelfSelectionState {
    const s = createShelfSelectionState();
    threeBooks(s);
    s.registerDropTarget(dropTargetOfCategory('默认'), rect(0, 700, 80, 740));
    return s;
  }

  it('手指在胶囊内 → hoverTarget 命中', () => {
    const s = withChip();
    s.enterSelection(A);
    s.beginDrag(A, offset(40, 720));
    s.moveDrag(offset(40, 720), HOST_TOP, HOST_BOTTOM);
    expect(s.hoverTarget).toBe(dropTargetOfCategory('默认'));
  });

  it('胶囊只露出一半（滚出宿主）→ 不命中（用户："手指不是刚好在分类之上也触发了"）', () => {
    const s = createShelfSelectionState();
    threeBooks(s);
    // 上沿在宿主顶之上 = 滚出可视区
    s.registerDropTarget(dropTargetOfCategory('半露'), rect(0, -20, 80, 20));
    s.enterSelection(A);
    s.beginDrag(A, offset(40, 0));
    s.moveDrag(offset(40, 0), HOST_TOP, HOST_BOTTOM);
    expect(s.hoverTarget).toBeNull();
  });

  it('迟滞：离开矩形不足 HYSTERESIS 时仍保持高亮（手指停在缝隙不闪）', () => {
    const s = withChip();
    s.enterSelection(A);
    s.beginDrag(A, offset(40, 720));
    s.moveDrag(offset(40, 720), HOST_TOP, HOST_BOTTOM);
    expect(s.hoverTarget).toBe(dropTargetOfCategory('默认'));
    // 横向移出 80 但只移了 10px（< HYSTERESIS 12）
    s.moveDrag(offset(90, 720), HOST_TOP, HOST_BOTTOM);
    expect(s.hoverTarget).toBe(dropTargetOfCategory('默认'));
  });

  it('移出超过 HYSTERESIS 才让位', () => {
    const s = withChip();
    s.enterSelection(A);
    s.beginDrag(A, offset(40, 720));
    s.moveDrag(offset(40, 720), HOST_TOP, HOST_BOTTOM);
    s.moveDrag(offset(200, 720), HOST_TOP, HOST_BOTTOM);
    expect(s.hoverTarget).toBeNull();
  });

  it('边缘自动滚动：靠近上下边缘带时给出 px/帧 速度', () => {
    const s = withChip();
    s.enterSelection(A);
    s.beginDrag(A, offset(50, 400));
    s.moveDrag(offset(50, 400), HOST_TOP, HOST_BOTTOM);
    expect(s.edgeScroll).toBe(0);
    s.moveDrag(offset(50, HOST_TOP + 10), HOST_TOP, HOST_BOTTOM);
    expect(s.edgeScroll).toBeLessThan(0);
    s.moveDrag(offset(50, HOST_BOTTOM - 10), HOST_TOP, HOST_BOTTOM);
    expect(s.edgeScroll).toBeGreaterThan(0);
    expect(EDGE_BAND_DP).toBe(96);
  });

  it('宿主偏移：所有判定统一到 root 坐标（整体偏一个位移量就是 bug）', () => {
    const s = createShelfSelectionState();
    threeBooks(s);
    // 胶囊用 positionInRoot 登记 → 在 root 坐标里
    s.registerDropTarget(dropTargetOfCategory('默认'), rect(0, 1080, 80, 1120));
    s.enterSelection(A);
    // 手指在宿主局部 (40, 900)，宿主在 root 上偏移了 +200 → root 点应是 (40, 1100)
    s.beginDrag(A, offset(40, 900));
    s.moveDrag(offset(40, 900), 200, 1200, offset(0, 200));
    expect(s.hoverTarget).toBe(dropTargetOfCategory('默认'));
    // 不加偏移就命不中（这正是 Kotlin L627–630 注释里说的偏一整个位移量的 bug）
    s.moveDrag(offset(40, 900), 200, 1200, offset(0, 0));
    expect(s.hoverTarget).toBeNull();
  });

  it('跟手倾角夹在 ±14 度内', () => {
    const s = withChip();
    s.beginDrag(A, offset(50, 400));
    for (let i = 0; i < 40; i += 1) {
      s.moveDrag(offset(50 + i * 40, 400), HOST_TOP, HOST_BOTTOM);
    }
    expect(s.ghostTilt).toBeLessThanOrEqual(14);
    expect(s.ghostTilt).toBeGreaterThanOrEqual(-14);
  });

  it('endDrag 交出命中的落点', () => {
    const s = withChip();
    s.enterSelection(A);
    s.beginDrag(A, offset(40, 720));
    s.moveDrag(offset(40, 720), HOST_TOP, HOST_BOTTOM);
    const [target, items] = s.endDrag();
    expect(target).toBe(dropTargetOfCategory('默认'));
    expect(items).toEqual([A]);
  });
});

describe('归位飞行交班', () => {
  it('beginReturnFlight → endReturnFlight：真实卡片只在幽灵卡落位后才显示', () => {
    const s = createShelfSelectionState();
    s.enterSelection(A);
    s.select(B);
    s.beginDrag(A, offset(50, 180));
    s.endDrag();
    s.beginReturnFlight([A, B]);
    expect(s.flyingHome.has(A)).toBe(true);
    expect(s.flyingHome.has(B)).toBe(true);
    s.endReturnFlight();
    expect(s.flyingHome.size).toBe(0);
  });

  it('beginReturnFlight 整体替换集合（不会与上一批叠加）', () => {
    const s = createShelfSelectionState();
    s.beginReturnFlight([A]);
    s.beginReturnFlight([B]);
    expect([...s.flyingHome]).toEqual([B]);
  });
});

describe('subscribe / 通知', () => {
  it('状态变更都会通知订阅者', () => {
    const s = createShelfSelectionState();
    const listener = vi.fn();
    const unsubscribe = s.subscribe(listener);
    s.select(A);
    s.unselect(A);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    unsubscribe();
    const after = listener.mock.calls.length;
    s.select(B);
    expect(listener.mock.calls.length).toBe(after);
  });

  it('setLastSlideKey 是纯写入（不触发通知，与 Kotlin 的 internal setter 一致）', () => {
    const s = createShelfSelectionState();
    const listener = vi.fn();
    s.subscribe(listener);
    const before = listener.mock.calls.length;
    s.setLastSlideKey(C);
    expect(listener.mock.calls.length).toBe(before);
  });
});

describe('markAutoSelect / isRecentAutoSelect', () => {
  it('刚标记过 → true；未标记时 lastAutoSelectAt = 0 → false', () => {
    const s = createShelfSelectionState();
    expect(s.isRecentAutoSelect()).toBe(false);
    s.markAutoSelect();
    expect(s.isRecentAutoSelect()).toBe(true);
  });
});

describe('new ShelfSelectionState() 与工厂等价', () => {
  it('createShelfSelectionState 就是 new ShelfSelectionState()', () => {
    const a = new ShelfSelectionState();
    const b = createShelfSelectionState();
    expect(a.phase).toBe(b.phase);
    expect(a.scope).toBe(b.scope);
    expect(a.selected.size).toBe(0);
  });
});