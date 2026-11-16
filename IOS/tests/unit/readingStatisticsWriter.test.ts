import { afterEach, describe, expect, it } from 'vitest';
import { createV12Database, type MemorySqlite } from '../port/data/support/androidSqlite';
import { InMemorySqliteDatabase } from '@platform/web-mock/inMemoryDb';
import { openAppDatabase } from '@core/db/openDatabase';
import { BookRepository } from '@core/library/bookRepository';
import { PreferencesManager, SettingsRepository } from '@core/settings/settingsRepository';
import { PrivacyService } from '@core/privacy/privacyService';
import { MemorySecureStore } from '@platform/web-mock/memorySecureStore';
import { ReadingStatisticsWriter } from '@core/reader/readingStatisticsWriter';
import { contentMutationGate } from '@core/library/contentMutationGate';

const realDatabases: MemorySqlite[] = [];
afterEach(() => { for (const db of realDatabases.splice(0)) db.close(); });
async function createSetup(real: boolean) {
  const preview = new InMemorySqliteDatabase();
  if (!real) await openAppDatabase({ db: preview });
  const db = real ? createV12Database() : preview;
  if (real) realDatabases.push(db as MemorySqlite);
  const settings = new SettingsRepository(db), prefs = new PreferencesManager(settings), repo = new BookRepository(db), privacy = new PrivacyService(new MemorySecureStore());
  const bookId = await repo.insertBook({ title: '整本书名', author: '', filePath: '', coverUri: '', category: '私密', currentChapterIndex: 0, scrollOffset: 0, isFinished: 0, totalChapters: 1, contentType: 'NOVEL', addedTime: 0, lastReadTime: 0, sourceId: null, comicId: null });
  const identity = { bookId, title: '整本书名' }, writer = new ReadingStatisticsWriter(repo, prefs, privacy);
  return { db, settings, prefs, repo, privacy, identity, writer };
}
describe.each(['preview', 'real SQLite'])('production reading statistics writes in %s', (kind) => {
  const setup = () => createSetup(kind === 'real SQLite');
  it('serializes flushes, splits at local midnight and keeps sessions from doubling totals', async () => {
    const { repo, prefs, identity, writer } = await setup();
    const end = new Date(2026, 9, 29, 0, 0, 10).getTime();
    await Promise.all([writer.recordTime(identity, 20, end), writer.recordTime(identity, 5, end)]);
    expect(await repo.recordedSecondsForDate('2026-10-28')).toBe(10); expect(await repo.recordedSecondsForDate('2026-10-29')).toBe(15);
    await writer.recordSession(identity, { bookId: null, bookTitle: '错误章节名', dateStr: '', startTimeMs: end - 20_000, endTimeMs: end, durationSeconds: 20, startHour: 0 });
    const sessions = await repo.getAllReadingSessionsFlow(); expect(sessions).toHaveLength(2); expect(sessions.every((row) => row.bookTitle === identity.title && row.bookId === identity.bookId)).toBe(true);
    expect(await repo.totalRecordedSeconds()).toBe(25); expect(await prefs.totalReadTimeSeconds()).toBe(25);
  });
  it('does not write records or sessions for incognito or a protected category, including after unlock', async () => {
    const { settings, repo, privacy, writer, identity } = await setup();
    await repo.insertCategory('私密', 1); await privacy.enable('123456'); await privacy.unlockCategory(1, '123456');
    await writer.recordTime(identity, 10); expect(await repo.totalRecordedSeconds()).toBe(0);
    await settings.setBoolean('incognito_browsing_enabled', true); await privacy.disable('123456');
    await writer.recordTime({ bookId: null, title: '在线书籍' }, 20);
    const end = Date.now(); await writer.recordSession(identity, { ...identity, bookTitle: identity.title, dateStr: '', startTimeMs: end - 10_000, endTimeMs: end, durationSeconds: 10, startHour: 12 });
    expect(await repo.totalRecordedSeconds()).toBe(0); expect(await repo.getAllReadingSessionsFlow()).toEqual([]);
  });
  it('drops queued writes after an import or clear invalidates the content epoch', async () => {
    const { repo, writer, identity } = await setup();
    const task = writer.recordTime(identity, 5); contentMutationGate.invalidatePendingWrites(); await task;
    expect(await repo.totalRecordedSeconds()).toBe(0);
  });
  it('queues a session behind an active import transaction', async () => {
    const { db, repo, identity } = await setup(); let pending!: Promise<void>;
    const end = Date.now();
    await contentMutationGate.mutex.withLock(async () => { await db.execute('BEGIN'); pending = repo.addReadingSession({ ...identity, bookTitle: identity.title, dateStr: '', startTimeMs: end - 5000, endTimeMs: end, durationSeconds: 5, startHour: 12 }); await Promise.resolve(); await db.execute('COMMIT'); });
    await pending; expect(await repo.getAllReadingSessionsFlow()).toHaveLength(1);
  });
});
