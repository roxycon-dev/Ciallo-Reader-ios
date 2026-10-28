import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { withAlpha } from '../../core/glass/color';
import { AcrylicDialog } from './AcrylicDialog';
import { AppButton } from './AppButton';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/SettingsControls.kt` (721 non-blank lines)
 *
 *   lines 82-212   `SegmentedPillSelector(options, selected, onSelect, modifier)`
 *                  → `SettingsSegmentedPillSelector`
 *                  (the shared `SegmentedPillSelector.tsx` already implements the
 *                  *equivalent-width* variant used by SettingsTabScreen; this one
 *                  reproduces the Kotlin behaviour of sizing the indicator to the
 *                  selected label's measured text width + 16dp, so the two coexist)
 *   lines 216-320  `PageTurnSelectorRow(title, description, type, selected, onClick, modifier)`
 *                  → `SettingsPageTurnSelectorRow` (adds the mini page-turn preview)
 *   lines 324-421  `CustomMinutesDialog(current, onConfirm, onDismiss)` → CustomMinutesDialog
 *   lines 434-599  `JunoSlider(value, onValueChange, modifier)` → JunoSlider
 *   lines 606-742  `private PageTurnPreview(type, playTick, dimmed, modifier)`
 *                  → PageTurnPreview (SVG)
 *
 * The shared `SegmentedPillSelector.tsx` / `PageTurnSelectorRow.tsx` are **not
 * modified**; the two Kotlin versions whose behaviour differs (indicator sizing and
 * the live preview) are exported here under distinct names.
 *
 * ADAPTATION — Compose Canvas preview → SVG
 * The `PageTurnPreview` Canvas draws one rounded "page" plus 4 text lines, then
 * applies each mode's real easing curve. The web port draws the same geometry as
 * SVG and animates it with the same bezier, so the five modes remain visually
 * distinguishable at a glance (未选中的行定格在该效果最具辨识度的中间相位).
 */
export type PageTurnPreviewType = 'SIMULATE' | 'COVER' | 'SLIDE' | 'FADE' | 'SCROLL';

/** Kotlin line 618-624 — each effect uses its own real easing curve. */
const PREVIEW_EASING: Record<PageTurnPreviewType, string> = {
  SIMULATE: 'cubic-bezier(0.2, 0.7, 0.25, 1)', // 卷曲是纸张阻尼的减速曲线
  COVER: 'cubic-bezier(0.4, 0, 0.2, 1)', // FastOutSlowInEasing
  SLIDE: 'linear',
  FADE: 'cubic-bezier(0.4, 0, 0.2, 1)',
  SCROLL: 'linear',
};

/** Kotlin line 629 — 未选中的行定格在该效果最具辨识度的中间相位. */
const DIMMED_PHASE = 0.55;
const PREVIEW_MS = 520;

export interface SegmentedPillSelectorProps {
  /** Kotlin `List<Pair<Int, String>>` — [mode, label]. */
  options: ReadonlyArray<readonly [number, string]>;
  selected: number;
  onSelect: (mode: number) => void;
  className?: string;
  style?: React.CSSProperties;
  primary?: string;
  secondary?: string;
}

/**
 * 胶囊分段选择器：选中指示器弹簧滑动、半透明玻璃质感（文字始终在指示器上方）。
 *
 * Kotlin measures each label so the indicator is `labelWidth + 16.dp` and centred
 * on the label; `useRef` holds the measured map, and the resize observer updates
 * it outside render (no `ref.current` read during render).
 */
export function SettingsSegmentedPillSelector(props: SegmentedPillSelectorProps) {
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';
  const trackRef = useRef<HTMLDivElement | null>(null);

  // The measured layout lives in state so it can be read during render (React 19
  // forbids `ref.current` reads in render). Kotlin's `onGloballyPositioned` /
  // `onSizeChanged` callbacks become (a) the per-option `ref` callback and
  // (b) a ResizeObserver on the track; both write here, guarded by an equality
  // check so a re-render never loops.
  const [layout, setLayout] = useState<{
    trackWidth: number;
    positions: Record<number, { left: number; width: number }>;
    textWidths: Record<number, number>;
  }>({ trackWidth: 0, positions: {}, textWidths: {} });

  const measureOption = useCallback((mode: number, el: HTMLElement | null) => {
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const text = el.firstElementChild as HTMLElement | null;
    const textWidth = text !== null ? text.offsetWidth : 0;
    setLayout((prev) => {
      const pos = prev.positions[mode];
      if (
        pos !== undefined &&
        pos.left === rect.left &&
        pos.width === rect.width &&
        prev.textWidths[mode] === textWidth
      ) {
        return prev;
      }
      return {
        trackWidth: prev.trackWidth,
        positions: { ...prev.positions, [mode]: { left: rect.left, width: rect.width } },
        textWidths: { ...prev.textWidths, [mode]: textWidth },
      };
    });
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (el === null) return;
    const measure = (): void => {
      setLayout((prev) =>
        prev.trackWidth === el.clientWidth
          ? prev
          : { ...prev, trackWidth: el.clientWidth },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.options.length]);

  const target = layout.positions[props.selected];
  const labelW = layout.textWidths[props.selected] ?? 0;
  const indicatorWidth = target !== undefined && labelW > 0 ? labelW + 16 : 0;
  const indicatorX =
    target !== undefined && indicatorWidth > 0
      ? target.left + target.width / 2 - indicatorWidth / 2
      : 0;
  const showIndicator = target !== undefined && layout.trackWidth > 0 && labelW > 0;

  return (
    <div
      ref={trackRef}
      className={['settings-pill', props.className ?? ''].filter(Boolean).join(' ')}
      style={{
        width: '100%',
        height: 48,
        borderRadius: 999,
        background: 'rgba(255, 255, 255, 0.55)',
        border: `1px solid ${withAlpha(primary, 0.3)}`,
        position: 'relative',
        overflow: 'hidden',
        ...props.style,
      }}
    >
      {showIndicator ? (
        <span
          className="settings-pill__indicator"
          style={{
            position: 'absolute',
            left: 0,
            top: 3,
            bottom: 3,
            height: 42,
            width: `${indicatorWidth}px`,
            transform: `translateX(${indicatorX}px)`,
            borderRadius: 999,
            backgroundImage: `linear-gradient(90deg, ${withAlpha(primary, 0.22)}, ${withAlpha(
              secondary,
              0.16,
            )})`,
            border: `1.5px solid ${withAlpha(primary, 0.45)}`,
            transition:
              'transform 350ms cubic-bezier(0.25, 1.35, 0.5, 1), width 350ms cubic-bezier(0.25, 1.35, 0.5, 1)',
          }}
        />
      ) : null}

      <div className="settings-pill__row">
        {props.options.map(([mode, label]) => {
          const active = mode === props.selected;
          return (
            <button
              key={mode}
              type="button"
              className={
                active
                  ? 'settings-pill__option settings-pill__option--active'
                  : 'settings-pill__option'
              }
              ref={(el) => measureOption(mode, el)}
              onClick={() => props.onSelect(mode)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface PageTurnSelectorRowProps {
  title: string;
  description: string;
  type: PageTurnPreviewType;
  selected: boolean;
  onClick: () => void;
  className?: string;
  primary?: string;
  secondary?: string;
}

/** 翻页动画选择行：选中态渐变胶囊 + 弹簧勾选反馈。 */
export function SettingsPageTurnSelectorRow(props: PageTurnSelectorRowProps) {
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';

  // 选中瞬间触发一次迷你试翻；初始选中的行进入页面即演示一遍
  // Kotlin: `LaunchedEffect(selected) { if (selected) playTick++ }`. React's
  // documented "adjust state during render" pattern replaces the effect without
  // `setState` inside one (React 19 `set-state-in-effect`).
  const [tickFor, setTickFor] = useState<{ selected: boolean; n: number }>({
    selected: props.selected,
    n: props.selected ? 1 : 0,
  });
  let playTick = tickFor.n;
  if (props.selected && tickFor.selected !== props.selected) {
    playTick = tickFor.n + 1;
    setTickFor({ selected: true, n: playTick });
  } else if (!props.selected && tickFor.selected) {
    setTickFor({ selected: false, n: tickFor.n });
  }

  return (
    <button
      type="button"
      className={[
        'settings-pt-row',
        props.selected ? 'settings-pt-row--active' : '',
        props.className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span className="settings-pt-row__preview">
        <PageTurnPreview type={props.type} playTick={playTick} dimmed={!props.selected} />
      </span>
      <span className="settings-pt-row__texts">
        <span className="settings-pt-row__title">{props.title}</span>
        <span style={{ height: 2 }} />
        <span className="settings-pt-row__desc">{props.description}</span>
      </span>
      <span
        className="settings-pt-row__check"
        style={{
          backgroundImage: props.selected
            ? `linear-gradient(90deg, ${primary}, ${secondary})`
            : 'none',
          transform: `scale(${props.selected ? 1 : 0})`,
          transition: 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </button>
  );
}

/** 迷你试翻预览页（40×54dp）：用每种翻页效果自己的缓动曲线. */
export function PageTurnPreview(props: {
  type: PageTurnPreviewType;
  playTick: number;
  dimmed: boolean;
}) {
  // Kotlin: `LaunchedEffect(Unit) { if (dimmed) progress.snapTo(0.55f) }` — the
  // lazy `useState` initializer is the React equivalent of a `snapTo` at first
  // composition (no effect needed).
  const [progress, setProgress] = useState(() => (props.dimmed ? DIMMED_PHASE : 0));
  // Kotlin: `LaunchedEffect(playTick) { snapTo(0); animateTo(1, tween(520, easing)) }`.
  // It is keyed on `playTick` only, and the guard reproduces the
  // `if (playTick == 0 && dimmed) return` early-out.
  //
  // `snapTo(0)`（连同那条 early-out）改用 React 官方的「渲染期派生 state」：playTick
  // 一变就在同一次渲染里归零，之后 effect 只剩 rAF 驱动，行为与原来完全一致，
  // 但 effect 体内不再出现同步 setState（React 19 `set-state-in-effect`）。
  // `lastTick`（ref，只在 effect 里写）负责「哪个 tick 正在播」，因此仅 type / dimmed
  // 变化不会重启动画；它初值等于 playTick，挂载那一次两者相等 → 等价原 `firstRun` 守卫。
  const lastTick = useRef(props.playTick);
  const [seenTick, setSeenTick] = useState(props.playTick);
  if (seenTick !== props.playTick) {
    setSeenTick(props.playTick);
    if (!(props.playTick === 0 && props.dimmed)) setProgress(0);
  }

  useEffect(() => {
    if (props.playTick === lastTick.current) return;
    lastTick.current = props.playTick;
    if (props.playTick === 0 && props.dimmed) return;
    const ease = bezierEasing(PREVIEW_EASING[props.type]);
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    let raf = 0;
    const step = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const t = Math.min(1, (now - start) / PREVIEW_MS);
      setProgress(ease(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [props.type, props.playTick, props.dimmed]);

  const w = 40;
  const h = 54;
  const p = progress;
  const pageBg = 'rgba(24, 25, 28, 0.06)';
  const lineColor = 'rgba(24, 25, 28, 0.22)';
  const nextLineColor = 'rgba(16, 185, 129, 0.38)';
  const edgeColor = '#E3E5E7';

  const lines = (alpha: number, xShift: number, color: string): ReactNode => (
    <>
      {[0, 1, 2, 3].map((i) => {
        const lineW = w - 12 - (i === 3 ? w * 0.28 : 0);
        return (
          <rect
            key={i}
            x={6 + xShift}
            y={8 + (i * (h - 16)) / 4}
            width={lineW}
            height={3}
            rx={1.5}
            fill={color}
            opacity={Math.max(0, Math.min(1, alpha))}
          />
        );
      })}
    </>
  );

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      className="settings-pt-preview"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <defs>
        <clipPath id={`pt-clip-${props.type}`}>
          <rect x="0" y="0" width={w} height={h} />
        </clipPath>
      </defs>
      {/* 纸面：实色圆角矩形 + 细描边 */}
      <rect x="0" y="0" width={w} height={h} rx={6} fill={pageBg} />
      <rect
        x="0.5"
        y="0.5"
        width={w - 1}
        height={h - 1}
        rx={6}
        fill="none"
        stroke={edgeColor}
        strokeWidth={1}
      />
      <g clipPath={`url(#pt-clip-${props.type})`}>
        {props.type === 'SIMULATE' ? (
          <>
            <g transform={`translate(${-3 * p} 0)`}>{lines(1, 0, lineColor)}</g>
            {/* 右下角折起：背面纸 + 折痕暗带 + 纸缘高光 */}
            <SimulateFold w={w} h={h} p={p} pageBg={pageBg} />
          </>
        ) : null}
        {props.type === 'COVER' ? (
          <>
            {lines(1, 0, lineColor)}
            <rect
              x={w * (1 - p)}
              y="0"
              width={w - w * (1 - p)}
              height={h}
              fill={pageBg}
            />
            {w * (1 - p) > 1 ? (
              <rect
                x={w * (1 - p) - 5}
                y="0"
                width={7}
                height={h}
                fill={`url(#pt-cover-shadow-${w})`}
              />
            ) : null}
            <linearGradient id={`pt-cover-shadow-${w}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={`rgba(0,0,0,${0.22 * (1 - p)})`} />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </linearGradient>
          </>
        ) : null}
        {props.type === 'SLIDE' ? (
          <>
            {/* 裁剪到纸面内，平移的行不允许溢出到"书外" */}
            <g transform={`translate(${-w * 0.85 * p} 0)`}>{lines(1, 0, lineColor)}</g>
            <g transform={`translate(${w * (1 - p) * 0.9} 0)`}>
              {lines(0.45, 0, nextLineColor)}
            </g>
          </>
        ) : null}
        {props.type === 'FADE' ? (
          <>
            {lines(1 - p, -2 * p, lineColor)}
            {lines(p, 2 * p, nextLineColor)}
          </>
        ) : null}
        {props.type === 'SCROLL' ? (
          <>
            <g transform={`translate(0 ${-p * ((h - 16) / 4) * 2.4})`}>
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const gap = (h - 16) / 4;
                const lineW = w - 12 - (i % 4 === 3 ? w * 0.28 : 0);
                return (
                  <rect
                    key={i}
                    x={6}
                    y={8 + i * gap}
                    width={lineW}
                    height={3}
                    rx={1.5}
                    fill={lineColor}
                  />
                );
              })}
            </g>
            <rect
              x={w - 3}
              y={6 + p * (h - 18)}
              width={2.5}
              height={10}
              rx={1.2}
              fill={edgeColor}
            />
          </>
        ) : null}
      </g>
    </svg>
  );
}

/** Kotlin lines 665-689 — 右下角折起：背面纸 + 折痕暗带 + 纸缘高光. */
function SimulateFold(props: { w: number; h: number; p: number; pageBg: string }) {
  const { w, h, p, pageBg } = props;
  const fold = w * 0.62 * p;
  if (fold <= 2) return null;
  return (
    <>
      <path d={`M${w},${h} L${w - fold},${h} L${w},${h - fold} Z`} fill={pageBg} />
      <path
        d={`M${w},${h} L${w - fold},${h} L${w},${h - fold} Z`}
        fill={`rgba(0, 0, 0, ${(0.16 * p).toFixed(4)})`}
        opacity={1 - p}
      />
      <line
        x1={w - fold}
        y1={h}
        x2={w}
        y2={h - fold}
        stroke={`rgba(255, 255, 255, ${(0.55 * p).toFixed(4)})`}
        strokeWidth={1.5}
      />
    </>
  );
}

/** 自定义分钟弹窗：+/- 步进器，数字弹簧切换. */
export function CustomMinutesDialog(props: {
  current: number;
  onConfirm: (minutes: number) => void;
  onDismiss: () => void;
  primary?: string;
  secondary?: string;
}) {
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';
  const [value, setValue] = useState(() => Math.max(1, Math.min(180, props.current)));
  const [text, setText] = useState(() => String(Math.max(1, Math.min(180, props.current))));

  return (
    <AcrylicDialog
      onDismissRequest={props.onDismiss}
      primary={primary}
      secondary={secondary}
      data-testid="custom_minutes_dialog"
      title={<p className="settings-dialog__title">自定义休息时间</p>}
      text={
        <div className="settings-dialog__body">
          <input
            className="settings-textfield"
            type="text"
            inputMode="numeric"
            value={text}
            aria-label="输入分钟数"
            placeholder="输入分钟数"
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
              setText(digits);
              const parsed = digits === '' ? null : Number(digits);
              if (parsed !== null && parsed >= 1 && parsed <= 180) setValue(parsed);
            }}
            style={{
              borderColor: `${primary}`,
              ['--unfocused-border' as string]: withAlpha(primary, 0.35),
            }}
          />
          <div style={{ height: 14 }} />
          <div className="settings-dialog__stepper">
            <AppButton
              onClick={() => setValue((v) => Math.max(1, v - 1))}
              variant="secondary"
              size="sm"
              aria-label="减一分钟"
            >
              −
            </AppButton>
            <span
              className="settings-dialog__minutes"
              style={{ background: withAlpha(primary, 0.08), color: primary }}
            >
              {value} 分钟
            </span>
            <AppButton
              onClick={() => setValue((v) => Math.min(180, v + 1))}
              variant="secondary"
              size="sm"
              aria-label="加一分钟"
            >
              +
            </AppButton>
          </div>
        </div>
      }
      confirmButton={
        <AppButton
          onClick={() => {
            const parsed = text === '' ? null : Number(text);
            const finalValue =
              parsed !== null && Number.isFinite(parsed)
                ? Math.max(1, Math.min(180, parsed))
                : Math.max(1, Math.min(180, value));
            props.onConfirm(finalValue);
          }}
          variant="primary"
          size="sm"
        >
          确定
        </AppButton>
      }
      dismissButton={
        <button type="button" className="settings-dialog__text-button" onClick={props.onDismiss}>
          取消
        </button>
      }
    />
  );
}

/**
 * JunoSlider 交互移植（护眼滤镜强度）：
 * 静止 10dp 细胶囊，按下展开到 22dp，内外阴影用主题色，拖动时显示百分比气泡。
 */
export function JunoSlider(props: {
  value: number;
  onValueChange: (value: number) => void;
  className?: string;
  primary?: string;
  secondary?: string;
}) {
  const primary = props.primary ?? '#059669';
  const secondary = props.secondary ?? '#10B981';
  const trackRef = useRef<HTMLDivElement | null>(null);
  // The measured track width lives in state (React 19 forbids `ref.current` reads
  // during render); Kotlin's `onSizeChanged { sliderWidth = it.width }` maps here.
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fraction = Math.max(0, Math.min(1, props.value));

  useEffect(() => {
    const el = trackRef.current;
    if (el === null) return;
    const measure = (): void => setTrackWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 仓库 DragGesture(minimumDistance: 0)：按下即开始，位移更新，无位移=点按跳转
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const width = rect.width;
      const apply = (clientX: number): void => {
        if (width > 0) {
          props.onValueChange(Math.max(0, Math.min(1, (clientX - rect.left) / width)));
        }
      };
      // ⚠️ 健壮性：无论手势以何种方式结束（正常抬手 / 指针被父级消费掉 /
      //    拖出流外 / 节点被移出组合导致协程取消），都必须把 dragging 归位。
      setDragging(true);
      apply(e.clientX);
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        setDragging(false);
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
      };
      const move = (ev: PointerEvent): void => {
        ev.preventDefault();
        apply(ev.clientX);
      };
      const up = (): void => release();
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    },
    [props],
  );

  const trackHeight = dragging ? 22 : 10;
  const minWidth = dragging ? 22 : 10;
  const progressWidth =
    dragging && trackWidth > 0
      ? fraction * trackWidth
      : Math.max(minWidth, fraction * trackWidth);

  return (
    <div
      ref={trackRef}
      className={['juno-slider', props.className ?? ''].filter(Boolean).join(' ')}
      style={{ width: '100%', height: 48, position: 'relative', touchAction: 'none' }}
      role="slider"
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${Math.round(fraction * 100)}%`}
      onPointerDown={onPointerDown}
    >
      {/* 轨道：深色半透明 + 内阴影 + 外阴影（严格按仓库） */}
      <div
        className="juno-slider__track"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          height: trackHeight,
          borderRadius: 999,
          background: 'rgba(26, 26, 30, 0.5)',
          boxShadow: `0 1px 2px ${withAlpha(primary, 0.2)}`,
          transition: 'height 250ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* 进度条：primary → accent 渐变 */}
        <div
          className="juno-slider__fill"
          style={{
            height: '100%',
            width: `${progressWidth}px`,
            borderRadius: 999,
            backgroundImage: `linear-gradient(90deg, ${primary}, ${secondary})`,
            transition: dragging ? 'none' : 'width 250ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* thumb：仅拖动时出现（仓库 opacity 0/1） */}
          {dragging ? (
            <span
              className="juno-slider__thumb"
              style={{ boxShadow: `0 1px 2px ${withAlpha(primary, 0.3)}` }}
            />
          ) : null}
        </div>
      </div>

      {/* 拖动中显示百分比气泡，松手淡出 */}
      {dragging ? (
        <span
          className="juno-slider__bubble"
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundImage: `linear-gradient(90deg, ${primary}, ${secondary})`,
            color: '#FFFFFF',
          }}
        >
          {Math.floor(props.value * 100)}%
        </span>
      ) : null}
    </div>
  );
}

function bezierEasing(bezier: string): (t: number) => number {
  if (bezier === 'linear') return (t) => t;
  const m = /cubic-bezier\(([^,]+),([^,]+),([^,]+),([^)]+)\)/.exec(bezier);
  if (m === null) return (t) => t;
  const x1 = Number(m[1]);
  const y1 = Number(m[2]);
  const x2 = Number(m[3]);
  const y2 = Number(m[4]);
  return (t) => cubicBezier(x1, y1, x2, y2)(t);
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 6; i++) {
      const x = bez1(u, x1, x2) - t;
      const dx = bezd(u, x1, x2);
      if (Math.abs(x) < 1e-6 || Math.abs(dx) < 1e-6) break;
      u -= x / dx;
    }
    return bez1(u, y1, y2);
  };
}

function bez1(u: number, p1: number, p2: number): number {
  const mu = 1 - u;
  return 3 * mu * mu * u * p1 + 3 * mu * u * u * p2 + u * u * u;
}

function bezd(u: number, p1: number, p2: number): number {
  const mu = 1 - u;
  return 3 * mu * mu * p1 + 6 * mu * u * (p2 - p1) + 3 * u * u * (1 - p2);
}