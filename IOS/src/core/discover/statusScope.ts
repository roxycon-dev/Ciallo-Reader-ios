/**
 * 发现页状态作用域 —— `discover/DiscoverStatusScope.kt` L6-34 的逐行移植。
 *
 * Kotlin → TS 映射
 * ────────────────
 *   L6-18  `data class DiscoverStatusScope(completedOnly = false, newWorks = false)`：
 *          `showStatusChoices = !completedOnly && !newWorks`，
 *          `hint`（完结 / 新作 / null），`effectiveStatus(selection)`。
 *   L20-34 `discoverStatusScope(dimension, range, feedId, categoryId, catalog)`：
 *          label 的优先级 categoryId → feedId=="native" → feedId → RANKING 的 range；
 *          再用两条正则判 completed / newWorks（**负向标签优先**）。
 *
 * 关键：注释 L5「A ranking's meaning takes precedence over a leftover status selection.」
 * 与 L29「Negative labels such as 未完结 / uncompleted must never become completed feeds.」
 * 是两条必须逐字保留的语义。
 */

export type DiscoverDimensionName = 'UPDATES' | 'DISCUSSION' | 'CLICKS' | 'RANKING';

/** L6-18 `DiscoverStatusScope`。 */
export class DiscoverStatusScope {
  constructor(
    readonly completedOnly = false,
    readonly newWorks = false,
  ) {}

  /** L7 `showStatusChoices = !completedOnly && !newWorks`。 */
  get showStatusChoices(): boolean {
    return !this.completedOnly && !this.newWorks;
  }

  /** L8-12 `hint`：完结 / 新作 / null。 */
  get hint(): string | null {
    if (this.completedOnly) return '仅显示已确认完结的作品';
    if (this.newWorks) return '按原站新上架排序，作品可能仍在连载';
    return null;
  }

  /** L13-17 `effectiveStatus(selection)`。 */
  effectiveStatus(selection: string): string {
    if (this.completedOnly) return '完结';
    if (this.newWorks) return '全部';
    return selection;
  }
}

/** L30 的负向标签正则（**先判负向**）。 */
const NOT_COMPLETED = /未完[结結]|未[结結]束|不完[结結]|未完成|not\s+(?:yet\s+)?(?:completed|finished)|uncompleted|incomplete|unfinished|ongoing|连载|連載/i;
/** L31 的完结标签正则。 */
const COMPLETED = /完[结結]|已完成|(?<![a-z])(?:completed|finished|ended)(?![a-z])/i;
/** L32 的新作标签正则。 */
const NEW_WORKS = /新作|新[书書]|上架|(?<![a-z])new(?:\s+(?:releases|works))?(?![a-z])|recently\s+added/i;

/** 目录的最小投影（`DiscoverCatalog`）。 */
export interface DiscoverCatalogLike {
  readonly categories?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly feeds?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
}

/** L20-34 `discoverStatusScope(...)`。 */
export function discoverStatusScope(
  dimension: DiscoverDimensionName,
  range: string,
  feedId: string | null,
  categoryId: string | null,
  catalog: DiscoverCatalogLike | null = null,
): DiscoverStatusScope {
  let label = '';
  if (categoryId !== null) {
    label = catalog?.categories?.find((c) => c.id === categoryId)?.label ?? '';
  } else if (feedId === 'native') {
    label = catalog?.feeds?.[0]?.label ?? '';
  } else if (feedId !== null) {
    label = catalog?.feeds?.find((f) => f.id === feedId)?.label ?? '';
  } else if (dimension === 'RANKING') {
    label = range;
  }
  // L29-31：负向标签先判，绝不能变成「完结」。
  const completed =
    !NOT_COMPLETED.test(label) && COMPLETED.test(label);
  const newWorks = NEW_WORKS.test(label) && !completed;
  return new DiscoverStatusScope(completed, newWorks);
}
