/**
 * comicSheetParts.tsx — 面板内复用零件（局部副本）。
 *
 * 为什么是副本：这些组件在 Kotlin 里位于 `ComicPanelDesign.kt` / `ComicReaderChrome.kt`，
 * 属于其它 agent 的移植范围（HARD RULE 4：不得改写他人文件）。面板必须能编译并
 * 自洽运行，故在本目录内提供等价实现，类名统一加 `cmcs-` 前缀避免与对方的
 * CSS/组件名冲突；若对方文件落地，可整目录切换 import。
 *
 * Kotlin 行号映射：
 *   - `ComicPanelDesign.kt` 62–72   PanelCardBg / PanelCardStroke / selectedBg / selectedStroke
 *   - `ComicPanelDesign.kt` 74–106  PanelSectionCard
 *   - `ComicPanelDesign.kt` 108–109 PanelTabData
 *   - `ComicPanelDesign.kt` 111–163 PanelTabRow
 *   - `ComicPanelDesign.kt` 165–280 PanelSlider（→ `<input type="range">`）
 *   - `ComicPanelDesign.kt` 282–321 PanelSwitch（→ aria-pressed 按钮，同 AppSwitch 模式）
 *   - `ComicPanelDesign.kt` 330–336 panelSelectedBg / panelSelectedStroke
 *   - `ComicReaderChrome.kt` 88–116 面板配色令牌 + comicPanelGlass
 *   - `ComicReaderChrome.kt` 614–666 SegmentRow
 *   - `ComicReaderChrome.kt` 668–695 SliderRow
 *   - `ComicReaderChrome.kt` 697–710 SwitchRow
 *   - `ComicReaderChrome.kt` 712–759 ComicSheetContainer（→ 固定定位 overlay + 拖拽关闭）
 *   - `ComicReaderChrome.kt` 611–612 clickableNoRipple（→ CSS，无涟漪）
 *   - `ComicReaderSheets.kt` 918–930 ActionChip
 *   - `ComicReaderSheets.kt` 1094–1136 EngineCard
 *   - `ComicReaderSheets.kt` 1138–1154 PanelRow
 *   - `ComicReaderSheets.kt` 1156–1184 PanelTextField
 *   - `ui/components/ChasingDots.kt` → 本地 CSS 追光点
 *
 * 逐行跳过说明：
 *   - `ComicPanelDesign.kt` 172–247 的自绘 Canvas（轨道/填充/光环/圆钮）：
 *     改为原生 `<input type="range">` + CSS 伪元素（Adaptation #3）。
 *   - `ComicPanelDesign.kt` 292–298 `animateFloatAsState(spring(...))` 与
 *     `PanelSwitch` 的 `IntOffset` 弹性滑动：改为 CSS transition（无需每帧 JS）。
 *   - `ComicPanelDesign.kt` 323–328 `lerpColor`：由 CSS `color-mix`/渐变承担，
 *     仅保留开关开/关两态色值（见 `.cmcs-switch--on`）。
 *   - `ComicPanelDesign.kt` 194–236 PanelSlider 的 slop 仲裁手势：原生 range
 *     输入已自带方向仲裁（横拖），无需重写。
 *   - `ComicReaderChrome.kt` 107–116 `comicPanelGlass`（LayerBackdrop 高斯模糊）：
 *     web 端用 CSS `backdrop-filter` 等效，无 backdrop 对象。
 *   - `ComicReaderChrome.kt` 722–732 的 RoundedCornerShape/adaptiveSheetWidth：
 *     由 `.cmcs-sheet` 的 border-radius + max-width 承担。
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { CSSProperties } from 'react';
import {
  type ComicSheetsPreset,
  type SegmentOption,
  type SettingsTabData,
} from '@core/comic/comicReaderSheets';
import { ComicIcon } from './ComicIcon';
import '../../../../styles/comicSheets.css';

/* ── 配色令牌（Kotlin ComicReaderChrome.kt 88–100） ── */

export const CMCS_PANEL_BG = '#D91A1A1E';
export const CMCS_PANEL_BG_GLASS = '#CC1A1A1E';
export const CMCS_CHIP_BG = '#16FFFFFF';
export const CMCS_CHIP_ACTIVE_BG = '#30FFFFFF';
export const CMCS_STROKE = '#1FFFFFFF';
export const CMCS_TEXT_PRIMARY = '#F2F2F4';
export const CMCS_TEXT_SECONDARY = '#B3FFFFFF';
/** Kotlin 66–72：选中背景 = 薄荷绿 18%，选中描边 = 55% */
export const CMCS_SELECTED_BG = 'rgba(5, 150, 105, 0.18)';
export const CMCS_SELECTED_STROKE = 'rgba(5, 150, 105, 0.55)';
/** Kotlin ComicPanelDesign.kt 63–64：玻璃卡片内层 */
export const CMCS_CARD_BG = '#0DFFFFFF';
export const CMCS_CARD_STROKE = '#26FFFFFF';

/* ── PanelHint（ComicPanelDesign.kt:190-193） ── */

/**
 * Kotlin:
 * ```kotlin
 * internal fun PanelHint(text: String) {
 *     Text(text, color = TextSecondary, fontSize = DesignTokens.TypeCaption,
 *         lineHeight = DesignTokens.TypeCaptionLineHeight,
 *         modifier = Modifier.fillMaxWidth().padding(vertical = DesignTokens.SpaceXs))
 * }
 * ```
 * `TypeCaption` / `SpaceXs` are carried by the `.cmcs-hint` rule in `comicSheets.css`.
 */
export function PanelHint(props: { text: string }) {
  return <p className="cmcs-hint">{props.text}</p>;
}

/* ── PanelSectionCard（Kotlin 74–106） ── */

export function PanelSectionCard(props: {
  title?: string | null;
  icon?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="cmcs-card">
      {props.title != null ? (
        <div className="cmcs-card__head">
          {props.icon != null ? (
            <>
              <span className="cmcs-card__icon" aria-hidden="true">
                <ComicIcon name={props.icon} />
              </span>
              <span className="cmcs-card__icon-gap" />
            </>
          ) : null}
          <span className="cmcs-card__title">{props.title}</span>
        </div>
      ) : null}
      {props.title != null ? <div className="cmcs-card__head-gap8" /> : null}
      {props.children}
    </div>
  );
}

/* ── PanelTabRow（Kotlin 111–163） ── */

export function PanelTabRow(props: {
  tabs: readonly SettingsTabData[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="cmcs-tabrow" role="tablist">
      {props.tabs.map((tab, i) => {
        const active = i === props.selected;
        return (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'cmcs-tabrow__item cmcs-tabrow__item--active' : 'cmcs-tabrow__item'}
            onClick={() => props.onSelect(i)}
          >
            <span className="cmcs-tabrow__icon" aria-hidden="true">
              <ComicIcon name={tab.icon} />
            </span>
            <div className="cmcs-tabrow__gap3" />
            <span className="cmcs-tabrow__label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── PanelSwitch（Kotlin 282–321 → AppSwitch 模式） ── */

export function PanelSwitch(props: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      className={props.checked ? 'cmcs-switch cmcs-switch--on' : 'cmcs-switch'}
      aria-pressed={props.checked}
      aria-label="switch"
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="cmcs-switch__thumb" />
    </button>
  );
}

/* ── SwitchRow（Kotlin 697–710） ── */

export function SwitchRow(props: {
  title: string;
  subtitle?: string | null;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="cmcs-switchrow">
      <div className="cmcs-switchrow__text">
        <span className="cmcs-switchrow__title">{props.title}</span>
        {props.subtitle != null ? (
          <>
            <div className="cmcs-switchrow__gap2" />
            <span className="cmcs-switchrow__subtitle">{props.subtitle}</span>
          </>
        ) : null}
      </div>
      <PanelSwitch checked={props.checked} onChange={props.onChange} />
    </div>
  );
}

/* ── SegmentRow（Kotlin 614–666） ── */

export function SegmentRow(props: {
  title: string;
  options: readonly SegmentOption[];
  selected: number;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="cmcs-segment">
      <span className="cmcs-segment__title">{props.title}</span>
      <div className="cmcs-segment__gap6" />
      <div className="cmcs-segment__flow">
        {props.options.map((opt) => {
          const active = opt.id === props.selected;
          return (
            <button
              key={opt.id}
              type="button"
              className={active ? 'cmcs-segment__item cmcs-segment__item--active' : 'cmcs-segment__item'}
              aria-pressed={active}
              onClick={() => props.onSelect(opt.id)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── SliderRow（Kotlin 668–695 + PanelSlider → range input） ── */

export function SliderRow(props: {
  title: string;
  value: number;
  range: readonly [number, number];
  format: (value: number) => string;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [lo, hi] = props.range;
  const step = props.step ?? 'any';
  return (
    <div className="cmcs-sliderrow">
      <div className="cmcs-sliderrow__head">
        <span className="cmcs-sliderrow__title">{props.title}</span>
        <span className="cmcs-sliderrow__value">{props.format(props.value)}</span>
      </div>
      <input
        type="range"
        className="cmcs-slider"
        min={lo}
        max={hi}
        step={step}
        value={props.value}
        aria-label={props.title}
        onChange={(e) => props.onChange(Number(e.currentTarget.value))}
      />
    </div>
  );
}

/* ── ActionChip（Kotlin ComicReaderSheets.kt 918–930） ── */

export function ActionChip(props: { text: string; onClick: () => void }) {
  return (
    <button type="button" className="cmcs-actionchip" onClick={props.onClick}>
      {props.text}
    </button>
  );
}

/* ── EngineCard（Kotlin ComicReaderSheets.kt 1094–1136） ── */

export function EngineCard(props: {
  title: string;
  desc: string;
  state: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={props.selected ? 'cmcs-enginecard cmcs-enginecard--active' : 'cmcs-enginecard'}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span className="cmcs-enginecard__text">
        <span className="cmcs-enginecard__title">{props.title}</span>
        <div className="cmcs-enginecard__gap2" />
        <span className="cmcs-enginecard__desc">{props.desc}</span>
        <div className="cmcs-enginecard__gap4" />
        <span className={props.selected ? 'cmcs-enginecard__state cmcs-enginecard__state--active' : 'cmcs-enginecard__state'}>
          {props.state}
        </span>
      </span>
      {props.selected ? (
        <span className="cmcs-enginecard__check" aria-hidden="true">
          <ComicIcon name="Check" />
        </span>
      ) : null}
    </button>
  );
}

/* ── PanelRow（Kotlin ComicReaderSheets.kt 1138–1154） ── */

export function PanelRow(props: { label: string; icon: string; onClick: () => void }) {
  return (
    <button type="button" className="cmcs-panelrow" onClick={props.onClick}>
      <span className="cmcs-panelrow__icon" aria-hidden="true">
        <ComicIcon name={props.icon} />
      </span>
      <span className="cmcs-panelrow__gap8" />
      <span className="cmcs-panelrow__label">{props.label}</span>
    </button>
  );
}

/* ── PanelTextField（Kotlin ComicReaderSheets.kt 1156–1184） ── */

export function PanelTextField(props: {
  label: string;
  value: string;
  onValueChange: (next: string) => void;
}) {
  return (
    <div className="cmcs-textfield">
      <span className="cmcs-textfield__label">{props.label}</span>
      <div className="cmcs-textfield__gap2" />
      <input
        type="text"
        className="cmcs-textfield__input"
        value={props.value}
        aria-label={props.label}
        onChange={(e) => props.onValueChange(e.currentTarget.value)}
      />
    </div>
  );
}

/* ── ChasingDots（Kotlin ui/components/ChasingDots.kt） ── */

export function ChasingDots(props: { size: number; color: string; circleRatio?: number }) {
  const ratio = props.circleRatio ?? 0.25;
  const dot = props.size * ratio;
  return (
    <span
      className="cmcs-chasing"
      style={{ width: props.size, height: props.size }}
      aria-hidden="true"
      role="status"
    >
      {Array.from({ length: 6 }, (_unused, i) => (
        <span
          key={i}
          className="cmcs-chasing__dot"
          style={{
            width: dot,
            height: dot,
            background: props.color,
            animationDelay: `${i * 100}ms`,
          }}
        />
      ))}
    </span>
  );
}

/* ── 底部面板容器（Kotlin ComicReaderChrome.kt 712–759 + Adaptation #1） ── */

const DISMISS_DRAG_PX = 80;

export function ComicSheetOverlay(props: {
  children: ReactNode;
  onDismiss: () => void;
  className?: string;
  style?: CSSProperties;
  ariaLabel: string;
  /**
   * Kotlin `ComicReaderChrome.kt` L107-116
   * `Modifier.comicPanelGlass(backdrop, shape)`：`backdrop == null` → 纯 `PanelBg`；
   * 否则 26dp 高斯模糊 + 1.18 饱和（CSS `backdrop-filter`，见文件头「跳过说明」）
   * 再叠 `PanelBgGlass`。
   *
   * 宿主传 `panelGlassSamplingActive(pageAnim, direction, mode, panelOpen)` 的结果：
   * `true` = 有 backdrop（走毛玻璃）；`false` = CURL 的 GL 层采不到（回退纯半透明）。
   *
   * `undefined`（未传）= 有 backdrop，与 Kotlin 侧 `glassBackdrop != null` 的默认一致。
   */
  glass?: boolean | undefined;
}) {
  const dragRef = useRef<{ startY: number; dy: number } | null>(null);
  const [dragDy, setDragDy] = useState(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragRef.current = { startY: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null) return;
    // Adaptation #1：drag-to-dismiss（向下拖过阈值即关闭，与 ModalBottomSheet 一致）
    const dy = Math.max(0, e.clientY - drag.startY);
    drag.dy = dy;
    setDragDy(dy);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDragDy(0);
      if (drag !== null && drag.dy >= DISMISS_DRAG_PX) props.onDismiss();
    },
    [props],
  );

  const sheetGlass = props.glass ?? true;
  // Kotlin L108 `background(PanelBg)` / L116 `.background(PanelBgGlass)`：
  // 无 backdrop 时用 0xD9 纯半透明（并关掉模糊），有 backdrop 时 0xCC + 26px 模糊。
  const sheetStyle: CSSProperties | undefined =
    sheetGlass || props.style === undefined
      ? props.style
      : { ...props.style, background: 'var(--cmcs-panel-bg)', backdropFilter: 'none' };

  return (
    <div className="cmcs-overlay" onClick={props.onDismiss}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.ariaLabel}
        className={props.className === undefined ? 'cmcs-sheet' : `cmcs-sheet ${props.className}`}
        data-glass={sheetGlass ? '1' : '0'}
        style={dragDy > 0 ? { ...sheetStyle, transform: `translateY(${dragDy}px)` } : sheetStyle}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="cmcs-sheet__grab-area">
          <div className="cmcs-sheet__grab" />
        </div>
        {props.children}
      </div>
    </div>
  );
}

/* ── 通用面板拖动条（Kotlin 190–198 / Chrome 734–742） ── */

export function SheetGrabHandle() {
  return (
    <div className="cmcs-sheet__grab-area">
      <div className="cmcs-sheet__grab" />
    </div>
  );
}

/** Kotlin 235 `.navigationBarsPadding()` 的等价：底部安全区内边距 */
export const CMCS_SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)';

/** 预设副标题的小型渲染（Kotlin 1471–1474 的调用点复用） */
export function PresetSummaryRow(props: { preset: ComicSheetsPreset; text: string }) {
  return (
    <div className="cmcs-preset-summary">
      <span className="cmcs-preset-summary__mode">{props.preset.config.mode}</span>
      <span className="cmcs-preset-summary__text">{props.text}</span>
    </div>
  );
}
