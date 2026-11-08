import { sharedWorkLinkParse } from '@core/library/sharedWorkLink';
import { getLibraryRuntime } from '@core/library/libraryRuntime';
import { createSearchBook } from '@core/source/searchBook';
import { bootstrapLibrary } from '@ui/state/appStore';
import { openOnlineBook } from './openOnlineBook';
import { setSharedNovelTarget } from '@ui/sharedNovelTarget';

/** Resolve only the explicitly named, enabled source; never substitute another work. */
export async function openSharedWork(raw: string): Promise<boolean> {
  const target = sharedWorkLinkParse(raw); if (!target) return false;
  await bootstrapLibrary();
  const manager = getLibraryRuntime()?.sourceManager;
  if (!manager) throw new Error('书源尚未准备好，请重试');
  await manager.initialize();
  const source = manager.getSource(target.sourceId);
  if (!source || !manager.isSourceEnabled(target.sourceId)) throw new Error('请先在书源管理中启用分享作品使用的相同书源');
  const book = createSearchBook({ sourceId: target.sourceId, id: target.bookId, comicId: target.bookId,
    title: target.title || '分享的作品', author: '', format: source.capabilities.supportOnlineText ? 'txt' : source.capabilities.supportEbook ? 'epub' : 'comic' });
  if (source.capabilities.supportEbook && !source.capabilities.supportOnlineText) setSharedNovelTarget(book);
  else openOnlineBook(book);
  return true;
}
