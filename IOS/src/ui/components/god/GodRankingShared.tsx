/**
 * Ported line-by-line from Android:
 *  - god/GodRankingShared.kt   (GodTilt / GodCoverImage / GodCoverPlaceholder /
 *                                GodItemMenu / GodEmptyState / GodRankStamp)
 *  - god/GodMotion.kt          (GodGold palette, godIsDark)
 *  - god/GodStarRating.kt      (GodStarsReadonly + starPath, L270-319)
 *  - god/GodRankingStyles.kt   (GodItemCard gesture + GodRankingInteractions)
 *
 * Android source (read-only): novel-reader/app/src/main/java/com/example/god/
 *
 * Adaptations (documented, behavior preserved):
 *  - Rotation-vector sensor → DeviceOrientationEvent (gamma = roll = tilt.x;
 *    iOS Safari additionally requires requestPermission() from a user gesture,
 *    exposed as requestGodTiltPermission()).
 *  - detectDragGestures: only horizontal drags are consumed (vertical belongs
 *    to the page scroller — Compose's ancestor-first dispatch gives LazyColumn
 *    the vertical drag in the same situation).
 *  - HapticsGate / performHapticFeedback → no web equivalent (skipped).
 *  - Coil AsyncImage → <img> with cache-busting key `${path}_${updatedAt}`.
 *
 * Fixes in this line-by-line review pass:
 *  - `GodItemCard` drag tilt (GodRankingStyles.kt L247-253): Kotlin's `drag` is the
 *    **per-event delta** handed to `detectDragGestures`, not the cumulative distance
 *    from pointerdown. The port used `clientX - start.x`, so holding still pinned the
 *    card at max tilt. Now `clientX - last.x`.
 *  - `GodStarsReadonly` track colour (GodStarRating.kt L295
 *    `onSurface.copy(alpha = 0.16f)`): `onSurface` flips with the theme, so the
 *    hardcoded light-theme ink made the unlit star track invisible in dark mode.
 *  - `GodItemCard` (GodRankingStyles.kt L275 `onLongClickLabel = "编辑或删除神回"`):
 *    added the missing `aria-description`.
 *  - GodCoverPlaceholder: Kotlin L148-155 paints
 *    `surfaceVariant@if(dark) 0.55 else 0.85 → surfaceVariant(opaque)`; the CSS
 *    had the light stop hard-coded, so the placeholder stayed too bright in dark
 *    mode. Now driven by `godIsDark()`.
 *  - GodEmptyState: Kotlin L256 `onSurface.copy(alpha = 0.55f)` follows the theme
 *    (light ink on dark); it was pinned to the light-theme #18191c.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { effectiveGodTitle, type GodMoment } from '@core/god/godTypes';
import '../../../styles/god.css';

/* ══════════════ 神回配色：金 / 琥珀（GodMotion.kt L88-132） ══════════════ */

export const GOD_GOLD = {
  // 金
  lightStart: '#FFE29A',
  lightMid: '#F5B942',
  lightEnd: '#D98E1F',
  darkStart: '#E0CB96',
  darkMid: '#C79A3E',
  darkEnd: '#9A7223',
  // 银
  silverLightStart: '#F1F3F8',
  silverLightEnd: '#AEB6C4',
  silverDarkStart: '#C6CAD3',
  silverDarkEnd: '#868D9A',
  // 铜
  bronzeLightStart: '#F6CDA8',
  bronzeLightEnd: '#C47F4E',
  bronzeDarkStart: '#D4B295',
  bronzeDarkEnd: '#96613C',
} as const;

/** GodGold.goldGradient(darkTheme) — 主强调渐变（横向）. */
export function godGoldGradient(dark: boolean): [string, string, string] {
  return dark
    ? [GOD_GOLD.darkStart, GOD_GOLD.darkMid, GOD_GOLD.darkEnd]
    : [GOD_GOLD.lightStart, GOD_GOLD.lightMid, GOD_GOLD.lightEnd];
}

/** Compose Color.luminance()（WCAG 相对亮度，线性化 sRGB）. */
function parseLuminance(cssColor: string): number {
  const match = /rgba?\(([^)]+)\)/.exec(cssColor);
  if (match === null) return 1;
  const parts = (match[1] ?? '').split(/[\s,/]+/).filter((part) => part !== '');
  const r = Number.parseFloat(parts[0] ?? '255') / 255;
  const g = Number.parseFloat(parts[1] ?? '255') / 255;
  const b = Number.parseFloat(parts[2] ?? '255') / 255;
  const lin = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * godIsDark() — GodMotion.kt L142-143:
 * `MaterialTheme.colorScheme.background.luminance() < 0.4f`
 * ⚠️ 不能用系统暗色：按 App 自己的背景真实亮度判定（GodMotion.kt L136-141 注释）。
 */
export function godIsDark(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const appShell = document.querySelector('.app-shell');
    const bg = getComputedStyle(appShell ?? document.body).backgroundColor;
    return parseLuminance(bg) < 0.4;
  } catch {
    return false;
  }
}

/** Kotlin Float.toString() — rating 展示（0.5 步长恒为 1 位小数，如 "5.0"）. */
export function godRatingText(rating: number): string {
  return rating.toFixed(1);
}

/** GodMomentEntity.effectiveTitle() 的补位（Kotlin padStart("0")）. */
export function godRankStamp2(rank: number): string {
  return rank.toString().padStart(2, '0');
}

/* ══════════════ 陀螺仪视差（GodRankingShared.kt L49-106） ══════════════ */

/** 设备是否支持旋转向量传感器（Android hasRotationSensor 等价）. */
export function hasGodRotationSensor(): boolean {
  return typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined';
}

/**
 * iOS Safari：DeviceOrientationEvent.requestPermission() 必须来自用户手势。
 * 由页面的首次 pointerdown 调用一次（Android 侧无此步骤）。
 */
export async function requestGodTiltPermission(): Promise<void> {
  const doe = window.DeviceOrientationEvent as unknown as
    | { requestPermission?: () => Promise<string> }
    | undefined;
  if (doe !== undefined && typeof doe.requestPermission === 'function') {
    try {
      await doe.requestPermission();
    } catch {
      // 用户拒绝 → 视差静默失效（与 Android 无传感器同表现）
    }
  }
}

/**
 * rememberGodTilt(enabled, maxDeg = 8) — 旋转向量 → 倾斜角。
 * 一阶低通（α=0.15）去掉手抖，夹紧 ±maxDeg（GodRankingShared.kt L88-97）。
 *
 * Android 只在 draw 阶段读取 tilt；web 侧把角度写进根节点的
 * `--god-tilt-x`（每传感器事件只写一次），目标元素用
 * `translateX(calc(var(--god-tilt-x) * var(--god-tilt-factor)))` 自取，
 * 既避开 React ref 的渲染期限制，也不会触发整块排行榜重组。
 */
function useGodTilt(enabled: boolean, maxDeg = 8): void {
  useEffect(() => {
    if (!enabled || !hasGodRotationSensor()) return;
    let lastX = 0;
    const listener = (event: DeviceOrientationEvent): void => {
      const rawX = event.gamma ?? 0; // roll → tilt.x
      lastX += 0.15 * (rawX - lastX);
      const next = Math.min(maxDeg, Math.max(-maxDeg, lastX));
      document.documentElement.style.setProperty('--god-tilt-x', `${next.toFixed(3)}px`);
    };
    window.addEventListener('deviceorientation', listener);
    return () => {
      window.removeEventListener('deviceorientation', listener);
      // 关闭视差 → 归零（Android 侧 asState 不参与绘制）
      document.documentElement.style.setProperty('--god-tilt-x', '0px');
    };
  }, [enabled, maxDeg]);
}

/**
 * 目标元素的视差系数（translationX = tilt.x * factor）。
 * 通过 CSS 自定义属性 `--god-tilt-factor` 传入，元素与手势层分离。
 */
function godTiltFactor(factor: number): CSSProperties {
  return { '--god-tilt-factor': String(factor) } as CSSProperties;
}

/* ══════════════ 封面（GodRankingShared.kt L108-179） ══════════════ */

/** GodCoverPlaceholder — 中性底 + 径向金光 + 1dp 金边 + ✦. */
export function GodCoverPlaceholder() {
  const dark = godIsDark();
  return (
    <div
      className="god-cover-placeholder"
      style={
        {
          // Kotlin L148-155：`base = colorScheme.surfaceVariant`，
          // `Brush.verticalGradient(listOf(base.copy(alpha = if (dark) 0.55f else 0.85f), base))`
          // —— 底部一档永远是**不透明**的 base（不是同 alpha）。
          // E55 深色补漏：base 是随主题翻转的 surfaceVariant（Theme.kt 未覆写
          // 该 M3 角色 → 基线 浅 #E7E0EC / 深 #49454F；端口浅色档以 #E3E5E7
          // 近似），此前只有 α 随 dark 分支、base 色写死浅灰 → 深色下占位块
          // 仍是白灰。CSS 够不着内联 style，按任务书「一行级补丁」在此修。
          backgroundImage: `linear-gradient(180deg, rgba(${
            dark ? '73, 69, 79' : '227, 229, 231'
          }, ${dark ? 0.55 : 0.85}) 0%, ${dark ? '#49454f' : '#e3e5e7'} 100%)`,
        } as CSSProperties
      }
    >
      ✦
    </div>
  );
}

/**
 * GodCoverImage — 占位层 + 图片。
 * 缓存 key 含 updatedAt（memoryCacheKey/diskCacheKey 同款）：
 * 编辑保存后 key 变化，重新解码，不会显示旧封面（L127-133）。
 */
export function GodCoverImage(props: {
  moment: GodMoment;
  className?: string;
  style?: CSSProperties;
}) {
  const path = props.moment.coverPath;
  const hasImage = path !== null && path.trim() !== '';
  return (
    <div
      className={['god-cover', props.className ?? ''].filter(Boolean).join(' ')}
      style={props.style}
    >
      <GodCoverPlaceholder />
      {hasImage ? (
        <img
          key={`${path}_${props.moment.updatedAt}`}
          className="god-cover__img"
          src={path ?? ''}
          alt={effectiveGodTitle(props.moment)}
        />
      ) : null}
    </div>
  );
}

/* ══════════════ 只读星级（GodStarRating.kt L270-319） ══════════════ */

/** 五角星路径（外半径 R，内半径 0.46R，起始角 -90°）。 */
function starPathString(radius: number, cx: number, cy: number): string {
  const inner = radius * 0.46;
  let d = '';
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? radius : inner;
    const angle = -Math.PI / 2 + i * (Math.PI / 5);
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(3)},${y.toFixed(3)} `;
  }
  return `${d}Z`;
}

export function GodStarsReadonly(props: {
  rating: number;
  starSize?: number;
  starGap?: number;
  className?: string;
}) {
  const starSize = props.starSize ?? 14;
  const starGap = props.starGap ?? 2;
  const rawId = useId();
  const gradientId = `god-star-${rawId.replaceAll(':', '')}`;
  // GodGold.goldGradient(dark) + linear(0,0)→(w,h)
  const gold = godGoldGradient(godIsDark());
  // Kotlin L295 `MaterialTheme.colorScheme.onSurface.copy(alpha = 0.16f)`
  // ⚠️ onSurface 随主题翻转 —— 写死浅色底的墨色会让深色模式下的空星轨看不见。
  const track = godIsDark() ? 'rgba(255, 255, 255, 0.16)' : 'rgba(24, 25, 28, 0.16)';

  return (
    <span
      className={['god-stars', props.className ?? ''].filter(Boolean).join(' ')}
      style={{ gap: starGap }}
      role="img"
      aria-label={`评分 ${godRatingText(props.rating)}`}
    >
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            {gold.map((color, index) => (
              <stop key={color} offset={`${index * 50}%`} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
      </svg>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = Math.min(1, Math.max(0, props.rating - (i - 1)));
        const d = starPathString(starSize * 0.5, starSize / 2, starSize / 2);
        return (
          <svg
            key={i}
            className="god-star"
            width={starSize}
            height={starSize}
            viewBox={`0 0 ${starSize} ${starSize}`}
            aria-hidden="true"
          >
            {/* track = onSurface 0.16 */}
            <path d={d} fill={track} />
            {filled > 0 ? (
              <>
                <clipPath id={`${gradientId}-c${i}`}>
                  <rect x="0" y="0" width={starSize * filled} height={starSize} />
                </clipPath>
                <path d={d} fill={`url(#${gradientId})`} clipPath={`url(#${gradientId}-c${i})`} />
              </>
            ) : null}
          </svg>
        );
      })}
    </span>
  );
}

/* ══════════════ 名次圆章（GodRankingShared.kt L309-324） ══════════════ */

export function GodRankStamp(props: { rank: number; className?: string }) {
  return (
    <span className={['god-rank-stamp', props.className ?? ''].filter(Boolean).join(' ')}>
      {props.rank}
    </span>
  );
}

/* ══════════════ 空状态（GodRankingShared.kt L230-307） ══════════════ */

/**
 * 手绘风小插画：一页卷起的漫画 + 三颗小星，轻微浮动。
 * float: -3 → 3, tween(2600, Linear), Reverse；translationY = float * 3f。
 */
export function GodEmptyState(props: {
  message?: string;
  reduceMotion?: boolean;
  className?: string;
}) {
  const message = props.message ?? '还没有神回，读完一话向后滑试试';
  const dark = godIsDark();
  // Kotlin L256：`val ink = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f)`
  // —— onSurface 随主题翻转（深色下是浅色），不能写死成浅色的 #18191c。
  const ink = dark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(24, 25, 28, 0.55)';
  const gold0 = godGoldGradient(dark)[0];

  // Canvas 108 x 84（GodRankingShared.kt L267-298）
  const w = 108;
  const h = 84;
  const pageW = w * 0.56;
  const pageH = h * 0.66;
  const left = (w - pageW) / 2;
  const top = (h - pageH) / 2;
  const stars: Array<[number, number, number]> = [
    [w * 0.16, h * 0.22, 5.5],
    [w * 0.86, h * 0.34, 4.2],
    [w * 0.74, h * 0.78, 6.4],
  ];

  return (
    <div
      className={[
        'god-empty',
        props.reduceMotion === true ? '' : 'god-empty--float',
        props.className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        {/* 一页卷起的纸 */}
        <rect
          x={left}
          y={top}
          width={pageW}
          height={pageH}
          rx="8"
          ry="8"
          fill="none"
          stroke={ink}
          strokeWidth="3.2"
        />
        {/* 卷角 */}
        <line
          x1={left + pageW}
          y1={top + pageH * 0.62}
          x2={left + pageW * 0.74}
          y2={top + pageH}
          stroke={ink}
          strokeWidth="3.2"
        />
        {/* 三颗小星（手绘感：略随机大小） */}
        {stars.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={gold0} />
        ))}
      </svg>
      <span className="god-empty__text">{message}</span>
    </div>
  );
}

/* ══════════════ 长按浮层菜单（GodRankingShared.kt L181-228） ══════════════ */

export function GodItemMenu(props: {
  onEdit: () => void;
  onDelete: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="god-menu"
      role="menu"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <button type="button" className="god-menu__item" role="menuitem" onClick={props.onEdit}>
        编辑
      </button>
      <button
        type="button"
        className="god-menu__item god-menu__item--danger"
        role="menuitem"
        onClick={props.onDelete}
      >
        删除
      </button>
      <button type="button" className="god-menu__item" role="menuitem" onClick={props.onDismiss}>
        取消
      </button>
    </div>
  );
}

/* ══════════════ 对话框（GodRankingStyles.kt L161-206 的 AlertDialog） ══════════════ */

/** Material3 AlertDialog：surface r24、scrim 黑 0.32、TextButton 两侧. */
export function GodDialog(props: {
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  confirmDanger?: boolean;
  onConfirm?: () => void;
  dismissLabel?: string;
  onDismiss: () => void;
  /** 随笔原文窗口：confirmButton = {}（无按钮），正文可滚动 max 400 */
  hideConfirm?: boolean;
}) {
  return (
    <div
      className="god-dialog-overlay"
      onClick={props.onDismiss}
      role="presentation"
    >
      <div
        className="god-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <p className="god-dialog__title">{props.title}</p>
        {props.children !== undefined ? (
          <div className="god-dialog__text">{props.children}</div>
        ) : null}
        <div className="god-dialog__actions">
          {props.dismissLabel !== undefined ? (
            <button type="button" className="god-dialog__btn" onClick={props.onDismiss}>
              {props.dismissLabel}
            </button>
          ) : null}
          {props.hideConfirm !== true ? (
            <button
              type="button"
              className={[
                'god-dialog__btn',
                props.confirmDanger === true ? 'god-dialog__btn--danger' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ══════════════ 交互状态（GodRankingStyles.kt L88-97） ══════════════ */

export interface GodRankingInteractions {
  /** 长按菜单目标 */
  menuFor: GodMoment | null;
  /** 删除确认目标 */
  deleteFor: GodMoment | null;
  /** 随笔原文目标 */
  noteFor: GodMoment | null;
}

export const EMPTY_GOD_INTERACTIONS: GodRankingInteractions = {
  menuFor: null,
  deleteFor: null,
  noteFor: null,
};

/* ══════════════ 条目卡片（GodRankingStyles.kt L210-280） ══════════════ */

const LONG_PRESS_MS = 500; // ViewConfiguration.getLongPressTimeout()
const TOUCH_SLOP_PX = 8; // ViewConfiguration scaledTouchSlop ≈ 8dp
const MAX_TILT_DEG = 10; // maxTilt = 10f
const DRAG_DIV_X = 4; // drag.x / 4.dp
const DRAG_DIV_Y = 6; // drag.y / 6.dp

export function GodItemCard(props: {
  moment: GodMoment;
  reduceMotion: boolean;
  interactions: GodRankingInteractions;
  setInteractions: (next: GodRankingInteractions) => void;
  onItemClick: (moment: GodMoment) => void;
  /** 点击行为的覆盖（唱片架：点旁边的 = 滚到该项，而非跳转） */
  onTap?: (() => void) | undefined;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { moment, reduceMotion } = props;
  const [rotX, setRotX] = useState(0);
  const [rotY, setRotY] = useState(0);
  const [press, setPress] = useState(1);
  const [dragging, setDragging] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const lastRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const horizontalRef = useRef(false);
  const longPressRef = useRef<number | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressRef.current !== null) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  // 卸载清理定时器（Android 侧由 pointerInput 协程取消承担）
  useEffect(() => clearLongPress, [clearLongPress]);

  const settle = useCallback(() => {
    setPress(1);
    setRotX(0);
    setRotY(0);
    setDragging(false);
    horizontalRef.current = false;
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (reduceMotion) return;
    pointerIdRef.current = event.pointerId;
    startRef.current = { x: event.clientX, y: event.clientY };
    lastRef.current = { x: event.clientX, y: event.clientY };
    movedRef.current = false;
    horizontalRef.current = false;
    setDragging(true);
    // onDragStart → press.animateTo(0.97f, springLight)
    setPress(0.97);
    // combinedClickable onLongClick → interactions.menuFor = moment
    clearLongPress();
    longPressRef.current = window.setTimeout(() => {
      longPressRef.current = null;
      if (!movedRef.current) {
        props.setInteractions({ ...props.interactions, menuFor: moment });
        settle();
      }
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId || reduceMotion) return;
    const dxTotal = event.clientX - startRef.current.x;
    const dyTotal = event.clientY - startRef.current.y;
    const dist = Math.hypot(dxTotal, dyTotal);
    if (dist > TOUCH_SLOP_PX) {
      movedRef.current = true;
      clearLongPress(); // 移动超过 slop → 取消长按
    }
    if (!movedRef.current) return;
    if (!horizontalRef.current) {
      // 只消费横向拖拽：纵向让给页面滚动（Compose 祖先优先派发的等价结果）
      if (Math.abs(dxTotal) <= Math.abs(dyTotal)) return;
      horizontalRef.current = true;
    }
    // Kotlin L250-251 的 `drag` 是 `detectDragGestures` 给的**逐事件增量**
    // （`drag.x` = 自上一事件以来的位移），不是从按下点算起的总位移 —— 停手即回正。
    // 此前 TS 传的是总量（`clientX - start.x`），按住不动会一直保持最大倾角。
    const dragX = event.clientX - lastRef.current.x;
    const dragY = event.clientY - lastRef.current.y;
    lastRef.current = { x: event.clientX, y: event.clientY };
    // rotY = drag.x / 4.dp，rotX = -drag.y / 6.dp，各夹紧 ±10°（L247-253）
    // ⚠️ Kotlin L250-251 的 `drag` 是 `detectDragGestures` 给的**逐事件增量**
    // （`drag.x` = 自上一事件以来的位移），不是从按下点算起的总位移 —— 停手即回正。
    // 此前 TS 传的是总量（`clientX - start.x`），按住不动会一直保持最大倾角。
    const nextRotY = Math.min(MAX_TILT_DEG, Math.max(-MAX_TILT_DEG, dragX / DRAG_DIV_X));
    const nextRotX = Math.min(MAX_TILT_DEG, Math.max(-MAX_TILT_DEG, -dragY / DRAG_DIV_Y));
    setRotY(nextRotY);
    setRotX(nextRotX);
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    clearLongPress();
    // onDragEnd/onDragCancel → press/rot 回 1/0（springMain）
    settle();
  };

  const fireTap = (): void => {
    if (movedRef.current) return; // 拖拽后不触发点击
    (props.onTap ?? (() => props.onItemClick(moment)))();
  };

  const onContextMenu = (event: ReactMouseEvent): void => {
    // 长按菜单的桌面端等价（touch 走 onPointerDown 定时器）
    event.preventDefault();
    props.setInteractions({ ...props.interactions, menuFor: moment });
  };

  // graphicsLayer: rotationX/Y + cameraDistance = 16f * density * 100f + scale = press
  // （CSS dp≈px → 16 * 100 = 1600px 等效投影距离）
  const transform = reduceMotion
    ? undefined
    : `perspective(1600px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${press})`;

  return (
    <div
      className={[
        'god-item',
        dragging ? 'god-item--dragging' : 'god-item--settle',
        props.className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ...props.style, transform }}
      onClick={fireTap}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          (props.onTap ?? (() => props.onItemClick(moment)))();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="打开书籍详情"
      // Kotlin GodRankingStyles.kt L275：`onLongClickLabel = "编辑或删除神回"`
      aria-description="编辑或删除神回"
    >
      {props.children}
    </div>
  );
}

/* ══════════════ 神回总数小徽章（GodRankingCard.kt L140-173） ══════════════ */

export function GodCountPill(props: { count: number; className?: string }) {
  const dark = godIsDark();
  const gold = godGoldGradient(dark);
  return (
    <span
      className={['god-count-pill', props.className ?? ''].filter(Boolean).join(' ')}
      style={{
        background: `linear-gradient(90deg, ${gold[0]}, ${gold[1]}, ${gold[2]})`,
        borderColor: `rgba(255, 255, 255, ${dark ? 0.18 : 0.32})`,
      }}
    >
      {props.count}
    </span>
  );
}

/* ══════════════ 排行榜卷首（GodRankingCard.kt L296-351） ══════════════ */

export function GodRankingHero(props: { leader: GodMoment; count: number }) {
  const dark = godIsDark();
  const gold = godGoldGradient(dark);
  // ink = dark?#171712:#292315；第二停 = ink.copy(red=0.23, green=0.20, blue=0.13) → #3B3321
  const ink = dark ? '#171712' : '#292315';

  return (
    <div
      className="god-hero"
      style={{
        background: `linear-gradient(135deg, ${ink} 0%, #3B3321 100%)`,
        borderColor: `${gold[0]}61`, // gold[0].copy(alpha = 0.38f)
      }}
    >
      {/* Canvas：cx 0.90w / cy 0.30h，4 圈描边 + 中心实心光斑 */}
      <div className="god-hero__rings" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => {
          const d = 2 * (58 + i * 33);
          const alpha = (0.14 - i * 0.026).toFixed(3);
          return (
            <span
              key={i}
              className="god-hero__ring"
              style={{
                width: d,
                height: d,
                borderColor: `${gold[0]}${Math.round(Number(alpha) * 255)
                  .toString(16)
                  .padStart(2, '0')}`,
              }}
            />
          );
        })}
        <span className="god-hero__ring-fill" style={{ background: `${gold[1]}2E` }} />
      </div>
      <div className="god-hero__content">
        {/* Kotlin L327：`Text("THE MOMENTS / 精选记录", color = gold[0], …)`
            —— gold[0] 随主题翻转（深色 `#E0CB96`），CSS 里原本写死浅色金，此处按主题取。 */}
        <p className="god-hero__eyebrow" style={{ color: gold[0] }}>
          THE MOMENTS / 精选记录
        </p>
        <p className="god-hero__title">
          值得重读的，
          <br />
          都在这里。
        </p>
        <p className="god-hero__meta">
          {props.count} 个高光时刻&nbsp; ·&nbsp; 最高 {godRatingText(props.leader.rating)} 分
        </p>
        <p className="god-hero__leader">榜首 &nbsp;{effectiveGodTitle(props.leader)}</p>
      </div>
    </div>
  );
}

/* ══════════════ 视差 hook 导出（供 Body 使用） ══════════════ */

export { useGodTilt, godTiltFactor };
