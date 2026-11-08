import { useSyncExternalStore } from 'react';
import type { SearchBook } from '@core/source/searchBook';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { DiscoverNovelDetails } from './components/discover/DiscoverNovelDetails';

let target: SearchBook | null = null;
const listeners = new Set<() => void>();
export function setSharedNovelTarget(book: SearchBook | null): void { target = book; for (const listener of listeners) listener(); }
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = (): SearchBook | null => target;
export function SharedNovelTarget() {
  const book = useSyncExternalStore(subscribe, snapshot, snapshot), runtime = getLibraryRuntime();
  return book && runtime ? <DiscoverNovelDetails key={`${book.sourceId}::${book.id}`} book={book} runtime={runtime} onDismiss={() => setSharedNovelTarget(null)} /> : null;
}
