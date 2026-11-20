/**
 * 客籍（guest）小说的三个 EPUB 处理入口 —— `download/GuestNovelEpub.kt` L25 +
 * `download/GuestNovelIntegrity.kt` L17 + `download/XbookcnEpub.kt` L25 的移植。
 *
 * 三个文件都是「把第三方站的章节抓下来后打包成可入库的 EPUB/章节列表」。Kotlin 侧
 * 依赖 `Document` / `ZipOutputStream`；Web 侧统一走 `core/epub` 的打包器与
 * `core/parser` 的 HTML 解析（已存在），本文件负责三家站点各自的**规则**：
 *
 * Kotlin → TS 映射
 * ────────────────
 *   GuestNovelEpub.kt L25 `object GuestNovelEpub`：站点域、章节 URL 拼接、正文选择器
 *                                                              → `GuestNovelEpub`
 *   GuestNovelIntegrity.kt L17 `object GuestNovelIntegrity`：完整性校验（章节数 /
 *            正文非空 / 无重复）                                → `GuestNovelIntegrity`
 *   XbookcnEpub.kt L25 `object XbookcnEpub`：同上，站规不同        → `XbookcnEpub`
 *
 * 平台差异（已登记 E139）：`ZipOutputStream` → `core/epub` 的写包器；`Jsoup` 选择器 →
 * `core/parser/htmlDocument.ts` 的子集（与 E39 的登记一致）。
 */

export interface ChapterParts {
  readonly title: string;
  readonly content: string;
  readonly order: number;
}

/** `GuestNovelEpub.kt` L25：客籍站（guest）的抓取规则。 */
export const GuestNovelEpub = {
  /** 站点标识（用于 `sourceId` 前缀）。 */
  sourceId: 'guest',
  /** 章节列表入口。 */
  listPath: '/book/{bookId}',
  /** 章节正文入口。 */
  chapterPath: '/book/{bookId}/{chapterId}',
  /** 正文容器的选择器（与 Kotlin 的 `select` 常量一致）。 */
  contentSelector: '#content',
  /** 章节标题选择器。 */
  titleSelector: 'h1',
  /** 把抓到的章节拼成 EPUB 需要的元数据。 */
  bookMeta(title: string, author: string): { readonly title: string; readonly author: string; readonly language: string } {
    return { title: title.trim(), author: author.trim(), language: 'zh' };
  },
  /** 章节 URL（替换模板占位符）。 */
  chapterUrl(bookId: string, chapterId: string): string {
    return `/book/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}`;
  },
} as const;

/**
 * `GuestNovelIntegrity.kt` L17：入库前的完整性校验。
 * 规则：章节数 > 0、每章正文非空、章节标题不重复、正文总长在合理范围。
 */
export const GuestNovelIntegrity = {
  /** 正文最短长度（低于视为抓取失败）。 */
  minContentChars: 20,
  /** 章节数上限（防御性）。 */
  maxChapters: 5000,
  /** L17 的校验：返回问题列表（空数组表示通过）。 */
  check(chapters: readonly ChapterParts[]): readonly string[] {
    const issues: string[] = [];
    if (chapters.length === 0) issues.push('没有抓到任何章节');
    if (chapters.length > GuestNovelIntegrity.maxChapters) issues.push('章节数超过上限');
    const seen = new Set<string>();
    for (const chapter of chapters) {
      if (chapter.content.trim().length < GuestNovelIntegrity.minContentChars) {
        issues.push(`章节正文过短：${chapter.title}`);
      }
      if (seen.has(chapter.title)) issues.push(`章节标题重复：${chapter.title}`);
      seen.add(chapter.title);
    }
    return issues;
  },
} as const;

/** `XbookcnEpub.kt` L25：xbookcn 站的抓取规则（路径与选择器与客籍不同）。 */
export const XbookcnEpub = {
  sourceId: 'xbookcn',
  listPath: '/book/{bookId}/index.html',
  chapterPath: '/book/{bookId}/{chapterId}.html',
  contentSelector: '.content',
  titleSelector: '.title',
  bookMeta(title: string, author: string): { readonly title: string; readonly author: string; readonly language: string } {
    return { title: title.trim(), author: author.trim(), language: 'zh' };
  },
  chapterUrl(bookId: string, chapterId: string): string {
    return `/book/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}.html`;
  },
} as const;

/** `download/DownloadTaskDao.kt` L6 `DownloadTypeConverters`：枚举 ↔ 字符串。 */
export const DownloadTypeConverters = {
  /** 列值 → 枚举名（未知值回落到 `PENDING`）。 */
  fromColumn(value: string | null): 'PENDING' | 'DOWNLOADING' | 'SUCCESS' | 'PAUSED' | 'ERROR' | 'IDLE' {
    switch (value) {
      case 'DOWNLOADING':
      case 'SUCCESS':
      case 'PAUSED':
      case 'ERROR':
      case 'IDLE':
        return value;
      default:
        return 'PENDING';
    }
  },
  /** 枚举名 → 列值。 */
  toColumn(value: string): string {
    return value;
  },
} as const;
