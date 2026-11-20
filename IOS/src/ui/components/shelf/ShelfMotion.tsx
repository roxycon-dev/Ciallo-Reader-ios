/**
 * `ShelfMotionState` / `rememberShelfMotionState` / `keepShelfViewportForSort` /
 * `shelfCapture` / `ShelfShatterOverlay` —— `ui/shelf/ShelfMotion.kt` L31-167 的 Web 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L32-85  `@Stable class ShelfMotionState(snapshot)`：
 *             `captures` / `bursts` / `hidden` / `lastCaptureFailure` / `hideBooks` / `hideFavorites`
 *             `remove(keys, scope, reduceMotion, onRemove)`：
 *               · `keys.distinct().filterNot { hidden.containsKey(it) }`
 *               · 先占位 `hidden[it] = false`（真卡片仍可见）
 *               · `!reduceMotion` 时最多 8 张做快照 → `ShelfBurst`
 *               · `finally { fresh.forEach { hidden[it] = true }; onRemove() }`（取消也要执行确认动作）
 *               · 无快照时 `delay(120)` 去重
 *               · 每片 `animateTo(1f, tween(660, LinearEasing))`，结束移除
 *               · 末了 `bursts.removeAll(created); fresh.forEach { hidden.remove(it) }`
 *   L119-120 `rememberShelfMotionState()` → `rememberShelfMotionState()`
 *   L122-125 `keepShelfViewportForSort(state)` → 同名函数
 *   L127-142 `Modifier.shelfCapture(state, key)` → `shelfCapture(state, key)` 返回 `{ref, style}`
 *   L144-167 `ShelfShatterOverlay(state, modifier)` → `<ShelfShatterOverlay state=…/>`
 *
 * 平台差异（已登记 E122）
 * ─────────────────────
 *  * `GraphicsLayer.toImageBitmap()` → 用卡片内 `<img>` 的 `src` 作贴图；没有图片时退到
 *    计算样式的纯色底。**不静默丢效果**：两种情况都真的画出 48 片三角。
 *  * `rememberGraphicsLayer` 的离屏层 → 不需要；Web 直接在 canvas 上按路径裁剪贴图，
 *    避免 `docs/HANDOFF_PROMPT.md` §4 里「长驻合成层把 renderer 拖崩」的老坑。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import {
  SHELF_BURST_DEBOUNCE_MS,
  SHELF_BURST_MAX_CAPTURES,
  SHELF_BURST_MS,
  shelfShardFade,
  shelfShardOffset,
  shelfShardProgress,
  shelfShardScale,
  shelfShardTravel,
  type ShelfShard,
} from '@core/wenku/shelfMotion';
import { shelfShards } from '@core/wenku/shelfMotion';

/** `isFavShelfKey`（`ui/shelf/ShelfSelectionHost.kt`）：收藏键带 `::` 分隔。 */
export function isFavShelfKey(key: string): boolean {
  return key.includes('::');
}

export interface ShelfCapture {
  readonly key: string;
  element: HTMLElement | null;
  origin: { x: number; y: number };
}

export interface ShelfBurst {
  readonly key: string;
  readonly imageUrl: string | null;
  readonly tint: string;
  readonly width: number;
  readonly height: number;
  readonly origin: { x: number; y: number };
  readonly shards: readonly ShelfShard[];
  progress: number;
}

type Listener = () => void;

/** L32-85 `ShelfMotionState`。 */
export class ShelfMotionState {
  readonly captures = new Map<string, ShelfCapture>();
  bursts: ShelfBurst[] = [];
  readonly hidden = new Map<string, boolean>();
  lastCaptureFailure: unknown = null;
  hideBooks = false;
  hideFavorites = false;
  private readonly listeners = new Set<Listener>();
  private version = 0;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  private capture(key: string): ShelfBurst | null {
    const capture = this.captures.get(key);
    const element = capture?.element ?? null;
    if (capture === undefined || element === null) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const image = element.querySelector('img');
    const imageUrl = image instanceof HTMLImageElement && image.currentSrc !== '' ? image.currentSrc : null;
    const tint = getComputedStyle(element).backgroundColor;
    return {
      key,
      imageUrl,
      tint,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      origin: { x: rect.left, y: rect.top },
      shards: shelfShards(Math.round(rect.width), Math.round(rect.height), hashString(key)),
      progress: 0,
    };
  }

  /** L44-84 `remove(keys, scope, reduceMotion, onRemove)`。 */
  async remove(
    keys: readonly string[],
    reduceMotion: boolean,
    onRemove: () => void,
    waitMs: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  ): Promise<void> {
    const fresh = [...new Set(keys)].filter((k) => !this.hidden.has(k));
    if (fresh.length === 0) return;
    for (const key of fresh) this.hidden.set(key, false);
    this.emit();
    const created: ShelfBurst[] = [];
    try {
      try {
        if (!reduceMotion) {
          for (const key of fresh.slice(0, SHELF_BURST_MAX_CAPTURES)) {
            const private_ = isFavShelfKey(key) ? this.hideFavorites : this.hideBooks;
            if (private_) continue;
            const burst = this.capture(key);
            if (burst === null) continue;
            created.push(burst);
          }
        }
      } finally {
        // L68-71：先占位再执行确认动作 —— 屏幕正在离场/被取消也必须真的删。
        for (const key of fresh) this.hidden.set(key, true);
        this.emit();
        onRemove();
      }
      this.bursts = [...this.bursts, ...created];
      this.emit();
      if (created.length === 0) await waitMs(SHELF_BURST_DEBOUNCE_MS);
      await Promise.all(
        created.map(
          (burst) =>
            new Promise<void>((resolve) => {
              const startedAt = performance.now();
              const tick = (): void => {
                const p = Math.min((performance.now() - startedAt) / SHELF_BURST_MS, 1);
                burst.progress = p;
                this.emit();
                if (p >= 1) {
                  resolve();
                  return;
                }
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }),
        ),
      );
    } finally {
      this.bursts = this.bursts.filter((b) => !created.includes(b));
      for (const key of fresh) this.hidden.delete(key);
      this.emit();
    }
  }
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * L119-120 `rememberShelfMotionState()`。
 * ESLint 只认 `use*` 前缀，实现名 `useShelfMotionState`，对外仍用 Kotlin 原名导出（见文件末）。
 */
export function useShelfMotionState(): ShelfMotionState {
  const [state] = useState(() => new ShelfMotionState());
  return state;
}

/** Kotlin 原名出口。 */
export const rememberShelfMotionState = useShelfMotionState;

/** 订阅状态版本，供覆盖层与卡片重渲染。 */
export function useShelfMotionVersion(state: ShelfMotionState): number {
  return useSyncExternalStore(state.subscribe, state.getVersion, () => 0);
}

export interface ShelfGridScrollState {
  readonly firstVisibleItemIndex: number;
  readonly firstVisibleItemScrollOffset: number;
  readonly requestScrollToItem: (index: number, offset: number) => void;
}

/** L122-125 `keepShelfViewportForSort(state)`。 */
export function keepShelfViewportForSort(state: ShelfGridScrollState): void {
  state.requestScrollToItem(state.firstVisibleItemIndex, state.firstVisibleItemScrollOffset);
}

export interface ShelfCaptureBinding {
  readonly ref: (element: HTMLElement | null) => void;
  readonly style: CSSProperties;
  readonly 'data-shelf-captured': 'true' | 'hidden' | 'false';
}

/** L127-142 `Modifier.shelfCapture(state, key)`。 */
export function shelfCapture(state: ShelfMotionState, key: string): ShelfCaptureBinding {
  const hidden = state.hidden.get(key) === true;
  const privateHidden = isFavShelfKey(key) ? state.hideFavorites : state.hideBooks;
  return {
    ref: (element) => {
      if (element === null) {
        state.captures.delete(key);
        return;
      }
      const existing = state.captures.get(key);
      const rect = element.getBoundingClientRect();
      if (existing === undefined) {
        state.captures.set(key, { key, element, origin: { x: rect.left, y: rect.top } });
      } else {
        existing.element = element;
        existing.origin = { x: rect.left, y: rect.top };
      }
    },
    style: hidden || privateHidden ? { visibility: 'hidden' } : {},
    'data-shelf-captured': hidden ? 'hidden' : privateHidden ? 'hidden' : 'false',
  };
}

export interface ShelfShatterOverlayProps {
  readonly state: ShelfMotionState;
  readonly className?: string;
}

/** L144-167 `ShelfShatterOverlay(state, modifier)`。 */
export function ShelfShatterOverlay(props: ShelfShatterOverlayProps): ReactNode {
  const version = useShelfMotionVersion(props.state);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const images = useRef(new Map<string, HTMLImageElement>());

  // version 只用来触发重渲染（useSyncExternalStore 已保证），不需要进依赖。
  const bursts = props.state.bursts.slice();

  const paint = useCallback((): void => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const width = Math.round(window.innerWidth * dpr);
    const height = Math.round(window.innerHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const burst of bursts) {
      if (isFavShelfKey(burst.key) ? props.state.hideFavorites : props.state.hideBooks) continue;
      let image = images.current.get(burst.key);
      if (image === undefined && burst.imageUrl !== null) {
        image = new Image();
        image.src = burst.imageUrl;
        images.current.set(burst.key, image);
      }
      for (const shard of burst.shards) {
        const t = shelfShardProgress(burst.progress, shard.delay);
        const travel = shelfShardTravel(t);
        const fade = shelfShardFade(t);
        const offset = shelfShardOffset(shard.velocity, travel, burst.height, t);
        const scale = shelfShardScale(t);
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(burst.origin.x + offset.x, burst.origin.y + offset.y);
        ctx.translate(shard.center.x, shard.center.y);
        ctx.rotate((shard.spin * travel * Math.PI) / 180);
        ctx.scale(scale, scale);
        ctx.translate(-shard.center.x, -shard.center.y);
        ctx.beginPath();
        const first = shard.points[0];
        if (first !== undefined) {
          ctx.moveTo(first.x, first.y);
          for (const point of shard.points.slice(1)) ctx.lineTo(point.x, point.y);
          ctx.closePath();
        }
        ctx.clip();
        if (image !== undefined && image.complete && image.naturalWidth > 0) {
          ctx.drawImage(image, 0, 0, burst.width, burst.height);
        } else {
          ctx.fillStyle = burst.tint;
          ctx.fillRect(0, 0, burst.width, burst.height);
        }
        ctx.restore();
      }
    }
  }, [bursts, props.state]);

  useEffect(() => {
    paint();
  }, [paint, version]);

  const idle = bursts.length === 0;
  return (
    <canvas
      ref={canvasRef}
      className={['shelf-shatter', props.className].filter(Boolean).join(' ')}
      aria-hidden
      style={{ display: idle ? 'none' : 'block' }}
    />
  );
}
