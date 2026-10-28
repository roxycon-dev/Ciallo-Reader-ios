import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComicSource } from '@core/source/comicSource';
import { SourceResult } from '@core/source/sourceResult';
import { createComicChapter } from '@core/source/comicChapter';
import { getOnlineReaderTarget, setOnlineReaderTarget } from '@core/reader/onlineReaderSession';
import { OnlineReaderRoute } from '@ui/pages/OnlineReaderRoute';

const state = vi.hoisted(() => ({ source: null as ComicSource | null }));
vi.mock('@core/library/libraryRuntime', () => ({
  getLibraryRuntime: () => ({
    sourceManager: { getSource: () => state.source },
  }),
}));
vi.mock('@ui/pages/NovelReaderOnlinePage', () => ({
  NovelReaderScreen: (props: {
    text: string;
    error: string | null;
    loading: boolean;
    onLoadNext: () => void;
  }) => (
    <div>
      <p>{props.loading ? '加载中' : (props.error ?? props.text)}</p>
      <button onClick={props.onLoadNext}>下一章</button>
    </div>
  ),
}));
vi.mock('@ui/pages/ComicReaderOnlinePage', () => ({
  OnlineComicReaderPage: () => <div>漫画阅读</div>,
}));

describe('selected online chapter route', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    setOnlineReaderTarget(null);
    state.source = Object.assign(Object.create(ComicSource.prototype), {
      getChapterText: vi.fn(async (id: string) => SourceResult.Success(`真实正文 ${id}`)),
    }) as ComicSource;
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    setOnlineReaderTarget(null);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });
  const select = (id: string): void =>
    setOnlineReaderTarget({
      target: { sourceId: 'custom', comicId: 'book', book: null },
      chapters: [
        createComicChapter({ id: 'b', title: '第二章', order: 2 }),
        createComicChapter({ id: 'a', title: '第一章', order: 1 }),
      ],
      chapterId: id,
      initialPage: 3,
    });

  it('opens the exact selected chapter and changes chapters through the real source', async () => {
    select('a');
    expect(getOnlineReaderTarget()?.chapters.map((chapter) => chapter.id)).toEqual(['a', 'b']);
    await act(async () => root.render(<OnlineReaderRoute textMode />));
    expect(host.textContent).toContain('真实正文 a');
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toContain('真实正文 b');
    expect(state.source!.getChapterText).toHaveBeenLastCalledWith('b');
  });

  it('shows an error for a missing selection instead of substituting demonstration content', async () => {
    await act(async () => root.render(<OnlineReaderRoute textMode />));
    expect(host.textContent).toContain('返回目录重新选择');
    expect(host.textContent).not.toContain('真实正文');
  });

  it('discards late responses from a chapter the reader already left', async () => {
    let finishFirst!: (value: ReturnType<typeof SourceResult.Success<string>>) => void;
    state.source!.getChapterText = vi.fn((id: string) =>
      id === 'a'
        ? new Promise<ReturnType<typeof SourceResult.Success<string>>>((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve(SourceResult.Success('第二章正文')),
    );
    select('a');
    await act(async () => root.render(<OnlineReaderRoute textMode />));
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toContain('第二章正文');
    await act(async () => finishFirst(SourceResult.Success('过期的第一章正文')));
    expect(host.textContent).toContain('第二章正文');
    expect(host.textContent).not.toContain('过期');
  });
});
