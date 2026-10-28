import { useEffect, useMemo, useRef, useState } from 'react';
import { getOnlineReaderTarget } from '@core/reader/onlineReaderSession';
import { setComicDetailTarget } from '@core/comic/comicChapters';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { ComicSource } from '@core/source/comicSource';
import { getPlatform } from '@platform/index';
import { useAppStore } from '@ui/state/appStore';
import { OnlineComicReaderPage } from './ComicReaderOnlinePage';
import { NovelReaderScreen } from './NovelReaderOnlinePage';
import { JsImageProcessor } from '@core/source/js/jsImageProcessor';
import { ProductionComicSurface } from './ProductionComicSurface';
import { normalizeImage, MhttuImageDecryptor } from '@core/library/libraryImageBytes';
import { createWebCrypto } from '@platform/web/webCrypto';
import { useReadingStatistics } from '@ui/hooks/useReadingStatistics';

/** Production route: source methods supply actual chapters; no demo data. */
export function OnlineReaderRoute({ textMode = false }: { textMode?: boolean }) {
  const [request] = useState(getOnlineReaderTarget);
  const [index, setIndex] = useState(() =>
    Math.max(0, request?.chapters.findIndex((chapter) => chapter.id === request.chapterId) ?? 0),
  );
  const [retry, setRetry] = useState(0);
  const [content, setContent] = useState<{
    text: string;
    urls: string[];
    headers: Record<string, Record<string, string>>;
  }>({ text: '', urls: [], headers: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const loadToken = useRef(0);
  const setRoute = useAppStore((state) => state.setRoute);
  const chapter = request?.chapters[index] ?? null;
  const source =
    request === null
      ? null
      : (getLibraryRuntime()?.sourceManager?.getSource(request.target.sourceId) ?? null);
  const title = request?.target.book?.title ?? '在线阅读';
  const loadingCurrent = loading || (chapter !== null && loadedId !== chapter.id);
  useReadingStatistics({ bookId: null, title, enabled: request !== null && !loadingCurrent && error === null });

  useEffect(() => {
    const token = ++loadToken.current;
    let cancelled = false;
    void (async () => {
      if (chapter === null || !(source instanceof ComicSource))
        throw new Error('无法读取章节，请返回目录重新选择。');
      if (chapter.external) throw new Error('该章节为站外链接，请从目录打开原站。');
      if (textMode) {
        const result = await source.getChapterText(chapter.id);
        if (result.kind === 'error') throw result.exception;
        if (result.data.trim() === '') throw new Error('该章节返回了空正文，请重试或更换书源。');
        if (!cancelled && token === loadToken.current)
          setContent({ text: result.data, urls: [], headers: {} });
      } else {
        const result = await source.getChapterImages(chapter.id);
        if (result.kind === 'error') throw result.exception;
        if (result.data.length === 0) throw new Error('该章节返回了空图片列表，请重试或更换书源。');
        const headers = await source.getChapterImageHeaders(chapter.id, result.data);
        if (!cancelled && token === loadToken.current)
          setContent({ text: '', urls: result.data, headers });
      }
      if (!cancelled && token === loadToken.current) {
        setLoadedId(chapter.id);
        setError(null);
      }
    })()
      .catch((reason: unknown) => {
        if (!cancelled && token === loadToken.current) {
          setError(reason instanceof Error ? reason.message : '章节加载失败');
          setLoadedId(chapter?.id ?? null);
        }
      })
      .finally(() => {
        if (!cancelled && token === loadToken.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chapter, source, textMode, retry]);

  const pipelineDeps = useMemo(
    () => ({
      hasJsTransform: JsImageProcessor.hasTransform,
      transformJsImage: JsImageProcessor.transform,
      normalizeImage,
      isEncryptedHost: MhttuImageDecryptor.isEncryptedHost,
      decryptIfNeeded: (bytes: Uint8Array) => MhttuImageDecryptor.decryptIfNeeded(bytes, createWebCrypto()),
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const response = await getPlatform().http.request({
          url,
          method: 'GET',
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
        });
        if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return new Response(response.body as Uint8Array<ArrayBuffer>, {
          status: response.status,
          headers: response.headers,
        });
      }) as typeof fetch,
    }),
    [],
  );
  const back = (): void => {
    if (request) setComicDetailTarget(request.target);
    setRoute('comicChapters');
  };
  const jump = (next: number): void => {
    if (request === null || next < 0 || next >= request.chapters.length) return;
    setLoading(true);
    setError(null);
    setContent({ text: '', urls: [], headers: {} });
    setIndex(next);
  };
  const retryLoad = (): void => {
    setLoading(true);
    setError(null);
    setRetry((value) => value + 1);
  };

  if (textMode)
    return (
      <NovelReaderScreen
        bookTitle={title}
        chapter={chapter}
        text={loadingCurrent ? '' : content.text}
        loading={loadingCurrent}
        error={error}
        hasPrevChapter={index > 0}
        hasNextChapter={index + 1 < (request?.chapters.length ?? 0)}
        onBack={back}
        onRetry={retryLoad}
        onLoadPrev={() => jump(index - 1)}
        onLoadNext={() => jump(index + 1)}
      />
    );

  return (
    <OnlineComicReaderPage
      key={chapter?.id ?? 'missing'}
      readerSurface={ProductionComicSurface}
      title={chapter?.title ?? title}
      bookTitle={title}
      bookKey={request === null ? null : `${request.target.sourceId}::${request.target.comicId}`}
      imageUrls={loadingCurrent ? [] : content.urls}
      imageHeaders={content.headers}
      loading={loadingCurrent}
      error={error}
      onBack={back}
      onRetry={retryLoad}
      chapters={request?.chapters ?? []}
      currentChapterIndex={index}
      initialPage={request !== null && chapter?.id === request.chapterId ? request.initialPage : 0}
      onJumpToChapter={jump}
      onPrevChapter={index > 0 ? () => jump(index - 1) : null}
      onNextChapter={index + 1 < (request?.chapters.length ?? 0) ? () => jump(index + 1) : null}
      resolveImage={source instanceof ComicSource ? (url) => source.resolveChapterImage(url) : null}
      resolveImageHeaders={
        source instanceof ComicSource ? (url) => source.getResolvedHeaders(url) : null
      }
      pipelineDeps={pipelineDeps}
      onPageChanged={(page, count) => {
        if (request === null || chapter === null || loadingCurrent || error !== null) return;
        void getLibraryRuntime()
          ?.favorites?.saveProgress(
            request.target.sourceId,
            request.target.comicId,
            chapter.id,
            index,
            page,
            count,
          )
          .catch((reason: unknown) => console.warn('[reader] 阅读进度保存失败', reason));
      }}
    />
  );
}
