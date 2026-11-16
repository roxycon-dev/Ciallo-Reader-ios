/**
 * NovelReaderOnlinePage.tsx — line-by-line port of Android `com/example/ui/NovelReaderScreen.kt`
 * (`novel-reader/app/src/main/java/com/example/ui/NovelReaderScreen.kt`, 220 lines / 211 non-blank).
 *
 * Line map (Kotlin → this file):
 *   1-25    package + Compose imports → React imports; Compose imports SKIPPED
 *   27-30   KDoc                             → component KDoc
 *   31-47   @OptIn + signature              → NovelReaderOnlinePageProps + component
 *   48-55   ReadingTimerEffect(...)          → useReadingTimer() (core/reader/readingTimer)
 *   56      fontSizeSp (17f)                → fontSizeSp state (17)
 *   57      showBars (true)                  → showBars state
 *   58      rememberLazyListState()          → scrollRef + scrollTo(0,0)
 *   60-63   LaunchedEffect(chapter?.id, text) { listState.scrollToItem(0) } →
 *                                              useEffect on [chapterId, text] → scrollTop
 *   65-69   paragraphs = text.split("\n\n") → useMemo (verbatim split on "\n\n")
 *   71      Box(background = colorScheme.background) → .reader-root (LIGHT theme)
 *   72-111  Column + AnimatedVisibility(showBars) + TopAppBar → top bar (title/author
 *                                              + A-/A+ + back) with CSS visibility toggle
 *   93-97   navigationIcon (ArrowBack, "返回") → back button
 *   103-108 actions: A- (if > 12f) / A+ (if < 26f) → the same bounds, MintPrimary on A+
 *   113-122 loading && paragraphs.isEmpty() → ChasingDots + 正在加载正文…
 *   124-138 error != null && paragraphs.isEmpty() → error text + 重试 (AppLiquidButton)
 *   140-145 paragraphs.isEmpty()            → 本章没有内容
 *   147-175 LazyColumn + item("title") + items(paragraphs) → scroll container
 *   155-167 title item (fontSizeSp + 4, divider, spacer 14.dp) → same
 *   168-175 items(paragraphs.size) { i -> Text(paragraphs[i]) } → mapped paragraphs
 *   176-214 item("nav") 底部翻章: hasPrevChapter → OutlinedButton 上一章;
 *              hasNextChapter → Button 下一章 (MintPrimary) → same, both weight(1f)
 *   213     Spacer(24.dp)                  → bottom padding 24px
 *
 * ── Skipped lines with reasons ────────────────────────────────────────────────────
 *  L1     `package com.example.ui` — TS module system.
 *  L3-11  Compose `AnimatedVisibility` / `background` / `clickable` / `layout.*` /
 *         `LazyColumn` / `rememberLazyListState` imports → CSS + refs.
 *  L12-14 `material.icons.automirrored.filled.{ArrowBack,NavigateBefore,NavigateNext}` →
 *         inline SVG glyphs (same shapes).
 *  L15-20 `material3.*` (TopAppBar, Text, Button, OutlinedButton, ButtonDefaults,
 *         HorizontalDivider) + `runtime.*` → React + `.reader-*` CSS.
 *   L17  `AppIconButton` → local `.reader-icon-btn` button (see reader.css).
 *   L18  `ChasingDots` → CSS dots (three-dot pulse) in `.reader-loading-dots`.
 *   L19  `AppLiquidButton` → `AppButton` variant primary (same label 重试).
 *   L20  `MintPrimary` → `var(--color-primary, #059669)` (theme token).
 *   L31  `@OptIn(ExperimentalMaterial3Api::class)` — Compose opt-in, no TS equivalent.
 *   L31-47 the Compose signature's default values (`onRecordTime`, `onSessionEnd`) →
 *         optional props defaulting to no-ops, preserving the Kotlin defaults.
 *   L58-63 `rememberLazyListState` + `scrollToItem(0)` → `div.scrollTo({ top: 0 })` in a
 *         `useEffect` keyed by `(chapter?.id, text)` — the same "回到顶部" behaviour.
 *   L74  `AnimatedVisibility(visible = showBars)` (no animation spec → default
 *         fade+expand) → `visibility`/`transform` CSS transition (200ms fade), preserving
 *         the hide/show semantics used by the tap-to-toggle handler (L151).
 *   L120 `MaterialTheme.colorScheme.error` → `var(--color-danger, #dc2626)`.
 *   L154 `Arrangement.spacedBy(10.dp)` → CSS `gap: 10px`.
 *   L156 `contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp)` →
 *         CSS `padding: 16px 20px`.
 *   L173 `onSurface.copy(alpha = 0.9f)` → `rgba(24,25,28,0.9)`.
 *
 * ── Platform adaptations ─────────────────────────────────────────────────────────
 *  * `ReadingTimerEffect(bookId = null, bookTitle = bookTitle ?: "在线小说", …)` →
 *    `createReadingTimer(null, bookTitle ?? '在线小说', …)` from
 *    `@core/reader/readingTimer`, wired through a `useEffect` whose cleanup calls
 *    `stop()` (Android `DisposableEffect.onDispose`).
 *  * Lifecycle ON_START/ON_STOP → `document.visibilityState` through the same
 *    `ReadingTimerVisibilityPort`.
 *  * `Text.split("\n\n")` — Kotlin's `String.split(String)` keeps empty segments, so the
 *    subsequent `filter { it.isNotEmpty() }` drops them. Ported with `split('\n\n')`
 *    (no limit argument) to keep that exact behaviour.
 *  * This page previously owned the source-fetch/parsing layer used by the demo shell;
 *    that layer stays intact (it is the data source, not part of NovelReaderScreen.kt)
 *    and the reader surface below is what this port replaces.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeTextWithCharsetDetection } from '@core/parser/charsetSniffer';
import { extractCleanTextFromHtml } from '@core/parser/htmlToText';
import { evalValues, parseHtml } from '@core/parser/legadoRule';
import { parseBookSourceList, type BookSourceConfig } from '@core/source/bookSourceTypes';
import type { ComicChapter } from '@core/source/comicChapter';
import {
  createReadingTimer,
  type ReadingTimerVisibilityPort,
} from '@core/reader/readingTimer';
import { getPlatform } from '@platform/index';
import type { HttpClient } from '@platform/interfaces';
import { AppButton } from '@ui/components/AppButton';
import { showToast } from '@ui/components/Toast';
import { useAppStore } from '@ui/state/appStore';
import '../../styles/reader.css';

/* ── Demo source payload (pre-existing shell data, unchanged) ── */

interface OnlineChapter {
  id: string;
  title: string;
  url: string;
}

interface DemoSourcePayload {
  book: { title: string; author: string; chapters: OnlineChapter[] };
  chapters: Record<string, { title: string; content: string }>;
}

const DEMO_SOURCE_JSON = JSON.stringify([
  {
    id: 'demo-novel-source',
    name: '示例在线小说源',
    enabled: true,
    group: '自定义',
    bookSourceUrl: 'https://demo.invalid',
    searchUrl: 'https://demo.invalid/search?q={{key}}',
    ruleBookList: '$.data.list.*',
    ruleBookName: 'name',
    ruleAuthor: 'author',
    ruleChapterList: '$.data.chapters.*',
    ruleChapterName: 'title',
    ruleChapterUrl: 'url',
    ruleContent: 'content',
  },
]);

const DEMO_PAYLOAD: DemoSourcePayload = {
  book: {
    title: '深夜书屋',
    author: '纯洁滴小龙',
    chapters: [
      { id: 'd1', title: '第一章 便利店', url: 'https://demo.invalid/c/1' },
      { id: 'd2', title: '第二章 雨夜', url: 'https://demo.invalid/c/2' },
      { id: 'd3', title: '第三章 镜子', url: 'https://demo.invalid/c/3' },
    ],
  },
  chapters: {
    d1: {
      title: '第一章 便利店',
      content:
        '凌晨两点，便利店的灯还亮着。\n\n林默把最后一箱牛奶码上货架，玻璃门上凝着一层薄薄的雾。\n\n门铃响了。进来的客人没有脸。',
    },
    d2: {
      title: '第二章 雨夜',
      content:
        '雨从屋檐连成线。\n\n林默追出去时，积水里只有一串正在消失的脚印。\n\n脚印尽头，霓虹灯忽然熄灭。',
    },
    d3: {
      title: '第三章 镜子',
      content:
        '更衣室的镜子里映出两个人影。\n\n林默举起手，镜中的自己却慢了半拍。\n\n然后，镜子里的人先笑了。',
    },
  },
};

function parseHeaderJson(header: string | undefined): Record<string, string> {
  if (header === undefined || header.trim() === '') return {};
  try {
    const raw: unknown = JSON.parse(header);
    if (typeof raw !== 'object' || raw === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function applyTemplate(template: string, key: string): string {
  return template.replace(/\{\{key\}\}/g, encodeURIComponent(key));
}

function extractWithRule(html: string, rule: string | undefined, fallback: string): string {
  if (rule === undefined || rule.trim() === '') return fallback;
  try {
    const doc = parseHtml(html);
    const values = evalValues(doc, rule);
    if (values.length > 0) return values.join('\n\n');
    return fallback;
  } catch {
    return fallback;
  }
}

function extractChapters(html: string, listRule: string, urlRule: string): OnlineChapter[] {
  void listRule;
  void urlRule;
  try {
    const matches = Array.from(
      html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([^<]{1,80})<\/a>/gi),
    );
    return matches.map((match, index) => ({
      id: `c-${String(index)}`,
      title: (match[2] ?? '').trim() || `第 ${String(index + 1)} 章`,
      url: match[1] ?? '',
    }));
  } catch {
    return [];
  }
}

function loadDemoPayload(sourceId: string): DemoSourcePayload {
  void sourceId;
  return DEMO_PAYLOAD;
}

/* ── Icons (Kotlin L12-14 automirrored material icons) ── */

function ArrowBackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    </svg>
  );
}

function NavigateBeforeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
    </svg>
  );
}

function NavigateNextIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    </svg>
  );
}

/** Kotlin L18 `ChasingDots(size = 46.dp, color = MintPrimary)`. */
function ChasingDots() {
  return (
    <span className="reader-loading-dots" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   NovelReaderScreen — Kotlin lines 31-220
   ══════════════════════════════════════════════════════════════════════════════ */

export interface NovelReaderOnlinePageProps {
  /** Kotlin `bookTitle: String?` (the reader title line). */
  bookTitle?: string | null;
  /** Kotlin `chapter: ComicChapter?`. */
  chapter?: ComicChapter | null;
  /** Kotlin `text: String` — chapter body, paragraphs separated by `\n\n`. */
  text: string;
  /** Kotlin `loading: Boolean`. */
  loading: boolean;
  /** Kotlin `error: String?`. */
  error?: string | null;
  /** Kotlin `hasNextChapter: Boolean`. */
  hasNextChapter: boolean;
  /** Kotlin `hasPrevChapter: Boolean`. */
  hasPrevChapter: boolean;
  onBack: () => void;
  onRetry: () => void;
  /** Android `onLoadPrev: () -> Unit`. */
  onLoadPrev: () => void;
  /** Android `onLoadNext: () -> Unit`. */
  onLoadNext: () => void;
  /** Kotlin default `{}` — seconds since the last flush. */
  onRecordTime?: (seconds: number) => void;
  /** Kotlin default `{}` — one continuous foreground span. */
  onSessionEnd?: (session: {
    id: number;
    bookId: number | null;
    bookTitle: string;
    dateStr: string;
    startTimeMs: number;
    endTimeMs: number;
    durationSeconds: number;
    startHour: number;
  }) => void;
}

/** Exported separately so other online-reader pages can share the Kotlin behaviour. */
export function NovelReaderScreen(props: NovelReaderOnlinePageProps) {
  const {
    bookTitle,
    chapter,
    text,
    loading,
    error = null,
    hasNextChapter,
    hasPrevChapter,
    onBack,
    onRetry,
    onLoadPrev,
    onLoadNext,
  } = props;
  const onRecordTime = props.onRecordTime ?? (() => {});
  const onSessionEnd = props.onSessionEnd;

  // 在线阅读计时（阅读统计修复①）：与在线漫画同款——只在 App 前台 + 屏幕亮时累计，
  // 此前在线小说阅读完全不写阅读记录，统计页看不到读过的网文
  // (Kotlin L48-55)
  useReadingTimer(bookTitle ?? '在线小说', onRecordTime, onSessionEnd);

  // Kotlin L56-57
  const [fontSizeSp, setFontSizeSp] = useState(17);
  const [showBars, setShowBars] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 切章后回到顶部 (Kotlin L60-63)
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = 0;
  }, [chapter?.id, text]);

  // Kotlin L65-69 `text.split("\n\n").map { it.trim() }.filter { it.isNotEmpty() }`
  const paragraphs = useMemo(
    () =>
      text
        .split('\n\n')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    [text],
  );

  return (
    <div className="reader-root reader-root--novel-online">
      {/* 顶栏 (Kotlin L73-111) */}
      <div
        className="reader-top-bar"
        style={{
          // AnimatedVisibility(visible = showBars) — default fade + expand
          opacity: showBars ? 1 : 0,
          transform: showBars ? 'translateY(0)' : 'translateY(-8px)',
          transition: 'opacity 200ms ease, transform 200ms ease',
          pointerEvents: showBars ? 'auto' : 'none',
        }}
      >
        <button
          type="button"
          className="reader-icon-btn"
          onClick={onBack}
          aria-label="返回"
        >
          <ArrowBackIcon />
        </button>
        <div className="reader-online-title">
          <p className="reader-online-title-main">{bookTitle ?? '阅读'}</p>
          <p className="reader-online-title-sub">{chapter?.title ?? ''}</p>
        </div>
        <button
          type="button"
          className="reader-icon-btn"
          onClick={() => {
            if (fontSizeSp > 12) setFontSizeSp(fontSizeSp - 1);
          }}
        >
          <span className="reader-font-btn">A-</span>
        </button>
        <button
          type="button"
          className="reader-icon-btn"
          onClick={() => {
            if (fontSizeSp < 26) setFontSizeSp(fontSizeSp + 1);
          }}
        >
          <span className="reader-font-btn reader-font-btn--primary">A+</span>
        </button>
      </div>

      {loading && paragraphs.length === 0 ? (
        /* Kotlin L114-122 */
        <div className="reader-center">
          <ChasingDots />
          <div style={{ height: 10 }} />
          <p className="reader-center-text">正在加载正文…</p>
        </div>
      ) : null}

      {error !== null && paragraphs.length === 0 ? (
        /* Kotlin L124-138 */
        <div className="reader-center">
          <p className="reader-center-text reader-center-text--error">{error}</p>
          <div style={{ height: 12 }} />
          <AppButton size="sm" onClick={onRetry}>
            重试
          </AppButton>
        </div>
      ) : null}

      {!loading && error === null && paragraphs.length === 0 ? (
        /* Kotlin L140-145 */
        <div className="reader-center">
          <p className="reader-center-text">本章没有内容</p>
        </div>
      ) : null}

      {paragraphs.length > 0 ? (
        /* Kotlin L147-215 LazyColumn */
        <div
          className="reader-content reader-content--novel-online"
          ref={scrollRef}
          style={{ fontSize: `${String(fontSizeSp)}px` }}
          onClick={() => {
            setShowBars(!showBars);
          }}
        >
          <div className="reader-novel-title-block">
            <h2
              className="reader-novel-title"
              style={{ fontSize: `${String(fontSizeSp + 4)}px` }}
            >
              {chapter?.title ?? ''}
            </h2>
            <div style={{ height: 6 }} />
            <div className="cache-divider cache-divider--soft" />
            <div style={{ height: 14 }} />
          </div>
          {paragraphs.map((paragraph, index) => (
            <p
              key={index}
              className="reader-paragraph"
              style={{
                fontSize: 'inherit',
                lineHeight: 1.75,
                color: 'rgba(24, 25, 28, 0.9)',
              }}
            >
              {paragraph}
            </p>
          ))}

          {/* 底部翻章 (Kotlin L176-214) */}
          <div className="reader-novel-nav">
            {hasPrevChapter ? (
              <button
                type="button"
                className="reader-novel-nav-btn"
                onClick={onLoadPrev}
              >
                <NavigateBeforeIcon />
                <span className="reader-novel-nav-gap" />
                <span>上一章</span>
              </button>
            ) : null}
            {hasNextChapter ? (
              <button
                type="button"
                className="reader-novel-nav-btn reader-novel-nav-btn--primary"
                onClick={onLoadNext}
              >
                <span>下一章</span>
                <span className="reader-novel-nav-gap" />
                <NavigateNextIcon />
              </button>
            ) : null}
          </div>
          <div style={{ height: 24 }} />
        </div>
      ) : null}
    </div>
  );
}

/* ── ReadingTimerEffect binding — Kotlin lines 48-55 → core/reader/readingTimer ── */

function useReadingTimer(
  bookTitle: string,
  onFlush: (seconds: number) => void,
  onSessionEnd?: (session: {
    id: number;
    bookId: number | null;
    bookTitle: string;
    dateStr: string;
    startTimeMs: number;
    endTimeMs: number;
    durationSeconds: number;
    startHour: number;
  }) => void,
): void {
  const flushRef = useRef(onFlush);
  const endRef = useRef(onSessionEnd);
  const titleRef = useRef(bookTitle);
  // 「最新值」ref 同步：写在 effect 里而不是渲染期，声明在下面的定时器 effect 之前，
  // 所以挂载时定时器 effect 读到的仍是同一个初值。
  useEffect(() => {
    flushRef.current = onFlush;
    endRef.current = onSessionEnd;
    titleRef.current = bookTitle;
  });

  useEffect(() => {
    // Android `LifecycleEventObserver` → `document.visibilityState`
    const visibility: ReadingTimerVisibilityPort = {
      start: () => {},
      stop: () => {},
      subscribe: (onVisibility) => {
        const handler = (): void => {
          onVisibility(document.visibilityState === 'visible');
        };
        document.addEventListener('visibilitychange', handler);
        return () => {
          document.removeEventListener('visibilitychange', handler);
        };
      },
    };
    const timer = createReadingTimer(null, titleRef.current, {
      visibility,
      onFlush: (seconds) => {
        flushRef.current(seconds);
      },
      onSessionEnd: (session) => {
        endRef.current?.(session);
      },
    });
    // DisposableEffect(lifecycleOwner) + onDispose { endCurrentSession() }
    return () => {
      timer.stop();
    };
  }, []);
}

/* ══════════════════════════════════════════════════════════════════════════════
   NovelReaderOnlinePage — the routed shell (data source, unchanged from the
   pre-existing page; the reader surface above is the NovelReaderScreen.kt port)
   ══════════════════════════════════════════════════════════════════════════════ */

export function NovelReaderOnlinePage() {
  const setRoute = useAppStore((s) => s.setRoute);
  const platform = useMemo(() => getPlatform(), []);
  const [sources, setSources] = useState<BookSourceConfig[]>(() =>
    parseBookSourceList(DEMO_SOURCE_JSON),
  );
  const [selectedSourceId, setSelectedSourceId] = useState(() => sources[0]?.id ?? '');
  const [keyword, setKeyword] = useState('深夜书屋');
  const [bookTitle, setBookTitle] = useState('');
  const [bookAuthor, setBookAuthor] = useState('');
  const [chapters, setChapters] = useState<OnlineChapter[]>([]);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceInput, setSourceInput] = useState('');
  const [showSourcePanel, setShowSourcePanel] = useState(false);
  const [showSourceDrawer, setShowSourceDrawer] = useState(false);

  const source = useMemo(
    () => sources.find((s) => s.id === selectedSourceId) ?? sources[0] ?? null,
    [selectedSourceId, sources],
  );

  const chapter = chapters[chapterIndex] ?? null;

  const loadSourceText = useCallback(
    async (url: string, headers: Record<string, string>): Promise<string> => {
      if (source === null) throw new Error('未选择书源');
      if (source.id.startsWith('demo-')) return 'demo';
      const http: HttpClient = platform.http;
      const res = await http.request({ url, method: 'GET', headers });
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${String(res.status)}`);
      return decodeTextWithCharsetDetection(res.body);
    },
    [platform.http, source],
  );

  const searchAndOpen = useCallback(async () => {
    if (source === null) {
      showToast('请先选择书源');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = parseHeaderJson(source.header);
      if (source.id.startsWith('demo-')) {
        const demo = loadDemoPayload(source.id);
        setBookTitle(demo.book.title);
        setBookAuthor(demo.book.author);
        setChapters(demo.book.chapters);
        setChapterIndex(0);
        const first = demo.book.chapters[0];
        if (first) setText(demo.chapters[first.id]?.content ?? '');
        showToast('已从示例源加载');
        return;
      }
      if (source.searchUrl === undefined) throw new Error('书源缺少 searchUrl');
      const searchUrl = applyTemplate(source.searchUrl, keyword);
      const searchHtml = await loadSourceText(searchUrl, headers);
      const parsedChapters = extractChapters(
        searchHtml,
        source.ruleChapterList ?? '$.data.chapters.*',
        source.ruleChapterUrl ?? 'url',
      );
      setBookTitle(extractWithRule(searchHtml, source.ruleBookName, keyword));
      setBookAuthor(extractWithRule(searchHtml, source.ruleAuthor, ''));
      setChapters(parsedChapters);
      setChapterIndex(0);
      if (parsedChapters.length > 0) {
        const first = parsedChapters[0];
        if (first !== undefined && first.url !== '') {
          const contentHtml = await loadSourceText(first.url, headers);
          setText(
            extractWithRule(contentHtml, source.ruleContent, extractCleanTextFromHtml(contentHtml)),
          );
        } else {
          setText('');
        }
      } else {
        setText('');
        showToast('未解析到章节');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      showToast(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [keyword, loadSourceText, source]);

  const loadChapter = useCallback(
    async (index: number) => {
      const target = chapters[index];
      if (!target) return;
      setLoading(true);
      setError(null);
      setChapterIndex(index);
      try {
        if (source?.id.startsWith('demo-') === true) {
          const demo = loadDemoPayload(source.id);
          setText(demo.chapters[target.id]?.content ?? '');
          return;
        }
        if (source === null || target.url === '') {
          setText('');
          showToast('该章节缺少 URL');
          return;
        }
        const headers = parseHeaderJson(source.header);
        const html = await loadSourceText(target.url, headers);
        setText(extractWithRule(html, source.ruleContent, extractCleanTextFromHtml(html)));
      } catch (err) {
        setError(err instanceof Error ? err.message : '章节加载失败');
        showToast(err instanceof Error ? err.message : '章节加载失败');
      } finally {
        setLoading(false);
      }
    },
    [chapters, loadSourceText, source],
  );

  useEffect(() => {
    if (source === null) return undefined;
    if (source.id.startsWith('demo-') && chapters.length === 0) {
      const t = setTimeout(() => {
        void searchAndOpen();
      }, 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [chapters.length, searchAndOpen, source]);

  // Kotlin `chapter: ComicChapter?` — the routed shell tracks the lightweight chapter.
  const readerChapter: ComicChapter | null =
    chapter === null
      ? null
      : {
          id: chapter.id,
          title: chapter.title,
          volume: null,
          order: chapterIndex,
          external: false,
          externalUrl: null,
        };

  return (
    <div className="reader-root reader-root--novel-shell">
      {/* NovelReaderScreen.kt port (Kotlin L31-220) — the reader surface. */}
      <NovelReaderScreen
        bookTitle={bookTitle}
        chapter={readerChapter}
        text={text}
        loading={loading}
        error={error}
        hasNextChapter={chapterIndex < chapters.length - 1}
        hasPrevChapter={chapterIndex > 0}
        onBack={() => setRoute('main')}
        onRetry={() => void loadChapter(chapterIndex)}
        onLoadPrev={() => void loadChapter(Math.max(0, chapterIndex - 1))}
        onLoadNext={() => void loadChapter(Math.min(chapters.length - 1, chapterIndex + 1))}
      />

      {/* Source picker drawer (pre-existing shell chrome, not part of
          NovelReaderScreen.kt — kept so the demo/web build can still pick a source). */}
      <button
        type="button"
        className="reader-icon-btn reader-shell-fab"
        onClick={() => setShowSourceDrawer((prev) => !prev)}
        aria-label="在线书源"
      >
        源
      </button>

      {showSourceDrawer ? (
        <div className="reader-shell-drawer">
          <div className="glass-card">
            <p className="source-name" style={{ marginBottom: 8 }}>
              在线书源
            </p>
            <select
              value={selectedSourceId}
              onChange={(event) => setSelectedSourceId(event.target.value)}
              style={{
                width: '100%',
                borderRadius: 12,
                border: '1px solid rgba(232, 201, 122, 0.25)',
                background: 'rgba(24, 25, 28, 0.4)',
                color: 'inherit',
                padding: '10px 12px',
                font: 'inherit',
              }}
              aria-label="选择书源"
            >
              {sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="书名 / 关键词"
                style={{
                  flex: 1,
                  borderRadius: 12,
                  border: '1px solid rgba(232, 201, 122, 0.25)',
                  background: 'rgba(24, 25, 28, 0.4)',
                  color: 'inherit',
                  padding: '10px 12px',
                  font: 'inherit',
                }}
                aria-label="搜索关键词"
              />
              <AppButton size="sm" onClick={() => void searchAndOpen()}>
                加载
              </AppButton>
            </div>
            <div className="settings-button-row" style={{ padding: '10px 0 0' }}>
              <AppButton
                size="sm"
                variant="tertiary"
                onClick={() => setShowSourcePanel((prev) => !prev)}
              >
                {showSourcePanel ? '收起源配置' : '导入书源'}
              </AppButton>
            </div>
            {showSourcePanel ? (
              <div style={{ marginTop: 10 }}>
                <textarea
                  value={sourceInput}
                  onChange={(event) => setSourceInput(event.target.value)}
                  placeholder="粘贴 Legado 书源 JSON"
                  style={{
                    width: '100%',
                    minHeight: 90,
                    borderRadius: 12,
                    border: '1px solid rgba(232, 201, 122, 0.25)',
                    background: 'rgba(24, 25, 28, 0.4)',
                    color: 'inherit',
                    padding: 10,
                    font: 'inherit',
                  }}
                  aria-label="书源 JSON"
                />
                <AppButton
                  size="sm"
                  onClick={() => {
                    try {
                      const incoming = parseBookSourceList(sourceInput);
                      setSources((prev) => {
                        const map = new Map(prev.map((s) => [s.id, s]));
                        for (const item of incoming) map.set(item.id, item);
                        return [...map.values()];
                      });
                      setSelectedSourceId(incoming[0]?.id ?? '');
                      showToast(`已导入 ${String(incoming.length)} 个书源`);
                      setSourceInput('');
                      setShowSourcePanel(false);
                    } catch (err) {
                      showToast(err instanceof Error ? err.message : '导入失败');
                    }
                  }}
                >
                  导入
                </AppButton>
              </div>
            ) : null}
          </div>

          {bookAuthor !== '' ? (
            <p className="book-author" style={{ marginTop: 0 }}>
              {bookTitle} · {bookAuthor} · {String(chapters.length)} 章
            </p>
          ) : null}

          {chapters.length > 0 ? (
            <div className="glass-card" style={{ marginTop: 16 }}>
              <p className="source-name" style={{ marginBottom: 8 }}>
                章节目录
              </p>
              <div className="chapter-list">
                {chapters.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className="chapter-item"
                    style={
                      index === chapterIndex
                        ? {
                            borderColor: 'rgba(232, 201, 122, 0.5)',
                            background: 'rgba(232, 201, 122, 0.08)',
                          }
                        : undefined
                    }
                    onClick={() => void loadChapter(index)}
                  >
                    <p className="chapter-item-title">{item.title}</p>
                    <span className="chapter-item-meta">›</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
