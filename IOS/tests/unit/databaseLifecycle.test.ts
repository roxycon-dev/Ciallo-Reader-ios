import { describe, expect, it } from 'vitest';
import { InMemorySqliteDatabase } from '@platform/web-mock/inMemoryDb';
import { openAppDatabase } from '@core/db/openDatabase';
import { SettingsRepository } from '@core/settings/settingsRepository';
import { FavoriteDao } from '@core/library/favoriteDao';
import { contentMutationGate } from '@core/library/contentMutationGate';

describe('preview database follows native open semantics', () => {
  it('preserves stored data when a second page requests the same application database', async () => {
    const db = new InMemorySqliteDatabase(); await openAppDatabase({ db });
    const settings = new SettingsRepository(db); await settings.setString('retained-work', '真实导入');
    await openAppDatabase({ db }); expect(await settings.getString('retained-work')).toBe('真实导入');
    await expect(db.open({ name: 'other.db' })).rejects.toThrow('Close');
    expect(await settings.getString('retained-work')).toBe('真实导入');
  });
  it('queues a favorite transaction behind an active import instead of nesting SQLite BEGIN', async () => {
    const db = new InMemorySqliteDatabase(); await openAppDatabase({ db });
    const dao = new FavoriteDao(db); let pending!: Promise<void>;
    await contentMutationGate.mutex.withLock(async () => {
      await db.execute('BEGIN');
      pending = dao.reconcileChapterIds('source', 'book', [], null, []);
      await Promise.resolve();
      await db.execute('COMMIT');
    });
    await expect(pending).resolves.toBeUndefined();
  });
});
