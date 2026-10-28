/**
 * Port of Android `ui/favorite/DuplicateComicSheet.kt` (122 lines total / 120 non-blank / 119 code).
 *
 * Full-line map (Kotlin line → TS):
 *   1–23   package + imports → file header. `TitleNormalizer.compact` is imported from
 *          `@core/data/titleNormalizer` (already ported) — no duplication.
 *   24     the KDoc "All add entrances share this decision…" → component KDoc, verbatim.
 *   25–41  `@Composable fun DuplicateComicSheet(request, sourceName, onDismiss, onConfirm)`
 *          + `var manual/query/selected by remember(request.book.sourceId, request.book.id)`
 *          → `useState` triple; the `remember(key1, key2)` reset semantics are
 *          reproduced with a `useEffect` that resets on `(book.sourceId, book.id)`.
 *   36     `TitleNormalizer.compact(query)` → `compact(query)`.
 *   37–40  `shown = if (manual) request.favorites.filter { … } else request.candidates.map { it.favorite }`
 *          → derived during render (no `setState`-in-effect trap).
 *   41–44  `ModalBottomSheet(onDismissRequest = { if (!request.busy) onDismiss() },
 *          sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true))`
 *          → `.fav-sheet-scrim` + `.fav-sheet`.
 *   45     `Column(fillMaxWidth, verticalScroll, padding horizontal 20, navigationBarsPadding)`
 *          → `.fav-sheet`.
 *   46–47  "可能重复的作品" headlineSmall SemiBold → `.fav-sheet__title`.
 *   48–50  "「${request.book.title}」 · ${sourceName(request.book.sourceId)}" titleSmall → `.fav-sheet__subtitle`.
 *   51–53  explanation bodyMedium onSurfaceVariant → `.fav-sheet__body` (verbatim).
 *   54–56  `TextButton(enabled = !request.busy) { Text(if (manual) "返回相似作品" else "另一种译名？手动选旧收藏") }`
 *          → `.fav-text-btn`.
 *   57–61  `manual` branch: `OutlinedTextField(query, label "搜喜欢里的书名或作者", singleLine)`
 *          → `.fav-outlined-field` input.
 *   62–90  `LazyColumn(heightIn(max = 280.dp), spacedBy 8)` of `Surface(r16,
 *          color = chosen ? primaryContainer : surfaceContainerHigh, clickable(!busy))`
 *          rows: `AsyncImage(localThumbPath ?: coverUrl, Crop, 56×78, r8)`,
 *          title (SemiBold, maxLines 2, ellipsis), author (bodySmall, maxLines 1) when
 *          non-blank, `sourceName(sourceId)` (labelMedium, primary), optional
 *          "最新：${latestChapterTitle}" (bodySmall, maxLines 1), the matching
 *          candidate's `reason` (labelSmall, onSurfaceVariant), and a `RadioButton`.
 *          → `.fav-list` + `.fav-list-row` + `.fav-radio`.
 *          ⚠️ ADAPTATION: a `.map()` callback may not contain hooks, so the row is a
 *          plain element (no hooks were needed) — the key is `${sourceId}::${comicId}`.
 *   91–93  `else if (manual)` → "没有匹配的旧收藏，换个关键词试试".
 *   94–98  `selected?.let { Spacer(12); Text("会保留旧收藏的分类，按话号 / 卷号 / 标题迁移已读和书签。页码从对应话的第一页开始；未匹配记录保留在旧来源。") }`
 *   99     `request.error?.let { Text(it, color = error) }` → `.fav-error`.
 *   100–101 `Spacer(16.dp)` → `.fav-gap-16`.
 *   101–107 `request.busy` → `CircularProgressIndicator(20.dp, strokeWidth 2)` + Spacer 10 + "正在保存与迁移…"
 *   108–118 else: `Button("替换这一本并迁移阅读记录")` when selected;
 *           `Button("依然添加 · 两本并存")` when selected == null else
 *           `TextButton("依然添加 · 两本并存")`; `TextButton("取消")`.
 *   119–120 `Spacer(12.dp)` → `.fav-gap-12`.
 *
 * Skipped: nothing. The Compose `Surface`/`LazyColumn`/`CircularProgressIndicator`
 * chrome becomes CSS; every user-visible Chinese string is verbatim.
 */

import { useState } from 'react';
import { compact } from '@core/data/titleNormalizer';
import { favoriteKey, type FavoriteEntity, type FavoriteAddRequest } from '@core/library/favoriteTypes';
import '../../../styles/favorite.css';

const MINT_PRIMARY = '#059669';

function BusyRow() {
  return (
    <div className="fav-busy">
      <span className="fav-spinner" aria-hidden="true" />
      <span>正在保存与迁移…</span>
    </div>
  );
}

function DuplicateCandidateRow(props: {
  favorite: FavoriteEntity;
  chosen: boolean;
  busy: boolean;
  reason: string | null;
  sourceName: (sourceId: string) => string;
  onPick: (favorite: FavoriteEntity) => void;
}) {
  const fav = props.favorite;
  const cover = fav.localThumbPath ?? fav.coverUrl;
  return (
    <button
      type="button"
      className={props.chosen ? 'fav-list-row fav-list-row--chosen' : 'fav-list-row'}
      disabled={props.busy}
      aria-pressed={props.chosen}
      onClick={() => props.onPick(fav)}
    >
      {cover != null && cover.trim() !== '' ? (
        <img
          className="fav-list-row__thumb"
          src={cover}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden';
          }}
        />
      ) : (
        <span className="fav-list-row__thumb" aria-hidden="true" />
      )}
      <span className="fav-list-row__body">
        <span className="fav-list-row__title">{fav.title}</span>
        {fav.author.trim() !== '' ? (
          <span className="fav-list-row__line">{fav.author}</span>
        ) : null}
        <span className="fav-list-row__line fav-list-row__line--primary">
          {props.sourceName(fav.sourceId)}
        </span>
        {fav.latestChapterTitle != null ? (
          <span className="fav-list-row__line">{`最新：${fav.latestChapterTitle}`}</span>
        ) : null}
        {props.reason != null ? <span className="fav-list-row__reason">{props.reason}</span> : null}
      </span>
      <span
        className={props.chosen ? 'fav-radio fav-radio--on' : 'fav-radio'}
        aria-hidden="true"
        style={props.chosen ? { borderColor: MINT_PRIMARY } : undefined}
      />
    </button>
  );
}

/** All add entrances share this decision; selecting a card never performs migration by itself. */
export function DuplicateComicSheet(props: {
  request: FavoriteAddRequest;
  sourceName: (sourceId: string) => string;
  onDismiss: () => void;
  onConfirm: (favorite: FavoriteEntity | null) => void;
}) {
  const { request } = props;
  // Kotlin L33–35: `var manual/query/selected by remember(request.book.sourceId, request.book.id)`.
  //
  // ⚠️ The web `FavoriteAddRequest` (`core/library/favoriteTypes.ts`) flattens
  // `request.book`: `bookId` carries the `sourceId::comicId` composite key and
  // `sourceId` / `title` / `author` / `cover` are lifted to the top level, so the
  // remember-key pair below collapses into the single composite `request.bookId`.
  //
  // ⚠️ ADAPTATION: Compose's `remember(k1, k2) { mutableStateOf(…) }` discards and
  // recreates the state whenever `k1`/`k2` change. React's sanctioned equivalent is the
  // "adjust state during render" pattern (documented by the React team for exactly this
  // `remember(key)` case) — it avoids the setState-in-effect cascade.
  const sheetKey = request.bookId;
  const [resetKey, setResetKey] = useState(sheetKey);
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FavoriteEntity | null>(null);
  if (resetKey !== sheetKey) {
    setResetKey(sheetKey);
    setManual(false);
    setQuery('');
    setSelected(null);
  }

  const normalizedQuery = compact(query);
  const shown: FavoriteEntity[] = manual
    ? request.favorites.filter(
        (it) =>
          normalizedQuery.trim() === '' ||
          compact(it.title).includes(normalizedQuery) ||
          compact(it.author).includes(normalizedQuery),
      )
    : request.candidates.map((it) => it.favorite);

  const reasonOf = (favorite: FavoriteEntity): string | null => {
    const hit = request.candidates.find((it) => it.favorite === favorite);
    return hit === undefined ? null : hit.reason;
  };

  return (
    <div
      className="fav-sheet-scrim"
      role="presentation"
      onClick={() => {
        if (!request.busy) props.onDismiss();
      }}
    >
      <div
        className="fav-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="可能重复的作品"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="fav-sheet__title">可能重复的作品</h3>
        <div className="fav-gap-8" />
        <p className="fav-sheet__subtitle">
          {`「${request.title}」 · ${props.sourceName(request.sourceId)}`}
        </p>
        <div className="fav-gap-8" />
        <p className="fav-sheet__body">
          喜欢里有名称相似的作品。选一本替换并迁移阅读标记，或让两个来源并存。
        </p>
        <button
          type="button"
          className="fav-text-btn"
          disabled={request.busy}
          onClick={() => {
            setManual((v) => !v);
            setSelected(null);
          }}
        >
          {manual ? '返回相似作品' : '另一种译名？手动选旧收藏'}
        </button>
        {manual ? (
          <>
            <input
              className="fav-outlined-field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={request.busy}
              placeholder="搜喜欢里的书名或作者"
              aria-label="搜喜欢里的书名或作者"
            />
            <div className="fav-gap-8" />
          </>
        ) : null}
        {shown.length > 0 ? (
          <div className="fav-list" style={{ marginTop: 8 }}>
            {shown.map((favorite) => (
              <DuplicateCandidateRow
                key={favoriteKey(favorite.sourceId, favorite.comicId)}
                favorite={favorite}
                chosen={selected === favorite}
                busy={request.busy}
                reason={reasonOf(favorite)}
                sourceName={props.sourceName}
                onPick={(fav) => setSelected(selected === fav ? null : fav)}
              />
            ))}
          </div>
        ) : manual ? (
          <p className="fav-sheet__body">没有匹配的旧收藏，换个关键词试试</p>
        ) : null}
        {selected != null ? (
          <>
            <div className="fav-gap-12" />
            <p className="fav-sheet__body">
              会保留旧收藏的分类，按话号 / 卷号 / 标题迁移已读和书签。页码从对应话的第一页开始；未匹配记录保留在旧来源。
            </p>
          </>
        ) : null}
        {request.error != null ? <p className="fav-error">{request.error}</p> : null}
        <div className="fav-gap-16" />
        {request.busy ? (
          <BusyRow />
        ) : (
          <>
            {selected != null ? (
              <button type="button" className="fav-btn" onClick={() => props.onConfirm(selected)}>
                替换这一本并迁移阅读记录
              </button>
            ) : (
              <button type="button" className="fav-btn" onClick={() => props.onConfirm(null)}>
                依然添加 · 两本并存
              </button>
            )}
            {selected != null ? (
              <button
                type="button"
                className="fav-text-btn fav-text-btn--full"
                onClick={() => props.onConfirm(null)}
              >
                依然添加 · 两本并存
              </button>
            ) : null}
            <button type="button" className="fav-text-btn fav-text-btn--full" onClick={props.onDismiss}>
              取消
            </button>
          </>
        )}
        <div className="fav-gap-12" />
      </div>
    </div>
  );
}
