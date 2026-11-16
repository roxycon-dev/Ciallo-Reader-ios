import type { SearchBook } from '@core/source/searchBook';
import { setComicDetailTarget } from '@core/comic/comicChapters';
import {
  librarySessionIdFromRoute,
  sessionComicChaptersRoute,
  useAppStore,
} from '@ui/state/appStore';
import { rememberComicChapterRouteTarget } from '@ui/pages/comicChapterRouteTargets';

/** Every entry point carries the selected work, including works not in favorites. */
export function openOnlineBook(book: SearchBook): void {
  const target = { sourceId: book.sourceId, comicId: book.id, book };
  setComicDetailTarget(target);
  const { route, setRoute } = useAppStore.getState();
  const sessionId = librarySessionIdFromRoute(route);
  const chapterRoute = sessionId === null ? 'comicChapters' : sessionComicChaptersRoute(sessionId);
  rememberComicChapterRouteTarget(chapterRoute, target);
  setRoute(chapterRoute);
}
