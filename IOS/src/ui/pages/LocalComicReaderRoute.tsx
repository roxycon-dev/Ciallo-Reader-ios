import { useEffect, useState } from 'react';
import { ComicReaderPage } from './ComicReaderPage';
import { getBookRepository, useAppStore } from '@ui/state/appStore';
import { getPlatform } from '@platform/index';
import { createAppComicLoader } from '@platform/raster/comicLoader';
import type { BookRow } from '@core/library/bookTypes';
import type { ComicPageLoaderPort, ComicPageRef } from '@core/comic/comicReaderCore';
import { useReadingStatistics } from '@ui/hooks/useReadingStatistics';

/** Local CBZ/PDF downloads use their stored page paths and the full reader engine. */
export function LocalComicReaderRoute() {
  const bookId = useAppStore((state) => state.currentBookId);
  const setRoute = useAppStore((state) => state.setRoute);
  const [retry, setRetry] = useState(0);
  const [content, setContent] = useState<{ book: BookRow; pages: ComicPageRef[]; loader: ComicPageLoaderPort } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useReadingStatistics({ bookId, title: content?.book.title ?? '', enabled: content !== null && error === null });
  useEffect(() => {
    let cancelled = false;
    let loader: ComicPageLoaderPort | null = null;
    void (async () => {
      const repo = getBookRepository();
      if (repo === null || bookId === null) throw new Error('书籍不存在，请返回书架重新打开');
      const book = await repo.getBook(bookId);
      const chapters = await repo.listChapters(bookId);
      if (!book || book.contentType !== 'COMIC' || !chapters.length) throw new Error('漫画页面缺失，请重新导入');
      if (cancelled) return;
      loader = createAppComicLoader(getPlatform());
      setContent({ book, loader, pages: chapters.map((chapter) => ({ kind: 'LOCAL', id: `${bookId}:${chapter.chapterOrder}`, path: chapter.content })) });
      setError(null);
    })().catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '漫画打开失败'); });
    return () => { cancelled = true; loader?.shutdown(); };
  }, [bookId, retry]);
  const back = (): void => { setRoute('main'); };
  if (error) return <main className="startup-status" role="alert"><p>{error}</p><button onClick={() => setRetry((value) => value + 1)}>重试</button><button onClick={back}>返回书架</button></main>;
  if (!content) return <main className="startup-status" role="status">正在打开漫画…</main>;
  return <ComicReaderPage key={content.book.id} pages={content.pages} loader={content.loader}
    title={content.book.title} bookKey={`local:${content.book.id}`} initialPage={content.book.currentChapterIndex} onExit={back}
    onPageChanged={(page, finished) => useAppStore.getState().saveReaderProgress(page, 0, finished)} />;
}
