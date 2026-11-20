/**
 * `OrdinarySlider` / `OrdinarySegmentedSelector` —— `ui/components/OrdinaryControls.kt` L17-79 的 Web 版。
 *
 * Kotlin 注释（L15）：「Standard controls keep values and callbacks while avoiding native
 * liquid renderers.」—— 画质不够时仍要保留取值与回调，只是不做液态渲染。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L18-61 `OrdinarySlider(value, onValueChange, modifier, valueRange, steps, enabled, reverse,
 *          rangeEnd, minGap, onRangeChange, onValueChangeFinished, onDraggingChange, formatLabel)`
 *     L30   `steps.coerceIn(0, LiquidSliderConfig.MAX_STOPS)`
 *     L33-39 `onDraggingChange` 只在**变化时**回调一次；卸载时补一次 `false`
 *     L40   `Column(fillMaxWidth().height(LiquidSliderConfig.HEIGHT.dp))`
 *     L41-42 单值 → `formatLabel(value)`；双端 → `"${formatLabel(value)} – ${formatLabel(rangeEnd)}"`
 *     L43   `reverse` → `LayoutDirection.Rtl`
 *     L49-54 双端：`gap = minGap.coerceIn(0, end-start)`，`start = value.coerceIn(start, end-gap)`，
 *            `end = rangeEnd.coerceIn(start+gap, end)`，拖动时按「谁动了」保持另一端不动
 *   L65-79 `OrdinarySegmentedSelector(options, selected, onSelect, modifier, height, fontSp)`
 *     L69   选中即回调（`if (selected != option.id)`）
 *     L72-74 label 过词表 `tr(...)`；`favorite` 追加 `♥`；`badge > 0` 追加数字
 *
 * 平台差异（已登记 E120）
 * ─────────────────────
 *  * Material3 `Slider` / `SingleChoiceSegmentedButtonRow` → 原生 `<input type="range">` +
 *    `<div role="radiogroup">`，取值/回调/禁用语义一致，外观由 `liquidSegment.css` 给。
 *  * `LayoutDirection.Rtl` → `direction: rtl`，但**只加在滑杆那一层**（`ordinary-slider__lane`
 *    / `ordinary-slider__pair`）—— Kotlin 的 `CompositionLocalProvider`（L43）也只包滑杆，
 *    label 在 L41 就已经画完；加在外层会让 label 跟着右对齐。
 *  * Material3 `steps = n` 的含义是「端点之间插 n 个停靠点」，所以 `input[step]` 必须写
 *    `(end - start) / (n + 1)`，写成 `/ n` 会多出一档。
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { LiquidSliderConfig } from '@core/glass/liquidSliderConfig';
import { tr } from '@core/i18n/locale';
import type { LiquidSegmentOption } from './LiquidSegmentedSelector';
import '../../styles/liquidSegment.css';

export interface OrdinarySliderProps {
  readonly value: number;
  readonly onValueChange: (next: number) => void;
  readonly valueRange?: { readonly start: number; readonly end: number };
  readonly steps?: number;
  readonly enabled?: boolean;
  readonly reverse?: boolean;
  /** 非空即双端滑块（Kotlin `rangeEnd: Float?`）。 */
  readonly rangeEnd?: number;
  readonly minGap?: number;
  readonly onRangeChange?: (start: number, end: number) => void;
  readonly onValueChangeFinished?: () => void;
  readonly onDraggingChange?: (dragging: boolean) => void;
  readonly formatLabel: (value: number) => string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** L17-61 `OrdinarySlider`。 */
export function OrdinarySlider(props: OrdinarySliderProps) {
  const start = props.valueRange?.start ?? 0;
  const end = props.valueRange?.end ?? 1;
  const enabled = props.enabled !== false;
  const supportedSteps = clamp(Math.trunc(props.steps ?? 0), 0, LiquidSliderConfig.MAX_STOPS);
  const [dragging, setDragging] = useState(false);
  const reported = useRef(false);
  const reportDrag = useRef(props.onDraggingChange);
  useEffect(() => {
    reportDrag.current = props.onDraggingChange;
  }, [props.onDraggingChange]);

  // L33-39：只在变化时回调一次；卸载时补一次 false。
  useEffect(() => {
    if (reported.current === dragging) return;
    reported.current = dragging;
    reportDrag.current?.(dragging);
  }, [dragging]);
  useEffect(
    () => () => {
      if (reported.current) reportDrag.current?.(false);
    },
    [],
  );

  const gap = clamp(props.minGap ?? 0, 0, end - start);
  const rangeStart = clamp(props.value, start, end - gap);
  const rangeEnd = clamp(props.rangeEnd ?? end, rangeStart + gap, end);
  const label =
    props.rangeEnd === undefined
      ? props.formatLabel(props.value)
      : `${props.formatLabel(props.value)} – ${props.formatLabel(props.rangeEnd)}`;

  const style: CSSProperties = {
    height: `${String(LiquidSliderConfig.HEIGHT)}px`,
    ...props.style,
  };

  /*
   * L43 `CompositionLocalProvider(LocalLayoutDirection provides if (reverse) Rtl else Ltr)`
   * **只包住滑杆**（L44-59），label 在 L41 就已经画完了 —— 所以反向只翻滑杆的坐标轴，
   * 不翻文字。旧端口把 `direction: rtl` 加在外层容器上，label 会跟着变成右对齐。
   */
  const sliderDirection: CSSProperties =
    props.reverse === true ? { direction: 'rtl' } : {};

  const step = supportedSteps > 0 ? (end - start) / (supportedSteps + 1) : 'any';

  const common = {
    type: 'range' as const,
    className: 'ordinary-slider__input',
    disabled: !enabled,
    min: start,
    max: end,
    step: typeof step === 'number' ? step : undefined,
    onPointerDown: () => setDragging(true),
    onPointerUp: () => {
      setDragging(false);
      props.onValueChangeFinished?.();
    },
    onBlur: () => setDragging(false),
  };

  return (
    <div className={['ordinary-slider', props.className].filter(Boolean).join(' ')} style={style}>
      <span className="ordinary-slider__label">{label}</span>
      {props.rangeEnd === undefined ? (
        <div className="ordinary-slider__lane" style={sliderDirection}>
          <input
            {...common}
            value={clamp(props.value, start, end)}
            onChange={(event) => props.onValueChange(Number(event.target.value))}
          />
        </div>
      ) : (
        <div className="ordinary-slider__pair" style={sliderDirection}>
          <input
            {...common}
            step={common.step}
            value={rangeStart}
            onChange={(event) => {
              const next = Number(event.target.value);
              props.onRangeChange?.(Math.min(next, rangeEnd - gap), rangeEnd);
            }}
          />
          <input
            {...common}
            step={common.step}
            value={rangeEnd}
            onChange={(event) => {
              const next = Number(event.target.value);
              props.onRangeChange?.(rangeStart, Math.max(next, rangeStart + gap));
            }}
          />
        </div>
      )}
    </div>
  );
}

export interface OrdinarySegmentedSelectorProps {
  readonly options: readonly LiquidSegmentOption[];
  readonly selected: number;
  readonly onSelect: (id: number) => void;
  readonly height?: number;
  readonly fontSp?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** L63-79 `OrdinarySegmentedSelector`。 */
export function OrdinarySegmentedSelector(props: OrdinarySegmentedSelectorProps): ReactNode {
  return (
    <div
      className={['ordinary-segment', props.className].filter(Boolean).join(' ')}
      style={{ height: `${String(props.height ?? 48)}px`, ...props.style }}
      role="radiogroup"
    >
      {props.options.map((option) => {
        const active = props.selected === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-ordinary-segment={String(option.id)}
            className={['ordinary-segment__item', active ? 'ordinary-segment__item--on' : '']
              .filter(Boolean)
              .join(' ')}
            style={{ fontSize: `${String(props.fontSp ?? 12)}px` }}
            onClick={() => {
              if (!active) props.onSelect(option.id);
            }}
          >
            <span className="ordinary-segment__text">{tr(option.label)}</span>
            {option.favorite === true ? <span className="ordinary-segment__heart">♥</span> : null}
            {(option.badge ?? 0) > 0 ? (
              <span className="ordinary-segment__badge">{String(option.badge)}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
