/**
 * GodCoverCropPage.tsx — 神回封面裁剪（全屏，**深色**，与 Android 一致）。
 *
 * Ported line-by-line from Android `god/GodCoverCropScreen.kt` (419 lines / 399 non-blank).
 * Read-only source: novel-reader/app/src/main/java/com/example/god/GodCoverCropScreen.kt
 *
 * Kotlin 行号映射：
 *   - 57      `private const val MIN_CROP = 0.1f`（裁剪框最小尺寸，舞台归一化）
 *   - 60-66   类文档（双指缩放/拖动/90° 旋转；自由比例裁剪框；夹在显示区内；
 *              确认时换算回（旋转后）原图归一化矩形 → 与视口无关）
 *   - 69-74   `GodCoverCropScreen(source, initialCrop, onCancel, onConfirm)` 签名
 *   - 75-76   `rememberCoroutineScope()` / `LocalDensity.current`
 *   - 79-85   旋转后的显示位图（`LaunchedEffect(source, rotation)` + 后台
 *              `GodCoverEngine.rotate`）→ 旋转后的显示尺寸（见 `rotatedSize`）
 *   - 88-90   `Animatable(initialCrop.scale/offsetX/offsetY)`（编辑态还原）
 *   - 92-93   `stageW` / `stageH`（`onSizeChanged`）→ `ResizeObserver`
 *   - 96-105  `fit`（contain 适配 + 居中矩形）→ `fitRect()`
 *   - 108-117 `bounds`（含用户缩放/平移的显示矩形 = 裁剪框可动边界）→ `displayBounds()`
 *   - 120-138 裁剪框（舞台归一化 0..1）；图片缩放/平移后夹回显示区（MIN_CROP）
 *              → `clampRectIntoBounds()`
 *   - 139     `dragging` → `showGrid`
 *   - 141-149 根 `Box(background = Color(0xFF0B0C0E))` + 加载态文案
 *              （`source == null` → "封面加载失败，请返回重试"；否则 "正在准备图片…"）
 *   - 151-198 舞台 `Box`（padding top 56 / bottom 84 / start 12 / end 12）
 *              + `pointerInput(fit) { detectTransformGestures }`（平移/缩放）
 *              + `Image(ContentScale.Fit)` + `graphicsLayer`
 *   - 184-186 ⚠️ 覆盖层必须挂在**舞台 Box 内部**（见组件内注释）
 *   - 187-197 `CropOverlay(..., showGrid = dragging, ...)`
 *   - 201-234 顶栏（`0xFF0B0C0E@0.88`；关闭 IconButton「取消」；标题「裁剪封面」；
 *              旋转 IconButton「旋转 90°」：`(rotation + 90f) % 360f` + 三个 `animateTo`）
 *   - 236-293 底栏（`0xFF0B0C0E@0.92`；取消 / 完成）
 *   - 249-288 完成时的坐标换算（`mapX` / `mapY`：舞台 → 未变换显示 → 原图归一化）
 *   - 253-261 fit/rect/stage 缺失时的兜底 `CropParams(scale, offX, offY, rotation, 0,0,1,1)`
 *   - 291     「完成」色 `#F5B942` + Bold
 *   - 301-310 `CropOverlay` 文档 + `touchPx = 44.dp` + `visualSpan = 0.545f`
 *   - 311-315 触摸目标 44dp / 视觉手柄占比
 *   - 317-320 ⚠️ `rememberUpdatedState(rect)`（pointerInput 冻结 lambda 的坑）
 *              → `getRect()` prop（每次 render 都是最新闭包）
 *   - 322-350 `Canvas`：框外遮罩 4 块（`0xB3000000`）+ 白框 1.5dp + 三分线
 *   - 352-354 `normBounds`（bounds 的舞台归一化；null → 全幅 0,0,1,1）
 *   - 356-366 8 个手柄 `HandleSpec`（四角 0-3 + 四边 4-7）→ `cropHandleSpecs()`
 *   - 368-430 `specs.forEach`：手柄定位 + `detectDragGestures` + `when (kind)` 分支
 *   - 392-406 拖动后的 4 向夹紧（`coerceIn(normBounds, ±MIN_CROP)`）→ `clampRectToNorm()`
 *   - 411-427 手柄绘制（角 = 十字线，边 = 小圆角方块 `white@0.92` / 3dp 圆角）
 *
 * 适配与跳过（原因）：
 *   - `android.graphics.Bitmap` → 注入的 `GodDecodedImage`（`@core/god/godReaderBinding`
 *     声明的 `GodCoverImageDecoder` 端口产物）。`GodCoverEngine.rotate / applyCrop /
 *     compose`（GodCoverEngine.kt L262-345）的**数学**已在
 *     `src/core/god/godCoverEngine.ts` 覆盖；像素级合成由宿主 decoder 完成。
 *     旋转的**显示**效果在 web 侧用 CSS `rotate()` 表达，因此 `fit` 走旋转后的尺寸
 *     （Android 侧 `GodCoverEngine.rotate` 已把宽高互换，两者等价）。
 *   - `withContext(Dispatchers.Default)` 旋转 → `await`（宿主 decoder 内部决定线程）。
 *   - Compose `Canvas` 裁剪覆盖层 → **`<canvas>` 2D context**（任务指定：裁剪预览是
 *     位图合成，2D canvas 是真等价）；手柄是 8 个独立 div 覆盖在 canvas 之上，
 *     各自消费 Pointer Events（对应 Kotlin「手柄是独立的小 Box」L368-369）。
 *   - `detectTransformGestures`（双指捏合 + 拖动）→ Pointer Events：自建活跃指针
 *     表 + 间距比算 zoom、质心位移算 pan（E46 已关闭）。触控板捏合走
 *     `ctrlKey` 分支作为鼠标端的等价输入。
 *     宿主如需可自行叠加 `touchstart/touchmove` 的 `touches` 双指距离计算。
 *   - Compose spring（`scale.animateTo(1f, springMain())` 等，L222-226）→ CSS
 *     cubic-bezier（`GOD_SPRING_MAIN_CSS`，GodMotion.kt L34 的 damping 0.72 /
 *     stiffness 380）；本文件的旋转是瞬时状态改写（同 Kotlin `snapTo` 语义），
 *     过渡交给 `.gocc-image` 的 `transition`。
 *   - `Icons.Filled.Close` / `Icons.Filled.Refresh` → 文本符号（`✕` / `↻`），
 *     无障碍文案「取消」/「旋转 90°」原样保留。
 *   - `androidx.activity.compose.BackHandler`（在 GodReaderBinding.kt L110/L162）
 *     → 本页自持 `Escape` 键。
 *   - 状态栏 / 导航栏内边距 → CSS `env(safe-area-inset-*)`。
 *
 * 本次逐行复核的修正：
 *   - L470 `transform` 顺序：Compose `graphicsLayer` 的平移是矩阵**最后**一层
 *     （不被 scale 吃掉、不随 rotation 换轴），所以必须是
 *     `translate() rotate() scale()`；此前写成 `rotate() scale() translate()`，
 *     缩放 >1 时实际位移被放大，与 L268 `p0 = cx + (p - cx - offX) / s` 的反算对不上。
 *   - 源图尺寸：新增 `<img onLoad>` 读 `naturalWidth/naturalHeight`。
 *     `GodMomentSheet.tsx` 此前传 `sourceWidth/Height = 0`，`fitRect()` 恒返回
 *     null → 裁剪框铺满舞台、确认永远回 `crop 0,0,1,1`（裁剪功能实际失效）。
 *   - L503 `transition`：Kotlin 只在**旋转复位**时用弹簧（L222-226 三个
 *     `animateTo(1f/0f, springMain())`），拖动 / 捏合是 `snapTo`（L162-164，瞬时）。
 *     此前 transition 常开 → 拖动整张图被 380ms 弹簧曲线拖慢。现在只在 `animating`
 *     （旋转后 GOD_SPRING_SPECS.main.durationMs 内）为真时挂 transition。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_CROP_PARAMS, type CropParams } from '@core/god/godTypes';
import { GOD_SPRING_SPECS } from '@core/god/godEasing';
import { GOD_SPRING_MAIN_CSS } from '@core/god/godPull';
import type { GodDecodedImage } from '@core/god/godReaderBinding';
import './GodCoverCropPage.css';

/** Kotlin 57: `private const val MIN_CROP = 0.1f` —— 裁剪框最小尺寸（舞台归一化）。 */
export const GOD_CROP_MIN = 0.1;

/** Kotlin 313: `val touchPx = with(density) { 44.dp.toPx() }` —— 触摸目标 44dp。 */
export const GOD_CROP_TOUCH_PX = 44;

/** Kotlin 315: `val visualSpan = 0.545f` —— 视觉手柄在触摸目标里的占比（24dp/44dp）。 */
export const GOD_CROP_VISUAL_SPAN = 0.545;

/**
 * `GodMotion.springMain()` 的 CSS 时长（GodMotion.kt L34 的 stiffness 380 / damping 0.72
 * → `GOD_SPRING_SPECS.main.durationMs`）—— 旋转复位后关闭过渡的等待时间。
 */
const GOD_SPRING_MAIN_MS = GOD_SPRING_SPECS.main.durationMs;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 旋转后的显示尺寸（Kotlin L79-85 `GodCoverEngine.rotate` 的结果）。
 * 90/270 度时宽高互换；显示层用 CSS `rotate()`，几何必须先按旋转后的尺寸算。
 */
export function rotatedSize(
  width: number,
  height: number,
  rotationDeg: number,
): { width: number; height: number } {
  const norm = ((rotationDeg % 360) + 360) % 360;
  return norm === 90 || norm === 270
    ? { width: height, height: width }
    : { width, height };
}

/** Kotlin 96-105：`fit` = contain 适配 + 居中矩形。 */
export function fitRect(
  imageWidth: number,
  imageHeight: number,
  stageW: number,
  stageH: number,
): Rect | null {
  if (imageWidth <= 0 || imageHeight <= 0 || stageW <= 0 || stageH <= 0) return null;
  const s = Math.min(stageW / imageWidth, stageH / imageHeight);
  const w = imageWidth * s;
  const h = imageHeight * s;
  return {
    left: (stageW - w) / 2,
    top: (stageH - h) / 2,
    right: (stageW - w) / 2 + w,
    bottom: (stageH - h) / 2 + h,
  };
}

/** Kotlin 108-117：`bounds` = 含缩放/平移的显示矩形。 */
export function displayBounds(
  fit: Rect | null,
  scale: number,
  offX: number,
  offY: number,
  stageW: number,
  stageH: number,
): Rect | null {
  if (fit === null || stageW <= 0 || stageH <= 0) return null;
  const cx = stageW / 2;
  const cy = stageH / 2;
  const l = cx + (fit.left - cx) * scale + offX;
  const t = cy + (fit.top - cy) * scale + offY;
  return {
    left: l,
    top: t,
    right: l + (fit.right - fit.left) * scale,
    bottom: t + (fit.bottom - fit.top) * scale,
  };
}

/** Kotlin 121-138：图片缩放/平移后把裁剪框夹回图片显示区。 */
export function clampRectIntoBounds(rect: Rect, norm: Rect): Rect {
  const l = Math.min(norm.right - GOD_CROP_MIN, Math.max(norm.left, rect.left));
  const t = Math.min(norm.bottom - GOD_CROP_MIN, Math.max(norm.top, rect.top));
  return {
    left: l,
    top: t,
    right: Math.min(norm.right, Math.max(l + GOD_CROP_MIN, rect.right)),
    bottom: Math.min(norm.bottom, Math.max(t + GOD_CROP_MIN, rect.bottom)),
  };
}

/** Kotlin 356-366：8 个手柄。四角 kind 0-3，四边 kind 4-7。 */
export const GOD_CROP_HANDLE_KINDS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export interface GodCropHandleSpec {
  x: number;
  y: number;
  kind: number;
}

export function cropHandleSpecs(rect: Rect): GodCropHandleSpec[] {
  return [
    { x: rect.left, y: rect.top, kind: 0 },
    { x: rect.right, y: rect.top, kind: 1 },
    { x: rect.left, y: rect.bottom, kind: 2 },
    { x: rect.right, y: rect.bottom, kind: 3 },
    { x: (rect.left + rect.right) / 2, y: rect.top, kind: 4 },
    { x: (rect.left + rect.right) / 2, y: rect.bottom, kind: 5 },
    { x: rect.left, y: (rect.top + rect.bottom) / 2, kind: 6 },
    { x: rect.right, y: (rect.top + rect.bottom) / 2, kind: 7 },
  ];
}

/** Kotlin 392-401：手柄拖动改哪几条边。 */
export function applyHandleDrag(rect: Rect, kind: number, dx: number, dy: number): Rect {
  let l = rect.left;
  let t = rect.top;
  let r = rect.right;
  let b = rect.bottom;
  if (kind === 0) {
    l += dx;
    t += dy;
  } else if (kind === 1) {
    r += dx;
    t += dy;
  } else if (kind === 2) {
    l += dx;
    b += dy;
  } else if (kind === 3) {
    r += dx;
    b += dy;
  } else if (kind === 4) {
    t += dy;
  } else if (kind === 5) {
    b += dy;
  } else if (kind === 6) {
    l += dx;
  } else {
    r += dx;
  }
  return { left: l, top: t, right: r, bottom: b };
}

/** Kotlin 402-405：4 向夹紧（含 MIN_CROP 最小尺寸）。 */
export function clampRectToNorm(rect: Rect, norm: Rect): Rect {
  const l = Math.min(rect.right - GOD_CROP_MIN, Math.max(norm.left, rect.left));
  const r = Math.min(norm.right, Math.max(l + GOD_CROP_MIN, rect.right));
  const t = Math.min(rect.bottom - GOD_CROP_MIN, Math.max(norm.top, rect.top));
  const b = Math.min(norm.bottom, Math.max(t + GOD_CROP_MIN, rect.bottom));
  return { left: l, top: t, right: r, bottom: b };
}

/** Kotlin 266-275：`mapX` / `mapY` —— 舞台归一化 → （旋转后）原图归一化。 */
export function stageNormToImageNorm(
  v: number,
  stageSize: number,
  stageCenter: number,
  offset: number,
  scale: number,
  fitStart: number,
  fitSize: number,
): number {
  const p = v * stageSize;
  const s = Math.max(scale, 0.0001);
  const p0 = stageCenter + (p - stageCenter - offset) / s;
  return Math.min(1, Math.max(0, (p0 - fitStart) / fitSize));
}

/** Kotlin 158-159：平移边界 = 缩放后图片超出舞台的部分的一半。 */
export function maxOffsetFor(fitSize: number, scale: number, stageSize: number): number {
  return Math.max(0, (fitSize * scale - stageSize) / 2);
}

/* ══════════════ Canvas 覆盖层（Kotlin L322-350） ══════════════ */

function drawCropOverlay(
  canvas: HTMLCanvasElement,
  rect: Rect,
  showGrid: boolean,
): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const l = rect.left * w;
  const t = rect.top * h;
  const r = rect.right * w;
  const b = rect.bottom * h;

  // 框外半透明遮罩（Kotlin 328-332，Color(0xB3000000) = rgba(0,0,0,0.70)）
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, w, t);
  ctx.fillRect(0, b, w, h - b);
  ctx.fillRect(0, t, l, b - t);
  ctx.fillRect(r, t, w - r, b - t);

  // 裁剪框白线（Kotlin 334-339，Stroke 1.5dp）
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(l, t, r - l, b - t);

  if (!showGrid) return;
  // 三分网格（Kotlin 340-349，White@0.42，1dp）
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i += 1) {
    const x = l + ((r - l) * i) / 3;
    ctx.beginPath();
    ctx.moveTo(x, t);
    ctx.lineTo(x, b);
    ctx.stroke();
    const y = t + ((b - t) * i) / 3;
    ctx.beginPath();
    ctx.moveTo(l, y);
    ctx.lineTo(r, y);
    ctx.stroke();
  }
}

/* ══════════════ 页面（Kotlin L69-295） ══════════════ */

export interface GodCoverCropPageProps {
  /** 已解码的源位图（`GodCoverImageDecoder.decodePage` 的结果）。null = 加载失败。 */
  source: GodDecodedImage | null;
  /** 源位图的可显示 URL（web 侧 `<img src>`）。 */
  sourceUrl: string | null;
  /**
   * 旋转前的原始像素宽高（Kotlin 用 `Bitmap.width/height`）。
   * 只是兜底 —— 图片 `<img onLoad>` 读到的 `naturalWidth/naturalHeight` 优先。
   */
  sourceWidth: number;
  sourceHeight: number;
  initialCrop: CropParams;
  onCancel: () => void;
  onConfirm: (crop: CropParams) => void;
  className?: string;
}

export function GodCoverCropPage(props: GodCoverCropPageProps) {
  const { initialCrop, onCancel, onConfirm } = props;

  /* 视图变换（Kotlin L88-90：编辑态还原） */
  const [scale, setScale] = useState(Math.min(5, Math.max(1, initialCrop.scale)));
  const [offX, setOffX] = useState(initialCrop.offsetX);
  const [offY, setOffY] = useState(initialCrop.offsetY);
  /* 旋转（Kotlin L79） */
  const [rotation, setRotation] = useState(initialCrop.rotationDeg);
  /** 旋转复位期间开启弹簧过渡（Kotlin L222-226 的 `animateTo(springMain())`）。 */
  const [animating, setAnimating] = useState(false);

  /* 舞台尺寸（Kotlin L92-93，onSizeChanged） */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);

  /**
   * 源图尺寸（Kotlin 用 `Bitmap.width/height`）。
   *
   * 宿主不一定知道原图像素（`GodMomentSheet.tsx` 之前直接传 `0 × 0`，
   * 于是 `fitRect()` 恒返回 null → 裁剪框退化成整屏、确认时永远回
   * `crop 0,0,1,1`，裁剪功能等于没接）。这里在 `<img>` 加载完成后读
   * `naturalWidth/naturalHeight`，props 仅在没有真实图片时兜底。
   */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const srcW = natural !== null && natural.w > 0 ? natural.w : props.sourceWidth;
  const srcH = natural !== null && natural.h > 0 ? natural.h : props.sourceHeight;

  /* 裁剪框（舞台归一化 0..1，Kotlin L120）
     Kotlin L120-138 是一个 `LaunchedEffect(bounds, stageW, stageH)`：
       rect == null → rect = norm（首次铺满图片显示区）
       rect != null → 把 rect 夹回 norm（图片缩放/平移后不出透明边）
     React 19 不允许在 effect 里 setState 派生值，这里改成**渲染期派生**：
       `userRect` 只存「用户拖出来的原始框」，实际渲染值
       `rect = userRect == null ? norm : clampRectIntoBounds(userRect, norm)`。
     两者逐字等价（norm 变化 → 立即重新夹紧；首帧 → 铺满）。 */
  const [userRect, setUserRect] = useState<Rect | null>(null);
  /* `showGrid = dragging`（Kotlin L193） */
  const [dragging, setDragging] = useState(false);

  const stageW = stage?.w ?? 0;
  const stageH = stage?.h ?? 0;
  /* Kotlin 96-105：`fit`（派生值） */
  const rotated = rotatedSize(srcW, srcH, rotation);
  const fit = fitRect(rotated.width, rotated.height, stageW, stageH);
  /* Kotlin 108-117：`bounds`（派生值） */
  const bounds = displayBounds(fit, scale, offX, offY, stageW, stageH);
  /* Kotlin 352-354：`normBounds`（null → 全幅 0,0,1,1） */
  const normBounds: Rect =
    bounds !== null && stageW > 0 && stageH > 0
      ? {
          left: bounds.left / stageW,
          top: bounds.top / stageH,
          right: bounds.right / stageW,
          bottom: bounds.bottom / stageH,
        }
      : { left: 0, top: 0, right: 1, bottom: 1 };
  /* Kotlin 121-138：渲染期夹紧 */
  const rect: Rect | null =
    stageW <= 0 || stageH <= 0
      ? null
      : userRect === null
        ? normBounds
        : clampRectIntoBounds(userRect, normBounds);

  /* Kotlin 151-155：onSizeChanged */
  useEffect(() => {
    const el = stageRef.current;
    if (el === null) return;
    const measure = (): void => {
      setStage({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Kotlin 322-350：把遮罩 / 白框 / 三分线画到 canvas */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || stageW <= 0 || stageH <= 0) return;
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    canvas.width = Math.max(1, Math.round(stageW * dpr));
    canvas.height = Math.max(1, Math.round(stageH * dpr));
    if (rect === null) return;
    drawCropOverlay(canvas, rect, dragging);
  }, [dragging, rect, stageW, stageH]);

  /* Kotlin 160-167：detectTransformGestures（平移 + 缩放） */
  /**
   * 活跃指针追踪 —— Compose `detectTransformGestures` 的 JS 等价物。
   *
   * Compose 的手势检测器内部维护一个「当前按下的所有指针」列表，
   * 每帧用**两点距离的变化量**算出 `zoom`、用**质心的位移**算出 `pan`。
   * Pointer Events 逐个派发单个 pointer 事件，所以必须自己攒这张表。
   *
   * 为什么不能靠 `movementX/Y`：单指时它等于质心位移（够用），
   * 但双指捏合时每个 pointer 的 movement 只反映自己那根手指，
   * 两者位移相同 → 质心不动 → pan 恒为 0，无法表达「捏合同时平移」。
   */
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  /** 上一帧的指针间距；`null` 表示当前不足两点（需重置基线）。 */
  const lastPinchDistance = useRef<number | null>(null);
  /** 上一帧的双指质心；用于把质心位移换算成 Kotlin `detectTransformGestures` 的 `pan`。 */
  const lastCentroid = useRef<{ x: number; y: number } | null>(null);

  /** Compose `Offset.getDistance()`。 */
  const pinchDistance = (pts: readonly { x: number; y: number }[]): number | null => {
    if (pts.length < 2) return null;
    const a = pts[0] as { x: number; y: number };
    const b = pts[1] as { x: number; y: number };
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  /** 双指质心 —— Compose `centroid`（`calculateCentroid` 的等价）。 */
  const pinchCentroid = (
    pts: readonly { x: number; y: number }[],
  ): { x: number; y: number } => ({
    x: (pts[0]!.x + pts[1]!.x) / 2,
    y: (pts[0]!.y + pts[1]!.y) / 2,
  });

  /** 从 ≥2 指回落到 <2 指时清空基线，避免下一帧算出假 zoom / 假 pan。 */
  const resetPinchBaseline = (): void => {
    lastPinchDistance.current = null;
    lastCentroid.current = null;
  };

  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // 从 1 指变 2 指时重置基线，否则会拿「上一帧单指的位置」算出一个假 zoom。
    if (activePointers.current.size < 2) resetPinchBaseline();
  };

  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (fit === null) return;

    const tracked = activePointers.current.get(event.pointerId);
    if (tracked !== undefined) {
      tracked.x = event.clientX;
      tracked.y = event.clientY;
    }
    const pts = [...activePointers.current.values()];
    const distance = pinchDistance(pts);

    // ── 双指：Compose 的 pan（质心位移）+ zoom（间距比）──
    if (distance !== null && distance > 0) {
      const previousDistance = lastPinchDistance.current;
      const previousCentroid = lastCentroid.current;
      const centroid = pinchCentroid(pts);
      lastPinchDistance.current = distance;
      lastCentroid.current = centroid;

      if (previousDistance !== null && previousDistance > 0) {
        // Kotlin L162：`scale.snapTo((scale.value * zoom).coerceIn(1f, 5f))`
        // zoom 是「本帧间距 / 上帧间距」的**乘数**，不是绝对比例。
        const zoom = distance / previousDistance;
        setScale((prev) => Math.min(5, Math.max(1, prev * zoom)));
      }
      if (previousCentroid !== null) {
        // Kotlin L163-164：`offX.snapTo((offX.value + pan.x).coerceIn(-max, max))`
        // pan 是质心在本帧的位移量，与缩放无关。
        const dx = centroid.x - previousCentroid.x;
        const dy = centroid.y - previousCentroid.y;
        const maxX = maxOffsetFor(fit.right - fit.left, scale, stageW);
        const maxY = maxOffsetFor(fit.bottom - fit.top, scale, stageH);
        setOffX((prev) => Math.min(maxX, Math.max(-maxX, prev + dx)));
        setOffY((prev) => Math.min(maxY, Math.max(-maxY, prev + dy)));
      }
      return;
    }

    // 单指/无指针路径不参与捏合，清掉基线。
    resetPinchBaseline();

    // ── 触控板捏合（ctrl+wheel）→ zoom ──
    if (event.ctrlKey) {
      const zoom = 1 + -0.01 * event.movementY;
      setScale((prev) => Math.min(5, Math.max(1, prev * zoom)));
      return;
    }

    // ── 单指 → pan ──
    const maxX = maxOffsetFor(fit.right - fit.left, scale, stageW);
    const maxY = maxOffsetFor(fit.bottom - fit.top, scale, stageH);
    setOffX((prev) => Math.min(maxX, Math.max(-maxX, prev + event.movementX)));
    setOffY((prev) => Math.min(maxY, Math.max(-maxY, prev + event.movementY)));
  };

  const onStagePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    activePointers.current.delete(event.pointerId);
    const pts = [...activePointers.current.values()];
    // 抬起一根手指后重算基线：从 2 指回到 1 指时，若沿用旧间距会算出一次
    // 巨大的假 zoom（间距从 d 瞬间跳到「与单指的距离」）。
    if (pts.length >= 2) {
      lastPinchDistance.current = pinchDistance(pts);
      lastCentroid.current = pinchCentroid(pts);
    } else {
      resetPinchBaseline();
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  /* Kotlin 220-233：旋转 IconButton —— `(rotation + 90f) % 360f` + 三个 animateTo */
  const onRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
    // Kotlin L220-226：三个 `animateTo(1f / 0f, GodMotion.springMain())` —— 只有
    // **旋转复位**走弹簧，拖动/捏合是 `snapTo`（瞬时，L162-164）。
    setAnimating(true);
    setScale(1);
    setOffX(0);
    setOffY(0);
  }, []);

  // 弹簧回正结束后关掉过渡，否则下一次拖动会被 420ms 的弹簧曲线拖慢（安卓不会）。
  useEffect(() => {
    if (!animating) return;
    const timer = window.setTimeout(() => setAnimating(false), GOD_SPRING_MAIN_MS);
    return () => window.clearTimeout(timer);
  }, [animating]);

  /* Kotlin 249-288：完成时的坐标换算 */
  const handleConfirm = useCallback(() => {
    const r = rect;
    if (fit === null || r === null || stageW <= 0 || stageH <= 0) {
      // Kotlin 253-261：兜底 —— 只有视图变换，没有裁剪矩形
      onConfirm({
        scale,
        offsetX: offX,
        offsetY: offY,
        rotationDeg: rotation,
        cropL: 0,
        cropT: 0,
        cropR: 1,
        cropB: 1,
      });
      return;
    }
    const cx = stageW / 2;
    const cy = stageH / 2;
    const s = Math.max(scale, 0.0001);
    const fitW = fit.right - fit.left;
    const fitH = fit.bottom - fit.top;
    onConfirm({
      scale,
      offsetX: offX,
      offsetY: offY,
      rotationDeg: rotation,
      cropL: stageNormToImageNorm(r.left, stageW, cx, offX, s, fit.left, fitW),
      cropT: stageNormToImageNorm(r.top, stageH, cy, offY, s, fit.top, fitH),
      cropR: stageNormToImageNorm(r.right, stageW, cx, offX, s, fit.left, fitW),
      cropB: stageNormToImageNorm(r.bottom, stageH, cy, offY, s, fit.top, fitH),
    });
  }, [fit, offX, offY, onConfirm, rect, rotation, scale, stageH, stageW]);

  /* Kotlin 110 / 162：返回键拦截 —— Esc 关闭窗口而不是把整个路由弹掉 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handles = rect !== null ? cropHandleSpecs(rect) : [];

  const imageStyle: CSSProperties = {
    // ⚠️ 顺序要紧：Compose `graphicsLayer` 的矩阵是
    //    translate(-pivot) → rotate → translate(pivot) → scale → **translate(offX, offY)**
    //    （`GraphicsLayer.kt` 的 `layerBlock`），也就是平移是**最后**一层、
    //    以舞台坐标计量、不被 scale 吃掉、也不随 rotation 换轴。
    //    CSS 是右结合：`translate() rotate() scale()` 才等价；
    //    写成 `rotate() scale() translate()`（此前）会让平移量被缩放/旋转，
    //    与 L268 `p0 = cx + (p - cx - offX) / s` 的反算对不上。
    transform: `translate(${offX}px, ${offY}px) rotate(${rotation}deg) scale(${scale})`,
    transformOrigin: 'center',
    // ⚠️ 弹簧只用在**旋转复位**（Kotlin L222-226）；拖动 / 捏合是 `snapTo`（瞬时）。
    // 此前 transition 是常开的，拖动整张图会被 380ms 曲线拖慢，与安卓手感不同。
    transition: animating ? `transform ${GOD_SPRING_MAIN_CSS}` : undefined,
  };

  return (
    <div
      className={['gocc-root', props.className ?? ''].filter(Boolean).join(' ')}
      role="dialog"
      aria-modal="true"
      aria-label="裁剪封面"
    >
      {props.source === null ? (
        // Kotlin 142-149：未就绪 / 加载失败
        <div className="gocc-empty">
          <span>封面加载失败，请返回重试</span>
        </div>
      ) : (
        // Kotlin 151-198：舞台 Box（padding top 56 / bottom 84 / start 12 / end 12）
        <div className="gocc-stage-wrap">
          <div
            className="gocc-stage"
            ref={stageRef}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerCancel={onStagePointerUp}
            role="application"
            aria-label="图片缩放与平移"
          >
            {/* Kotlin 170-182：Image(ContentScale.Fit) + graphicsLayer */}
            {props.sourceUrl !== null ? (
              <img
                className="gocc-image"
                src={props.sourceUrl}
                alt=""
                draggable={false}
                style={imageStyle}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  const w = img.naturalWidth;
                  const h = img.naturalHeight;
                  if (w > 0 && h > 0) {
                    setNatural((prev) =>
                      prev !== null && prev.w === w && prev.h === h ? prev : { w, h },
                    );
                  }
                }}
              />
            ) : null}
            {/* Kotlin 184-186：覆盖层必须在**舞台内部**（rect 是舞台归一化坐标） */}
            <canvas className="gocc-canvas" ref={canvasRef} />
            {/* Kotlin 368-430：8 个手柄 */}
            {handles.map((spec) => (
              <CropHandle
                key={spec.kind}
                spec={spec}
                stageW={stageW}
                stageH={stageH}
                rect={rect}
                normBounds={normBounds}
                onRectChange={setUserRect}
                onDragStateChange={setDragging}
              />
            ))}
          </div>
        </div>
      )}

      {/* 顶栏（Kotlin L201-234） */}
      <div className="gocc-topbar">
        <button type="button" className="gocc-icon-btn" onClick={onCancel} aria-label="取消">
          ✕
        </button>
        <span className="gocc-title">裁剪封面</span>
        <button type="button" className="gocc-icon-btn" onClick={onRotate} aria-label="旋转 90°">
          ↻
        </button>
      </div>

      {/* 底栏（Kotlin L236-293） */}
      <div className="gocc-bottombar">
        <button type="button" className="gocc-text-btn" onClick={onCancel}>
          取消
        </button>
        <button type="button" className="gocc-text-btn gocc-text-btn--primary" onClick={handleConfirm}>
          完成
        </button>
      </div>
    </div>
  );
}

/* ── 手柄（Kotlin L369-430） ── */

function CropHandle(props: {
  spec: GodCropHandleSpec;
  stageW: number;
  stageH: number;
  /**
   * Kotlin 320：`val currentRect by rememberUpdatedState(rect)` ——
   * pointerInput 会把 lambda 冻结（key 只有 `spec.kind`），直接捕获 `rect`
   * 会让第二次拖动从第一次组合的框算起、弹回原位。本组件每次 pointermove
   * 都从 props 读最新值（props 每次渲染都是新闭包），语义等价。
   */
  rect: Rect | null;
  normBounds: Rect;
  onRectChange: (next: Rect) => void;
  onDragStateChange: (dragging: boolean) => void;
}) {
  const draggingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    lastRef.current = { x: event.clientX, y: event.clientY };
    props.onDragStateChange(true); // Kotlin 380：onDragStart → showGrid = true
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    const cur = props.rect;
    if (props.stageW <= 0 || props.stageH <= 0 || cur === null) return;
    const dx = (event.clientX - lastRef.current.x) / props.stageW;
    const dy = (event.clientY - lastRef.current.y) / props.stageH;
    lastRef.current = { x: event.clientX, y: event.clientY };
    props.onRectChange(
      clampRectToNorm(applyHandleDrag(cur, props.spec.kind, dx, dy), props.normBounds),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    props.onDragStateChange(false); // Kotlin 381-382：onDragEnd / onDragCancel
  };

  // Kotlin 370: `isCorner = spec.kind <= 3`
  const isCorner = props.spec.kind <= 3;
  return (
    <div
      className="gocc-handle"
      style={{
        left: (props.spec.x * props.stageW - GOD_CROP_TOUCH_PX / 2).toFixed(1),
        top: (props.spec.y * props.stageH - GOD_CROP_TOUCH_PX / 2).toFixed(1),
        width: GOD_CROP_TOUCH_PX,
        height: GOD_CROP_TOUCH_PX,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="presentation"
      data-corner={isCorner ? 'true' : 'false'}
    >
      {/* Kotlin 411-427：角 = 十字线（5 个 strokeWidth 2.5px 的 line），
          边 = 小圆角方块（0.40 起点 / 0.20 边长 / 3px 圆角 / white@0.92） */}
      <span
        className={isCorner ? 'gocc-handle__mark gocc-handle__mark--corner' : 'gocc-handle__mark'}
        data-inset={((1 - GOD_CROP_VISUAL_SPAN) / 2).toFixed(4)}
      />
    </div>
  );
}

/** 默认裁剪（Kotlin `CropParams.DEFAULT`，GodMomentModels.kt L140）。 */
export const GOD_CROP_DEFAULT: CropParams = DEFAULT_CROP_PARAMS;
