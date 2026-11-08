/**
 * Ported line-by-line from Android:
 *  - god/GodRankingExhibits.kt (GodPodiumStyle / GodPodiumTopThree / GodVinylStyle /
 *                                GodRecordDisc / GodPolaroidStyle)
 *  - god/GodRankingStyles.kt    (GodRankingBody + 长按菜单/删除确认/随笔原文弹窗)
 *  - god/GodRankingCard.kt      (统计页卡片 GodRankingCard + GodCountPill 用法)
 *
 * Android source (read-only): novel-reader/app/src/main/java/com/example/god/
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GlassCard } from '@ui/components/GlassCard';
import {
  effectiveGodTitle,
  rankGodMoments,
  type GodMoment,
  type GodMomentItem,
} from '@core/god/godTypes';
import { type GodRankingStyleCode } from '@core/god/godRankingSettings';
import {
  EMPTY_GOD_INTERACTIONS,
  GodCoverImage,
  GodDialog,
  GodEmptyState,
  GodCountPill,
  GodItemCard,
  GodItemMenu,
  GodStarsReadonly,
  godIsDark,
  godRatingText,
  godRankStamp2,
  godTiltFactor,
  requestGodTiltPermission,
  useGodTilt,
  type GodRankingInteractions,
} from './GodRankingShared';
import { scrollElementTo } from '../../lib/scroll';

/** GodCoverEngine.COVER_RATIO = 3f / 4f */
const COVER_RATIO = '3 / 4';

function alpha(hex: string, a: number): string {
  const full = hex.replace('#', '');
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/* ══════════════ 风格切换过渡（AnimatedContent: fadeIn 280 + scaleIn 0.97） ══════════════ */

function GodStyleSwitch(props: {
  style: GodRankingStyleCode;
  reduceMotion: boolean;
  children: ReactNode;
}) {
  return (
    <div
      key={props.style}
      className={props.reduceMotion ? 'god-anim god-anim--quick' : 'god-anim'}
    >
      {props.children}
    </div>
  );
}

/* ══════════════ PODIUM（领奖台 — GodRankingExhibits.kt L51-232） ══════════════ */

interface PodiumCellProps {
  item: GodMomentItem;
  compact: boolean;
  reduceMotion: boolean;
  dark: boolean;
  interactions: GodRankingInteractions;
  setInteractions: (next: GodRankingInteractions) => void;
  onItemClick: (moment: GodMoment) => void;
}

/** 一个台座单元（hook 调用必须在组件顶层 → 拆出 Cell）。 */
function GodPodiumCell(props: PodiumCellProps) {
  const { item, compact, reduceMotion, dark } = props;
  const rank = item.rank;
  const winner = rank === 1;
  // accent：1 金 / 2 银 / 3 铜（GodRankingExhibits.kt L134-138）
  const accent = rank === 1 ? '#D6AC62' : rank === 2 ? '#ADB6C0' : '#C49A7A';
  // stone（light）：L139-143
  const stone = dark
    ? rank === 1
      ? '#4E412E'
      : rank === 2
        ? '#3C4148'
        : '#4B3D36'
    : rank === 1
      ? '#EBDFC5'
      : rank === 2
        ? '#E0E4E8'
        : '#E8D9CE';
  // 台座高度：rank1 98(76 compact) / rank2 66(50) / rank3 52(38)（L186-192）
  const stoneHeight = winner
    ? compact
      ? 76
      : 98
    : rank === 2
      ? compact
        ? 50
        : 66
      : compact
        ? 38
        : 52;

  return (
    <div
      className="god-pod__cell"
      style={{ flexGrow: winner ? 1.12 : 1, flexBasis: 0 }}
    >
      <GodItemCard
        moment={item.entity}
        reduceMotion={reduceMotion}
        interactions={props.interactions}
        setInteractions={props.setInteractions}
        onItemClick={props.onItemClick}
        className="god-pod__card"
      >
        <div className="god-pod__inner">
          {/* 封面：width 105(winner)/88、aspect 3/4、tilt、shadow 8、clip 9 */}
          <div className="god-pod__cover-wrap" style={{ width: winner ? 105 : 88 }}>
            <GodCoverImage
              moment={item.entity}
              className="god-pod__cover"
              style={{ aspectRatio: COVER_RATIO, ...godTiltFactor(winner ? 0.4 : 0.2) }}
            />
          </div>
          <div className="god-pod__spacer7" />
          <p
            className="god-pod__name"
            style={{
              fontSize: winner ? 11 : 10,
              fontWeight: winner ? 600 : 500,
            }}
          >
            {effectiveGodTitle(item.entity)}
          </p>
          <p className="god-pod__rating" style={{ color: accent }}>
            {godRatingText(item.entity.rating)} ★
          </p>
          <div className="god-pod__spacer8" />
          {/* 台座：顶部圆角 9、金/银/铜渐变、1dp accent 描边 */}
          <div
            className="god-pod__stone"
            style={{
              height: stoneHeight,
              background: `linear-gradient(180deg, ${stone} 0%, ${alpha(stone, 0.76)} 100%)`,
              borderColor: alpha(accent, dark ? 0.48 : 0.64),
            }}
          >
            <span
              className="god-pod__stone-rank"
              style={{
                color: dark ? accent : '#594936',
                fontSize: winner ? 30 : 24,
              }}
            >
              {rank}
            </span>
          </div>
        </div>
      </GodItemCard>
    </div>
  );
}

interface ExhibitProps {
  items: readonly GodMomentItem[];
  compact: boolean;
  reduceMotion: boolean;
  interactions: GodRankingInteractions;
  setInteractions: (next: GodRankingInteractions) => void;
  onItemClick: (moment: GodMoment) => void;
}

function GodPodiumTopThree(props: ExhibitProps) {
  const { items, compact, reduceMotion } = props;
  const dark = godIsDark();
  // order = if (items.size >= 3) listOf(1, 0, 2) else items.indices（L124）
  const order = items.length >= 3 ? [1, 0, 2] : items.map((_, index) => index);
  const leader = items[0]?.entity;

  return (
    <div className="god-pod">
      <div className="god-pod__row">
        {order.map((index) => {
          const item = items[index];
          if (item === undefined) return null;
          return (
            <GodPodiumCell
              key={item.entity.id}
              item={item}
              compact={compact}
              reduceMotion={reduceMotion}
              dark={dark}
              interactions={props.interactions}
              setInteractions={props.setInteractions}
              onItemClick={props.onItemClick}
            />
          );
        })}
      </div>
      {leader !== undefined && leader.note.trim() !== '' ? (
        <p
          className="god-leader-note"
          role="button"
          tabIndex={0}
          onClick={() =>
            props.setInteractions({ ...props.interactions, noteFor: leader })
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              props.setInteractions({ ...props.interactions, noteFor: leader });
            }
          }}
        >
          {leader.note}
        </p>
      ) : null}
    </div>
  );
}

function GodPodiumStyle(props: ExhibitProps) {
  if (props.items.length === 0) return null;
  return (
    <div className="god-pod-column">
      <GodPodiumTopThree {...props} />
      {props.items.slice(3).map((item) => (
        <GodItemCard
          key={item.entity.id}
          moment={item.entity}
          reduceMotion={props.reduceMotion}
          interactions={props.interactions}
          setInteractions={props.setInteractions}
          onItemClick={props.onItemClick}
          className="god-pod-row"
        >
          {/* Row：clip 12 / surfaceVariant 0.28 / padding 12×10 / spacedBy 12（L72-107） */}
          <span className="god-pod-row__rank">{godRankStamp2(item.rank)}</span>
          <div className="god-pod-row__main">
            <p className="god-pod-row__title">{effectiveGodTitle(item.entity)}</p>
            <p className="god-pod-row__book">{item.entity.bookTitle}</p>
            {item.entity.note.trim() !== '' ? (
              <p
                className="god-pod-row__note"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  props.setInteractions({ ...props.interactions, noteFor: item.entity });
                }}
              >
                {item.entity.note}
              </p>
            ) : null}
          </div>
          <span className="god-pod-row__rating">
            {godRatingText(item.entity.rating)} ★
          </span>
        </GodItemCard>
      ))}
    </div>
  );
}

/* ══════════════ VINYL（唱片架 — GodRankingExhibits.kt L234-365） ══════════════ */

/** GodRecordDisc — 黑胶纹路（L350-365）。 */
function GodRecordDisc(props: { size: number }) {
  const r = props.size / 2;
  return (
    <svg
      className="god-vinyl__disc"
      width={props.size}
      height={props.size}
      viewBox={`0 0 ${props.size} ${props.size}`}
      aria-hidden="true"
      style={{ width: props.size, height: props.size }}
    >
      <circle cx={r} cy={r} r={r} fill="#202124" />
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <circle
          key={i}
          cx={r}
          cy={r}
          r={r * (0.4 + i * 0.075)}
          fill="none"
          stroke="rgba(255, 255, 255, 0.045)"
          strokeWidth="1"
        />
      ))}
      <circle cx={r} cy={r} r={r * 0.27} fill="#B89A67" />
      <circle cx={r} cy={r} r={r * 0.035} fill="#25231F" />
    </svg>
  );
}

/** 唱片架单页（hook 必须在组件顶层 → 拆出 Page）。 */
function GodVinylPage(props: {
  item: GodMomentItem;
  index: number;
  pageWidth: number;
  sleeveWidth: number;
  discSize: number;
  reduceMotion: boolean;
  interactions: GodRankingInteractions;
  setInteractions: (next: GodRankingInteractions) => void;
  onItemClick: (moment: GodMoment) => void;
  onTap: () => void;
}) {
  return (
    <div className="god-vinyl__page" style={{ width: props.pageWidth }}>
      {/* 唱片只露出套封的一侧；纹路 tilt.x * 0.4（L266-272） */}
      <div className="god-vinyl__disc-wrap" style={godTiltFactor(0.4)}>
        <GodRecordDisc size={props.discSize} />
      </div>
      {/* sleeve 定位层与手势层分离：GodItemCard 的内联 transform 不覆盖居中位移 */}
      <div className="god-vinyl__sleeve-pos" style={{ width: props.sleeveWidth }}>
        <GodItemCard
          moment={props.item.entity}
          reduceMotion={props.reduceMotion}
          interactions={props.interactions}
          setInteractions={props.setInteractions}
          onItemClick={props.onItemClick}
          className="god-vinyl__sleeve"
          onTap={props.onTap}
        >
          <div className="god-vinyl__sleeve-inner">
            <GodCoverImage moment={props.item.entity} style={{ aspectRatio: COVER_RATIO }} />
            <span className="god-vinyl__rank">{godRankStamp2(props.item.rank)}</span>
          </div>
        </GodItemCard>
      </div>
    </div>
  );
}

function GodVinylStyle(props: ExhibitProps) {
  const { items, compact, reduceMotion } = props;
  const [page, setPage] = useState(0);
  const pagerRef = useRef<HTMLDivElement | null>(null);

  if (items.length === 0) return null;

  const sleeveWidth = compact ? 152 : 190;
  const pageWidth = compact ? 220 : 260;
  const exhibitHeight = compact ? 228 : 282;
  const selected = items[Math.min(page, items.length - 1)] ?? items[0];

  const handleScroll = (): void => {
    const el = pagerRef.current;
    if (el === null) return;
    const next = Math.round(el.scrollLeft / pageWidth);
    if (next !== page) {
      setPage(Math.max(0, Math.min(items.length - 1, next)));
    }
  };

  const scrollTo = (index: number): void => {
    // 走 `@ui/lib/scroll`：宿主缺 `scrollTo` 时退化为 `scrollLeft` 赋值而非抛错
    // （HorizontalPager 的翻页定位是尽力而为的视觉行为，缺失不影响数据正确性）。
    scrollElementTo(pagerRef.current, { left: index * pageWidth, behavior: 'smooth' });
  };

  return (
    <div className="god-vinyl">
      {/* HorizontalPager: PageSize.Fixed(pageWidth) + contentPadding side（L252-311） */}
      <div
        className="god-vinyl__pager"
        ref={pagerRef}
        onScroll={handleScroll}
        style={
          {
            height: exhibitHeight,
            '--god-vinyl-page': `${pageWidth}px`,
          } as CSSProperties
        }
      >
        {items.map((item, index) => (
          <GodVinylPage
            key={item.entity.id}
            item={item}
            index={index}
            pageWidth={pageWidth}
            sleeveWidth={sleeveWidth}
            discSize={compact ? 116 : 148}
            reduceMotion={reduceMotion}
            interactions={props.interactions}
            setInteractions={props.setInteractions}
            onItemClick={props.onItemClick}
            onTap={
              // 点旁边的 = 滚到该项；点当前项 = 跳转（L284-287）
              index === page
                ? () => props.onItemClick(item.entity)
                : () => scrollTo(index)
            }
          />
        ))}
      </div>

      {/* 细搁板（L313-319） */}
      <div className="god-vinyl__shelf" />
      <div className="god-vinyl__gap14" />
      {selected !== undefined ? (
        <>
          <p className="god-vinyl__title">{effectiveGodTitle(selected.entity)}</p>
          <div className="god-vinyl__gap5" />
          <GodStarsReadonly rating={selected.entity.rating} starSize={14} />
          <div className="god-vinyl__gap5" />
          <p className="god-vinyl__meta">
            {selected.entity.bookTitle}
            {'  ·  '}
            {page + 1} / {items.length}
          </p>
          {selected.entity.note.trim() !== '' ? (
            <>
              <div className="god-vinyl__gap4" />
              <p
                className="god-vinyl__note"
                role="button"
                tabIndex={0}
                onClick={() =>
                  props.setInteractions({ ...props.interactions, noteFor: selected.entity })
                }
              >
                {selected.entity.note}
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ══════════════ POLAROID（照片墙 — GodRankingExhibits.kt L367-479） ══════════════ */

function GodPolaCell(props: ExhibitProps & { item: GodMomentItem }) {
  const { item, reduceMotion } = props;
  const isDark = godIsDark();
  const paper = isDark ? '#F2EFEA' : '#FFFFFF';

  return (
    <div className="god-pola" style={godTiltFactor(0.25)}>
      <GodItemCard
        moment={item.entity}
        reduceMotion={reduceMotion}
        interactions={props.interactions}
        setInteractions={props.setInteractions}
        onItemClick={props.onItemClick}
        className="god-pola__card"
      >
        {/* 相纸：radius 4 / paper 底 / padding 7（L418-424） */}
        <div className="god-pola__paper" style={{ background: paper }}>
          <div className="god-pola__photo" style={{ aspectRatio: COVER_RATIO }}>
            <GodCoverImage moment={item.entity} />
            <span className="god-pola__rank">{godRankStamp2(item.rank)}</span>
          </div>
          <div className="god-pola__gap9" />
          <p className="god-pola__name">{effectiveGodTitle(item.entity)}</p>
          <div className="god-pola__gap4" />
          <p className="god-pola__meta">
            {godRatingText(item.entity.rating)} ★ &nbsp;· &nbsp;{item.entity.bookTitle}
          </p>
          {item.entity.note.trim() !== '' ? (
            <>
              <div className="god-pola__gap3" />
              <p
                className="god-pola__note"
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  props.setInteractions({ ...props.interactions, noteFor: item.entity });
                }}
              >
                {item.entity.note}
              </p>
            </>
          ) : null}
          <div className="god-pola__gap5" />
        </div>
      </GodItemCard>
    </div>
  );
}

function GodPolaroidStyle(props: ExhibitProps) {
  if (props.items.length === 0) return null;
  const dark = godIsDark();
  const wall = dark ? '#232321' : '#F1EDE6';

  // items.chunked(2)（L403-477）
  const pairs: GodMomentItem[][] = [];
  for (let i = 0; i < props.items.length; i += 2) {
    pairs.push(props.items.slice(i, i + 2) as GodMomentItem[]);
  }

  return (
    <div className="god-wall" style={{ background: wall }}>
      <div className="god-wall__head">
        <span className="god-wall__label" style={{ color: dark ? '#E5D1AD' : '#705F49' }}>
          MOMENT WALL
        </span>
        <span className="god-wall__count" style={{ color: dark ? '#B9AD9C' : '#8E8172' }}>
          {props.items.length} FRAMES
        </span>
      </div>
      {pairs.map((pair) => (
        <div className="god-wall__row" key={pair[0]?.entity.id ?? 'row'}>
          {pair.map((item) => (
            <GodPolaCell key={item.entity.id} {...props} item={item} />
          ))}
          {pair.length === 1 ? <div className="god-wall__filler" /> : null}
        </div>
      ))}
    </div>
  );
}

/* ══════════════ 主体（GodRankingStyles.kt L99-208） ══════════════ */

export function GodRankingBody(props: {
  items: readonly GodMomentItem[];
  style: GodRankingStyleCode;
  compact?: boolean;
  gyroEnabled?: boolean;
  reduceMotion?: boolean;
  onItemClick: (moment: GodMoment) => void;
  onEdit: (moment: GodMoment) => void;
  onDelete: (moment: GodMoment) => void;
  className?: string;
}) {
  const compact = props.compact ?? false;
  const reduceMotion = props.reduceMotion ?? false;
  const gyroEnabled = props.gyroEnabled ?? true;
  const [interactions, setInteractions] = useState<GodRankingInteractions>(
    EMPTY_GOD_INTERACTIONS,
  );
  // tilt = rememberGodTilt(enabled = gyroEnabled && !reduceMotion)（L117）
  useGodTilt(gyroEnabled && !reduceMotion);
  const permissionRequested = useRef(false);

  const exhibit: ExhibitProps = {
    items: props.items,
    compact,
    reduceMotion,
    interactions,
    setInteractions,
    onItemClick: props.onItemClick,
  };

  return (
    <div
      className={['god-body', props.className ?? ''].filter(Boolean).join(' ')}
      onPointerDown={() => {
        // iOS：首次触摸请求方向传感器权限（Android 无需）
        if (!permissionRequested.current) {
          permissionRequested.current = true;
          void requestGodTiltPermission();
        }
      }}
    >
      <GodStyleSwitch style={props.style} reduceMotion={reduceMotion}>
        {props.style === 'podium' ? <GodPodiumStyle {...exhibit} /> : null}
        {props.style === 'vinyl' ? <GodVinylStyle {...exhibit} /> : null}
        {props.style === 'polaroid' ? <GodPolaroidStyle {...exhibit} /> : null}
      </GodStyleSwitch>

      {/* 长按浮层菜单（L142-158）：不加黑色遮罩，透明点击层点外部关闭 */}
      {interactions.menuFor !== null ? (
        <div
          className="god-menu-overlay"
          role="presentation"
          onClick={() => setInteractions({ ...interactions, menuFor: null })}
        >
          <GodItemMenu
            onEdit={() => {
              const target = interactions.menuFor;
              setInteractions({ ...interactions, menuFor: null });
              if (target !== null) props.onEdit(target);
            }}
            onDelete={() => {
              const target = interactions.menuFor;
              setInteractions({ ...interactions, menuFor: null, deleteFor: target });
            }}
            onDismiss={() => setInteractions({ ...interactions, menuFor: null })}
          />
        </div>
      ) : null}

      {/* 删除确认（L161-177） */}
      {interactions.deleteFor !== null ? (
        <GodDialog
          title="确定移除这个神回吗？"
          dismissLabel="取消"
          onDismiss={() => setInteractions({ ...interactions, deleteFor: null })}
          confirmLabel="移除"
          confirmDanger
          onConfirm={() => {
            const target = interactions.deleteFor;
            setInteractions({ ...interactions, deleteFor: null });
            if (target !== null) props.onDelete(target);
          }}
        >
          <span className="god-dialog__hint">随笔和评分将一并删除</span>
        </GodDialog>
      ) : null}

      {/* 随笔原文：纯展示窗口，无按钮，长文可滚动（L182-206） */}
      {interactions.noteFor !== null ? (
        <GodDialog
          title={effectiveGodTitle(interactions.noteFor)}
          hideConfirm
          onDismiss={() => setInteractions({ ...interactions, noteFor: null })}
        >
          <div className="god-note-scroll">{interactions.noteFor.note}</div>
        </GodDialog>
      ) : null}
    </div>
  );
}

/* ══════════════ 统计页卡片（GodRankingCard.kt L61-131） ══════════════ */

export function GodRankingCard(props: {
  moments: readonly GodMoment[];
  style: GodRankingStyleCode;
  gyroEnabled: boolean;
  reduceMotion?: boolean;
  onOpenAll: () => void;
  onItemClick: (moment: GodMoment) => void;
  onEdit: (moment: GodMoment) => void;
  onDelete: (moment: GodMoment) => void;
  className?: string;
}) {
  const reduceMotion = props.reduceMotion ?? false;
  // 固定按评分排序（排行榜本义）（L76-79）
  const ranked = rankGodMoments(props.moments, 'rating');
  const preview = ranked.slice(0, 10);

  return (
    <GlassCard
      className={['god-rank-card', props.className ?? ''].filter(Boolean).join(' ')}
      radius={20}
      padding={0}
    >
      <div className="god-rank-card__pad">
        {/* ── 头部：标题走 titleLarge 槽位（17sp/负字距）（L84-97） ── */}
        <div className="god-rank-card__head">
          <span className="god-rank-card__title">神回排行榜</span>
          <GodCountPill count={props.moments.length} />
          <span className="god-rank-card__spacer" />
          <button type="button" className="god-rank-card__more" onClick={props.onOpenAll}>
            查看全部
          </button>
        </div>
        <div className="god-rank-card__gap14" />

        {preview.length === 0 ? (
          <GodEmptyState reduceMotion={reduceMotion} />
        ) : (
          <GodRankingBody
            items={preview}
            style={props.style}
            compact
            gyroEnabled={props.gyroEnabled}
            reduceMotion={reduceMotion}
            onItemClick={props.onItemClick}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
          />
        )}
      </div>
    </GlassCard>
  );
}
