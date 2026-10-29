/**
 * ComicTocSheet.tsx — 目录面板。
 *
 * Kotlin 行号映射（`ComicReaderSheets.kt`）：
 *   - 1278–1348 ComicTocSheet
 *   - 1292–1295 `ComicSheetContainer(title = "目录", heightFraction = 0.7f, scrollable = false)`
 *   - 1296–1334 有目录时：`LazyColumn(itemsIndexed(toc, key = entry.id))`
 *   - 1302      2026-09-21：补 key（章节 id 稳定唯一），并挂重排动画
 *   - 1303–1333 章节行（左侧 3×18 竖条指示 + 标题 + 选中打勾）
 *   - 1335–1346 本地漫画：页缩略图网格（`LazyVerticalGrid(Adaptive(72.dp))`）
 *   - 1350–1391 PageThumbCell
 *
 * 适配与跳过：
 *   - L1297–1300 `rememberLazyListState(initialFirstVisibleItemIndex=…)` +
 *     `LaunchedEffect { scrollToItem(...) }` → 渲染后 `scrollIntoView` 定位当前章
 *     （`useEffect`，不读 ref 于 render）。
 *   - L1307 `animateItemPlacement()`（重排动画）→ CSS `transition` + key 稳定；
 *     本列表不做位移重排，仅保留淡入。
 *   - L1311 `onJumpToChapter?.invoke(i)` 可空回调 → `onJumpToChapter === null` 时不可点。
 *   - L1337–1345 `LazyVerticalGrid` → CSS grid `repeat(auto-fill, minmax(72px, 1fr))`，
 *     间距 8px（Kotlin 1339–1340）。
 *   - L1358–1360 `produceState { loader.loadThumb(page) }`（Bitmap）→
 *     `loader.loadThumb(page)` 返回 URL，`<img onError>` 回落追光点（Adaptation #6）。
 *   - L1383 `contentScale = ContentScale.Crop` → `object-fit: cover`。
 *   - L1384 `ChasingDots(size = 14.dp, circleRatio = 0.3f)` → 同参数 CSS 追光点。
 *   - L1388 页码 `${index + 1}`，选中用薄荷绿。
 */
import { useEffect, useRef, useState } from 'react';
import {
  TOC_SHEET_HEIGHT,
  TOC_THUMB_MIN_WIDTH,
  type ComicSheetsPageRef,
  type ComicSheetsTocEntry,
} from '@core/comic/comicReaderSheets';
import { ChasingDots, ComicSheetOverlay } from './comicSheetParts';
import { ComicIcon } from './ComicIcon';
import { scrollElementIntoView } from '../../../lib/scroll';

/** 进度缩略图加载器（Kotlin `loader.loadThumb(ref, edge = 220)`） */
export interface ComicThumbLoader {
  loadThumb(page: ComicSheetsPageRef): Promise<string | null>;
}

export interface ComicTocSheetProps {
  toc: readonly ComicSheetsTocEntry[];
  currentChapterIndex: number;
  onJumpToChapter: ((index: number) => void) | null;
  pages: readonly ComicSheetsPageRef[];
  loader: ComicThumbLoader;
  currentPage: number;
  onJumpToRawPage: (index: number) => void;
  /** Kotlin `comicPanelGlass(backdrop, shape)`：宿主传 `panelGlassSamplingActive(...)` */
  glass?: boolean | undefined;
  onDismiss: () => void;
}

/* ── 章节行（Kotlin 1303–1333） ── */

function TocRow(props: {
  entry: ComicSheetsTocEntry;
  index: number;
  active: boolean;
  onClick: (() => void) | null;
}) {
  return (
    <button
      type="button"
      key={props.entry.id}
      className={props.active ? 'cmcs-toc__row cmcs-toc__row--active' : 'cmcs-toc__row'}
      aria-current={props.active ? 'true' : undefined}
      /* Kotlin 1303 `key = entry.id`；data-active 是 L151–156 定位当前章的锚点，
         必须真的落到 DOM 上（此前只写了 class/aria-current，querySelector 恒为
         null，「打开目录自动滚到当前章」从来没生效过）。 */
      data-active={props.active ? 'true' : undefined}
      disabled={props.onClick === null}
      onClick={() => props.onClick?.()}
    >
      <span
        className={props.active ? 'cmcs-toc__bar cmcs-toc__bar--active' : 'cmcs-toc__bar'}
        aria-hidden="true"
      />
      <span className="cmcs-toc__gap10" />
      <span
        className={props.active ? 'cmcs-toc__title cmcs-toc__title--active' : 'cmcs-toc__title'}
      >
        {props.entry.title}
      </span>
      {props.active ? (
        <span className="cmcs-toc__check" aria-hidden="true">
          <ComicIcon name="Check" size={15} />
        </span>
      ) : null}
    </button>
  );
}

/* ── PageThumbCell（Kotlin 1350–1391） ── */

function PageThumbCell(props: {
  page: ComicSheetsPageRef;
  index: number;
  loader: ComicThumbLoader;
  active: boolean;
  onClick: () => void;
}) {
  const { page, loader, index, active, onClick } = props;
  // Kotlin 1358 `produceState<Bitmap?>(null, page.id)`：以 page.id 为失效键。
  // 「重置为加载中」由 key 不匹配在渲染期推导，不在 effect 里同步 setState
  // （避开 React 19 级联渲染告警），语义与 Kotlin 的 produceState 相同。
  const [result, setResult] = useState<{ key: string; url: string | null }>({
    key: page.id,
    url: null,
  });
  const [brokenKey, setBrokenKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loader.loadThumb(page).then((url) => {
      if (cancelled) return;
      setResult({ key: page.id, url });
    });
    return () => {
      cancelled = true;
    };
  }, [page, loader]);

  const src = result.key === page.id ? result.url : null;
  const failed = brokenKey === page.id || src === null;

  return (
    <button
      type="button"
      className={active ? 'cmcs-thumb cmcs-thumb--active' : 'cmcs-thumb'}
      aria-label={`${index + 1}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="cmcs-thumb__frame">
        {src !== null && !failed ? (
          <img className="cmcs-thumb__img" src={src} alt="" onError={() => setBrokenKey(page.id)} />
        ) : (
          <ChasingDots size={14} color="var(--cmcs-mint)" circleRatio={0.3} />
        )}
      </span>
      <div className="cmcs-thumb__gap3" />
      <span className={active ? 'cmcs-thumb__no cmcs-thumb__no--active' : 'cmcs-thumb__no'}>
        {index + 1}
      </span>
    </button>
  );
}

export function ComicTocSheet(props: ComicTocSheetProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const startIndex = props.currentChapterIndex > 0 ? props.currentChapterIndex : 0;

  // Kotlin 1298–1300 `LaunchedEffect(Unit) { listState.scrollToItem(currentChapterIndex) }`
  useEffect(() => {
    const root = listRef.current;
    if (root === null) return;
    const target = root.querySelector<HTMLElement>('[data-active="true"]');
    // jsdom 不实现 scrollIntoView；宿主环境缺这个 API 时静默跳过定位
    // （Kotlin `scrollToItem` 在无滚动容器时同样是无副作用的空操作）。
    scrollElementIntoView(target, { block: 'nearest' });
  }, [startIndex]);

  return (
    <ComicSheetOverlay
      onDismiss={props.onDismiss}
      ariaLabel="目录"
      className="cmcs-sheet--toc"
      style={{ height: `${TOC_SHEET_HEIGHT * 100}dvh` }}
      glass={props.glass}
    >
      <div className="cmcs-sheet__title">目录</div>
      <div className="cmcs-sheet__body cmcs-sheet__body--flush" ref={listRef}>
        {props.toc.length > 0 ? (
          <div className="cmcs-toc">
            {props.toc.map((entry, i) => (
              <TocRow
                key={entry.id}
                entry={entry}
                index={i}
                active={i === props.currentChapterIndex}
                onClick={props.onJumpToChapter === null ? null : () => props.onJumpToChapter?.(i)}
              />
            ))}
          </div>
        ) : (
          // 本地漫画：页缩略图网格
          <div className="cmcs-thumbgrid" style={{ minWidth: `${TOC_THUMB_MIN_WIDTH}px` }}>
            {props.pages.map((page, i) => (
              <PageThumbCell
                key={page.id}
                page={page}
                index={i}
                loader={props.loader}
                active={i === props.currentPage - 1}
                onClick={() => props.onJumpToRawPage(i)}
              />
            ))}
          </div>
        )}
      </div>
    </ComicSheetOverlay>
  );
}
