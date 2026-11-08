/**
 * 神回排行榜全屏页 — 逐行移植 Android `god/GodRankingCard.kt` L181-294
 * （GodRankingScreen）+ MainActivity.kt L1046-1062 的接线。
 *
 * Android 结构：
 *   Scaffold(containerColor = background) {
 *     TopAppBar(containerColor = surface) — 标题「神回排行榜」18sp Bold
 *       + Spacer(8) + GodCountPill + 返回 IconButton
 *     empty → Box(fillMaxSize) 居中 GodEmptyState
 *     LazyColumn(contentPadding h16 v12, spacedBy 12) {
 *       item("hero")  → GodRankingHero(leader, count)
 *       item("style") → GlassCard(r18, tint surface 0.68, padding h16 v12)
 *                          「陈列方式」12sp onSurfaceVariant + weight1
 *                          + style.label 金 13sp Bold + 「↗」
 *       item("body")  → AnimatedContent(style) → GodRankingBody(compact = false)
 *     }
 *   }
 *
 * MainActivity 接线（L1046-1062）：
 *   onItemClick → bookId 拆 "sourceId::comicId"，两者非空则写
 *                 GodMomentJumpState.chapterId 信标并打开漫画主页；
 *                 本地书籍（无 "::"）与 Android 一致不跳转。
 *   onOpenStyleSettings → 写 GodStyleSettingsJumpPending 信标 + 进设置页。
 */
import { useEffect, useState } from 'react';
import { GlassCard } from '@ui/components/GlassCard';
import { showToast } from '@ui/toast';
import { useAppStore } from '@ui/state/appStore';
import { getPlatform } from '@platform/index';
import { openAppDatabase } from '@core/db/openDatabase';
import { GodMomentRepository } from '@core/god/godMomentRepository';
import {
  attachGodMomentRepository,
  deleteGodMoment,
  hydrateGodMomentsFromDb,
  listGodMoments,
  seedGodMomentsIfEmpty,
  setGodEditTarget,
} from '@core/god/godMoments';
import { rankGodMoments, type GodMoment } from '@core/god/godTypes';
import {
  getGodGyroParallaxEnabled,
  getGodRankingStyle,
  godRankingStyleDef,
  setGodStyleSettingsJumpPending,
  setGodJumpChapterId,
} from '@core/god/godRankingSettings';
import {
  GodCountPill,
  GodEmptyState,
  GodRankingHero,
} from '@ui/components/god/GodRankingShared';
import { GodRankingBody } from '@ui/components/god/GodRankingBody';
import '../../styles/god.css';

/**
 * rememberReduceMotion() 的 web 等价：
 * Android 读 Settings.Global.ANIMATOR_DURATION_SCALE == 0；
 * Web 标准对应 prefers-reduced-motion: reduce。
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (event: MediaQueryListEvent): void => {
      setReduced(event.matches);
    };
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

async function bootstrapGodDb(): Promise<void> {
  try {
    const platform = getPlatform();
    await openAppDatabase({ db: platform.db });
    attachGodMomentRepository(new GodMomentRepository(platform.db));
    await hydrateGodMomentsFromDb();
  } catch {
    // in-memory fallback
  }
}

export function GodRankingPage() {
  const setRoute = useAppStore((s) => s.setRoute);
  // 设置页是 tab（MainShell 内），不是 route
  const setTab = useAppStore((s) => s.setTab);
  const [dbReady, setDbReady] = useState(false);
  const reduceMotion = usePrefersReducedMotion();

  // 启动：种子数据 + DB 水合（与旧版一致；Android 由 ViewModel 承担）
  useEffect(() => {
    seedGodMomentsIfEmpty();
    let cancelled = false;
    void bootstrapGodDb().then(() => {
      if (!cancelled) setDbReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 固定按评分排序（GodRankingScreen L192-194：与统计页卡一致）
  const ranked = rankGodMoments(listGodMoments(), 'rating');
  const count = ranked.length;
  const leader = ranked[0]?.entity;
  const style = getGodRankingStyle();
  const styleDef = godRankingStyleDef(style);
  const gyroEnabled = getGodGyroParallaxEnabled();

  /** MainActivity L1054-1062：在线漫画 → 信标 + 漫画主页；本地书不跳转。 */
  const handleItemClick = (moment: GodMoment): void => {
    const parts = moment.bookId.split('::');
    const sourceId = parts[0] ?? '';
    const comicId = parts[1] ?? '';
    if (sourceId.trim() !== '' && comicId.trim() !== '') {
      setGodJumpChapterId(moment.chapterId);
      setRoute('comicChapters');
    }
  };

  const handleEdit = (moment: GodMoment): void => {
    setGodEditTarget(moment.id);
    setRoute('godEditor');
  };

  const handleDelete = (moment: GodMoment): void => {
    deleteGodMoment(moment.id);
    showToast('已移除神回');
  };

  /**
   * MainActivity L865-866：信标 + 设置页（设置页读取后滚动到神回分区）。
   * 设置页是 tab 而非 route → setTab('settings')（Android navController 跳 settings tab）。
   */
  const handleOpenStyleSettings = (): void => {
    setGodStyleSettingsJumpPending(true);
    setTab('settings');
  };

  return (
    <div className="page god-screen" data-db-ready={dbReady ? '1' : '0'}>
      {/* ── TopAppBar（containerColor = surface） ── */}
      <header className="god-topbar">
        <button
          type="button"
          className="god-topbar__back"
          onClick={() => setRoute('main')}
          aria-label="返回"
        >
          ‹
        </button>
        <h1 className="god-topbar__title">神回排行榜</h1>
        <GodCountPill count={count} />
      </header>

      {ranked.length === 0 || leader === undefined ? (
        <div className="god-screen__empty">
          <GodEmptyState reduceMotion={reduceMotion} />
        </div>
      ) : (
        <div className="god-screen__list">
          {/* item("hero") */}
          <GodRankingHero leader={leader} count={count} />

          {/* item("style")：GlassCard r18 / tint surface 0.68 / padding h16 v12 */}
          <GlassCard
            className="god-style-row"
            radius={18}
            padding={12}
            style={{ background: 'rgba(255, 255, 255, 0.68)' }}
            onClick={handleOpenStyleSettings}
          >
            <span className="god-style-row__label">陈列方式</span>
            <span className="god-style-row__spacer" />
            <span className="god-style-row__value">{styleDef.label}</span>
            <span className="god-style-row__arrow">↗</span>
          </GlassCard>

          {/* item("body")：AnimatedContent → GodRankingBody(compact = false) */}
          <GodRankingBody
            items={ranked}
            style={style}
            compact={false}
            gyroEnabled={gyroEnabled}
            reduceMotion={reduceMotion}
            onItemClick={handleItemClick}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </div>
      )}
    </div>
  );
}
