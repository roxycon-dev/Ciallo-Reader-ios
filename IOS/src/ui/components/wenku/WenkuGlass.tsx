/**
 * Wenku 玻璃面 —— `ui/wenku/WenkuGlass.kt` L85-232（`WenkuGlassSurface`）的 CSS 版。
 *
 * Kotlin → TS 映射
 * ─────────────────
 *   L101-113  pressed → contact（contact 120ms / settle 240ms）  → CSS `:active` + `--motion-fast`
 *   L152-159  实时模糊判定 + surfaceTint（dark .86 / light .72）  → `--wenku-glass-surface`（wenku.css）
 *   L166-198  drawBackdrop(blur / lens) + 0.7dp 描边            → `backdrop-filter` + `border`
 *   L199-210  无实时模糊回退：elevation 4dp + ambient .05/spot .10 → `box-shadow`
 *   L211-231  pullOutClickable + 内容槽                          → `role` + children
 *
 * 未移植：`kashif_e.backdrop` 的 `lens(refraction 12/18dp)` 边缘折射（依赖 RenderEffect，
 * Web 无等价能力；`backdrop-filter` 已给出模糊与饱和度）。`WenkuIconButton`
 * （L236-316）/`WenkuTextButton`（L319-416）在本层分别落到 `.wenku-menu__item` 与
 * `.wenku-sheet__row`，不单独出组件。
 *
 * `RenderQuality.MAX` 的边缘折射在 Web 端没有对应实现，故 `cardTweaks` 不参与本组件。
 */

import type { CSSProperties, ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

/** \`blur: Dp = 16.dp\`（WenkuGlass.kt L203）。 */
export const WENKU_GLASS_BLUR_PX = 16;
/** \`WenkuTokens.GlassRadius = 28.dp\`。 */
export const WENKU_GLASS_RADIUS_PX = 28;
/** \`consistentShadow(elevation = 4.dp, ambient .05, spot .10)\`（L201-206）。 */
export const WENKU_GLASS_ELEVATION_PX = 4;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  // Safari 13 之前只有 addListener；保留以对齐项目既有写法。
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * 系统「减少动态效果」。与 Kotlin \`rememberWenkuAccessibility().reduceMotion\` 同义：
 * 组件据此跳过入场/惯性/飞行，但**保留**布局与最终几何。
 */
export function useWenkuReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

/** 运行时是否允许实时毛玻璃（\`backdrop-filter\` 支持检测，避免旧内核整块糊成灰）。 */
export function wenkuBlurSupported(): boolean {
  if (typeof window === 'undefined' || typeof CSS === 'undefined') return false;
  if (typeof CSS.supports !== 'function') return false;
  return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
}

export interface WenkuGlassProps {
  readonly children?: ReactNode;
  /** \`WenkuGlassSurface\` 的 \`onClick\`：非 null 时整块可点并带 0.97 按压缩放。 */
  readonly onClick?: () => void;
  /** 传了就整套换成 `background`（\`tint != null\` 分支，L156）。 */
  readonly tint?: string;
  /** \`blur\`（dp → px），默认 16。传 0 等价关闭实时模糊。 */
  readonly blur?: number;
  /** 圆角，默认 28（\`WenkuTokens.GlassRadius\`）。 */
  readonly radius?: number;
  /** 去掉 elevation 阴影（用于本来就贴在别的玻璃面上的层）。 */
  readonly flat?: boolean;
  /** 高对比/禁用模糊：退回 \`panel@.95\` 不透明底（L158）。 */
  readonly solid?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

/**
 * 玻璃面容器。Kotlin 里它是个 \`Column\`（L223-231）；Web 端用 \`div\` 并保留
 * \`display: flex; flex-direction: column\` 的内容槽，子元素排布与 Compose 一致。
 */
export function WenkuGlass(props: WenkuGlassProps) {
  const reduceMotion = useWenkuReducedMotion();
  const interactive = typeof props.onClick === 'function';
  const solid = props.solid === true || props.blur === 0 || !wenkuBlurSupported();
  const blurPx = props.blur ?? WENKU_GLASS_BLUR_PX;
  const radiusPx = props.radius ?? WENKU_GLASS_RADIUS_PX;

  const classNames = ['wenku-glass'];
  if (interactive && !reduceMotion) classNames.push('wenku-glass--interactive');
  if (props.flat === true) classNames.push('wenku-glass--flat');
  if (solid || reduceMotion) classNames.push('wenku-glass--solid');
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  const style: CSSProperties = {
    borderRadius: `${radiusPx}px`,
    ['--wenku-glass-blur' as string]: `${blurPx}px`,
    ['--wenku-glass-radius' as string]: `${radiusPx}px`,
    display: 'flex',
    flexDirection: 'column',
    ...(props.tint !== undefined ? { background: props.tint } : null),
    ...props.style,
  } as CSSProperties;

  if (!interactive) {
    return (
      <div className={classNames.join(' ')} style={style} data-testid={props.testId}>
        {props.children}
      </div>
    );
  }
  return (
    <div
      className={classNames.join(' ')}
      style={style}
      role="button"
      tabIndex={0}
      data-testid={props.testId}
      onClick={() => props.onClick?.()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        props.onClick?.();
      }}
    >
      {props.children}
    </div>
  );
}
