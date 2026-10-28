import { useEffect, useState } from 'react';
import { ComicReaderPage } from './ComicReaderPage';
import type { ComicReaderSurfaceProps } from './ComicReaderOnlinePage';
import type { ComicPageLoaderPort } from '@core/comic/comicReaderCore';
import { createAppComicLoader } from '@platform/raster/comicLoader';
import { getPlatform } from '@platform/index';

/** Online and offline reading share settings, gestures, layouts and pixel processing. */
export function ProductionComicSurface(props: ComicReaderSurfaceProps) {
  const { pages, loadPageBytes } = props;
  const [loader, setLoader] = useState<ComicPageLoaderPort | null>(null);
  useEffect(() => {
    let cancelled = false;
    let current: ComicPageLoaderPort | null = null;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      current = createAppComicLoader(getPlatform(), { fetchRemote: async (url) => {
        const ref = pages.find((page) => page.kind === 'REMOTE' && page.url === url);
        if (!ref || !loadPageBytes) throw new Error('在线页面已失效，请重新打开章节');
        return loadPageBytes(ref);
      } });
      setLoader(current);
    });
    return () => { cancelled = true; current?.shutdown(); };
  }, [pages, loadPageBytes]);
  if (!loader) return <div role="status" className="startup-status">正在准备漫画…</div>;
  return <ComicReaderPage pages={props.pages} loader={loader} title={props.bookTitle ?? ''} chapterTitle={props.chapterTitle}
    bookKey={props.bookKey ?? null} initialPage={props.initialPage} toc={props.toc} currentChapterIndex={props.currentChapterIndex}
    onJumpToChapter={props.onJumpToChapter ?? null} onPrevChapter={props.onPrevChapter ?? null} onNextChapter={props.onNextChapter ?? null}
    chapterNavLabel={props.chapterNavLabel} onExit={props.onExit} onPageChanged={props.onPageChanged} onGodMoment={props.onGodMoment ?? null} />;
}
