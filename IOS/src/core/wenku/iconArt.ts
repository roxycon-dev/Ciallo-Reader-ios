/**
 * 手绘纸张图标的几何层 —— `ui/wenku/WenkuIconArt.kt`（1457 行）的 TS 骨架移植。
 *
 * Kotlin 该文件分三块：
 *   ① 89 项 `enum class WenkuSymbol(label, group)`（L22-112）
 *   ② 姿态 / 描边 / 手势 / 三时钟（L113-229，纯数学）
 *   ③ 每个符号的逐笔几何（L235-1457，数据）
 *
 * Web 侧 ③ 的等价数据表在 `src/ui/components/wenku/WenkuIcon.tsx` 的 `WENKU_ICON_ART`
 * （逐符号 `WenkuIconStroke[]`）。本文件负责 ① 与 ②，并提供 `foldDrawing()`：
 * 把「姿态 + 手势」折叠成一组已烘焙描边 —— 与 Kotlin `WenkuIconArt.strokes(...)` 同签名语义，
 * 只是图形数据由调用方注入（`src/core/**` 不引 UI）。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L22-112  `enum class WenkuSymbol(label, group)`（89 项）        → `WENKU_SYMBOL_TABLE`
 *   L118-134 `data class WenkuIconGesture(lead, follow, trail)` + `plus(other, weight)`
 *            （夹取 `[-0.3, 1.2]`）+ `Rest`                        → `WenkuIconGesture` / `plusGesture`
 *   L140-144 `data class WenkuIconPose(symbol, variant = 0, active = 0)` → `WenkuIconPose`
 *   L147-152 `data class WenkuIconStroke(path, fill, opacity, width)` → `WenkuIconStroke`
 *   L159-195 `object WenkuIconMotion`：DURATION_MS 640 / MORPH_MS 380 /
 *            `stateCurve = Cubic(.18, 1.28, .32, 1)` / `easeInOutCubic = Cubic(.645, .045, .355, 1)` /
 *            `stateAt(phase)` / `frame(phase)`（lead=spring(p)、follow=spring((p-.055)/.945)、
 *            trail=spring((p-.11)/.89)）/ `spring` 关键帧
 *            times [0, .10, .36, .64, .82, 1] / values [0, -.12, 1, -.20, .065, 0]
 *   L201-229 `object WenkuIconPoses`：13 个变体折叠 + `lerp(a, b, t)` → `WenkuIconPoses`
 *   L235-241 `object WenkuIconArt { strokes(pose, contact, gesture) }` → `WenkuIconArt.strokes`
 *   L248-280 `class WenkuMat`（2D 仿射）                            → `WenkuMat`（`iconMotion.ts`）
 *   L285-300 `class WenkuTrace`（写入即时套矩阵）                    → `WenkuTrace`（`iconMotion.ts`）
 */
import { cubicBezier } from './motion';
import { WenkuMat, WenkuTrace, pressGesture } from './iconMotion';

/** L22-112 的 89 项：`symbol → [label, group]`（顺序即枚举序数）。 */
export const WENKU_SYMBOL_TABLE: ReadonlyArray<
  readonly [string, string, string]
> = [
  ['Discover', '发现', '导航'],
  ['Shelf', '书架', '导航'],
  ['Book', '阅读', '导航'],
  ['Folder', '本地书库', '导航'],
  ['FolderOpen', '打开文件夹', '导航'],
  ['Profile', '我的', '导航'],
  ['Back', '返回', '导航'],
  ['Forward', '前进', '导航'],
  ['Up', '收起', '导航'],
  ['Down', '展开', '导航'],
  ['ArrowLeft', '上一项', '导航'],
  ['ArrowRight', '下一项', '导航'],
  ['ArrowUp', '向上', '导航'],
  ['ArrowDown', '向下', '导航'],
  ['External', '打开链接', '导航'],
  ['Close', '关闭', '导航'],
  ['More', '更多', '导航'],
  ['Contents', '目录', '阅读'],
  ['Bookmark', '书签', '阅读'],
  ['Bookmarked', '已收藏', '阅读'],
  ['Location', '定位章节', '阅读'],
  ['LocationFilled', '跟随朗读', '阅读'],
  ['Typography', '字体', '阅读'],
  ['Sliders', '阅读设置', '阅读'],
  ['Image', '插图', '阅读'],
  ['Brightness', '亮度', '阅读'],
  ['Moon', '夜间阅读', '阅读'],
  ['Layers', '合并卷', '阅读'],
  ['Quotes', '摘录', '阅读'],
  ['Language', '双语', '阅读'],
  ['Portrait', '强制竖屏', '阅读'],
  ['Headphones', '听书', '听书'],
  ['Play', '播放', '听书'],
  ['Pause', '暂停', '听书'],
  ['Stop', '停止', '听书'],
  ['Previous', '上一段', '听书'],
  ['Next', '下一段', '听书'],
  ['Waveform', '声音', '听书'],
  ['Voice', '音色', '听书'],
  ['Volume', '音量', '听书'],
  ['Speed', '速度', '听书'],
  ['Timer', '历史与定时', '听书'],
  ['Search', '搜索', '操作'],
  ['Filter', '筛选排序', '操作'],
  ['Layout', '视图布局', '操作'],
  ['Grid', '网格视图', '操作'],
  ['DotsGrid', '布局', '操作'],
  ['Add', '添加', '操作'],
  ['AddCircle', '添加项目', '操作'],
  ['RemoveCircle', '移出', '操作'],
  ['Check', '完成', '操作'],
  ['CheckCircle', '勾选', '操作'],
  ['Selected', '已选择', '操作'],
  ['Circle', '未选择', '操作'],
  ['Edit', '编辑', '操作'],
  ['Delete', '删除', '操作'],
  ['Copy', '复制', '操作'],
  ['Share', '分享', '操作'],
  ['Link', '关联原文件', '操作'],
  ['Refresh', '刷新重试', '操作'],
  ['Sync', '同步', '文件'],
  ['Download', '下载', '文件'],
  ['CloudDownload', '离线缓存', '文件'],
  ['Upload', '更新', '文件'],
  ['ImportFile', '导入', '文件'],
  ['Document', '文档', '文件'],
  ['FolderAdd', '添加目录', '文件'],
  ['Wand', '整理修复', '文件'],
  ['Settings', '设置', '系统'],
  ['Info', '关于', '系统'],
  ['Warning', '异常', '系统'],
  ['Wifi', '无线连接', '系统'],
  ['WifiOff', '离线', '系统'],
  ['WifiWarning', '连接异常', '系统'],
  ['Cloud', '云书库', '系统'],
  ['Globe', '官网', '系统'],
  ['Phone', '手机', '系统'],
  ['Laptop', '电脑', '系统'],
  ['Branch', '同步冲突', '系统'],
  ['PersonAdd', '注册账号', '系统'],
  ['Eye', '显示', '系统'],
  ['EyeOff', '隐藏', '系统'],
  ['CloseCircle', '清空', '系统'],
  ['Battery', '电量', '系统'],
  ['Charging', '充电', '系统'],
  ['Tools', '故障排查', '系统'],
  ['Shield', '安全', '系统'],
  ['Help', '帮助', '系统'],
  ['Touch', '触摸', '阅读'],
];

/** L113-134 `WenkuIconGesture`。 */
export interface WenkuIconGestureShape {
  readonly lead: number;
  readonly follow: number;
  readonly trail: number;
}

/** L130-133 `WenkuIconGesture.Rest`。 */
export const WENKU_ICON_GESTURE_SHAPE_REST: WenkuIconGestureShape = { lead: 0, follow: 0, trail: 0 };

/** L123-128 `plus(other, weight)`：夹取区间 `[-0.3, 1.2]`（与 Dart 端一致）。 */
export function plusIconGesture(
  a: WenkuIconGestureShape,
  b: WenkuIconGestureShape,
  weight: number,
): WenkuIconGestureShape {
  const clamp = (v: number): number => Math.min(Math.max(v, -0.3), 1.2);
  return {
    lead: clamp(a.lead + b.lead * weight),
    follow: clamp(a.follow + b.follow * weight),
    trail: clamp(a.trail + b.trail * weight),
  };
}

/** L140-144 `WenkuIconPose`。 */
export interface WenkuIconPose {
  readonly symbol: string;
  readonly variant: number;
  readonly active: number;
}

/** L147-152 `WenkuIconStroke`（`path` 是 SVG `d` 字符串）。 */
export interface WenkuIconStroke {
  readonly path: string;
  readonly fill: boolean;
  readonly opacity: number;
  readonly width: number;
}

/** L159-195 `object WenkuIconMotion`。 */
const STATE_CURVE = cubicBezier(0.18, 1.28, 0.32, 1);
const EASE_IN_OUT_CUBIC = cubicBezier(0.645, 0.045, 0.355, 1);
const SPRING_TIMES: readonly number[] = [0, 0.1, 0.36, 0.64, 0.82, 1];
const SPRING_VALUES: readonly number[] = [0, -0.12, 1, -0.2, 0.065, 0];

/** L181-191 `spring(t)`：关键帧 + `easeInOutCubic` 段内插值。 */
function spring(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  for (let i = 1; i < SPRING_TIMES.length; i += 1) {
    const upper = SPRING_TIMES[i] ?? 1;
    if (t <= upper) {
      const lower = SPRING_TIMES[i - 1] ?? 0;
      const x = (t - lower) / (upper - lower);
      const eased = EASE_IN_OUT_CUBIC(x);
      const v0 = SPRING_VALUES[i - 1] ?? 0;
      const v1 = SPRING_VALUES[i] ?? 0;
      return v0 + (v1 - v0) * eased;
    }
  }
  return 0;
}

export const WenkuIconMotion = {
  /** L160 `DURATION_MS = 640`。 */
  DURATION_MS: 640,
  /** L161 `MORPH_MS = 380`。 */
  MORPH_MS: 380,
  /** L164 `stateCurve`。 */
  stateCurve: STATE_CURVE,
  /** L170-172 `stateAt(phase)`。 */
  stateAt(phase: number): number {
    return STATE_CURVE(Math.min(Math.max((phase * 640) / 380, 0), 1));
  },
  /** L175-179 `frame(phase)`：三段延迟 0 / .055 / .11。 */
  frame(phase: number): WenkuIconGestureShape {
    return {
      lead: spring(phase),
      follow: spring(Math.min(Math.max((phase - 0.055) / 0.945, 0), 1)),
      trail: spring(Math.min(Math.max((phase - 0.11) / 0.89, 0), 1)),
    };
  },
  /** L181 `spring(t)`（导出以便逐点对拍）。 */
  spring,
} as const;

/** L201-229 `object WenkuIconPoses`。 */
export const WenkuIconPoses = {
  /** L202-222 `of(symbol, active)`：13 个变体折叠成族符号 + 变体角。 */
  of(symbol: string, active: boolean): WenkuIconPose {
    const PI = Math.PI;
    let family = symbol;
    let variant = 0;
    switch (symbol) {
      case 'Pause':
        family = 'Play';
        variant = 1;
        break;
      case 'Back':
        family = 'Forward';
        variant = PI;
        break;
      case 'Up':
        family = 'Forward';
        variant = -PI / 2;
        break;
      case 'Down':
        family = 'Forward';
        variant = PI / 2;
        break;
      case 'ArrowLeft':
        family = 'ArrowRight';
        variant = PI;
        break;
      case 'ArrowUp':
        family = 'ArrowRight';
        variant = -PI / 2;
        break;
      case 'ArrowDown':
        family = 'ArrowRight';
        variant = PI / 2;
        break;
      case 'External':
        family = 'ArrowRight';
        variant = -PI / 4;
        break;
      case 'Bookmarked':
        family = 'Bookmark';
        variant = 1;
        break;
      case 'EyeOff':
        family = 'Eye';
        variant = 1;
        break;
      case 'CheckCircle':
        family = 'Circle';
        variant = 1;
        break;
      case 'Selected':
        family = 'Circle';
        variant = 2;
        break;
      case 'LocationFilled':
        family = 'Location';
        variant = 1;
        break;
      default:
        family = symbol;
        variant = 0;
        break;
    }
    return { symbol: family, variant, active: active ? 1 : 0 };
  },

  /** L224-228 `lerp(a, b, t)`：`t < .5` 时保留 a 的符号，否则切到 b。 */
  lerp(a: WenkuIconPose, b: WenkuIconPose, t: number): WenkuIconPose {
    const symbol = t < 0.5 && a.symbol !== b.symbol ? a.symbol : b.symbol;
    return {
      symbol,
      variant: a.symbol === b.symbol ? a.variant + (b.variant - a.variant) * t : b.variant,
      active: a.active + (b.active - a.active) * t,
    };
  },
} as const;

/** 图形数据表形状：`symbol → 描边数组`（由 `WenkuIcon.tsx` 的 `WENKU_ICON_ART` 提供）。 */
export type WenkuIconArtTable = Readonly<
  Record<string, ReadonlyArray<{ readonly path: string; readonly fill?: boolean; readonly width?: number }>>
>;

export interface FoldDrawingInput {
  readonly pose: WenkuIconPose;
  /** L239 `contact: Float = 0f`。 */
  readonly contact?: number;
  /** L239 `gesture: WenkuIconGesture = WenkuIconGesture(contact, contact, contact)`。 */
  readonly gesture?: WenkuIconGestureShape;
  readonly art: WenkuIconArtTable;
  /** 是否 RTL（`Back` / `Forward` 水平镜像）。 */
  readonly rtl?: boolean;
}

/**
 * L235-241 `WenkuIconArt.strokes(pose, contact, gesture)` → `foldDrawing(pose, gesture)`。
 *
 * 折叠规则：
 *  1. 取族符号的描边表；
 *  2. `variant` 非 0 时绕 12,12 旋转（单位 = 弧度）；
 *  3. `gesture` 的三段位移把纸片沿 x 推开（lead / follow / trail 各 `*.6` 个单位）；
 *  4. `active` 追加的几何由数据表里的 `active` 变体承担（TS 侧用 `wenkuIconPosesOf`）。
 */
export function foldDrawing(input: FoldDrawingInput): readonly WenkuIconStroke[] {
  const contact = input.contact ?? 0;
  const press = pressGesture(contact);
  const gesture = input.gesture ?? press;
  const art = input.art[input.pose.symbol] ?? [];
  const mirrored = input.rtl === true && (input.pose.symbol === 'Back' || input.pose.symbol === 'Forward');

  // 变换栈：T(12,12) · Rz(variant) · T(-12,-12)（`WenkuIcon.kt` L126-140 的落屏顺序）。
  let matrix = new WenkuMat();
  if (input.pose.variant !== 0) {
    matrix = WenkuMat.translate(12, 12)
      .times(WenkuMat.rotate(input.pose.variant))
      .times(WenkuMat.translate(-12, -12));
  }
  if (mirrored) {
    matrix = WenkuMat.translate(12, 0).times(WenkuMat.scale(-1)).times(WenkuMat.translate(-12, 0)).times(matrix);
  }
  // 手势位移（lead/follow/trail 各偏移 .6 单位，方向沿 x；与 Dart `_Trace` 同量级）。
  const shift = (gesture.lead + gesture.follow + gesture.trail) * 0.6;
  if (shift !== 0) matrix = WenkuMat.translate(shift, 0).times(matrix);

  return art.map((stroke) => ({
    path: transformPathData(stroke.path, matrix),
    fill: stroke.fill === true,
    opacity: 1,
    width: stroke.width ?? 1,
  }));
}

/**
 * 把 SVG path `d` 里的每一条命令按矩阵重写（只处理 `M/L/Q/C/Z`，与 `WenkuTrace` 的子集一致）。
 * 矩阵为单位阵时原样返回，避免无谓的字符串重建。
 */
export function transformPathData(d: string, matrix: WenkuMat): string {
  if (matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 && matrix.e === 0 && matrix.f === 0) {
    return d;
  }
  const tokens = d.match(/[MLQCZmlqcz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  const pt = (x: number, y: number): string =>
    `${fmt(matrix.x(x, y))} ${fmt(matrix.y(x, y))}`;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    switch (cmd) {
      case 'M':
      case 'L':
        out.push(`${cmd}${pt(num(), num())}`);
        break;
      case 'Q':
        out.push(`Q${pt(num(), num())} ${pt(num(), num())}`);
        break;
      case 'C':
        out.push(`C${pt(num(), num())} ${pt(num(), num())} ${pt(num(), num())}`);
        break;
      case 'Z':
      case 'z':
        out.push('Z');
        break;
      default:
        // 未支持的命令原样透传（保持数据可读，不静默丢图）。
        out.push(String(cmd));
        break;
    }
  }
  return out.join(' ');
}

function fmt(v: number): string {
  return String(Number(v.toFixed(3)));
}

/** L285 `WenkuTrace` 的重导出（供 UI 层按 Kotlin 名构造路径）。 */
export { WenkuMat, WenkuTrace };

/* ═══════════════════════════════════════════════════════════════════════════════
 * `WenkuArtBuilder`（`WenkuIconArt.kt` L329+ 的 `_Art` 变换栈 + `_Trace` DSL）
 * 与绘制入口 `drawWenkuStrokes` / `drawWenkuCrossfade`（`WenkuIcon.kt` L154-207）
 * ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * L329 `WenkuArtBuilder`：逐符号几何用到的链式 API。
 *
 * Kotlin：
 * ```
 * WenkuArtBuilder().translate(x, y).rotate(rad).scale(s)
 *     .moveTo(..).lineTo(..).quadTo(..).cubicTo(..).close()
 *     .stroke(width = .9f, fill = false)
 * ```
 * Web 侧产出 `WenkuIconStroke`（`path` 为 SVG `d`），语义一一对应。
 */
export class WenkuArtBuilder {
  private matrix: WenkuMat = new WenkuMat();
  private readonly strokes: WenkuIconStroke[] = [];
  private current: WenkuTrace | null = null;

  /** `_Art.translate(x, y)`。 */
  translate(x: number, y: number): this {
    this.matrix = this.matrix.times(WenkuMat.translate(x, y));
    return this;
  }

  /** `_Art.rotate(radians)`。 */
  rotate(radians: number): this {
    this.matrix = this.matrix.times(WenkuMat.rotate(radians));
    return this;
  }

  /** `_Art.scale(s)`。 */
  scale(s: number): this {
    this.matrix = this.matrix.times(WenkuMat.scale(s));
    return this;
  }

  private trace(): WenkuTrace {
    if (this.current === null) this.current = new WenkuTrace(this.matrix);
    return this.current;
  }

  moveTo(x: number, y: number): this {
    this.trace().m(x, y);
    return this;
  }

  lineTo(x: number, y: number): this {
    this.trace().l(x, y);
    return this;
  }

  quadTo(x1: number, y1: number, x: number, y: number): this {
    this.trace().q(x1, y1, x, y);
    return this;
  }

  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.trace().c(x1, y1, x2, y2, x, y);
    return this;
  }

  close(): this {
    this.trace().z();
    return this;
  }

  /** `_Trace.xy(x, y)`：单点（用于极短线段）。 */
  xy(x: number, y: number): this {
    return this.moveTo(x, y);
  }

  /** `_Art.stroke(width, fill, opacity)`：收束当前路径为一条描边。 */
  stroke(width = 1, fill = false, opacity = 1): this {
    if (this.current !== null) {
      const d = this.current.toPathData();
      if (d !== '') this.strokes.push({ path: d, fill, opacity, width });
      this.current = null;
    }
    return this;
  }

  /** 收束并返回全部描边（`WenkuIconArt.strokes` 的产物）。 */
  build(): readonly WenkuIconStroke[] {
    this.stroke();
    return this.strokes;
  }
}

/**
 * `WenkuIcon.kt` L171-207 `drawWenkuStrokes(...)`：
 * 把一组描边按 `1.72 / 1.9 / 2.05` 的线宽系数与 opacity 烘焙成可渲染列表。
 *
 * Kotlin 直接画到 Canvas；Web 返回带 `strokeWidth` 的列表，由 `<path>` 渲染。
 */
export function drawWenkuStrokes(
  strokes: readonly WenkuIconStroke[],
  options: { readonly contrast: boolean; readonly sizeDp: number; readonly alpha?: number },
): readonly WenkuIconStroke[] {
  // L116-120 `baseStrokeWidth(contrast, sizeDp)`。
  const base = options.contrast ? 2.05 : options.sizeDp < 18 ? 1.9 : 1.72;
  const alpha = options.alpha ?? 1;
  return strokes.map((s) => ({ ...s, width: s.width * base, opacity: s.opacity * alpha }));
}

/**
 * `WenkuIcon.kt` L154-170 `drawWenkuCrossfade(from, to, change, …)`：
 * morph 期间两组描边同时存在，`from` 的 alpha = `1 - t`、`to` 的 alpha = `t`。
 * Kotlin 用两次 `drawPath(alpha = …)`；Web 直接合成两组描边。
 */
export function drawWenkuCrossfade(
  from: readonly WenkuIconStroke[],
  to: readonly WenkuIconStroke[],
  change: number,
): readonly WenkuIconStroke[] {
  const t = Math.min(Math.max(change, 0), 1);
  if (t >= 1) return to;
  if (t <= 0) return from;
  return [
    ...from.map((s) => ({ ...s, opacity: s.opacity * (1 - t) })),
    ...to.map((s) => ({ ...s, opacity: s.opacity * t })),
  ];
}
