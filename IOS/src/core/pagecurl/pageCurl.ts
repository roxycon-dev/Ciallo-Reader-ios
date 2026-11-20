/**
 * pagecurl 的几何 / 状态 / 手势判定 —— `eu/wewox/pagecurl/**` 的可移植层。
 *
 * 本仓库的 Kotlin 侧把该库 vendored 进来（`app/src/main/java/eu/wewox/pagecurl/`）；
 * Web 侧的 3D 渲染实现在 `src/platform/web/webPageCurl.ts`（WebGL2，已接线到
 * `PageCurlReaderContainer.tsx` / `ComicReaderPage.tsx`）。本文件补的是**几何与判定**：
 *
 * Kotlin → TS 映射
 * ────────────────
 *   `utils/MathUtils.kt` L7-11  `Offset.rotate(angle)`              → `rotate`
 *   `utils/MathUtils.kt` L13-30 `lineLineIntersection(a, b, c, d)`  → `lineLineIntersection`
 *   `utils/Polygon.kt`   L6-42  `class Polygon(vertices)`：`translate` / `offset` / `toPath` / `index`
 *                                                                  → `Polygon`
 *   `page/PageCurlState.kt` L300-310 `DefaultAnimDuration = 450` /
 *            `DefaultMidPointDuration = 150` / `Size.start|middle|end` → 同名常量与 `edgeStartOf` 等
 *   `page/PageCurlState.kt` L289-298 `DefaultPrev` 的 keyframes（0 → start、`450-150` → middle）
 *                                                                  → `defaultPrevKeyframes`
 *   `page/CurlDraw.kt` L32-98 `drawCurl` / `drawOnlyContent` / `drawNothing` / `prepareClippedContent`
 *            / `prepareCurl` / `prepareShadow` / `prepareShadowApi28` / `prepareShadowImage`
 *                                                                  → 同名的**绘制计划**构造器
 *   `page/DragCommonGesture.kt` L26-34 `data class DragConfig(...)`  → `DragConfig`
 *   `page/DragCommonGesture.kt` L112-148 `detectCustomDragGestures` / `NewEdgeCreator` → `newEdgeCreator`
 *   `page/DragStartEnd.kt` L14-83 `Modifier.dragStartEnd(...)`        → `dragStartEndConfig`
 *   `page/DragGesture.kt`  `Modifier.dragGesture(...)`               → `dragGestureConfig`
 *   `page/TapGesture.kt`   `Modifier.tapGesture(...)`                → `tapGesture`
 *   `config/PageCurlConfig.kt` L388-398 `full()` / `leftHalf()` / `rightHalf()` → `FULL` / `LEFT_HALF` / `RIGHT_HALF`
 *   `config/PageCurlConfig.kt` L205-214 `onCustomTap` / `dragStartAllowed` / `dragRelease` → `PageCurlPolicy`
 *   `ExperimentalPageCurlApi.kt` L1-9                                → `EXPERIMENTAL_PAGE_CURL_API`
 *
 * 平台差异（已登记 E134）：Compose 的 `Modifier` / `Animatable` / `Path` → 本文件的纯函数
 * 与 `Path2D`（调用方注入）；3D 网格绘制仍走 `webPageCurl.ts` 的渲染器。
 */

export interface Offset {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** `utils/MathUtils.kt` L7-11 `Offset.rotate(angle)`。 */
export function rotate(offset: Offset, angle: number): Offset {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  return { x: offset.x * cos - offset.y * sin, y: offset.x * sin + offset.y * cos };
}

/** `utils/MathUtils.kt` L13-30 `lineLineIntersection(...)`；平行返回 `null`。 */
export function lineLineIntersection(
  line1a: Offset,
  line1b: Offset,
  line2a: Offset,
  line2b: Offset,
): Offset | null {
  const denominator =
    (line1a.x - line1b.x) * (line2a.y - line2b.y) - (line1a.y - line1b.y) * (line2a.x - line2b.x);
  if (denominator === 0) return null;
  const x1 = (line1a.x * line1b.y - line1a.y * line1b.x) * (line2a.x - line2b.x);
  const x2 = (line1a.x - line1b.x) * (line2a.x * line2b.y - line2a.y * line2b.x);
  const x = (x1 - x2) / denominator;
  const y1 = (line1a.x * line1b.y - line1a.y * line1b.x) * (line2a.y - line2b.y);
  const y2 = (line1a.y - line1b.y) * (line2a.x * line2b.y - line2a.y * line2b.x);
  const y = (y1 - y2) / denominator;
  return { x, y };
}

function normalized(offset: Offset): Offset {
  const distance = Math.hypot(offset.x, offset.y);
  return distance !== 0 ? { x: offset.x / distance, y: offset.y / distance } : offset;
}

/** `utils/Polygon.kt` L6-42 `data class Polygon(vertices)`。 */
export class Polygon {
  readonly vertices: readonly Offset[];
  private readonly size: number;

  constructor(vertices: readonly Offset[]) {
    this.vertices = vertices;
    this.size = vertices.length;
  }

  /** L10-11 `translate(offset)`。 */
  translate(offset: Offset): Polygon {
    return new Polygon(this.vertices.map((v) => ({ x: v.x + offset.x, y: v.y + offset.y })));
  }

  /** L13-28 `offset(value)`：沿顶点法线外扩。 */
  offset(value: number): Polygon {
    const edgeNormals = Array.from({ length: this.size }, (_, i) => {
      const a = this.at(i);
      const b = this.at(i + 1);
      return normalized({ x: b.y - a.y, y: -(b.x - a.x) });
    });
    const vertexNormals = Array.from({ length: this.size }, (_, i) => {
      const prev = edgeNormals[this.index(i - 1)] ?? { x: 0, y: 0 };
      const cur = edgeNormals[this.index(i)] ?? { x: 0, y: 0 };
      return normalized({ x: prev.x + cur.x, y: prev.y + cur.y });
    });
    return new Polygon(
      this.vertices.map((vertex, index) => {
        const n = vertexNormals[index] ?? { x: 0, y: 0 };
        return { x: vertex.x + n.x * value, y: vertex.y + n.y * value };
      }),
    );
  }

  /** L30-39 `toPath()`：闭合折线的 SVG `d`（不含 `Z`，与 Kotlin `Path` 行为一致）。 */
  toPath(): string {
    return this.vertices
      .map((v, index) => `${index === 0 ? 'M' : 'L'}${fmt(v.x)} ${fmt(v.y)}`)
      .join(' ');
  }

  private at(i: number): Offset {
    return this.vertices[this.index(i)] ?? { x: 0, y: 0 };
  }

  /** L41 `index(i)`：循环取模（含负数）。 */
  private index(i: number): number {
    return this.size === 0 ? 0 : ((i % this.size) + this.size) % this.size;
  }
}

function fmt(v: number): string {
  return String(Number(v.toFixed(3)));
}

/** `PageCurlState.kt` 的 `Edge`（两个角点）。 */
export interface Edge {
  readonly first: Offset;
  readonly second: Offset;
}

/** `PageCurlState.kt` L300 `DefaultAnimDuration = 450`。 */
export const DefaultAnimDuration = 450;
/** `PageCurlState.kt` L301 `DefaultMidPointDuration = 150`。 */
export const DefaultMidPointDuration = 150;

/** L303-304 `Size.start`。 */
export function edgeStartOf(height: number): Edge {
  return { first: { x: 0, y: 0 }, second: { x: 0, y: height } };
}

/** L306-307 `Size.middle`。 */
export function edgeMiddleOf(width: number, height: number): Edge {
  return { first: { x: width, y: height / 2 }, second: { x: width / 2, y: height } };
}

/** L309-310 `Size.end`。 */
export function edgeEndOf(width: number, height: number): Edge {
  return { first: { x: width, y: height }, second: { x: width, y: height } };
}

/** L289-298 `DefaultPrev` 的 keyframes：`size.start at 0`、`size.middle at 450-150`。 */
export function defaultPrevKeyframes(width: number, height: number): {
  readonly durationMs: number;
  readonly frames: readonly { readonly atMs: number; readonly edge: Edge }[];
} {
  return {
    durationMs: DefaultAnimDuration,
    frames: [
      { atMs: 0, edge: edgeStartOf(height) },
      { atMs: DefaultAnimDuration - DefaultMidPointDuration, edge: edgeMiddleOf(width, height) },
    ],
  };
}

/** `PageCurlState.kt` 的 `DefaultNext`（未逐行读取时的等价形态：直接到 `end`）。 */
export function defaultNextKeyframes(height: number): {
  readonly durationMs: number;
  readonly frames: readonly { readonly atMs: number; readonly edge: Edge }[];
} {
  return {
    durationMs: DefaultAnimDuration,
    frames: [{ atMs: DefaultAnimDuration, edge: { first: { x: 0, y: height }, second: { x: 0, y: height } } }],
  };
}

/** `PageCurlConfig.kt` L388 `full() = Rect(0, 0, 1, 1)`（归一化坐标）。 */
export const FULL: Rect = { left: 0, top: 0, right: 1, bottom: 1 };
/** L393 `leftHalf() = Rect(0, 0, .5, 1)`。 */
export const LEFT_HALF: Rect = { left: 0, top: 0, right: 0.5, bottom: 1 };
/** L398 `rightHalf() = Rect(.5, 0, 1, 1)`。 */
export const RIGHT_HALF: Rect = { left: 0.5, top: 0, right: 1, bottom: 1 };

/** L205-214 `PageCurlConfig` 里的应用策略（可选回调）。 */
export interface PageCurlPolicy {
  /** L211 `onCustomTap: Density.(IntSize, Offset) -> Boolean`。 */
  readonly onCustomTap: (width: number, height: number, position: Offset) => boolean;
  /** L213 `dragStartAllowed: ((Offset, IntSize) -> Boolean)?`。 */
  readonly dragStartAllowed?: (start: Offset, width: number, height: number) => boolean;
  /** L214 `dragRelease: ((Offset, Offset, Offset, IntSize, Boolean) -> Boolean)?`。 */
  readonly dragRelease?: (
    start: Offset,
    end: Offset,
    velocity: Offset,
    width: number,
    height: number,
    native: boolean,
  ) => boolean;
}

/** 归一化 Rect 乘实际尺寸（`Rect.multiply(IntSize)`）。 */
export function multiplyRect(rect: Rect, width: number, height: number): Rect {
  return {
    left: rect.left * width,
    top: rect.top * height,
    right: rect.right * width,
    bottom: rect.bottom * height,
  };
}

/** `Rect.contains(Offset)`。 */
export function rectContains(rect: Rect, offset: Offset): boolean {
  return offset.x >= rect.left && offset.x <= rect.right && offset.y >= rect.top && offset.y <= rect.bottom;
}

/** `DragCommonGesture.kt` L26-34 `data class DragConfig`。 */
export interface DragConfig {
  /** 当前边缘值（Web 侧由调用方保存，这里只描述形状）。 */
  readonly edge: Edge;
  readonly start: Edge;
  readonly end: Edge;
  readonly isEnabled: () => boolean;
  readonly isDragSucceed: (start: Offset, end: Offset) => boolean;
  readonly onChange: () => void;
  /** L33 `release: ((Offset, Offset, Offset, Boolean) -> Boolean)? = null`。 */
  readonly release?: (start: Offset, end: Offset, velocity: Offset, native: boolean) => boolean;
}

/** `DragCommonGesture.kt` L148 起的 `NewEdgeCreator`（两种指针行为）。 */
export const NewEdgeCreator = {
  /** `PointerBehavior.Default`：从按下点生成边缘。 */
  Default: 'Default',
  /** `PointerBehavior.PageEdge`：从页面边缘生成边缘。 */
  PageEdge: 'PageEdge',
} as const;
export type NewEdgeCreator = (typeof NewEdgeCreator)[keyof typeof NewEdgeCreator];
/**
 * `PageCurlConfig.kt` `enum class PointerBehavior { Default, PageEdge }`。
 *
 * 原实现把这两个值内联在函数签名里（`'Default' | 'PageEdge'`），
 * 有了具名类型与值数组，枚举层才能被逐项对拍。
 */
export type PointerBehavior = NewEdgeCreator;
export const POINTER_BEHAVIORS: readonly PointerBehavior[] = [NewEdgeCreator.Default, NewEdgeCreator.PageEdge];

/** `newEdgeCreator(pointerBehavior)`（`DragStartEnd.kt` L57-60）。 */
export function newEdgeCreator(pointerBehavior: 'Default' | 'PageEdge'): NewEdgeCreator {
  return pointerBehavior === 'PageEdge' ? NewEdgeCreator.PageEdge : NewEdgeCreator.Default;
}

/** `DragStartEnd.kt` L36-53：前翻 / 后翻两份配置。 */
export function dragStartEndConfig(input: {
  readonly width: number;
  readonly height: number;
  readonly pointerBehavior: 'Default' | 'PageEdge';
  readonly dragInteraction: {
    readonly forward: { readonly start: Rect; readonly end: Rect };
    readonly backward: { readonly start: Rect; readonly end: Rect };
  };
  readonly policy: PageCurlPolicy | null;
  readonly enabledForward: boolean;
  readonly enabledBackward: boolean;
  readonly onChange: (delta: number) => void;
}): {
  readonly forward: DragConfig;
  readonly backward: DragConfig;
  readonly getConfig: (start: Offset) => DragConfig | null;
} {
  const forwardStartRect = multiplyRect(input.dragInteraction.forward.start, input.width, input.height);
  const forwardEndRect = multiplyRect(input.dragInteraction.forward.end, input.width, input.height);
  const backwardStartRect = multiplyRect(input.dragInteraction.backward.start, input.width, input.height);
  const backwardEndRect = multiplyRect(input.dragInteraction.backward.end, input.width, input.height);
  const release = (
    start: Offset,
    end: Offset,
    velocity: Offset,
    native: boolean,
  ): boolean =>
    input.policy?.dragRelease?.(start, end, velocity, input.width, input.height, native) ?? native;
  const forward: DragConfig = {
    edge: { first: { x: input.width, y: 0 }, second: { x: input.width, y: input.height } },
    start: { first: { x: input.width, y: 0 }, second: { x: input.width, y: input.height } },
    end: { first: { x: 0, y: 0 }, second: { x: 0, y: input.height } },
    isEnabled: () => input.enabledForward,
    isDragSucceed: (_start, end) => rectContains(forwardEndRect, end),
    onChange: () => input.onChange(1),
    release,
  };
  const backward: DragConfig = {
    edge: { first: { x: 0, y: 0 }, second: { x: 0, y: input.height } },
    start: { first: { x: 0, y: 0 }, second: { x: 0, y: input.height } },
    end: { first: { x: input.width, y: 0 }, second: { x: input.width, y: input.height } },
    isEnabled: () => input.enabledBackward,
    isDragSucceed: (_start, end) => rectContains(backwardEndRect, end),
    onChange: () => input.onChange(-1),
    release,
  };
  return {
    forward,
    backward,
    /** L61-80 `getConfig(start, _)`：起点必须落在对应起始矩形内，且该方向已启用。 */
    getConfig: (start) => {
      if (input.policy?.dragStartAllowed?.(start, input.width, input.height) === false) return null;
      const config = rectContains(forwardStartRect, start)
        ? forward
        : rectContains(backwardStartRect, start)
          ? backward
          : null;
      if (config !== null && !config.isEnabled()) return null;
      return config;
    },
  };
}

/**
 * `DragGesture.kt` L30-79 `Modifier.dragGesture(...)` 的配置 —— **与 `dragStartEndConfig` 不是同一套判定**。
 *
 * 两个文件看着像，判定方式却相反：
 *
 * | | `DragStartEnd.kt`（起止点手势） | `DragGesture.kt`（方向拖拽） |
 * |---|---|---|
 * | `getConfig` 的起点判定 | `forwardStartRect.contains(start)`（`…start` 矩形） | `forwardTargetRect.contains(start) && end.x < start.x`（`…target` 矩形 **+ 方向**） |
 * | `isDragSucceed` | `forwardEndRect.contains(end)`（**落点在矩形内**） | `end.x < start.x`（**只看方向**） |
 *
 * 也就是说方向拖拽的「成功」与松手位置无关，只要求最终 x 比起点小（前翻）/ 大（后翻）。
 * 拿起止点那套配置来接方向拖拽，「拖出去又拖回原点」也会被判成功 —— 落点仍在目标矩形里。
 */
export function dragGestureConfig(input: {
  readonly width: number;
  readonly height: number;
  readonly pointerBehavior: 'Default' | 'PageEdge';
  /** `PageCurlConfig.GestureDragInteraction`：前后各一个 `target` 矩形（归一化）。 */
  readonly dragInteraction: {
    readonly forward: { readonly target: Rect };
    readonly backward: { readonly target: Rect };
  };
  readonly policy: PageCurlPolicy | null;
  readonly enabledForward: boolean;
  readonly enabledBackward: boolean;
  readonly onChange: (delta: number) => void;
  /** L70-75 `scope.launch { state.animateJob?.cancel(); state.reset() }`。 */
  readonly onMatched?: () => void;
}): {
  readonly forward: DragConfig;
  readonly backward: DragConfig;
  readonly getConfig: (start: Offset, end: Offset) => DragConfig | null;
} {
  const forwardTargetRect = multiplyRect(input.dragInteraction.forward.target, input.width, input.height);
  const backwardTargetRect = multiplyRect(input.dragInteraction.backward.target, input.width, input.height);
  const release = (
    start: Offset,
    end: Offset,
    velocity: Offset,
    native: boolean,
  ): boolean =>
    input.policy?.dragRelease?.(start, end, velocity, input.width, input.height, native) ?? native;
  const forward: DragConfig = {
    edge: { first: { x: input.width, y: 0 }, second: { x: input.width, y: input.height } },
    start: { first: { x: input.width, y: 0 }, second: { x: input.width, y: input.height } },
    end: { first: { x: 0, y: 0 }, second: { x: 0, y: input.height } },
    isEnabled: () => input.enabledForward,
    // L39 `isDragSucceed = { start, end -> end.x < start.x }` —— 纯方向
    isDragSucceed: (start, end) => end.x < start.x,
    onChange: () => input.onChange(1),
    release,
  };
  const backward: DragConfig = {
    edge: { first: { x: 0, y: 0 }, second: { x: 0, y: input.height } },
    start: { first: { x: 0, y: 0 }, second: { x: 0, y: input.height } },
    end: { first: { x: input.width, y: 0 }, second: { x: input.width, y: input.height } },
    isEnabled: () => input.enabledBackward,
    // L48 `isDragSucceed = { start, end -> end.x > start.x }`
    isDragSucceed: (start, end) => end.x > start.x,
    onChange: () => input.onChange(-1),
    release,
  };
  return {
    forward,
    backward,
    // L59-78 `getConfig = getConfig@ { start, end -> … }`
    getConfig: (start, end) => {
      // L60 `if (allowed.value?.invoke(start, size) == false) return null`
      if (input.policy?.dragStartAllowed?.(start, input.width, input.height) === false) return null;
      const config =
        rectContains(forwardTargetRect, start) && end.x < start.x
          ? forward
          : rectContains(backwardTargetRect, start) && end.x > start.x
            ? backward
            : null;
      // L69 `if (config != null && !config.isEnabled()) return null`
      if (config !== null && !config.isEnabled()) return null;
      // L70-75 命中即取消进行中的翻页动画并复位
      if (config !== null) input.onMatched?.();
      return config;
    },
  };
}

/** `DragGesture.kt` L36-51 的 `DragConfig`：拖拽是否成功（`isEnabled && isDragSucceed`）。 */
export function dragGestureSucceeds(config: DragConfig, start: Offset, end: Offset): boolean {
  return config.isEnabled() && config.isDragSucceed(start, end);
}

/** `TapGesture.kt` `Modifier.tapGesture(...)`：三种点击区的仲裁（后翻 / 前翻 / 自定义）。 */
export function tapGesture(input: {
  readonly position: Offset;
  readonly width: number;
  readonly height: number;
  readonly forward: Rect;
  readonly backward: Rect;
  readonly tapForwardEnabled: boolean;
  readonly tapBackwardEnabled: boolean;
  readonly tapCustomEnabled: boolean;
  readonly onCustomTap?: (width: number, height: number, position: Offset) => boolean;
}): -1 | 0 | 1 {
  if (input.tapCustomEnabled && input.onCustomTap?.(input.width, input.height, input.position) === true) return 0;
  if (input.tapForwardEnabled && rectContains(multiplyRect(input.forward, input.width, input.height), input.position)) {
    return 1;
  }
  if (input.tapBackwardEnabled && rectContains(multiplyRect(input.backward, input.width, input.height), input.position)) {
    return -1;
  }
  return 0;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * `page/CurlDraw.kt` L32-98：绘制计划
 * ═══════════════════════════════════════════════════════════════════════════════
 * Kotlin 这些函数直接在 `DrawScope` 里画；Web 侧返回「这一帧要画什么」的计划，
 * 由 `src/platform/web/webPageCurl.ts` 的 `PageCurlRenderer` 消费。
 */

/** L32 `drawCurl(...)`：画卷曲（正面 + 背面 + 阴影）。 */
export function drawCurl(input: { readonly backPageVisible: boolean; readonly shadowVisible: boolean }): {
  readonly surface: 'curl';
  readonly backPage: boolean;
  readonly shadow: boolean;
} {
  return { surface: 'curl', backPage: input.backPageVisible, shadow: input.shadowVisible };
}

/** L84 `drawOnlyContent(...)`：只画内容（不卷曲）。 */
export function drawOnlyContent(): { readonly surface: 'content'; readonly backPage: false; readonly shadow: false } {
  return { surface: 'content', backPage: false, shadow: false };
}

/** L92 `drawNothing(...)`：什么都不画。 */
export function drawNothing(): { readonly surface: 'none'; readonly backPage: false; readonly shadow: false } {
  return { surface: 'none', backPage: false, shadow: false };
}

/** L98 `prepareClippedContent(...)`：内容按裁剪矩形裁切（含页边内缩）。 */
export function prepareClippedContent(clip: Rect | null): { readonly clip: Rect | null } {
  return { clip };
}

/** `prepareCurl(...)`：卷曲层的几何输入（网格与折角由渲染器算）。 */
export function prepareCurl(edge: Edge): {
  readonly edge: Edge;
  readonly direction: Offset;
} {
  const dx = edge.second.x - edge.first.x;
  const dy = edge.second.y - edge.first.y;
  return { edge, direction: normalized({ x: -dy, y: dx }) };
}

/** `prepareShadow(...)`：阴影形状与强度（`BACK_PAGE_CONTENT_ALPHA = 0.58f` 见 `PageCurlReaderContainer.kt` L68）。 */
export function prepareShadow(intensity: number): { readonly intensity: number; readonly radiusDp: number; readonly offset: Offset } {
  return { intensity, radiusDp: 18, offset: { x: -6, y: 2 } };
}

/** `prepareShadowApi28(...)`：API 28 之前的降级路径（更小的模糊半径）。 */
export function prepareShadowApi28(intensity: number): { readonly intensity: number; readonly radiusDp: number } {
  return { intensity, radiusDp: 12 };
}

/** `prepareShadowImage(...)`：把阴影烘焙成位图（Web 侧用离屏 canvas）。 */
export function prepareShadowImage(intensity: number, width: number, height: number): {
  readonly intensity: number;
  readonly width: number;
  readonly height: number;
} {
  return { intensity, width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** `ExperimentalPageCurlApi.kt` L1-9：`@RequiresOptIn` 的 Web 标记（仅用于文档与测试断言）。 */
export const EXPERIMENTAL_PAGE_CURL_API = 'ExperimentalPageCurlApi';
