import { useEffect, useRef } from 'react';
import { createReadingTimer } from '@core/reader/readingTimer';
import { ReadingStatisticsWriter } from '@core/reader/readingStatisticsWriter';
import { PreferencesManager, SettingsRepository } from '@core/settings/settingsRepository';
import { getPrivacyService } from '@platform/privacyRuntime';
import { getPlatform } from '@platform/index';
import { getBookRepository } from '@ui/state/appStore';
import { showToast } from '@ui/toast';
import type { BookRepository } from '@core/library/bookRepository';

const writers = new WeakMap<BookRepository, ReadingStatisticsWriter>();
export function useReadingStatistics({ bookId, title, enabled = true, onRestTick }: { bookId: number | null; title: string; enabled?: boolean; onRestTick?: (seconds: number) => void }): void {
  const rest = useRef(onRestTick);
  useEffect(() => { rest.current = onRestTick; }, [onRestTick]);
  useEffect(() => {
    const repo = getBookRepository(); if (!enabled || !repo || !title.trim()) return;
    const platform = getPlatform(), identity = { bookId, title };
    let writer = writers.get(repo);
    if (!writer) { writer = new ReadingStatisticsWriter(repo, new PreferencesManager(new SettingsRepository(platform.db)), getPrivacyService()); writers.set(repo, writer); }
    const sink = writer;
    let reportedError = false;
    const failure = (): void => { if (!reportedError) { reportedError = true; showToast('阅读统计保存失败，请检查存储空间后重试'); } };
    const timer = createReadingTimer(bookId, title, {
      visibility: { start() {}, stop() {}, subscribe: (listener) => platform.appLifecycle.subscribe(listener) },
      screenOn: () => platform.appLifecycle.isForeground(),
      onFlush: (seconds) => { void sink.recordTime(identity, seconds).catch(failure); },
      onSessionEnd: (session) => { void sink.recordSession(identity, session).catch(failure); },
      onRestTick: (seconds) => rest.current?.(seconds),
    }, { active: platform.appLifecycle.isForeground(), elapsed: 0, lastFlush: 0, sessionStartMs: 0, sessionStartHour: -1 });
    return () => timer.stop();
  }, [bookId, title, enabled]);
}
