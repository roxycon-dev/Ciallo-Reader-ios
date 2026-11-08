import { useEffect, useMemo, useState } from 'react';
import { withAlpha } from '../../core/glass/color';
import { GlassCard } from './GlassCard';
import { SegmentedPillSelector } from './SegmentedPillSelector';
import {
  dailySeries,
  formatShortDuration,
  monthlySeries,
  peakHourTotals,
  toDailyTotalsMap,
  todayCalendar,
  useTodayCalendar,
  type ReadingSession,
} from './ReadingStats';

/**
 * Kotlin → TS map
 * ──────────────
 * - `ui/components/ReadingTrendCard.kt` (381 non-blank lines) — FULL PORT
 *   lines 47-227 `@Composable ReadingTrendCard(dailyTotals, sessions, modifier)`
 *                → ReadingTrendCard
 *   lines 52-54  the three local states (tab / selectedPoint / selectedHour)
 *   lines 57-71  the per-tab series (`近14天` / `近30天` / `近12个月`)
 *   lines 73-76  the peak-hour window (last 30 days) + max hour + total
 *   lines 78-226 the card body (all Chinese strings verbatim)
 *   lines 230-344 `private TrendLineChart` → TrendLineChart (SVG)
 *   lines 347-401 `private PeakHoursBars` → PeakHoursBars
 *
 * ADAPTATION — Compose Canvas → SVG
 * ① `TrendLineChart` draws a grid, a gradient area fill, a 2.5px stroke, a gold
 *    peak dot, first/last markers, and a reveal clip (`clipRect(right = w * rv)`).
 *    All of that is an SVG path/polyline with a `<clipPath>` whose width is
 *    animated by rAF — the "先纸后墨" (grid first, ink grows) ordering is preserved.
 * ② `PeakHoursBars` becomes 24 columns with independent CSS transitions; the
 *    staggered `delayMillis = hour * 12` and the 420ms grow are kept, which is what
 *    produces the "波浪式" refresh the Kotlin comment describes.
 * ③ Tap-to-select on the line chart maps to a click handler that resolves the
 *    nearest index by x, using the same `stepX = w / (series.size - 1)` formula.
 */
export interface ReadingTrendCardProps {
  /**
   * `yyyy-MM-dd` → seconds.
   * Accepts a Map or a plain record so callers can pass the app store's snapshot
   * directly; the Kotlin signature was `Map<String, Long>`.
   */
  dailyTotals: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  sessions: readonly ReadingSession[];
  className?: string;
}

const MINT_PRIMARY = '#059669';
const MINT_GOLD = '#E8C97A';
const ON_SURFACE = '#18191C';
const ON_SURFACE_VARIANT = '#61666D';

/** Kotlin line 71 — the three series labels, verbatim. */
const SERIES_LABELS = ['近14天', '近30天', '近12个月'] as const;

export function ReadingTrendCard(props: ReadingTrendCardProps) {
  const [tab, setTab] = useState(0);
  const [selectedPoint, setSelectedPoint] = useState(-1);
  const [selectedHour, setSelectedHour] = useState(-1);
  // 2026-09-21: use the cross-day-refreshing "today" (ReadingStats.kt line 29).
  useTodayCalendar();

  const today = useMemo(() => todayCalendar(), []);

  const totals = useMemo(() => toDailyTotalsMap(props.dailyTotals), [props.dailyTotals]);

  const series = useMemo(() => {
    const to = today;
    const from = new Date(today);
    if (tab === 0) {
      from.setDate(from.getDate() - 13);
      return dailySeries(totals, from, to);
    }
    if (tab === 1) {
      from.setDate(from.getDate() - 29);
      return dailySeries(totals, from, to);
    }
    return monthlySeries(totals, 12, today);
  }, [totals, tab, today]);

  const seriesLabel = SERIES_LABELS[tab] ?? '近14天';

  const peakFrom = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    return d;
  }, [today]);
  const peak = useMemo(
    () => peakHourTotals(props.sessions, peakFrom, today),
    [props.sessions, peakFrom, today],
  );
  let peakMaxHour: number | null = null;
  for (let i = 0; i < peak.length; i++) {
    if (peakMaxHour === null || (peak[i] ?? 0) > (peak[peakMaxHour] ?? 0)) peakMaxHour = i;
  }
  const peakTotal = peak.reduce((a, b) => a + b, 0);

  const maxSeconds = useMemo(() => {
    let m = 0;
    for (const [, v] of series) if (v > m) m = v;
    return m;
  }, [series]);

  return (
    <GlassCard radius={20} className={['trend-card', props.className ?? ''].filter(Boolean).join(' ')}>
      <div className="trend-card__body">
        <div className="trend-card__head">
          <span className="stats-icon-circle" style={{ background: withAlpha(MINT_PRIMARY, 0.12) }}>
            <ShowChartIcon color={MINT_PRIMARY} />
          </span>
          <span style={{ width: 10 }} />
          <div className="trend-card__head-texts">
            <p className="trend-card__title">阅读趋势</p>
            <p className="trend-card__subtitle">时长走势与高峰时段</p>
          </div>
          <span className="trend-card__spacer" />
          <div className="trend-card__tabs" style={{ maxWidth: 150 }}>
            <SegmentedPillSelector
              options={[
                { value: 0, label: '周' },
                { value: 1, label: '月' },
                { value: 2, label: '年' },
              ]}
              value={tab}
              onChange={(v) => setTab(v)}
            />
          </div>
        </div>

        <div style={{ height: 10 }} />

        <div className="trend-card__legend">
          <p className="trend-card__legend-label">阅读时长 · {seriesLabel}</p>
          <span className="trend-card__spacer" />
          <p className="trend-card__legend-peak">峰值 {formatShortDuration(maxSeconds)}</p>
        </div>
        <div style={{ height: 6 }} />

        {selectedPoint >= 0 && selectedPoint < series.length ? (
          <>
            <div className="trend-card__readout" style={{ background: withAlpha(MINT_PRIMARY, 0.12) }}>
              {series[selectedPoint]?.[0] ?? ''} · {formatShortDuration(series[selectedPoint]?.[1] ?? 0)}
            </div>
            <div style={{ height: 6 }} />
          </>
        ) : null}

        <div className="trend-card__chart">
          <TrendLineChart
            series={series}
            selectedIndex={selectedPoint}
            onSelectIndex={setSelectedPoint}
          />
          {/* 满刻度数值锚点：让"线有多高"可被量化 */}
          {maxSeconds > 0 ? (
            <p className="trend-card__fullscale">满刻度 {formatShortDuration(maxSeconds)}</p>
          ) : null}
          {series.every(([, v]) => v <= 0) ? (
            <p className="trend-card__empty">还没有阅读时长——去读一页，让曲线开始生长</p>
          ) : null}
        </div>

        <div style={{ height: 16 }} />

        <div className="trend-card__peak-head">
          <p className="trend-card__peak-title">阅读高峰时段</p>
          <span className="trend-card__spacer" />
          {peakTotal > 0 && peakMaxHour !== null ? (
            <p className="trend-card__peak-range" style={{ color: MINT_GOLD }}>
              高峰 {peakMaxHour}:00 - {peakMaxHour + 1}:00
            </p>
          ) : null}
        </div>
        <div style={{ height: 8 }} />

        {peakTotal > 0 ? (
          <>
            {selectedHour >= 0 && selectedHour <= 23 && (peak[selectedHour] ?? 0) > 0 ? (
              <>
                <div
                  className="trend-card__readout"
                  style={{ background: withAlpha(MINT_GOLD, 0.14), color: MINT_GOLD }}
                >
                  {selectedHour}:00 - {selectedHour + 1}:00 ·{' '}
                  {formatShortDuration(peak[selectedHour] ?? 0)}
                </div>
                <div style={{ height: 6 }} />
              </>
            ) : null}
            <PeakHoursBars peak={peak} selectedHour={selectedHour} onSelectHour={setSelectedHour} />
          </>
        ) : (
          <p className="trend-card__no-peak">暂无时段数据（更新后开始记录每次阅读的起止时间）</p>
        )}
      </div>
    </GlassCard>
  );
}

/** Kotlin lines 230-344 — TrendLineChart. */
function TrendLineChart(props: {
  series: ReadonlyArray<readonly [string, number]>;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  const { series } = props;
  const [reveal, setReveal] = useState(1);
  const [pulse, setPulse] = useState(1);
  const W = 320;
  const H = 150;
  const topPad = 10;
  const bottomPad = 8;

  // 选中点切换时做一次扩散脉冲反馈
  useEffect(() => {
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    let raf = 0;
    const step = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      // spring(DampingRatioMediumBouncy, StiffnessMediumLow=700) ≈ 174ms
      const t = Math.min(1, (now - start) / 400);
      setPulse(t);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [props.selectedIndex]);

  // 先纸后墨：数据自左向右描绘进场 — cubic-bezier(0.3f, 0f, 0.2f, 1f), 700ms
  useEffect(() => {
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    let raf = 0;
    const step = (): void => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const t = Math.min(1, (now - start) / 700);
      setReveal(cubicBezier(0.3, 0, 0.2, 1)(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [series.length]);

  if (series.length < 2) return <div className="trend-card__chart-svg" />;

  const maxVal = Math.max(1, ...series.map(([, v]) => v));
  const gridColor = 'rgba(97, 102, 109, 0.35)';
  const peakIndex = (() => {
    let bi: number | null = null;
    series.forEach(([, v], i) => {
      if (bi === null || v > (series[bi] ?? ['', 0])[1]) bi = i;
    });
    return bi;
  })();

  const stepX = W / (series.length - 1);
  const points = series.map(([, v], i) => ({
    x: i * stepX,
    y: H - bottomPad - (v / maxVal) * (H - topPad - bottomPad),
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
  const fillPath = `${linePath} L${W},${H} L0,${H} Z`;

  const sel = props.selectedIndex;
  const selPoint = sel >= 0 && sel < points.length ? points[sel] : undefined;

  const onClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (series.length <= 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.max(0, Math.min(series.length - 1, Math.floor(x / stepX)));
    props.onSelectIndex(idx);
  };

  return (
    <svg
      className="trend-card__chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="阅读时长折线图"
      onClick={onClick}
    >
      <defs>
        <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={withAlpha(MINT_PRIMARY, 0.3)} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
        <clipPath id="trend-reveal">
          <rect x="0" y="0" width={(W * reveal).toFixed(2)} height={H} />
        </clipPath>
      </defs>

      {/* 先纸：水平参考网格 + 基线（静态骨架，不参与 reveal） */}
      {[1, 2, 3].map((g) => {
        const gy = topPad + ((H - topPad - bottomPad) * g) / 4;
        return (
          <line
            key={g}
            x1={0}
            y1={gy}
            x2={W}
            y2={gy}
            stroke={gridColor}
            strokeWidth={1}
          />
        );
      })}
      <line
        x1={0}
        y1={H - bottomPad}
        x2={W}
        y2={H - bottomPad}
        stroke={withAlpha(gridColor, 0.77)}
        strokeWidth={1}
      />

      {/* 后墨：折线/面积/峰值随 reveal 因果生长（峰值点在描绘经过时才落墨） */}
      <g clipPath="url(#trend-reveal)">
        <path d={fillPath} fill="url(#trend-area)" />
        <path d={linePath} fill="none" stroke={MINT_PRIMARY} strokeWidth={2.5} />
        {peakIndex !== null && points[peakIndex] !== undefined ? (
          <>
            <circle
              cx={points[peakIndex]?.x}
              cy={points[peakIndex]?.y}
              r={7}
              fill={MINT_GOLD}
            />
            <circle
              cx={points[peakIndex]?.x}
              cy={points[peakIndex]?.y}
              r={3}
              fill="#FFFFFF"
            />
          </>
        ) : null}
        {sel < 0 || sel >= points.length ? (
          <>
            <circle cx={points[0]?.x} cy={points[0]?.y} r={4} fill={MINT_PRIMARY} />
            <circle
              cx={points[points.length - 1]?.x}
              cy={points[points.length - 1]?.y}
              r={4}
              fill={MINT_PRIMARY}
            />
          </>
        ) : null}
      </g>

      {/* 选中点脉冲：始终即时响应点击（不参与 reveal） */}
      {selPoint !== undefined ? (
        <>
          <circle
            cx={selPoint.x}
            cy={selPoint.y}
            r={5 + 7 * pulse}
            fill={withAlpha(MINT_PRIMARY, 0.35 * (1 - pulse))}
          />
          <circle cx={selPoint.x} cy={selPoint.y} r={5} fill={MINT_PRIMARY} />
          <circle cx={selPoint.x} cy={selPoint.y} r={2} fill="#FFFFFF" />
        </>
      ) : null}
    </svg>
  );
}

/** Kotlin lines 347-401 — PeakHoursBars (24 columns, 12ms stagger). */
function PeakHoursBars(props: {
  peak: readonly number[];
  selectedHour: number;
  onSelectHour: (hour: number) => void;
}) {
  const max = Math.max(1, ...props.peak);
  return (
    <div className="peak-bars" role="group" aria-label="高峰时段分布">
      {props.peak.map((v, hour) => {
        const ratio = v / max;
        const isMax = v > 0 && v === max;
        const color = isMax ? withAlpha(MINT_GOLD, 0.65) : withAlpha(MINT_PRIMARY, 0.55);
        const selColor =
          props.selectedHour === hour ? withAlpha(MINT_GOLD, 0.95) : color;
        return (
          <button
            key={hour}
            type="button"
            className={
              props.selectedHour === hour
                ? 'peak-bars__col peak-bars__col--selected'
                : 'peak-bars__col'
            }
            aria-label={`${hour}:00 - ${hour + 1}:00`}
            onClick={() => props.onSelectHour(hour)}
          >
            <span
              className="peak-bars__bar"
              style={{
                height: `${(Math.max(0.04, ratio) * 100).toFixed(2)}%`,
                background: selColor,
                // B4：每根柱独立过渡，并按小时错峰 12ms 形成"波浪式"刷新
                transitionDelay: `${hour * 12}ms`,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

function ShowChartIcon(props: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill={props.color} aria-hidden="true">
      <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" />
    </svg>
  );
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

/** Re-exported for the theme helpers the card consumes. */
export { ON_SURFACE, ON_SURFACE_VARIANT };
