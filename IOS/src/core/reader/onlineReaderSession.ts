import type { ComicChapter } from '@core/source/comicChapter';
import type { ComicDetailTarget } from '@core/comic/comicChapters';

export interface OnlineReaderTarget {
  target: ComicDetailTarget;
  chapters: readonly ComicChapter[];
  chapterId: string;
  initialPage: number;
}

let pending: OnlineReaderTarget | null = null;

/** Carry the exact chapter selection across the directory/reader route boundary. */
export function setOnlineReaderTarget(target: OnlineReaderTarget | null): void {
  if (target === null) {
    pending = null;
    return;
  }
  if (!target.chapters.some((chapter) => chapter.id === target.chapterId)) {
    throw new Error('所选章节不在当前目录中');
  }
  pending = { ...target, chapters: [...target.chapters].sort((a, b) => a.order - b.order) };
}

export function getOnlineReaderTarget(): OnlineReaderTarget | null {
  return pending;
}
