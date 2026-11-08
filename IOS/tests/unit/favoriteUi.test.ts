/**
 * 「我喜欢的」纯逻辑单测 — 对照 Android `ui/favorite/*.kt`（Module C 移植）。
 *
 * 覆盖 `src/core/favorite/favoriteUi.ts` 中**不依赖 Android/React** 的全部纯函数：
 *   FavoritesPanel.kt   → filterFavorites / sortFavorites / favoriteCardMeta /
 *                         ensureFavoriteCategory / FAVORITE_SORT_LABELS
 *   ChapterStatusRow.kt → chapterReadStateToVisual / createChapterRowState /
 *                         chapterRowProgressFloat / chapterRowAriaLabel / readGray /
 *                         chapterTitleColor / relativeLuminance
 *   SourceMigration.kt  → normalizeSourceTitle / sourceCandidateKey / findSourceCandidates
 *   ComicDetailActions  → continueReadingLabel
 *   HeartArt.kt         → HeartPalette / heartPathD / 动画时长令牌
 *
 * 这些函数在 Kotlin 侧就是 `@Composable` 之外的顶层函数，Compose 无关，所以能在
 * vitest 里直接断言；这也是把逻辑从 `FavoritesPanel.tsx` 抽出来的原因。
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_FAV_CATEGORY,
  ChapterVisual,
  FAV_ARIA_OFF,
  FAV_ARIA_ON,
  FAV_BURST_COUNT,
  FAV_DEFAULT_CATEGORY,
  FAV_DISABLED_HINT,
  FAV_FILL_MS,
  FAV_FILL_MS_REDUCE,
  FAV_PARTICLE_MS,
  FAV_PRESS_SCALE,
  FAV_UNFILL_MS,
  FAVORITE_SORT_LABELS,
  FavoriteSort,
  HEART_ART_DEFAULT_SIZE,
  HEART_EDGE_ALPHA,
  HEART_GRADIENT_STOPS,
  HEART_GLOW_ALPHA,
  HEART_GLOW_CENTER,
  HEART_SHEEN_ALPHA,
  HeartBottom,
  HeartMid,
  HeartPalette,
  HeartTop,
  SHELF_SEGMENT_BOOK,
  SHELF_SEGMENT_FAV,
  chapterReadStateToVisual,
  chapterRowAriaLabel,
  chapterRowProgressFloat,
  chapterTitleColor,
  continueReadingLabel,
  createChapterRowState,
  ensureFavoriteCategory,
  favoriteCardMeta,
  filterFavorites,
  findSourceCandidates,
  heartPathD,
  normalizeSourceTitle,
  readGray,
  relativeLuminance,
  sortFavorites,
  sourceCandidateKey,
  type FavoriteItem,
  type SearchableComicSource,
} from '@core/favorite/favoriteUi';
import {
  ChapterReadState,
  favoriteKey,
  type ComicProgressEntity,
  type FavoriteEntity,
} from '@core/library/favoriteTypes';
import { createComicChapter, type ComicChapter, type SearchBook } from '@core/library/comicSourceTypes';

/* ─────────────────────────── fixtures ─────────────────────────── */

function fav(partial: Partial<FavoriteEntity> = {}): FavoriteEntity {
  return {
    sourceId: 'src-a',
    comicId: 'c1',
    title: '标题',
    author: '作者',
    categoryName: FAV_DEFAULT_CATEGORY,
    coverUrl: null,
    localThumbPath: null,
    favoritedAt: 0,
    latestChapterId: null,
    latestChapterTitle: null,
    latestChapterUpdateAt: 0,
    sourceAlive: true,
    sortOrder: 0,
    ...partial,
  } as FavoriteEntity;
}

function progress(partial: Partial<ComicProgressEntity> = {}): ComicProgressEntity {
  return {
    sourceId: 'src-a',
    comicId: 'c1',
    chapterId: null,
    status: 0,
    pageIndex: 0,
    pageCount: 0,
    chapterIndex: -1,
    updatedAt: 0,
    bookmarked: 0,
    ...partial,
  } as ComicProgressEntity;
}

function item(f: Partial<FavoriteEntity>, p: Partial<ComicProgressEntity> | null = null): FavoriteItem {
  const favorite = fav(f);
  return { favorite, progress: p === null ? null : progress({ ...p, sourceId: favorite.sourceId, comicId: favorite.comicId }), downloadedChapters: 0 };
}

function book(partial: Partial<SearchBook> = {}): SearchBook {
  return {
    sourceId: 'src-b',
    id: 'b1',
    title: '书名',
    author: '',
    cover: null,
    ...partial,
  } as SearchBook;
}

/* ─────────────────────── FavoritesPanel.kt ─────────────────────── */

describe('filterFavorites — FavoritesPanel.kt L117–120', () => {
  const a = item({ comicId: 'a', categoryName: '默认' });
  const b = item({ comicId: 'b', categoryName: '收藏 A' });
  const c = item({ comicId: 'c', categoryName: '收藏 A' });

  it('全部：原样返回（是新数组，不改原数组）', () => {
    const input = [a, b, c];
    const out = filterFavorites(input, ALL_FAV_CATEGORY);
    expect(out).toEqual([a, b, c]);
    expect(out).not.toBe(input);
  });

  it('具体分类：只留该分类', () => {
    expect(filterFavorites([a, b, c], '收藏 A').map((it) => it.favorite.comicId)).toEqual(['b', 'c']);
  });

  it('不存在的分类 → 空数组', () => {
    expect(filterFavorites([a, b, c], '没有这个分类')).toEqual([]);
  });
});

describe('sortFavorites — FavoritesPanel.kt L121–130', () => {
  const items = [
    item({ comicId: 'a', title: 'Bravo', favoritedAt: 10, latestChapterUpdateAt: 1 }, { lastReadAt: 100, lastChapterIndex: 4 }),
    item({ comicId: 'b', title: 'alpha', favoritedAt: 30, latestChapterUpdateAt: 3 }, { lastReadAt: 5, lastChapterIndex: 0 }),
    item({ comicId: 'c', title: 'Charlie', favoritedAt: 20, latestChapterUpdateAt: 2 }, null),
  ];

  it('RECENT_FAVORITE：按 favoritedAt 倒序', () => {
    expect(sortFavorites(items, FavoriteSort.RECENT_FAVORITE).map((it) => it.favorite.comicId)).toEqual(['b', 'c', 'a']);
  });

  it('RECENT_READ：按 lastReadAt 倒序，无进度视为 0', () => {
    expect(sortFavorites(items, FavoriteSort.RECENT_READ).map((it) => it.favorite.comicId)).toEqual(['a', 'b', 'c']);
  });

  it('RECENT_UPDATE：按 latestChapterUpdateAt 倒序', () => {
    expect(sortFavorites(items, FavoriteSort.RECENT_UPDATE).map((it) => it.favorite.comicId)).toEqual(['b', 'c', 'a']);
  });

  it('TITLE：lowercase 字典序（大小写不敏感）', () => {
    // Kotlin `sortedBy { title.lowercase() }`：alpha < bravo < charlie
    expect(sortFavorites(items, FavoriteSort.TITLE).map((it) => it.favorite.title)).toEqual([
      'alpha',
      'Bravo',
      'Charlie',
    ]);
  });

  it('CUSTOM：按 sortOrder 升序', () => {
    const custom = [
      item({ comicId: 'x', sortOrder: 3 }),
      item({ comicId: 'y', sortOrder: 1 }),
      item({ comicId: 'z', sortOrder: 2 }),
    ];
    expect(sortFavorites(custom, FavoriteSort.CUSTOM).map((it) => it.favorite.comicId)).toEqual(['y', 'z', 'x']);
  });

  it('不改动入参数组', () => {
    // Invariant: the `items` fixture above declares exactly two entries
    // (comicId 'a' / 'b'), so both index reads are defined.
    const input = [items[0]!, items[1]!];
    const snapshot = input.map((it) => it.favorite.comicId);
    sortFavorites(input, FavoriteSort.RECENT_FAVORITE);
    expect(input.map((it) => it.favorite.comicId)).toEqual(snapshot);
  });
});

describe('FAVORITE_SORT_LABELS — 五个胶囊标签逐字对齐', () => {
  it('标签与常量一一对应', () => {
    expect(FAVORITE_SORT_LABELS.map((e) => e.code)).toEqual([
      FavoriteSort.RECENT_FAVORITE,
      FavoriteSort.RECENT_READ,
      FavoriteSort.RECENT_UPDATE,
      FavoriteSort.TITLE,
      FavoriteSort.CUSTOM,
    ]);
    expect(FAVORITE_SORT_LABELS.map((e) => e.label)).toEqual([
      '最近收藏',
      '最近阅读',
      '最近更新',
      '书名',
      '自定义',
    ]);
  });
});

describe('favoriteCardMeta — FavoritesPanel.kt L301–313', () => {
  it('从未开始：latestNum=0 时文案兜底', () => {
    const meta = favoriteCardMeta(item({ latestChapterTitle: null, latestChapterId: null }));
    expect(meta.latestNum).toBeNull();
    expect(meta.readNum).toBe(0);
    expect(meta.unread).toBe(0);
    expect(meta.hasUpdate).toBe(false);
    expect(meta.caption).toBe('尚未开始阅读');
    expect(meta.readRatio).toBeNull();
  });

  it('来源已死 → 文案变成「来源暂不可用」', () => {
    const meta = favoriteCardMeta(item({ sourceAlive: false }));
    expect(meta.dead).toBe(true);
    expect(meta.caption).toBe('来源暂不可用');
  });

  it('有更新：快照 id 与已见快照不同', () => {
    const meta = favoriteCardMeta(
      item({ latestChapterId: 'ch-9', latestChapterTitle: '第 9 话' }, { seenTopChapterId: 'ch-8', lastChapterIndex: 7 }),
    );
    expect(meta.latestNum).toBe(9);
    expect(meta.readNum).toBe(8);
    expect(meta.hasUpdate).toBe(true);
    expect(meta.unread).toBe(1);
    expect(meta.caption).toBe('更新至第 9 话 · 看到第 8 话');
  });

  it('话数兜底：latestNum ≤ readNum 时不算更新（源每次都换 id）', () => {
    const meta = favoriteCardMeta(
      item({ latestChapterId: 'ch-timestamp-a', latestChapterTitle: '第 8 话' }, { seenTopChapterId: 'ch-timestamp-b', lastChapterIndex: 7 }),
    );
    expect(meta.latestNum).toBe(8);
    expect(meta.readNum).toBe(8);
    expect(meta.hasUpdate).toBe(false);
    expect(meta.unread).toBe(0);
    expect(meta.readRatio).toBe(1);
  });

  it('解析不到话数时退回 id 比较（缺章源）', () => {
    const meta = favoriteCardMeta(
      item({ latestChapterId: 'ch-x', latestChapterTitle: '序章' }, { seenTopChapterId: 'ch-y', lastChapterIndex: 0 }),
    );
    expect(meta.latestNum).toBeNull();
    expect(meta.hasUpdate).toBe(true);
    expect(meta.readRatio).toBeNull();
    expect(meta.caption).toBe('看到第 1 话');
  });

  it('同一快照 → 无更新', () => {
    const meta = favoriteCardMeta(
      item({ latestChapterId: 'ch-8', latestChapterTitle: '第 8 话' }, { seenTopChapterId: 'ch-8', lastChapterIndex: 7 }),
    );
    expect(meta.hasUpdate).toBe(false);
  });

  it('封面优先用本地缩略图', () => {
    expect(favoriteCardMeta(item({ coverUrl: 'https://x/c.jpg' })).cover).toBe('https://x/c.jpg');
    expect(
      favoriteCardMeta(item({ coverUrl: 'https://x/c.jpg', localThumbPath: 'file:///t.jpg' })).cover,
    ).toBe('file:///t.jpg');
  });

  it('readRatio 夹在 [0,1]', () => {
    const meta = favoriteCardMeta(
      item({ latestChapterId: 'c', latestChapterTitle: '第 3 话' }, { seenTopChapterId: 'c', lastChapterIndex: 19 }),
    );
    expect(meta.readRatio).toBe(1);
  });
});

describe('ensureFavoriteCategory — FavoritesPanel.kt L591–594', () => {
  it('当前分类还在 → 原样返回', () => {
    expect(ensureFavoriteCategory('收藏 A', ['收藏 A', '默认'])).toBe('收藏 A');
  });

  it('当前分类被删 → 退回「默认」', () => {
    expect(ensureFavoriteCategory('没了', ['默认', '收藏 B'])).toBe('默认');
  });

  it('连「默认」都没有 → 取第一个', () => {
    expect(ensureFavoriteCategory('没了', ['收藏 B', '收藏 C'])).toBe('收藏 B');
  });

  it('分类全空 → 「默认」', () => {
    expect(ensureFavoriteCategory('没了', [])).toBe(FAV_DEFAULT_CATEGORY);
  });
});

/* ─────────────────────── ChapterStatusRow.kt ─────────────────────── */

describe('chapterReadStateToVisual — ChapterStatusRow.kt L69–73', () => {
  it('三态映射', () => {
    expect(chapterReadStateToVisual(ChapterReadState.UNREAD)).toBe(ChapterVisual.UNREAD);
    expect(chapterReadStateToVisual(ChapterReadState.READING)).toBe(ChapterVisual.READING);
    expect(chapterReadStateToVisual(ChapterReadState.READ)).toBe(ChapterVisual.READ);
  });

  it('未知值退回 UNREAD', () => {
    expect(chapterReadStateToVisual(99)).toBe(ChapterVisual.UNREAD);
  });
});

describe('createChapterRowState — Kotlin data class 默认值', () => {
  it('无参即全默认', () => {
    expect(createChapterRowState()).toEqual({
      visual: ChapterVisual.UNREAD,
      pageIndex: 0,
      pageCount: 0,
      isNew: false,
      downloaded: false,
      downloading: false,
      downloadProgress: 0,
      external: false,
    });
  });

  it('partial 只覆盖给定字段', () => {
    const s = createChapterRowState({ isNew: true, pageIndex: 4 });
    expect(s.isNew).toBe(true);
    expect(s.pageIndex).toBe(4);
    expect(s.visual).toBe(ChapterVisual.UNREAD);
  });
});

describe('chapterRowProgressFloat — ChapterStatusRow.kt L88–89', () => {
  it('有页数：读到第 N 页 → (N+1)/total', () => {
    expect(chapterRowProgressFloat(createChapterRowState({ pageIndex: 4, pageCount: 10 }))).toBe(0.5);
  });

  it('无页数 → 0（不除零）', () => {
    expect(chapterRowProgressFloat(createChapterRowState({ pageIndex: 3, pageCount: 0 }))).toBe(0);
  });
});

describe('chapterRowAriaLabel — ChapterStatusRow.kt L174–187', () => {
  it('未读、无附件', () => {
    expect(chapterRowAriaLabel('第 1 话', createChapterRowState(), false)).toBe('第 1 话，未读');
  });

  it('阅读中 + 已下载 + 新章节 + 书签（顺序固定）', () => {
    const s = createChapterRowState({ visual: ChapterVisual.READING, downloaded: true, isNew: true });
    expect(chapterRowAriaLabel('第 3 话', s, true)).toBe('第 3 话，阅读中，已下载，新章节，已加书签');
  });

  it('已读', () => {
    expect(chapterRowAriaLabel('序章', createChapterRowState({ visual: ChapterVisual.READ }), false)).toBe('序章，已读');
  });
});

describe('readGray / chapterTitleColor — ChapterStatusRow.kt L121–127', () => {
  it('亮色主题走亮灰', () => {
    expect(readGray(false)).toBe('#6B6B6B');
    expect(chapterTitleColor(createChapterRowState({ visual: ChapterVisual.READ }), false, '#111', '#059669')).toBe('#6B6B6B');
  });

  it('暗色主题走暗灰', () => {
    expect(readGray(true)).toBe('#B3B3B3');
  });

  it('阅读中 → primary；未读 → onSurface', () => {
    expect(chapterTitleColor(createChapterRowState({ visual: ChapterVisual.READING }), false, '#111', '#059669')).toBe('#059669');
    expect(chapterTitleColor(createChapterRowState(), false, '#111', '#059669')).toBe('#111');
  });
});

describe('relativeLuminance — Kotlin Color.luminance()', () => {
  it('权重 0.2126R + 0.7152G + 0.0722B', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(255, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 0, b: 0 })).toBeCloseTo(0.2126 * 255, 5);
  });

  it('0.4 判据：白色亮 / 黑色暗（决定 readGray 分支）', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeGreaterThan(0.4);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeLessThan(0.4);
  });
});

/* ─────────────────────── SourceMigration.kt ─────────────────────── */

describe('normalizeSourceTitle — SourceMigration.kt L65–66', () => {
  it('去标点与空格，保留 CJK 与字母数字', () => {
    expect(normalizeSourceTitle('机动战士 Gundam 0080！')).toBe('机动战士gundam0080');
  });

  it('全角标点也被去掉', () => {
    expect(normalizeSourceTitle('【译名】葬送的芙莉莲')).toBe('译名葬送的芙莉莲');
  });

  it('纯符号 → 空串（findSourceCandidates 据此早退）', () => {
    expect(normalizeSourceTitle('!!! --- ???')).toBe('');
  });
});

describe('sourceCandidateKey — SourceMigration.kt L48–54', () => {
  it('`"${sourceId}::${book.id}"`', () => {
    expect(sourceCandidateKey('src-b', book({ id: 'z9' }))).toBe('src-b::z9');
    expect(sourceCandidateKey('src-b', book({ id: 'z9' }))).toBe(favoriteKey('src-b', 'z9'));
  });
});

describe('findSourceCandidates — SourceMigration.kt L74–113', () => {
  function source(id: string, name: string, results: SearchBook[] | Error): SearchableComicSource {
    return {
      id,
      name,
      search: async () => (results instanceof Error ? { kind: 'error', exception: results } : { kind: 'success', data: results }),
    };
  }

  it('空标题 → 直接返回空数组（不打扰任何源）', async () => {
    let called = 0;
    const probe: SearchableComicSource = {
      id: 's',
      name: 'S',
      search: async () => {
        called += 1;
        return { kind: 'success', data: [] };
      },
    };
    expect(await findSourceCandidates('!!!', 'me', [probe])).toEqual([]);
    expect(called).toBe(0);
  });

  it('排除自己 + 归一化后完全相等才命中', async () => {
    const out = await findSourceCandidates('葬送的芙莉莲', 'me', [
      source('other', '别的源', [book({ sourceId: 'other', id: 'x', title: '葬送的芙莉莲' })]),
      source('me', '自己', [book({ sourceId: 'me', id: 'y', title: '葬送的芙莉莲' })]),
    ]);
    expect(out.map((c) => c.sourceId)).toEqual(['other']);
    expect(out[0]?.key).toBe('other::x');
    expect(out[0]?.sourceName).toBe('别的源');
  });

  it('完全相等优先于「包含」', async () => {
    const out = await findSourceCandidates('芙莉莲', 'me', [
      source('s', 'S', [
        book({ sourceId: 's', id: 'loose', title: '葬送的芙莉莲 设定集' }),
        book({ sourceId: 's', id: 'exact', title: '芙莉莲' }),
      ]),
    ]);
    expect(out[0]?.book.id).toBe('exact');
  });

  it('单个源报错不拖垮整体', async () => {
    const out = await findSourceCandidates('X', 'me', [
      source('bad', '坏源', new Error('boom')),
      source('ok', '好源', [book({ sourceId: 'ok', id: 'k', title: 'X' })]),
    ]);
    expect(out.map((c) => c.sourceId)).toEqual(['ok']);
  });

  it('结果按源名排序', async () => {
    const out = await findSourceCandidates('X', 'me', [
      source('s2', 'Zeta', [book({ sourceId: 's2', id: 'a', title: 'X' })]),
      source('s1', 'Alpha', [book({ sourceId: 's1', id: 'b', title: 'X' })]),
    ]);
    expect(out.map((c) => c.sourceName)).toEqual(['Alpha', 'Zeta']);
  });

  it('maxSources 限制并发查询的源数量', async () => {
    let called = 0;
    const probes: SearchableComicSource[] = Array.from({ length: 9 }, (_, i) => ({
      id: `s${i}`,
      name: `S${i}`,
      search: async () => {
        called += 1;
        return { kind: 'success', data: [] };
      },
    }));
    await findSourceCandidates('X', 'me', probes, 3);
    expect(called).toBe(3);
  });
});

/* ─────────────────────── ComicDetailActions.kt ─────────────────────── */

describe('continueReadingLabel — ComicDetailActions.kt L118–121', () => {
  const chapters: ComicChapter[] = [
    createComicChapter({ id: '1', title: '第 1 话', order: 0 }),
    createComicChapter({ id: '2', title: '第 2 话', order: 1 }),
    createComicChapter({ id: '3', title: '第 3 话', order: 2 }),
  ];

  it('start → 「开始阅读」', () => {
    expect(continueReadingLabel({ kind: 'start' }, chapters)).toBe('开始阅读');
  });

  it('resume → 带话数与页码', () => {
    expect(continueReadingLabel({ kind: 'resume', chapterIndex: 1, pageIndex: 4 }, chapters)).toBe(
      '继续阅读 · 第2话 · 第5页',
    );
  });

  it('next → 只带话数', () => {
    expect(continueReadingLabel({ kind: 'next', chapterIndex: 2 }, chapters)).toBe('继续阅读 · 第3话');
  });

  it('upToDate → 「已读到最新」', () => {
    expect(continueReadingLabel({ kind: 'upToDate' }, chapters)).toBe('已读到最新');
  });

  it('只读入参不被改动（内部 spread 出新数组）', () => {
    const snapshot = chapters.map((c) => c.id);
    continueReadingLabel({ kind: 'next', chapterIndex: 0 }, chapters);
    expect(chapters.map((c) => c.id)).toEqual(snapshot);
  });
});

/* ─────────────────────────── HeartArt.kt ─────────────────────────── */

describe('HeartArt 常量 — HeartArt.kt', () => {
  it('三段渐变色与 palette 一致', () => {
    expect(HeartPalette.top).toBe(HeartTop);
    expect(HeartPalette.mid).toBe(HeartMid);
    expect(HeartPalette.bottom).toBe(HeartBottom);
    expect(HEART_GRADIENT_STOPS).toBe(`${HeartPalette.top}, ${HeartPalette.mid}, ${HeartPalette.bottom}`);
  });

  it('默认尺寸 46dp', () => {
    expect(HEART_ART_DEFAULT_SIZE).toBe(46);
  });

  it('外发光 / 高光 / 收边的数值令牌', () => {
    expect(HEART_GLOW_CENTER).toEqual({ x: 0.5, y: 0.52 });
    expect(HEART_GLOW_ALPHA).toBeCloseTo(0.34, 5);
    expect(HEART_SHEEN_ALPHA).toBeCloseTo(0.42, 5);
    expect(HEART_EDGE_ALPHA).toBeCloseTo(0.2, 5);
  });

  it('心形路径：归一化 0..1 的闭合三次贝塞尔', () => {
    const d = heartPathD();
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // 四段 cubic
    expect((d.match(/C /g) ?? []).length).toBe(4);
    const nums = (d.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    expect(nums.length).toBeGreaterThan(10);
    for (const n of nums) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });
});

describe('收藏动效与文案令牌 — FavoriteHeart.kt', () => {
  it('填充时长（减少动态时更快）', () => {
    expect(FAV_FILL_MS).toBe(260);
    expect(FAV_FILL_MS_REDUCE).toBeLessThan(FAV_FILL_MS);
  });

  it('取消比填充更快', () => {
    expect(FAV_UNFILL_MS).toBeLessThan(FAV_FILL_MS);
  });

  it('按压缩放 0.94，迸发 7 颗粒子，粒子时长 600ms', () => {
    expect(FAV_PRESS_SCALE).toBeLessThan(1);
    expect(FAV_BURST_COUNT).toBe(7);
    expect(FAV_PARTICLE_MS).toBe(600);
  });

  it('无来源提示与 aria 文案逐字对齐', () => {
    expect(FAV_DISABLED_HINT).toBe('这本书没有来源信息，无法加入「我喜欢的」');
    expect(FAV_ARIA_ON).toBe('已喜欢，点击取消喜欢');
    expect(FAV_ARIA_OFF).toBe('喜欢，加入我喜欢的');
  });

  it('分段标签', () => {
    expect(SHELF_SEGMENT_BOOK).toBe('我的书架');
    expect(SHELF_SEGMENT_FAV).toBe('我喜欢的');
  });
});