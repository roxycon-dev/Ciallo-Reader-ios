/**
 * WenkuSectionHeader.tsx — `ui/wenku/WenkuGlass.kt` L733-794 的 React 版。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L735-741  `WenkuSectionHeader(index, latin, title, modifier, trailing)` → `WenkuSectionHeaderProps`
 *   L743-746  `Column(fillMaxWidth, padding(top 8.dp, bottom 5.dp), spacedBy 6.dp)` → `.wenku-section-header`
 *   L747-764  `Row(CenterVertically, spacedBy 8.dp)`：
 *               `Text("$index / $latin", wenkuArchivePart(.08f,.68f,travel=4f),
 *                     inkSecondary / 10.sp / letterSpacing 1.1.sp / Medium / AppFonts.Default)` → `__meta`
 *               `Box(weight(1f).height(.5.dp).wenkuArchivePart(0f,.46f).background(hairline))` → `__rule`
 *               `Box(size(3.dp).wenkuArchivePart(.05f,.5f).background(ink))`                → `__dot`
 *   L765-785  `Row(fillMaxWidth, CenterVertically, spacedBy 8.dp)`：
 *               `Text(title, weight(1f).wenkuTabTitle(1, strength = .6f),
 *                     ink / 17.sp / SemiBold / AppFonts.Serif)`                              → `__title`
 *               `if (trailing != null) Row(wenkuTabTitle(1, strength = .6f), spacedBy 8.dp) { trailing() }`
 *                                                                                          → `__trailing`
 *   L791-794  `WenkuHairline(modifier)` = `Box(fillMaxWidth, height .5.dp, background(hairline))` → `WenkuHairline`
 *
 * 滚动揭示（Compose → CSS）
 * ─────────────────────────
 * `wenkuArchivePart` / `wenkuTabTitle`（`WenkuMotion.kt` L135-191）是按 `LocalWenkuSequence`
 * 进度窗口做位移 + clip + alpha 的 Modifier；时钟是 `WenkuSequence` 的 `ENTER_MS = 420`
 * 线性动画（`WenkuTokens.kt` L123），从 0 走到 1。Web 端等价物就是**挂载时**的一段
 * `@keyframes`：窗口 `[start, end]` 换成 `delay = start * 420ms`、
 * `duration = (end - start) * 420ms`，曲线用 `WenkuMotion.ease`（`--ease-out`）。
 * 数值全部由下方 `revealWindow()` 从 `WENKU_MOTION.enterMs` 算出，再以 CSS 变量注入，
 * 不在样式表里另写一套魔数。
 *
 * 与 Kotlin 的差异（均为宿主能力差异，画布结果一致）
 * ──────────────────────────────────────────────────
 *  * `Modifier` → `className` / `style`（Kotlin 的 `modifier` 参数）。
 *  * `AppFonts.Default` / `AppFonts.Serif` → `--font-sans` / `--font-serif`（theme.css L66-67）。
 *  * `wenkuColors()` 的 `hairline` 在 TS 侧没有单独的字段（`tokens.ts` L476 只带
 *    kit 用到的 5 个），这里按 `WenkuTokens.kt` L235 的定义现算：
 *    `ink.copy(alpha = isDark ? .14f : .10f)`。
 *  * `isDark` 走 `<html data-theme>`（与 `ArchiveShelf.tsx` L191-206 同一做法），
 *    而不是 Compose 的 `LocalAppDarkTheme`。
 *  * `clipRect` 的"从左往右擦出"用 `scaleX` 关键帧近似（`__rule` 的 `transform-origin: left`），
 *    因为 `clip-path` 在 0.5px 高的元素上会因亚像素抗锯齿抖动。
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

import { withAlphaInt } from '@core/wenku/coverArt';
import { WENKU_MOTION, wenkuColors } from '@core/wenku/tokens';
import { useRenderQuality } from '../GlassQuality';
import { useWenkuReducedMotion } from './WenkuGlass';
import '../../../styles/wenku.css';

/** `0xAARRGGBB` → CSS `rgba()`（与 `ArchiveShelf.tsx` L289-295 同一写法）。 */
function argbCss(color: number): string {
  const a = ((color >>> 24) & 0xff) / 255;
  const r = (color >>> 16) & 0xff;
  const g = (color >>> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

function readDocumentDark(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/** 主题跟着 `<html data-theme>`（`App.tsx` L533-538 写的就是这个属性）。 */
function useDocumentDark(): boolean {
  const [dark, setDark] = useState<boolean>(readDocumentDark);
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return undefined;
    const observer = new MutationObserver(() => setDark(readDocumentDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** `WenkuMotion.ENTER_MS`（`WenkuTokens.kt` L123）。 */
const ENTER_MS = WENKU_MOTION.enterMs;

/**
 * `revealProgress(raw, start, end)` 的窗口 → CSS 时间轴：
 * `raw` 是 0→1 的线性时钟，所以窗口在时间轴上就是 `[start·ENTER, end·ENTER]`。
 */
function revealWindow(start: number, end: number): { readonly delay: string; readonly duration: string } {
  return {
    delay: `${String(Math.round(start * ENTER_MS))}ms`,
    duration: `${String(Math.max(1, Math.round((end - start) * ENTER_MS)))}ms`,
  };
}

/** `wenkuArchivePart(.08f, .68f, travel = 4f)`（WenkuGlass.kt L750）。 */
const META_WINDOW = revealWindow(0.08, 0.68);
/** `wenkuArchivePart(0f, .46f, travel = 0f)`（L760）。 */
const RULE_WINDOW = revealWindow(0, 0.46);
/** `wenkuArchivePart(.05f, .5f, travel = 0f)`（L763）。 */
const DOT_WINDOW = revealWindow(0.05, 0.5);
/**
 * `wenkuTabTitle(1, strength = .6f)`（L772 / L780）。窗口来自 `WenkuMotion.kt` L180-181：
 * `start = .05f + .11f * order`、`end = .80f + .09f * order`。
 */
const TITLE_WINDOW = revealWindow(0.05 + 0.11, 0.8 + 0.09);

export interface WenkuSectionHeaderProps {
  /** Kotlin `index: String` —— 与 `latin` 一起渲染成 `"$index / $latin"`。 */
  readonly index: string;
  /** Kotlin `latin: String` —— 拉丁副标题（`DISCOVER / FILTERS` 之类，不翻译）。 */
  readonly latin: string;
  /** Kotlin `title: String` —— 调用点已经 `tr()` 过，组件内部**不再**包一层。 */
  readonly title: string;
  /** Kotlin `trailing: (@Composable () -> Unit)?` —— 为 `null`/`undefined` 时整块不渲染。 */
  readonly trailing?: ReactNode;
  /** Kotlin `modifier` 的 className 部分。 */
  readonly className?: string;
  /** Kotlin `modifier` 的布局部分（如调用点的 `padding(...)`）。 */
  readonly style?: CSSProperties;
  /**
   * 入场时序（Kotlin `wenkuArchivePart` / `wenkuTabTitle` 的挂载时钟）。
   * **默认关**：CSS 复刻的 `animation` 会随页面重渲染重播，元素在动画期间成为合成层，
   * 反复创建/销毁会让 WKWebView renderer `Target crashed` 或让 actionability 超时
   * （`DiscoverPage` 解除屏蔽、`ComicChaptersPage` 刷新目录时稳定复现）。
   */
  readonly reveal?: boolean;
}

/**
 * 全站统一的「编号 / 拉丁副标题 ─── 标题 + trailing」区块头。
 * Kotlin 生产调用点见 `WenkuGlass.kt` L735-787。
 */
export function WenkuSectionHeader(props: WenkuSectionHeaderProps) {
  const reduceMotion = useWenkuReducedMotion();
  const quality = useRenderQuality();
  const dark = useDocumentDark();
  const colors = wenkuColors(dark);

  const ink = argbCss(colors.ink);
  const inkSecondary = argbCss(colors.inkSecondary);
  /** `WenkuColors.hairline`（`WenkuTokens.kt` L235）。 */
  const hairline = argbCss(withAlphaInt(colors.ink, dark ? 0.14 : 0.1));

  // Kotlin 里 `wenkuArchivePart` / `wenkuTabTitle` 在 `reduce`（减少动效）时直接
  // `return@composed this`；`RenderQuality.MINIMAL` 额外压掉绘制时钟。
  const reveal = props.reveal === true && !reduceMotion && quality !== 'MINIMAL';

  const classNames = ['wenku-section-header'];
  if (reveal) classNames.push('wenku-section-header--reveal');
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);

  // 揭示时间轴：窗口 → `delay` / `duration`，以 CSS 变量注入（样式表里读 var）。
  const revealVars: Record<string, string> = {};
  if (reveal) {
    revealVars['--wenku-sh-meta-delay'] = META_WINDOW.delay;
    revealVars['--wenku-sh-meta-duration'] = META_WINDOW.duration;
    revealVars['--wenku-sh-rule-delay'] = RULE_WINDOW.delay;
    revealVars['--wenku-sh-rule-duration'] = RULE_WINDOW.duration;
    revealVars['--wenku-sh-dot-delay'] = DOT_WINDOW.delay;
    revealVars['--wenku-sh-dot-duration'] = DOT_WINDOW.duration;
    revealVars['--wenku-sh-title-delay'] = TITLE_WINDOW.delay;
    revealVars['--wenku-sh-title-duration'] = TITLE_WINDOW.duration;
  }
  const style: CSSProperties = { ...revealVars, ...props.style };

  return (
    <section
      className={classNames.join(' ')}
      style={style}
      data-wenku-section-header=""
      data-render-quality={quality}
    >
      <div className="wenku-section-header__row">
        <span
          className="wenku-section-header__meta"
          style={{ color: inkSecondary, fontFamily: 'var(--font-sans)' }}
        >
          {props.index} / {props.latin}
        </span>
        <span
          className="wenku-section-header__rule"
          style={{ background: hairline }}
          aria-hidden="true"
        />
        <span className="wenku-section-header__dot" style={{ background: ink }} aria-hidden="true" />
      </div>
      <div className="wenku-section-header__row">
        <p className="wenku-section-header__title" style={{ color: ink, fontFamily: 'var(--font-serif)' }}>
          {props.title}
        </p>
        {props.trailing === null || props.trailing === undefined ? null : (
          <div className="wenku-section-header__trailing">{props.trailing}</div>
        )}
      </div>
    </section>
  );
}

export interface WenkuHairlineProps {
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** `WenkuHairline`（`WenkuGlass.kt` L789-794）：整宽 0.5dp 的发丝线。 */
export function WenkuHairline(props: WenkuHairlineProps) {
  const dark = useDocumentDark();
  const colors = wenkuColors(dark);
  const hairline = argbCss(withAlphaInt(colors.ink, dark ? 0.14 : 0.1));
  const classNames = ['wenku-hairline'];
  if (props.className !== undefined && props.className !== '') classNames.push(props.className);
  return (
    <div
      className={classNames.join(' ')}
      style={{ background: hairline, ...props.style }}
      data-wenku-hairline=""
      aria-hidden="true"
    />
  );
}

export default WenkuSectionHeader;
