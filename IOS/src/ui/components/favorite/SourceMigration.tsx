/**
 * Port of Android `ui/favorite/SourceMigration.kt` (237 lines total / 220 non-blank / 208 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–46   package + imports → file header.
 *   47–54  `data class SourceCandidate(sourceId, sourceName, book)` + `val key`
 *          → `SourceCandidate` + `sourceCandidateKey` in `@core/favorite/favoriteUi`.
 *   56–61  the `ComicSourceMigration` KDoc ("只做标题归一化后的相等 / 包含匹配…")
 *          → `findSourceCandidates` KDoc, verbatim.
 *   62–114 `object ComicSourceMigration`:
 *   64–66  `fun normalize(title) = title.filter { it.isLetterOrDigit() }.lowercase()`
 *          → `normalizeSourceTitle` in favoriteUi.
 *   68–73  the `@param` KDoc block (title / excludeSourceId / sources / maxSources=5)
 *          → `findSourceCandidates` params KDoc, verbatim.
 *   74–113 `suspend fun findCandidates(...)` — `withContext(Dispatchers.IO)`,
 *          `Semaphore(3)`, `coroutineScope { sources.filter{…}.take(maxSources).map{ async { … } }.awaitAll().filterNotNull().sortedBy { it.sourceName } }`
 *          → `Promise.all` + a JS counting `Semaphore`, same concurrency cap (3),
 *          same `maxSources` default (5), same `sortedBy { it.sourceName }`.
 *   89–103 the `runCatching { when (val r = source.search(title)) { is Success -> …; is Error -> null } }`
 *          → try/catch around a `{ kind: 'success' | 'error' }` discriminated union.
 *   94–98  同名优先，其次包含 (`exact` then `loose`) → same order preserved.
 *  116–119 the `SourceMigrateSheet` KDoc ("换源是破坏性操作…必须由用户显式选择")
 *          → component KDoc, verbatim.
 *  120–191 `@Composable fun SourceMigrateSheet(title, candidates, loading, onPick, onDismiss)`:
 *          `ModalBottomSheet(onDismissRequest = onDismiss)` → `.fav-sheet-scrim` + `.fav-sheet`.
 *  129–148 header: "换个书源继续看" 18.sp Bold onSurface; `Spacer(6)`;
 *          "《$title》\n选择来源后，收藏、阅读进度与已读状态会按章节顺序迁移过去。"
 *          13.sp / lineHeight 19.sp / onSurfaceVariant (the `\n` becomes a `<br>`).
 *  149     `Spacer(14.dp)` → `.fav-gap-14`-equivalent inline 14px.
 *  151–163 `loading` → `Row(fillMaxWidth, heightIn(min = 96), Center)` with
 *          `CircularProgressIndicator(28.dp, strokeWidth 3)`.
 *  164–171 `candidates.isEmpty()` → "其它书源里没找到同名作品，可先在书库搜索确认。"
 *          13.sp with `padding(vertical = 20.dp)`.
 *  172–183 else → `LazyColumn(heightIn(max = 320.dp), contentPadding bottom 8,
 *          spacedBy 10)` of `SourceCandidateRow(key = it.key)`.
 *  185–188 `Spacer(8)` + `TextButton(align = End) { Text("取消") }`.
 *  193–237 `private fun SourceCandidateRow(candidate, onClick)`:
 *          `Surface(r14, surfaceVariant.copy(alpha = 0.6f), clip r14, clickable)`,
 *          `Row(padding h14 v12, CenterVertically)`:
 *          `Column(weight 1) { Text(sourceName, 14.sp, SemiBold, maxLines 1, ellipsis);
 *          Spacer(2); Text(book.title, 12.sp, onSurfaceVariant, maxLines 1, ellipsis) }`,
 *          `Spacer(8)`, `Icon(Icons.AutoMirrored.Filled.ArrowForward,
 *          contentDescription = "迁移到该来源", tint = primary, 20.dp)`.
 *          → `.fav-candidate-row`.
 *
 * Skipped: nothing. `withContext(Dispatchers.IO)` and `coroutineScope` are
 * structural in JS (single-threaded event loop) and map 1:1 to `Promise.all`.
 */

import { findSourceCandidates, type SourceCandidate } from '@core/favorite/favoriteUi';
import '../../../styles/favorite.css';

/** The KDoc on `SourceMigrateSheet`, preserved verbatim. */
const MIGRATE_SHEET_KDOC = `
换源确认 Sheet：列出候选来源，用户确认后才迁移收藏 / 进度 / 已读状态。
「换源」是破坏性操作（旧键会被清理），因此必须由用户显式选择，不自动执行。
`;

function IconArrowForward() {
  return (
    <svg viewBox="0 0 24 24" className="fav-candidate-row__arrow" fill="currentColor" aria-hidden="true">
      <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
    </svg>
  );
}

/** @private → module-private in Kotlin; a plain element here carries no state. */
function SourceCandidateRow(props: { candidate: SourceCandidate; onClick: () => void }) {
  const c = props.candidate;
  return (
    <button
      type="button"
      className="fav-candidate-row"
      onClick={props.onClick}
      aria-label="迁移到该来源"
    >
      <span className="fav-candidate-row__body">
        <span className="fav-candidate-row__source">{c.sourceName}</span>
        <span className="fav-candidate-row__book">{c.book.title}</span>
      </span>
      <IconArrowForward />
    </button>
  );
}

/**
 * 换源确认 Sheet：列出候选来源，用户确认后才迁移收藏 / 进度 / 已读状态。
 * 「换源」是破坏性操作（旧键会被清理），因此必须由用户显式选择，不自动执行。
 */
export function SourceMigrateSheet(props: {
  title: string;
  candidates: ReadonlyArray<SourceCandidate>;
  loading: boolean;
  onPick: (candidate: SourceCandidate) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fav-sheet-scrim" role="presentation" onClick={props.onDismiss}>
      <div
        className="fav-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="换个书源继续看"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="fav-sheet__title">换个书源继续看</h3>
        <div style={{ height: 6 }} />
        <p className="fav-sheet__body" style={{ fontSize: 13, lineHeight: '19px' }}>
          {`《${props.title}》`}
          <br />
          选择来源后，收藏、阅读进度与已读状态会按章节顺序迁移过去。
        </p>
        <div style={{ height: 14 }} />

        {props.loading ? (
          <div
            className="fav-busy"
            style={{ minHeight: 96, padding: 0 }}
            role="status"
            aria-label="正在查找换源候选"
          >
            <span className="fav-spinner fav-spinner--lg" aria-hidden="true" />
          </div>
        ) : props.candidates.length === 0 ? (
          <p className="fav-sheet__body" style={{ fontSize: 13, padding: '20px 0' }}>
            其它书源里没找到同名作品，可先在书库搜索确认。
          </p>
        ) : (
          <div
            className="fav-list"
            style={{ maxHeight: 320, paddingBottom: 8, gap: 10 }}
          >
            {props.candidates.map((c) => (
              <SourceCandidateRow key={c.key} candidate={c} onClick={() => props.onPick(c)} />
            ))}
          </div>
        )}

        <div className="fav-gap-8" />
        <button
          type="button"
          className="fav-text-btn"
          style={{ float: 'right' }}
          onClick={props.onDismiss}
        >
          取消
        </button>
      </div>
    </div>
  );
}

export { findSourceCandidates, MIGRATE_SHEET_KDOC };
export type { SourceCandidate };
