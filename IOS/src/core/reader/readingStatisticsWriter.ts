import type { BookRepository } from '@core/library/bookRepository';
import type { ReadingSessionRow } from '@core/library/readingSessionTypes';
import { contentMutationGate } from '@core/library/contentMutationGate';
import { ReadingTimeSlices } from '@core/data/readingTimeSlices';
import type { PreferencesManager } from '@core/settings/settingsRepository';
import type { PrivacyService } from '@core/privacy/privacyService';

export interface ReadingIdentity { bookId: number | null; title: string }

/** One queue for timer flushes and session rows; sessions never increment totals a second time. */
export class ReadingStatisticsWriter {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly repo: BookRepository, private readonly prefs: PreferencesManager, private readonly privacy: PrivacyService) {}
  private enqueue(operation: () => Promise<void>): Promise<void> {
    const task = this.tail.catch(() => {}).then(operation); this.tail = task.catch(() => {}); return task;
  }
  private async mayRecord(identity: ReadingIdentity): Promise<boolean> {
    if (await this.prefs.incognitoBrowsingEnabled()) return false;
    const privacy = await this.privacy.ready();
    if (identity.bookId === null) return true;
    const book = await this.repo.getBook(identity.bookId);
    if (!book) return false;
    if (!privacy.enabled) return true;
    const category = await this.repo.getCategoryByName(book.category ?? '默认');
    return !category?.isProtected;
  }
  recordTime(identity: ReadingIdentity, seconds: number, end = Date.now()): Promise<void> {
    const epoch = contentMutationGate.epoch;
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 7 * 86_400 || !Number.isFinite(end)) return Promise.resolve();
    const slices = ReadingTimeSlices.split(end - seconds * 1000, end, seconds);
    return this.enqueue(async () => {
      if (epoch !== contentMutationGate.epoch || !(await this.mayRecord(identity))) return;
      const added = await this.repo.addReadingTime(identity.bookId, identity.title, slices, epoch, this.prefs);
      if (!added || epoch !== contentMutationGate.epoch) return;
      await this.prefs.setTotalReadTimeSeconds((await this.repo.totalRecordedSeconds()) + await this.prefs.legacyUnattributedSeconds);
      for (const slice of slices) await this.prefs.setDailyReadTime(slice.date, await this.repo.recordedSecondsForDate(slice.date));
    });
  }
  recordSession(identity: ReadingIdentity, session: ReadingSessionRow): Promise<void> {
    const epoch = contentMutationGate.epoch;
    if (!Number.isSafeInteger(session.durationSeconds) || session.durationSeconds <= 0 || session.durationSeconds > 7 * 86_400) return Promise.resolve();
    return this.enqueue(async () => {
      if (epoch !== contentMutationGate.epoch || !(await this.mayRecord(identity))) return;
      await this.repo.addReadingSession({ ...session, bookId: identity.bookId, bookTitle: identity.title }, epoch);
    });
  }
  settled(): Promise<unknown> { return this.tail; }
}
