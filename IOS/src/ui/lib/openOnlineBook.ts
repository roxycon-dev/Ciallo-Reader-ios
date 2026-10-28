import type { SearchBook } from '@core/source/searchBook';
import { setComicDetailTarget } from '@core/comic/comicChapters';
import { useAppStore } from '@ui/state/appStore';

/** Every entry point carries the selected work, including works not in favorites. */
export function openOnlineBook(book: SearchBook): void {
  setComicDetailTarget({ sourceId: book.sourceId, comicId: book.id, book });
  useAppStore.getState().setRoute('comicChapters');
}
