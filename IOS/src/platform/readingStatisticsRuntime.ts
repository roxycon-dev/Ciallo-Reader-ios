import type { BookRepository } from '@core/library/bookRepository';
import { ReadingStatisticsWriter } from '@core/reader/readingStatisticsWriter';
import { PreferencesManager, SettingsRepository } from '@core/settings/settingsRepository';
import { getPlatform } from '@platform/index';
import { getPrivacyService } from './privacyRuntime';

const writers = new WeakMap<BookRepository, ReadingStatisticsWriter>();
export function getReadingStatisticsWriter(repo: BookRepository): ReadingStatisticsWriter {
  let writer = writers.get(repo);
  if (!writer) { writer = new ReadingStatisticsWriter(repo, new PreferencesManager(new SettingsRepository(getPlatform().db)), getPrivacyService()); writers.set(repo, writer); }
  return writer;
}
/** Route transitions may read statistics before the previous reader's asynchronous flush commits. */
export async function flushReadingStatistics(repo: BookRepository | null): Promise<void> {
  if (repo) await writers.get(repo)?.settled();
}
