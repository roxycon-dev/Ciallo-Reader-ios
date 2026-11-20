/**
 * 发现页卡片的数据格式化 —— `discover/DiscoverCards.kt` L258-300 的纯函数部分。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L258-263 `cardCompact(value: Long)`：
 *            ≥1e8 → `"%.1fy"`、≥1e4 → `"%.1fw"`、≥1e3 → `"%.1fk"`、否则原样  → `cardCompact`
 *   L265-286 `CardDataLine(work, dimension)`：取 `updatedAt` / 计数 / `statistic` 三者
 *            → `cardDataLine`
 *   L288-302 `metric(work, dimension)`：按维度给「更新 / 讨论 / 阅读 / 源内 #n」+ origins
 *            → `metric`
 *
 * 数字格式用 `Locale.ROOT`（小数点固定 `.`），与 Kotlin `String.format(Locale.ROOT, …)` 一致。
 */

export type DiscoverDimension = 'UPDATES' | 'DISCUSSION' | 'CLICKS' | 'RANKING';

/** 卡片上的最小作品投影（`DiscoverWork` 的结构子集）。 */
export interface DiscoverWorkLike {
  readonly updatedAt?: number | null;
  readonly variants: ReadonlyArray<{
    readonly discussions?: number | null;
    readonly clicks?: number | null;
    readonly rank?: number | null;
    readonly statistic?: string | null;
    readonly origin?: string | null;
    readonly latestChapter?: string | null;
    readonly updatedAt?: number | null;
  }>;
}

/** `DiscoverEngine.compact(value)`（`DiscoverModels.kt`）：与 `cardCompact` 同一档位表。 */
export function compactCount(value: number): string {
  return cardCompact(value);
}

/** L258-263 `cardCompact(value)`。 */
export function cardCompact(value: number): string {
  const v = Math.trunc(value);
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}y`;
  if (v >= 10_000) return `${(v / 10_000).toFixed(1)}w`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

/** `dateLabel(epochMs)`（`DiscoverScreen.kt` L483）：`yyyy-MM-dd HH:mm` 的本地时间。 */
export function dateLabel(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** `workStatus`（`DiscoverScreen.kt` L479）的占位判定：连载 / 完结 / 未知。 */
export function workStatus(status: string | null | undefined): 'serial' | 'completed' | 'unknown' {
  if (status === null || status === undefined || status.trim() === '') return 'unknown';
  if (/完[结結]|已完成|completed|finished/i.test(status)) return 'completed';
  return 'serial';
}

/** `dimension → 计数`（L267-272）：四个维度都取 `clicks`，DISCUSSION 取 `discussions`。 */
function dimensionCount(work: DiscoverWorkLike, dimension: DiscoverDimension): number | null {
  const pick = work.variants.map((v) =>
    dimension === 'DISCUSSION' ? v.discussions : v.clicks,
  );
  const values = pick.filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum > 0 ? sum : null;
}

/** L265-286 `CardDataLine(work, dimension)` 的数据部分。 */
export function cardDataLine(
  work: DiscoverWorkLike,
  dimension: DiscoverDimension,
): {
  readonly date: string | null;
  readonly icon: 'chat' | 'visible' | 'favorite' | null;
  readonly text: string | null;
} | null {
  const count = dimensionCount(work, dimension);
  const statistic =
    work.variants.map((v) => v.statistic).find((s): s is string => typeof s === 'string' && s.trim() !== '') ??
    null;
  if (work.updatedAt == null && count === null && statistic === null) return null;
  const date = work.updatedAt == null ? null : dateLabel(work.updatedAt).split(' ')[0] ?? null;
  const icon: 'chat' | 'visible' | 'favorite' | null =
    count === null && statistic === null
      ? null
      : dimension === 'DISCUSSION'
        ? 'chat'
        : dimension === 'RANKING'
          ? count !== null
            ? 'visible'
            : 'favorite'
          : 'visible';
  const text =
    count !== null
      ? cardCompact(count)
      : (statistic ?? '').split(' ').slice(1).join(' ').replaceAll('万', 'w');
  return { date, icon, text: text === '' ? null : text };
}

/** L288-302 `metric(work, dimension)`。 */
export function metric(work: DiscoverWorkLike, dimension: DiscoverDimension): string {
  const entries = work.variants;
  let actual = '';
  if (dimension === 'UPDATES') {
    const latest = entries.reduce<(typeof entries)[number] | null>(
      (best, e) => (e.updatedAt ?? 0) > (best?.updatedAt ?? 0) ? e : best,
      null,
    );
    if (latest !== undefined && latest !== null) {
      actual = [latest.latestChapter ?? null, latest.updatedAt == null ? null : dateLabel(latest.updatedAt)]
        .filter((v): v is string => v !== null && v !== '')
        .join(' · ');
    }
  } else if (dimension === 'DISCUSSION') {
    const sum = entries
      .map((e) => e.discussions)
      .filter((v): v is number => typeof v === 'number')
      .reduce((a, b) => a + b, 0);
    const all = entries.filter((e) => typeof e.discussions === 'number');
    if (all.length > 0) actual = `讨论 ${compactCount(sum)}`;
  } else if (dimension === 'CLICKS') {
    const all = entries.filter((e) => typeof e.clicks === 'number');
    const sum = all.reduce((a, e) => a + (e.clicks ?? 0), 0);
    if (all.length > 0) actual = `阅读 ${compactCount(sum)}`;
  } else {
    const ranks = entries.map((e) => e.rank).filter((v): v is number => typeof v === 'number');
    if (ranks.length > 0) actual = `源内 #${String(Math.min(...ranks))}`;
  }
  const origins = [...new Set([...entries.map((e) => e.origin), ...entries.map((e) => e.statistic)])]
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .join(' · ');
  if (actual.trim() !== '') {
    return [...new Set([actual, origins].filter((v) => v.trim() !== ''))].join(' · ');
  }
  const first = entries[0];
  return first?.statistic ?? origins;
}


/* ══════════════════════════════════════════════════════════════════════════════
 * `DiscoverCards.kt` L305-321 `Trend(work, dimension, reverse, idleColor)`
 * ══════════════════════════════════════════════════════════════════════════════
 * 四个分支的**顺序**就是语义（Kotlin L309-312）：
 *   ① `newEntry && RANKING` → `"NEW"`（新上榜，不看数值）
 *   ② `value == null || value == 0` → `"—"`
 *   ③ `RANKING` → `"↑N"` / `"↓N"`（整数、无百分号）
 *   ④ 其它 → `"▲X.X%"` / `"▼X.X%"`（一位小数、带百分号）
 */

/** Kotlin `L309` 的 `"NEW"` 标签。 */
export const DISCOVER_TREND_NEW_LABEL = 'NEW';

/** Kotlin `L310` 的 `"—"` 标签（无变化）。 */
export const DISCOVER_TREND_IDLE_LABEL = '—';

/** Kotlin `L314` 的「飙升」阈值（`value >= 100` 且非 RANKING）。 */
export const DISCOVER_TREND_HOT_THRESHOLD = 100;

/** RANKING 维度的趋势：整数，带方向箭头。 */
export function discoverTrendRankingChange(change: number): string {
  const arrow = change > 0 ? '↑' : '↓';
  return `${arrow}${String(Math.trunc(Math.abs(change)))}`;
}

/** 其它维度的趋势：一位小数 + 百分号。 */
export function discoverTrendGrowthPercent(growth: number): string {
  const arrow = growth > 0 ? '▲' : '▼';
  return `${arrow}${Math.abs(growth).toFixed(1)}%`;
}

/**
 * Kotlin `L307-312`：取数值 + 拼标签。
 *
 * `value` 在 RANKING 维度是 `rankChange`，其它维度是 `growth`；调用方负责挑字段，
 * 这里只做「判空 → NEW → — → 箭头」的四分支。
 */
export function trendLabel(input: {
  readonly value: number | null;
  readonly dimension: DiscoverDimension;
  readonly newEntry: boolean;
}): string | null {
  const { value, dimension, newEntry } = input;
  // L308：既没数值也不是新上榜 → 整块不渲染（返回 null，调用方跳过）
  if (value === null && !newEntry) return null;
  // L309：新上榜且 RANKING → NEW（不看数值）
  if (newEntry && dimension === 'RANKING') return DISCOVER_TREND_NEW_LABEL;
  // L310：无变化
  if (value === null || value === 0) return DISCOVER_TREND_IDLE_LABEL;
  // L311 / L312
  return dimension === 'RANKING' ? discoverTrendRankingChange(value) : discoverTrendGrowthPercent(value);
}

/** Kotlin `L314`：`value != null && value >= 100 && dimension != RANKING` 时点亮「飙升」火苗。 */
export function trendIsHot(value: number | null, dimension: DiscoverDimension): boolean {
  return value !== null && value >= DISCOVER_TREND_HOT_THRESHOLD && dimension !== 'RANKING';
}

/** Kotlin `L318-319` 的颜色分支：NEW / idle / rise|fall（`reverse` 时互换）。 */
export function trendTone(input: {
  readonly label: string;
  readonly value: number | null;
  readonly reverse: boolean;
}): 'new' | 'idle' | 'rise' | 'fall' {
  if (input.label === DISCOVER_TREND_NEW_LABEL) return 'new';
  if (input.value === null || input.value === 0) return 'idle';
  return (input.value > 0) !== input.reverse ? 'rise' : 'fall';
}

/* ══════════════════════════════════════════════════════════════════════════════
 * `DiscoverCards.kt` L59-70 / L100-123 / L233-256 的卡片几何与徽标
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** Kotlin `L64` `RoundedCornerShape(LARGE 24 / GRID 16 / 其余 20)`。 */
export const DISCOVER_CARD_RADIUS_DP = {
  LARGE: 24,
  GRID: 16,
  LIST: 20,
} as const;

export type DiscoverCardLayout = keyof typeof DISCOVER_CARD_RADIUS_DP;

/** 按布局取卡片圆角（dp）。 */
export function discoverCardRadiusDp(layout: string): number {
  const key = layout.toUpperCase();
  return key === 'LARGE'
    ? DISCOVER_CARD_RADIUS_DP.LARGE
    : key === 'GRID'
      ? DISCOVER_CARD_RADIUS_DP.GRID
      : DISCOVER_CARD_RADIUS_DP.LIST;
}

/** Kotlin `L68-69`：前三名的奖牌描边 / 阴影。 */
export const DISCOVER_MEDAL_STYLE = {
  /** `Modifier.shadow(8.dp, shape, ambientColor = medal@.16, spotColor = medal@.24)`（仅 rank == 1）。 */
  shadowDp: 8,
  shadowAmbientAlpha: 0.16,
  shadowSpotAlpha: 0.24,
  /** `Modifier.border(if (rank == 1) 1.5.dp else 1.dp, …)`。 */
  borderWidthFirstDp: 1.5,
  borderWidthOtherDp: 1,
  /** `Brush.linearGradient(medal@.40, medal, medal@.56)`。 */
  gradientAlphas: [0.4, 1, 0.56] as const,
} as const;

/** Kotlin `L79-80`：LIST 行高 160dp、封面宽 120dp、行内间距 10dp。 */
export const DISCOVER_LIST_ROW = {
  rowHeightDp: 160,
  coverWidthDp: 120,
  gapDp: 10,
} as const;

/** Kotlin `L101/L105-106`：GRID 的 3:4 封面 + 底部 45% 的 .85 黑幕。 */
export const DISCOVER_GRID_COVER = {
  aspectRatio: 3 / 4,
  overlayHeightFraction: 0.45,
  overlayAlpha: 0.85,
} as const;

/** Kotlin `L121/L123`：LARGE 的 4:3 封面 + 底部 50% 的 .90 黑幕。 */
export const DISCOVER_LARGE_COVER = {
  aspectRatio: 4 / 3,
  overlayHeightFraction: 0.5,
  overlayAlpha: 0.9,
} as const;

/** Kotlin `L233-237` `SourceBadge`。 */
export const DISCOVER_SOURCE_BADGE = {
  maxWidthDp: 112,
  backgroundAlpha: 0.72,
  paddingHorizontalDp: 8,
  paddingVerticalDp: 4,
  fontSizeSp: 10,
  lineHeightSp: 12,
} as const;

/** Kotlin `L239-246` `FollowButton`：`size(if (compact) 48.dp else 28.dp)`、图标 20dp。 */
export const DISCOVER_FOLLOW_BUTTON = {
  compactSizeDp: 48,
  sizeDp: 28,
  iconSizeDp: 20,
} as const;

/** Kotlin `L247-256` `TagRow`：最多 3 个 + `+N` 溢出。 */
export const DISCOVER_TAG_ROW = {
  maxVisible: 3,
  backgroundAlpha: 0.06,
  paddingHorizontalDp: 6,
  paddingVerticalDp: 2,
  fontSizeSp: 11,
  lineHeightSp: 14,
} as const;

/** Kotlin `L322-338` `DiscoverSkeleton`。 */
export const DISCOVER_SKELETON = {
  /** `animateFloat(.4f, .8f, infiniteRepeatable(tween(600), RepeatMode.Reverse))`。 */
  alphaFrom: 0.4,
  alphaTo: 0.8,
  cycleMs: 600,
  /** 减少动态效果时的静态透明度。 */
  reducedAlpha: 0.6,
  /** LIST 分支的封面占位 72×96dp，右侧 3 行、行间距 12dp。 */
  listCoverWidthDp: 72,
  listCoverHeightDp: 96,
  listLineCount: 3,
  listLineGapDp: 12,
  paddingDp: 10,
} as const;
